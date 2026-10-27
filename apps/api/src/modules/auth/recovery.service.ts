import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  type OnModuleInit,
} from '@nestjs/common';
import { ObjectId, type Long } from 'mongodb';
import { z } from 'zod';
import { DatabaseService } from '../../database/database.service.js';
import { ENVIRONMENT } from '../../config/environment.module.js';
import type { Environment } from '../../config/environment.js';
import { collectionSchema, oid, text, date, long } from '../accounts/schema.js';
import { objectId, TRANSACTION_OPTIONS } from '../accounts/accounts.service.js';
import { toLong } from '../accounts/quantity.js';
import { PasswordService, isToken, newToken, tokenHash } from './auth.crypto.js';
import { parseInput } from './auth.validation.js';
import type { SessionRecord, UserRecord } from './auth.models.js';
import { RecoveryDelivery } from './recovery-delivery.js';
interface RecoveryToken {
  _id: ObjectId;
  hash: string;
  userId: ObjectId;
  email: string;
  version: Long;
  kind: 'RESET' | 'VERIFY';
  expiresAt: Date;
  consumedAt: Date | null;
}
type RecoveryUser = UserRecord & { recoveryRevision?: Long };
const tokenSchema = z.string().refine(isToken);
const acknowledgment = {
  accepted: true,
  message:
    'If this address is eligible and delivery is enabled, recovery instructions will be sent. Password recovery requires a verified email and an existing password.',
};
@Injectable()
export class RecoveryService implements OnModuleInit {
  now: () => Date = () => new Date();
  constructor(
    @Inject(DatabaseService) readonly database: DatabaseService,
    @Inject(RecoveryDelivery) readonly delivery: RecoveryDelivery,
    @Inject(PasswordService) readonly passwords: PasswordService,
    @Inject(ENVIRONMENT) readonly environment: Environment,
  ) {}
  get tokens() {
    return this.database.db.collection<RecoveryToken>('recoveryTokens', { promoteLongs: false });
  }
  get users() {
    return this.database.db.collection<RecoveryUser>('users', { promoteLongs: false });
  }
  get sessions() {
    return this.database.db.collection<SessionRecord>('sessions');
  }
  async onModuleInit() {
    await collectionSchema(
      this.database.db,
      'recoveryTokens',
      {
        hash: text,
        userId: oid,
        email: text,
        version: long,
        kind: { enum: ['RESET', 'VERIFY'] },
        expiresAt: date,
        consumedAt: { bsonType: ['date', 'null'] },
      },
      undefined,
      { additionalProperties: false },
    );
    await this.tokens.createIndex({ hash: 1 }, { unique: true });
    await this.tokens.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  }
  status() {
    return {
      deliveryEnabled: this.delivery.enabled,
      passwordResetPolicy: 'VERIFIED_EMAIL_WITH_PASSWORD',
      message: this.delivery.enabled
        ? 'Recovery instructions are delivered through the configured adapter.'
        : 'Email delivery is disabled on this installation. Existing sign-in methods remain available.',
    };
  }
  async issue(user: RecoveryUser, kind: 'RESET' | 'VERIFY') {
    const token = newToken(),
      now = this.now();
    const record: RecoveryToken = {
      _id: new ObjectId(),
      hash: tokenHash(token),
      userId: user._id,
      email: user.normalizedEmail,
      version: user.recoveryRevision ?? toLong(0n),
      kind,
      expiresAt: new Date(now.getTime() + 15 * 60000),
      consumedAt: null,
    };
    await this.tokens.insertOne(record, { writeConcern: { w: 'majority' } });
    try {
      await this.delivery.send({
        to: user.normalizedEmail,
        kind,
        token,
        origin: this.environment.WEB_ORIGIN,
      });
    } catch {
      await this.tokens.updateOne({ _id: record._id }, { $set: { consumedAt: this.now() } });
      throw new ServiceUnavailableException('Recovery delivery is unavailable. Try again later.');
    }
  }
  async requestReset(input: unknown) {
    const { email } = parseInput(
      z.strictObject({ email: z.string().trim().toLowerCase().max(254).pipe(z.email()) }),
      input,
    );
    if (!this.delivery.enabled) return acknowledgment;
    const user = await this.users.findOne({
      normalizedEmail: email,
      status: 'active',
      emailVerified: true,
      passwordHash: { $type: 'string' },
    });
    if (user) {
      // Public acknowledgment never reveals an existing address or a delivery failure.
      try {
        await this.issue(user, 'RESET');
      } catch {
        /* Adapter health is shown only as installation capability. */
      }
    }
    return acknowledgment;
  }
  async requestVerification(userId: string, value: unknown) {
    parseInput(z.strictObject({}), value);
    if (!this.delivery.enabled)
      throw new ServiceUnavailableException(
        'Email delivery is disabled. You can continue with your existing sign-in method.',
      );
    const user = await this.users.findOne({ _id: objectId(userId), status: 'active' });
    if (!user) throw new NotFoundException();
    if (!user.emailVerified) await this.issue(user, 'VERIFY');
    return { accepted: true };
  }
  async consume(kind: 'RESET' | 'VERIFY', input: unknown, caller?: string) {
    const parsed =
      kind === 'RESET'
        ? parseInput(
            z.strictObject({ token: tokenSchema, password: z.string().min(12).max(128) }),
            input,
          )
        : parseInput(z.strictObject({ token: tokenSchema }), input);
    const hash = tokenHash(parsed.token);
    const available = await this.tokens.findOne({
      hash,
      kind,
      consumedAt: null,
      expiresAt: { $gt: this.now() },
    });
    if (!available)
      throw new BadRequestException('Recovery link is invalid or expired. Request a new link.');
    const passwordHash =
      'password' in parsed && typeof parsed.password === 'string'
        ? await this.passwords.hash(parsed.password)
        : undefined;
    const session = this.database.client.startSession();
    try {
      await session.withTransaction(async () => {
        const now = this.now();
        const token = await this.tokens.findOneAndUpdate(
          { _id: available._id, consumedAt: null, expiresAt: { $gt: now } },
          { $set: { consumedAt: now } },
          { session },
        );
        if (!token || (kind === 'VERIFY' && token.userId.toHexString() !== caller))
          throw new BadRequestException('Recovery link is invalid or expired.');
        const user = await this.users.findOne(
          { _id: token.userId, normalizedEmail: token.email, status: 'active' },
          { session },
        );
        if (
          !user ||
          (user.recoveryRevision?.toString() ?? '0') !== token.version.toString() ||
          (kind === 'RESET' && (!user.emailVerified || !user.passwordHash))
        )
          throw new BadRequestException('Recovery link is invalid or expired.');
        await this.users.updateOne(
          { _id: user._id },
          {
            $set: {
              ...(kind === 'VERIFY' ? { emailVerified: true } : { passwordHash: passwordHash! }),
              updatedAt: now,
            },
            $inc: { recoveryRevision: toLong(1n) },
          },
          { session },
        );
        if (kind === 'RESET')
          await this.sessions.updateMany(
            { userId: user._id, revokedAt: null },
            { $set: { revokedAt: now } },
            { session },
          );
      }, TRANSACTION_OPTIONS);
    } finally {
      await session.endSession();
    }
    return {
      completed: true,
      message:
        kind === 'RESET'
          ? 'Password updated. All previous sessions were revoked. Sign in with your new password.'
          : 'Email verified. Your sign-in identities have not been linked or changed.',
    };
  }
  async listSessions(caller: string, token: string) {
    const rows = await this.sessions
      .find({ userId: objectId(caller), revokedAt: null, expiresAt: { $gt: this.now() } })
      .sort({ createdAt: -1, _id: -1 })
      .limit(100)
      .toArray();
    return {
      sessions: rows.map((row) => ({
        id: row._id.toHexString(),
        current: row.tokenHash === tokenHash(token),
        createdAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
        label: 'Browser session',
      })),
    };
  }
  async revoke(caller: string, id: string) {
    const result = await this.sessions.updateOne(
      { _id: objectId(id), userId: objectId(caller) },
      { $set: { revokedAt: this.now() } },
    );
    if (!result.matchedCount) throw new NotFoundException('Session unavailable.');
    return { revoked: true };
  }
  async revokeOthers(caller: string, token: string) {
    await this.sessions.updateMany(
      { userId: objectId(caller), tokenHash: { $ne: tokenHash(token) }, revokedAt: null },
      { $set: { revokedAt: this.now() } },
    );
    return { revoked: true };
  }
}
