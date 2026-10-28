import {
  Body,
  NotFoundException,
  ServiceUnavailableException,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { CustodyQueryService } from './custody-query.service.js';
import { ENVIRONMENT } from '../../config/environment.module.js';
import type { Environment } from '../../config/environment.js';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import { requireCsrf } from '../auth/auth.http.js';
import { strictObject } from '../accounts/accounts.service.js';
import { WalletsService } from './wallets.service.js';
import { ExternalWalletService } from './external-wallet.service.js';
import { NetworksService, networkView } from '../networks/networks.service.js';

@Controller('v2')
@UseGuards(AuthGuard)
export class WalletsController {
  constructor(
    @Inject(WalletsService) readonly wallets: WalletsService,
    @Inject(ENVIRONMENT) readonly environment: Environment,
    @Inject(CustodyQueryService) readonly custody: CustodyQueryService,
    @Inject(ExternalWalletService) readonly external: ExternalWalletService,
    @Inject(NetworksService) readonly networks: NetworksService,
  ) {}
  @Get('wallet')
  @Header('Cache-Control', 'no-store')
  async own(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    strictObject(query, []);
    await this.wallets.accounts.throttle(request.auth.user.id, 'v2-read', 240);
    return { wallet: await this.wallets.own(request.auth.user.id) };
  }
  @Post('peer-resolutions')
  @Header('Cache-Control', 'no-store')
  async resolve(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
    @Query() query: unknown,
  ) {
    requireCsrf(request, this.environment, request.auth.token);
    strictObject(query, []);
    return this.wallets.resolve(request.auth.user.id, body);
  }
  @Post('wallet/settings')
  @Header('Cache-Control', 'no-store')
  configure(@Req() req: AuthenticatedRequest, @Query() query: unknown, @Body() body: unknown) {
    strictObject(query, []);
    requireCsrf(req, this.environment, req.auth.token);
    return this.wallets.configure(req.auth.user.id, body);
  }
  @Get('assets')
  @Header('Cache-Control', 'no-store')
  catalogue(@Query() query: unknown) {
    strictObject(query, []);
    return this.wallets.catalogue();
  }
  @Get('networks')
  @Header('Cache-Control', 'no-store')
  async supportedNetworks(@Query() query: unknown) {
    strictObject(query, []);
    return {
      networks: (
        await this.networks.networks
          .find({ status: 'ACTIVE' })
          .sort({ displayName: 1 })
          .limit(100)
          .toArray()
      ).map(networkView),
    };
  }
  @Post('wallet/testnet')
  @Header('Cache-Control', 'no-store')
  async enableTestnet(
    @Req() req: AuthenticatedRequest,
    @Query() query: unknown,
    @Body() body: unknown,
  ) {
    strictObject(query, []);
    strictObject(body, []);
    requireCsrf(req, this.environment, req.auth.token);
    await this.wallets.accounts.throttle(req.auth.user.id, 'v2-read', 240);
    return { network: await this.networks.enableSepolia() };
  }
  @Get('wallet/bindings/:id/balance')
  @Header('Cache-Control', 'no-store')
  async nativeBalance(
    @Req() req: AuthenticatedRequest,
    @Query() query: unknown,
    @Param('id') id: string,
  ) {
    strictObject(query, []);
    await this.wallets.accounts.throttle(req.auth.user.id, 'v2-read', 240);
    const wallet = await this.wallets.own(req.auth.user.id);
    const binding = wallet.bindings.find((item) => item.id === id && item.status === 'VERIFIED');
    if (!binding) throw new NotFoundException('Verified wallet address not found.');
    const network = await this.networks.active(binding.networkId);
    // This product currently displays ETH only on Sepolia and local development chains.
    if (network.chainId !== '11155111' && network.environment !== 'LOCAL')
      throw new NotFoundException('Native asset support is not available for this network.');
    const raw = await this.networks.call(network, 'eth_getBalance', [binding.address, 'latest']);
    if (typeof raw !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i.test(raw))
      throw new ServiceUnavailableException('Provider returned an invalid balance.');
    return {
      address: binding.address,
      networkId: binding.networkId,
      chainId: network.chainId,
      symbol: 'ETH',
      decimals: 18,
      balanceWei: BigInt(raw).toString(),
      observedAt: new Date().toISOString(),
    };
  }
  @Post('wallet/binding-challenges')
  @Header('Cache-Control', 'no-store')
  challenge(@Req() req: AuthenticatedRequest, @Query() query: unknown, @Body() body: unknown) {
    strictObject(query, []);
    requireCsrf(req, this.environment, req.auth.token);
    return this.external.challenge(req.auth.user.id, req.auth.token, body);
  }
  @Post('wallet/bindings')
  @Header('Cache-Control', 'no-store')
  verifyBinding(@Req() req: AuthenticatedRequest, @Query() query: unknown, @Body() body: unknown) {
    strictObject(query, []);
    requireCsrf(req, this.environment, req.auth.token);
    return this.external.verify(req.auth.user.id, req.auth.token, body);
  }
  @Post('wallet/bindings/:id/revoke')
  @Header('Cache-Control', 'no-store')
  revokeBinding(
    @Req() req: AuthenticatedRequest,
    @Query() query: unknown,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    strictObject(query, []);
    requireCsrf(req, this.environment, req.auth.token);
    return this.external.revoke(req.auth.user.id, id, body);
  }
  @Get('custody')
  @Header('Cache-Control', 'no-store')
  activity(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    return this.custody.page(request.auth.user.id, query);
  }
  @Get('custody/:id')
  @Header('Cache-Control', 'no-store')
  detail(@Req() request: AuthenticatedRequest, @Query() query: unknown, @Param('id') id: string) {
    strictObject(query, []);
    return this.custody.page(request.auth.user.id, query, id);
  }
}
