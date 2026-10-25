import { ObjectId } from 'mongodb';
import type { DatabaseService } from '../../database/database.service.js';
import { TRANSACTION_OPTIONS } from '../accounts/accounts.service.js';
import { toLong, units } from '../accounts/quantity.js';
import type { CustodyService } from '../custody/custody.service.js';
import { assessMigration, type MigrationSnapshot } from './migration-assessment.js';
import { walletDocument } from './wallet-document.js';

export const MIGRATION_POLICY = 'ISSUANCE_FIRST_THEN_CHAIN_ORDER_MIGRATED_POLICY';
export const migrationCollections = [
  'users',
  'wallets',
  'walletBindings',
  'roleGrants',
  'assetTypes',
  'accounts',
  'demoIssuances',
  'transfers',
  'ledgerEntries',
  'chainHeads',
  'chainEntries',
] as const;

export function migrationPlan(snapshot: MigrationSnapshot, policy: string) {
  const assessment = assessMigration(snapshot);
  if (assessment.state === 'BLOCKED') throw new Error('Migration blocked by integrity preflight.');
  if (policy !== MIGRATION_POLICY)
    throw new Error('Explicit reconstructed-provenance policy required.');
  const legacyAssets = snapshot.assetTypes.filter((asset) => !asset.custodyEnabled);
  const legacy = new Set(legacyAssets.map((asset) => asset._id.toHexString()));
  return {
    assessment,
    legacyAssets,
    issuances: snapshot.demoIssuances
      .filter((row) => legacy.has(row.assetId.toHexString()))
      .sort((a, b) => a._id.toHexString().localeCompare(b._id.toHexString())),
    entries: snapshot.chainEntries
      .filter((row) => legacy.has(row.assetId.toHexString()))
      .sort(
        (a, b) =>
          a.assetId.toHexString().localeCompare(b.assetId.toHexString()) ||
          (units(a.sequence) < units(b.sequence) ? -1 : 1),
      ),
  };
}

/** Offline, bounded, all-or-nothing backfill. Never changes financial records or old hashes. */
export async function migrateLegacyWallets(
  database: DatabaseService,
  custody: CustodyService,
  policy: string,
) {
  const markers = database.db.collection<{ _id: string; policy: string; completedAt: Date }>(
    'walletMigrations',
  );
  const session = database.client.startSession();
  try {
    return await session.withTransaction(
      async () => {
        if (await markers.findOne({ _id: 'wallet-v2' }, { session }))
          return { alreadyComplete: true };
        const snapshot = {} as MigrationSnapshot;
        for (const name of migrationCollections) {
          const rows = await database.db
            .collection(name, { promoteLongs: false })
            .find({}, { session })
            .limit(50001)
            .toArray();
          if (rows.length > 50000)
            throw new Error('Offline migration exceeds bounded dataset limit.');
          Object.assign(snapshot, { [name]: rows });
        }
        const plan = migrationPlan(snapshot, policy);
        const owners = new Map(
          snapshot.wallets.map((wallet) => [wallet.userId.toHexString(), wallet]),
        );
        for (const user of snapshot.users) {
          if (owners.has(user._id.toHexString())) continue;
          const wallet = walletDocument(user._id, new Date());
          if (user.status !== 'active') wallet.status = 'SUSPENDED';
          await database.db.collection('wallets').insertOne(wallet, { session });
          owners.set(user._id.toHexString(), wallet);
        }
        for (const account of snapshot.accounts) {
          if (account.ownerType !== 'user') continue;
          const wallet = owners.get(account.userId!.toHexString())!;
          await database.db
            .collection('accounts')
            .updateOne({ _id: account._id }, { $set: { walletId: wallet._id } }, { session });
        }
        for (const asset of plan.legacyAssets) {
          if (await custody.events.findOne({ assetId: asset._id }, { session }))
            throw new Error(
              'Legacy asset already has custody events; manual reconciliation required.',
            );
          await custody.heads.updateOne(
            { assetId: asset._id },
            {
              $setOnInsert: {
                _id: new ObjectId(),
                sequence: toLong(0n),
                hash: '0'.repeat(64),
              },
            },
            { upsert: true, session },
          );
          // Fence the existing executor; offline callers must also stop API/worker processes.
          await database.db
            .collection('chainHeads')
            .updateOne({ assetId: asset._id }, { $inc: { issuanceRevision: 1 } }, { session });
          await database.db.collection('assetTypes').updateOne(
            { _id: asset._id },
            {
              $set: {
                schemaVersion: 2,
                custodyEnabled: true,
                kind: 'DEMO_CRYPTO',
                mode: 'SIMULATED',
                lifecycle: asset.status === 'active' ? 'ACTIVE' : 'PAUSED',
                revision: toLong(0n),
                identityKey: `demo:${asset._id}`,
                symbol: asset.code,
              },
            },
            { session },
          );
        }
        const accountMap = new Map(snapshot.accounts.map((row) => [row._id.toHexString(), row]));
        const destination = (id: ObjectId) => {
          const account = accountMap.get(id.toHexString())!;
          return { accountId: id, walletId: owners.get(account.userId!.toHexString())!._id };
        };
        for (const issue of plan.issuances)
          await custody.write(
            {
              kind: 'ISSUE',
              referenceId: issue._id,
              assetId: issue.assetId,
              recipient: destination(issue.recipientAccountId),
              quantity: units(issue.quantityUnits),
              at: issue.createdAt,
              provenance: 'MIGRATED_POLICY',
            },
            session,
          );
        for (const entry of plan.entries) {
          const transfer = snapshot.transfers.find((row) => row._id.equals(entry.transferId))!;
          await custody.write(
            {
              kind: 'TRANSFER',
              referenceId: transfer._id,
              assetId: transfer.assetId,
              sender: destination(transfer.senderAccountId!),
              recipient: destination(transfer.recipientAccountId!),
              quantity: units(transfer.quantityUnits),
              at: transfer.committedAt!,
              provenance: 'MIGRATED_POLICY',
              maxInputLots: 1000,
            },
            session,
          );
        }
        for (const account of snapshot.accounts.filter((row) => row.ownerType === 'user')) {
          const lots = await custody.lots
            .find({ accountId: account._id, status: 'UNSPENT' }, { session })
            .toArray();
          if (
            lots.reduce((total, lot) => total + units(lot.quantityUnits), 0n) !==
            units(account.balanceUnits)
          )
            throw new Error('Migrated custody does not reconcile with preserved balance.');
        }
        await markers.insertOne({ _id: 'wallet-v2', policy, completedAt: new Date() }, { session });
        return {
          alreadyComplete: false,
          wallets: owners.size,
          migratedAssets: plan.legacyAssets.length,
        };
      },
      { ...TRANSACTION_OPTIONS, timeoutMS: 60000 },
    );
  } finally {
    await session.endSession();
  }
}
