import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Module,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import { AuthModule } from '../auth/auth.module.js';
import { AdminModule } from '../admin/admin.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { ChainModule } from '../chain/chain.module.js';
import { CustodyModule } from '../custody/custody.module.js';
import { requireCsrf } from '../auth/auth.http.js';
import { strictObject } from '../accounts/accounts.service.js';
import { OperationsService } from './operations.service.js';
import { OperationsWorker } from './operations-worker.js';
@Controller('v2/notifications')
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(@Inject(OperationsService) readonly operations: OperationsService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  async page(@Req() req: AuthenticatedRequest, @Query() query: unknown) {
    await this.operations.admin.accounts.throttle(req.auth.user.id, 'v2-read', 240);
    return this.operations.notificationPage(req.auth.user.id, query);
  }
  @Post(':id/read')
  @Header('Cache-Control', 'no-store')
  read(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Query() query: unknown,
    @Body() body: unknown,
  ) {
    strictObject(query, []);
    strictObject(body, []);
    requireCsrf(req, this.operations.admin.environment, req.auth.token);
    return this.operations.read(req.auth.user.id, id);
  }
}
@Controller('v2/admin')
@UseGuards(AuthGuard)
export class OperationsController {
  constructor(@Inject(OperationsService) readonly operations: OperationsService) {}
  @Get('operations')
  @Header('Cache-Control', 'no-store')
  overview(@Req() req: AuthenticatedRequest, @Query() query: unknown) {
    strictObject(query, []);
    return this.operations.overview(req.auth.user.id);
  }
  @Post('verification-jobs')
  @Header('Cache-Control', 'no-store')
  create(@Req() req: AuthenticatedRequest, @Query() query: unknown, @Body() body: unknown) {
    strictObject(query, []);
    requireCsrf(req, this.operations.admin.environment, req.auth.token);
    return this.operations.createJob(req.auth.user.id, req.headers['idempotency-key'], body);
  }
  @Get('jobs/:id')
  @Header('Cache-Control', 'no-store')
  job(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Query() query: unknown) {
    strictObject(query, []);
    return this.operations.job(req.auth.user.id, id);
  }
}
@Module({
  imports: [AuthModule, AdminModule, LedgerModule, ChainModule, CustodyModule],
  providers: [OperationsService, OperationsWorker],
  controllers: [NotificationsController, OperationsController],
  exports: [OperationsService, OperationsWorker],
})
export class OperationsModule {}
