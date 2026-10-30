import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { Long, MongoServerError, ObjectId, type ClientSession } from 'mongodb';
import type {
  ChatConversation,
  ChatConversationPage,
  ChatMessage,
  ChatMessagePage,
} from '@p2p/contracts';
import { z } from 'zod';
import { DatabaseService } from '../../database/database.service.js';
import { AccountsService, objectId, TRANSACTION_OPTIONS } from '../accounts/accounts.service.js';
import { collectionSchema, date, long, oid, text } from '../accounts/schema.js';
import { IdentityEligibility } from '../auth/identity-eligibility.service.js';
import { parseInput } from '../assets/asset-input.js';
import {
  blockInput,
  conversationInput,
  messageDigest,
  messageInput,
  messageQuery,
  pairKey,
  readInput,
} from './chat-input.js';
interface ConversationRecord {
  _id: ObjectId;
  schemaVersion: 1;
  canonicalPairKey: string;
  participantIds: ObjectId[];
  blockedBy: ObjectId[];
  lastSequence: Long;
  revision: Long;
  createdAt: Date;
  lastMessageAt: Date | null;
}
interface MessageRecord {
  _id: ObjectId;
  schemaVersion: 1;
  conversationId: ObjectId;
  sequence: Long;
  senderId: ObjectId;
  clientMessageId: string;
  text: string;
  digest: string;
  createdAt: Date;
}
interface MemberRecord {
  _id: ObjectId;
  conversationId: ObjectId;
  userId: ObjectId;
  readThrough: Long;
}
const unavailable = () => new NotFoundException('Conversation unavailable.');
const number = (value: Long) => value.toString();
export function messageView(row: MessageRecord): ChatMessage {
  return {
    id: row._id.toHexString(),
    conversationId: row.conversationId.toHexString(),
    senderId: row.senderId.toHexString(),
    sequence: number(row.sequence),
    clientMessageId: row.clientMessageId,
    text: row.text,
    createdAt: row.createdAt.toISOString(),
  };
}
@Injectable()
export class ChatService implements OnModuleInit {
  constructor(
    @Inject(DatabaseService) readonly database: DatabaseService,
    @Inject(AccountsService) readonly accounts: AccountsService,
    @Inject(IdentityEligibility) readonly identities: IdentityEligibility,
  ) {}
  get conversations() {
    return this.database.db.collection<ConversationRecord>('conversations', {
      promoteLongs: false,
    });
  }
  get messages() {
    return this.database.db.collection<MessageRecord>('messages', { promoteLongs: false });
  }
  get members() {
    return this.database.db.collection<MemberRecord>('conversationMembers', {
      promoteLongs: false,
    });
  }
  async onModuleInit() {
    const ids = { bsonType: 'array', items: oid };
    await collectionSchema(
      this.database.db,
      'conversations',
      {
        schemaVersion: { enum: [1] },
        canonicalPairKey: text,
        participantIds: { ...ids, minItems: 2, maxItems: 2, uniqueItems: true },
        blockedBy: ids,
        lastSequence: long,
        revision: long,
        createdAt: date,
        lastMessageAt: { bsonType: ['date', 'null'] },
      },
      undefined,
      { additionalProperties: false },
    );
    await this.conversations.createIndex({ canonicalPairKey: 1 }, { unique: true });
    await this.conversations.createIndex({ participantIds: 1, lastMessageAt: -1, _id: -1 });
    await collectionSchema(
      this.database.db,
      'messages',
      {
        schemaVersion: { enum: [1] },
        conversationId: oid,
        sequence: long,
        senderId: oid,
        clientMessageId: text,
        text: { ...text, maxLength: 16000 },
        digest: text,
        createdAt: date,
      },
      undefined,
      { additionalProperties: false },
    );
    await this.messages.createIndex({ conversationId: 1, sequence: 1 }, { unique: true });
    await this.messages.createIndex(
      { conversationId: 1, senderId: 1, clientMessageId: 1 },
      { unique: true },
    );
    await collectionSchema(
      this.database.db,
      'conversationMembers',
      { conversationId: oid, userId: oid, readThrough: long },
      undefined,
      { additionalProperties: false },
    );
    await this.members.createIndex({ conversationId: 1, userId: 1 }, { unique: true });
    await collectionSchema(
      this.database.db,
      'chatEvents',
      { eventId: text, conversationId: oid, sequence: long, createdAt: date },
      undefined,
      { additionalProperties: false },
    );
    await this.database.db.collection('chatEvents').createIndex({ eventId: 1 }, { unique: true });
  }
  async member(caller: string, id: string, session?: ClientSession) {
    const row = await this.conversations.findOne(
      { _id: objectId(id), participantIds: objectId(caller) },
      { session },
    );
    if (!row) throw unavailable();
    return row;
  }
  async view(caller: string, row: ConversationRecord): Promise<ChatConversation> {
    const peerId = row.participantIds.find((id) => !id.equals(caller))!;
    const peer = await this.identities.profile(peerId);
    const member = await this.members.findOne({
      conversationId: row._id,
      userId: objectId(caller),
    });
    const unreadCount = await this.messages.countDocuments(
      {
        conversationId: row._id,
        senderId: peerId,
        sequence: { $gt: member?.readThrough ?? Long.ZERO },
      },
      { maxTimeMS: 5000 },
    );
    return {
      id: row._id.toHexString(),
      peer: peer ?? { id: peerId.toHexString(), publicHandle: '', displayName: 'Unavailable peer' },
      lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
      unreadCount,
      blockedByMe: row.blockedBy.some((id) => id.equals(caller)),
      blocked: row.blockedBy.length > 0,
    };
  }
  async open(caller: string, value: unknown) {
    const { peerHandle } = parseInput(conversationInput, value);
    await this.accounts.throttle(caller, 'chat-open', 60);
    const peer = await this.identities.peer(peerHandle);
    if (!peer || peer.id === caller) throw unavailable();
    const key = pairKey(caller, peer.id);
    const existing = await this.conversations.findOne({ canonicalPairKey: key });
    if (existing) return { conversation: await this.view(caller, existing) };
    const session = this.database.client.startSession();
    const row: ConversationRecord = {
      _id: new ObjectId(),
      schemaVersion: 1,
      canonicalPairKey: key,
      participantIds: key.split(':').map(objectId),
      blockedBy: [],
      lastSequence: Long.ZERO,
      revision: Long.ZERO,
      createdAt: new Date(),
      lastMessageAt: null,
    };
    try {
      await session.withTransaction(async () => {
        for (const id of row.participantIds)
          if (!(await this.identities.fence(id, session))) throw unavailable();
        await this.conversations.insertOne(row, { session });
        await this.members.insertMany(
          row.participantIds.map((id) => ({
            _id: new ObjectId(),
            conversationId: row._id,
            userId: id,
            readThrough: Long.ZERO,
          })),
          { session },
        );
      }, TRANSACTION_OPTIONS);
    } catch (error) {
      if (!(error instanceof MongoServerError) || error.code !== 11000) throw error;
      const concurrent = await this.conversations.findOne({ canonicalPairKey: key });
      if (!concurrent) throw error;
      return { conversation: await this.view(caller, concurrent) };
    } finally {
      await session.endSession();
    }
    return { conversation: await this.view(caller, row) };
  }
  async list(caller: string, query: unknown): Promise<ChatConversationPage> {
    const { cursor } = parseInput(
      z.strictObject({ cursor: z.string().max(250).optional() }),
      query,
    );
    await this.accounts.throttle(caller, 'chat-read', 240);
    let before;
    if (cursor) {
      try {
        const raw: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString());
        const parsed = z
          .strictObject({ at: z.iso.datetime(), id: z.string().regex(/^[a-f0-9]{24}$/) })
          .parse(raw);
        before = {
          $or: [
            { lastMessageAt: { $lt: new Date(parsed.at) } },
            { lastMessageAt: new Date(parsed.at), _id: { $lt: objectId(parsed.id) } },
          ],
        };
      } catch {
        throw new ConflictException('Invalid conversation cursor.');
      }
    }
    const rows = await this.conversations
      .find({ participantIds: objectId(caller), lastMessageAt: { $ne: null }, ...before })
      .sort({ lastMessageAt: -1, _id: -1 })
      .limit(21)
      .maxTimeMS(5000)
      .toArray();
    const last = rows[19];
    return {
      conversations: await Promise.all(rows.slice(0, 20).map((row) => this.view(caller, row))),
      nextCursor:
        rows.length > 20 && last
          ? Buffer.from(
              JSON.stringify({ at: last.lastMessageAt!.toISOString(), id: last._id.toHexString() }),
            ).toString('base64url')
          : null,
    };
  }
  async history(caller: string, id: string, query: unknown): Promise<ChatMessagePage> {
    const input = parseInput(messageQuery, query);
    await this.accounts.throttle(caller, 'chat-read', 240);
    const row = await this.member(caller, id);
    const rows = await this.messages
      .find({
        conversationId: row._id,
        ...(input.before ? { sequence: { $lt: Long.fromString(input.before) } } : {}),
        ...(input.after ? { sequence: { $gt: Long.fromString(input.after) } } : {}),
      })
      .sort({ sequence: input.after !== undefined ? 1 : -1 })
      .limit(51)
      .maxTimeMS(5000)
      .toArray();
    const page = rows.slice(0, 50),
      nextCursor = rows.length > 50 ? page[49]!.sequence.toString() : null;
    if (input.after === undefined) page.reverse();
    return {
      conversation: await this.view(caller, row),
      messages: page.map(messageView),
      nextCursor,
      highWaterSequence: row.lastSequence.toString(),
    };
  }
  async send(caller: string, id: string, value: unknown) {
    const input = parseInput(messageInput, value),
      digest = messageDigest(input.text);
    await this.accounts.throttle(caller, 'chat-send', 30);
    const session = this.database.client.startSession();
    let result: MessageRecord | null = null;
    try {
      await session.withTransaction(async () => {
        const conversation = await this.member(caller, id, session);
        const previous = await this.messages.findOne(
          {
            conversationId: conversation._id,
            senderId: objectId(caller),
            clientMessageId: input.clientMessageId,
          },
          { session },
        );
        if (previous) {
          if (previous.digest !== digest)
            throw new ConflictException({
              code: 'IDEMPOTENCY_CONFLICT',
              message: 'This message identity already has different text.',
            });
          result = previous;
          return;
        }
        if (conversation.blockedBy.length)
          throw new ConflictException('Messaging is blocked in this conversation.');
        for (const participant of conversation.participantIds)
          if (!(await this.identities.fence(participant, session))) throw unavailable();
        const now = new Date();
        const updated = await this.conversations.findOneAndUpdate(
          { _id: conversation._id, revision: conversation.revision },
          {
            $inc: { revision: Long.ONE, lastSequence: Long.ONE },
            $set: { lastMessageAt: now },
          },
          { session, returnDocument: 'after' },
        );
        if (!updated) throw new ConflictException('Conversation changed. Retry the same message.');
        result = {
          _id: new ObjectId(),
          schemaVersion: 1,
          conversationId: conversation._id,
          sequence: updated.lastSequence,
          senderId: objectId(caller),
          clientMessageId: input.clientMessageId,
          text: input.text,
          digest,
          createdAt: now,
        };
        await this.messages.insertOne(result, { session });
        await this.database.db.collection('chatEvents').insertOne(
          {
            eventId: `chat:${result._id}`,
            conversationId: conversation._id,
            sequence: updated.lastSequence,
            createdAt: now,
          },
          { session },
        );
      }, TRANSACTION_OPTIONS);
    } finally {
      await session.endSession();
    }
    return { message: messageView(result!) };
  }
  async read(caller: string, id: string, value: unknown) {
    const input = parseInput(readInput, value);
    await this.accounts.throttle(caller, 'chat-read-mark', 120);
    const row = await this.member(caller, id);
    const through = Long.fromString(input.throughSequence);
    if (through.greaterThan(row.lastSequence))
      throw new ConflictException('Read cursor exceeds conversation history.');
    await this.members.updateOne(
      { conversationId: row._id, userId: objectId(caller) },
      { $max: { readThrough: through } },
    );
    return { read: true };
  }
  async block(caller: string, id: string, value: unknown) {
    const input = parseInput(blockInput, value);
    await this.accounts.throttle(caller, 'chat-block', 30);
    await this.member(caller, id);
    const row = await this.conversations.findOneAndUpdate(
      { _id: objectId(id), participantIds: objectId(caller) },
      {
        $inc: { revision: Long.ONE },
        ...(input.blocked
          ? { $addToSet: { blockedBy: objectId(caller) } }
          : { $pull: { blockedBy: objectId(caller) } }),
      },
      { returnDocument: 'after' },
    );
    if (!row) throw unavailable();
    return { conversation: await this.view(caller, row) };
  }
}
