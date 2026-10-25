import { Module } from '@nestjs/common';
import { NetworksService } from './networks.service.js';
import { RPC_TRANSPORT, rpcTransport } from './rpc.js';
@Module({
  providers: [NetworksService, { provide: RPC_TRANSPORT, useValue: rpcTransport }],
  exports: [NetworksService],
})
export class NetworksModule {}
