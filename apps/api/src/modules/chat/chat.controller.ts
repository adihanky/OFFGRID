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
import { ENVIRONMENT } from '../../config/environment.module.js';
import type { Environment } from '../../config/environment.js';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import { requireCsrf } from '../auth/auth.http.js';
import { strictObject } from '../accounts/accounts.service.js';
import { ChatService } from './chat.service.js';
@Controller('v2/chat/conversations')
@UseGuards(AuthGuard)
export class ChatController {
  constructor(
    @Inject(ChatService) readonly chat: ChatService,
    @Inject(ENVIRONMENT) readonly environment: Environment,
  ) {}
  write(req: AuthenticatedRequest, query: unknown) {
    strictObject(query, []);
    requireCsrf(req, this.environment, req.auth.token);
  }
  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Req() req: AuthenticatedRequest, @Query() query: unknown) {
    return this.chat.list(req.auth.user.id, query);
  }
  @Post()
  @Header('Cache-Control', 'no-store')
  open(@Req() req: AuthenticatedRequest, @Query() query: unknown, @Body() body: unknown) {
    this.write(req, query);
    return this.chat.open(req.auth.user.id, body);
  }
  @Get(':id/messages')
  @Header('Cache-Control', 'no-store')
  history(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Query() query: unknown) {
    return this.chat.history(req.auth.user.id, id, query);
  }
  @Post(':id/messages')
  @Header('Cache-Control', 'no-store')
  send(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Query() query: unknown,
    @Body() body: unknown,
  ) {
    this.write(req, query);
    return this.chat.send(req.auth.user.id, id, body);
  }
  @Post(':id/read')
  @Header('Cache-Control', 'no-store')
  read(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Query() query: unknown,
    @Body() body: unknown,
  ) {
    this.write(req, query);
    return this.chat.read(req.auth.user.id, id, body);
  }
  @Post(':id/block')
  @Header('Cache-Control', 'no-store')
  block(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Query() query: unknown,
    @Body() body: unknown,
  ) {
    this.write(req, query);
    return this.chat.block(req.auth.user.id, id, body);
  }
}
