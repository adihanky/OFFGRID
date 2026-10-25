import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { ConflictException } from '@nestjs/common';
import { MongoServerError, ObjectId } from 'mongodb';
import { TransfersService } from '../../apps/api/src/modules/transfers/transfers.service.js';
import { transferUnitFixture } from '../support/transfer-unit-fixture.mjs';
import type { TransferRecord } from '../../apps/api/src/modules/transfers/transfers.models.js';

function fixture() {
  const base = transferUnitFixture();
  let stored: TransferRecord | null = null;
  let reviewAllowed = true;
  let reviews = 0;
  let reviewBudgetHits = 0;
  const resolutionId = new ObjectId();
  const senderWalletId = new ObjectId();
  const recipientWalletId = new ObjectId();
  const collection = {
    findOne: async () => stored,
    insertOne: async (r: TransferRecord) => {
      if (stored) throw new MongoServerError({ message: 'duplicate', code: 11000 });
      stored = r;
    },
  };
  const service = new TransfersService(
    { db: { collection: () => collection } } as unknown as TransfersService['database'],
    {
      assets: {
        findOne: async () => ({
          _id: base.record.assetId,
          ...base.record.asset,
          custodyEnabled: true,
        }),
      },
      throttle: async (_user: string, action: string) => {
        if (action === 'v2-review-submit') reviewBudgetHits++;
      },
    } as unknown as TransfersService['accounts'],
    {
      profile: async (id: ObjectId) =>
        id.equals(base.record.senderId) ? base.record.sender : base.record.recipient,
    } as unknown as TransfersService['identities'],
    base.service.ledger,
    base.service.chain,
    base.service.outbox,
    {
      reviewed: async () => {
        reviews++;
        if (!reviewAllowed) throw new ConflictException('REVIEW_REQUIRED');
        return {
          _id: resolutionId,
          senderWalletId,
          recipientWalletId,
          recipientId: base.record.recipientId,
        };
      },
    } as unknown as TransfersService['wallets'],
  );
  service.execute = async () => {
    stored!.status = 'COMMITTED';
    return stored;
  };
  const body = {
    recipientResolutionId: resolutionId.toHexString(),
    senderWalletId: senderWalletId.toHexString(),
    assetId: base.record.assetId.toHexString(),
    quantity: '1.00',
  };
  const key = randomUUID();
  return {
    service,
    body,
    key,
    sender: base.record.sender.id,
    get stored() {
      return stored;
    },
    get reviews() {
      return reviews;
    },
    get reviewBudgetHits() {
      return reviewBudgetHits;
    },
    denyReview() {
      reviewAllowed = false;
    },
    submit(input: unknown = body) {
      return service.submitV2(base.record.sender.id, input, key);
    },
  };
}
describe('O04/O10 v2 reviewed admission and versioned idempotency', () => {
  it('[happy] stores a server-resolved destination and canonical units', async () => {
    const f = fixture();
    const result = await f.submit();
    assert.equal(result.statusCode, 201);
    assert.equal(result.transfer.mode, 'SIMULATED');
    assert.equal(result.transfer.payloadVersion, 2);
    assert.equal(f.stored!.payloadVersion, 2);
    assert.equal(f.stored!.quantityUnits.toBigInt(), 100n);
    assert.equal(f.stored!.recipientResolutionId!.toHexString(), f.body.recipientResolutionId);
    assert.equal(f.stored!.senderWalletId!.toHexString(), f.body.senderWalletId);
    assert.equal(JSON.stringify(result).includes('idempotencyKey'), false);
  });
  it('[negative] expired or unavailable review cannot create a request', async () => {
    const f = fixture();
    f.denyReview();
    await assert.rejects(f.submit());
    assert.equal(f.stored, null);
    await assert.rejects(f.submit({ ...f.body, senderId: f.sender }));
    assert.equal(f.stored, null);
  });
  it('[edge] a terminal same-intent replay survives expired review without revalidating', async () => {
    const f = fixture();
    const first = await f.submit();
    f.denyReview();
    const replay = await f.submit({ ...f.body, quantity: '1' });
    assert.equal(replay.transfer.id, first.transfer.id);
    assert.equal(replay.statusCode, 200);
    assert.equal(f.reviews, 1);
    assert.equal(f.reviewBudgetHits, 1);
  });
  it('[negative] changing amount wallet or resolution conflicts with the durable key', async () => {
    const f = fixture();
    await f.submit();
    for (const body of [
      { ...f.body, quantity: '2' },
      { ...f.body, senderWalletId: new ObjectId().toHexString() },
      { ...f.body, recipientResolutionId: new ObjectId().toHexString() },
    ])
      await assert.rejects(
        f.submit(body),
        (e: unknown) => (e as { getStatus(): number }).getStatus() === 409,
      );
    assert.equal(f.stored!.quantityUnits.toBigInt(), 100n);
  });
  it('[edge] both API versions share key uniqueness and cannot reinterpret each other', async () => {
    const f = fixture();
    await f.submit();
    await assert.rejects(
      f.service.submit(
        f.sender,
        {
          recipientId: f.stored!.recipientId.toHexString(),
          assetId: f.body.assetId,
          quantity: '1',
        },
        f.key,
      ),
    );
    f.stored!.payloadVersion = 1;
    await assert.rejects(f.submit());
  });
  it('[edge] concurrent duplicate admission converges to one versioned request', async () => {
    const f = fixture();
    const results = await Promise.all([f.submit(), f.submit()]);
    assert.equal(results[0]!.transfer.id, results[1]!.transfer.id);
    assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 201]);
  });
  it('[negative] invalid reviews consume the admission budget without creating requests', async () => {
    const f = fixture();
    f.denyReview();
    await assert.rejects(f.submit());
    await assert.rejects(f.submit());
    assert.equal(f.reviewBudgetHits, 2);
    assert.equal(f.stored, null);
  });
});
