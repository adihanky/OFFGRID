import { createHash } from 'node:crypto';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { ObjectId, type ClientSession, type Long } from 'mongodb';
import { DatabaseService } from '../../database/database.service.js';
import { collectionSchema, date, long, oid, text } from '../accounts/schema.js';
import { toLong, units } from '../accounts/quantity.js';
export class CustodyLimitExceeded extends Error {
  readonly code = 'LOT_LIMIT_EXCEEDED';
}

export interface CustodyLot {
  _id: ObjectId;
  schemaVersion: 2;
  assetId: ObjectId;
  walletId: ObjectId;
  accountId: ObjectId;
  quantityUnits: Long;
  createdEventId: ObjectId;
  createdOrder: Long;
  status: 'UNSPENT' | 'SPENT';
  spentEventId?: ObjectId;
  createdAt: Date;
}
interface CustodyEvent {
  _id: ObjectId;
  schemaVersion: 2;
  assetId: ObjectId;
  kind: 'ISSUE' | 'TRANSFER';
  referenceKind: 'demoIssuance' | 'transfer';
  referenceId: ObjectId;
  sequence: Long;
  previousHash: string;
  hash: string;
  canonicalPayload: string;
  walletIds: ObjectId[];
  createdAt: Date;
  provenance?: 'MIGRATED_POLICY';
}
interface CustodyEdge {
  _id: ObjectId;
  schemaVersion: 2;
  eventId: ObjectId;
  inputLotId: ObjectId;
  outputLotId: ObjectId;
  quantityUnits: Long;
}
interface CustodyHead {
  _id: ObjectId;
  assetId: ObjectId;
  sequence: Long;
  hash: string;
}
export interface LotAllocation {
  inputId: string;
  recipientUnits: bigint;
  changeUnits: bigint;
}
/** FIFO order is supplied by the indexed query. Never truncate an amount to fit a limit. */
export function allocateLots(
  inputs: Array<{ id: string; quantity: bigint }>,
  quantity: bigint,
  limit: number,
): LotAllocation[] {
  if (quantity <= 0n || !Number.isInteger(limit) || limit < 1 || limit > 1000)
    throw new Error('Invalid custody allocation.');
  const result: LotAllocation[] = [];
  let needed = quantity;
  const ids = new Set<string>();
  for (const lot of inputs) {
    if (needed === 0n) break;
    if (lot.quantity <= 0n || ids.has(lot.id)) throw new Error('Invalid custody input lot.');
    if (result.length >= limit) throw new CustodyLimitExceeded('Custody input lot limit exceeded.');
    ids.add(lot.id);
    const recipientUnits = lot.quantity < needed ? lot.quantity : needed;
    result.push({ inputId: lot.id, recipientUnits, changeUnits: lot.quantity - recipientUnits });
    needed -= recipientUnits;
  }
  if (needed > 0n) throw new Error('Custody balance requires reconciliation.');
  return result;
}
const hash = (payload: string) => createHash('sha256').update(payload).digest('hex');
@Injectable()
export class CustodyService implements OnModuleInit {
  constructor(@Inject(DatabaseService) readonly database: DatabaseService) {}
  get lots() {
    return this.database.db.collection<CustodyLot>('custodyLots', { promoteLongs: false });
  }
  get events() {
    return this.database.db.collection<CustodyEvent>('custodyEvents', { promoteLongs: false });
  }
  get edges() {
    return this.database.db.collection<CustodyEdge>('custodyEdges', { promoteLongs: false });
  }
  get heads() {
    return this.database.db.collection<CustodyHead>('custodyHeads', { promoteLongs: false });
  }
  async onModuleInit() {
    const schemaVersion = { enum: [2] };
    await collectionSchema(
      this.database.db,
      'custodyLots',
      {
        schemaVersion,
        assetId: oid,
        walletId: oid,
        accountId: oid,
        quantityUnits: { ...long, minimum: toLong(1n) },
        createdEventId: oid,
        createdOrder: long,
        status: { enum: ['UNSPENT', 'SPENT'] },
        spentEventId: oid,
        createdAt: date,
      },
      [
        'schemaVersion',
        'assetId',
        'walletId',
        'accountId',
        'quantityUnits',
        'createdEventId',
        'createdOrder',
        'status',
        'createdAt',
      ],
      {
        additionalProperties: false,
        oneOf: [
          { properties: { status: { enum: ['UNSPENT'] } }, not: { required: ['spentEventId'] } },
          { properties: { status: { enum: ['SPENT'] } }, required: ['spentEventId'] },
        ],
      },
    );
    await this.lots.createIndex(
      { walletId: 1, assetId: 1, status: 1, createdOrder: 1, _id: 1 },
      { name: 'custody_fifo' },
    );
    await this.lots.createIndex({ createdEventId: 1 }, { name: 'custody_output_event' });
    await collectionSchema(
      this.database.db,
      'custodyEvents',
      {
        schemaVersion,
        assetId: oid,
        kind: { enum: ['ISSUE', 'TRANSFER'] },
        referenceKind: { enum: ['demoIssuance', 'transfer'] },
        referenceId: oid,
        sequence: long,
        previousHash: text,
        hash: text,
        canonicalPayload: text,
        provenance: { enum: ['MIGRATED_POLICY'] },
        walletIds: { bsonType: 'array', items: oid },
        createdAt: date,
      },
      [
        'schemaVersion',
        'assetId',
        'kind',
        'referenceKind',
        'referenceId',
        'sequence',
        'previousHash',
        'hash',
        'canonicalPayload',
        'walletIds',
        'createdAt',
      ],
      { additionalProperties: false },
    );
    await this.events.createIndex(
      { referenceKind: 1, referenceId: 1 },
      { unique: true, name: 'custody_reference' },
    );
    await this.events.createIndex(
      { assetId: 1, sequence: 1 },
      { unique: true, name: 'custody_sequence' },
    );
    await this.events.createIndex(
      { walletIds: 1, createdAt: -1, _id: -1 },
      { name: 'custody_participant' },
    );
    await collectionSchema(
      this.database.db,
      'custodyEdges',
      {
        schemaVersion,
        eventId: oid,
        inputLotId: oid,
        outputLotId: oid,
        quantityUnits: { ...long, minimum: toLong(1n) },
      },
      undefined,
      { additionalProperties: false },
    );
    await this.edges.createIndex(
      { eventId: 1, inputLotId: 1, outputLotId: 1 },
      { unique: true, name: 'custody_allocation' },
    );
    await this.edges.createIndex({ inputLotId: 1 }, { name: 'custody_input' });
    await this.edges.createIndex({ outputLotId: 1 }, { name: 'custody_output' });
    await collectionSchema(
      this.database.db,
      'custodyHeads',
      { assetId: oid, sequence: long, hash: text },
      undefined,
      { additionalProperties: false },
    );
    await this.heads.createIndex({ assetId: 1 }, { unique: true, name: 'custody_head' });
  }
  async write(
    input: {
      kind: 'ISSUE' | 'TRANSFER';
      referenceId: ObjectId;
      assetId: ObjectId;
      recipient: { walletId: ObjectId; accountId: ObjectId };
      quantity: bigint;
      sender?: { walletId: ObjectId; accountId: ObjectId };
      at: Date;
      maxInputLots?: number;
      provenance?: 'MIGRATED_POLICY';
    },
    session: ClientSession,
  ) {
    const head = await this.heads.findOne({ assetId: input.assetId }, { session });
    if (!head) throw new Error('Custody head missing; migration required.');
    const sequence = toLong(units(head.sequence) + 1n);
    const eventId = new ObjectId();
    const lot = (walletId: ObjectId, accountId: ObjectId, quantity: bigint): CustodyLot => ({
      _id: new ObjectId(),
      schemaVersion: 2,
      assetId: input.assetId,
      walletId,
      accountId,
      quantityUnits: toLong(quantity),
      createdEventId: eventId,
      createdOrder: sequence,
      status: 'UNSPENT',
      createdAt: input.at,
    });
    const recipient = lot(input.recipient.walletId, input.recipient.accountId, input.quantity);
    const outputs: CustodyLot[] = [recipient];
    const edges: CustodyEdge[] = [];
    let inputs: CustodyLot[] = [];
    if (input.kind === 'TRANSFER') {
      if (!input.sender || input.sender.walletId.equals(input.recipient.walletId))
        throw new Error('Invalid custody participants.');
      const max = input.maxInputLots ?? 100;
      const candidates = await this.lots
        .find(
          {
            walletId: input.sender.walletId,
            accountId: input.sender.accountId,
            assetId: input.assetId,
            status: 'UNSPENT',
          },
          { session },
        )
        .sort({ createdOrder: 1, _id: 1 })
        .limit(max + 1)
        .toArray();
      const allocations = allocateLots(
        candidates.map((c) => ({ id: c._id.toHexString(), quantity: units(c.quantityUnits) })),
        input.quantity,
        max,
      );
      inputs = candidates.slice(0, allocations.length);
      const changeQuantity = allocations.reduce((sum, a) => sum + a.changeUnits, 0n);
      const change = changeQuantity
        ? lot(input.sender.walletId, input.sender.accountId, changeQuantity)
        : null;
      if (change) outputs.push(change);
      for (const allocation of allocations) {
        const edge = (output: CustodyLot, quantity: bigint): CustodyEdge => ({
          _id: new ObjectId(),
          schemaVersion: 2,
          eventId,
          inputLotId: new ObjectId(allocation.inputId),
          outputLotId: output._id,
          quantityUnits: toLong(quantity),
        });
        edges.push(edge(recipient, allocation.recipientUnits));
        if (change && allocation.changeUnits > 0n) edges.push(edge(change, allocation.changeUnits));
      }
    }
    const canonicalPayload = JSON.stringify([
      2,
      input.kind,
      input.assetId.toHexString(),
      input.referenceId.toHexString(),
      sequence.toString(),
      head.hash,
      input.at.toISOString(),
      inputs.map((l) => [l._id.toHexString(), l.quantityUnits.toString()]),
      outputs.map((l) => [
        l._id.toHexString(),
        l.walletId.toHexString(),
        l.accountId.toHexString(),
        l.quantityUnits.toString(),
      ]),
      edges.map((e) => [
        e.inputLotId.toHexString(),
        e.outputLotId.toHexString(),
        e.quantityUnits.toString(),
      ]),
      ...(input.provenance ? [input.provenance] : []),
    ]);
    const eventHash = hash(canonicalPayload);
    const updated = await this.heads.updateOne(
      { _id: head._id, sequence: head.sequence, hash: head.hash },
      { $set: { sequence, hash: eventHash } },
      { session },
    );
    if (updated.modifiedCount !== 1) throw new Error('Custody head conflict.');
    for (const consumed of inputs) {
      if (
        (
          await this.lots.updateOne(
            { _id: consumed._id, status: 'UNSPENT' },
            { $set: { status: 'SPENT', spentEventId: eventId } },
            { session },
          )
        ).modifiedCount !== 1
      )
        throw new Error('Custody double spend.');
    }
    for (const output of outputs) await this.lots.insertOne(output, { session });
    for (const edge of edges) await this.edges.insertOne(edge, { session });
    await this.events.insertOne(
      {
        _id: eventId,
        schemaVersion: 2,
        assetId: input.assetId,
        kind: input.kind,
        referenceKind: input.kind === 'ISSUE' ? 'demoIssuance' : 'transfer',
        referenceId: input.referenceId,
        sequence,
        previousHash: head.hash,
        hash: eventHash,
        canonicalPayload,
        walletIds: input.sender
          ? [input.sender.walletId, input.recipient.walletId]
          : [input.recipient.walletId],
        createdAt: input.at,
        ...(input.provenance ? { provenance: input.provenance } : {}),
      },
      { session },
    );
  }
  async verify() {
    const session = this.database.client.startSession();
    const issues: string[] = [];
    try {
      await session.withTransaction(
        async () => {
          issues.length = 0;
          const lots = await this.lots.find({}, { session }).sort({ _id: 1 }).toArray();
          const events = await this.events.find({}, { session }).sort({ sequence: 1 }).toArray();
          const edges = await this.edges.find({}, { session }).sort({ _id: 1 }).toArray();
          const heads = await this.heads.find({}, { session }).toArray();
          const accountsById = new Map(
            (
              await this.database.db
                .collection('accounts', { promoteLongs: false })
                .find({}, { session })
                .toArray()
            ).map((a) => [a._id.toHexString(), a]),
          );
          for (const head of heads) {
            let sequence = 0n;
            let previous = '0'.repeat(64);
            for (const event of events.filter((e) => e.assetId.equals(head.assetId))) {
              sequence++;
              if (
                units(event.sequence) !== sequence ||
                event.previousHash !== previous ||
                hash(event.canonicalPayload) !== event.hash
              )
                issues.push(`Custody hash mismatch ${event._id}`);
              const inputs = lots.filter((l) => l.spentEventId?.equals(event._id));
              const outputs = lots.filter((l) => l.createdEventId.equals(event._id));
              const allocations = edges.filter((e) => e.eventId.equals(event._id));
              if (
                event.kind === 'TRANSFER' &&
                inputs.reduce((sum, l) => sum + units(l.quantityUnits), 0n) !==
                  outputs.reduce((sum, l) => sum + units(l.quantityUnits), 0n)
              )
                issues.push(`Custody conservation mismatch ${event._id}`);
              const expected = JSON.stringify([
                2,
                event.kind,
                event.assetId.toHexString(),
                event.referenceId.toHexString(),
                event.sequence.toString(),
                event.previousHash,
                event.createdAt.toISOString(),
                inputs
                  .sort((a, b) =>
                    units(a.createdOrder) < units(b.createdOrder)
                      ? -1
                      : units(a.createdOrder) > units(b.createdOrder)
                        ? 1
                        : a._id.toHexString().localeCompare(b._id.toHexString()),
                  )
                  .map((l) => [l._id.toHexString(), l.quantityUnits.toString()]),
                outputs.map((l) => [
                  l._id.toHexString(),
                  l.walletId.toHexString(),
                  l.accountId.toHexString(),
                  l.quantityUnits.toString(),
                ]),
                allocations.map((e) => [
                  e.inputLotId.toHexString(),
                  e.outputLotId.toHexString(),
                  e.quantityUnits.toString(),
                ]),
                ...(event.provenance ? [event.provenance] : []),
              ]);
              if (expected !== event.canonicalPayload)
                issues.push(`Custody payload mismatch ${event._id}`);
              for (const edge of allocations)
                if (
                  !inputs.some((l) => l._id.equals(edge.inputLotId)) ||
                  !outputs.some((l) => l._id.equals(edge.outputLotId)) ||
                  units(edge.quantityUnits) <= 0n
                )
                  issues.push(`Custody edge invalid ${edge._id}`);
              for (const input of inputs)
                if (
                  allocations
                    .filter((e) => e.inputLotId.equals(input._id))
                    .reduce((sum, e) => sum + units(e.quantityUnits), 0n) !==
                    units(input.quantityUnits) ||
                  !input.assetId.equals(event.assetId) ||
                  units(input.createdOrder) >= units(event.sequence)
                )
                  issues.push(`Custody input invalid ${input._id}`);
              if (event.kind === 'TRANSFER')
                for (const output of outputs)
                  if (
                    allocations
                      .filter((e) => e.outputLotId.equals(output._id))
                      .reduce((sum, e) => sum + units(e.quantityUnits), 0n) !==
                    units(output.quantityUnits)
                  )
                    issues.push(`Custody output invalid ${output._id}`);
              const reference = await this.database.db
                .collection(event.kind === 'ISSUE' ? 'demoIssuances' : 'transfers', {
                  promoteLongs: false,
                })
                .findOne({ _id: event.referenceId }, { session });
              if (
                !reference ||
                !reference['assetId'].equals(event.assetId) ||
                (event.kind === 'TRANSFER' && reference['status'] !== 'COMMITTED')
              )
                issues.push(`Custody reference missing ${event._id}`);
              else {
                if (event.referenceKind !== (event.kind === 'ISSUE' ? 'demoIssuance' : 'transfer'))
                  issues.push(`Custody reference kind mismatch ${event._id}`);
                const destination = outputs.filter((l) =>
                  l.accountId.equals(reference['recipientAccountId']),
                );
                if (
                  destination.length !== 1 ||
                  units(destination[0]!.quantityUnits) !== units(reference['quantityUnits'])
                )
                  issues.push(`Custody destination mismatch ${event._id}`);
                const expectedWallets = [
                  ...new Set([
                    ...inputs.map((l) => l.walletId.toHexString()),
                    ...outputs.map((l) => l.walletId.toHexString()),
                  ]),
                ].sort();
                if (
                  JSON.stringify(expectedWallets) !==
                  JSON.stringify(event.walletIds.map((id) => id.toHexString()).sort())
                )
                  issues.push(`Custody participant mismatch ${event._id}`);
                if (
                  event.kind === 'ISSUE' &&
                  (inputs.length !== 0 || outputs.length !== 1 || allocations.length !== 0)
                )
                  issues.push(`Custody issue invalid ${event._id}`);
                if (
                  event.kind === 'TRANSFER' &&
                  (inputs.length === 0 ||
                    inputs.some((l) => !l.accountId.equals(reference['senderAccountId'])) ||
                    outputs.some(
                      (l) =>
                        !l.accountId.equals(reference['senderAccountId']) &&
                        !l.accountId.equals(reference['recipientAccountId']),
                    ))
                )
                  issues.push(`Custody transfer owner mismatch ${event._id}`);
              }
              previous = event.hash;
            }
            if (units(head.sequence) !== sequence || head.hash !== previous)
              issues.push(`Custody head mismatch ${head._id}`);
          }
          for (const lot of lots) {
            if (
              !events.some(
                (e) => e._id.equals(lot.createdEventId) && e.assetId.equals(lot.assetId),
              ) ||
              (lot.status === 'SPENT' && !events.some((e) => e._id.equals(lot.spentEventId)))
            )
              issues.push(`Custody event missing ${lot._id}`);
            const account = accountsById.get(lot.accountId.toHexString());
            const wallet = await this.database.db
              .collection('wallets')
              .findOne({ _id: lot.walletId }, { session });
            if (
              !account ||
              !wallet ||
              !account['userId']?.equals(wallet['userId']) ||
              !account['assetId'].equals(lot.assetId)
            )
              issues.push(`Custody owner mismatch ${lot._id}`);
          }
          for (const event of events)
            if (!heads.some((h) => h.assetId.equals(event.assetId)))
              issues.push(`Custody head missing ${event._id}`);
          for (const edge of edges)
            if (!events.some((e) => e._id.equals(edge.eventId)))
              issues.push(`Custody edge orphan ${edge._id}`);
          const accounts = await this.database.db
            .collection('accounts', { promoteLongs: false })
            .find({ ownerType: 'user', walletId: { $exists: true } }, { session })
            .toArray();
          for (const account of accounts) {
            const asset = await this.database.db
              .collection('assetTypes')
              .findOne({ _id: account['assetId'], custodyEnabled: true }, { session });
            if (!asset) continue;
            if (
              lots
                .filter((l) => l.accountId.equals(account._id) && l.status === 'UNSPENT')
                .reduce((sum, l) => sum + units(l.quantityUnits), 0n) !==
              units(account['balanceUnits'])
            )
              issues.push(`Custody balance mismatch ${account._id}`);
          }
        },
        { readConcern: { level: 'snapshot' }, timeoutMS: 10000 },
      );
      return { ok: issues.length === 0, issues };
    } finally {
      await session.endSession();
    }
  }
}
