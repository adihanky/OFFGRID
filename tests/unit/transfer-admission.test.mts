import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MongoServerError, ObjectId } from 'mongodb';
import { TransfersService } from '../../apps/api/src/modules/transfers/transfers.service.js';
import type { TransferRecord } from '../../apps/api/src/modules/transfers/transfers.models.js';
import { transferUnitFixture } from '../support/transfer-unit-fixture.mjs';

function admission() {
  const { service, record } = transferUnitFixture();
  let stored: TransferRecord | null = null;
  let throttles = 0;
  let executions = 0;
  const profiles = [record.sender, record.recipient];
  const collection = {
    findOne: async () => stored,
    insertOne: async (value: TransferRecord) => {
      if (stored) throw new MongoServerError({ message: 'Duplicate key', code: 11000 });
      stored = value;
    },
  };
  const subject = new TransfersService(
    { db: { collection: () => collection } } as unknown as TransfersService['database'],
    {
      assets: { findOne: async () => ({ ...record.asset, _id: record.assetId }) },
      throttle: async () => {
        throttles++;
      },
    } as unknown as TransfersService['accounts'],
    {
      profile: async (id: ObjectId) =>
        profiles.find((peer) => peer.id === id.toHexString()) ?? null,
    } as unknown as TransfersService['identities'],
    service.ledger,
    service.chain,
    service.outbox,
    service.wallets,
  );
  subject.execute = async () => {
    executions++;
    assert.ok(stored);
    stored.status = 'COMMITTED';
    return stored;
  };
  const body = {
    recipientId: record.recipient.id,
    assetId: record.asset.id,
    quantity: '1.00',
  };
  return {
    subject,
    record,
    body,
    get stored() {
      return stored;
    },
    get throttles() {
      return throttles;
    },
    get executions() {
      return executions;
    },
    submit: (input: unknown = body, key: unknown = record.idempotencyKey) =>
      subject.submit(record.sender.id, input, key),
  };
}

test('[happy] admission snapshots identities and returns a new committed result', async () => {
  const fixture = admission();
  const response = await fixture.submit();
  assert.equal(response.statusCode, 201);
  assert.equal(response.transfer.status, 'COMMITTED');
  assert.equal(response.transfer.quantity, '1.00');
  assert.deepEqual(response.transfer.sender, fixture.record.sender);
  assert.deepEqual(response.transfer.recipient, fixture.record.recipient);
  assert.equal(fixture.throttles, 1);
  assert.equal(fixture.executions, 1);
});

test('[edge] equivalent terminal replay uses admitted precision without rechecking eligibility', async () => {
  const fixture = admission();
  const original = await fixture.submit();
  fixture.subject.accounts.assets.findOne = async () => {
    throw new Error('asset unavailable');
  };
  const replay = await fixture.submit({ ...fixture.body, quantity: '1' });
  assert.equal(replay.statusCode, 200);
  assert.deepEqual(replay.transfer, original.transfer);
  assert.equal(fixture.throttles, 1);
  assert.equal(fixture.executions, 1);
});

test('[edge] concurrent duplicate admission reconciles the unique sender/key identity', async () => {
  const fixture = admission();
  const results = await Promise.all([fixture.submit(), fixture.submit()]);
  assert.equal(results[0]!.transfer.id, results[1]!.transfer.id);
  assert.deepEqual(results.map((result) => result.statusCode).sort(), [200, 201]);
});

test('[negative] changed request content conflicts without another execution', async () => {
  const fixture = admission();
  await fixture.submit();
  fixture.subject.accounts.assets.findOne = async () => {
    throw new Error('Replacement asset is unavailable');
  };
  for (const changed of [
    { quantity: '2.00' },
    { recipientId: new ObjectId().toHexString() },
    { assetId: new ObjectId().toHexString() },
  ]) {
    await assert.rejects(fixture.submit({ ...fixture.body, ...changed }), { status: 409 });
  }
  assert.equal(fixture.executions, 1);
});

test('[negative] malformed or injected inputs fail before durable admission', async () => {
  const fixture = admission();
  for (const invalid of [
    { ...fixture.body, quantity: 1 },
    { ...fixture.body, quantity: '0' },
    { ...fixture.body, quantity: '1.001' },
    { ...fixture.body, senderId: fixture.record.sender.id },
    { ...fixture.body, recipientId: fixture.record.sender.id },
    { ...fixture.body, recipientId: { $ne: null } },
  ]) {
    await assert.rejects(fixture.submit(invalid), { status: 400 });
  }
  await assert.rejects(fixture.submit(fixture.body, 'invalid'), { status: 400 });
  assert.equal(fixture.stored, null);
  assert.equal(fixture.throttles, 0);
  assert.equal(fixture.executions, 0);
});

test('[edge] pending and rejected replays preserve their durable state and safe reason', async () => {
  const fixture = admission();
  await fixture.submit();
  assert.ok(fixture.stored);
  fixture.stored.status = 'PENDING';
  fixture.subject.execute = async () => fixture.stored;
  const pending = await fixture.submit();
  assert.equal(pending.statusCode, 202);
  assert.equal(pending.transfer.id, fixture.stored._id.toHexString());
  fixture.stored.status = 'REJECTED';
  fixture.stored.rejectionCode = 'INSUFFICIENT_BALANCE';
  const rejected = await fixture.submit();
  assert.equal(rejected.statusCode, 422);
  assert.equal(rejected.transfer.rejectionCode, 'INSUFFICIENT_BALANCE');
  assert.equal(rejected.transfer.id, pending.transfer.id);
});
