import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { MongoServerError, ObjectId, type ClientSession, type Long } from 'mongodb';
import { z } from 'zod';
import type {
  ConsumerRequestView,
  ConsumerRequestInput,
  ConsumerRequestPage,
} from '@p2p/contracts';
import { AdminService } from '../admin/admin.service.js';
import { PolicyReader } from '../configuration/policy-reader.js';
import { parseInput } from '../assets/asset-input.js';
import { objectId } from '../accounts/accounts.service.js';
import { collectionSchema, oid, text, date, long } from '../accounts/schema.js';
import { parseQuantity, formatQuantity, toLong } from '../accounts/quantity.js';
import { assertDemoTarget } from '../accounts/demo-target.js';
import { normalizeKey } from '../transfers/transfers.service.js';

const reason = z.string().trim().min(3).max(200);
export const consumerRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('ACCESS'),
    role: z.enum(['ASSET_ADMIN', 'ACCESS_ADMIN', 'DEMO_OPERATOR', 'AUDITOR']),
    reason,
  }),
  z.strictObject({
    type: z.literal('DEMO_ALLOCATION'),
    assetId: z.string().regex(/^[a-f0-9]{24}$/),
    quantity: z.string().max(30),
    reason,
  }),
]);
const decisionSchema = z.strictObject({
  decision: z.enum(['APPROVED', 'REJECTED']),
  reason,
  revision: z.string().regex(/^(0|[1-9][0-9]{0,17})$/),
  commandId: z.uuid(),
});
interface RequestRecord {
  _id: ObjectId;
  ownerId: ObjectId;
  ownerHandle: string;
  type: 'ACCESS' | 'DEMO_ALLOCATION';
  input: ConsumerRequestInput;
  asset?: ConsumerRequestView['asset'];
  key: string;
  digest: string;
  status: 'OPEN' | 'APPROVED' | 'REJECTED';
  revision: Long;
  createdAt: Date;
  decidedAt?: Date;
  decisionReason?: string;
  decisionDigest?: string;
  decisionActor?: ObjectId;
  operationId?: string;
}
export function requestView(row: RequestRecord): ConsumerRequestView {
  return {
    id: row._id.toHexString(),
    owner: { id: row.ownerId.toHexString(), publicHandle: row.ownerHandle },
    type: row.type,
    ...(row.input.type === 'ACCESS'
      ? { role: row.input.role }
      : { asset: row.asset, quantity: row.input.quantity }),
    reason: row.input.reason,
    status: row.status,
    revision: row.revision.toString(),
    createdAt: row.createdAt.toISOString(),
    ...(row.decisionReason ? { decisionReason: row.decisionReason } : {}),
    ...(row.operationId ? { operationId: row.operationId } : {}),
    ...(row.decidedAt ? { decidedAt: row.decidedAt.toISOString() } : {}),
  };
}
export function requestDigest(input: ConsumerRequestInput) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}
@Injectable()
export class RequestsService implements OnModuleInit {
  fault?: (stage: string) => Promise<void>;
  constructor(
    @Inject(AdminService) readonly admin: AdminService,
    @Inject(PolicyReader) readonly policies: PolicyReader,
  ) {}
  get collection() {
    return this.admin.database.db.collection<RequestRecord>('consumerRequests', {
      promoteLongs: false,
    });
  }
  async onModuleInit() {
    await collectionSchema(
      this.admin.database.db,
      'consumerRequests',
      {
        ownerId: oid,
        ownerHandle: text,
        type: { enum: ['ACCESS', 'DEMO_ALLOCATION'] },
        input: { bsonType: 'object' },
        asset: { bsonType: 'object' },
        key: text,
        digest: text,
        status: { enum: ['OPEN', 'APPROVED', 'REJECTED'] },
        revision: long,
        createdAt: date,
        decidedAt: date,
        decisionReason: text,
        decisionDigest: text,
        decisionActor: oid,
        operationId: text,
      },
      [
        'ownerId',
        'ownerHandle',
        'type',
        'input',
        'key',
        'digest',
        'status',
        'revision',
        'createdAt',
      ],
      { additionalProperties: false },
    );
    await this.collection.createIndex({ ownerId: 1, key: 1 }, { unique: true });
    await this.collection.createIndex(
      { ownerId: 1, digest: 1 },
      { unique: true, partialFilterExpression: { status: 'OPEN' } },
    );
    await this.collection.createIndex({ ownerId: 1, _id: -1 });
    await this.collection.createIndex({ type: 1, status: 1, _id: -1 });
  }
  async create(actor: string, keyValue: unknown, value: unknown) {
    const input = parseInput(consumerRequestSchema, value),
      key = normalizeKey(keyValue);
    const old = await this.collection.findOne({ ownerId: objectId(actor), key });
    if (old) {
      if (input.type === 'DEMO_ALLOCATION' && old.asset)
        input.quantity = formatQuantity(
          parseQuantity(input.quantity, old.asset.precision),
          old.asset.precision,
        );
      if (old.digest !== requestDigest(input))
        throw new ConflictException('Request key belongs to another request.');
      return { request: requestView(old) };
    }
    await this.admin.accounts.throttle(actor, 'support-request', 10);
    const support = (await this.policies.support()).values;
    if (!(input.type === 'ACCESS' ? support.accessRequests : support.allocationRequests))
      throw new ForbiddenException(
        'New requests in this category are disabled. Existing requests remain trackable.',
      );
    let asset: ConsumerRequestView['asset'];
    if (input.type === 'DEMO_ALLOCATION') {
      assertDemoTarget(this.admin.environment);
      const row = await this.admin.accounts.assets.findOne({
        _id: objectId(input.assetId),
        status: 'active',
        custodyEnabled: true,
      });
      if (!row) throw new BadRequestException('Demo asset unavailable.');
      input.quantity = formatQuantity(parseQuantity(input.quantity, row.precision), row.precision);
      asset = { id: input.assetId, code: row.symbol ?? row.code, precision: row.precision };
    }
    const owner = await this.admin.accounts.identities.profile(objectId(actor));
    if (!owner) throw new ForbiddenException();
    const digest = requestDigest(input);
    // A consumer submission only records a request. It cannot grant a role or issue any units.
    const record: RequestRecord = {
      _id: new ObjectId(),
      ownerId: objectId(actor),
      ownerHandle: owner.publicHandle,
      type: input.type,
      input,
      ...(asset ? { asset } : {}),
      key,
      digest,
      status: 'OPEN',
      revision: toLong(0n),
      createdAt: new Date(),
    };
    try {
      await this.collection.insertOne(record, { writeConcern: { w: 'majority' } });
    } catch (error) {
      if (!(error instanceof MongoServerError) || error.code !== 11000) throw error;
      const existing = await this.collection.findOne({
        ownerId: objectId(actor),
        $or: [{ key }, { digest, status: 'OPEN' }],
      });
      if (existing?.key === key && existing.digest === digest)
        return { request: requestView(existing) };
      throw new ConflictException({
        code: 'REQUEST_EXISTS',
        requestId: existing?._id.toHexString(),
        message: 'A matching request is already open. View it in Help.',
      });
    }
    return { request: requestView(record) };
  }
  async list(actor: string, input: unknown, queue = false): Promise<ConsumerRequestPage> {
    const query = parseInput(
      z.strictObject({
        cursor: z
          .string()
          .regex(/^[a-f0-9]{24}$/)
          .optional(),
        status: z.enum(['OPEN', 'APPROVED', 'REJECTED']).optional(),
      }),
      input,
    );
    const roles = queue ? (await this.admin.status(actor)).roles : [];
    const types = [
      ...(roles.includes('ACCESS_ADMIN') ? ['ACCESS'] : []),
      ...(roles.includes('ASSET_ADMIN') ? ['DEMO_ALLOCATION'] : []),
    ];
    if (queue && !types.length)
      throw new ForbiddenException('Request review requires the category administrator role.');
    const rows = await this.collection
      .find({
        ...(queue
          ? { type: { $in: types as RequestRecord['type'][] } }
          : { ownerId: objectId(actor) }),
        ...(query.status ? { status: query.status } : {}),
        ...(query.cursor ? { _id: { $lt: objectId(query.cursor) } } : {}),
      })
      .sort({ _id: -1 })
      .limit(21)
      .maxTimeMS(5000)
      .toArray();
    return {
      requests: rows.slice(0, 20).map(requestView),
      nextCursor: rows.length > 20 ? rows[19]!._id.toHexString() : null,
    };
  }
  // P05 explicitly authorizes this separate administrator decision: delivery plan lines 26/38,
  // business HLD line 176. The route below requires session/CSRF; the existing domain service
  // fences the live category role inside the transaction. Self-approval is prohibited.
  async decide(actor: string, id: string, value: unknown) {
    const input = parseInput(decisionSchema, value);
    const digest = createHash('sha256')
      .update(JSON.stringify([actor, input]))
      .digest('hex');
    const row = await this.collection.findOne({ _id: objectId(id) });
    if (!row) throw new NotFoundException('Request unavailable.');
    if (row.ownerId.equals(objectId(actor)))
      throw new ForbiddenException('Another authorized administrator must review your request.');
    const role = row.type === 'ACCESS' ? 'ACCESS_ADMIN' : 'ASSET_ADMIN';
    const check = async (session: ClientSession) => {
      const current = await this.collection.findOne({ _id: row._id }, { session });
      if (!current) throw new NotFoundException('Request unavailable.');
      if (current.status !== 'OPEN') {
        if (current.decisionDigest === digest) return current;
        throw new ConflictException('Request already decided. Refresh its outcome.');
      }
      if (current.revision.toString() !== input.revision)
        throw new ConflictException('Request changed. Refresh before deciding.');
      return current;
    };
    const finalize = async (session: ClientSession, operationId?: string) => {
      await check(session);
      await this.fault?.('beforeDecision');
      const updated = await this.collection.updateOne(
        { _id: row._id, status: 'OPEN', revision: toLong(BigInt(input.revision)) },
        {
          $set: {
            status: input.decision,
            decisionDigest: digest,
            decisionActor: objectId(actor),
            decisionReason: input.reason,
            decidedAt: new Date(),
            ...(operationId ? { operationId } : {}),
          },
          $inc: { revision: toLong(1n) },
        },
        { session },
      );
      if (updated.modifiedCount !== 1)
        throw new ConflictException('Request changed. Refresh before deciding.');
      await this.admin.audit(actor, `REQUEST_${input.decision}`, row._id, input.reason, session);
    };
    try {
      if (row.status !== 'OPEN') await this.admin.transaction(actor, role, check);
      else if (input.decision === 'REJECTED')
        await this.admin.transaction(actor, role, (session) => finalize(session));
      else if (row.input.type === 'ACCESS') {
        const grant = await this.admin.grants.findOne({
          userId: row.ownerId,
          role: row.input.role,
        });
        await this.admin.setRole(
          actor,
          {
            handle: row.ownerHandle,
            role: row.input.role,
            status: 'ACTIVE',
            revision: grant?.revision.toString() ?? null,
            reason: input.reason,
          },
          (session) =>
            finalize(
              session,
              `role:${row.ownerId}:${row.input.type === 'ACCESS' ? row.input.role : ''}`,
            ),
        );
      } else {
        assertDemoTarget(this.admin.environment);
        const assetId = objectId(row.input.assetId),
          asset = await this.admin.accounts.assets.findOne({ _id: assetId });
        if (!asset?.custodyEnabled) throw new BadRequestException('Demo asset unavailable.');
        await this.admin.accounts.issueDemo({
          fixtureKey: `request:${id}:approval`,
          userId: row.ownerId,
          assetId,
          quantityUnits: parseQuantity(row.input.quantity, asset.precision),
          authorize: async (session) => {
            await this.admin.authorize(actor, role, session);
            await check(session);
          },
          onCreated: async (issuance, session) => {
            await this.admin.audit(actor, 'DEMO_ISSUED', issuance._id, input.reason, session);
            await finalize(session, issuance._id.toHexString());
          },
        });
      }
    } catch (error) {
      const outcome = await this.collection.findOne({ _id: row._id, decisionDigest: digest });
      if (!outcome) throw error;
      await this.admin.transaction(actor, role, check);
    }
    return { request: requestView((await this.collection.findOne({ _id: row._id }))!) };
  }
}
