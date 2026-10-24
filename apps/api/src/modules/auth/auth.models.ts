import type { ObjectId } from 'mongodb';

export interface UserRecord {
  _id: ObjectId;
  normalizedEmail: string;
  publicHandle: string;
  displayName: string;
  passwordHash?: string;
  googleSubject?: string;
  emailVerified: boolean;
  status: 'active' | 'disabled';
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionRecord {
  _id: ObjectId;
  userId: ObjectId;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface OAuthAttempt {
  _id: string;
  browserHash: string;
  verifier: string;
  nonce: string;
  expiresAt: Date;
}

export abstract class AuthStore {
  abstract insertUser(user: UserRecord): Promise<void>;
  abstract findUser(email: string): Promise<UserRecord | null>;
  abstract findGoogleUser(subject: string): Promise<UserRecord | null>;
  abstract findUserById(id: ObjectId): Promise<UserRecord | null>;
  abstract insertSession(session: SessionRecord): Promise<void>;
  abstract findSession(hash: string, now: Date): Promise<SessionRecord | null>;
  abstract revokeSession(hash: string, now: Date): Promise<void>;
  abstract insertOAuth(attempt: OAuthAttempt): Promise<void>;
  abstract consumeOAuth(
    stateHash: string,
    browserHash: string,
    now: Date,
  ): Promise<OAuthAttempt | null>;
  abstract incrementLimit(key: string, expiresAt: Date): Promise<number>;
}
