import { Module } from '@nestjs/common';
import { EnvironmentModule } from './config/environment.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { AccountsModule } from './modules/accounts/accounts.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { ChainModule } from './modules/chain/chain.module.js';
import { ChatModule } from './modules/chat/chat.module.js';
import { LedgerModule } from './modules/ledger/ledger.module.js';
import { TransfersModule } from './modules/transfers/transfers.module.js';
import { WalletsModule } from './modules/wallets/wallets.module.js';
import { AdminModule } from './modules/admin/admin.module.js';

@Module({
  imports: [
    EnvironmentModule,
    DatabaseModule,
    HealthModule,
    AuthModule,
    AccountsModule,
    WalletsModule,
    AdminModule,
    TransfersModule,
    LedgerModule,
    ChainModule,
    ChatModule,
  ],
})
export class AppModule {}
