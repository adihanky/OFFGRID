import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { ObjectId, type ClientSession } from 'mongodb';
import { z } from 'zod';
import type { InboxNotification, NotificationPage, VerificationJobView } from '@p2p/contracts';
import { DatabaseService } from '../../database/database.service.js';
import { collectionSchema, oid, text, date } from '../accounts/schema.js';
import { objectId, TRANSACTION_OPTIONS } from '../accounts/accounts.service.js';
import { parseInput } from '../assets/asset-input.js';
import { normalizeKey } from '../transfers/transfers.service.js';
import { AdminService } from '../admin/admin.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { ChainService } from '../chain/chain.service.js';
import { CustodyService } from '../custody/custody.service.js';
interface NotificationRecord {
  _id: ObjectId;
  recipientId: ObjectId;
  eventId: string;
  transferId: ObjectId;
  createdAt: Date;
  readAt: Date | null;
}
interface DeliveryEvent {
  _id: ObjectId;
  eventId: string;
  aggregateId: ObjectId;
  payload: { senderId: string; recipientId: string; transferId: string; at: string };
  deliveredAt: Date | null;
  attempts: number;
  nextAttemptAt: Date;
  deliveryToken?: string | null;
  deliveryLeaseUntil?: Date | null;
}
interface JobRecord {
  _id: ObjectId;
  ownerId: ObjectId;
  key: string;
  status: VerificationJobView['status'];
  progress: number;
  createdAt: Date;
  completedAt?: Date;
  results: VerificationJobView['results'];
  token: string | null;
  leaseUntil: Date | null;
  error?: string;
}
export function notificationView(row: NotificationRecord): InboxNotification {
  return {
    id: row._id.toHexString(),
    transferId: row.transferId.toHexString(),
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
    message: 'A demo transfer completed. Open its receipt in Activity.',
  };
}
export function jobView(row: JobRecord): VerificationJobView {
  return {
    id: row._id.toHexString(),
    status: row.status,
    progress: row.progress,
    total: 3,
    createdAt: row.createdAt.toISOString(),
    results: row.results,
    ...(row.completedAt ? { completedAt: row.completedAt.toISOString() } : {}),
    ...(row.error ? { error: row.error } : {}),
  };
}
const nullDate = { bsonType: ['date', 'null'] };
@Injectable()
export class OperationsService implements OnModuleInit {
  now: () => Date = () => new Date();
  fault?: (stage: string) => Promise<void>;
  constructor(
    @Inject(DatabaseService) readonly database: DatabaseService,
    @Inject(AdminService) readonly admin: AdminService,
    @Inject(LedgerService) readonly ledger: LedgerService,
    @Inject(ChainService) readonly chain: ChainService,
    @Inject(CustodyService) readonly custody: CustodyService,
  ) {}
  get inbox() {
    return this.database.db.collection<NotificationRecord>('notifications');
  }
  get events() {
    return this.database.db.collection<DeliveryEvent>('outboxEvents');
  }
  get jobs() {
    return this.database.db.collection<JobRecord>('verificationJobs');
  }
  async onModuleInit() {
    await collectionSchema(
      this.database.db,
      'notifications',
      { recipientId: oid, eventId: text, transferId: oid, createdAt: date, readAt: nullDate },
      undefined,
      { additionalProperties: false },
    );
    await this.inbox.createIndex({ recipientId: 1, eventId: 1 }, { unique: true });
    await this.inbox.createIndex({ recipientId: 1, _id: -1 });
    await collectionSchema(this.database.db, 'deliveryState', { key: text, since: date });
    await this.database.db.collection('deliveryState').createIndex({ key: 1 }, { unique: true });
    await this.database.db
      .collection('deliveryState')
      .updateOne(
        { key: 'notifications' },
        { $setOnInsert: { key: 'notifications', since: this.now() } },
        { upsert: true },
      );
    await collectionSchema(
      this.database.db,
      'verificationJobs',
      {
        ownerId: oid,
        key: text,
        status: { enum: ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED'] },
        progress: { bsonType: 'int', minimum: 0, maximum: 3 },
        createdAt: date,
        completedAt: date,
        results: { bsonType: 'array' },
        token: { bsonType: ['string', 'null'] },
        leaseUntil: nullDate,
        error: text,
      },
      ['ownerId', 'key', 'status', 'progress', 'createdAt', 'results', 'token', 'leaseUntil'],
      { additionalProperties: false },
    );
    await this.jobs.createIndex({ ownerId: 1, key: 1 }, { unique: true });
    await this.jobs.createIndex({ status: 1, leaseUntil: 1, _id: 1 });
  }
  async boundary() {
    const row = await this.database.db
      .collection('deliveryState')
      .findOne({ key: 'notifications' });
    if (!row?.['since']) throw new Error('Notification activation boundary unavailable.');
    return row['since'] as Date;
  }
  async notificationPage(caller: string, input: unknown): Promise<NotificationPage> {
    const query = parseInput(
      z.strictObject({
        cursor: z
          .string()
          .regex(/^[a-f0-9]{24}$/)
          .optional(),
        unread: z.enum(['true', 'false']).optional(),
      }),
      input,
    );
    const rows = await this.inbox
      .find({
        recipientId: objectId(caller),
        ...(query.cursor ? { _id: { $lt: objectId(query.cursor) } } : {}),
        ...(query.unread === 'true' ? { readAt: null } : {}),
      })
      .sort({ _id: -1 })
      .limit(21)
      .maxTimeMS(5000)
      .toArray();
    return {
      notifications: rows.slice(0, 20).map(notificationView),
      nextCursor: rows.length > 20 ? rows[19]!._id.toHexString() : null,
    };
  }
  async read(caller: string, id: string) {
    const row = await this.inbox.findOne({ _id: objectId(id), recipientId: objectId(caller) });
    if (!row) throw new NotFoundException('Notification unavailable.');
    await this.inbox.updateOne(
      { _id: row._id, recipientId: row.recipientId, readAt: null },
      { $set: { readAt: this.now() } },
    );
    return { read: true };
  }
  async deliverOne() {
    const now = this.now(),
      boundary = await this.boundary(),
      token = randomUUID();
    const event = await this.events.findOneAndUpdate(
      {
        deliveredAt: null,
        'payload.at': { $gte: boundary.toISOString() },
        nextAttemptAt: { $lte: now },
        $or: [{ deliveryLeaseUntil: null }, { deliveryLeaseUntil: { $lte: now } }],
      },
      {
        $set: { deliveryToken: token, deliveryLeaseUntil: new Date(now.getTime() + 30000) },
        $inc: { attempts: 1 },
      },
      {
        sort: { nextAttemptAt: 1, _id: 1 },
        returnDocument: 'after',
        writeConcern: { w: 'majority' },
      },
    );
    if (!event) return false;
    const session = this.database.client.startSession();
    try {
      await session.withTransaction(async () => {
        const filter = {
          _id: event._id,
          deliveredAt: null,
          deliveryToken: token,
          deliveryLeaseUntil: { $gt: this.now() },
        };
        if (!(await this.events.findOne(filter, { session })))
          throw new Error('Delivery lease expired.');
        for (const recipient of [event.payload.senderId, event.payload.recipientId])
          await this.inbox.updateOne(
            { recipientId: objectId(recipient), eventId: event.eventId },
            {
              $setOnInsert: {
                _id: new ObjectId(),
                recipientId: objectId(recipient),
                eventId: event.eventId,
                transferId: objectId(event.payload.transferId),
                createdAt: new Date(event.payload.at),
                readAt: null,
              },
            },
            { upsert: true, session },
          );
        await this.fault?.('beforeDelivered');
        if (
          (
            await this.events.updateOne(
              filter,
              { $set: { deliveredAt: this.now(), deliveryLeaseUntil: null } },
              { session },
            )
          ).modifiedCount !== 1
        )
          throw new Error('Delivery claim changed.');
      }, TRANSACTION_OPTIONS);
    } catch {
      await this.events.updateOne(
        { _id: event._id, deliveryToken: token, deliveredAt: null },
        {
          $set: { nextAttemptAt: new Date(this.now().getTime() + 2000), deliveryLeaseUntil: null },
        },
      );
    } finally {
      await session.endSession();
    }
    return true;
  }
  async assertBounded() {
    for (const name of [
      'accounts',
      'assetTypes',
      'transfers',
      'demoIssuances',
      'ledgerEntries',
      'chainEntries',
      'chainHeads',
      'custodyLots',
      'custodyEvents',
      'custodyEdges',
      'custodyHeads',
    ]) {
      const rows = await this.database.db
        .collection(name)
        .find({}, { projection: { _id: 1 } })
        .limit(5001)
        .maxTimeMS(3000)
        .toArray();
      if (rows.length > 5000)
        throw new BadRequestException(
          'Verification is limited to 5,000 records per collection. Use an operator-managed verification process for larger data.',
        );
    }
  }
  async createJob(actor: string, keyValue: unknown, value: unknown) {
    parseInput(z.strictObject({ scope: z.literal('DEMO_INTEGRITY') }), value);
    const key = normalizeKey(keyValue);
    return this.admin.transaction(actor, 'AUDITOR', async (session) => {
      const old = await this.jobs.findOne({ ownerId: objectId(actor), key }, { session });
      if (old) return { job: jobView(old) };
      await this.assertBounded();
      const row: JobRecord = {
        _id: new ObjectId(),
        ownerId: objectId(actor),
        key,
        status: 'QUEUED',
        progress: 0,
        createdAt: this.now(),
        results: [],
        token: null,
        leaseUntil: null,
      };
      await this.jobs.insertOne(row, { session });
      return { job: jobView(row) };
    });
  }
  async job(actor: string, id: string) {
    return this.admin.transaction(actor, 'AUDITOR', async (session: ClientSession) => {
      const job = await this.jobs.findOne(
        { _id: objectId(id), ownerId: objectId(actor) },
        { session },
      );
      if (!job) throw new NotFoundException('Job unavailable.');
      return { job: jobView(job) };
    });
  }
  async runJob() {
    const now = this.now(),
      token = randomUUID();
    const job = await this.jobs.findOneAndUpdate(
      { $or: [{ status: 'QUEUED' }, { status: 'RUNNING', leaseUntil: { $lte: now } }] },
      {
        $set: {
          status: 'RUNNING',
          token,
          leaseUntil: new Date(now.getTime() + 120000),
          progress: 0,
          results: [],
        },
      },
      { sort: { _id: 1 }, returnDocument: 'after' },
    );
    if (!job) return false;
    const fence = { _id: job._id, token, status: 'RUNNING' as const };
    try {
      await this.assertBounded();
      const results: JobRecord['results'] = [];
      for (const [check, work] of [
        ['LEDGER', () => this.ledger.reconcile(5000)],
        ['CHAIN', () => this.chain.verify(undefined, 5000)],
        ['CUSTODY', () => this.custody.verify(5000)],
      ] as const) {
        const result = await work();
        results.push({ check, ok: result.ok, issueCount: result.issues.length });
        await this.fault?.('jobCheckpoint');
        if (
          (
            await this.jobs.updateOne(
              { ...fence, leaseUntil: { $gt: this.now() } },
              { $set: { results: [...results], progress: results.length } },
            )
          ).matchedCount !== 1
        )
          return true;
      }
      await this.jobs.updateOne(
        { ...fence, leaseUntil: { $gt: this.now() } },
        { $set: { status: 'COMPLETED', completedAt: this.now(), leaseUntil: null } },
      );
    } catch {
      await this.jobs.updateOne(fence, {
        $set: {
          status: 'FAILED',
          error:
            'Verification could not finish within the supported data or service limits. No repair was performed.',
          completedAt: this.now(),
          leaseUntil: null,
        },
      });
    }
    return true;
  }
  async overview(actor: string) {
    return this.admin.transaction(actor, 'AUDITOR', async () => {
      const boundary = await this.boundary();
      const [eligible, historical, pending, oldest] = await Promise.all([
        this.events.countDocuments(
          { deliveredAt: null, 'payload.at': { $gte: boundary.toISOString() } },
          { maxTimeMS: 5000 },
        ),
        this.events.countDocuments(
          { deliveredAt: null, 'payload.at': { $lt: boundary.toISOString() } },
          { maxTimeMS: 5000 },
        ),
        this.database.db
          .collection('transfers')
          .countDocuments({ status: 'PENDING' }, { maxTimeMS: 5000 }),
        this.database.db
          .collection('transfers')
          .find({ status: 'PENDING' })
          .sort({ createdAt: 1 })
          .limit(1)
          .toArray(),
      ]);
      return {
        pendingTransfers: pending,
        oldestPendingAt: oldest[0]?.['createdAt']?.toISOString() ?? null,
        notificationBacklog: eligible,
        historicalEventsRetained: historical,
        notificationsSince: boundary.toISOString(),
        verificationLimit: 5000,
        notice:
          'Only events at or after notification activation are delivered. Historical events remain retained; no event is marked delivered without inbox persistence. Verification performs separate read-only snapshots and never repairs data.',
      };
    });
  }
}
