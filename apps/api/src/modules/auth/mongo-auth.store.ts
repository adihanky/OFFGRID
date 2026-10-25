import { ConflictException, Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { MongoServerError, type ObjectId } from 'mongodb';
import { DatabaseService } from '../../database/database.service.js';
import { initializeWalletSchema } from '../wallets/wallet-schema.js';
import { walletDocument } from '../wallets/wallet-document.js';
import {
  AuthStore,
  type OAuthAttempt,
  type SessionRecord,
  type UserRecord,
} from './auth.models.js';

@Injectable()
export class MongoAuthStore extends AuthStore implements OnModuleInit {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {
    super();
  }
  private get users() {
    return this.database.db.collection<UserRecord>('users');
  }
  private get sessions() {
    return this.database.db.collection<SessionRecord>('sessions');
  }
  private get oauth() {
    return this.database.db.collection<OAuthAttempt>('oauthAttempts');
  }

  async onModuleInit() {
    await initializeWalletSchema(this.database.db);
    const definitions = [
      [
        'users',
        {
          bsonType: 'object',
          required: [
            'normalizedEmail',
            'publicHandle',
            'displayName',
            'emailVerified',
            'status',
            'createdAt',
            'updatedAt',
          ],
          properties: {
            normalizedEmail: { bsonType: 'string' },
            publicHandle: { bsonType: 'string' },
            displayName: { bsonType: 'string' },
            passwordHash: { bsonType: 'string' },
            googleSubject: { bsonType: 'string' },
            emailVerified: { bsonType: 'bool' },
            status: { enum: ['active', 'disabled'] },
            createdAt: { bsonType: 'date' },
            updatedAt: { bsonType: 'date' },
            transferEligibilityRevision: { bsonType: 'long' },
          },
        },
      ],
      [
        'sessions',
        {
          bsonType: 'object',
          required: ['userId', 'tokenHash', 'createdAt', 'expiresAt', 'revokedAt'],
          properties: {
            userId: { bsonType: 'objectId' },
            tokenHash: { bsonType: 'string' },
            createdAt: { bsonType: 'date' },
            expiresAt: { bsonType: 'date' },
            revokedAt: { bsonType: ['date', 'null'] },
          },
        },
      ],
      [
        'oauthAttempts',
        {
          bsonType: 'object',
          required: ['browserHash', 'verifier', 'nonce', 'expiresAt'],
          properties: {
            _id: { bsonType: 'string' },
            browserHash: { bsonType: 'string' },
            verifier: { bsonType: 'string' },
            nonce: { bsonType: 'string' },
            expiresAt: { bsonType: 'date' },
          },
        },
      ],
      [
        'authRateLimits',
        {
          bsonType: 'object',
          required: ['hits', 'expiresAt'],
          properties: {
            _id: { bsonType: 'string' },
            hits: { bsonType: ['int', 'long', 'double'] },
            expiresAt: { bsonType: 'date' },
          },
        },
      ],
    ] as const;
    for (const [name, schema] of definitions) {
      const validator = { $jsonSchema: schema };
      try {
        await this.database.db.createCollection(name, { validator });
      } catch (error) {
        if (!(error instanceof MongoServerError) || error.code !== 48) throw error;
        await this.database.db.command({ collMod: name, validator, validationLevel: 'strict' });
      }
    }
    await Promise.all([
      this.users.createIndex({ normalizedEmail: 1 }, { unique: true }),
      this.users.createIndex({ publicHandle: 1 }, { unique: true }),
      this.users.createIndex(
        { googleSubject: 1 },
        { unique: true, partialFilterExpression: { googleSubject: { $type: 'string' } } },
      ),
      this.sessions.createIndex({ tokenHash: 1 }, { unique: true }),
      this.sessions.createIndex({ userId: 1 }),
      this.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      this.oauth.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      this.database.db
        .collection('authRateLimits')
        .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    ]);
  }

  async insertUser(user: UserRecord) {
    const session = this.database.client.startSession();
    try {
      await session.withTransaction(
        async () => {
          await this.users.insertOne(user, { session });
          await this.database.db
            .collection('wallets')
            .insertOne(walletDocument(user._id, user.createdAt), { session });
        },
        { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, timeoutMS: 10000 },
      );
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000)
        throw new ConflictException('Email or public handle is already registered.');
      throw error;
    } finally {
      await session.endSession();
    }
  }
  findUser(normalizedEmail: string) {
    return this.users.findOne({ normalizedEmail });
  }
  findGoogleUser(googleSubject: string) {
    return this.users.findOne({ googleSubject });
  }
  findUserById(_id: ObjectId) {
    return this.users.findOne({ _id });
  }
  async insertSession(session: SessionRecord) {
    await this.sessions.insertOne(session);
  }
  findSession(tokenHash: string, now: Date) {
    return this.sessions.findOne({ tokenHash, revokedAt: null, expiresAt: { $gt: now } });
  }
  async revokeSession(tokenHash: string, now: Date) {
    await this.sessions.updateOne({ tokenHash, revokedAt: null }, { $set: { revokedAt: now } });
  }
  async insertOAuth(attempt: OAuthAttempt) {
    await this.oauth.insertOne(attempt);
  }
  consumeOAuth(_id: string, browserHash: string, now: Date) {
    return this.oauth.findOneAndDelete({ _id, browserHash, expiresAt: { $gt: now } });
  }
  async incrementLimit(_id: string, expiresAt: Date) {
    const result = await this.database.db
      .collection<{ _id: string; hits: number; expiresAt: Date }>('authRateLimits')
      .findOneAndUpdate(
        { _id },
        { $inc: { hits: 1 }, $setOnInsert: { expiresAt } },
        { upsert: true, returnDocument: 'after' },
      );
    return result!.hits;
  }
}
