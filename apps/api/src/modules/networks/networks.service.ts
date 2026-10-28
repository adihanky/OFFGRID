import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  type OnModuleInit,
} from '@nestjs/common';
import { ObjectId, type ClientSession, type Long } from 'mongodb';
import { z } from 'zod';
import type { WalletNetwork } from '@p2p/contracts';
import { DatabaseService } from '../../database/database.service.js';
import { ENVIRONMENT } from '../../config/environment.module.js';
import type { Environment } from '../../config/environment.js';
import { collectionSchema, date, long, text } from '../accounts/schema.js';
import { toLong } from '../accounts/quantity.js';
import { objectId } from '../accounts/accounts.service.js';
import { parseInput } from '../assets/asset-input.js';
import { rpcUrl, RPC_TRANSPORT, type RpcMethod, type RpcTransport } from './rpc.js';
export const SEPOLIA_GENESIS = '0x25a5cc106eea7138acab33231d7160d69cb777ee0c2c553fcddf5138993e6dd9';
export const SEPOLIA_CHECKPOINT = {
  number: '0x4c4b40',
  hash: '0x72247ea9191db039158939f7ba958e638a32df4f61a43edcae60cb7a686a2d55',
} as const;
export interface NetworkRecord {
  _id: ObjectId;
  schemaVersion: 2;
  displayName: string;
  chainId: string;
  genesisHash: string;
  environment: 'LOCAL' | 'TESTNET';
  rpcUrl: string;
  status: 'ACTIVE' | 'PAUSED';
  revision: Long;
  useRevision: Long;
  createdAt: Date;
  updatedAt: Date;
}
export const networkDraftSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(60),
  chainId: z.string().regex(/^[1-9][0-9]{0,20}$/),
  environment: z.enum(['LOCAL', 'TESTNET']),
  rpcUrl: z.string().max(500),
  reason: z.string().trim().min(3).max(200),
});
export const networkView = (row: NetworkRecord): WalletNetwork => ({
  id: row._id.toHexString(),
  displayName: row.displayName,
  chainId: row.chainId,
  genesisHash: row.genesisHash,
  environment: row.environment,
  status: row.status,
  revision: row.revision.toString(),
});
@Injectable()
export class NetworksService implements OnModuleInit {
  constructor(
    @Inject(DatabaseService) readonly database: DatabaseService,
    @Inject(ENVIRONMENT) readonly environment: Environment,
    @Inject(RPC_TRANSPORT) readonly transport: RpcTransport,
  ) {}
  get networks() {
    return this.database.db.collection<NetworkRecord>('networks', { promoteLongs: false });
  }
  async onModuleInit() {
    await collectionSchema(
      this.database.db,
      'networks',
      {
        schemaVersion: { enum: [2] },
        displayName: text,
        chainId: text,
        genesisHash: text,
        environment: { enum: ['LOCAL', 'TESTNET'] },
        rpcUrl: text,
        status: { enum: ['ACTIVE', 'PAUSED'] },
        revision: long,
        useRevision: long,
        createdAt: date,
        updatedAt: date,
      },
      undefined,
      { additionalProperties: false },
    );
    await this.networks.createIndex(
      { chainId: 1, genesisHash: 1 },
      { unique: true, name: 'network_identity' },
    );
  }
  async call(
    network: Pick<NetworkRecord, 'rpcUrl' | 'environment'>,
    method: RpcMethod,
    params: unknown[],
  ) {
    const local = network.environment === 'LOCAL';
    return this.transport(rpcUrl(network.rpcUrl, this.environment, local), method, params, local);
  }
  async identity(network: Pick<NetworkRecord, 'chainId' | 'rpcUrl' | 'environment'>) {
    const chain = await this.call(network, 'eth_chainId', []);
    if (
      typeof chain !== 'string' ||
      !/^0x[0-9a-f]{1,64}$/i.test(chain) ||
      BigInt(chain).toString() !== network.chainId
    )
      throw new BadRequestException('RPC chain ID does not match the configured network.');
    const sepolia = network.environment === 'TESTNET' && network.chainId === '11155111';
    const block = await this.call(network, 'eth_getBlockByNumber', [
      sepolia ? SEPOLIA_CHECKPOINT.number : '0x0',
      false,
    ]);
    if (
      !block ||
      typeof block !== 'object' ||
      !('hash' in block) ||
      typeof block.hash !== 'string' ||
      !/^0x[0-9a-f]{64}$/i.test(block.hash) ||
      /^0x0{64}$/i.test(block.hash)
    )
      throw new ServiceUnavailableException('RPC did not provide a valid identity block.');
    if (sepolia) {
      if (
        !('number' in block) ||
        block.number !== SEPOLIA_CHECKPOINT.number ||
        block.hash.toLowerCase() !== SEPOLIA_CHECKPOINT.hash
      )
        throw new ConflictException('Provider is not the canonical Ethereum Sepolia chain.');
      return SEPOLIA_GENESIS;
    }
    return block.hash.toLowerCase();
  }
  async prepare(value: unknown) {
    const input = parseInput(networkDraftSchema, value);
    if (
      input.environment === 'TESTNET' &&
      !['11155111', '17000', '80002', '84532', '421614'].includes(input.chainId)
    )
      throw new BadRequestException(
        'This release supports configured EVM testnets and guarded local networks.',
      );
    const url = rpcUrl(input.rpcUrl, this.environment, input.environment === 'LOCAL');
    const genesisHash = await this.identity({ ...input, rpcUrl: url.href });
    return { ...input, rpcUrl: url.href, genesisHash };
  }
  async create(prepared: Awaited<ReturnType<NetworksService['prepare']>>, session: ClientSession) {
    const old = await this.networks.findOne(
      { chainId: prepared.chainId, genesisHash: prepared.genesisHash },
      { session },
    );
    if (old) throw new ConflictException('This network is already configured.');
    const now = new Date();
    const record: NetworkRecord = {
      _id: new ObjectId(),
      schemaVersion: 2,
      displayName: prepared.displayName,
      chainId: prepared.chainId,
      genesisHash: prepared.genesisHash,
      environment: prepared.environment,
      rpcUrl: prepared.rpcUrl,
      status: 'ACTIVE',
      revision: toLong(0n),
      useRevision: toLong(0n),
      createdAt: now,
      updatedAt: now,
    };
    await this.networks.insertOne(record, { session });
    return record;
  }
  /** Fixed, installation-approved preset; never accepts a user-supplied RPC destination. */
  async enableSepolia() {
    const existing = await this.networks.findOne({ chainId: '11155111' });
    if (existing) {
      if (
        existing.genesisHash !==
        '0x25a5cc106eea7138acab33231d7160d69cb777ee0c2c553fcddf5138993e6dd9'
      )
        throw new ConflictException('Configured chain is not canonical Sepolia.');
      if (existing.status !== 'ACTIVE')
        throw new ConflictException('Sepolia is paused by an administrator.');
      return networkView(await this.active(existing._id.toHexString()));
    }
    const prepared = await this.prepare({
      displayName: 'Ethereum Sepolia',
      chainId: '11155111',
      environment: 'TESTNET',
      rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com/',
      reason: 'User enabled the supported testnet wallet preset',
    });
    if (
      prepared.genesisHash !== '0x25a5cc106eea7138acab33231d7160d69cb777ee0c2c553fcddf5138993e6dd9'
    )
      throw new ConflictException('Provider is not the canonical Ethereum Sepolia chain.');
    const now = new Date();
    try {
      await this.networks.updateOne(
        { chainId: prepared.chainId, genesisHash: prepared.genesisHash },
        {
          $setOnInsert: {
            _id: new ObjectId(),
            schemaVersion: 2,
            displayName: prepared.displayName,
            chainId: prepared.chainId,
            genesisHash: prepared.genesisHash,
            environment: 'TESTNET',
            rpcUrl: prepared.rpcUrl,
            status: 'ACTIVE',
            revision: toLong(0n),
            useRevision: toLong(0n),
            createdAt: now,
            updatedAt: now,
          },
        },
        { upsert: true },
      );
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 11000))
        throw error;
    }
    const record = await this.networks.findOne({
      chainId: prepared.chainId,
      genesisHash: prepared.genesisHash,
    });
    if (!record || record.status !== 'ACTIVE')
      throw new ConflictException('Sepolia is unavailable.');
    return networkView(record);
  }
  async active(id: string) {
    const network = await this.networks.findOne({ _id: objectId(id), status: 'ACTIVE' });
    if (!network) throw new NotFoundException('Network is unavailable.');
    if ((await this.identity(network)) !== network.genesisHash)
      throw new ConflictException('Provider network identity changed.');
    return network;
  }
  async isExternalAccount(network: NetworkRecord, address: string) {
    const code = await this.call(network, 'eth_getCode', [address, 'latest']);
    if (typeof code !== 'string' || !/^0x(?:[0-9a-f]{2})*$/i.test(code))
      throw new ServiceUnavailableException('Provider returned invalid account code.');
    if (code !== '0x')
      throw new BadRequestException(
        'Contract wallets are not supported for address linking in this release.',
      );
  }
}
