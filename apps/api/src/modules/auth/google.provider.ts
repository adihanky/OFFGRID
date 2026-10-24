import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { jwtVerify, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';
import { ENVIRONMENT } from '../../config/environment.module.js';
import type { Environment } from '../../config/environment.js';
import { secureEqual } from './auth.crypto.js';

export const GOOGLE_KEYS = Symbol('GOOGLE_KEYS');
export const GOOGLE_HTTP = Symbol('GOOGLE_HTTP');
const identitySchema = z.object({
  sub: z.string().min(1).max(255),
  email: z.email().max(254),
  email_verified: z.literal(true),
  nonce: z.string(),
  name: z.string().optional(),
});

@Injectable()
export class GoogleProvider {
  constructor(
    @Inject(ENVIRONMENT) private readonly environment: Environment,
    @Inject(GOOGLE_KEYS) private readonly keys: JWTVerifyGetKey,
    @Inject(GOOGLE_HTTP) private readonly http: typeof fetch,
  ) {}
  get enabled() {
    return Boolean(
      this.environment.GOOGLE_CLIENT_ID &&
      this.environment.GOOGLE_CLIENT_SECRET &&
      this.environment.GOOGLE_REDIRECT_URI,
    );
  }
  authorizationUrl(state: string, nonce: string, challenge: string) {
    if (!this.enabled) throw new ServiceUnavailableException('Google sign-in is not configured.');
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: this.environment.GOOGLE_CLIENT_ID,
      redirect_uri: this.environment.GOOGLE_REDIRECT_URI,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
    return url.toString();
  }
  async exchange(code: string, verifier: string, nonce: string) {
    if (!this.enabled) throw new ServiceUnavailableException('Google sign-in is not configured.');
    try {
      const response = await this.http('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: this.environment.GOOGLE_CLIENT_ID,
          client_secret: this.environment.GOOGLE_CLIENT_SECRET,
          redirect_uri: this.environment.GOOGLE_REDIRECT_URI,
          code_verifier: verifier,
          grant_type: 'authorization_code',
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error('Token exchange failed.');
      const tokens = z.object({ id_token: z.string().max(16384) }).parse(await response.json());
      const { payload } = await jwtVerify(tokens.id_token, this.keys, {
        issuer: ['https://accounts.google.com', 'accounts.google.com'],
        audience: this.environment.GOOGLE_CLIENT_ID,
        algorithms: ['RS256'],
        requiredClaims: ['sub', 'exp', 'iat', 'nonce'],
        maxTokenAge: '1h',
      });
      const identity = identitySchema.parse(payload);
      if (!secureEqual(identity.nonce, nonce)) throw new Error('Nonce mismatch.');
      if (payload.azp !== undefined && payload.azp !== this.environment.GOOGLE_CLIENT_ID)
        throw new Error('Authorized party mismatch.');
      return {
        subject: identity.sub,
        email: identity.email.trim().toLowerCase(),
        displayName: identity.name?.trim().slice(0, 80) || 'Google user',
      };
    } catch {
      throw new UnauthorizedException('Google sign-in could not be verified.');
    }
  }
}
