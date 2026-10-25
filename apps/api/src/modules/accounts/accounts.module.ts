import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { AccountsController } from './accounts.controller.js';
import { AccountsService } from './accounts.service.js';
import { CustodyModule } from '../custody/custody.module.js';

@Module({
  imports: [AuthModule, LedgerModule, CustodyModule],
  controllers: [AccountsController],
  providers: [AccountsService],
  exports: [AccountsService],
})
export class AccountsModule {}
