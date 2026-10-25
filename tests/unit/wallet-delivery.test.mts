import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ObjectId } from 'mongodb';
import {
  draftAmounts,
  draftSchema,
  matchesSetupToken,
} from '../../apps/api/src/modules/admin/admin.service.js';
import {
  demoHandles,
  demoTransfers,
  seedProfileHash,
  seedTransferKey,
  waitForSeedTransfer,
} from '../../apps/api/src/modules/admin/demo.service.js';
import {
  migrationPlan,
  MIGRATION_POLICY,
} from '../../apps/api/src/modules/wallets/wallet-migration.js';
import { migrationFixture } from '../support/migration-fixture.mjs';
import { toLong } from '../../apps/api/src/modules/accounts/quantity.js';
import {
  createV2Intent,
  applyWalletResult,
  restoreWalletIntent,
  saveWalletIntent,
  clearWalletIntent,
} from '../../apps/web/src/wallet-v2-client.js';
import type { RecipientResolutionView, SimulatedTransferV2View } from '@p2p/contracts';

describe('Wallet delivery administration policies', () => {
  const draft = {
    code: 'TEST',
    symbol: 'TST',
    displayName: 'Test demo',
    precision: 2,
    supplyCap: '100.00',
    minimum: '0.01',
    maximum: '10.00',
    reason: 'Controlled fixture',
  };
  it('[happy/edge] validates exact supply and minimum-unit policy', () => {
    const parsed = draftSchema.parse(draft);
    assert.equal(draftAmounts(parsed).minimumUnits.toString(), '1');
    assert.equal(draftAmounts(parsed).capUnits.toString(), '10000');
    assert.equal(
      draftAmounts({
        ...parsed,
        precision: 0,
        supplyCap: '9223372036854775807',
        minimum: '1',
        maximum: '9223372036854775807',
      }).capUnits.toString(),
      '9223372036854775807',
    );
  });
  it('[negative] rejects unsafe quantities, reversed limits and caller-selected privileges', () => {
    for (const change of [
      { supplyCap: '1e9' },
      { minimum: '10.01', maximum: '10.00' },
      { maximum: '100.01' },
      { minimum: '0' },
      { minimum: '0.001' },
    ])
      assert.throws(() => draftAmounts({ ...draft, ...change }));
    assert.equal(draftSchema.safeParse({ ...draft, role: 'ACCESS_ADMIN' }).success, false);
    assert.equal(draftSchema.safeParse({ ...draft, precision: 9 }).success, false);
  });
  it('[happy/negative/edge] setup rejects missing, short and incorrect deployment secrets', () => {
    const secret = 'controlled-test-setup-token-32-characters';
    assert.equal(matchesSetupToken(secret, secret), true);
    assert.equal(matchesSetupToken(`${secret}x`, secret), false);
    assert.equal(matchesSetupToken('short', 'short'), false);
    assert.equal(matchesSetupToken(secret, ''), false);
  });
  it('[happy/edge] seed profile has exact default split/merge transfers and stable operation keys', () => {
    const profile = { userCount: 4, transferDepth: 3 };
    const operations = demoTransfers(profile);
    assert.equal(operations.length, 4);
    assert.equal(operations[1]!.quantity, '1100.00');
    assert.equal(operations[3]!.quantity, '0.00000001');
    assert.equal(new Set(demoHandles(100)).size, 100);
    assert.deepEqual(demoTransfers({ userCount: 2, transferDepth: 0 }), []);
    assert.equal(demoTransfers({ userCount: 2, transferDepth: 100 }).length, 101);
    assert.match(
      seedTransferKey('1'),
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$/,
    );
    assert.equal(seedTransferKey('1'), seedTransferKey('1'));
    assert.notEqual(seedTransferKey('1'), seedTransferKey('2'));
    assert.notEqual(seedProfileHash(profile), seedProfileHash({ ...profile, userCount: 5 }));
  });
});
describe('Legacy cutover plan', () => {
  it('[happy] plans provenance without altering existing evidence', () => {
    const fixture = migrationFixture();
    const original = fixture.accounts[0]!.balanceUnits.toString();
    const plan = migrationPlan(fixture, MIGRATION_POLICY);
    assert.equal(plan.issuances.length, 1);
    assert.equal(plan.legacyAssets.length, 1);
    assert.equal(fixture.wallets.length, 0);
    assert.equal(fixture.accounts[0]!.balanceUnits.toString(), original);
  });
  it('[negative] refuses missing policy and corrupt balances', () => {
    assert.throws(() => migrationPlan(migrationFixture(), ''), /policy required/);
    const fixture = migrationFixture();
    fixture.accounts[0]!.balanceUnits = toLong(999n);
    assert.throws(() => migrationPlan(fixture, MIGRATION_POLICY), /integrity/);
  });
  it('[edge] empty legacy data can migrate; custody-enabled assets are not replayed', () => {
    const fixture = migrationFixture();
    fixture.assetTypes[0]!.custodyEnabled = true;
    assert.equal(migrationPlan(fixture, MIGRATION_POLICY).issuances.length, 0);
    const empty = Object.fromEntries(
      Object.keys(fixture).map((key) => [key, []]),
    ) as unknown as typeof fixture;
    assert.equal(migrationPlan(empty, MIGRATION_POLICY).assessment.state, 'READY_FOR_BACKFILL');
  });
});
describe('Reviewed browser intent and safe recovery', () => {
  const id = () => new ObjectId().toHexString();
  const userId = id(),
    senderWalletId = id(),
    recipientId = id(),
    recipientWalletId = id(),
    assetId = id(),
    resolutionId = id();
  const resolution: RecipientResolutionView = {
    resolutionId,
    expiresAt: new Date().toISOString(),
    destination: { mode: 'SIMULATED' },
    recipient: {
      userId: recipientId,
      walletId: recipientWalletId,
      publicHandle: 'bob',
      displayName: 'Bob',
    },
    revisions: { senderWallet: '0', recipientWallet: '0', asset: '0' },
  };
  const request = {
    senderWalletId,
    recipientResolutionId: resolutionId,
    assetId,
    quantity: '1.00',
  };
  const transfer: SimulatedTransferV2View = {
    id: id(),
    payloadVersion: 2,
    mode: 'SIMULATED',
    senderWalletId,
    recipientWalletId,
    sender: { id: userId, displayName: 'Alice', publicHandle: 'alice' },
    recipient: { id: recipientId, displayName: 'Bob', publicHandle: 'bob' },
    asset: { id: assetId, code: 'DEMO', displayName: 'Demo', precision: 2 },
    quantity: '1.00',
    status: 'COMMITTED',
    rejectionCode: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  it('[happy] freezes a review and validates the complete settlement identity', () => {
    const intent = createV2Intent(userId, request, resolution);
    assert.ok(Object.isFrozen(intent.request));
    assert.equal(applyWalletResult(intent, transfer).terminal, true);
    assert.equal(applyWalletResult(intent, { ...transfer, status: 'PENDING' }).terminal, false);
  });
  it('[edge] a seed waits for a worker-owned transfer using only the original ID', async () => {
    let reads = 0;
    const result = await waitForSeedTransfer(
      { ...transfer, status: 'PENDING' },
      async () => ({ transfer: { ...transfer, status: ++reads === 1 ? 'PENDING' : 'COMMITTED' } }),
      async () => undefined,
      3,
    );
    assert.equal(result.id, transfer.id);
    assert.equal(reads, 2);
  });
  it('[negative/edge] unresolved, rejected and mismatched seed outcomes never report completion', async () => {
    await assert.rejects(() =>
      waitForSeedTransfer(
        { ...transfer, status: 'PENDING' },
        async () => ({ transfer: { ...transfer, status: 'PENDING' } }),
        async () => undefined,
        2,
      ),
    );
    await assert.rejects(() =>
      waitForSeedTransfer(
        { ...transfer, status: 'REJECTED' },
        async () => ({ transfer }),
        async () => undefined,
      ),
    );
    await assert.rejects(() =>
      waitForSeedTransfer(
        { ...transfer, status: 'PENDING' },
        async () => ({ transfer: { ...transfer, id: id() } }),
        async () => undefined,
      ),
    );
  });
  it('[negative] rejects mismatched wallets, quantity, recipient and mode', () => {
    const intent = createV2Intent(userId, request, resolution);
    for (const value of [
      { ...transfer, senderWalletId: id() },
      { ...transfer, recipientWalletId: id() },
      { ...transfer, quantity: '2.00' },
      { ...transfer, recipient: { ...transfer.recipient, id: id() } },
    ])
      assert.throws(() => applyWalletResult(intent, value));
    assert.throws(() => createV2Intent(recipientId, request, resolution));
  });
  it('[edge] reload retains the same key and session switching removes persisted intents', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    };
    const intent = createV2Intent(userId, request, resolution);
    saveWalletIntent(intent, storage);
    assert.equal(restoreWalletIntent(userId, storage)!.key, intent.key);
    assert.equal(restoreWalletIntent(id(), storage), null);
    assert.equal(values.size, 0);
    saveWalletIntent(intent, storage);
    clearWalletIntent(storage);
    assert.equal(values.size, 0);
  });
});
