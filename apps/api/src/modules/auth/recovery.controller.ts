import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard, type AuthenticatedRequest } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { RecoveryService } from './recovery.service.js';
import { cookieNames, readCookie, requireCsrf } from './auth.http.js';
import { strictObject } from '../accounts/accounts.service.js';
import { tokenHash } from './auth.crypto.js';
@Controller('auth')
export class RecoveryController {
  constructor(
    @Inject(RecoveryService) readonly recovery: RecoveryService,
    @Inject(AuthService) readonly auth: AuthService,
  ) {}
  private async publicWrite(req: Request, query: unknown) {
    strictObject(query, []);
    const identity = await this.auth.authenticate(
      readCookie(req, cookieNames(this.recovery.environment).session),
    );
    requireCsrf(req, this.recovery.environment, identity?.token);
    await this.auth.throttle(`recovery-ip:${req.ip}`);
  }
  private async privateWrite(req: AuthenticatedRequest, query: unknown) {
    strictObject(query, []);
    requireCsrf(req, this.recovery.environment, req.auth.token);
    await this.auth.throttle(`recovery-user:${req.auth.user.id}`);
  }
  @Get('recovery-status')
  @Header('Cache-Control', 'no-store')
  status(@Query() query: unknown) {
    strictObject(query, []);
    return this.recovery.status();
  }
  @Post('password-reset-requests')
  @Header('Cache-Control', 'no-store')
  async requestReset(@Req() req: Request, @Query() query: unknown, @Body() body: unknown) {
    await this.publicWrite(req, query);
    const email =
      body && typeof body === 'object' && 'email' in body && typeof body.email === 'string'
        ? body.email.trim().toLowerCase()
        : '';
    await this.auth.throttle(`reset-address:${tokenHash(email)}`);
    return this.recovery.requestReset(body);
  }
  @Post('password-resets')
  @Header('Cache-Control', 'no-store')
  async reset(@Req() req: Request, @Query() query: unknown, @Body() body: unknown) {
    await this.publicWrite(req, query);
    return this.recovery.consume('RESET', body);
  }
  @Post('email-verification-requests')
  @UseGuards(AuthGuard)
  @Header('Cache-Control', 'no-store')
  async requestVerification(
    @Req() req: AuthenticatedRequest,
    @Query() query: unknown,
    @Body() body: unknown,
  ) {
    await this.privateWrite(req, query);
    return this.recovery.requestVerification(req.auth.user.id, body);
  }
  @Post('email-verifications')
  @UseGuards(AuthGuard)
  @Header('Cache-Control', 'no-store')
  async verify(@Req() req: AuthenticatedRequest, @Query() query: unknown, @Body() body: unknown) {
    await this.privateWrite(req, query);
    return this.recovery.consume('VERIFY', body, req.auth.user.id);
  }
  @Get('sessions')
  @UseGuards(AuthGuard)
  @Header('Cache-Control', 'no-store')
  sessions(@Req() req: AuthenticatedRequest, @Query() query: unknown) {
    strictObject(query, []);
    return this.recovery.listSessions(req.auth.user.id, req.auth.token);
  }
  @Post('sessions/revoke-others')
  @UseGuards(AuthGuard)
  @Header('Cache-Control', 'no-store')
  async revokeOthers(
    @Req() req: AuthenticatedRequest,
    @Query() query: unknown,
    @Body() body: unknown,
  ) {
    await this.privateWrite(req, query);
    strictObject(body, []);
    return this.recovery.revokeOthers(req.auth.user.id, req.auth.token);
  }
  @Post('sessions/:id/revoke')
  @UseGuards(AuthGuard)
  @Header('Cache-Control', 'no-store')
  async revoke(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Query() query: unknown,
    @Body() body: unknown,
  ) {
    await this.privateWrite(req, query);
    strictObject(body, []);
    return this.recovery.revoke(req.auth.user.id, id);
  }
}
