import 'reflect-metadata';
import assert from 'node:assert/strict';
import { After, Before, Given, Then, When, type World } from '@cucumber/cucumber';
import { tokenHash, newToken } from '../../apps/api/src/modules/auth/auth.crypto.js';
import { createAuthHarness, type AuthHarness } from '../support/auth-harness.mjs';
import { validSignUp, type GoogleMode } from '../support/auth-fixture.mjs';

interface AuthWorld extends World {
  harness: AuthHarness;
  authFixtureClosed?: boolean;
  response?: Response;
  body: unknown;
  previousSession?: string;
  googleUrl?: URL;
  googleState?: string;
  googleBrowser?: string;
  raceStatuses?: number[];
}
async function remember(world: AuthWorld, response: Response) {
  world.response = response;
  world.body = response.headers.get('content-type')?.includes('application/json')
    ? await response.json()
    : await response.text();
}
async function beginGoogle(world: AuthWorld) {
  await remember(world, await world.harness.request('/api/auth/google'));
  assert.equal(world.response!.status, 302);
  world.googleUrl = new URL(world.response!.headers.get('location')!);
  world.googleState = world.googleUrl.searchParams.get('state')!;
  world.harness.google.nonce = world.googleUrl.searchParams.get('nonce')!;
  world.harness.google.challenge = world.googleUrl.searchParams.get('code_challenge')!;
  world.googleBrowser = world.harness.jar.get('p2p_oauth');
}
async function completeGoogle(world: AuthWorld, cancelled = false) {
  const query = new URLSearchParams({
    state: world.googleState!,
    ...(cancelled ? { error: 'access_denied' } : { code: 'test-code' }),
  });
  await remember(world, await world.harness.request(`/api/auth/google/callback?${query}`));
}

// The full application now creates wallet/ledger/chain indexes as well as auth indexes.
Before({ tags: '@auth', timeout: 120000 }, async function (this: AuthWorld, { pickle }) {
  // Creating all module collections/indexes on a cold portable replica set can exceed one minute.
  const harness = await createAuthHarness(
    !pickle.tags.some((tag) => tag.name === '@google_disabled'),
  );
  if (this.authFixtureClosed) await harness.close();
  else this.harness = harness;
});
After({ tags: '@auth', timeout: 10000 }, async function (this: AuthWorld) {
  this.authFixtureClosed = true;
  await this.harness?.close();
});

Given('an anonymous authentication browser', async function (this: AuthWorld) {
  await this.harness.refreshCsrf();
});
Given('a registered email account', async function (this: AuthWorld) {
  const response = await this.harness.post('/api/auth/signup', validSignUp);
  assert.equal(response.status, 201);
  await response.body?.cancel();
  this.harness.jar.clear();
});
When(
  'I register with email {string} and handle {string}',
  async function (this: AuthWorld, email: string, publicHandle: string) {
    await remember(
      this,
      await this.harness.post('/api/auth/signup', { ...validSignUp, email, publicHandle }),
    );
  },
);
When(
  'I sign in with email {string} and password {string}',
  async function (this: AuthWorld, email: string, password: string) {
    this.previousSession = this.harness.jar.get('p2p_session');
    await remember(this, await this.harness.post('/api/auth/signin', { email, password }));
  },
);
When('I read my authentication session', async function (this: AuthWorld) {
  await remember(this, await this.harness.request('/api/auth/me'));
});
When('I sign out', async function (this: AuthWorld) {
  this.previousSession = this.harness.jar.get('p2p_session');
  await remember(this, await this.harness.post('/api/auth/signout', {}));
});
When('I replay the previous session cookie', async function (this: AuthWorld) {
  assert.ok(this.previousSession);
  await remember(
    this,
    await this.harness.request('/api/auth/me', 'GET', undefined, {
      cookie: `p2p_session=${this.previousSession}`,
    }),
  );
});
Then(
  'the public identity is {string} using {string}',
  function (this: AuthWorld, email: string, method: string) {
    assert.ok(this.body && typeof this.body === 'object' && 'user' in this.body);
    const user = this.body.user as Record<string, unknown>;
    assert.deepEqual(
      Object.keys(user).sort(),
      ['id', 'email', 'publicHandle', 'displayName', 'emailVerified', 'signInMethod'].sort(),
    );
    assert.equal(user.email, email);
    assert.equal(user.signInMethod, method);
    assert.equal(user.emailVerified, method === 'google');
    assert.equal(this.response!.headers.get('cache-control'), 'no-store');
  },
);
Then('credentials and session tokens are stored securely', async function (this: AuthWorld) {
  const user = await this.harness.database.db.collection('users').findOne({});
  assert.ok(user);
  if (user.googleSubject) assert.equal(user.passwordHash, undefined);
  else assert.match(user.passwordHash as string, /^\$argon2id\$/);
  const token = this.harness.jar.get('p2p_session');
  assert.ok(token);
  const session = await this.harness.database.db
    .collection('sessions')
    .findOne({ tokenHash: tokenHash(token) });
  assert.ok(session);
  assert.ok(!Object.values(session).includes(token));
  assert.equal(session.revokedAt, null);
  const userIndexes = await this.harness.database.db.collection('users').indexes();
  for (const field of ['normalizedEmail', 'publicHandle', 'googleSubject']) {
    assert.ok(userIndexes.some((index) => index.key[field] === 1 && index.unique === true));
  }
  const sessionIndexes = await this.harness.database.db.collection('sessions').indexes();
  assert.ok(sessionIndexes.some((index) => index.key.tokenHash === 1 && index.unique === true));
  assert.ok(
    sessionIndexes.some((index) => index.key.expiresAt === 1 && index.expireAfterSeconds === 0),
  );
});
Then('no new authentication session is issued', function (this: AuthWorld) {
  assert.equal(this.harness.jar.has('p2p_session'), false);
});
Then('there is exactly {int} stored user', async function (this: AuthWorld, count: number) {
  assert.equal(await this.harness.database.db.collection('users').countDocuments(), count);
});
When('I register a duplicate {string}', async function (this: AuthWorld, field: string) {
  assert.ok(field === 'email' || field === 'publicHandle');
  await remember(
    this,
    await this.harness.post('/api/auth/signup', {
      ...validSignUp,
      email: 'other@example.com',
      publicHandle: 'other',
      [field]: validSignUp[field],
    }),
  );
});
When('I submit registration with {string}', async function (this: AuthWorld, problem: string) {
  const cases: Record<string, Record<string, unknown>> = {
    'invalid email': { email: 'bad' },
    'short password': { password: 'x'.repeat(11) },
    'long password': { password: 'x'.repeat(129) },
    'short handle': { publicHandle: 'ab' },
    'long handle': { publicHandle: 'a'.repeat(25) },
    'invalid handle': { publicHandle: 'bad handle' },
    'unknown field': { admin: true },
    'object email': { email: { $ne: null } },
  };
  assert.ok(cases[problem]);
  await remember(
    this,
    await this.harness.post('/api/auth/signup', { ...validSignUp, ...cases[problem] }),
  );
});
When(
  'I register with password length {int} and handle length {int}',
  async function (this: AuthWorld, passwordLength: number, handleLength: number) {
    await remember(
      this,
      await this.harness.post('/api/auth/signup', {
        ...validSignUp,
        password: 'x'.repeat(passwordLength),
        publicHandle: 'a'.repeat(handleLength),
      }),
    );
  },
);
When('I register with {string} CSRF protection', async function (this: AuthWorld, problem: string) {
  assert.ok(['missing token', 'foreign origin'].includes(problem));
  await remember(
    this,
    await this.harness.post(
      '/api/auth/signup',
      validSignUp,
      problem === 'missing token' ? { csrf: false } : { origin: 'https://attacker.invalid' },
    ),
  );
});
When('I sign out using a CSRF token from another session', async function (this: AuthWorld) {
  const token = newToken();
  this.harness.jar.set('p2p_csrf', token);
  await remember(
    this,
    await this.harness.request('/api/auth/signout', 'POST', {}, { csrfValue: token }),
  );
});
Given(
  'the current authentication session is {string}',
  async function (this: AuthWorld, state: string) {
    const token = this.harness.jar.get('p2p_session');
    assert.ok(token);
    if (state === 'expired')
      await this.harness.database.db
        .collection('sessions')
        .updateOne(
          { tokenHash: tokenHash(token) },
          { $set: { expiresAt: new Date(Date.now() - 1) } },
        );
    else if (state === 'revoked')
      await this.harness.database.db
        .collection('sessions')
        .updateOne({ tokenHash: tokenHash(token) }, { $set: { revokedAt: new Date() } });
    else {
      assert.equal(state, 'disabled');
      await this.harness.database.db
        .collection('users')
        .updateOne({}, { $set: { status: 'disabled' } });
    }
  },
);
When('I attempt {int} incorrect sign-ins', async function (this: AuthWorld, count: number) {
  for (let index = 0; index < count; index++)
    await remember(
      this,
      await this.harness.post('/api/auth/signin', {
        email: validSignUp.email,
        password: 'incorrect password',
      }),
    );
});
When('two registrations race for the same email', async function (this: AuthWorld) {
  await this.harness.refreshCsrf();
  const responses = await Promise.all([
    this.harness.request('/api/auth/signup', 'POST', validSignUp),
    this.harness.request('/api/auth/signup', 'POST', { ...validSignUp, publicHandle: 'other' }),
  ]);
  this.raceStatuses = responses.map((response) => response.status).sort();
  for (const response of responses) await response.body?.cancel();
});
Then('exactly one registration succeeds', function (this: AuthWorld) {
  assert.deepEqual(this.raceStatuses, [201, 409]);
});

Given('Google returns {string}', function (this: AuthWorld, problem: string) {
  assert.ok(
    [
      'wrong signature',
      'wrong audience',
      'wrong issuer',
      'expired',
      'unverified email',
      'wrong nonce',
      'missing token',
      'provider failure',
    ].includes(problem),
  );
  this.harness.google.mode = problem as GoogleMode;
});
When('I start Google sign-in', async function (this: AuthWorld) {
  await beginGoogle(this);
});
Then('Google authorization uses state, nonce and PKCE', function (this: AuthWorld) {
  assert.equal(this.googleUrl!.origin, 'https://accounts.google.com');
  assert.equal(this.googleUrl!.searchParams.get('code_challenge_method'), 'S256');
  for (const field of ['state', 'nonce', 'code_challenge'])
    assert.match(this.googleUrl!.searchParams.get(field)!, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(this.googleUrl!.searchParams.has('client_secret'), false);
});
When('I complete Google sign-in', async function (this: AuthWorld) {
  await completeGoogle(this);
});
Then('the Google callback succeeds', function (this: AuthWorld) {
  assert.equal(this.response!.status, 302);
  assert.equal(this.response!.headers.get('location'), this.harness.environment.WEB_ORIGIN);
  assert.ok(this.harness.jar.has('p2p_session'));
});
Then('the Google callback fails with {string}', function (this: AuthWorld, reason: string) {
  assert.equal(this.response!.status, 302);
  const target = new URL(this.response!.headers.get('location')!);
  assert.equal(target.origin, this.harness.environment.WEB_ORIGIN);
  assert.equal(target.searchParams.get('auth_error'), reason);
});
When('the Google flow has {string}', async function (this: AuthWorld, problem: string) {
  if (problem === 'wrong state') this.googleState = newToken();
  else if (problem === 'wrong browser') this.harness.jar.set('p2p_oauth', newToken());
  else {
    assert.equal(problem, 'expired state');
    await this.harness.database.db
      .collection('oauthAttempts')
      .updateOne({}, { $set: { expiresAt: new Date(Date.now() - 1) } });
  }
});
When('I cancel Google sign-in', async function (this: AuthWorld) {
  await completeGoogle(this, true);
});
Then('Google tokens were not requested', function (this: AuthWorld) {
  assert.equal(this.harness.google.calls, 0);
});
When('I replay the Google callback in a fresh browser', async function (this: AuthWorld) {
  this.harness.jar.clear();
  this.harness.jar.set('p2p_oauth', this.googleBrowser!);
  await completeGoogle(this);
});
Given('Google uses the registered email', function (this: AuthWorld) {
  this.harness.google.email = validSignUp.email;
});
Then('the email account remains independent of Google', async function (this: AuthWorld) {
  const user = await this.harness.database.db
    .collection('users')
    .findOne({ normalizedEmail: validSignUp.email });
  assert.ok(user);
  assert.equal(user.googleSubject, undefined);
  assert.ok(user.passwordHash);
});
When('I inspect authentication providers', async function (this: AuthWorld) {
  await remember(this, await this.harness.request('/api/auth/providers'));
});
Then('Google sign-in is unavailable', function (this: AuthWorld) {
  assert.deepEqual(this.body, { google: false, email: true });
});
When('I start Google sign-in without credentials', async function (this: AuthWorld) {
  await remember(this, await this.harness.request('/api/auth/google'));
});
