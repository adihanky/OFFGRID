import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { ObjectId, type Long } from 'mongodb';
import { getAddress, verifyMessage } from 'ethers';
import { z } from 'zod';
import type { WalletChallenge } from '@p2p/contracts';
import { ENVIRONMENT } from '../../config/environment.module.js';
import type { Environment } from '../../config/environment.js';
import { DatabaseService } from '../../database/database.service.js';
import { AccountsService, objectId, TRANSACTION_OPTIONS } from '../accounts/accounts.service.js';
import { collectionSchema, date, long, oid, text } from '../accounts/schema.js';
import { toLong } from '../accounts/quantity.js';
import { parseInput } from '../assets/asset-input.js';
import { tokenHash } from '../auth/auth.crypto.js';
import { NetworksService } from '../networks/networks.service.js';
import type { WalletBindingRecord, WalletRecord } from './wallets.models.js';

export function normalizedEvmAddress(value: string) {
  try {
    const address = getAddress(value);
    if (/^0x0{40}$/i.test(address)) throw new Error();
    return address.toLowerCase();
  } catch {
    throw new BadRequestException('Enter a nonzero EVM address with a valid checksum.');
  }
}
export function ownershipMessage(input: {
  origin: string;
  address: string;
  chainId: string;
  nonce: string;
  issuedAt: Date;
  expiresAt: Date;
  id: string;
  walletId: string;
  sessionHash: string;
}) {
  return `${new URL(input.origin).host} wants you to sign in with your Ethereum account:\n${getAddress(input.address)}\n\nLink this address to your Secure P2P wallet. This does not authorize spending.\n\nURI: ${input.origin}/wallet\nVersion: 1\nChain ID: ${input.chainId}\nNonce: ${input.nonce}\nIssued At: ${input.issuedAt.toISOString()}\nExpiration Time: ${input.expiresAt.toISOString()}\nRequest ID: ${input.id}\nResources:\n- urn:secure-p2p:wallet:${input.walletId}\n- urn:secure-p2p:session:${input.sessionHash}`;
}
interface ProofRecord {
  _id: ObjectId;
  schemaVersion: 2;
  userId: ObjectId;
  walletId: ObjectId;
  networkId: ObjectId;
  networkRevision: Long;
  sessionHash: string;
  normalizedAddress: string;
  nonceHash: string;
  message: string;
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
}
@Injectable()
export class ExternalWalletService implements OnModuleInit {
  constructor(
    @Inject(DatabaseService) readonly database: DatabaseService,
    @Inject(AccountsService) readonly accounts: AccountsService,
    @Inject(NetworksService) readonly networks: NetworksService,
    @Inject(ENVIRONMENT) readonly environment: Environment,
  ) {}
  get proofs() {
    return this.database.db.collection<ProofRecord>('walletProofs', { promoteLongs: false });
  }
  get bindings() {
    return this.database.db.collection<WalletBindingRecord>('walletBindings', {
      promoteLongs: false,
    });
  }
  async onModuleInit() {
    await collectionSchema(
      this.database.db,
      'walletProofs',
      {
        schemaVersion: { enum: [2] },
        userId: oid,
        walletId: oid,
        networkId: oid,
        networkRevision: long,
        sessionHash: text,
        normalizedAddress: text,
        nonceHash: text,
        message: text,
        createdAt: date,
        expiresAt: date,
        consumedAt: { bsonType: ['date', 'null'] },
      },
      undefined,
      { additionalProperties: false },
    );
    await this.proofs.createIndexes([
      { key: { nonceHash: 1 }, unique: true },
      { key: { expiresAt: 1 }, expireAfterSeconds: 0 },
    ]);
    await collectionSchema(
      this.database.db,
      'walletProofAudits',
      {
        userId: oid,
        walletId: oid,
        networkId: oid,
        normalizedAddress: text,
        messageHash: text,
        signatureHash: text,
        verifiedAt: date,
      },
      undefined,
      { additionalProperties: false },
    );
  }
  async challenge(caller: string, token: string, value: unknown): Promise<WalletChallenge> {
    const input = parseInput(
      z.strictObject({ networkId: z.string(), address: z.string().max(42) }),
      value,
    );
    await this.accounts.throttle(caller, 'wallet-proof', 30);
    const address = normalizedEvmAddress(input.address);
    const network = await this.networks.active(input.networkId);
    await this.networks.isExternalAccount(network, address);
    const wallet = await this.database.db
      .collection<WalletRecord>('wallets')
      .findOne({ userId: objectId(caller), status: 'ACTIVE' });
    if (!wallet) throw new BadRequestException('An active application wallet is required.');
    const owned = await this.bindings.findOne({ walletId: wallet._id, networkId: network._id });
    if (owned && owned.normalizedAddress !== address)
      throw new ConflictException(
        'This wallet already owns another address on this network. Address replacement is not supported.',
      );
    const now = new Date(),
      expiresAt = new Date(now.getTime() + 300000),
      id = new ObjectId(),
      nonce = randomBytes(24).toString('hex'),
      sessionHash = tokenHash(token);
    const message = ownershipMessage({
      origin: this.environment.WEB_ORIGIN,
      address,
      chainId: network.chainId,
      nonce,
      issuedAt: now,
      expiresAt,
      id: id.toHexString(),
      walletId: wallet._id.toHexString(),
      sessionHash,
    });
    await this.proofs.insertOne({
      _id: id,
      schemaVersion: 2,
      userId: objectId(caller),
      walletId: wallet._id,
      networkId: network._id,
      networkRevision: network.revision,
      normalizedAddress: address,
      sessionHash,
      nonceHash: tokenHash(nonce),
      message,
      createdAt: now,
      expiresAt,
      consumedAt: null,
    });
    return {
      id: id.toHexString(),
      message,
      expiresAt: expiresAt.toISOString(),
      address: getAddress(address),
      networkId: network._id.toHexString(),
    };
  }
  async verify(caller: string, token: string, value: unknown) {
    const input = parseInput(
      z.strictObject({
        challengeId: z.string(),
        signature: z.string().regex(/^0x[0-9a-fA-F]{128}(?:[0-9a-fA-F]{2})?$/),
      }),
      value,
    );
    await this.accounts.throttle(caller, 'wallet-proof', 30);
    const proof = await this.proofs.findOne({
      _id: objectId(input.challengeId),
      userId: objectId(caller),
      sessionHash: tokenHash(token),
      consumedAt: null,
      expiresAt: { $gt: new Date() },
    });
    if (!proof)
      throw new BadRequestException(
        'Challenge expired, consumed or belongs to another session. Create a fresh challenge.',
      );
    try {
      if (
        normalizedEvmAddress(verifyMessage(proof.message, input.signature)) !==
        proof.normalizedAddress
      )
        throw new Error();
    } catch {
      throw new BadRequestException('The signature does not prove ownership of this address.');
    }
    const network = await this.networks.active(proof.networkId.toHexString());
    if (!network.revision.equals(proof.networkRevision))
      throw new ConflictException('Network changed. Create a fresh challenge.');
    await this.networks.isExternalAccount(network, proof.normalizedAddress);
    const session = this.database.client.startSession();
    try {
      const binding = await session.withTransaction(async () => {
        if (!(await this.accounts.identities.fence(objectId(caller), session)))
          throw new BadRequestException('Account unavailable.');
        const wallet = await this.database.db
          .collection<WalletRecord>('wallets')
          .findOneAndUpdate(
            { _id: proof.walletId, userId: objectId(caller), status: 'ACTIVE' },
            { $inc: { eligibilityRevision: toLong(1n) }, $set: { updatedAt: new Date() } },
            { session },
          );
        if (
          !wallet ||
          !(await this.networks.networks.findOneAndUpdate(
            { _id: network._id, status: 'ACTIVE', revision: proof.networkRevision },
            { $inc: { useRevision: toLong(1n) } },
            { session },
          ))
        )
          throw new ConflictException('Wallet or network availability changed.');
        const consumed = await this.proofs.findOneAndUpdate(
          {
            _id: proof._id,
            consumedAt: null,
            sessionHash: tokenHash(token),
            expiresAt: { $gt: new Date() },
          },
          { $set: { consumedAt: new Date() } },
          { session },
        );
        if (!consumed)
          throw new ConflictException('This challenge has already been consumed or expired.');
        const owned = await this.bindings.findOne(
          { walletId: wallet._id, networkId: network._id },
          { session },
        );
        if (owned && owned.normalizedAddress !== proof.normalizedAddress)
          throw new ConflictException(
            'This wallet already owns another address on this network. Address replacement is not supported.',
          );
        const claimed = await this.bindings.findOne(
          { networkId: network._id, normalizedAddress: proof.normalizedAddress },
          { session },
        );
        if (claimed && !claimed.walletId.equals(wallet._id))
          throw new ConflictException(
            'This address is already owned by another registered wallet.',
          );
        const now = new Date();
        const record: WalletBindingRecord = {
          _id: owned?._id ?? new ObjectId(),
          schemaVersion: 2,
          walletId: wallet._id,
          networkId: network._id,
          normalizedAddress: proof.normalizedAddress,
          status: 'VERIFIED',
          proofId: proof._id,
          verifiedAt: now,
          revision: toLong(owned ? BigInt(owned.revision.toString()) + 1n : 0n),
          createdAt: owned?.createdAt ?? now,
          updatedAt: now,
        };
        if (owned) await this.bindings.replaceOne({ _id: owned._id }, record, { session });
        else await this.bindings.insertOne(record, { session });
        const digest = (text: string) => createHash('sha256').update(text).digest('hex');
        await this.database.db.collection('walletProofAudits').insertOne(
          {
            _id: proof._id,
            userId: objectId(caller),
            walletId: wallet._id,
            networkId: network._id,
            normalizedAddress: proof.normalizedAddress,
            messageHash: digest(proof.message),
            signatureHash: digest(input.signature),
            verifiedAt: now,
          },
          { session },
        );
        return record;
      }, TRANSACTION_OPTIONS);
      return {
        binding: {
          id: binding._id.toHexString(),
          networkId: binding.networkId.toHexString(),
          address: getAddress(binding.normalizedAddress),
          status: binding.status,
          revision: binding.revision.toString(),
        },
      };
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 11000)
        throw new ConflictException('This address or challenge was already claimed.');
      throw error;
    } finally {
      await session.endSession();
    }
  }
  async revoke(caller: string, id: string, value: unknown) {
    const input = parseInput(
      z.strictObject({ revision: z.string().regex(/^(0|[1-9][0-9]*)$/) }),
      value,
    );
    const session = this.database.client.startSession();
    try {
      await session.withTransaction(async () => {
        const wallet = await this.database.db
          .collection<WalletRecord>('wallets')
          .findOneAndUpdate(
            { userId: objectId(caller) },
            { $inc: { eligibilityRevision: toLong(1n) }, $set: { updatedAt: new Date() } },
            { session },
          );
        if (!wallet) throw new NotFoundException();
        const binding = await this.bindings.findOne(
          { _id: objectId(id), walletId: wallet._id },
          { session },
        );
        if (!binding) throw new NotFoundException();
        if (binding.revision.toString() !== input.revision)
          throw new ConflictException('Binding changed. Refresh your wallet.');
        await this.bindings.updateOne(
          { _id: binding._id },
          { $set: { status: 'REVOKED', updatedAt: new Date() }, $inc: { revision: toLong(1n) } },
          { session },
        );
      }, TRANSACTION_OPTIONS);
      return { revoked: true };
    } finally {
      await session.endSession();
    }
  }
}
