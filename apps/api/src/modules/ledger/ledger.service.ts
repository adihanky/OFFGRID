import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { ObjectId, type ClientSession, type Long } from 'mongodb';
import { DatabaseService } from '../../database/database.service.js';
import { collectionSchema, oid, date, long } from '../accounts/schema.js';
import { MAX_UNITS, toLong, units } from '../accounts/quantity.js';
import type { AccountRecord, IssuanceRecord } from '../accounts/accounts.models.js';

export interface LedgerEntry {
  _id: ObjectId;
  referenceKind: 'transfer' | 'demoIssuance';
  referenceId: ObjectId;
  accountId: ObjectId;
  assetId: ObjectId;
  side: 'debit' | 'credit';
  quantityUnits: Long;
  createdAt: Date;
}
export interface JournalPair {
  referenceKind: 'transfer' | 'demoIssuance';
  referenceId: ObjectId;
  debitAccountId: ObjectId;
  creditAccountId: ObjectId;
  assetId: ObjectId;
  quantityUnits: bigint;
  createdAt: Date;
}
export function validatePair(pair: JournalPair) {
  if (
    pair.debitAccountId.equals(pair.creditAccountId) ||
    pair.quantityUnits <= 0n ||
    pair.quantityUnits > MAX_UNITS
  )
    throw new Error('Invalid balanced journal pair.');
}
@Injectable()
export class LedgerService implements OnModuleInit {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}
  get entries() {
    return this.database.db.collection<LedgerEntry>('ledgerEntries', { promoteLongs: false });
  }
  async onModuleInit() {
    await collectionSchema(this.database.db, 'ledgerEntries', {
      referenceKind: { enum: ['transfer', 'demoIssuance'] },
      referenceId: oid,
      accountId: oid,
      assetId: oid,
      side: { enum: ['debit', 'credit'] },
      quantityUnits: { ...long, minimum: toLong(1n) },
      createdAt: date,
    });
    await this.entries.createIndex(
      { referenceKind: 1, referenceId: 1, side: 1 },
      { unique: true, name: 'journal_reference_side' },
    );
    await this.entries.createIndex(
      { accountId: 1, createdAt: -1, _id: -1 },
      { name: 'journal_account_history' },
    );
  }
  async pair(pair: JournalPair, session: ClientSession) {
    validatePair(pair);
    for (const side of ['debit', 'credit'] as const)
      await this.entries.insertOne(
        {
          _id: new ObjectId(),
          referenceKind: pair.referenceKind,
          referenceId: pair.referenceId,
          accountId: side === 'debit' ? pair.debitAccountId : pair.creditAccountId,
          assetId: pair.assetId,
          side,
          quantityUnits: toLong(pair.quantityUnits),
          createdAt: pair.createdAt,
        },
        { session },
      );
  }
  async reconcile(): Promise<{ ok: boolean; issues: string[] }> {
    const issues: string[] = [];
    const session = this.database.client.startSession();
    try {
      await session.withTransaction(
        async () => {
          issues.length = 0;
          const accounts = await this.database.db
            .collection<AccountRecord>('accounts', { promoteLongs: false })
            .find({}, { session })
            .toArray();
          const entries = await this.entries.find({}, { session }).toArray();
          const sums = new Map<string, bigint>();
          const pairs = new Map<string, LedgerEntry[]>();
          for (const entry of entries) {
            const id = entry.accountId.toHexString();
            sums.set(
              id,
              (sums.get(id) ?? 0n) +
                (entry.side === 'credit' ? 1n : -1n) * units(entry.quantityUnits),
            );
            const key = `${entry.referenceKind}:${entry.referenceId}`;
            pairs.set(key, [...(pairs.get(key) ?? []), entry]);
            if (
              !accounts.some(
                (a) => a._id.equals(entry.accountId) && a.assetId.equals(entry.assetId),
              )
            )
              issues.push(`Unknown journal account ${entry._id}`);
          }
          for (const account of accounts)
            if ((sums.get(account._id.toHexString()) ?? 0n) !== units(account.balanceUnits))
              issues.push(`Balance mismatch ${account._id}`);
          for (const [key, pair] of pairs) {
            const debit = pair.find((e) => e.side === 'debit');
            const credit = pair.find((e) => e.side === 'credit');
            if (
              pair.length !== 2 ||
              !debit ||
              !credit ||
              !debit.assetId.equals(credit.assetId) ||
              debit.accountId.equals(credit.accountId) ||
              units(debit.quantityUnits) !== units(credit.quantityUnits)
            ) {
              issues.push(`Invalid journal ${key}`);
              continue;
            }
            if (debit.referenceKind === 'demoIssuance') {
              const ref = await this.database.db
                .collection<IssuanceRecord>('demoIssuances', { promoteLongs: false })
                .findOne({ _id: debit.referenceId }, { session });
              if (
                !ref ||
                !ref.assetId.equals(debit.assetId) ||
                !ref.systemAccountId.equals(debit.accountId) ||
                !ref.recipientAccountId.equals(credit.accountId) ||
                units(ref.quantityUnits) !== units(debit.quantityUnits)
              )
                issues.push(`Issuance mismatch ${key}`);
            } else {
              const ref = await this.database.db
                .collection('transfers', { promoteLongs: false })
                .findOne({ _id: debit.referenceId, status: 'COMMITTED' }, { session });
              if (
                !ref ||
                !ref['assetId'].equals(debit.assetId) ||
                !ref['senderAccountId'].equals(debit.accountId) ||
                !ref['recipientAccountId'].equals(credit.accountId) ||
                units(ref['quantityUnits']) !== units(debit.quantityUnits)
              )
                issues.push(`Transfer mismatch ${key}`);
            }
          }
          for (const [collection, kind, filter] of [
            ['demoIssuances', 'demoIssuance', {}],
            ['transfers', 'transfer', { status: 'COMMITTED' }],
          ] as const) {
            for (const ref of await this.database.db
              .collection(collection)
              .find(filter, { session })
              .toArray())
              if (!pairs.has(`${kind}:${ref._id}`))
                issues.push(`Missing journal ${kind}:${ref._id}`);
          }
        },
        { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, timeoutMS: 10000 },
      );
      return { ok: issues.length === 0, issues };
    } finally {
      await session.endSession();
    }
  }
}
