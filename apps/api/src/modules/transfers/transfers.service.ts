import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  type OnModuleInit,
} from '@nestjs/common';
import { MongoServerError, ObjectId } from 'mongodb';
import type { TransferRejectionCode, TransferView, SimulatedTransferV2View } from '@p2p/contracts';
import { DatabaseService } from '../../database/database.service.js';
import {
  AccountsService,
  objectId,
  strictObject,
  TRANSACTION_OPTIONS,
} from '../accounts/accounts.service.js';
import { formatQuantity, MAX_UNITS, parseQuantity, toLong, units } from '../accounts/quantity.js';
import { collectionSchema, date, long, oid, text } from '../accounts/schema.js';
import { IdentityEligibility } from '../auth/identity-eligibility.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { ChainService } from '../chain/chain.service.js';
import { OutboxService } from '../../workers/outbox.service.js';
import { BusinessRejection, LostClaim, type TransferRecord } from './transfers.models.js';
import { CustodyLimitExceeded } from '../custody/custody.service.js';
import { WalletsService } from '../wallets/wallets.service.js';
import { parseInput, sendIntentSchema } from '../assets/asset-input.js';
interface ReviewedDemoIntent {
  senderWalletId: ObjectId;
  recipientWalletId: ObjectId;
  recipientResolutionId: ObjectId;
}

export const LEASE_MS = 30000;
export const REJECTION_CODES = [
  'INSUFFICIENT_BALANCE',
  'RECIPIENT_UNAVAILABLE',
  'SENDER_UNAVAILABLE',
  'ACCOUNT_UNAVAILABLE',
  'ASSET_UNAVAILABLE',
  'BALANCE_LIMIT_EXCEEDED',
  'WALLET_UNAVAILABLE',
  'LOT_LIMIT_EXCEEDED',
  'QUANTITY_LIMIT_EXCEEDED',
] as const;
export function normalizeKey(value: unknown) {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  )
    throw new BadRequestException('Idempotency-Key must be a UUID.');
  return value.toLowerCase();
}
export function payloadHash(
  senderId: string,
  recipientId: string,
  assetId: string,
  quantity: bigint,
) {
  return createHash('sha256')
    .update(JSON.stringify([1, senderId, recipientId, assetId, quantity.toString()]))
    .digest('hex');
}
export function transferView(record: TransferRecord): TransferView {
  return {
    id: record._id.toHexString(),
    sender: record.sender,
    recipient: record.recipient,
    asset: record.asset,
    quantity: formatQuantity(units(record.quantityUnits), record.asset.precision),
    status: record.status,
    rejectionCode: record.rejectionCode,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
export function retryDelay(attempts: number, random = Math.random) {
  return Math.min(60000, 1000 * 2 ** Math.min(attempts, 6)) + Math.floor(random() * 500);
}
@Injectable()
export class TransfersService implements OnModuleInit {
  now: () => Date = () => new Date();
  fault: ((stage: string) => Promise<void>) | undefined;
  constructor(
    @Inject(DatabaseService) readonly database: DatabaseService,
    @Inject(AccountsService) readonly accounts: AccountsService,
    @Inject(IdentityEligibility) readonly identities: IdentityEligibility,
    @Inject(LedgerService) readonly ledger: LedgerService,
    @Inject(ChainService) readonly chain: ChainService,
    @Inject(OutboxService) readonly outbox: OutboxService,
    @Inject(WalletsService) readonly wallets: WalletsService,
  ) {}
  get transfers() {
    return this.database.db.collection<TransferRecord>('transfers', { promoteLongs: false });
  }
  async onModuleInit() {
    const peer = {
      bsonType: 'object',
      required: ['id', 'publicHandle', 'displayName'],
      properties: { id: text, publicHandle: text, displayName: text },
    };
    await collectionSchema(
      this.database.db,
      'transfers',
      {
        senderId: oid,
        recipientId: oid,
        assetId: oid,
        quantityUnits: { ...long, minimum: toLong(1n) },
        idempotencyKey: text,
        payloadVersion: { enum: [1, 2] },
        mode: { enum: ['SIMULATED'] },
        senderWalletId: oid,
        recipientWalletId: oid,
        recipientResolutionId: oid,
        payloadHash: text,
        status: { enum: ['PENDING', 'COMMITTED', 'REJECTED'] },
        rejectionCode: { enum: [null, ...REJECTION_CODES] },
        sender: peer,
        recipient: peer,
        asset: {
          bsonType: 'object',
          required: ['id', 'code', 'displayName', 'precision'],
          properties: {
            id: text,
            code: text,
            displayName: text,
            precision: { bsonType: 'int', minimum: 0, maximum: 8 },
          },
        },
        attemptToken: { bsonType: ['string', 'null'] },
        leaseUntil: { bsonType: ['date', 'null'] },
        attempts: { bsonType: 'int', minimum: 0 },
        nextAttemptAt: date,
        createdAt: date,
        updatedAt: date,
        senderAccountId: oid,
        recipientAccountId: oid,
        committedAt: date,
        executionRevision: { bsonType: 'int' },
      },
      [
        'senderId',
        'recipientId',
        'assetId',
        'quantityUnits',
        'idempotencyKey',
        'payloadVersion',
        'payloadHash',
        'status',
        'rejectionCode',
        'sender',
        'recipient',
        'asset',
        'attemptToken',
        'leaseUntil',
        'attempts',
        'nextAttemptAt',
        'createdAt',
        'updatedAt',
      ],
      {
        allOf: [
          {
            oneOf: [
              {
                properties: { payloadVersion: { enum: [1] } },
                not: {
                  anyOf: [
                    { required: ['mode'] },
                    { required: ['senderWalletId'] },
                    { required: ['recipientWalletId'] },
                    { required: ['recipientResolutionId'] },
                  ],
                },
              },
              {
                properties: { payloadVersion: { enum: [2] } },
                required: ['mode', 'senderWalletId', 'recipientWalletId', 'recipientResolutionId'],
              },
            ],
          },
        ],
        oneOf: [
          {
            properties: { status: { enum: ['PENDING'] }, rejectionCode: { enum: [null] } },
            not: { required: ['committedAt'] },
          },
          {
            properties: {
              status: { enum: ['REJECTED'] },
              rejectionCode: { enum: REJECTION_CODES },
            },
            not: { required: ['committedAt'] },
          },
          {
            properties: { status: { enum: ['COMMITTED'] }, rejectionCode: { enum: [null] } },
            required: ['committedAt', 'senderAccountId', 'recipientAccountId'],
          },
        ],
      },
    );
    await this.transfers.createIndex(
      { senderId: 1, idempotencyKey: 1 },
      { unique: true, name: 'transfer_sender_key' },
    );
    await this.transfers.createIndex(
      { senderId: 1, createdAt: -1, _id: -1 },
      { name: 'transfer_sender_history' },
    );
    await this.transfers.createIndex(
      { recipientId: 1, createdAt: -1, _id: -1 },
      { name: 'transfer_recipient_history' },
    );
    await this.transfers.createIndex(
      { status: 1, nextAttemptAt: 1, _id: 1 },
      { name: 'transfer_recovery' },
    );
  }
  async submit(
    sender: string,
    input: unknown,
    key: unknown,
    reviewed?: ReviewedDemoIntent,
  ): Promise<{ transfer: TransferView; statusCode: number }> {
    const body = strictObject(input, ['recipientId', 'assetId', 'quantity']);
    const senderId = objectId(sender);
    const recipientId = objectId(body['recipientId']);
    const assetId = objectId(body['assetId']);
    const idempotencyKey = normalizeKey(key);
    if (senderId.equals(recipientId)) throw new BadRequestException('Cannot transfer to yourself.');
    let record = await this.transfers.findOne({ senderId, idempotencyKey });
    if (record && record.payloadVersion !== (reviewed ? 2 : 1))
      throw new ConflictException({
        code: 'IDEMPOTENCY_CONFLICT',
        message: 'This request key belongs to another API version.',
      });
    // A durable key already fixes these identities, even if the replacement asset is unknown.
    if (record && (!record.recipientId.equals(recipientId) || !record.assetId.equals(assetId)))
      throw new ConflictException({
        statusCode: 409,
        code: 'IDEMPOTENCY_CONFLICT',
        message: 'This request key belongs to another transfer intent.',
      });
    const asset =
      record?.asset.id === assetId.toHexString()
        ? { _id: assetId, ...record.asset }
        : await this.accounts.assets.findOne({ _id: assetId });
    if (!asset) throw new BadRequestException('Unsupported asset.');
    const quantity = parseQuantity(body['quantity'], asset.precision);
    const hash = reviewed
      ? createHash('sha256')
          .update(
            JSON.stringify([
              2,
              sender,
              recipientId.toHexString(),
              assetId.toHexString(),
              quantity.toString(),
              reviewed.senderWalletId.toHexString(),
              reviewed.recipientWalletId.toHexString(),
              reviewed.recipientResolutionId.toHexString(),
            ]),
          )
          .digest('hex')
      : payloadHash(sender, recipientId.toHexString(), assetId.toHexString(), quantity);
    if (record && record.payloadHash !== hash)
      throw new ConflictException({
        statusCode: 409,
        code: 'IDEMPOTENCY_CONFLICT',
        message: 'This request key belongs to another transfer intent.',
      });
    let created = false;
    if (!record) {
      if (
        await this.database.db
          .collection('applicationState')
          .findOne({ key: 'maintenance', active: true })
      )
        throw new ServiceUnavailableException('Wallet maintenance in progress. Try again later.');
      await this.accounts.throttle(sender, 'submit', 60);
      const senderProfile = await this.identities.profile(senderId);
      if (!senderProfile) throw new BadRequestException('Sender unavailable.');
      const recipient = (await this.identities.profile(recipientId)) ?? {
        id: recipientId.toHexString(),
        publicHandle: 'unavailable',
        displayName: 'Unavailable peer',
      };
      const now = this.now();
      record = {
        _id: new ObjectId(),
        senderId,
        recipientId,
        assetId,
        quantityUnits: toLong(quantity),
        idempotencyKey,
        payloadVersion: reviewed ? 2 : 1,
        ...(reviewed ? { mode: 'SIMULATED' as const, ...reviewed } : {}),
        payloadHash: hash,
        status: 'PENDING',
        rejectionCode: null,
        sender: senderProfile,
        recipient,
        asset: {
          id: assetId.toHexString(),
          code: asset.code,
          displayName: asset.displayName,
          precision: asset.precision,
        },
        attemptToken: null,
        leaseUntil: null,
        attempts: 0,
        nextAttemptAt: now,
        createdAt: now,
        updatedAt: now,
      };
      try {
        await this.transfers.insertOne(record, {
          writeConcern: { w: 'majority' },
          timeoutMS: 5000,
        });
        created = true;
      } catch (error) {
        // Reconcile even a failed acknowledgement by durable sender/key, never create another identity.
        const stored = await this.transfers.findOne({ senderId, idempotencyKey });
        if (!stored)
          throw new ServiceUnavailableException(
            'Unable to confirm admission. Retry the same request key.',
          );
        if (stored.payloadHash !== hash)
          throw new ConflictException({
            statusCode: 409,
            code: 'IDEMPOTENCY_CONFLICT',
            message: 'This request key belongs to another transfer intent.',
          });
        record = stored;
        if (!(error instanceof MongoServerError && error.code === 11000)) created = false;
      }
    }
    if (record.status === 'PENDING') record = (await this.execute(record._id)) ?? record;
    return {
      transfer: transferView(record),
      statusCode:
        record.status === 'PENDING'
          ? 202
          : record.status === 'REJECTED'
            ? 422
            : created
              ? 201
              : 200,
    };
  }
  async submitV2(
    caller: string,
    input: unknown,
    key: unknown,
  ): Promise<{ statusCode: number; transfer: SimulatedTransferV2View }> {
    const body = parseInput(sendIntentSchema, input);
    const senderId = objectId(caller);
    const idempotencyKey = normalizeKey(key);
    const old = await this.transfers.findOne({ senderId, idempotencyKey });
    let recipientId: ObjectId;
    let reviewed: ReviewedDemoIntent;
    if (old) {
      if (
        old.payloadVersion !== 2 ||
        !old.senderWalletId ||
        !old.recipientWalletId ||
        !old.recipientResolutionId ||
        !old.senderWalletId.equals(objectId(body.senderWalletId)) ||
        !old.recipientResolutionId.equals(objectId(body.recipientResolutionId)) ||
        !old.assetId.equals(objectId(body.assetId))
      )
        throw new ConflictException({
          code: 'IDEMPOTENCY_CONFLICT',
          message: 'This key belongs to another transfer intent.',
        });
      recipientId = old.recipientId;
      reviewed = {
        senderWalletId: old.senderWalletId,
        recipientWalletId: old.recipientWalletId,
        recipientResolutionId: old.recipientResolutionId,
      };
    } else {
      await this.accounts.throttle(caller, 'v2-review-submit', 60);
      let resolution;
      try {
        resolution = await this.wallets.reviewed(
          caller,
          body.recipientResolutionId,
          body.senderWalletId,
          body.assetId,
        );
      } catch (error) {
        // A concurrent identical request may have admitted before eligibility
        // revisions changed. Reconcile that durable key before rejecting review.
        if (await this.transfers.findOne({ senderId, idempotencyKey }))
          return this.submitV2(caller, input, key);
        throw error;
      }
      const asset = await this.accounts.assets.findOne({ _id: objectId(body.assetId) });
      if (!asset?.custodyEnabled)
        throw new ServiceUnavailableException({
          code: 'WALLET_MIGRATION_REQUIRED',
          message: 'This asset needs custody migration before v2 transfers.',
        });
      const amount = parseQuantity(body.quantity, asset.precision);
      if (
        amount < units(asset.minimumUnits ?? toLong(1n)) ||
        amount > units(asset.maximumUnits ?? toLong(MAX_UNITS))
      )
        throw new BadRequestException(
          "Quantity is outside this asset's configured transfer limits.",
        );
      recipientId = resolution.recipientId;
      reviewed = {
        senderWalletId: resolution.senderWalletId,
        recipientWalletId: resolution.recipientWalletId,
        recipientResolutionId: resolution._id,
      };
    }
    const result = await this.submit(
      caller,
      { recipientId: recipientId.toHexString(), assetId: body.assetId, quantity: body.quantity },
      idempotencyKey,
      reviewed,
    );
    return {
      ...result,
      transfer: {
        ...result.transfer,
        payloadVersion: 2 as const,
        mode: 'SIMULATED' as const,
        senderWalletId: reviewed.senderWalletId.toHexString(),
        recipientWalletId: reviewed.recipientWalletId.toHexString(),
      },
    };
  }
  async detail(caller: string, id: string) {
    const record = await this.transfers.findOne({ _id: objectId(id) });
    if (
      !record ||
      (!record.senderId.equals(objectId(caller)) &&
        !(record.status === 'COMMITTED' && record.recipientId.equals(objectId(caller))))
    )
      throw new NotFoundException('Transfer not found.');
    return { transfer: transferView(record) };
  }
  async detailV2(caller: string, id: string) {
    const result = await this.detail(caller, id);
    const record = await this.transfers.findOne({ _id: objectId(id) });
    if (!record) throw new NotFoundException('Transfer not found.');
    return {
      transfer: {
        ...result.transfer,
        payloadVersion: record.payloadVersion,
        mode: 'SIMULATED' as const,
        ...(record.senderWalletId && record.recipientWalletId
          ? {
              senderWalletId: record.senderWalletId.toHexString(),
              recipientWalletId: record.recipientWalletId.toHexString(),
            }
          : {}),
      },
    };
  }
  async claim(id: ObjectId, now = this.now()) {
    return this.transfers.findOneAndUpdate(
      {
        _id: id,
        status: 'PENDING',
        nextAttemptAt: { $lte: now },
        $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }],
      },
      {
        $set: {
          attemptToken: randomUUID(),
          leaseUntil: new Date(now.getTime() + LEASE_MS),
          updatedAt: now,
        },
        $inc: { attempts: 1 },
      },
      { returnDocument: 'after', writeConcern: { w: 'majority' }, timeoutMS: 5000 },
    );
  }
  async execute(id: ObjectId): Promise<TransferRecord | null> {
    const claim = await this.claim(id);
    if (!claim) return this.transfers.findOne({ _id: id });
    return this.executeClaim(claim);
  }
  async rejectClaim(record: TransferRecord, code: TransferRejectionCode) {
    await this.transfers.updateOne(
      { _id: record._id, status: 'PENDING', attemptToken: record.attemptToken },
      {
        $set: { status: 'REJECTED', rejectionCode: code, leaseUntil: null, updatedAt: this.now() },
      },
      { writeConcern: { w: 'majority' }, timeoutMS: 5000 },
    );
  }
  async executeClaim(record: TransferRecord): Promise<TransferRecord | null> {
    if (!record.attemptToken) throw new LostClaim('A claimed attempt is required.');
    const session = this.database.client.startSession();
    let domainFailure: BusinessRejection | undefined;
    try {
      await this.fault?.('claimed');
      await session.withTransaction(async () => {
        domainFailure = undefined;
        try {
          if (
            (
              await this.transfers.updateOne(
                { _id: record._id, status: 'PENDING', attemptToken: record.attemptToken },
                { $inc: { executionRevision: 1 } },
                { session },
              )
            ).matchedCount !== 1
          )
            throw new LostClaim();
          await this.fault?.('fenced');
          for (const id of [record.senderId, record.recipientId].sort((a, b) =>
            a.toHexString().localeCompare(b.toHexString()),
          ))
            if (!(await this.identities.fence(id, session)))
              throw new BusinessRejection(
                id.equals(record.senderId) ? 'SENDER_UNAVAILABLE' : 'RECIPIENT_UNAVAILABLE',
              );
          const wallets = await this.accounts.prepareWallets(
            record.assetId,
            [record.senderId, record.recipientId],
            session,
          );
          const senderWallet = wallets?.get(record.senderId.toHexString());
          const recipientWallet = wallets?.get(record.recipientId.toHexString());
          if (
            record.payloadVersion === 2 &&
            (!senderWallet?._id.equals(record.senderWalletId) ||
              !recipientWallet?._id.equals(record.recipientWalletId))
          )
            throw new BusinessRejection('WALLET_UNAVAILABLE');
          const sender = await this.accounts.ensureUser(
            record.senderId,
            record.assetId,
            session,
            senderWallet?._id,
          );
          const recipient = await this.accounts.ensureUser(
            record.recipientId,
            record.assetId,
            session,
            recipientWallet?._id,
          );
          if (sender.status !== 'active' || recipient.status !== 'active')
            throw new BusinessRejection('ACCOUNT_UNAVAILABLE');
          const quantity = units(record.quantityUnits);
          const at = this.now();
          if (
            (
              await this.accounts.accounts.updateOne(
                { _id: sender._id, status: 'active', balanceUnits: { $gte: record.quantityUnits } },
                { $inc: { balanceUnits: toLong(-quantity) }, $set: { updatedAt: at } },
                { session },
              )
            ).modifiedCount !== 1
          )
            throw new BusinessRejection('INSUFFICIENT_BALANCE');
          await this.fault?.('debit');
          if (
            (
              await this.accounts.accounts.updateOne(
                {
                  _id: recipient._id,
                  status: 'active',
                  balanceUnits: { $lte: toLong(MAX_UNITS - quantity) },
                },
                { $inc: { balanceUnits: record.quantityUnits }, $set: { updatedAt: at } },
                { session },
              )
            ).modifiedCount !== 1
          )
            throw new BusinessRejection('BALANCE_LIMIT_EXCEEDED');
          await this.fault?.('credit');
          await this.ledger.pair(
            {
              referenceKind: 'transfer',
              referenceId: record._id,
              debitAccountId: sender._id,
              creditAccountId: recipient._id,
              assetId: record.assetId,
              quantityUnits: quantity,
              createdAt: at,
            },
            session,
          );
          await this.fault?.('ledger');
          if (senderWallet && recipientWallet) {
            try {
              await this.accounts.custody.write(
                {
                  kind: 'TRANSFER',
                  referenceId: record._id,
                  assetId: record.assetId,
                  sender: { walletId: senderWallet._id, accountId: sender._id },
                  recipient: { walletId: recipientWallet._id, accountId: recipient._id },
                  quantity,
                  at,
                },
                session,
              );
            } catch (error) {
              if (error instanceof CustodyLimitExceeded)
                throw new BusinessRejection('LOT_LIMIT_EXCEEDED');
              throw error;
            }
            await this.fault?.('custody');
          }
          await this.chain.append(record, sender._id, recipient._id, at, session);
          await this.fault?.('chain');
          if (
            (
              await this.transfers.updateOne(
                { _id: record._id, status: 'PENDING', attemptToken: record.attemptToken },
                {
                  $set: {
                    status: 'COMMITTED',
                    rejectionCode: null,
                    senderAccountId: sender._id,
                    recipientAccountId: recipient._id,
                    committedAt: at,
                    updatedAt: at,
                    leaseUntil: null,
                  },
                },
                { session },
              )
            ).modifiedCount !== 1
          )
            throw new LostClaim();
          await this.fault?.('status');
          await this.outbox.committed(record, at, session);
          await this.fault?.('outbox');
        } catch (error) {
          if (error instanceof BusinessRejection) domainFailure = error;
          throw error;
        }
      }, TRANSACTION_OPTIONS);
      await this.fault?.('afterCommit');
    } catch (error) {
      // A business failure can only originate in the callback before commit is requested.
      // Abort transport errors cannot commit that transaction. This separate token-matched
      // write conflicts with any outstanding transaction and cannot override a takeover.
      if (error === domainFailure && domainFailure)
        await this.rejectClaim(record, domainFailure.code);
      else if (!(error instanceof LostClaim))
        await this.transfers.updateOne(
          { _id: record._id, status: 'PENDING', attemptToken: record.attemptToken },
          {
            $set: {
              leaseUntil: null,
              nextAttemptAt: new Date(this.now().getTime() + retryDelay(record.attempts)),
              updatedAt: this.now(),
            },
          },
          { writeConcern: { w: 'majority' }, timeoutMS: 5000 },
        );
    } finally {
      await session.endSession();
    }
    return this.transfers.findOne({ _id: record._id });
  }
  async recover() {
    const now = this.now();
    const due = await this.transfers
      .find({
        status: 'PENDING',
        nextAttemptAt: { $lte: now },
        $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }],
      })
      .sort({ nextAttemptAt: 1, _id: 1 })
      .limit(20)
      .toArray();
    for (const record of due) await this.execute(record._id);
    return due.length;
  }
}
