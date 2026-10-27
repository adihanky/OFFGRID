import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ObjectId } from 'mongodb';
import type { DatabaseService } from '../../apps/api/src/database/database.service.js';
import { RecoveryService } from '../../apps/api/src/modules/auth/recovery.service.js';
import { DisabledRecoveryDelivery } from '../../apps/api/src/modules/auth/recovery-delivery.js';
import { PasswordService, tokenHash } from '../../apps/api/src/modules/auth/auth.crypto.js';
import { testEnvironment } from '../support/auth-fixture.mjs';
import { ControlledRecoveryDelivery } from '../support/recovery-delivery.mjs';
import type { UserRecord } from '../../apps/api/src/modules/auth/auth.models.js';
describe('Controlled identity recovery boundary', () => {
  it('[happy] stores only a hash and binds delivery to one user, email, purpose and expiry', async () => {
    const delivery = new ControlledRecoveryDelivery();
    let record: Record<string, unknown> = {};
    const database = {
      db: {
        collection: () => ({
          insertOne: async (row: Record<string, unknown>) => {
            record = row;
          },
        }),
      },
    } as unknown as DatabaseService;
    const service = new RecoveryService(
      database,
      delivery,
      new PasswordService(),
      testEnvironment(),
    );
    service.now = () => new Date('2026-10-26T00:00:00Z');
    const user = { _id: new ObjectId(), normalizedEmail: 'recovery@example.invalid' } as UserRecord;
    await service.issue(user, 'VERIFY');
    assert.equal(delivery.messages.length, 1);
    assert.equal(record['hash'], tokenHash(delivery.messages[0]!.token));
    assert.ok(!JSON.stringify(record).includes(delivery.messages[0]!.token));
    assert.equal(record['kind'], 'VERIFY');
    assert.equal(record['userId'], user._id);
    assert.equal((record['expiresAt'] as Date).toISOString(), '2026-10-26T00:15:00.000Z');
  });
  it('[negative] disabled live delivery has identical acknowledgment and never queries account existence', async () => {
    const service = new RecoveryService(
      {
        db: {
          collection: () => {
            throw new Error('Unexpected account query');
          },
        },
      } as unknown as DatabaseService,
      new DisabledRecoveryDelivery(),
      new PasswordService(),
      testEnvironment(),
    );
    assert.deepEqual(
      await service.requestReset({ email: 'known@example.invalid' }),
      await service.requestReset({ email: 'missing@example.invalid' }),
    );
    assert.equal(service.status().deliveryEnabled, false);
    await assert.rejects(service.requestVerification(new ObjectId().toHexString(), {}));
  });
  it('[edge] failed controlled delivery consumes its token and public acknowledgment stays generic', async () => {
    const delivery = new ControlledRecoveryDelivery();
    delivery.failing = true;
    let invalidated = false;
    const database = {
      db: {
        collection: () => ({
          findOne: async () => ({
            _id: new ObjectId(),
            normalizedEmail: 'fixture@example.invalid',
          }),
          insertOne: async () => undefined,
          updateOne: async (_filter: unknown, update: { $set: { consumedAt: Date } }) => {
            invalidated = update.$set.consumedAt instanceof Date;
          },
        }),
      },
    } as unknown as DatabaseService;
    const service = new RecoveryService(
      database,
      delivery,
      new PasswordService(),
      testEnvironment(),
    );
    assert.equal((await service.requestReset({ email: 'fixture@example.invalid' })).accepted, true);
    assert.equal(invalidated, true);
    assert.equal(delivery.messages.length, 0);
  });
});
