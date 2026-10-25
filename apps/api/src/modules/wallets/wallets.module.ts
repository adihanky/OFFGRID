import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AccountsModule } from '../accounts/accounts.module.js';
import { WalletsService } from './wallets.service.js';
import { WalletsController } from './wallets.controller.js';
import { RoleAuthorization } from './role-authorization.js';
import { CustodyQueryService } from './custody-query.service.js';

@Module({
  imports: [AuthModule, AccountsModule],
  providers: [WalletsService, RoleAuthorization, CustodyQueryService],
  controllers: [WalletsController],
  exports: [WalletsService, RoleAuthorization],
})
export class WalletsModule {}
