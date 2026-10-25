import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ObjectId } from 'mongodb';
import type { DatabaseService } from '../../apps/api/src/database/database.service.js';
import type { AccountsService } from '../../apps/api/src/modules/accounts/accounts.service.js';
import type { IdentityEligibility } from '../../apps/api/src/modules/auth/identity-eligibility.service.js';
import { RoleAuthorization } from '../../apps/api/src/modules/wallets/role-authorization.js';
import { WalletsService } from '../../apps/api/src/modules/wallets/wallets.service.js';
import { walletDocument } from '../../apps/api/src/modules/wallets/wallet-document.js';
import { MongoAuthStore } from '../../apps/api/src/modules/auth/mongo-auth.store.js';
import type { UserRecord } from '../../apps/api/src/modules/auth/auth.models.js';
import type { ClientSession } from 'mongodb';

describe('O02/O03 wallet ownership and exact recipient resolution', () => {
  it('[happy/edge] wallet documents retain one owner and no balances or secrets', () => {
    const id = new ObjectId();
    const wallet = walletDocument(id);
    assert.equal(wallet.userId, id);
    assert.equal(wallet.status, 'ACTIVE');
    assert.equal(wallet.eligibilityRevision.toBigInt(), 0n);
    assert.deepEqual(
      Object.keys(wallet).sort(),
      [
        '_id',
        'schemaVersion',
        'userId',
        'status',
        'eligibilityRevision',
        'createdAt',
        'updatedAt',
      ].sort(),
    );
  });
  it('[happy/negative] registration shares a transaction and aborts both records on wallet failure', async () => {
    let fail = false;
    let users = 0;
    let wallets = 0;
    const session = {
      withTransaction: async (callback: () => Promise<void>) => {
        const before = [users, wallets];
        try {
          await callback();
        } catch (error) {
          [users, wallets] = before as [number, number];
          throw error;
        }
      },
      endSession: async () => undefined,
    } as unknown as ClientSession;
    const db = {
      client: { startSession: () => session },
      db: {
        collection: (name: string) => ({
          insertOne: async (_value: unknown, options: { session: ClientSession }) => {
            assert.equal(options.session, session);
            if (name === 'wallets') {
              if (fail) throw new Error('fixture wallet failure');
              wallets++;
            } else users++;
          },
        }),
      },
    } as unknown as DatabaseService;
    const store = new MongoAuthStore(db);
    const user = { _id: new ObjectId(), createdAt: new Date() } as UserRecord;
    await store.insertUser(user);
    assert.deepEqual([users, wallets], [1, 1]);
    fail = true;
    await assert.rejects(store.insertUser({ ...user, _id: new ObjectId() }));
    assert.deepEqual([users, wallets], [1, 1]);
  });
  it('[negative] missing legacy wallet returns migration-required without provisioning or issuance', async () => {
    const database = {
      db: { collection: () => ({ findOne: async () => null }) },
    } as unknown as DatabaseService;
    const service = new WalletsService(database, {} as AccountsService, {} as IdentityEligibility);
    await assert.rejects(
      service.own(new ObjectId().toHexString()),
      (error: unknown) => (error as { getStatus(): number }).getStatus() === 503,
    );
  });
  it('[edge/negative] review expires independently of TTL deletion and stays caller scoped', async () => {
    let filter: Record<string, unknown> = {};
    const database = {
      db: {
        collection: () => ({
          findOne: async (value: Record<string, unknown>) => {
            filter = value;
            return null;
          },
        }),
      },
    } as unknown as DatabaseService;
    const service = new WalletsService(database, {} as AccountsService, {} as IdentityEligibility);
    const ids = Array.from({ length: 4 }, () => new ObjectId().toHexString());
    await assert.rejects(service.reviewed(ids[0]!, ids[1]!, ids[2]!, ids[3]!));
    assert.equal((filter['callerId'] as ObjectId).toHexString(), ids[0]);
    assert.equal((filter['senderWalletId'] as ObjectId).toHexString(), ids[2]);
    assert.ok((filter['expiresAt'] as { $gt: Date }).$gt instanceof Date);
  });
  it('[happy/negative/edge] role authorization rereads grants and active identity every time', async () => {
    let active = true;
    let granted = true;
    const db = {
      db: {
        collection: (name: string) => ({
          findOne: async () =>
            name === 'users'
              ? active && { _id: new ObjectId() }
              : granted && { _id: new ObjectId() },
        }),
      },
    } as unknown as DatabaseService;
    const auth = new RoleAuthorization(db);
    const user = new ObjectId();
    assert.ok(await auth.require(user, 'AUDITOR'));
    granted = false;
    await assert.rejects(auth.require(user, 'AUDITOR'));
    active = false;
    granted = true;
    await assert.rejects(auth.require(user, 'ACCESS_ADMIN'));
  });
});
