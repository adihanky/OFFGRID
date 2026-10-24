import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { authApi, AuthApiError } from '../../apps/web/src/auth.js';
import { validSignUp } from '../support/auth-fixture.mjs';

describe('Browser authentication API', () => {
  it('[happy] fetches CSRF first and submits credentials with cookies', async (context) => {
    const calls: { path: unknown; init?: RequestInit }[] = [];
    context.mock.method(globalThis, 'fetch', async (path: unknown, init?: RequestInit) => {
      calls.push({ path, init });
      return Response.json(
        calls.length === 1 ? { csrfToken: 'test-csrf' } : { user: { email: validSignUp.email } },
      );
    });
    const result = await authApi.signUp(validSignUp);
    assert.equal(result.user.email, validSignUp.email);
    assert.deepEqual(
      calls.map((call) => call.path),
      ['/api/auth/csrf', '/api/auth/signup'],
    );
    assert.equal(calls[1]!.init!.credentials, 'same-origin');
    assert.equal(new Headers(calls[1]!.init!.headers).get('x-csrf-token'), 'test-csrf');
    assert.equal(calls[1]!.init!.body, JSON.stringify(validSignUp));
  });
  it('[negative] exposes a safe sign-in error and stops if CSRF fails', async (context) => {
    const mock = context.mock.method(globalThis, 'fetch', async () =>
      Response.json({ message: 'Invalid request origin or CSRF token.' }, { status: 403 }),
    );
    await assert.rejects(
      () => authApi.signIn(validSignUp),
      (error: unknown) => error instanceof AuthApiError && error.status === 403,
    );
    assert.equal(mock.mock.callCount(), 1);
  });
  it('[negative] handles network failure and non-JSON error responses', async (context) => {
    const mock = context.mock.method(globalThis, 'fetch', async () => {
      throw new Error('private networking details');
    });
    await assert.rejects(
      () => authApi.me(),
      (error: unknown) =>
        error instanceof AuthApiError && error.status === 0 && !error.message.includes('private'),
    );
    mock.mock.mockImplementation(async () => new Response('gateway error', { status: 502 }));
    await assert.rejects(
      () => authApi.me(),
      (error: unknown) => error instanceof AuthApiError && error.status === 502,
    );
  });
  it('[edge] handles an empty 204 sign-out response', async (context) => {
    let count = 0;
    context.mock.method(globalThis, 'fetch', async () =>
      ++count === 1
        ? Response.json({ csrfToken: 'test-csrf' })
        : new Response(null, { status: 204 }),
    );
    assert.equal(await authApi.signOut(), undefined);
  });
});
