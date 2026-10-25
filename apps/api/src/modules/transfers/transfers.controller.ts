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
  Res,
  ServiceUnavailableException,
  UseGuards,
  HttpException,
} from '@nestjs/common';
import type { Response } from 'express';
import { ENVIRONMENT } from '../../config/environment.module.js';
import type { Environment } from '../../config/environment.js';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import { requireCsrf } from '../auth/auth.http.js';
import { strictObject } from '../accounts/accounts.service.js';
import { TransfersService } from './transfers.service.js';
@Controller('transfers')
@UseGuards(AuthGuard)
export class TransfersController {
  constructor(
    @Inject(TransfersService) private readonly transfers: TransfersService,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
  ) {}
  @Post()
  @Header('Cache-Control', 'no-store')
  async create(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
    @Body() body: unknown,
    @Query() query: unknown,
  ) {
    requireCsrf(request, this.environment, request.auth.token);
    strictObject(query, []);
    try {
      const result = await this.transfers.submit(
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
  @Get(':id')
  @Header('Cache-Control', 'no-store')
  async detail(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    strictObject(query, []);
    await this.transfers.accounts.throttle(request.auth.user.id, 'read', 240);
    return this.transfers.detail(request.auth.user.id, id);
  }
}
