import { toLong } from '../accounts/quantity.js';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  type OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ObjectId, type ClientSession } from 'mongodb';
import { keccak256 } from 'ethers';
import { z } from 'zod';
import type { ChainActivity, ChainHistory, ChainToken } from '@p2p/contracts';
import { DatabaseService } from '../../database/database.service.js';
import { NetworksService, type NetworkRecord } from '../networks/networks.service.js';
import { WalletsService } from '../wallets/wallets.service.js';
import { parseInput } from '../assets/asset-input.js';
import { TRANSACTION_OPTIONS } from '../accounts/accounts.service.js';
import { collectionSchema, date, text } from '../accounts/schema.js';
import {
  address,
  addressSchema,
  blockNumber,
  blockSchema,
  confirmedStatus,
  erc20,
  hashSchema,
  hexBlock,
  logSchema,
  receiptSchema,
  tokenAmount,
  transactionSchema,
} from './chain-input.js';
interface TokenRecord {
  _id: ObjectId;
  bindingId: string;
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  codeHash: string;
}
interface ActivityRecord extends Omit<ChainActivity, 'id'> {
  _id: ObjectId;
  bindingId: string;
  eventKey: string;
  blockHash: string | null;
}
interface Subscription {
  _id: ObjectId;
  bindingId: string;
  userId: string;
  startBlock: number;
  nextBlock: number;
  anchorHash: string | null;
  leaseOwner: string;
  leaseUntil: Date;
  lastSyncedAt?: Date;
  lastError?: string | null;
}
const num = { bsonType: 'number' };
@Injectable()
export class ChainWalletService implements OnModuleInit {
  constructor(
    @Inject(DatabaseService) readonly database: DatabaseService,
    @Inject(NetworksService) readonly networks: NetworksService,
    @Inject(WalletsService) readonly wallets: WalletsService,
  ) {}
  get tokens() {
    return this.database.db.collection<TokenRecord>('chainTokens');
  }
  get activities() {
    return this.database.db.collection<ActivityRecord>('chainActivity');
  }
  get subscriptions() {
    return this.database.db.collection<Subscription>('chainSubscriptions');
  }
  async onModuleInit() {
    await collectionSchema(this.database.db, 'chainTokens', {
      bindingId: text,
      address: text,
      name: text,
      symbol: text,
      decimals: num,
      codeHash: text,
    });
    await collectionSchema(this.database.db, 'chainActivity', {
      bindingId: text,
      eventKey: text,
      hash: text,
      kind: { enum: ['NATIVE', 'ERC20', 'CONTRACT'] },
      tokenAddress: { bsonType: ['string', 'null'] },
      from: text,
      to: { bsonType: ['string', 'null'] },
      amountUnits: text,
      symbol: text,
      decimals: num,
      status: { enum: ['PENDING', 'MINED', 'CONFIRMED', 'REVERTED', 'REORGED'] },
      blockNumber: { bsonType: ['number', 'null'] },
      blockHash: { bsonType: ['string', 'null'] },
      confirmations: num,
      contractAddress: { bsonType: ['string', 'null'] },
    });
    await collectionSchema(
      this.database.db,
      'chainSubscriptions',
      {
        bindingId: text,
        userId: text,
        startBlock: num,
        nextBlock: num,
        anchorHash: { bsonType: ['string', 'null'] },
        leaseOwner: text,
        leaseUntil: date,
        lastSyncedAt: date,
        lastError: { bsonType: ['string', 'null'] },
      },
      ['bindingId', 'userId', 'startBlock', 'nextBlock', 'anchorHash', 'leaseOwner', 'leaseUntil'],
    );
    await this.tokens.createIndex({ bindingId: 1, address: 1 }, { unique: true });
    await this.activities.createIndex({ bindingId: 1, hash: 1, eventKey: 1 }, { unique: true });
    await this.activities.createIndex({ bindingId: 1, _id: -1 });
    await this.subscriptions.createIndex({ bindingId: 1 }, { unique: true });
  }
  async owner(userId: string, bindingId: string) {
    await this.wallets.accounts.throttle(userId, 'v2-read', 240);
    const wallet = await this.wallets.own(userId);
    const binding = wallet.bindings.find(
      (row) => row.id === bindingId && row.status === 'VERIFIED',
    );
    if (!binding) throw new NotFoundException('Verified wallet address not found.');
    const network = await this.networks.active(binding.networkId);
    if (
      network.chainId !== '11155111' &&
      !(network.environment === 'LOCAL' && network.chainId === '31337')
    )
      throw new BadRequestException('Use Sepolia or the guarded local development chain.');
    return { binding, network, address: binding.address.toLowerCase() };
  }
  async metadata(network: NetworkRecord, contract: string) {
    const code = await this.networks.call(network, 'eth_getCode', [contract, 'latest']);
    if (typeof code !== 'string' || !/^0x(?:[a-f0-9]{2})+$/i.test(code))
      throw new BadRequestException('No token contract exists at this address.');
    const read = async (method: string) => {
      const result = await this.networks.call(network, 'eth_call', [
        { to: contract, data: erc20.encodeFunctionData(method) },
        'latest',
      ]);
      if (typeof result !== 'string')
        throw new ServiceUnavailableException('Invalid token response.');
      try {
        return erc20.decodeFunctionResult(method, result)[0] as unknown;
      } catch {
        throw new BadRequestException('Contract does not support standard ERC-20 metadata.');
      }
    };
    const [name, symbol, precision] = await Promise.all([
      read('name'),
      read('symbol'),
      read('decimals'),
    ]);
    if (
      typeof name !== 'string' ||
      !name.trim() ||
      name.length > 80 ||
      typeof symbol !== 'string' ||
      !symbol.trim() ||
      symbol.length > 24 ||
      typeof precision !== 'bigint' ||
      precision > 36n
    )
      throw new BadRequestException('Unsupported token metadata or precision.');
    return { name, symbol, decimals: Number(precision), codeHash: keccak256(code) };
  }
  async importToken(userId: string, bindingId: string, body: unknown) {
    const input = parseInput(z.strictObject({ address: addressSchema }), body);
    const owner = await this.owner(userId, bindingId),
      contract = address(input.address);
    const old = await this.tokens.findOne({ bindingId, address: contract });
    if (!old && (await this.tokens.countDocuments({ bindingId })) >= 20)
      throw new BadRequestException('At most 20 tokens may be imported per address.');
    const metadata = await this.metadata(owner.network, contract);
    if (old && (old.codeHash !== metadata.codeHash || old.decimals !== metadata.decimals))
      throw new ConflictException('Token implementation or precision changed.');
    await this.subscribe(userId, bindingId, owner.network);
    const session = this.database.client.startSession();
    try {
      await session.withTransaction(async () => {
        const state = await this.subscriptions.findOne(
          { bindingId, leaseUntil: { $lte: new Date() } },
          { session },
        );
        if (!state)
          throw new ConflictException('Wait for history synchronization before importing a token.');
        const existing = await this.tokens.findOne({ bindingId, address: contract }, { session });
        if (!existing && (await this.tokens.countDocuments({ bindingId }, { session })) >= 20)
          throw new BadRequestException('At most 20 tokens may be imported per address.');
        await this.tokens.updateOne(
          { bindingId, address: contract },
          { $setOnInsert: { _id: new ObjectId(), bindingId, address: contract, ...metadata } },
          { upsert: true, session },
        );
        await this.subscriptions.updateOne(
          { bindingId },
          { $set: { nextBlock: state.startBlock, anchorHash: null } },
          { session },
        );
      }, TRANSACTION_OPTIONS);
    } finally {
      await session.endSession();
    }
    return { token: { address: contract, ...metadata } };
  }
  async tokenBalance(
    network: NetworkRecord,
    token: TokenRecord,
    ownerAddress: string,
  ): Promise<ChainToken> {
    const metadata = await this.metadata(network, token.address);
    if (metadata.decimals !== token.decimals || metadata.codeHash !== token.codeHash)
      throw new ConflictException(
        'Token implementation or precision changed; sending is disabled.',
      );
    const result = await this.networks.call(network, 'eth_call', [
      { to: token.address, data: erc20.encodeFunctionData('balanceOf', [ownerAddress]) },
      'latest',
    ]);
    try {
      if (typeof result !== 'string') throw new Error();
      const balance = erc20.decodeFunctionResult('balanceOf', result)[0] as bigint;
      return {
        address: token.address,
        name: token.name,
        symbol: token.symbol,
        decimals: token.decimals,
        balanceUnits: balance.toString(),
      };
    } catch {
      throw new ServiceUnavailableException('Invalid ERC-20 balance response.');
    }
  }
  async listTokens(userId: string, bindingId: string) {
    const owner = await this.owner(userId, bindingId);
    const rows = await this.tokens.find({ bindingId }).sort({ _id: 1 }).limit(20).toArray();
    const tokens: ChainToken[] = [];
    for (const row of rows) tokens.push(await this.tokenBalance(owner.network, row, owner.address));
    return { tokens };
  }
  async prepare(userId: string, bindingId: string, body: unknown) {
    const input = parseInput(
      z.strictObject({
        token: addressSchema,
        recipient: addressSchema,
        quantity: z.string().max(120),
      }),
      body,
    );
    const owner = await this.owner(userId, bindingId),
      to = address(input.recipient);
    if (to === owner.address) throw new BadRequestException('Choose another recipient.');
    const token = await this.tokens.findOne({ bindingId, address: address(input.token) });
    if (!token) throw new NotFoundException('Import this token first.');
    const balance = await this.tokenBalance(owner.network, token, owner.address),
      units = tokenAmount(input.quantity, token.decimals);
    if (units > BigInt(balance.balanceUnits))
      throw new BadRequestException('Insufficient token balance.');
    return {
      transaction: {
        from: owner.binding.address,
        to: token.address,
        value: '0x0',
        data: erc20.encodeFunctionData('transfer', [to, units]),
        chainId: hexBlock(Number(owner.network.chainId)),
      },
    };
  }
  async subscribe(userId: string, bindingId: string, network: NetworkRecord) {
    const old = await this.subscriptions.findOne({ bindingId });
    if (old) return old;
    const head = blockNumber(await this.networks.call(network, 'eth_blockNumber', []));
    // Explicit bounded starting point, surfaced to the user; no claim of genesis-wide history.
    const startBlock = Math.max(0, head - 20);
    await this.subscriptions.updateOne(
      { bindingId },
      {
        $setOnInsert: {
          _id: new ObjectId(),
          bindingId,
          userId,
          startBlock,
          nextBlock: startBlock,
          anchorHash: null,
          leaseOwner: '',
          leaseUntil: new Date(0),
        },
      },
      { upsert: true },
    );
    return (await this.subscriptions.findOne({ bindingId }))!;
  }
  async save(entry: Omit<ActivityRecord, '_id'>, session?: ClientSession) {
    await this.activities.updateOne(
      { bindingId: entry.bindingId, hash: entry.hash, eventKey: entry.eventKey },
      { $set: entry, $setOnInsert: { _id: new ObjectId() } },
      { upsert: true, ...(session ? { session } : {}) },
    );
  }
  nativeEntry(
    bindingId: string,
    owner: string,
    tx: z.infer<typeof transactionSchema>,
    receipt: z.infer<typeof receiptSchema> | null,
    head: number,
  ): Omit<ActivityRecord, '_id'> | null {
    if (tx.from.toLowerCase() !== owner && tx.to?.toLowerCase() !== owner) return null;
    const height = receipt ? blockNumber(receipt.blockNumber) : null;
    const confirmations = height === null ? 0 : Math.max(0, head - height + 1);
    return {
      bindingId,
      eventKey: 'transaction',
      hash: tx.hash.toLowerCase(),
      kind: tx.input === '0x' && tx.to ? 'NATIVE' : 'CONTRACT',
      tokenAddress: null,
      from: tx.from.toLowerCase(),
      to: tx.to?.toLowerCase() ?? null,
      amountUnits: BigInt(tx.value).toString(),
      symbol: 'ETH',
      decimals: 18,
      status: receipt ? confirmedStatus(receipt.status === '0x1', confirmations) : 'PENDING',
      blockNumber: height,
      blockHash: receipt?.blockHash.toLowerCase() ?? null,
      confirmations,
      contractAddress: receipt?.contractAddress?.toLowerCase() ?? null,
    };
  }
  async register(userId: string, bindingId: string, body: unknown) {
    const { hash } = parseInput(z.strictObject({ hash: hashSchema }), body),
      owner = await this.owner(userId, bindingId);
    const raw = await this.networks.call(owner.network, 'eth_getTransactionByHash', [hash]);
    if (!raw)
      throw new NotFoundException(
        'Transaction is not visible to this provider yet. Retry recording the same hash, not sending again.',
      );
    const tx = transactionSchema.parse(raw);
    if (tx.hash.toLowerCase() !== hash.toLowerCase() || tx.from.toLowerCase() !== owner.address)
      throw new NotFoundException('Transaction does not belong to the linked sender.');
    const head = blockNumber(await this.networks.call(owner.network, 'eth_blockNumber', []));
    const receiptRaw = await this.networks.call(owner.network, 'eth_getTransactionReceipt', [hash]);
    const receipt = receiptRaw ? receiptSchema.parse(receiptRaw) : null;
    if (receipt && receipt.transactionHash.toLowerCase() !== hash.toLowerCase())
      throw new ServiceUnavailableException('Provider receipt mismatch.');
    const entry = this.nativeEntry(bindingId, owner.address, tx, receipt, head)!;
    await this.save(entry);
    await this.subscribe(userId, bindingId, owner.network);
    return { recorded: true };
  }
  async sync(userId: string, bindingId: string) {
    const owner = await this.owner(userId, bindingId);
    await this.subscribe(userId, bindingId, owner.network);
    const lease = randomUUID();
    const acquired = await this.subscriptions.findOneAndUpdate(
      { bindingId, leaseUntil: { $lte: new Date() } },
      { $set: { leaseOwner: lease, leaseUntil: new Date(Date.now() + 180000) } },
      { returnDocument: 'after' },
    );
    if (!acquired) throw new ConflictException('History synchronization is already running.');
    try {
      const head = blockNumber(await this.networks.call(owner.network, 'eth_blockNumber', []));
      let from = Math.max(acquired.startBlock, acquired.nextBlock - 12);
      let reorganized = false;
      if (acquired.anchorHash && acquired.nextBlock > acquired.startBlock) {
        const anchor = await this.networks.call(owner.network, 'eth_getBlockByNumber', [
          hexBlock(acquired.nextBlock - 1),
          false,
        ]);
        const hash = anchor && typeof anchor === 'object' && 'hash' in anchor ? anchor.hash : null;
        if (hash !== acquired.anchorHash) {
          from = acquired.startBlock;
          reorganized = true;
        } // Rewind fully after a changed checkpoint.
      }
      const to = Math.min(head, from + 19);
      if (to < from)
        throw new ConflictException(
          'Provider head moved behind the indexing start; retry after recovery.',
        );
      const tokens = await this.tokens.find({ bindingId }).limit(20).toArray(),
        observed: Omit<ActivityRecord, '_id'>[] = [];
      let lastHash = '',
        previousHash = '';
      const blockHashes = new Map<number, string>();
      for (let height = from; height <= to; height++) {
        const block = blockSchema.parse(
          await this.networks.call(owner.network, 'eth_getBlockByNumber', [hexBlock(height), true]),
        );
        if (
          blockNumber(block.number) !== height ||
          (previousHash && block.parentHash !== previousHash)
        )
          throw new ConflictException('Chain changed during synchronization; retry.');
        previousHash = block.hash;
        lastHash = block.hash;
        blockHashes.set(height, block.hash.toLowerCase());
        for (const tx of block.transactions) {
          if (tx.from.toLowerCase() !== owner.address && tx.to?.toLowerCase() !== owner.address)
            continue;
          const raw = await this.networks.call(owner.network, 'eth_getTransactionReceipt', [
            tx.hash,
          ]);
          if (!raw) throw new ConflictException('Receipt disappeared during synchronization.');
          const receipt = receiptSchema.parse(raw);
          if (
            receipt.blockHash !== block.hash ||
            receipt.transactionHash.toLowerCase() !== tx.hash.toLowerCase()
          )
            throw new ConflictException('Receipt changed during synchronization.');
          observed.push(this.nativeEntry(bindingId, owner.address, tx, receipt, head)!);
        }
      }
      const topic = erc20.getEvent('Transfer')!.topicHash;
      const participant = `0x${owner.address.slice(2).padStart(64, '0')}`;
      for (const token of tokens) {
        for (const topics of [
          [topic, participant],
          [topic, null, participant],
        ]) {
          const logs = z
            .array(logSchema)
            .max(10000)
            .parse(
              await this.networks.call(owner.network, 'eth_getLogs', [
                {
                  address: token.address,
                  fromBlock: hexBlock(from),
                  toBlock: hexBlock(to),
                  topics,
                },
              ]),
            );
          for (const log of logs) {
            if (log.removed) continue;
            const decoded = erc20.parseLog(log);
            if (!decoded) throw new ServiceUnavailableException('Invalid token transfer log.');
            const sender = String(decoded.args[0]).toLowerCase(),
              recipient = String(decoded.args[1]).toLowerCase(),
              height = blockNumber(log.blockNumber);
            if (
              log.blockHash.toLowerCase() !== blockHashes.get(height) ||
              log.address.toLowerCase() !== token.address ||
              height < from ||
              height > to ||
              (sender !== owner.address && recipient !== owner.address)
            )
              throw new ServiceUnavailableException('RPC returned unrelated token logs.');
            const confirmations = Math.max(0, head - height + 1);
            observed.push({
              bindingId,
              eventKey: log.logIndex.toLowerCase(),
              hash: log.transactionHash.toLowerCase(),
              kind: 'ERC20',
              tokenAddress: token.address,
              from: sender,
              to: recipient,
              amountUnits: String(decoded.args[2]),
              symbol: token.symbol,
              decimals: token.decimals,
              status: confirmedStatus(true, confirmations),
              blockNumber: height,
              blockHash: log.blockHash.toLowerCase(),
              confirmations,
              contractAddress: null,
            });
          }
        }
      }
      const end = await this.networks.call(owner.network, 'eth_getBlockByNumber', [
        hexBlock(to),
        false,
      ]);
      if (!end || typeof end !== 'object' || !('hash' in end) || end.hash !== lastHash)
        throw new ConflictException('Chain changed before checkpoint commit.');
      const session = this.database.client.startSession();
      try {
        await session.withTransaction(async () => {
          const current = await this.networks.networks.updateOne(
            { _id: owner.network._id, status: 'ACTIVE', revision: owner.network.revision },
            { $inc: { useRevision: toLong(1n) } },
            { session },
          );
          if (current.matchedCount !== 1)
            throw new ConflictException('Network configuration changed.');
          const bindingFence = await this.database.db
            .collection('walletBindings')
            .updateOne(
              { _id: new ObjectId(bindingId), status: 'VERIFIED' },
              { $set: { updatedAt: new Date() } },
              { session },
            );
          if (bindingFence.matchedCount !== 1)
            throw new ConflictException('Wallet binding was revoked.');
          await this.activities.updateMany(
            {
              bindingId,
              blockNumber: { $gte: from, ...(reorganized ? {} : { $lte: to }) },
              status: { $ne: 'PENDING' },
            },
            { $set: { status: 'REORGED', confirmations: 0 } },
            { session },
          );
          for (const entry of observed) await this.save(entry, session);
          const checkpoint = await this.subscriptions.updateOne(
            { bindingId, leaseOwner: lease },
            {
              $set: {
                nextBlock: to + 1,
                lastSyncedAt: new Date(),
                lastError: null,
                anchorHash: lastHash,
                leaseOwner: '',
                leaseUntil: new Date(0),
              },
            },
            { session },
          );
          if (checkpoint.matchedCount !== 1) throw new ConflictException('Index lease expired.');
        }, TRANSACTION_OPTIONS);
      } finally {
        await session.endSession();
      }
      return { indexedThrough: to, head, more: to < head };
    } finally {
      await this.subscriptions.updateOne(
        { bindingId, leaseOwner: lease },
        { $set: { leaseOwner: '', leaseUntil: new Date(0) } },
      );
    }
  }
  async history(userId: string, bindingId: string, query: unknown): Promise<ChainHistory> {
    await this.wallets.accounts.throttle(userId, 'v2-read', 240);
    const wallet = await this.wallets.own(userId);
    if (!wallet.bindings.some((binding) => binding.id === bindingId))
      throw new NotFoundException('Wallet address not found.');
    const input = parseInput(
      z.strictObject({
        cursor: z
          .string()
          .regex(/^[a-f0-9]{24}$/)
          .optional(),
      }),
      query,
    );
    const rows = await this.activities
      .find({ bindingId, ...(input.cursor ? { _id: { $lt: new ObjectId(input.cursor) } } : {}) })
      .sort({ _id: -1 })
      .limit(51)
      .toArray();
    const state = await this.subscriptions.findOne({ bindingId });
    return {
      entries: rows.slice(0, 50).map((row) => ({
        id: row._id.toHexString(),
        hash: row.hash,
        kind: row.kind,
        tokenAddress: row.tokenAddress,
        from: row.from,
        to: row.to,
        amountUnits: row.amountUnits,
        symbol: row.symbol,
        decimals: row.decimals,
        status: row.status,
        blockNumber: row.blockNumber,
        confirmations: row.confirmations,
        contractAddress: row.contractAddress,
      })),
      nextCursor: rows.length > 50 ? rows[49]!._id.toHexString() : null,
      indexedThrough: state ? state.nextBlock - 1 : null,
      startBlock: state?.startBlock ?? null,
      lastSyncedAt: state?.lastSyncedAt?.toISOString() ?? null,
      lastError: state?.lastError ?? null,
    };
  }
}
