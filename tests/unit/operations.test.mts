import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ObjectId } from 'mongodb';
import {
  notificationView,
  jobView,
  OperationsService,
} from '../../apps/api/src/modules/operations/operations.service.js';
import type { DatabaseService } from '../../apps/api/src/database/database.service.js';
import type { AdminService } from '../../apps/api/src/modules/admin/admin.service.js';
import type { LedgerService } from '../../apps/api/src/modules/ledger/ledger.service.js';
import type { ChainService } from '../../apps/api/src/modules/chain/chain.service.js';
import type { CustodyService } from '../../apps/api/src/modules/custody/custody.service.js';
import { verificationRows } from '../../apps/api/src/modules/ledger/verification-budget.js';
describe('Notification and verification projections', () => {
  it('[edge] aborts on an in-snapshot overflow instead of certifying truncated data', async () => {
    const cursor = {
      limit: (limit: number) => {
        assert.equal(limit, 3);
        return cursor;
      },
      toArray: async () => [1, 2, 3],
    };
    await assert.rejects(verificationRows(cursor, 2), /budget exceeded inside the snapshot/);
    assert.deepEqual(await verificationRows(cursor), [1, 2, 3]);
  });
  it('[happy] returns a durable receipt reference and explicit read state', () => {
    const row = {
      _id: new ObjectId(),
      recipientId: new ObjectId(),
      eventId: 'private-internal-event',
      transferId: new ObjectId(),
      createdAt: new Date('2026-10-26T00:00:00Z'),
      readAt: null,
    };
    const view = notificationView(row);
    assert.equal(view.transferId, row.transferId.toHexString());
    assert.equal(view.readAt, null);
    assert.ok(!JSON.stringify(view).includes('private-internal-event'));
    assert.ok(!('recipientId' in view));
  });
  it('[negative] bounds verification input before running whole-snapshot checks', async () => {
    const database = {
      db: {
        collection: () => ({
          find: () => ({
            limit: (value: number) => {
              assert.equal(value, 5001);
              return {
                maxTimeMS: () => ({
                  toArray: async () =>
                    Array.from({ length: 5001 }, () => ({ _id: new ObjectId() })),
                }),
              };
            },
          }),
        }),
      },
    } as unknown as DatabaseService;
    const service = new OperationsService(
      database,
      {} as AdminService,
      {} as LedgerService,
      {} as ChainService,
      {} as CustodyService,
    );
    await assert.rejects(service.assertBounded(), /5,000 records/);
  });
  it('[edge] public job state hides worker keys and fences while preserving partial progress', () => {
    const row = {
      _id: new ObjectId(),
      ownerId: new ObjectId(),
      key: 'private-command',
      status: 'RUNNING' as const,
      progress: 1,
      createdAt: new Date('2026-10-26T00:00:00Z'),
      results: [{ check: 'LEDGER' as const, ok: true, issueCount: 0 }],
      token: 'private-lease',
      leaseUntil: new Date(),
    };
    const view = jobView(row);
    assert.equal(view.progress, 1);
    assert.equal(view.total, 3);
    assert.equal(view.results[0]!.ok, true);
    assert.ok(!JSON.stringify(view).includes('private-'));
  });
});
