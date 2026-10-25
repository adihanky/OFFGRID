import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ObjectId } from 'mongodb';
import {
  AccountsService,
  objectId,
  strictObject,
} from '../../apps/api/src/modules/accounts/accounts.service.js';
import { toLong } from '../../apps/api/src/modules/accounts/quantity.js';
import type { DatabaseService } from '../../apps/api/src/database/database.service.js';
import type { IdentityEligibility } from '../../apps/api/src/modules/auth/identity-eligibility.service.js';
import type { LedgerService } from '../../apps/api/src/modules/ledger/ledger.service.js';
import type { CustodyService } from '../../apps/api/src/modules/custody/custody.service.js';
describe('Wallet projection and validation W01-W04/W07-W08', () => {
  it('[happy/edge] own exact balances and virtual zero avoid mutations', async () => {
    const userId = new ObjectId();
    const first = new ObjectId();
    const second = new ObjectId();
    let accountFilter: unknown;
    const assets = [
      { _id: first, code: 'AAA', displayName: 'A', precision: 2, status: 'active' },
      { _id: second, code: 'BBB', displayName: 'B', precision: 8, status: 'active' },
    ];
    const db = {
      db: {
        collection: (name: string) => ({
          find: (filter: unknown) => {
            if (name === 'accounts') accountFilter = filter;
            return {
              sort: () => ({ toArray: async () => assets }),
              toArray: async () => [
                { assetId: first, balanceUnits: toLong(9007199254740993n), status: 'active' },
              ],
            };
          },
        }),
      },
    } as unknown as DatabaseService;
    const service = new AccountsService(
      db,
      {} as IdentityEligibility,
      {} as LedgerService,
      {} as CustodyService,
    );
    const result = await service.wallet(userId.toHexString());
    assert.deepEqual(accountFilter, { ownerType: 'user', userId });
    assert.equal(result.accounts[0]!.balance, '90071992547409.93');
    assert.equal(result.accounts[1]!.balance, '0.00000000');
    assert.deepEqual(
      Object.keys(result.accounts[0]!).sort(),
      ['assetId', 'balance', 'code', 'displayName', 'precision', 'status'].sort(),
    );
  });
  it('[happy/negative] exact normalized peer and unavailable peer', async () => {
    let received = '';
    const identity = {
      peer: async (handle: string) => {
        received = handle;
        return handle === 'bob_peer'
          ? { id: 'safe', publicHandle: handle, displayName: 'Bob' }
          : null;
      },
    } as unknown as IdentityEligibility;
    const service = new AccountsService(
      {} as DatabaseService,
      identity,
      {} as LedgerService,
      {} as CustodyService,
    );
    assert.equal((await service.peer(' BOB_PEER ')).peer.publicHandle, 'bob_peer');
    assert.equal(received, 'bob_peer');
    await assert.rejects(service.peer('unknown'));
    await assert.rejects(service.peer({ $ne: null }));
    await assert.rejects(service.peer('bo'));
  });
  it('[negative] strict objects and IDs forbid injection', () => {
    assert.throws(() => strictObject({ senderId: 'x' }, []));
    assert.throws(() => strictObject([], []));
    assert.throws(() => strictObject({}, ['quantity']));
    assert.throws(() => objectId('BAD'));
    assert.throws(() => objectId({ $ne: null }));
    const id = new ObjectId().toHexString();
    assert.equal(objectId(id).toHexString(), id);
  });
  it('[negative] invalid issuance and catalogue fail before persistence', async () => {
    const service = new AccountsService(
      {} as DatabaseService,
      {} as IdentityEligibility,
      {} as LedgerService,
      {} as CustodyService,
    );
    await assert.rejects(service.createAsset({ code: 'bad code', displayName: 'A', precision: 2 }));
    await assert.rejects(
      service.issueDemo({
        fixtureKey: 'key',
        userId: new ObjectId(),
        assetId: new ObjectId(),
        quantityUnits: 0n,
      }),
    );
  });
});
