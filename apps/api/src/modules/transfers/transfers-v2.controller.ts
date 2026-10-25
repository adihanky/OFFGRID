import {
  Body,
  Controller,
  Get,
  Param,
  Header,
  HttpException,
  Inject,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ENVIRONMENT } from '../../config/environment.module.js';
import type { Environment } from '../../config/environment.js';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import { requireCsrf } from '../auth/auth.http.js';
import { strictObject } from '../accounts/accounts.service.js';
import { TransfersService } from './transfers.service.js';
@Controller('v2/transfers')
@UseGuards(AuthGuard)
export class TransfersV2Controller {
  constructor(
    @Inject(TransfersService) readonly transfers: TransfersService,
    @Inject(ENVIRONMENT) readonly environment: Environment,
  ) {}
  @Get(':id')
  @Header('Cache-Control', 'no-store')
  async detail(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    strictObject(query, []);
    await this.transfers.accounts.throttle(request.auth.user.id, 'v2-read', 240);
    return this.transfers.detailV2(request.auth.user.id, id);
  }
  @Post()
  @Header('Cache-Control', 'no-store')
  async submit(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
    @Body() body: unknown,
    @Query() query: unknown,
  ) {
    requireCsrf(request, this.environment, request.auth.token);
    strictObject(query, []);
    try {
      const result = await this.transfers.submitV2(
        request.auth.user.id,
        body,
        request.headers['idempotency-key'],
      );
      response.status(result.statusCode);
      if (result.statusCode === 202) response.setHeader('Retry-After', '2');
      return { transfer: result.transfer };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException(
        'Transfer outcome unavailable. Retry with the same request key.',
      );
    }
  }
}
