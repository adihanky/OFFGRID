import { Controller, Get, Header, Inject, Module, Query, Req, UseGuards } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import { AdminModule } from '../admin/admin.module.js';
import { WalletsModule } from '../wallets/wallets.module.js';
import { TransfersModule } from '../transfers/transfers.module.js';
import { strictObject } from '../accounts/accounts.service.js';
import { WorkspaceService } from './workspace.service.js';
@Controller('v2/workspace')
@UseGuards(AuthGuard)
export class WorkspaceController {
  constructor(@Inject(WorkspaceService) readonly workspace: WorkspaceService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  async overview(@Req() req: AuthenticatedRequest, @Query() query: unknown) {
    strictObject(query, []);
    await this.workspace.wallets.accounts.throttle(req.auth.user.id, 'v2-read', 240);
    return this.workspace.overview(req.auth.user);
  }
}
@Module({
  imports: [AuthModule, AdminModule, WalletsModule, TransfersModule],
  providers: [WorkspaceService],
  controllers: [WorkspaceController],
})
export class WorkspaceModule {}
