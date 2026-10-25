import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
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
import { AdminService } from './admin.service.js';
import { DemoService } from './demo.service.js';

@Controller('v2/admin')
@UseGuards(AuthGuard)
export class AdminController {
  constructor(
    @Inject(AdminService) readonly admin: AdminService,
    @Inject(DemoService) readonly demo: DemoService,
  ) {}
  validate(request: AuthenticatedRequest, query: unknown, mutation = false) {
    strictObject(query, []);
    if (mutation) requireCsrf(request, this.admin.environment, request.auth.token);
    return request.auth.user.id;
  }
  @Get('status')
  @Header('Cache-Control', 'no-store')
  status(@Req() req: AuthenticatedRequest, @Query() query: unknown) {
    return this.admin.status(this.validate(req, query));
  }
  @Post('setup')
  @Header('Cache-Control', 'no-store')
  setup(@Req() req: AuthenticatedRequest, @Query() query: unknown, @Body() body: unknown) {
    return this.admin.setup(this.validate(req, query, true), body);
  }
  @Get('assets')
  @Header('Cache-Control', 'no-store')
  assets(@Req() req: AuthenticatedRequest, @Query() query: unknown) {
    return this.admin.assets(this.validate(req, query));
  }
  @Get('networks')
  @Header('Cache-Control', 'no-store')
  networks(@Req() req: AuthenticatedRequest, @Query() query: unknown) {
    return this.admin.networkList(this.validate(req, query));
  }
  @Post('networks')
  @Header('Cache-Control', 'no-store')
  createNetwork(@Req() req: AuthenticatedRequest, @Query() query: unknown, @Body() body: unknown) {
    return this.admin.createNetwork(this.validate(req, query, true), body);
  }
  @Post('networks/:id')
  @Header('Cache-Control', 'no-store')
  networkStatus(
    @Req() req: AuthenticatedRequest,
    @Query() query: unknown,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.admin.networkStatus(this.validate(req, query, true), id, body);
  }
  @Post('assets')
  @Header('Cache-Control', 'no-store')
  create(@Req() req: AuthenticatedRequest, @Query() query: unknown, @Body() body: unknown) {
    return this.admin.createAsset(this.validate(req, query, true), body);
  }
  @Post('assets/:id')
  @Header('Cache-Control', 'no-store')
  update(
    @Req() req: AuthenticatedRequest,
    @Query() query: unknown,
    @Body() body: unknown,
    @Param('id') id: string,
    @Headers('if-match') revision: unknown,
  ) {
    return this.admin.updateAsset(this.validate(req, query, true), id, revision, body);
  }
  @Post('issuances')
  @Header('Cache-Control', 'no-store')
  issue(@Req() req: AuthenticatedRequest, @Query() query: unknown, @Body() body: unknown) {
    return this.admin.issue(this.validate(req, query, true), body);
  }
  @Get('roles')
  @Header('Cache-Control', 'no-store')
  roles(@Req() req: AuthenticatedRequest, @Query() query: unknown) {
    return this.admin.roleList(this.validate(req, query));
  }
  @Post('roles')
  @Header('Cache-Control', 'no-store')
  role(@Req() req: AuthenticatedRequest, @Query() query: unknown, @Body() body: unknown) {
    return this.admin.setRole(this.validate(req, query, true), body);
  }
  @Get('audit')
  @Header('Cache-Control', 'no-store')
  audit(@Req() req: AuthenticatedRequest, @Query() query: unknown) {
    return this.admin.auditList(this.validate(req, query));
  }
  @Post('seed/preview')
  @Header('Cache-Control', 'no-store')
  preview(@Req() req: AuthenticatedRequest, @Query() query: unknown, @Body() body: unknown) {
    return this.demo.preview(this.validate(req, query, true), body);
  }
  @Get('seed/status')
  @Header('Cache-Control', 'no-store')
  seedStatus(@Req() req: AuthenticatedRequest, @Query() query: unknown) {
    return this.demo.status(this.validate(req, query));
  }
  @Post('seed/run')
  @Header('Cache-Control', 'no-store')
  run(@Req() req: AuthenticatedRequest, @Query() query: unknown, @Body() body: unknown) {
    return this.demo.run(this.validate(req, query, true), body);
  }
}
