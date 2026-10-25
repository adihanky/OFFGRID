import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AccountsModule } from '../accounts/accounts.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { ChainModule } from '../chain/chain.module.js';
import { OutboxModule } from '../../workers/outbox.service.js';
import { TransferRecoveryService } from '../../workers/transfer-recovery.service.js';
import { TransfersService } from './transfers.service.js';
import { TransfersController } from './transfers.controller.js';
import { WalletsModule } from '../wallets/wallets.module.js';
import { TransfersV2Controller } from './transfers-v2.controller.js';

@Module({
  imports: [AuthModule, AccountsModule, LedgerModule, ChainModule, OutboxModule, WalletsModule],
  providers: [TransfersService, TransferRecoveryService],
  controllers: [TransfersController, TransfersV2Controller],
  exports: [TransfersService, TransferRecoveryService],
})
export class TransfersModule {}
