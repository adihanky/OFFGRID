import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { TransfersService } from '../modules/transfers/transfers.service.js';
@Injectable()
export class TransferRecoveryService implements OnApplicationBootstrap, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running: Promise<unknown> | undefined;
  private stopped = false;
  private readonly logger = new Logger(TransferRecoveryService.name);
  constructor(@Inject(TransfersService) private readonly transfers: TransfersService) {}
  onApplicationBootstrap() {
    this.stopped = false;
    this.timer = setInterval(() => this.tick(), 2000);
    this.timer.unref();
  }
  tick() {
    if (this.stopped || this.running) return;
    this.running = this.transfers
      .recover()
      .catch(() => {
        this.logger.warn('Pending transfer recovery unavailable; requests retained for retry.');
      })
      .finally(() => {
        this.running = undefined;
      });
  }
  async stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }
  async onModuleDestroy() {
    await this.stop();
  }
}
