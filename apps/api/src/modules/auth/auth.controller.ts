import {
  Body,
  ConflictException,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AuthProvidersResponse, AuthResponse, CsrfResponse } from '@p2p/contracts';
import { ENVIRONMENT } from '../../config/environment.module.js';
import type { Environment } from '../../config/environment.js';
import { csrfForSession, isToken, newToken } from './auth.crypto.js';
import { AuthGuard, type AuthenticatedRequest } from './auth.guard.js';
import { cookieNames, readCookie, requireCsrf, setAuthCookie } from './auth.http.js';
import { AuthService } from './auth.service.js';
import { googleCallbackSchema, parseInput, signInSchema, signUpSchema } from './auth.validation.js';

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
  ) {}
  private get names() {
    return cookieNames(this.environment);
  }
  private session(request: Request) {
    return readCookie(request, this.names.session);
  }
  private async checkWrite(request: Request) {
    const identity = await this.auth.authenticate(this.session(request));
    requireCsrf(request, this.environment, identity?.token);
    await this.auth.throttle(`ip:${request.ip}`);
  }
  private saveSession(
    response: Response,
    result: Awaited<ReturnType<AuthService['signIn']>>,
  ): AuthResponse {
    setAuthCookie(
      response,
      this.environment,
      this.names.session,
      result.token,
      this.environment.SESSION_TTL_SECONDS,
    );
    setAuthCookie(
      response,
      this.environment,
      this.names.csrf,
      csrfForSession(result.token),
      this.environment.SESSION_TTL_SECONDS,
    );
    return { user: result.user };
  }
  @Get('providers')
  @Header('Cache-Control', 'no-store')
  providers(): AuthProvidersResponse {
    return { google: this.auth.google.enabled, email: true };
  }
  @Get('csrf')
  @Header('Cache-Control', 'no-store')
  async csrf(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CsrfResponse> {
    const identity = await this.auth.authenticate(this.session(request));
    const existing = readCookie(request, this.names.csrf);
    const csrfToken = identity
      ? csrfForSession(identity.token)
      : isToken(existing)
        ? existing
        : newToken();
    setAuthCookie(
      response,
      this.environment,
      this.names.csrf,
      csrfToken,
      this.environment.SESSION_TTL_SECONDS,
    );
    return { csrfToken };
  }
  @Post('signup')
  @Header('Cache-Control', 'no-store')
  async signUp(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() body: unknown,
  ): Promise<AuthResponse> {
    await this.checkWrite(request);
    return this.saveSession(
      response,
      await this.auth.signUp(parseInput(signUpSchema, body), this.session(request)),
    );
  }
  @Post('signin')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async signIn(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() body: unknown,
  ): Promise<AuthResponse> {
    await this.checkWrite(request);
    return this.saveSession(
      response,
      await this.auth.signIn(parseInput(signInSchema, body), this.session(request)),
    );
  }
  @Get('me')
  @UseGuards(AuthGuard)
  @Header('Cache-Control', 'no-store')
  me(@Req() request: AuthenticatedRequest): AuthResponse {
    return { user: request.auth.user };
  }
  @Post('signout')
  @UseGuards(AuthGuard)
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  async signOut(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    requireCsrf(request, this.environment, request.auth.token);
    await this.auth.signOut(request.auth.token);
    setAuthCookie(response, this.environment, this.names.session, '', 0);
    setAuthCookie(response, this.environment, this.names.csrf, '', 0);
  }
  @Get('google')
  @Header('Cache-Control', 'no-store')
  async google(@Req() request: Request, @Res() response: Response) {
    await this.auth.throttle(`ip:${request.ip}`);
    const flow = await this.auth.startGoogle();
    setAuthCookie(response, this.environment, this.names.oauth, flow.browser, 600);
    response.redirect(flow.url);
  }
  @Get('google/callback')
  @Header('Cache-Control', 'no-store')
  async callback(@Req() request: Request, @Res() response: Response, @Query() query: unknown) {
    setAuthCookie(response, this.environment, this.names.oauth, '', 0);
    try {
      await this.auth.throttle(`ip:${request.ip}`);
      const input = parseInput(googleCallbackSchema, query);
      const result = await this.auth.finishGoogle(
        input.state,
        readCookie(request, this.names.oauth),
        input.code,
        input.error,
        this.session(request),
      );
      this.saveSession(response, result);
      response.redirect(this.environment.WEB_ORIGIN);
    } catch (error) {
      const target = new URL(this.environment.WEB_ORIGIN);
      target.searchParams.set(
        'auth_error',
        error instanceof ConflictException ? 'account_exists' : 'google_failed',
      );
      response.redirect(target.toString());
    }
  }
}
