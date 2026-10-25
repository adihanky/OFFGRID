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
import { CustodyQueryService } from './custody-query.service.js';
import { ENVIRONMENT } from '../../config/environment.module.js';
import type { Environment } from '../../config/environment.js';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import { requireCsrf } from '../auth/auth.http.js';
import { strictObject } from '../accounts/accounts.service.js';
import { WalletsService } from './wallets.service.js';

@Controller('v2')
@UseGuards(AuthGuard)
export class WalletsController {
  constructor(
    @Inject(WalletsService) readonly wallets: WalletsService,
    @Inject(ENVIRONMENT) readonly environment: Environment,
    @Inject(CustodyQueryService) readonly custody: CustodyQueryService,
  ) {}
  @Get('wallet')
  @Header('Cache-Control', 'no-store')
  async own(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    strictObject(query, []);
    await this.wallets.accounts.throttle(request.auth.user.id, 'v2-read', 240);
    return { wallet: await this.wallets.own(request.auth.user.id) };
  }
  @Post('peer-resolutions')
  @Header('Cache-Control', 'no-store')
  async resolve(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
    @Query() query: unknown,
  ) {
    requireCsrf(request, this.environment, request.auth.token);
    strictObject(query, []);
    return this.wallets.resolve(request.auth.user.id, body);
  }
  @Get('custody')
  @Header('Cache-Control', 'no-store')
  activity(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    return this.custody.page(request.auth.user.id, query);
  }
  @Get('custody/:id')
  @Header('Cache-Control', 'no-store')
  detail(@Req() request: AuthenticatedRequest, @Query() query: unknown, @Param('id') id: string) {
    strictObject(query, []);
    return this.custody.page(request.auth.user.id, query, id);
  }
}
