import { timingSafeEqual, createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { ObjectId, type ClientSession } from 'mongodb';
import { z } from 'zod';
import type { AdministrationStatus, WalletRole } from '@p2p/contracts';
import { ENVIRONMENT } from '../../config/environment.module.js';
import type { Environment } from '../../config/environment.js';
import { DatabaseService } from '../../database/database.service.js';
import { AccountsService, objectId, TRANSACTION_OPTIONS } from '../accounts/accounts.service.js';
import { formatQuantity, parseQuantity, toLong, units } from '../accounts/quantity.js';
import { collectionSchema, date, long, oid, text } from '../accounts/schema.js';
import { demoAssetView } from '../wallets/wallets.service.js';
import type { RoleGrantRecord } from '../wallets/wallets.models.js';
import { parseInput } from '../assets/asset-input.js';
import { assertDemoTarget } from '../accounts/demo-target.js';
import { NetworksService, networkView } from '../networks/networks.service.js';
import { rpcUrl } from '../networks/rpc.js';

const reason = z.string().trim().min(3).max(200);
const revision = z.string().regex(/^(0|[1-9][0-9]{0,17})$/);
const role = z.enum(['ASSET_ADMIN', 'DEMO_OPERATOR', 'AUDITOR', 'ACCESS_ADMIN']);
export const draftSchema = z.strictObject({
  code: z.string().regex(/^[A-Z][A-Z0-9_]{1,15}$/),
  symbol: z.string().regex(/^[A-Z][A-Z0-9]{0,11}$/),
  displayName: z.string().trim().min(1).max(80),
  precision: z.number().int().min(0).max(8),
  supplyCap: z.string().max(30),
  minimum: z.string().max(30),
  maximum: z.string().max(30),
  reason,
});
export function draftAmounts(input: z.infer<typeof draftSchema>) {
  const capUnits = parseQuantity(input.supplyCap, input.precision);
  const minimumUnits = parseQuantity(input.minimum, input.precision);
  const maximumUnits = parseQuantity(input.maximum, input.precision);
  if (minimumUnits > maximumUnits || maximumUnits > capUnits)
    throw new BadRequestException('Require minimum <= maximum <= supply cap.');
  return {
    capUnits: toLong(capUnits),
    minimumUnits: toLong(minimumUnits),
    maximumUnits: toLong(maximumUnits),
  };
}
export function matchesSetupToken(candidate: string, expected: string) {
  if (expected.length < 32) return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(candidate), digest(expected));
}

@Injectable()
export class AdminService implements OnModuleInit {
  constructor(
    @Inject(DatabaseService) readonly database: DatabaseService,
    @Inject(AccountsService) readonly accounts: AccountsService,
    @Inject(ENVIRONMENT) readonly environment: Environment,
    @Inject(NetworksService) readonly networks: NetworksService,
  ) {}
  get grants() {
    return this.database.db.collection<RoleGrantRecord>('roleGrants', { promoteLongs: false });
  }
  async onModuleInit() {
    await collectionSchema(
      this.database.db,
      'applicationState',
      {
        key: text,
        active: { bsonType: 'bool' },
        createdAt: date,
        revision: { bsonType: ['int', 'long', 'double'] },
      },
      ['key'],
      { additionalProperties: false },
    );
    await collectionSchema(this.database.db, 'adminAudit', {
      actorId: oid,
      action: text,
      targetId: oid,
      reason: text,
      createdAt: date,
    });
    await this.database.db.collection('adminAudit').createIndex({ actorId: 1, createdAt: -1 });
    await collectionSchema(
      this.database.db,
      'configurationRevisions',
      {
        entityId: oid,
        revision: long,
        value: { bsonType: 'object' },
        actorId: oid,
        reason: text,
        createdAt: date,
      },
      undefined,
      { additionalProperties: false },
    );
    await this.database.db
      .collection('configurationRevisions')
      .createIndex({ entityId: 1, revision: 1 }, { unique: true });
    await this.database.db.collection('applicationState').createIndex({ key: 1 }, { unique: true });
    await collectionSchema(
      this.database.db,
      'seedPreviews',
      { actor: text, preview: { bsonType: 'object' }, expiresAt: date },
      undefined,
      { additionalProperties: false },
    );
    await this.database.db
      .collection('seedPreviews')
      .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await collectionSchema(
      this.database.db,
      'seedRuns',
      {
        key: text,
        profileHash: text,
        state: { enum: ['READY', 'RUNNING', 'INCOMPLETE', 'COMPLETED'] },
        token: { bsonType: ['string', 'null'] },
        operations: { bsonType: 'int' },
        leaseUntil: date,
        completedAt: date,
      },
      ['key', 'profileHash', 'state', 'token', 'operations'],
      { additionalProperties: false },
    );
    await this.database.db.collection('seedRuns').createIndex({ key: 1 }, { unique: true });
  }
  async status(actor: string): Promise<AdministrationStatus> {
    let demoEnabled = true;
    try {
      assertDemoTarget(this.environment);
    } catch {
      demoEnabled = false;
    }
    return {
      roles: (await this.grants.find({ userId: objectId(actor), status: 'ACTIVE' }).toArray()).map(
        (grant) => grant.role,
      ),
      setupAvailable:
        this.environment.ADMIN_SETUP_TOKEN.length >= 32 &&
        !(await this.database.db.collection('applicationState').findOne({ key: 'admin-setup' })),
      maintenance: Boolean(
        await this.database.db
          .collection('applicationState')
          .findOne({ key: 'maintenance', active: true }),
      ),
      demoEnabled,
    };
  }
  async authorize(actor: string, required: Exclude<WalletRole, 'USER'>, session: ClientSession) {
    if (
      !(await this.accounts.identities.fence(objectId(actor), session)) ||
      !(await this.grants.findOneAndUpdate(
        { userId: objectId(actor), role: required, status: 'ACTIVE' },
        { $inc: { revision: toLong(1n) }, $set: { updatedAt: new Date() } },
        { session },
      ))
    )
      throw new ForbiddenException('This operation requires an active role grant.');
  }
  async audit(
    actor: string,
    action: string,
    targetId: ObjectId,
    note: string,
    session: ClientSession,
  ) {
    await this.database.db
      .collection('adminAudit')
      .insertOne(
        { actorId: objectId(actor), action, targetId, reason: note, createdAt: new Date() },
        { session },
      );
  }
  async transaction<T>(
    actor: string,
    required: Exclude<WalletRole, 'USER'>,
    work: (session: ClientSession) => Promise<T>,
  ) {
    const session = this.database.client.startSession();
    try {
      return await session.withTransaction(async () => {
        await this.authorize(actor, required, session);
        return work(session);
      }, TRANSACTION_OPTIONS);
    } finally {
      await session.endSession();
    }
  }
  async setup(actor: string, value: unknown) {
    const input = parseInput(z.strictObject({ token: z.string().max(256) }), value);
    if (!matchesSetupToken(input.token, this.environment.ADMIN_SETUP_TOKEN))
      throw new ForbiddenException('Setup token is unavailable or invalid.');
    const session = this.database.client.startSession();
    try {
      await session.withTransaction(async () => {
        if (
          await this.database.db
            .collection('applicationState')
            .findOne({ key: 'admin-setup' }, { session })
        )
          throw new ConflictException('Installation setup is already complete.');
        if (!(await this.accounts.identities.fence(objectId(actor), session)))
          throw new ForbiddenException();
        await this.database.db
          .collection('applicationState')
          .insertOne({ key: 'admin-setup', createdAt: new Date() }, { session });
        for (const name of ['ACCESS_ADMIN', 'ASSET_ADMIN', 'DEMO_OPERATOR', 'AUDITOR'] as const) {
          const now = new Date();
          await this.grants.updateOne(
            { userId: objectId(actor), role: name },
            {
              $set: { status: 'ACTIVE', updatedAt: now },
              $setOnInsert: {
                _id: new ObjectId(),
                schemaVersion: 2,
                createdAt: now,
                revision: toLong(0n),
              },
            },
            { session, upsert: true },
          );
        }
        await this.audit(
          actor,
          'SETUP_COMPLETED',
          objectId(actor),
          'One-use deployment setup token',
          session,
        );
      }, TRANSACTION_OPTIONS);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 11000)
        throw new ConflictException('Installation setup is already complete.');
      throw error;
    } finally {
      await session.endSession();
    }
    return this.status(actor);
  }
  async assets(actor: string) {
    return this.transaction(actor, 'ASSET_ADMIN', async (session) => ({
      assets: (
        await this.accounts.assets.find({}, { session }).sort({ code: 1 }).limit(100).toArray()
      ).map(demoAssetView),
    }));
  }
  async createAsset(actor: string, value: unknown) {
    const input = parseInput(draftSchema, value);
    const amounts = draftAmounts(input);
    return this.transaction(actor, 'ASSET_ADMIN', async (session) => {
      if (await this.accounts.assets.findOne({ code: input.code }, { session }))
        throw new ConflictException('Asset code already exists.');
      const id = new ObjectId();
      const asset = {
        _id: id,
        code: input.code,
        symbol: input.symbol,
        displayName: input.displayName,
        precision: input.precision,
        ...amounts,
        schemaVersion: 2 as const,
        custodyEnabled: true,
        kind: 'DEMO_CRYPTO' as const,
        mode: 'SIMULATED' as const,
        lifecycle: 'DRAFT' as const,
        status: 'disabled' as const,
        revision: toLong(0n),
        identityKey: `demo:${id}`,
        createdAt: new Date(),
      };
      await this.accounts.assets.insertOne(asset, { session });
      await this.database.db
        .collection('custodyHeads')
        .insertOne(
          { _id: new ObjectId(), assetId: id, sequence: toLong(0n), hash: '0'.repeat(64) },
          { session },
        );
      await this.database.db.collection('chainHeads').insertOne(
        {
          _id: new ObjectId(),
          assetId: id,
          latestSequence: toLong(0n),
          latestHash: '0'.repeat(64),
          transfersEnabled: false,
        },
        { session },
      );
      await this.audit(actor, 'ASSET_DRAFT_CREATED', id, input.reason, session);
      await this.database.db.collection('configurationRevisions').insertOne(
        {
          entityId: id,
          revision: asset.revision,
          value: demoAssetView(asset),
          actorId: objectId(actor),
          reason: input.reason,
          createdAt: new Date(),
        },
        { session },
      );
      return { asset: demoAssetView(asset) };
    });
  }
  async updateAsset(actor: string, id: string, expected: unknown, value: unknown) {
    const version = parseInput(revision, expected);
    const input = parseInput(
      z.strictObject({
        lifecycle: z.enum(['ACTIVE', 'PAUSED', 'ARCHIVED']),
        displayName: z.string().trim().min(1).max(80),
        supplyCap: z.string().max(30),
        minimum: z.string().max(30),
        maximum: z.string().max(30),
        reason,
      }),
      value,
    );
    return this.transaction(actor, 'ASSET_ADMIN', async (session) => {
      const asset = await this.accounts.assets.findOne({ _id: objectId(id) }, { session });
      if (!asset) throw new NotFoundException();
      if ((asset.revision?.toString() ?? '0') !== version)
        throw new ConflictException('Asset changed. Refresh before editing.');
      if (asset.lifecycle === 'ARCHIVED' && input.lifecycle !== 'ARCHIVED')
        throw new ConflictException('Archived assets cannot be reactivated.');
      if (!asset.custodyEnabled)
        throw new ConflictException('Migrate this asset before activation.');
      const amounts = draftAmounts({
        ...input,
        code: asset.code,
        symbol: asset.symbol ?? asset.code,
        precision: asset.precision,
      });
      const system = await this.accounts.accounts.findOne(
        { assetId: asset._id, ownerType: 'system' },
        { session },
      );
      if (system && -units(system.balanceUnits) > units(amounts.capUnits))
        throw new ConflictException('Supply cap cannot be below issued supply.');
      const status = input.lifecycle === 'ACTIVE' ? ('active' as const) : ('disabled' as const);
      await this.accounts.assets.updateOne(
        { _id: asset._id },
        {
          $set: { ...amounts, status, lifecycle: input.lifecycle, displayName: input.displayName },
          $inc: { revision: toLong(1n) },
        },
        { session },
      );
      await this.database.db
        .collection('chainHeads')
        .updateOne(
          { assetId: asset._id },
          { $set: { transfersEnabled: status === 'active' } },
          { session },
        );
      await this.audit(actor, `ASSET_${input.lifecycle}`, asset._id, input.reason, session);
      await this.database.db.collection('configurationRevisions').insertOne(
        {
          entityId: asset._id,
          revision: toLong(BigInt(version) + 1n),
          value: {
            ...demoAssetView(asset),
            ...input,
            revision: (BigInt(version) + 1n).toString(),
          },
          actorId: objectId(actor),
          reason: input.reason,
          createdAt: new Date(),
        },
        { session },
      );
      return {
        asset: demoAssetView({
          ...asset,
          ...amounts,
          status,
          lifecycle: input.lifecycle,
          displayName: input.displayName,
          revision: toLong(BigInt(version) + 1n),
        }),
      };
    });
  }
  async issue(actor: string, value: unknown) {
    const input = parseInput(
      z.strictObject({
        assetId: z.string(),
        handle: z.string().regex(/^[a-z][a-z0-9_]{2,23}$/),
        quantity: z.string().max(30),
        key: z.string().uuid(),
        reason,
      }),
      value,
    );
    const peer = await this.accounts.identities.peer(input.handle);
    const asset = await this.accounts.assets.findOne({ _id: objectId(input.assetId) });
    if (!peer || !asset) throw new BadRequestException('Recipient or asset unavailable.');
    const issue = await this.accounts.issueDemo({
      fixtureKey: `admin:${actor}:${input.key}`,
      userId: objectId(peer.id),
      assetId: asset._id,
      quantityUnits: parseQuantity(input.quantity, asset.precision),
      authorize: (session) => this.authorize(actor, 'ASSET_ADMIN', session),
      onCreated: (issuance, session) =>
        this.audit(actor, 'DEMO_ISSUED', issuance._id, input.reason, session),
    });
    return {
      id: issue._id.toHexString(),
      quantity: formatQuantity(units(issue.quantityUnits), asset.precision),
    };
  }
  async roleList(actor: string) {
    return this.transaction(actor, 'ACCESS_ADMIN', async (session) => {
      const grants = await this.grants.find({}, { session }).limit(200).toArray();
      const result = [];
      for (const grant of grants) {
        const peer = await this.accounts.identities.profile(grant.userId);
        result.push({
          id: grant._id.toHexString(),
          handle: peer?.publicHandle ?? 'unavailable',
          role: grant.role,
          status: grant.status,
          revision: grant.revision.toString(),
        });
      }
      return { grants: result };
    });
  }
  async setRole(
    actor: string,
    value: unknown,
    onUpdated?: (session: ClientSession) => Promise<void>,
  ) {
    const input = parseInput(
      z.strictObject({
        handle: z.string().regex(/^[a-z][a-z0-9_]{2,23}$/),
        role,
        status: z.enum(['ACTIVE', 'REVOKED']),
        revision: revision.nullable(),
        reason,
      }),
      value,
    );
    return this.transaction(actor, 'ACCESS_ADMIN', async (session) => {
      await this.database.db
        .collection('applicationState')
        .updateOne({ key: 'admin-setup' }, { $inc: { revision: 1 } }, { session });
      const user = await this.database.db
        .collection('users')
        .findOne({ publicHandle: input.handle, status: 'active' }, { session });
      if (!user) throw new BadRequestException('User unavailable.');
      const old = await this.grants.findOne({ userId: user._id, role: input.role }, { session });
      // Authorization increments the actor grant; compare its pre-authorization revision for self edits.
      const actualRevision = old
        ? units(old.revision) -
          (user._id.equals(objectId(actor)) && input.role === 'ACCESS_ADMIN' ? 1n : 0n)
        : null;
      if ((actualRevision?.toString() ?? null) !== input.revision)
        throw new ConflictException('Role changed. Refresh before editing.');
      if (input.role === 'ACCESS_ADMIN' && input.status === 'REVOKED' && old?.status === 'ACTIVE') {
        const active = await this.grants
          .aggregate(
            [
              { $match: { role: 'ACCESS_ADMIN', status: 'ACTIVE' } },
              {
                $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'owner' },
              },
              { $match: { 'owner.status': 'active' } },
              { $count: 'total' },
            ],
            { session },
          )
          .toArray();
        if (((active[0]?.['total'] as number) ?? 0) <= 1)
          throw new ConflictException('The last access administrator cannot be removed.');
      }
      const now = new Date();
      await this.grants.updateOne(
        { userId: user._id, role: input.role },
        {
          $set: { status: input.status, updatedAt: now },
          $inc: { revision: toLong(1n) },
          $setOnInsert: { _id: new ObjectId(), schemaVersion: 2, createdAt: now },
        },
        { upsert: true, session },
      );
      await this.audit(
        actor,
        `ROLE_${input.status}_${input.role}`,
        user._id,
        input.reason,
        session,
      );
      await onUpdated?.(session);
      return { updated: true };
    });
  }
  async auditList(actor: string) {
    return this.transaction(actor, 'AUDITOR', async (session) => ({
      entries: (
        await this.database.db
          .collection('adminAudit')
          .find({}, { session })
          .sort({ createdAt: -1, _id: -1 })
          .limit(50)
          .toArray()
      ).map((row) => ({
        id: row._id.toHexString(),
        action: row['action'] as string,
        reason: row['reason'] as string,
        createdAt: (row['createdAt'] as Date).toISOString(),
      })),
    }));
  }
  async networkList(actor: string) {
    return this.transaction(actor, 'ASSET_ADMIN', async (session) => ({
      networks: (
        await this.networks.networks
          .find({}, { session })
          .sort({ displayName: 1 })
          .limit(100)
          .toArray()
      ).map((network) => ({ ...networkView(network), rpcUrl: network.rpcUrl })),
    }));
  }
  async createNetwork(actor: string, value: unknown) {
    await this.transaction(actor, 'ASSET_ADMIN', async () => undefined);
    const prepared = await this.networks.prepare(value);
    return this.transaction(actor, 'ASSET_ADMIN', async (session) => {
      const network = await this.networks.create(prepared, session);
      await this.audit(actor, 'NETWORK_VERIFIED', network._id, prepared.reason, session);
      await this.database.db.collection('configurationRevisions').insertOne(
        {
          entityId: network._id,
          revision: network.revision,
          value: { ...networkView(network), rpcUrl: network.rpcUrl },
          actorId: objectId(actor),
          reason: prepared.reason,
          createdAt: new Date(),
        },
        { session },
      );
      return { network: networkView(network) };
    });
  }
  async networkStatus(actor: string, id: string, value: unknown) {
    const input = parseInput(
      z.strictObject({
        revision: z.string().regex(/^(0|[1-9][0-9]*)$/),
        status: z.enum(['ACTIVE', 'PAUSED']),
        reason: z.string().trim().min(3).max(200),
        rpcUrl: z.string().max(500).optional(),
        displayName: z.string().trim().min(1).max(60).optional(),
      }),
      value,
    );
    await this.transaction(actor, 'ASSET_ADMIN', async () => undefined);
    const old = await this.networks.networks.findOne({ _id: objectId(id) });
    if (!old) throw new NotFoundException();
    const provider = {
      ...old,
      rpcUrl:
        input.rpcUrl === undefined
          ? old.rpcUrl
          : rpcUrl(input.rpcUrl, this.environment, old.environment === 'LOCAL').href,
    };
    if (
      (input.status === 'ACTIVE' || provider.rpcUrl !== old.rpcUrl) &&
      (await this.networks.identity(provider)) !== old.genesisHash
    )
      throw new ConflictException('Network identity changed.');
    return this.transaction(actor, 'ASSET_ADMIN', async (session) => {
      const row = await this.networks.networks.findOneAndUpdate(
        { _id: old._id, revision: toLong(BigInt(input.revision)) },
        {
          $set: {
            status: input.status,
            rpcUrl: provider.rpcUrl,
            displayName: input.displayName ?? old.displayName,
            updatedAt: new Date(),
          },
          $inc: { revision: toLong(1n) },
        },
        { session, returnDocument: 'after' },
      );
      if (!row) throw new ConflictException('Network changed. Refresh before editing.');
      await this.audit(actor, `NETWORK_${input.status}`, row._id, input.reason, session);
      await this.database.db.collection('configurationRevisions').insertOne(
        {
          entityId: row._id,
          revision: row.revision,
          value: { ...networkView(row), rpcUrl: row.rpcUrl },
          actorId: objectId(actor),
          reason: input.reason,
          createdAt: new Date(),
        },
        { session },
      );
      return { network: networkView(row) };
    });
  }
}
