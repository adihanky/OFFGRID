import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ENVIRONMENT } from '../../config/environment.module.js';
import type { Environment } from '../../config/environment.js';
import { ChainWalletService } from './chain-wallet.service.js';
/** Serial round-robin indexing; persisted leases also serialize multiple API instances. */
@Injectable()
export class ChainIndexer implements OnApplicationBootstrap, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | undefined;
  private pending: Promise<void> | undefined;
  private cursor = '';
  constructor(
    @Inject(ChainWalletService) readonly chain: ChainWalletService,
    @Inject(ENVIRONMENT) readonly environment: Environment,
  ) {}
  onApplicationBootstrap() {
    if (this.environment.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      if (!this.pending)
        this.pending = this.tick()
          .catch(() => {
            /* Retry after database recovery. */
          })
          .finally(() => {
            this.pending = undefined;
          });
    }, 15000);
    this.timer.unref();
  }
  async tick() {
    const row = await this.chain.subscriptions.findOne(
      { bindingId: { $gt: this.cursor } },
      { sort: { bindingId: 1 } },
    );
    if (!row) {
      this.cursor = '';
      return;
    }
    this.cursor = row.bindingId;
    try {
      await this.chain.sync(row.userId, row.bindingId);
    } catch {
      await this.chain.subscriptions.updateOne(
        { bindingId: row.bindingId },
        {
          $set: {
            lastError:
              'Provider synchronization failed. Stored records may be stale; retry synchronization.',
          },
        },
      );
    }
  }
  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.pending;
  }
}
