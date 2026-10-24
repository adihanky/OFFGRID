import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { GoogleProvider } from '../../apps/api/src/modules/auth/google.provider.js';
import { createGoogleFixture, testEnvironment, type GoogleMode } from '../support/auth-fixture.mjs';

describe('Google ID token verification', () => {
  it('[happy] verifies a signed, current token with the expected claims', async () => {
    const fixture = await createGoogleFixture();
    const provider = new GoogleProvider(testEnvironment(), fixture.keys, fixture.http);
    const user = await provider.exchange('test-code', 'pkce-verifier', fixture.nonce);
    assert.deepEqual(user, {
      subject: fixture.subject,
      email: fixture.email,
      displayName: 'Test Google User',
    });
  });
  for (const mode of [
    'wrong signature',
    'wrong audience',
    'wrong issuer',
    'expired',
    'unverified email',
    'wrong nonce',
    'missing token',
    'provider failure',
  ] satisfies GoogleMode[]) {
    it(`[negative] rejects ${mode} without exposing provider details`, async () => {
      const fixture = await createGoogleFixture();
      fixture.mode = mode;
      const provider = new GoogleProvider(testEnvironment(), fixture.keys, fixture.http);
      await assert.rejects(
        () => provider.exchange('test-code', 'pkce-verifier', fixture.nonce),
        (error: unknown) => {
          assert.ok(error instanceof UnauthorizedException);
          assert.equal(error.message, 'Google sign-in could not be verified.');
          return true;
        },
      );
    });
  }
  it('[edge] disabled Google returns an explicit unavailable result', async () => {
    const fixture = await createGoogleFixture();
    const provider = new GoogleProvider(
      testEnvironment({ GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', GOOGLE_REDIRECT_URI: '' }),
      fixture.keys,
      fixture.http,
    );
    assert.equal(provider.enabled, false);
    assert.throws(() => provider.authorizationUrl('', '', ''), ServiceUnavailableException);
    await assert.rejects(
      () => provider.exchange('test-code', 'pkce-verifier', fixture.nonce),
      ServiceUnavailableException,
    );
    assert.equal(fixture.calls, 0);
  });
});
