import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  type OnModuleInit,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { MongoServerError, ObjectId, type ClientSession } from 'mongodb';
import type { WalletResponse } from '@p2p/contracts';
import { DatabaseService } from '../../database/database.service.js';
import { IdentityEligibility } from '../auth/identity-eligibility.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { collectionSchema, date, long, oid, status, text } from './schema.js';
import type { AccountRecord, AssetRecord, IssuanceRecord } from './accounts.models.js';
import { formatQuantity, MAX_UNITS, MIN_UNITS, toLong, units } from './quantity.js';
import { CustodyService } from '../custody/custody.service.js';
import { BusinessRejection } from '../transfers/transfers.models.js';
import type { WalletRecord } from '../wallets/wallets.models.js';
import { PolicyReader, productPolicy } from '../configuration/policy-reader.js';

export const TRANSACTION_OPTIONS = {
  readConcern: { level: 'snapshot' as const },
  writeConcern: { w: 'majority' as const },
  readPreference: 'primary' as const,
  timeoutMS: 10000,
};
export function objectId(value: unknown): ObjectId {
  if (typeof value !== 'string' || !/^[0-9a-f]{24}$/.test(value))
    throw new BadRequestException('Invalid identifier.');
  return new ObjectId(value);
}
export function strictObject(value: unknown, keys: string[]) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key)) ||
    keys.some((key) => !(key in value))
  )
    throw new BadRequestException('Invalid request fields.');
  return value as Record<string, unknown>;
}
@Injectable()
export class AccountsService implements OnModuleInit {
  rateNow: () => number = () => Date.now();
  constructor(
    @Inject(DatabaseService) readonly database: DatabaseService,
    @Inject(IdentityEligibility) readonly identities: IdentityEligibility,
    @Inject(LedgerService) readonly ledger: LedgerService,
    @Inject(CustodyService) readonly custody: CustodyService,
    @Optional() @Inject(PolicyReader) readonly policies?: PolicyReader,
  ) {}
  get assets() {
    return this.database.db.collection<AssetRecord>('assetTypes', { promoteLongs: false });
  }
  get accounts() {
    return this.database.db.collection<AccountRecord>('accounts', { promoteLongs: false });
  }
  get issuances() {
    return this.database.db.collection<IssuanceRecord>('demoIssuances', { promoteLongs: false });
  }
  async onModuleInit() {
    await collectionSchema(
      this.database.db,
      'assetTypes',
      {
        code: text,
        displayName: text,
        precision: { bsonType: 'int', minimum: 0, maximum: 8 },
        status,
        createdAt: date,
        schemaVersion: { enum: [2] },
        custodyEnabled: { bsonType: 'bool' },
        kind: { enum: ['DEMO_CRYPTO'] },
        mode: { enum: ['SIMULATED'] },
        lifecycle: { enum: ['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED'] },
        revision: { ...long, minimum: toLong(0n) },
        identityKey: text,
        symbol: text,
        capUnits: { ...long, minimum: toLong(1n) },
        minimumUnits: { ...long, minimum: toLong(1n) },
        maximumUnits: { ...long, minimum: toLong(1n) },
      },
      ['code', 'displayName', 'precision', 'status', 'createdAt'],
    );
    await collectionSchema(
      this.database.db,
      'accounts',
      {
        ownerType: { enum: ['user', 'system'] },
        userId: oid,
        walletId: oid,
        systemKey: text,
        assetId: oid,
        balanceUnits: long,
        status,
        createdAt: date,
        updatedAt: date,
      },
      ['ownerType', 'assetId', 'balanceUnits', 'status', 'createdAt', 'updatedAt'],
      {
        oneOf: [
          {
            properties: {
              ownerType: { enum: ['user'] },
              balanceUnits: { ...long, minimum: toLong(0n) },
            },
            required: ['userId'],
            not: { required: ['systemKey'] },
          },
          {
            properties: {
              ownerType: { enum: ['system'] },
              balanceUnits: { ...long, maximum: toLong(0n) },
              systemKey: { enum: ['demo-issuance'] },
            },
            required: ['systemKey'],
            not: { anyOf: [{ required: ['userId'] }, { required: ['walletId'] }] },
          },
        ],
      },
    );
    await collectionSchema(this.database.db, 'demoIssuances', {
      fixtureKey: text,
      assetId: oid,
      systemAccountId: oid,
      recipientAccountId: oid,
      quantityUnits: { ...long, minimum: toLong(1n) },
      createdAt: date,
    });
    await collectionSchema(this.database.db, 'transferRateLimits', {
      _id: text,
      hits: { bsonType: ['int', 'long', 'double'] },
      expiresAt: date,
    });
    await this.assets.createIndex({ code: 1 }, { unique: true, name: 'asset_code' });
    await this.assets.createIndex(
      { identityKey: 1 },
      {
        unique: true,
        partialFilterExpression: { identityKey: { $type: 'string' } },
        name: 'asset_identity',
      },
    );
    await this.accounts.createIndex(
      { userId: 1, assetId: 1 },
      { unique: true, partialFilterExpression: { ownerType: 'user' }, name: 'account_user_asset' },
    );
    await this.accounts.createIndex(
      { systemKey: 1, assetId: 1 },
      {
        unique: true,
        partialFilterExpression: { ownerType: 'system' },
        name: 'account_system_asset',
      },
    );
    await this.issuances.createIndex({ fixtureKey: 1 }, { unique: true, name: 'issuance_fixture' });
    await this.accounts.createIndex(
      { walletId: 1, assetId: 1 },
      {
        unique: true,
        partialFilterExpression: { ownerType: 'user', walletId: { $type: 'objectId' } },
        name: 'account_wallet_asset',
      },
    );
    await this.database.db
      .collection('transferRateLimits')
      .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'transfer_limit_expiry' });
  }
  async throttle(userId: string, action: string, limit: number) {
    const policy = (await productPolicy(this.policies)).values;
    if (['peer', 'v2-peer'].includes(action)) limit = policy.lookupPerMinute;
    if (['read', 'v2-read'].includes(action)) limit = policy.readsPerMinute;
    if (['submit', 'v2-review-submit'].includes(action)) limit = policy.admissionsPerMinute;
    const bucket = Math.floor(this.rateNow() / 60000);
    const _id = createHash('sha256').update(`${userId}:${action}:${bucket}`).digest('hex');
    const limits = this.database.db.collection<{ _id: string; hits: number; expiresAt: Date }>(
      'transferRateLimits',
    );
    let hits;
    try {
      hits = await limits.findOneAndUpdate(
        { _id },
        { $inc: { hits: 1 }, $setOnInsert: { expiresAt: new Date((bucket + 2) * 60000) } },
        { upsert: true, returnDocument: 'after' },
      );
    } catch (error) {
      if (!(error instanceof MongoServerError) || error.code !== 11000) throw error;
      hits = await limits.findOneAndUpdate(
        { _id },
        { $inc: { hits: 1 } },
        { returnDocument: 'after' },
      );
    }
    if (hits!.hits > limit) throw new HttpException('Too many requests. Try again later.', 429);
  }
  async wallet(userId: string): Promise<WalletResponse> {
    const assets = await this.assets.find({}).sort({ code: 1 }).toArray();
    const accounts = await this.accounts
      .find({ ownerType: 'user', userId: objectId(userId) })
      .toArray();
    return {
      accounts: assets.map((asset) => {
        const account = accounts.find((a) => a.assetId.equals(asset._id));
        return {
          assetId: asset._id.toHexString(),
          code: asset.code,
          displayName: asset.displayName,
          precision: asset.precision,
          balance: formatQuantity(account ? units(account.balanceUnits) : 0n, asset.precision),
          status:
            asset.status === 'disabled' || account?.status === 'disabled' ? 'disabled' : 'active',
        };
      }),
    };
  }
  async peer(value: unknown) {
    if (typeof value !== 'string' || value.length > 64)
      throw new BadRequestException('Invalid public handle.');
    const handle = value.trim().toLowerCase();
    if (!/^[a-z][a-z0-9_]{2,23}$/.test(handle))
      throw new BadRequestException('Invalid public handle.');
    const peer = await this.identities.peer(handle);
    if (!peer) throw new NotFoundException('Peer is unavailable.');
    return { peer };
  }
  async ensureUser(
    userId: ObjectId,
    assetId: ObjectId,
    session: ClientSession,
    walletId?: ObjectId,
  ): Promise<AccountRecord> {
    const now = new Date();
    const account = (await this.accounts.findOneAndUpdate(
      { ownerType: 'user', userId, assetId },
      {
        $setOnInsert: {
          _id: new ObjectId(),
          balanceUnits: toLong(0n),
          status: 'active',
          createdAt: now,
          updatedAt: now,
          ...(walletId ? { walletId } : {}),
        },
      },
      { session, upsert: true, returnDocument: 'after' },
    ))!;
    if (walletId && !account.walletId?.equals(walletId))
      throw new Error('Account wallet linkage requires reconciliation.');
    return account;
  }
  async createAsset(
    input: { code: string; displayName: string; precision: number },
    retries = 2,
  ): Promise<AssetRecord> {
    if (
      !/^[A-Z][A-Z0-9_]{1,15}$/.test(input.code) ||
      !input.displayName ||
      input.displayName.length > 80 ||
      !Number.isInteger(input.precision) ||
      input.precision < 0 ||
      input.precision > 8
    )
      throw new BadRequestException('Invalid asset.');
    const existing = await this.assets.findOne({ code: input.code });
    if (existing) {
      if (existing.precision !== input.precision || existing.displayName !== input.displayName)
        throw new ConflictException('Asset definition conflicts.');
      return existing;
    }
    const id = new ObjectId();
    const record: AssetRecord = {
      _id: id,
      ...input,
      schemaVersion: 2,
      custodyEnabled: true,
      kind: 'DEMO_CRYPTO',
      mode: 'SIMULATED',
      lifecycle: 'ACTIVE',
      revision: toLong(0n),
      identityKey: `demo:${id}`,
      symbol: input.code,
      status: 'active',
      createdAt: new Date(),
    };
    const session = this.database.client.startSession();
    try {
      await session.withTransaction(async () => {
        await this.assets.insertOne(record, { session });
        await this.database.db.collection('custodyHeads').insertOne(
          {
            _id: new ObjectId(),
            assetId: record._id,
            sequence: toLong(0n),
            hash: '0'.repeat(64),
          },
          { session },
        );
        await this.database.db.collection('chainHeads').insertOne(
          {
            _id: new ObjectId(),
            assetId: record._id,
            latestSequence: toLong(0n),
            latestHash: '0'.repeat(64),
            transfersEnabled: true,
          },
          { session },
        );
      }, TRANSACTION_OPTIONS);
      return record;
    } catch (error) {
      if (
        error instanceof MongoServerError &&
        error.code === 11000 &&
        retries > 0 &&
        (await this.assets.findOne({ code: input.code }))
      )
        return this.createAsset(input, retries - 1);
      throw error;
    } finally {
      await session.endSession();
    }
  }
  async setAssetStatus(assetId: ObjectId, state: 'active' | 'disabled') {
    const session = this.database.client.startSession();
    try {
      await session.withTransaction(async () => {
        if (
          (
            await this.assets.updateOne(
              { _id: assetId },
              {
                $set: { status: state, lifecycle: state === 'active' ? 'ACTIVE' : 'PAUSED' },
                $inc: { revision: toLong(1n) },
              },
              { session },
            )
          ).matchedCount !== 1
        )
          throw new NotFoundException();
        await this.database.db
          .collection('chainHeads')
          .updateOne({ assetId }, { $set: { transfersEnabled: state === 'active' } }, { session });
      }, TRANSACTION_OPTIONS);
    } finally {
      await session.endSession();
    }
  }
  async setAccountStatus(accountId: ObjectId, state: 'active' | 'disabled') {
    await this.accounts.updateOne(
      { _id: accountId },
      { $set: { status: state, updatedAt: new Date() } },
      { writeConcern: { w: 'majority' } },
    );
  }
  async issueDemo(
    input: {
      fixtureKey: string;
      userId: ObjectId;
      assetId: ObjectId;
      quantityUnits: bigint;
      authorize?: (session: ClientSession) => Promise<void>;
      onCreated?: (issuance: IssuanceRecord, session: ClientSession) => Promise<void>;
    },
    retries = 2,
  ): Promise<IssuanceRecord> {
    if (
      !/^[a-zA-Z0-9:_-]{1,120}$/.test(input.fixtureKey) ||
      input.quantityUnits <= 0n ||
      input.quantityUnits > MAX_UNITS
    )
      throw new BadRequestException('Invalid issuance.');
    const session = this.database.client.startSession();
    try {
      return await session.withTransaction(async () => {
        await input.authorize?.(session);
        const old = await this.issuances.findOne({ fixtureKey: input.fixtureKey }, { session });
        if (old) {
          const account = await this.accounts.findOne({ _id: old.recipientAccountId }, { session });
          if (
            !old.assetId.equals(input.assetId) ||
            !account?.userId?.equals(input.userId) ||
            units(old.quantityUnits) !== input.quantityUnits
          )
            throw new ConflictException('Fixture key conflicts.');
          return old;
        }
        if (
          await this.database.db
            .collection('applicationState')
            .findOne({ key: 'maintenance', active: true }, { session })
        )
          throw new HttpException('Wallet maintenance in progress. Try again later.', 503);
        const asset = await this.assets.findOne(
          { _id: input.assetId, status: 'active' },
          { session },
        );
        if (!asset || !(await this.identities.fence(input.userId, session)))
          throw new BadRequestException('Issuance recipient or asset unavailable.');
        if (
          (
            await this.database.db
              .collection('chainHeads')
              .updateOne(
                { assetId: input.assetId, transfersEnabled: true },
                { $inc: { issuanceRevision: 1 } },
                { session },
              )
          ).matchedCount !== 1
        )
          throw new BadRequestException('Asset unavailable.');
        const wallets = await this.prepareWallets(input.assetId, [input.userId], session);
        const wallet = wallets?.get(input.userId.toHexString());
        const recipient = await this.ensureUser(input.userId, input.assetId, session, wallet?._id);
        const now = new Date();
        const system = (await this.accounts.findOneAndUpdate(
          { ownerType: 'system', systemKey: 'demo-issuance', assetId: input.assetId },
          {
            $setOnInsert: {
              _id: new ObjectId(),
              balanceUnits: toLong(0n),
              status: 'active',
              createdAt: now,
              updatedAt: now,
            },
          },
          { session, upsert: true, returnDocument: 'after' },
        ))!;
        if (
          units(system.balanceUnits) - input.quantityUnits < MIN_UNITS ||
          units(recipient.balanceUnits) + input.quantityUnits > MAX_UNITS ||
          recipient.status !== 'active' ||
          system.status !== 'active' ||
          (asset.capUnits &&
            -units(system.balanceUnits) + input.quantityUnits > units(asset.capUnits))
        )
          throw new BadRequestException('Issuance balance limit or account status.');
        await this.accounts.updateOne(
          { _id: system._id },
          { $inc: { balanceUnits: toLong(-input.quantityUnits) }, $set: { updatedAt: now } },
          { session },
        );
        await this.accounts.updateOne(
          { _id: recipient._id },
          { $inc: { balanceUnits: toLong(input.quantityUnits) }, $set: { updatedAt: now } },
          { session },
        );
        const issuance: IssuanceRecord = {
          _id: new ObjectId(),
          fixtureKey: input.fixtureKey,
          assetId: input.assetId,
          systemAccountId: system._id,
          recipientAccountId: recipient._id,
          quantityUnits: toLong(input.quantityUnits),
          createdAt: now,
        };
        await this.issuances.insertOne(issuance, { session });
        await this.ledger.pair(
          {
            referenceKind: 'demoIssuance',
            referenceId: issuance._id,
            debitAccountId: system._id,
            creditAccountId: recipient._id,
            assetId: input.assetId,
            quantityUnits: input.quantityUnits,
            createdAt: now,
          },
          session,
        );
        if (wallet)
          await this.custody.write(
            {
              kind: 'ISSUE',
              referenceId: issuance._id,
              assetId: input.assetId,
              recipient: { walletId: wallet._id, accountId: recipient._id },
              quantity: input.quantityUnits,
              at: now,
            },
            session,
          );
        await input.onCreated?.(issuance, session);
        return issuance;
      }, TRANSACTION_OPTIONS);
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000 && retries > 0)
        return this.issueDemo(input, retries - 1);
      throw error;
    } finally {
      await session.endSession();
    }
  }
  async prepareWallets(assetId: ObjectId, users: ObjectId[], session: ClientSession) {
    const asset = await this.assets.findOne({ _id: assetId }, { session });
    if (!asset?.custodyEnabled) return undefined;
    const result = new Map<string, WalletRecord>();
    for (const userId of [...users].sort((a, b) =>
      a.toHexString().localeCompare(b.toHexString()),
    )) {
      const wallet = await this.database.db
        .collection<WalletRecord>('wallets', { promoteLongs: false })
        .findOneAndUpdate(
          { userId, status: 'ACTIVE' },
          { $inc: { eligibilityRevision: toLong(1n) }, $set: { updatedAt: new Date() } },
          { session, returnDocument: 'after' },
        );
      if (!wallet) throw new BusinessRejection('WALLET_UNAVAILABLE');
      result.set(userId.toHexString(), wallet);
    }
    return result;
  }
}
