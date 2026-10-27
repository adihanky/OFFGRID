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
import { ConfigurationModule } from './modules/configuration/configuration.module.js';
import { PolicyModule } from './modules/configuration/policy-reader.js';
import { WorkspaceModule } from './modules/workspace/workspace.module.js';
import { RequestsModule } from './modules/requests/requests.module.js';
import { RecoveryModule } from './modules/auth/recovery.module.js';
import { OperationsModule } from './modules/operations/operations.module.js';

@Module({
  imports: [
    EnvironmentModule,
    DatabaseModule,
    PolicyModule,
    HealthModule,
    AuthModule,
    RecoveryModule,
    AccountsModule,
    WalletsModule,
    AdminModule,
    ConfigurationModule,
    WorkspaceModule,
    RequestsModule,
    OperationsModule,
    TransfersModule,
    LedgerModule,
    ChainModule,
    ChatModule,
  ],
})
export class AppModule {}
