import { ObjectId } from 'mongodb';
import { toLong } from '../../apps/api/src/modules/accounts/quantity.js';
import type { MigrationSnapshot } from '../../apps/api/src/modules/wallets/migration-assessment.js';

export function migrationFixture(): MigrationSnapshot {
  const userId = new ObjectId();
  const assetId = new ObjectId();
  const systemId = new ObjectId();
  const accountId = new ObjectId();
  const issuanceId = new ObjectId();
  const now = new Date('2026-10-25T00:00:00.000Z');
  return {
    users: [{ _id: userId, status: 'active' }],
    wallets: [],
    walletBindings: [],
    roleGrants: [],
    assetTypes: [
      {
        _id: assetId,
        code: 'DEMO',
        displayName: 'Demo',
        precision: 2,
        status: 'active',
        createdAt: now,
      },
    ],
    accounts: [
      {
        _id: accountId,
        ownerType: 'user',
        userId,
        assetId,
        balanceUnits: toLong(10000n),
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        _id: systemId,
        ownerType: 'system',
        systemKey: 'demo-issuance',
        assetId,
        balanceUnits: toLong(-10000n),
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
    ],
    demoIssuances: [
      {
        _id: issuanceId,
        fixtureKey: 'original',
        assetId,
        recipientAccountId: accountId,
        systemAccountId: systemId,
        quantityUnits: toLong(10000n),
        createdAt: now,
      },
    ],
    ledgerEntries: (['debit', 'credit'] as const).map((side) => ({
      _id: new ObjectId(),
      referenceKind: 'demoIssuance' as const,
      referenceId: issuanceId,
      accountId: side === 'debit' ? systemId : accountId,
      assetId,
      side,
      quantityUnits: toLong(10000n),
      createdAt: now,
    })),
    transfers: [],
    chainEntries: [],
    chainHeads: [
      {
        _id: new ObjectId(),
        assetId,
        latestSequence: toLong(0n),
        latestHash: '0'.repeat(64),
        transfersEnabled: true,
      },
    ],
  };
}
