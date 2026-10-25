import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ObjectId } from 'mongodb';
import {
  assetDraftSchema,
  parseInput,
  parseChainQuantity,
  policySchema,
  DEFAULT_WALLET_POLICY,
  recipientLookupSchema,
  sendIntentSchema,
  UINT256_MAX,
} from '../../apps/api/src/modules/assets/asset-input.js';
import { assessMigration } from '../../apps/api/src/modules/wallets/migration-assessment.js';
import { toLong } from '../../apps/api/src/modules/accounts/quantity.js';
import { migrationFixture } from '../support/migration-fixture.mjs';

describe('O-DATA versioned inputs and exact chain amounts', () => {
  it('[happy/edge] discriminates demo and ERC-20 identities without symbol identity', () => {
    const demo = {
      code: 'DEMO',
      symbol: 'SAME',
      displayName: 'Demo',
      precision: 8,
      mode: 'SIMULATED',
      kind: 'DEMO_CRYPTO',
      capUnits: '9223372036854775807',
    };
    assert.equal(parseInput(assetDraftSchema, demo).mode, 'SIMULATED');
    const chain = {
      code: 'TOKEN',
      symbol: 'SAME',
      displayName: 'Token',
      precision: 18,
      mode: 'EVM_ERC20',
      kind: 'DECENTRALIZED_TOKEN',
      networkId: new ObjectId().toHexString(),
      contractAddress: `0x${'1'.repeat(40)}`,
    };
    assert.equal(parseInput(assetDraftSchema, chain).mode, 'EVM_ERC20');
    assert.throws(() => parseInput(assetDraftSchema, { ...demo, capUnits: '9223372036854775808' }));
    assert.throws(() => parseInput(assetDraftSchema, { ...chain, capUnits: '1' }));
    assert.throws(() => parseInput(assetDraftSchema, { ...chain, precision: 19 }));
    assert.throws(() => parseInput(assetDraftSchema, { ...demo, kind: 'DECENTRALIZED_TOKEN' }));
  });
  it('[happy/negative/edge] parses uint256 boundaries exactly and rejects unsafe inputs', () => {
    assert.equal(parseChainQuantity('0.000000000000000001', 18), 1n);
    assert.equal(parseChainQuantity(UINT256_MAX.toString(), 0), UINT256_MAX);
    assert.equal(parseChainQuantity('9007199254740993.01', 2), 900719925474099301n);
    for (const value of [
      '0',
      '-1',
      '01',
      '1e2',
      ' 1',
      '1.',
      '1.001',
      (UINT256_MAX + 1n).toString(),
      1,
      {},
      '1'.repeat(101),
    ])
      assert.throws(() => parseChainQuantity(value, 2));
    assert.throws(() => parseChainQuantity('1', 19));
  });
  it('[negative/edge] bounds policy, rejects sender injection and normalizes exact handles', () => {
    assert.deepEqual(parseInput(policySchema, DEFAULT_WALLET_POLICY), DEFAULT_WALLET_POLICY);
    assert.throws(() => parseInput(policySchema, { ...DEFAULT_WALLET_POLICY, maxInputLots: 0 }));
    const id = new ObjectId().toHexString();
    assert.equal(
      parseInput(recipientLookupSchema, {
        assetId: id,
        senderWalletId: id,
        lookup: { kind: 'HANDLE', value: ' BOB_PEER ' },
      }).lookup.value,
      'bob_peer',
    );
    assert.throws(() =>
      parseInput(recipientLookupSchema, {
        assetId: id,
        senderWalletId: id,
        lookup: { kind: 'HANDLE', value: { $ne: null } },
      }),
    );
    assert.throws(() =>
      parseInput(sendIntentSchema, {
        recipientResolutionId: id,
        senderWalletId: id,
        assetId: id,
        quantity: '1',
        senderId: id,
      }),
    );
  });
});
describe('O10 read-only migration preflight', () => {
  it('[happy] reports exact supply and a required provenance policy without mutating legacy records', () => {
    const snapshot = migrationFixture();
    const before = JSON.stringify(snapshot);
    const result = assessMigration(snapshot);
    assert.equal(result.state, 'POLICY_REQUIRED');
    assert.deepEqual(result.blockers, []);
    assert.equal(result.cutoverEnabled, false);
    assert.equal(result.counts.usersWithoutWallets, 1);
    assert.equal(result.counts.userAccountsWithoutWallets, 1);
    assert.deepEqual(result.assets[0], {
      assetId: snapshot.assetTypes[0]!._id.toHexString(),
      userUnits: '10000',
      systemUnits: '-10000',
      issuedUnits: '10000',
      provenance: 'MIGRATED_POLICY_REQUIRED',
    });
    assert.equal(JSON.stringify(snapshot), before);
    assert.equal(assessMigration(snapshot).state, result.state);
  });
  it('[negative] detects missing evidence, balance tamper and duplicate ownership', () => {
    const snapshot = migrationFixture();
    snapshot.ledgerEntries.pop();
    snapshot.accounts[0]!.balanceUnits = toLong(10001n);
    const now = new Date();
    const wallet = {
      _id: new ObjectId(),
      schemaVersion: 2 as const,
      userId: snapshot.users[0]!._id,
      status: 'ACTIVE' as const,
      eligibilityRevision: toLong(0n),
      createdAt: now,
      updatedAt: now,
    };
    snapshot.wallets.push(wallet, { ...wallet, _id: new ObjectId() });
    const result = assessMigration(snapshot);
    assert.equal(result.state, 'BLOCKED');
    for (const code of [
      'DUPLICATE_WALLET_OWNER',
      'BALANCE_JOURNAL_MISMATCH',
      'JOURNAL_PAIR_INVALID',
      'SUPPLY_MISMATCH',
      'PROVENANCE_BALANCE_MISMATCH',
    ])
      assert.ok(
        result.blockers.some((i) => i.code === code),
        code,
      );
  });
  it('[edge] empty installation is ready only for backfill, never cutover', () => {
    const snapshot = migrationFixture();
    snapshot.accounts = [];
    snapshot.demoIssuances = [];
    snapshot.ledgerEntries = [];
    const result = assessMigration(snapshot);
    assert.equal(result.state, 'READY_FOR_BACKFILL');
    assert.equal(result.cutoverEnabled, false);
    assert.equal(result.assets[0]!.provenance, 'EMPTY');
  });
  it('[negative] wrong wallet linkage and chain hash stop migration', () => {
    const snapshot = migrationFixture();
    snapshot.accounts[0]!.walletId = new ObjectId();
    snapshot.chainHeads[0]!.latestHash = '1'.repeat(64);
    const result = assessMigration(snapshot);
    assert.ok(result.blockers.some((i) => i.code === 'ACCOUNT_WALLET_CONFLICT'));
    assert.ok(result.blockers.some((i) => i.code === 'CHAIN_HEAD_MISMATCH'));
  });
});
