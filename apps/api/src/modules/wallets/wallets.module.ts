import { ChainIndexer } from '../chain-wallet/chain-indexer.js';
import { ChainWalletService } from '../chain-wallet/chain-wallet.service.js';
import { ChainWalletController } from '../chain-wallet/chain-wallet.controller.js';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AccountsModule } from '../accounts/accounts.module.js';
import { WalletsService } from './wallets.service.js';
import { WalletsController } from './wallets.controller.js';
import { RoleAuthorization } from './role-authorization.js';
import { CustodyQueryService } from './custody-query.service.js';
import { NetworksModule } from '../networks/networks.module.js';
import { ExternalWalletService } from './external-wallet.service.js';

@Module({
  imports: [AuthModule, AccountsModule, NetworksModule],
  providers: [
    ChainIndexer,
    ChainWalletService,
    WalletsService,
    RoleAuthorization,
    CustodyQueryService,
    ExternalWalletService,
  ],
  controllers: [WalletsController, ChainWalletController],
  exports: [WalletsService, RoleAuthorization],
})
export class WalletsModule {}
