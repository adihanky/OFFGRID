import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { TransfersModule } from '../transfers/transfers.module.js';
import { AdminService } from './admin.service.js';
import { DemoService } from './demo.service.js';
import { AdminController } from './admin.controller.js';
import { NetworksModule } from '../networks/networks.module.js';
@Module({
  imports: [AccountsModule, AuthModule, TransfersModule, NetworksModule],
  providers: [AdminService, DemoService],
  controllers: [AdminController],
  exports: [AdminService, DemoService],
})
export class AdminModule {}
