import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { environmentSchema } from '../../apps/api/src/config/environment.js';
import {
  AuthStore,
  type OAuthAttempt,
  type SessionRecord,
  type UserRecord,
} from '../../apps/api/src/modules/auth/auth.models.js';
import { AuthService } from '../../apps/api/src/modules/auth/auth.service.js';
import { PasswordService, newToken } from '../../apps/api/src/modules/auth/auth.crypto.js';
import { GoogleProvider } from '../../apps/api/src/modules/auth/google.provider.js';
import type { ObjectId } from 'mongodb';

export const testEnvironment = (overrides: Record<string, unknown> = {}) =>
  environmentSchema.parse({
    NODE_ENV: 'test',
    API_PORT: 3000,
    WEB_ORIGIN: 'http://localhost:5173',
    MONGODB_URI: 'mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true',
    MONGODB_DB: 'p2p_auth_unit',
    MONGODB_REPLICA_SET: 'rs0',
    SESSION_TTL_SECONDS: 604800,
    GOOGLE_CLIENT_ID: 'test-google-client',
    GOOGLE_CLIENT_SECRET: 'synthetic-google-secret',
    GOOGLE_REDIRECT_URI: 'http://localhost:5173/api/auth/google/callback',
    ...overrides,
  });

export class MemoryAuthStore extends AuthStore {
  users: UserRecord[] = [];
  sessions: SessionRecord[] = [];
  attempts: OAuthAttempt[] = [];
  limits = new Map<string, number>();
  async insertUser(user: UserRecord) {
    if (
      this.users.some(
        (entry) =>
          entry.normalizedEmail === user.normalizedEmail ||
          entry.publicHandle === user.publicHandle ||
          (user.googleSubject && entry.googleSubject === user.googleSubject),
      )
    )
      throw new ConflictException('Email or public handle is already registered.');
    this.users.push(user);
  }
  async findUser(email: string) {
    return this.users.find((user) => user.normalizedEmail === email) ?? null;
  }
  async findGoogleUser(subject: string) {
    return this.users.find((user) => user.googleSubject === subject) ?? null;
  }
  async findUserById(id: ObjectId) {
    return this.users.find((user) => user._id.equals(id)) ?? null;
  }
  async insertSession(session: SessionRecord) {
    this.sessions.push(session);
  }
  async findSession(hash: string, now: Date) {
    return (
      this.sessions.find(
        (session) => session.tokenHash === hash && !session.revokedAt && session.expiresAt > now,
      ) ?? null
    );
  }
  async revokeSession(hash: string, now: Date) {
    for (const session of this.sessions)
      if (session.tokenHash === hash && !session.revokedAt) session.revokedAt = now;
  }
  async insertOAuth(attempt: OAuthAttempt) {
    this.attempts.push(attempt);
  }
  async consumeOAuth(hash: string, browserHash: string, now: Date) {
    const index = this.attempts.findIndex(
      (attempt) =>
        attempt._id === hash && attempt.browserHash === browserHash && attempt.expiresAt > now,
    );
    return index < 0 ? null : this.attempts.splice(index, 1)[0]!;
  }
  async incrementLimit(key: string) {
    const count = (this.limits.get(key) ?? 0) + 1;
    this.limits.set(key, count);
    return count;
  }
}

const keyPair = generateKeyPair('RS256');
const wrongKeyPair = generateKeyPair('RS256');
export type GoogleMode =
  | 'valid'
  | 'wrong signature'
  | 'wrong audience'
  | 'wrong issuer'
  | 'expired'
  | 'unverified email'
  | 'wrong nonce'
  | 'missing token'
  | 'provider failure';
export async function createGoogleFixture() {
  const pair = await keyPair;
  const jwk = await exportJWK(pair.publicKey);
  const keys = createLocalJWKSet({ keys: [{ ...jwk, kid: 'test-google-key', alg: 'RS256' }] });
  const fixture = {
    keys,
    nonce: newToken(),
    challenge: '',
    mode: 'valid' as GoogleMode,
    email: 'google@example.com',
    subject: 'google-subject-123',
    calls: 0,
  };
  const http: typeof fetch = async (_input, init) => {
    fixture.calls++;
    const params = new URLSearchParams(String(init?.body));
    if (
      fixture.challenge &&
      createHash('sha256')
        .update(params.get('code_verifier') ?? '')
        .digest('base64url') !== fixture.challenge
    )
      return new Response('{}', { status: 400 });
    if (fixture.mode === 'provider failure' || params.get('code') !== 'test-code')
      return new Response('{}', { status: 400 });
    if (fixture.mode === 'missing token')
      return Response.json({ access_token: 'irrelevant-to-login' });
    const signing = fixture.mode === 'wrong signature' ? await wrongKeyPair : pair;
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({
      email: fixture.email,
      email_verified: fixture.mode !== 'unverified email',
      nonce: fixture.mode === 'wrong nonce' ? newToken() : fixture.nonce,
      name: 'Test Google User',
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-google-key' })
      .setIssuer(
        fixture.mode === 'wrong issuer'
          ? 'https://attacker.invalid'
          : 'https://accounts.google.com',
      )
      .setAudience(fixture.mode === 'wrong audience' ? 'another-client' : 'test-google-client')
      .setSubject(fixture.subject)
      .setIssuedAt(now)
      .setExpirationTime(fixture.mode === 'expired' ? now - 1 : now + 3600)
      .sign(signing.privateKey);
    return Response.json({ id_token: token });
  };
  return Object.assign(fixture, { http });
}

export async function createUnitAuth() {
  const environment = testEnvironment();
  const store = new MemoryAuthStore();
  const passwords = new PasswordService();
  const provider = await createGoogleFixture();
  const google = new GoogleProvider(environment, provider.keys, provider.http);
  const auth = new AuthService(store, passwords, google, environment);
  return { auth, store, passwords, provider, environment };
}

export const validSignUp = {
  email: 'alice@example.com',
  publicHandle: 'alice',
  password: 'correct horse battery',
};
