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
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import { ENVIRONMENT } from '../../config/environment.module.js';
import type { Environment } from '../../config/environment.js';
import { requireCsrf } from '../auth/auth.http.js';
import { strictObject } from '../accounts/accounts.service.js';
import { ChainWalletService } from './chain-wallet.service.js';
@Controller('v2/wallet/bindings/:id/chain')
@UseGuards(AuthGuard)
export class ChainWalletController {
  constructor(
    @Inject(ChainWalletService) readonly chain: ChainWalletService,
    @Inject(ENVIRONMENT) readonly environment: Environment,
  ) {}
  write(req: AuthenticatedRequest, query: unknown) {
    strictObject(query, []);
    requireCsrf(req, this.environment, req.auth.token);
  }
  @Get('tokens')
  @Header('Cache-Control', 'no-store')
  tokens(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Query() query: unknown) {
    strictObject(query, []);
    return this.chain.listTokens(req.auth.user.id, id);
  }
  @Post('tokens')
  @Header('Cache-Control', 'no-store')
  import(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Query() query: unknown,
    @Body() body: unknown,
  ) {
    this.write(req, query);
    return this.chain.importToken(req.auth.user.id, id, body);
  }
  @Post('prepare')
  @Header('Cache-Control', 'no-store')
  prepare(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Query() query: unknown,
    @Body() body: unknown,
  ) {
    this.write(req, query);
    return this.chain.prepare(req.auth.user.id, id, body);
  }
  @Post('transactions')
  @Header('Cache-Control', 'no-store')
  record(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Query() query: unknown,
    @Body() body: unknown,
  ) {
    this.write(req, query);
    return this.chain.register(req.auth.user.id, id, body);
  }
  @Post('sync')
  @Header('Cache-Control', 'no-store')
  sync(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Query() query: unknown,
    @Body() body: unknown,
  ) {
    this.write(req, query);
    strictObject(body, []);
    return this.chain.sync(req.auth.user.id, id);
  }
  @Get('history')
  @Header('Cache-Control', 'no-store')
  history(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Query() query: unknown) {
    return this.chain.history(req.auth.user.id, id, query);
  }
}
