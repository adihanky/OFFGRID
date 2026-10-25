import type { MigrationAssessment, MigrationIssue } from '@p2p/contracts';
import { Long, ObjectId, type Db, type Document } from 'mongodb';
import { z } from 'zod';
import type { AccountRecord, AssetRecord, IssuanceRecord } from '../accounts/accounts.models.js';
import { units } from '../accounts/quantity.js';
import {
  canonicalChain,
  chainHash,
  GENESIS_HASH,
  type ChainEntry,
  type ChainHead,
} from '../chain/chain.service.js';
import type { LedgerEntry } from '../ledger/ledger.service.js';
import type { TransferRecord } from '../transfers/transfers.models.js';
import type { WalletBindingRecord, WalletRecord, RoleGrantRecord } from './wallets.models.js';

type User = { _id: ObjectId; status: 'active' | 'disabled' };
type MigratingAccount = AccountRecord & { walletId?: ObjectId };
export interface MigrationSnapshot {
  users: User[];
  wallets: WalletRecord[];
  walletBindings: WalletBindingRecord[];
  roleGrants: RoleGrantRecord[];
  assetTypes: AssetRecord[];
  accounts: MigratingAccount[];
  demoIssuances: IssuanceRecord[];
  transfers: TransferRecord[];
  ledgerEntries: LedgerEntry[];
  chainHeads: ChainHead[];
  chainEntries: ChainEntry[];
}
const oid = z.instanceof(ObjectId);
const long = z.instanceof(Long);
const date = z.date();
const status = z.enum(['active', 'disabled']);
const record = (shape: z.ZodRawShape) => z.object({ _id: oid, ...shape }).passthrough();
const validators = {
  users: record({ status }),
  wallets: record({
    schemaVersion: z.literal(2),
    userId: oid,
    status: z.enum(['ACTIVE', 'SUSPENDED']),
    eligibilityRevision: long,
    createdAt: date,
    updatedAt: date,
  }),
  walletBindings: record({
    schemaVersion: z.literal(2),
    walletId: oid,
    networkId: oid,
    normalizedAddress: z.string().regex(/^0x[0-9a-f]{40}$/),
    status: z.enum(['VERIFIED', 'REVOKED']),
    proofId: oid,
    verifiedAt: date,
    revision: long,
    createdAt: date,
    updatedAt: date,
  }),
  roleGrants: record({
    schemaVersion: z.literal(2),
    userId: oid,
    role: z.enum(['USER', 'ASSET_ADMIN', 'DEMO_OPERATOR', 'AUDITOR', 'ACCESS_ADMIN']),
    status: z.enum(['ACTIVE', 'REVOKED']),
    revision: long,
    createdAt: date,
    updatedAt: date,
  }),
  assetTypes: record({
    code: z.string(),
    displayName: z.string(),
    precision: z.number().int().min(0).max(8),
    status,
    createdAt: date,
  }),
  accounts: record({
    ownerType: z.enum(['user', 'system']),
    userId: oid.optional(),
    systemKey: z.string().optional(),
    walletId: oid.optional(),
    assetId: oid,
    balanceUnits: long,
    status,
    createdAt: date,
    updatedAt: date,
  }),
  demoIssuances: record({
    fixtureKey: z.string(),
    assetId: oid,
    systemAccountId: oid,
    recipientAccountId: oid,
    quantityUnits: long,
    createdAt: date,
  }),
  transfers: record({
    senderId: oid,
    recipientId: oid,
    assetId: oid,
    quantityUnits: long,
    payloadVersion: z.literal(1),
    payloadHash: z.string(),
    idempotencyKey: z.string(),
    status: z.enum(['PENDING', 'COMMITTED', 'REJECTED']),
    createdAt: date,
    updatedAt: date,
    senderAccountId: oid.optional(),
    recipientAccountId: oid.optional(),
    committedAt: date.optional(),
  }),
  ledgerEntries: record({
    referenceKind: z.enum(['demoIssuance', 'transfer']),
    referenceId: oid,
    accountId: oid,
    assetId: oid,
    side: z.enum(['debit', 'credit']),
    quantityUnits: long,
    createdAt: date,
  }),
  chainHeads: record({
    assetId: oid,
    latestSequence: long,
    latestHash: z.string(),
    transfersEnabled: z.boolean(),
  }),
  chainEntries: record({
    assetId: oid,
    sequence: long,
    transferId: oid,
    previousHash: z.string(),
    entryHash: z.string(),
    canonicalVersion: z.literal(1),
    canonicalPayload: z.string(),
    createdAt: date,
  }),
} satisfies Record<keyof MigrationSnapshot, z.ZodType>;

/** Pure preflight. It neither repairs data nor calls any domain writer. */
export function assessMigration(
  snapshot: MigrationSnapshot,
  assessedAt = new Date(),
  initialIssues: MigrationIssue[] = [],
): MigrationAssessment {
  const blockers = [...initialIssues];
  const issue = (code: string, collection: string, recordId?: ObjectId) =>
    blockers.push({ code, collection, ...(recordId ? { recordId: recordId.toHexString() } : {}) });
  const map = <T extends { _id: ObjectId }>(rows: T[]) =>
    new Map(rows.map((r) => [r._id.toHexString(), r]));
  const users = map(snapshot.users);
  const assets = map(snapshot.assetTypes);
  const accounts = map(snapshot.accounts);
  const wallets = map(snapshot.wallets);
  const walletOwners = new Map<string, WalletRecord>();
  for (const wallet of snapshot.wallets) {
    const owner = wallet.userId.toHexString();
    if (!users.has(owner)) issue('WALLET_OWNER_MISSING', 'wallets', wallet._id);
    if (walletOwners.has(owner)) issue('DUPLICATE_WALLET_OWNER', 'wallets', wallet._id);
    walletOwners.set(owner, wallet);
    if (units(wallet.eligibilityRevision) < 0n) issue('INVALID_REVISION', 'wallets', wallet._id);
  }
  const addresses = new Set<string>();
  const networks = new Set<string>();
  for (const binding of snapshot.walletBindings) {
    issue('EXTERNAL_BINDINGS_REQUIRE_ADAPTER_AUDIT', 'walletBindings', binding._id);
    if (!wallets.has(binding.walletId.toHexString()))
      issue('BINDING_WALLET_MISSING', 'walletBindings', binding._id);
    const addressKey = `${binding.networkId}:${binding.normalizedAddress}`;
    const networkKey = `${binding.walletId}:${binding.networkId}`;
    if (addresses.has(addressKey) || networks.has(networkKey))
      issue('DUPLICATE_BINDING_OWNERSHIP', 'walletBindings', binding._id);
    addresses.add(addressKey);
    networks.add(networkKey);
  }
  const roles = new Set<string>();
  for (const grant of snapshot.roleGrants) {
    const key = `${grant.userId}:${grant.role}`;
    if (!users.has(grant.userId.toHexString())) issue('ROLE_USER_MISSING', 'roleGrants', grant._id);
    if (roles.has(key)) issue('DUPLICATE_ROLE_GRANT', 'roleGrants', grant._id);
    roles.add(key);
  }
  const ownership = new Set<string>();
  const balanceTotals = new Map<string, { user: bigint; system: bigint; issued: bigint }>();
  for (const asset of snapshot.assetTypes)
    balanceTotals.set(asset._id.toHexString(), { user: 0n, system: 0n, issued: 0n });
  for (const account of snapshot.accounts) {
    const total = balanceTotals.get(account.assetId.toHexString());
    if (!total) issue('ACCOUNT_ASSET_MISSING', 'accounts', account._id);
    const balance = units(account.balanceUnits);
    if (account.ownerType === 'user') {
      if (!account.userId || account.systemKey || !users.has(account.userId.toHexString()))
        issue('ACCOUNT_OWNER_INVALID', 'accounts', account._id);
      if (balance < 0n) issue('NEGATIVE_USER_BALANCE', 'accounts', account._id);
      if (account.walletId) {
        const wallet = wallets.get(account.walletId.toHexString());
        if (!wallet || !wallet.userId.equals(account.userId!))
          issue('ACCOUNT_WALLET_CONFLICT', 'accounts', account._id);
      }
      if (total) total.user += balance;
    } else {
      if (
        account.userId ||
        account.walletId ||
        account.systemKey !== 'demo-issuance' ||
        balance > 0n
      )
        issue('SYSTEM_ACCOUNT_INVALID', 'accounts', account._id);
      if (total) total.system += balance;
    }
    const owner = `${account.ownerType}:${account.userId ?? account.systemKey}:${account.assetId}`;
    if (ownership.has(owner)) issue('DUPLICATE_ACCOUNT_OWNER', 'accounts', account._id);
    ownership.add(owner);
  }
  const sums = new Map<string, bigint>();
  const pairs = new Map<string, LedgerEntry[]>();
  for (const entry of snapshot.ledgerEntries) {
    const account = accounts.get(entry.accountId.toHexString());
    if (!account || !account.assetId.equals(entry.assetId))
      issue('JOURNAL_ACCOUNT_INVALID', 'ledgerEntries', entry._id);
    if (units(entry.quantityUnits) <= 0n)
      issue('JOURNAL_QUANTITY_INVALID', 'ledgerEntries', entry._id);
    const key = `${entry.referenceKind}:${entry.referenceId}`;
    pairs.set(key, [...(pairs.get(key) ?? []), entry]);
    const id = entry.accountId.toHexString();
    sums.set(
      id,
      (sums.get(id) ?? 0n) + (entry.side === 'credit' ? 1n : -1n) * units(entry.quantityUnits),
    );
  }
  for (const account of snapshot.accounts)
    if ((sums.get(account._id.toHexString()) ?? 0n) !== units(account.balanceUnits))
      issue('BALANCE_JOURNAL_MISMATCH', 'accounts', account._id);
  const transfers = map(snapshot.transfers);
  const issuances = map(snapshot.demoIssuances);
  for (const [key, pair] of pairs) {
    const debit = pair.find((r) => r.side === 'debit');
    const credit = pair.find((r) => r.side === 'credit');
    if (
      !debit ||
      !credit ||
      pair.length !== 2 ||
      !debit.assetId.equals(credit.assetId) ||
      debit.accountId.equals(credit.accountId) ||
      units(debit.quantityUnits) !== units(credit.quantityUnits)
    ) {
      issue('JOURNAL_PAIR_INVALID', 'ledgerEntries', pair[0]!._id);
      continue;
    }
    const ref =
      debit.referenceKind === 'transfer'
        ? transfers.get(debit.referenceId.toHexString())
        : issuances.get(debit.referenceId.toHexString());
    const sender = ref && ('systemAccountId' in ref ? ref.systemAccountId : ref.senderAccountId);
    const recipient = ref?.recipientAccountId;
    if (
      !ref ||
      ('status' in ref && ref.status !== 'COMMITTED') ||
      !sender?.equals(debit.accountId) ||
      !recipient?.equals(credit.accountId) ||
      !ref.assetId.equals(debit.assetId) ||
      units(ref.quantityUnits) !== units(debit.quantityUnits)
    )
      issue(
        'JOURNAL_REFERENCE_INVALID',
        key.split(':')[0] === 'transfer' ? 'transfers' : 'demoIssuances',
        debit.referenceId,
      );
  }
  const issuanceKeys = new Set<string>();
  for (const ref of snapshot.demoIssuances) {
    const total = balanceTotals.get(ref.assetId.toHexString());
    if (!total || units(ref.quantityUnits) <= 0n)
      issue('ISSUANCE_INVALID', 'demoIssuances', ref._id);
    if (total) total.issued += units(ref.quantityUnits);
    if (!pairs.has(`demoIssuance:${ref._id}`)) issue('JOURNAL_MISSING', 'demoIssuances', ref._id);
    if (issuanceKeys.has(ref.fixtureKey)) issue('DUPLICATE_ISSUANCE_KEY', 'demoIssuances', ref._id);
    issuanceKeys.add(ref.fixtureKey);
  }
  const requestKeys = new Set<string>();
  for (const transfer of snapshot.transfers) {
    const key = `${transfer.senderId}:${transfer.idempotencyKey}`;
    if (requestKeys.has(key)) issue('DUPLICATE_REQUEST_KEY', 'transfers', transfer._id);
    requestKeys.add(key);
    if (transfer.status === 'PENDING') issue('PENDING_TRANSFER', 'transfers', transfer._id);
    if (transfer.status !== 'COMMITTED') continue;
    const sender = transfer.senderAccountId && accounts.get(transfer.senderAccountId.toHexString());
    const recipient =
      transfer.recipientAccountId && accounts.get(transfer.recipientAccountId.toHexString());
    if (
      !assets.has(transfer.assetId.toHexString()) ||
      !sender?.userId?.equals(transfer.senderId) ||
      !recipient?.userId?.equals(transfer.recipientId) ||
      transfer.senderId.equals(transfer.recipientId) ||
      !transfer.committedAt ||
      units(transfer.quantityUnits) <= 0n
    )
      issue('TRANSFER_PARTICIPANTS_INVALID', 'transfers', transfer._id);
    if (!pairs.has(`transfer:${transfer._id}`)) issue('JOURNAL_MISSING', 'transfers', transfer._id);
  }
  const seenTransfers = new Set<string>();
  const heads = new Map<string, ChainHead>();
  for (const head of snapshot.chainHeads) {
    const key = head.assetId.toHexString();
    if (heads.has(key) || !assets.has(key)) issue('CHAIN_HEAD_INVALID', 'chainHeads', head._id);
    heads.set(key, head);
  }
  // Replay with all issuance roots available first. This proves feasibility under
  // a declared migration policy, never historical interleaving or unit lineage.
  const replay = new Map<string, bigint>();
  for (const issuance of snapshot.demoIssuances) {
    const key = issuance.recipientAccountId.toHexString();
    replay.set(key, (replay.get(key) ?? 0n) + units(issuance.quantityUnits));
  }
  const ordered = new Map<string, ChainEntry[]>();
  for (const entry of snapshot.chainEntries) {
    const key = entry.assetId.toHexString();
    ordered.set(key, [...(ordered.get(key) ?? []), entry]);
    if (!heads.has(key)) issue('CHAIN_HEAD_MISSING', 'chainEntries', entry._id);
  }
  for (const asset of snapshot.assetTypes) {
    const key = asset._id.toHexString();
    const head = heads.get(key);
    if (!head) issue('CHAIN_HEAD_MISSING', 'assetTypes', asset._id);
    let sequence = 0n;
    let hash = GENESIS_HASH;
    const entries = (ordered.get(key) ?? []).sort((a, b) =>
      units(a.sequence) < units(b.sequence) ? -1 : units(a.sequence) > units(b.sequence) ? 1 : 0,
    );
    for (const entry of entries) {
      sequence++;
      const transfer = transfers.get(entry.transferId.toHexString());
      if (
        units(entry.sequence) !== sequence ||
        entry.previousHash !== hash ||
        chainHash(entry.canonicalPayload) !== entry.entryHash ||
        entry.canonicalVersion !== 1
      )
        issue('CHAIN_LINK_INVALID', 'chainEntries', entry._id);
      if (seenTransfers.has(entry.transferId.toHexString()))
        issue('CHAIN_TRANSFER_DUPLICATED', 'chainEntries', entry._id);
      seenTransfers.add(entry.transferId.toHexString());
      if (
        !transfer ||
        transfer.status !== 'COMMITTED' ||
        !transfer.committedAt ||
        !transfer.senderAccountId ||
        !transfer.recipientAccountId ||
        !transfer.assetId.equals(entry.assetId)
      )
        issue('CHAIN_TRANSFER_INVALID', 'chainEntries', entry._id);
      else {
        if (
          entry.canonicalPayload !==
          canonicalChain({
            sequence: units(entry.sequence),
            transferId: transfer._id.toHexString(),
            senderAccountId: transfer.senderAccountId.toHexString(),
            recipientAccountId: transfer.recipientAccountId.toHexString(),
            assetId: key,
            quantityUnits: units(transfer.quantityUnits),
            committedAt: transfer.committedAt,
            previousHash: entry.previousHash,
          })
        )
          issue('CHAIN_PAYLOAD_MISMATCH', 'chainEntries', entry._id);
        const sender = transfer.senderAccountId.toHexString();
        const recipient = transfer.recipientAccountId.toHexString();
        const quantity = units(transfer.quantityUnits);
        if ((replay.get(sender) ?? 0n) < quantity)
          issue('PROVENANCE_REPLAY_OVERSPEND', 'transfers', transfer._id);
        replay.set(sender, (replay.get(sender) ?? 0n) - quantity);
        replay.set(recipient, (replay.get(recipient) ?? 0n) + quantity);
      }
      hash = entry.entryHash;
    }
    if (head && (units(head.latestSequence) !== sequence || head.latestHash !== hash))
      issue('CHAIN_HEAD_MISMATCH', 'chainHeads', head._id);
  }
  for (const transfer of snapshot.transfers)
    if (transfer.status === 'COMMITTED' && !seenTransfers.has(transfer._id.toHexString()))
      issue('CHAIN_ENTRY_MISSING', 'transfers', transfer._id);
  for (const account of snapshot.accounts)
    if (
      account.ownerType === 'user' &&
      (replay.get(account._id.toHexString()) ?? 0n) !== units(account.balanceUnits)
    )
      issue('PROVENANCE_BALANCE_MISMATCH', 'accounts', account._id);
  const assetReports: MigrationAssessment['assets'] = [];
  for (const [assetId, total] of balanceTotals) {
    if (total.user + total.system !== 0n || total.issued !== total.user)
      issue('SUPPLY_MISMATCH', 'assetTypes', new ObjectId(assetId));
    assetReports.push({
      assetId,
      userUnits: total.user.toString(),
      systemUnits: total.system.toString(),
      issuedUnits: total.issued.toString(),
      provenance: blockers.length
        ? 'INVALID'
        : total.issued === 0n
          ? 'EMPTY'
          : 'MIGRATED_POLICY_REQUIRED',
    });
  }
  const policyRequirements = snapshot.demoIssuances.length
    ? ['ISSUANCE_FIRST_THEN_CHAIN_ORDER_MIGRATED_POLICY']
    : [];
  return {
    reportVersion: 1,
    assessedAt: assessedAt.toISOString(),
    snapshot: true,
    targetSchemaVersion: 2,
    state: blockers.length
      ? 'BLOCKED'
      : policyRequirements.length
        ? 'POLICY_REQUIRED'
        : 'READY_FOR_BACKFILL',
    cutoverEnabled: false,
    counts: {
      users: snapshot.users.length,
      wallets: snapshot.wallets.length,
      usersWithoutWallets: snapshot.users.filter((u) => !walletOwners.has(u._id.toHexString()))
        .length,
      userAccountsWithoutWallets: snapshot.accounts.filter(
        (a) => a.ownerType === 'user' && !a.walletId,
      ).length,
      legacyAssets: snapshot.assetTypes.filter(
        (a) => !('schemaVersion' in a) || a.schemaVersion !== 2,
      ).length,
      pendingTransfers: snapshot.transfers.filter((t) => t.status === 'PENDING').length,
      issuances: snapshot.demoIssuances.length,
      committedTransfers: snapshot.transfers.filter((t) => t.status === 'COMMITTED').length,
    },
    assets: assetReports,
    blockers,
    policyRequirements,
    collections: [],
  };
}

/** Uses only find/list operations in a read-only snapshot transaction. No app
 * bootstrap, collection/index creation, worker, grant, wallet or repair writes. */
export async function readMigrationAssessment(db: Db): Promise<MigrationAssessment> {
  const snapshot = {} as MigrationSnapshot;
  const issues: MigrationIssue[] = [];
  const session = db.client.startSession();
  let assessedAt = new Date();
  try {
    await session.withTransaction(
      async () => {
        issues.length = 0;
        assessedAt = new Date();
        for (const name of Object.keys(validators) as Array<keyof MigrationSnapshot>) {
          const rows = await db
            .collection(name, { promoteLongs: false })
            .find({}, { session })
            .limit(50001)
            .toArray();
          if (rows.length > 50000)
            throw new Error(
              `Assessment limit exceeded for ${name}; use a bounded offline migration tool.`,
            );
          const valid: Document[] = [];
          for (const row of rows) {
            const result = validators[name].safeParse(row);
            if (result.success) valid.push(row);
            else
              issues.push({
                code: 'INVALID_RECORD_SCHEMA',
                collection: name,
                ...(row._id instanceof ObjectId ? { recordId: row._id.toHexString() } : {}),
              });
          }
          // Each collection's records have been validated by its matching parser.
          Object.assign(snapshot, { [name]: valid });
        }
      },
      { readConcern: { level: 'snapshot' }, readPreference: 'primary', timeoutMS: 30000 },
    );
  } finally {
    await session.endSession();
  }
  const report = assessMigration(snapshot, assessedAt, issues);
  // Catalog metadata is advisory and read after the data snapshot; rerun preflight
  // under maintenance immediately before any separately authorized cutover.
  for (const name of Object.keys(validators)) {
    const info = await db.listCollections({ name }, { nameOnly: false }).toArray();
    const indexes = info.length ? await db.collection(name).listIndexes().toArray() : [];
    report.collections.push({
      name,
      validatorPresent: Boolean(info[0]?.options?.validator),
      indexes: indexes.map((i) => ({ name: i.name ?? '', key: i.key, unique: i.unique === true })),
    });
  }
  return report;
}
