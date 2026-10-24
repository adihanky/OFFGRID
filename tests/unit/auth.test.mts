import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  csrfForSession,
  newToken,
  tokenHash,
} from '../../apps/api/src/modules/auth/auth.crypto.js';
import {
  parseInput,
  signInSchema,
  signUpSchema,
} from '../../apps/api/src/modules/auth/auth.validation.js';
import { environmentSchema } from '../../apps/api/src/config/environment.js';
import { createUnitAuth, testEnvironment, validSignUp } from '../support/auth-fixture.mjs';

describe('Email authentication and sessions', () => {
  it('[happy] signs up with Argon2id and stores only the session hash', async () => {
    const { auth, store, passwords } = await createUnitAuth();
    const result = await auth.signUp(validSignUp);
    assert.match(store.users[0]!.passwordHash!, /^\$argon2id\$/);
    assert.equal(await passwords.verify(validSignUp.password, store.users[0]!.passwordHash), true);
    assert.equal(store.sessions[0]!.tokenHash, tokenHash(result.token));
    assert.ok(!JSON.stringify(result.user).includes('password'));
    assert.equal(result.user.emailVerified, false);
    assert.equal((await auth.authenticate(result.token))?.user.id, result.user.id);
    assert.notEqual(csrfForSession(result.token), result.token);
  });
  it('[happy] signs in and rotates the previous session', async () => {
    const { auth } = await createUnitAuth();
    const first = await auth.signUp(validSignUp);
    const second = await auth.signIn(validSignUp, first.token);
    assert.equal(first.user.id, second.user.id);
    assert.notEqual(first.token, second.token);
    assert.equal(await auth.authenticate(first.token), null);
    assert.ok(await auth.authenticate(second.token));
  });
  it('[happy] revokes a session on sign-out', async () => {
    const { auth } = await createUnitAuth();
    const result = await auth.signUp(validSignUp);
    await auth.signOut(result.token);
    assert.equal(await auth.authenticate(result.token), null);
  });
  for (const field of ['email', 'publicHandle'] as const) {
    it(`[negative] rejects duplicate ${field}`, async () => {
      const { auth, store } = await createUnitAuth();
      await auth.signUp(validSignUp);
      await assert.rejects(
        () =>
          auth.signUp({
            ...validSignUp,
            email: 'other@example.com',
            publicHandle: 'other',
            [field]: validSignUp[field],
          }),
        ConflictException,
      );
      assert.equal(store.users.length, 1);
      assert.equal(store.sessions.length, 1);
    });
  }
  it('[negative] uses the same failure for an unknown email and wrong password', async () => {
    const { auth } = await createUnitAuth();
    await auth.signUp(validSignUp);
    for (const email of [validSignUp.email, 'unknown@example.com']) {
      await assert.rejects(
        () => auth.signIn({ email, password: 'incorrect password' }),
        (error: unknown) => {
          assert.ok(error instanceof UnauthorizedException);
          assert.equal(error.message, 'Email or password is incorrect.');
          return true;
        },
      );
    }
  });
  for (const state of ['expired', 'revoked', 'disabled', 'deleted'] as const) {
    it(`[edge] rejects a ${state} session or account before TTL deletion`, async () => {
      const { auth, store } = await createUnitAuth();
      const result = await auth.signUp(validSignUp);
      if (state === 'expired') store.sessions[0]!.expiresAt = new Date(Date.now() - 1);
      if (state === 'revoked') store.sessions[0]!.revokedAt = new Date();
      if (state === 'disabled') store.users[0]!.status = 'disabled';
      if (state === 'deleted') store.users = [];
      assert.equal(await auth.authenticate(result.token), null);
    });
  }
  it('[negative] disabled accounts cannot sign in', async () => {
    const { auth, store } = await createUnitAuth();
    await auth.signUp(validSignUp);
    store.users[0]!.status = 'disabled';
    await assert.rejects(() => auth.signIn(validSignUp), UnauthorizedException);
  });
  it('[edge] rejects malformed and unknown tokens', async () => {
    const { auth } = await createUnitAuth();
    for (const token of [undefined, null, '', {}, 'x', 'x'.repeat(10000), newToken()])
      assert.equal(await auth.authenticate(token), null);
  });
  it('[negative] rate limits repeated attempts', async () => {
    const { auth } = await createUnitAuth();
    for (let index = 0; index < 10; index++) await auth.throttle('account-test', 10);
    await assert.rejects(
      () => auth.throttle('account-test', 10),
      (error: unknown) => error instanceof HttpException && error.getStatus() === 429,
    );
  });
  it('[edge] starts a new rate-limit window even before TTL cleanup', async (context) => {
    const { auth } = await createUnitAuth();
    let now = 900000;
    context.mock.method(Date, 'now', () => now);
    await auth.throttle('boundary', 1);
    await assert.rejects(() => auth.throttle('boundary', 1));
    now += 900000;
    await auth.throttle('boundary', 1);
  });
});

describe('Authentication validation', () => {
  it('[happy] normalizes email and public handles while preserving the password', () => {
    const input = parseInput(signUpSchema, {
      email: ' Alice@Example.COM ',
      publicHandle: ' ALICE ',
      password: '  long password  ',
    });
    assert.deepEqual(input, {
      email: 'alice@example.com',
      publicHandle: 'alice',
      password: '  long password  ',
    });
  });
  it('[negative] rejects invalid input and unknown fields', () => {
    for (const patch of [
      { email: 'bad' },
      { password: 'short' },
      { publicHandle: '1bad' },
      { admin: true },
      { email: { $ne: null } },
    ])
      assert.throws(
        () => parseInput(signUpSchema, { ...validSignUp, ...patch }),
        BadRequestException,
      );
    assert.throws(
      () => parseInput(signInSchema, { email: validSignUp.email, password: 'x'.repeat(129) }),
      BadRequestException,
    );
  });
  it('[edge] accepts exact password/handle limits and rejects outside them', () => {
    for (const length of [12, 128])
      assert.ok(signUpSchema.safeParse({ ...validSignUp, password: 'x'.repeat(length) }).success);
    for (const length of [11, 129])
      assert.equal(
        signUpSchema.safeParse({ ...validSignUp, password: 'x'.repeat(length) }).success,
        false,
      );
    for (const length of [3, 24])
      assert.ok(
        signUpSchema.safeParse({ ...validSignUp, publicHandle: 'a'.repeat(length) }).success,
      );
    for (const length of [2, 25])
      assert.equal(
        signUpSchema.safeParse({ ...validSignUp, publicHandle: 'a'.repeat(length) }).success,
        false,
      );
  });
  it('[happy] allows email-only deployment with no Google credentials', () => {
    assert.ok(
      testEnvironment({ GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', GOOGLE_REDIRECT_URI: '' }),
    );
  });
  it('[negative] rejects partial Google settings and insecure production origins', () => {
    assert.equal(
      environmentSchema.safeParse({ ...testEnvironment(), GOOGLE_CLIENT_SECRET: '' }).success,
      false,
    );
    assert.equal(
      environmentSchema.safeParse({ ...testEnvironment(), NODE_ENV: 'production' }).success,
      false,
    );
    assert.equal(
      environmentSchema.safeParse({
        ...testEnvironment(),
        WEB_ORIGIN: 'http://localhost:5173/path',
      }).success,
      false,
    );
  });
  it('[edge] accepts production HTTPS and the configured session TTL boundaries', () => {
    for (const SESSION_TTL_SECONDS of [60, 2592000])
      assert.ok(
        testEnvironment({
          NODE_ENV: 'production',
          WEB_ORIGIN: 'https://example.com',
          GOOGLE_REDIRECT_URI: 'https://example.com/api/auth/google/callback',
          SESSION_TTL_SECONDS,
        }),
      );
    for (const SESSION_TTL_SECONDS of [59, 2592001])
      assert.equal(
        environmentSchema.safeParse({ ...testEnvironment(), SESSION_TTL_SECONDS }).success,
        false,
      );
  });
});

describe('Google OAuth sessions', () => {
  async function begin() {
    const fixture = await createUnitAuth();
    const flow = await fixture.auth.startGoogle();
    const url = new URL(flow.url);
    fixture.provider.nonce = url.searchParams.get('nonce')!;
    return { ...fixture, flow, state: url.searchParams.get('state')!, url };
  }
  it('[happy] uses PKCE and creates a verified Google identity', async () => {
    const { auth, store, flow, state, url } = await begin();
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('scope'), 'openid email profile');
    const result = await auth.finishGoogle(state, flow.browser, 'test-code');
    assert.equal(result.user.signInMethod, 'google');
    assert.equal(result.user.emailVerified, true);
    assert.equal(store.users[0]!.passwordHash, undefined);
    assert.equal(store.attempts.length, 0);
  });
  it('[negative] rejects the wrong browser without consuming the real flow', async () => {
    const { auth, flow, state } = await begin();
    await assert.rejects(
      () => auth.finishGoogle(state, newToken(), 'test-code'),
      UnauthorizedException,
    );
    assert.ok(await auth.finishGoogle(state, flow.browser, 'test-code'));
  });
  it('[negative] rejects expired flows and provider cancellation', async () => {
    const fixture = await begin();
    fixture.store.attempts[0]!.expiresAt = new Date(Date.now() - 1);
    await assert.rejects(
      () => fixture.auth.finishGoogle(fixture.state, fixture.flow.browser, 'test-code'),
      UnauthorizedException,
    );
    const cancelled = await begin();
    await assert.rejects(
      () =>
        cancelled.auth.finishGoogle(
          cancelled.state,
          cancelled.flow.browser,
          undefined,
          'access_denied',
        ),
      UnauthorizedException,
    );
    assert.equal(cancelled.provider.calls, 0);
    assert.equal(cancelled.store.attempts.length, 0);
  });
  it('[edge] consumes state once and rejects replay', async () => {
    const { auth, flow, state, store } = await begin();
    await auth.finishGoogle(state, flow.browser, 'test-code');
    await assert.rejects(
      () => auth.finishGoogle(state, flow.browser, 'test-code'),
      UnauthorizedException,
    );
    assert.equal(store.users.length, 1);
  });
  it('[negative] never links a Google identity to an email account automatically', async () => {
    const { auth, flow, state, provider, store } = await begin();
    await auth.signUp(validSignUp);
    provider.email = validSignUp.email;
    await assert.rejects(
      () => auth.finishGoogle(state, flow.browser, 'test-code'),
      ConflictException,
    );
    assert.equal(store.users[0]!.googleSubject, undefined);
  });
  it('[edge] repeated Google sign-in reuses the subject even if its email changes', async () => {
    const fixture = await begin();
    const first = await fixture.auth.finishGoogle(fixture.state, fixture.flow.browser, 'test-code');
    const next = await fixture.auth.startGoogle();
    const url = new URL(next.url);
    fixture.provider.nonce = url.searchParams.get('nonce')!;
    fixture.provider.email = 'changed@example.com';
    const second = await fixture.auth.finishGoogle(
      url.searchParams.get('state')!,
      next.browser,
      'test-code',
    );
    assert.equal(first.user.id, second.user.id);
    assert.equal(fixture.store.users.length, 1);
    await assert.rejects(
      () => fixture.auth.signIn({ email: first.user.email, password: validSignUp.password }),
      UnauthorizedException,
    );
  });
});
