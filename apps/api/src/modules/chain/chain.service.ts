import { createHash } from 'node:crypto';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { ObjectId, type ClientSession, type Long } from 'mongodb';
import { DatabaseService } from '../../database/database.service.js';
import { collectionSchema, date, long, oid, text } from '../accounts/schema.js';
import { MAX_UNITS, toLong, units } from '../accounts/quantity.js';
import { BusinessRejection, type TransferRecord } from '../transfers/transfers.models.js';
import type { LedgerEntry } from '../ledger/ledger.service.js';
import { verificationRows } from '../ledger/verification-budget.js';
export const GENESIS_HASH = '0'.repeat(64);
export interface ChainHead {
  _id: ObjectId;
  assetId: ObjectId;
  latestSequence: Long;
  latestHash: string;
  transfersEnabled: boolean;
}
export interface ChainEntry {
  _id: ObjectId;
  assetId: ObjectId;
  sequence: Long;
  transferId: ObjectId;
  previousHash: string;
  entryHash: string;
  canonicalVersion: 1;
  canonicalPayload: string;
  createdAt: Date;
}
export interface ChainPayload {
  sequence: bigint;
  transferId: string;
  senderAccountId: string;
  recipientAccountId: string;
  assetId: string;
  quantityUnits: bigint;
  committedAt: Date;
  previousHash: string;
}
export function canonicalChain(value: ChainPayload) {
  return JSON.stringify([
    1,
    value.sequence.toString(),
    value.transferId,
    value.senderAccountId,
    value.recipientAccountId,
    value.assetId,
    value.quantityUnits.toString(),
    value.committedAt.toISOString(),
    value.previousHash,
  ]);
}
export const chainHash = (payload: string) =>
  createHash('sha256').update(payload, 'utf8').digest('hex');
@Injectable()
export class ChainService implements OnModuleInit {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}
  get heads() {
    return this.database.db.collection<ChainHead>('chainHeads', { promoteLongs: false });
  }
  get entries() {
    return this.database.db.collection<ChainEntry>('chainEntries', { promoteLongs: false });
  }
  async onModuleInit() {
    await collectionSchema(this.database.db, 'chainHeads', {
      assetId: oid,
      latestSequence: { ...long, minimum: toLong(0n) },
      latestHash: text,
      transfersEnabled: { bsonType: 'bool' },
    });
    await collectionSchema(this.database.db, 'chainEntries', {
      assetId: oid,
      sequence: { ...long, minimum: toLong(1n) },
      transferId: oid,
      previousHash: text,
      entryHash: text,
      canonicalVersion: { enum: [1] },
      canonicalPayload: text,
      createdAt: date,
    });
    await this.heads.createIndex({ assetId: 1 }, { unique: true, name: 'chain_head_asset' });
    await this.entries.createIndex(
      { assetId: 1, sequence: 1 },
      { unique: true, name: 'chain_asset_sequence' },
    );
    await this.entries.createIndex({ transferId: 1 }, { unique: true, name: 'chain_transfer' });
  }
  async append(
    transfer: TransferRecord,
    senderAccountId: ObjectId,
    recipientAccountId: ObjectId,
    committedAt: Date,
    session: ClientSession,
  ) {
    const asset = await this.database.db
      .collection('assetTypes')
      .findOne({ _id: transfer.assetId, status: 'active' }, { session });
    const head = await this.heads.findOne(
      { assetId: transfer.assetId, transfersEnabled: true },
      { session },
    );
    if (!asset || !head) throw new BusinessRejection('ASSET_UNAVAILABLE');
    const quantity = units(transfer.quantityUnits);
    if (
      quantity < units(asset['minimumUnits'] ?? toLong(1n)) ||
      quantity > units(asset['maximumUnits'] ?? toLong(MAX_UNITS))
    )
      throw new BusinessRejection('QUANTITY_LIMIT_EXCEEDED');
    const sequence = units(head.latestSequence) + 1n;
    if (sequence > MAX_UNITS) throw new Error('Chain sequence exhausted.');
    const canonicalPayload = canonicalChain({
      sequence,
      transferId: transfer._id.toHexString(),
      senderAccountId: senderAccountId.toHexString(),
      recipientAccountId: recipientAccountId.toHexString(),
      assetId: transfer.assetId.toHexString(),
      quantityUnits: units(transfer.quantityUnits),
      committedAt,
      previousHash: head.latestHash,
    });
    const entryHash = chainHash(canonicalPayload);
    if (
      (
        await this.heads.updateOne(
          {
            _id: head._id,
            latestSequence: head.latestSequence,
            latestHash: head.latestHash,
            transfersEnabled: true,
          },
          { $set: { latestSequence: toLong(sequence), latestHash: entryHash } },
          { session },
        )
      ).modifiedCount !== 1
    )
      throw new Error('Chain head conflict.');
    await this.entries.insertOne(
      {
        _id: new ObjectId(),
        assetId: transfer.assetId,
        sequence: toLong(sequence),
        transferId: transfer._id,
        previousHash: head.latestHash,
        entryHash,
        canonicalVersion: 1,
        canonicalPayload,
        createdAt: committedAt,
      },
      { session },
    );
  }
  async verify(assetId?: ObjectId, maximum?: number): Promise<{ ok: boolean; issues: string[] }> {
    const issues: string[] = [];
    const session = this.database.client.startSession();
    try {
      await session.withTransaction(
        async () => {
          issues.length = 0;
          const heads = await verificationRows(
            this.heads.find(assetId ? { assetId } : {}, { session }),
            maximum,
          );
          const entries = await verificationRows(
            this.entries.find(assetId ? { assetId } : {}, { session }).sort({ sequence: 1 }),
            maximum,
          );
          const transfers = await verificationRows(
            this.database.db
              .collection<TransferRecord>('transfers', { promoteLongs: false })
              .find({ status: 'COMMITTED', ...(assetId ? { assetId } : {}) }, { session }),
            maximum,
          );
          for (const head of heads) {
            let sequence = 0n;
            let hash = GENESIS_HASH;
            for (const entry of entries.filter((e) => e.assetId.equals(head.assetId))) {
              sequence++;
              if (
                units(entry.sequence) !== sequence ||
                entry.previousHash !== hash ||
                chainHash(entry.canonicalPayload) !== entry.entryHash ||
                entry.canonicalVersion !== 1
              )
                issues.push(`Broken chain ${entry._id}`);
              const transfer = transfers.find((t) => t._id.equals(entry.transferId));
              const journal = await verificationRows(
                this.database.db
                  .collection<LedgerEntry>('ledgerEntries', { promoteLongs: false })
                  .find({ referenceKind: 'transfer', referenceId: entry.transferId }, { session }),
                maximum,
              );
              const debit = journal.find((e) => e.side === 'debit');
              const credit = journal.find((e) => e.side === 'credit');
              if (
                !transfer?.committedAt ||
                !transfer.senderAccountId ||
                !transfer.recipientAccountId ||
                !transfer.assetId.equals(entry.assetId) ||
                journal.length !== 2 ||
                !debit ||
                !credit ||
                !debit.accountId.equals(transfer.senderAccountId) ||
                !credit.accountId.equals(transfer.recipientAccountId) ||
                !debit.assetId.equals(entry.assetId) ||
                !credit.assetId.equals(entry.assetId) ||
                units(debit.quantityUnits) !== units(transfer.quantityUnits) ||
                units(credit.quantityUnits) !== units(transfer.quantityUnits)
              )
                issues.push(`Missing or mismatched transfer/journal ${entry.transferId}`);
              else if (
                entry.canonicalPayload !==
                canonicalChain({
                  sequence: units(entry.sequence),
                  transferId: transfer._id.toHexString(),
                  senderAccountId: transfer.senderAccountId.toHexString(),
                  recipientAccountId: transfer.recipientAccountId.toHexString(),
                  assetId: transfer.assetId.toHexString(),
                  quantityUnits: units(transfer.quantityUnits),
                  committedAt: transfer.committedAt,
                  previousHash: entry.previousHash,
                })
              )
                issues.push(`Payload mismatch ${entry._id}`);
              hash = entry.entryHash;
            }
            if (units(head.latestSequence) !== sequence || head.latestHash !== hash)
              issues.push(`Head mismatch ${head.assetId}`);
          }
          for (const transfer of transfers)
            if (!entries.some((e) => e.transferId.equals(transfer._id)))
              issues.push(`Missing chain ${transfer._id}`);
          for (const entry of entries)
            if (!heads.some((h) => h.assetId.equals(entry.assetId)))
              issues.push(`Missing head ${entry.assetId}`);
        },
        { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, timeoutMS: 10000 },
      );
      return { ok: issues.length === 0, issues };
    } finally {
      await session.endSession();
    }
  }
}
