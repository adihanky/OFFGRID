import { Controller, Get, Header, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import { AccountsService, strictObject } from './accounts.service.js';
@Controller()
@UseGuards(AuthGuard)
export class AccountsController {
  constructor(@Inject(AccountsService) private readonly accounts: AccountsService) {}
  @Get('accounts')
  @Header('Cache-Control', 'no-store')
  async wallet(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    strictObject(query, []);
    await this.accounts.throttle(request.auth.user.id, 'read', 240);
    return this.accounts.wallet(request.auth.user.id);
  }
  @Get('peers')
  @Header('Cache-Control', 'no-store')
  async peer(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    const input = strictObject(query, ['handle']);
    await this.accounts.throttle(request.auth.user.id, 'peer', 120);
    return this.accounts.peer(input['handle']);
  }
}
