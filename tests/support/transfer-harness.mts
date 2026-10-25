import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { MongoClient, ObjectId } from 'mongodb';
import { AppModule } from '../../apps/api/src/app.module.js';
import { ENVIRONMENT } from '../../apps/api/src/config/environment.module.js';
import { configureHttp } from '../../apps/api/src/configure-http.js';
import { DatabaseService } from '../../apps/api/src/database/database.service.js';
import { AccountsService } from '../../apps/api/src/modules/accounts/accounts.service.js';
import { TransfersService } from '../../apps/api/src/modules/transfers/transfers.service.js';
import { TransferRecoveryService } from '../../apps/api/src/workers/transfer-recovery.service.js';
import { walletDocument } from '../../apps/api/src/modules/wallets/wallet-document.js';
import {
  csrfForSession,
  newToken,
  tokenHash,
} from '../../apps/api/src/modules/auth/auth.crypto.js';
import { testEnvironment } from './auth-fixture.mjs';

export interface TransferCaller {
  id: string;
  handle: string;
  jar: Map<string, string>;
  csrf: string;
}

export async function createTransferHarness(overrides: Record<string, string> = {}) {
  const name = `p2p_transfer_test_${randomUUID().replaceAll('-', '')}`;
  const environment = testEnvironment({
    MONGODB_DB: name,
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
    GOOGLE_REDIRECT_URI: '',
    ...overrides,
  });
  async function cleanup() {
    if (!/^p2p_transfer_test_[a-f0-9]{32}$/.test(name))
      throw new Error('Refusing to drop non-test database.');
    const client = new MongoClient(environment.MONGODB_URI, { serverSelectionTimeoutMS: 3000 });
    try {
      await client.connect();
      await client.db(name).dropDatabase();
    } finally {
      await client.close();
    }
  }
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ENVIRONMENT)
    .useValue(environment)
    .compile();
  let app = module.createNestApplication({ logger: false });
  configureHttp(app, environment);
  try {
    await app.listen(0, '127.0.0.1');
    await app.get(TransferRecoveryService).stop();
  } catch (error) {
    try {
      await app.close();
    } finally {
      await cleanup();
    }
    throw new Error('Transfer scenarios require local MongoDB rs0. Run scripts/db.ps1 start.', {
      cause: error,
    });
  }
  let origin = await app.getUrl();
  let database = app.get(DatabaseService);
  let accounts = app.get(AccountsService);
  let transfers = app.get(TransfersService);
  const anonymous: TransferCaller = { id: '', handle: '', jar: new Map(), csrf: '' };
  async function request(
    caller: TransferCaller,
    path: string,
    method = 'GET',
    body?: unknown,
    options: {
      csrf?: boolean;
      csrfValue?: string;
      origin?: string;
      key?: string;
      revision?: string;
    } = {},
  ) {
    if (
      !/^\/api\/(auth\/(csrf|signup|signin|signout|me)|accounts|peers|transfers(?:\/[a-f0-9]{24})?|v2\/(wallet|peer-resolutions|custody(?:\/[a-f0-9]{24})?|admin\/(?:status|setup|assets(?:\/[a-f0-9]{24})?|issuances|roles|audit|seed\/(?:preview|run))|transfers(?:\/[a-f0-9]{24})?))(?:\?|$)/.test(
        path,
      )
    )
      throw new Error('Transfer tests may only call the allowlisted local API routes.');
    const headers: Record<string, string> = {
      Cookie: [...caller.jar].map(([key, value]) => `${key}=${value}`).join('; '),
    };
    if (method === 'POST') {
      headers.Origin = options.origin ?? environment.WEB_ORIGIN;
      headers['Content-Type'] = 'application/json';
      if (options.csrf !== false) headers['X-CSRF-Token'] = options.csrfValue ?? caller.csrf;
    }
    if (options.key !== undefined) headers['Idempotency-Key'] = options.key;
    if (options.revision !== undefined) headers['If-Match'] = options.revision;
    const response = await fetch(`${origin}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
      signal: AbortSignal.timeout(20000),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';', 1)[0]!;
      const position = pair.indexOf('=');
      const key = pair.slice(0, position);
      if (/Max-Age=0(?:;|$)/i.test(cookie)) caller.jar.delete(key);
      else caller.jar.set(key, pair.slice(position + 1));
    }
    return response;
  }
  async function csrf(caller: TransferCaller) {
    const response = await request(caller, '/api/auth/csrf');
    assert.equal(response.status, 200);
    caller.csrf = ((await response.json()) as { csrfToken: string }).csrfToken;
  }
  async function register(handle: string) {
    // Signup/password behavior has its own suite. These controlled sessions still
    // traverse the real guard, hashed-token lookup and session-bound CSRF checks.
    const id = new ObjectId();
    const now = new Date();
    const token = newToken();
    const csrfToken = csrfForSession(token);
    await database.db.collection('users').insertOne({
      _id: id,
      normalizedEmail: `${handle}@example.invalid`,
      publicHandle: handle,
      displayName: handle,
      emailVerified: false,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
    await database.db.collection('wallets').insertOne(walletDocument(id, now));
    await database.db.collection('sessions').insertOne({
      _id: new ObjectId(),
      userId: id,
      tokenHash: tokenHash(token),
      createdAt: now,
      expiresAt: new Date(now.getTime() + 3600000),
      revokedAt: null,
    });
    const caller: TransferCaller = {
      id: id.toHexString(),
      handle,
      csrf: csrfToken,
      jar: new Map([
        ['p2p_session', token],
        ['p2p_csrf', csrfToken],
      ]),
    };
    return caller;
  }
  return {
    get app() {
      return app;
    },
    get database() {
      return database;
    },
    get accounts() {
      return accounts;
    },
    get transfers() {
      return transfers;
    },
    environment,
    anonymous,
    request,
    csrf,
    register,
    async restart() {
      await app.close();
      const restarted = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(ENVIRONMENT)
        .useValue(environment)
        .compile();
      app = restarted.createNestApplication({ logger: false });
      configureHttp(app, environment);
      await app.listen(0, '127.0.0.1');
      await app.get(TransferRecoveryService).stop();
      origin = await app.getUrl();
      database = app.get(DatabaseService);
      accounts = app.get(AccountsService);
      transfers = app.get(TransfersService);
    },
    async issue(
      caller: TransferCaller,
      assetId: string,
      units: bigint,
      key = `${caller.handle}:${assetId}`,
    ) {
      return accounts.issueDemo({
        fixtureKey: key,
        userId: new ObjectId(caller.id),
        assetId: new ObjectId(assetId),
        quantityUnits: units,
      });
    },
    async close() {
      transfers.fault = undefined;
      try {
        await app.close();
      } finally {
        await cleanup();
      }
    },
  };
}
export type TransferHarness = Awaited<ReturnType<typeof createTransferHarness>>;
