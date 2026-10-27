import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  type OnModuleInit,
} from '@nestjs/common';
import { ObjectId, type ClientSession, type Long } from 'mongodb';
import type { AssetV2, RecipientResolutionView, WalletV2 } from '@p2p/contracts';
import { DatabaseService } from '../../database/database.service.js';
import { AccountsService, objectId } from '../accounts/accounts.service.js';
import { collectionSchema, date, long, oid } from '../accounts/schema.js';
import { formatQuantity, toLong, units } from '../accounts/quantity.js';
import { IdentityEligibility } from '../auth/identity-eligibility.service.js';
import { parseInput, recipientLookupSchema } from '../assets/asset-input.js';
import type { AssetRecord } from '../accounts/accounts.models.js';
import type { WalletRecord } from './wallets.models.js';
import type { WalletBindingRecord } from './wallets.models.js';
import { getAddress } from 'ethers';
import { z } from 'zod';
import { TRANSACTION_OPTIONS } from '../accounts/accounts.service.js';
import { productPolicy } from '../configuration/policy-reader.js';

interface ResolutionRecord {
  _id: ObjectId;
  schemaVersion: 2;
  callerId: ObjectId;
  assetId: ObjectId;
  senderWalletId: ObjectId;
  recipientId: ObjectId;
  recipientWalletId: ObjectId;
  senderRevision: Long;
  recipientRevision: Long;
  assetRevision: Long;
  createdAt: Date;
  expiresAt: Date;
  policyRevision?: string;
}
export function demoAssetView(asset: AssetRecord): AssetV2 {
  return {
    id: asset._id.toHexString(),
    code: asset.code,
    symbol: asset.symbol ?? asset.code,
    displayName: asset.displayName,
    precision: asset.precision,
    kind: 'DEMO_CRYPTO',
    mode: 'SIMULATED',
    lifecycle: asset.lifecycle ?? (asset.status === 'active' ? 'ACTIVE' : 'PAUSED'),
    revision: asset.revision?.toString() ?? '0',
    identityKey: asset.identityKey ?? `demo:${asset._id}`,
    custodyEnabled: asset.custodyEnabled === true,
    ...(asset.capUnits
      ? { supplyCap: formatQuantity(units(asset.capUnits), asset.precision) }
      : {}),
    ...(asset.minimumUnits
      ? { minimum: formatQuantity(units(asset.minimumUnits), asset.precision) }
      : {}),
    ...(asset.maximumUnits
      ? { maximum: formatQuantity(units(asset.maximumUnits), asset.precision) }
      : {}),
  };
}
function isSimulatedAsset(asset: AssetRecord) {
  return (
    (!('mode' in asset) || asset.mode === 'SIMULATED') &&
    (!('kind' in asset) || asset.kind === 'DEMO_CRYPTO')
  );
}
@Injectable()
export class WalletsService implements OnModuleInit {
  constructor(
    @Inject(DatabaseService) readonly database: DatabaseService,
    @Inject(AccountsService) readonly accounts: AccountsService,
    @Inject(IdentityEligibility) readonly identities: IdentityEligibility,
  ) {}
  get wallets() {
    return this.database.db.collection<WalletRecord>('wallets', { promoteLongs: false });
  }
  get resolutions() {
    return this.database.db.collection<ResolutionRecord>('recipientResolutions', {
      promoteLongs: false,
    });
  }
  async onModuleInit() {
    await collectionSchema(
      this.database.db,
      'recipientResolutions',
      {
        schemaVersion: { enum: [2] },
        callerId: oid,
        assetId: oid,
        senderWalletId: oid,
        recipientId: oid,
        recipientWalletId: oid,
        senderRevision: long,
        recipientRevision: long,
        assetRevision: long,
        createdAt: date,
        expiresAt: date,
        policyRevision: { bsonType: 'string' },
      },
      [
        'schemaVersion',
        'callerId',
        'assetId',
        'senderWalletId',
        'recipientId',
        'recipientWalletId',
        'senderRevision',
        'recipientRevision',
        'assetRevision',
        'createdAt',
        'expiresAt',
      ],
      { additionalProperties: false },
    );
    await this.resolutions.createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0, name: 'resolution_expiry' },
    );
  }
  async own(userId: string): Promise<WalletV2> {
    const wallet = await this.wallets.findOne({ userId: objectId(userId) });
    if (!wallet)
      throw new ServiceUnavailableException({
        code: 'WALLET_MIGRATION_REQUIRED',
        message: 'This account needs wallet migration before using the new wallet.',
      });
    const balances = await this.accounts.wallet(userId);
    const bindings = await this.database.db
      .collection<WalletBindingRecord>('walletBindings', { promoteLongs: false })
      .find({ walletId: wallet._id })
      .toArray();
    const assets = await this.accounts.assets.find({}).sort({ code: 1 }).toArray();
    return {
      id: wallet._id.toHexString(),
      status: wallet.status,
      revision: wallet.eligibilityRevision.toString(),
      displayName: wallet.displayName ?? 'My wallet',
      configured: Boolean(wallet.setupCompletedAt),
      configurationRevision: wallet.configurationRevision?.toString() ?? '0',
      preferredAssetId: wallet.preferredAssetId?.toHexString() ?? null,
      bindings: bindings.map((binding) => ({
        id: binding._id.toHexString(),
        networkId: binding.networkId.toHexString(),
        address: getAddress(binding.normalizedAddress),
        status: binding.status,
        revision: binding.revision.toString(),
      })),
      holdings: balances.accounts
        .filter((balance) =>
          assets.some(
            (asset) => asset._id.toHexString() === balance.assetId && isSimulatedAsset(asset),
          ),
        )
        .map((balance) => ({
          asset: demoAssetView(
            assets.find((asset) => asset._id.toHexString() === balance.assetId)!,
          ),
          source: 'SIMULATED',
          balance: balance.balance,
          stale: false,
          status:
            wallet.status === 'ACTIVE' && balance.status === 'active' ? 'AVAILABLE' : 'UNAVAILABLE',
        })),
    };
  }
  async configure(caller: string, value: unknown) {
    const input = parseInput(
      z.strictObject({
        displayName: z.string().trim().min(1).max(60),
        preferredAssetId: z
          .string()
          .regex(/^[a-f0-9]{24}$/)
          .nullable(),
        revision: z.string().regex(/^(0|[1-9][0-9]*)$/),
      }),
      value,
    );
    const session = this.database.client.startSession();
    try {
      await session.withTransaction(async () => {
        const wallet = await this.wallets.findOne(
          { userId: objectId(caller), status: 'ACTIVE' },
          { session },
        );
        if (!wallet) throw new ConflictException('An active wallet is required.');
        if ((wallet.configurationRevision?.toString() ?? '0') !== input.revision)
          throw new ConflictException('Wallet settings changed. Refresh before saving.');
        if (
          input.preferredAssetId &&
          !(await this.accounts.assets.findOne(
            { _id: objectId(input.preferredAssetId), status: 'active' },
            { session },
          ))
        )
          throw new ConflictException('Preferred asset is unavailable.');
        await this.wallets.updateOne(
          { _id: wallet._id },
          {
            $set: {
              displayName: input.displayName,
              preferredAssetId: input.preferredAssetId ? objectId(input.preferredAssetId) : null,
              setupCompletedAt: new Date(),
              updatedAt: new Date(),
            },
            $inc: { configurationRevision: toLong(1n) },
          },
          { session },
        );
      }, TRANSACTION_OPTIONS);
    } finally {
      await session.endSession();
    }
    return { wallet: await this.own(caller) };
  }
  async catalogue() {
    return {
      assets: (
        await this.accounts.assets
          .find({ lifecycle: { $ne: 'DRAFT' } })
          .sort({ code: 1 })
          .limit(100)
          .toArray()
      ).map(demoAssetView),
    };
  }
  async resolve(caller: string, value: unknown): Promise<RecipientResolutionView> {
    const input = parseInput(recipientLookupSchema, value);
    await this.accounts.throttle(caller, 'v2-peer', 120);
    const sender = await this.wallets.findOne({
      _id: objectId(input.senderWalletId),
      userId: objectId(caller),
      status: 'ACTIVE',
    });
    const asset = await this.accounts.assets.findOne({
      _id: objectId(input.assetId),
      status: 'active',
    });
    let recipient: WalletRecord | null = null;
    if (input.lookup.kind === 'HANDLE') {
      const peer = await this.identities.peer(input.lookup.value);
      if (peer)
        recipient = await this.wallets.findOne({ userId: objectId(peer.id), status: 'ACTIVE' });
    } else if (input.lookup.kind === 'WALLET_ID')
      recipient = await this.wallets.findOne({
        _id: objectId(input.lookup.value),
        status: 'ACTIVE',
      });
    // V2 demo resolution never treats a raw chain address as a simulated peer.
    if (
      !sender ||
      !asset ||
      !isSimulatedAsset(asset) ||
      !asset.custodyEnabled ||
      !recipient ||
      sender.userId.equals(recipient.userId)
    )
      throw new NotFoundException('Recipient is unavailable.');
    const peer = await this.identities.profile(recipient.userId);
    if (
      !peer ||
      !(await this.identities.profile(sender.userId)) ||
      !(await this.database.db
        .collection('users')
        .findOne({ _id: recipient.userId, status: 'active' }))
    )
      throw new NotFoundException('Recipient is unavailable.');
    const now = new Date();
    const policy = await productPolicy(this.accounts.policies);
    const resolution: ResolutionRecord = {
      _id: new ObjectId(),
      schemaVersion: 2,
      callerId: objectId(caller),
      assetId: asset._id,
      senderWalletId: sender._id,
      recipientId: recipient.userId,
      recipientWalletId: recipient._id,
      senderRevision: sender.eligibilityRevision,
      recipientRevision: recipient.eligibilityRevision,
      assetRevision: asset.revision ?? toLong(0n),
      createdAt: now,
      expiresAt: new Date(now.getTime() + policy.values.reviewSeconds * 1000),
      policyRevision: policy.revision,
    };
    await this.resolutions.insertOne(resolution, { writeConcern: { w: 'majority' } });
    return {
      resolutionId: resolution._id.toHexString(),
      expiresAt: resolution.expiresAt.toISOString(),
      recipient: {
        userId: peer.id,
        publicHandle: peer.publicHandle,
        displayName: peer.displayName,
        walletId: recipient._id.toHexString(),
      },
      destination: { mode: 'SIMULATED' },
      revisions: {
        senderWallet: sender.eligibilityRevision.toString(),
        recipientWallet: recipient.eligibilityRevision.toString(),
        asset: resolution.assetRevision.toString(),
      },
    };
  }
  async reviewed(caller: string, resolutionId: string, walletId: string, assetId: string) {
    const resolution = await this.resolutions.findOne({
      _id: objectId(resolutionId),
      callerId: objectId(caller),
      senderWalletId: objectId(walletId),
      assetId: objectId(assetId),
      expiresAt: { $gt: new Date() },
    });
    if (!resolution)
      throw new ConflictException({
        code: 'REVIEW_REQUIRED',
        message: 'Resolve and review the recipient again.',
      });
    if (
      (resolution.policyRevision ?? '0') !== (await productPolicy(this.accounts.policies)).revision
    )
      throw new ConflictException({
        code: 'REVIEW_REQUIRED',
        message: 'Product policy changed. Your entries are retained; review again.',
      });
    for (const [id, revision] of [
      [resolution.senderWalletId, resolution.senderRevision],
      [resolution.recipientWalletId, resolution.recipientRevision],
    ] as const) {
      if (
        !(await this.wallets.findOne({ _id: id, status: 'ACTIVE', eligibilityRevision: revision }))
      )
        throw new ConflictException({
          code: 'REVIEW_REQUIRED',
          message: 'Wallet availability changed. Review again.',
        });
    }
    const asset = await this.accounts.assets.findOne({ _id: resolution.assetId, status: 'active' });
    if (
      !asset ||
      !isSimulatedAsset(asset) ||
      (asset.revision?.toString() ?? '0') !== resolution.assetRevision.toString()
    )
      throw new ConflictException({
        code: 'REVIEW_REQUIRED',
        message: 'Asset availability changed. Review again.',
      });
    return resolution;
  }
  async fence(userId: ObjectId, session: ClientSession) {
    return this.wallets.findOneAndUpdate(
      { userId, status: 'ACTIVE' },
      { $inc: { eligibilityRevision: toLong(1n) }, $set: { updatedAt: new Date() } },
      { session, returnDocument: 'after' },
    );
  }
}
