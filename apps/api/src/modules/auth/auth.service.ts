import { createHash } from 'node:crypto';
import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ObjectId } from 'mongodb';
import type { AuthUser, SignInRequest, SignUpRequest } from '@p2p/contracts';
import { ENVIRONMENT } from '../../config/environment.module.js';
import type { Environment } from '../../config/environment.js';
import { AuthStore, type UserRecord } from './auth.models.js';
import { isToken, newToken, PasswordService, tokenHash } from './auth.crypto.js';
import { GoogleProvider } from './google.provider.js';

export const publicUser = (user: UserRecord): AuthUser => ({
  id: user._id.toHexString(),
  email: user.normalizedEmail,
  publicHandle: user.publicHandle,
  displayName: user.displayName,
  emailVerified: user.emailVerified,
  signInMethod: user.googleSubject ? 'google' : 'email',
});

@Injectable()
export class AuthService {
  constructor(
    @Inject(AuthStore) readonly store: AuthStore,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(GoogleProvider) readonly google: GoogleProvider,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
  ) {}

  async throttle(key: string, limit = 30) {
    const windowMs = 15 * 60 * 1000;
    const bucket = Math.floor(Date.now() / windowMs);
    const hits = await this.store.incrementLimit(
      `${tokenHash(key)}:${bucket}`,
      new Date((bucket + 2) * windowMs),
    );
    if (hits > limit)
      throw new HttpException('Too many authentication attempts. Try again later.', 429);
  }
  async signUp(input: SignUpRequest, previousToken?: string) {
    const now = new Date();
    const user: UserRecord = {
      _id: new ObjectId(),
      normalizedEmail: input.email,
      publicHandle: input.publicHandle,
      displayName: input.publicHandle,
      passwordHash: await this.passwords.hash(input.password),
      emailVerified: false,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    await this.store.insertUser(user);
    return this.openSession(user, previousToken);
  }
  async signIn(input: SignInRequest, previousToken?: string) {
    await this.throttle(`email:${input.email}`, 10);
    const user = await this.store.findUser(input.email);
    const valid = await this.passwords.verify(input.password, user?.passwordHash);
    if (!valid || !user || user.status !== 'active')
      throw new UnauthorizedException('Email or password is incorrect.');
    return this.openSession(user, previousToken);
  }
  private async openSession(user: UserRecord, previousToken?: string) {
    if (user.status !== 'active') throw new UnauthorizedException('Account is unavailable.');
    const token = newToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.environment.SESSION_TTL_SECONDS * 1000);
    await this.store.insertSession({
      _id: new ObjectId(),
      userId: user._id,
      tokenHash: tokenHash(token),
      createdAt: now,
      expiresAt,
      revokedAt: null,
    });
    if (isToken(previousToken)) await this.store.revokeSession(tokenHash(previousToken), now);
    return { user: publicUser(user), token, expiresAt };
  }
  async authenticate(token: unknown) {
    if (!isToken(token)) return null;
    const session = await this.store.findSession(tokenHash(token), new Date());
    if (!session) return null;
    const user = await this.store.findUserById(session.userId);
    if (!user || user.status !== 'active') return null;
    return { user: publicUser(user), session, token };
  }
  async signOut(token: string) {
    await this.store.revokeSession(tokenHash(token), new Date());
  }
  async startGoogle() {
    // Check configuration before creating an unusable OAuth attempt.
    this.google.authorizationUrl('', '', '');
    const state = newToken();
    const browser = newToken();
    const verifier = newToken();
    const nonce = newToken();
    await this.store.insertOAuth({
      _id: tokenHash(state),
      browserHash: tokenHash(browser),
      verifier,
      nonce,
      expiresAt: new Date(Date.now() + 600000),
    });
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    return { browser, url: this.google.authorizationUrl(state, nonce, challenge) };
  }
  async finishGoogle(
    state: string,
    browser: unknown,
    code?: string,
    error?: string,
    previousToken?: string,
  ) {
    if (!isToken(browser)) throw new UnauthorizedException('Invalid Google sign-in state.');
    const attempt = await this.store.consumeOAuth(tokenHash(state), tokenHash(browser), new Date());
    if (!attempt || error || !code)
      throw new UnauthorizedException('Google sign-in expired or was cancelled.');
    const identity = await this.google.exchange(code, attempt.verifier, attempt.nonce);
    let user = await this.store.findGoogleUser(identity.subject);
    if (!user) {
      if (await this.store.findUser(identity.email))
        throw new ConflictException('Use the sign-in method originally used for this email.');
      const now = new Date();
      user = {
        _id: new ObjectId(),
        normalizedEmail: identity.email,
        publicHandle: `g_${newToken().slice(0, 20).toLowerCase().replace(/-/g, '_')}`,
        displayName: identity.displayName,
        googleSubject: identity.subject,
        emailVerified: true,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      };
      try {
        await this.store.insertUser(user);
      } catch (failure) {
        if (!(failure instanceof ConflictException)) throw failure;
        // Two valid callbacks for the same subject may race. Only reuse the
        // identity with that exact subject; matching email alone never links.
        const concurrent = await this.store.findGoogleUser(identity.subject);
        if (!concurrent) throw failure;
        user = concurrent;
      }
    }
    return this.openSession(user, previousToken);
  }
}
