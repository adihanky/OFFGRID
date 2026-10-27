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
import { requireCsrf } from '../auth/auth.http.js';
import { strictObject } from '../accounts/accounts.service.js';
import { RequestsService } from './requests.service.js';
@Controller('v2/requests')
@UseGuards(AuthGuard)
export class RequestsController {
  constructor(@Inject(RequestsService) readonly requests: RequestsService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Req() req: AuthenticatedRequest, @Query() query: unknown) {
    return this.requests.list(req.auth.user.id, query);
  }
  @Post()
  @Header('Cache-Control', 'no-store')
  create(@Req() req: AuthenticatedRequest, @Query() query: unknown, @Body() body: unknown) {
    strictObject(query, []);
    requireCsrf(req, this.requests.admin.environment, req.auth.token);
    return this.requests.create(req.auth.user.id, req.headers['idempotency-key'], body);
  }
}
@Controller('v2/admin/requests')
@UseGuards(AuthGuard)
export class RequestDecisionsController {
  constructor(@Inject(RequestsService) readonly requests: RequestsService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Req() req: AuthenticatedRequest, @Query() query: unknown) {
    return this.requests.list(req.auth.user.id, query, true);
  }
  @Post(':id/decision')
  @Header('Cache-Control', 'no-store')
  decide(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Query() query: unknown,
    @Body() body: unknown,
  ) {
    strictObject(query, []);
    requireCsrf(req, this.requests.admin.environment, req.auth.token);
    return this.requests.decide(req.auth.user.id, id, body);
  }
}
