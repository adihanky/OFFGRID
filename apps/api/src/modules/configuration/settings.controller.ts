import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Inject,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import { requireCsrf } from '../auth/auth.http.js';
import { strictObject } from '../accounts/accounts.service.js';
import { SettingsService } from './settings.service.js';
import { settingsEtag } from './policy-registry.js';
import { parseInput } from '../assets/asset-input.js';

@Controller('v2/admin/settings')
@UseGuards(AuthGuard)
export class SettingsController {
  constructor(@Inject(SettingsService) readonly settings: SettingsService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Req() req: AuthenticatedRequest, @Query() query: unknown) {
    strictObject(query, []);
    return this.settings.list(req.auth.user.id);
  }
  @Post('validate')
  @Header('Cache-Control', 'no-store')
  validate(@Req() req: AuthenticatedRequest, @Query() query: unknown, @Body() body: unknown) {
    strictObject(query, []);
    requireCsrf(req, this.settings.admin.environment, req.auth.token);
    return this.settings.validate(req.auth.user.id, body);
  }
  @Patch()
  @Header('Cache-Control', 'no-store')
  publish(
    @Req() req: AuthenticatedRequest,
    @Query() query: unknown,
    @Headers('if-match') revision: unknown,
    @Body() body: unknown,
  ) {
    strictObject(query, []);
    requireCsrf(req, this.settings.admin.environment, req.auth.token);
    return this.settings.publish(req.auth.user.id, parseInput(settingsEtag, revision), body);
  }
  @Get('revisions')
  @Header('Cache-Control', 'no-store')
  revisions(@Req() req: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    if (Object.keys(query).some((key) => !['scope', 'cursor'].includes(key)))
      throw new BadRequestException('Invalid query.');
    return this.settings.revisions(req.auth.user.id, query['scope'], query['cursor']);
  }
}
