import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { OperationsService } from './operations.service.js';
@Injectable()
export class OperationsWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private work?: Promise<unknown>;
  private stopped = false;
  constructor(@Inject(OperationsService) readonly operations: OperationsService) {}
  onApplicationBootstrap() {
    this.stopped = false;
    this.timer = setInterval(() => this.tick(), 2000);
    this.timer.unref();
  }
  tick() {
    if (this.stopped || this.work) return;
    this.work = (async () => {
      for (let i = 0; i < 20 && !this.stopped; i++)
        if (!(await this.operations.deliverOne())) break;
      if (!this.stopped) await this.operations.runJob();
    })()
      .catch(() => {
        /* Durable leases retain unfinished work for retry. */
      })
      .finally(() => {
        this.work = undefined;
      });
  }
  async stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.work;
  }
  async onModuleDestroy() {
    await this.stop();
  }
}
