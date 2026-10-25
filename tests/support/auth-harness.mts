import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { MongoClient } from 'mongodb';
import { AppModule } from '../../apps/api/src/app.module.js';
import { ENVIRONMENT } from '../../apps/api/src/config/environment.module.js';
import { configureHttp } from '../../apps/api/src/configure-http.js';
import { DatabaseService } from '../../apps/api/src/database/database.service.js';
import { GOOGLE_HTTP, GOOGLE_KEYS } from '../../apps/api/src/modules/auth/google.provider.js';
import { createGoogleFixture, testEnvironment } from './auth-fixture.mjs';

export async function createAuthHarness(googleEnabled = true) {
  const name = `p2p_auth_test_${randomUUID().replaceAll('-', '')}`;
  const environment = testEnvironment({
    MONGODB_DB: name,
    ...(googleEnabled
      ? {}
      : { GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', GOOGLE_REDIRECT_URI: '' }),
  });
  const google = await createGoogleFixture();
  async function cleanup() {
    if (!/^p2p_auth_test_[a-f0-9]{32}$/.test(name))
      throw new Error('Refusing to drop a non-test database.');
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
    .overrideProvider(GOOGLE_KEYS)
    .useValue(google.keys)
    .overrideProvider(GOOGLE_HTTP)
    .useValue(google.http)
    .compile();
  const app = module.createNestApplication({ logger: false });
  configureHttp(app, environment);
  try {
    await app.listen(0, '127.0.0.1');
  } catch (error) {
    try {
      await app.close();
    } finally {
      await cleanup();
    }
    throw new Error('Auth scenarios require local MongoDB rs0. Run scripts/db.ps1 start first.', {
      cause: error,
    });
  }
  const origin = await app.getUrl();
  const database = app.get(DatabaseService);
  const jar = new Map<string, string>();
  let csrfToken = '';

  async function request(
    path: string,
    method = 'GET',
    body?: unknown,
    options: { csrf?: boolean; csrfValue?: string; origin?: string; cookie?: string } = {},
  ) {
    if (!path.startsWith('/api/auth/'))
      throw new Error('Auth tests must target the local auth API.');
    const headers: Record<string, string> = {
      Cookie: options.cookie ?? [...jar].map(([key, value]) => `${key}=${value}`).join('; '),
    };
    if (method === 'POST') {
      headers.Origin = options.origin ?? environment.WEB_ORIGIN;
      headers['Content-Type'] = 'application/json';
      if (options.csrf !== false) headers['X-CSRF-Token'] = options.csrfValue ?? csrfToken;
    }
    const response = await fetch(`${origin}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
      signal: AbortSignal.timeout(10000),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';', 1)[0]!;
      const position = pair.indexOf('=');
      const key = pair.slice(0, position);
      const value = pair.slice(position + 1);
      if (/Max-Age=0(?:;|$)/i.test(cookie)) jar.delete(key);
      else jar.set(key, value);
    }
    return response;
  }
  async function refreshCsrf() {
    const response = await request('/api/auth/csrf');
    if (response.status !== 200) throw new Error('Could not obtain test CSRF token.');
    csrfToken = ((await response.json()) as { csrfToken: string }).csrfToken;
  }
  return {
    app,
    database,
    environment,
    google,
    jar,
    request,
    refreshCsrf,
    async post(
      path: string,
      body?: unknown,
      options: { csrf?: boolean; origin?: string; cookie?: string } = {},
    ) {
      if (options.csrf !== false) await refreshCsrf();
      return request(path, 'POST', body, options);
    },
    async close() {
      try {
        await app.close();
      } finally {
        await cleanup();
      }
    },
  };
}
export type AuthHarness = Awaited<ReturnType<typeof createAuthHarness>>;
