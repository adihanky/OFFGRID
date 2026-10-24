import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  cookieNames,
  requireCsrf,
  setAuthCookie,
} from '../../apps/api/src/modules/auth/auth.http.js';
import { csrfForSession, newToken } from '../../apps/api/src/modules/auth/auth.crypto.js';
import { testEnvironment } from '../support/auth-fixture.mjs';

describe('CSRF and cookie protection', () => {
  const environment = testEnvironment();
  const request = (csrf: string, overrides: Record<string, unknown> = {}) =>
    ({
      headers: {
        origin: environment.WEB_ORIGIN,
        cookie: `p2p_csrf=${csrf}`,
        'x-csrf-token': csrf,
        ...overrides,
      },
    }) as unknown as Request;
  it('[happy] accepts matching anonymous and session-bound CSRF tokens', () => {
    requireCsrf(request(newToken()), environment);
    const session = newToken();
    requireCsrf(request(csrfForSession(session)), environment, session);
  });
  it('[negative] rejects missing, malformed, mismatched and foreign-origin CSRF requests', () => {
    for (const overrides of [
      { origin: undefined },
      { origin: 'https://attacker.invalid' },
      { cookie: '' },
      { 'x-csrf-token': undefined },
      { 'x-csrf-token': 'bad' },
      { 'x-csrf-token': newToken() },
    ])
      assert.throws(
        () => requireCsrf(request(newToken(), overrides), environment),
        ForbiddenException,
      );
  });
  it('[edge] rejects a matching cookie/header pair from another session', () => {
    const csrf = csrfForSession(newToken());
    assert.throws(() => requireCsrf(request(csrf), environment, newToken()), ForbiddenException);
  });
  it('[happy] uses HttpOnly, SameSite and a bounded lifetime', () => {
    const cookies: string[] = [];
    const response = {
      append: (_name: string, value: string) => cookies.push(value),
    } as unknown as Response;
    setAuthCookie(response, environment, cookieNames(environment).session, newToken(), 604800);
    assert.match(cookies[0]!, /HttpOnly/);
    assert.match(cookies[0]!, /SameSite=Lax/);
    assert.match(cookies[0]!, /Path=\//);
    assert.match(cookies[0]!, /Max-Age=604800/);
    assert.ok(!cookies[0]!.includes('Domain='));
  });
  it('[edge] uses host-prefixed Secure cookies in production and clears the same path', () => {
    const production = testEnvironment({
      NODE_ENV: 'production',
      WEB_ORIGIN: 'https://example.com',
      GOOGLE_REDIRECT_URI: 'https://example.com/api/auth/google/callback',
    });
    const cookies: string[] = [];
    const response = {
      append: (_name: string, value: string) => cookies.push(value),
    } as unknown as Response;
    const name = cookieNames(production).session;
    assert.equal(name, '__Host-p2p_session');
    setAuthCookie(response, production, name, newToken(), 604800);
    setAuthCookie(response, production, name, '', 0);
    for (const cookie of cookies) {
      assert.match(cookie, /Secure/);
      assert.match(cookie, /Path=\//);
      assert.ok(!cookie.includes('Domain='));
    }
    assert.match(cookies[1]!, /Max-Age=0/);
  });
});
