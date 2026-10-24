import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { MongoClient } from 'mongodb';
import { ENVIRONMENT } from '../config/environment.module.js';
import type { Environment } from '../config/environment.js';
import type { ReadinessResponse } from '@p2p/contracts';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  readonly client: MongoClient;

  constructor(@Inject(ENVIRONMENT) private readonly environment: Environment) {
    this.client = new MongoClient(environment.MONGODB_URI, {
      appName: 'p2p-api',
      serverSelectionTimeoutMS: 3000,
      connectTimeoutMS: 3000,
      maxPoolSize: 10,
    });
  }

  get db() {
    return this.client.db(this.environment.MONGODB_DB);
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.close();
  }

  async readiness(): Promise<ReadinessResponse> {
    try {
      const hello = await this.db.admin().command({ hello: 1 }, { timeoutMS: 3000 });
      const ready =
        hello.setName === this.environment.MONGODB_REPLICA_SET &&
        hello.isWritablePrimary === true &&
        typeof hello.logicalSessionTimeoutMinutes === 'number';
      return {
        status: ready ? 'ready' : 'unavailable',
        checks: { mongodb: 'up', replicaSet: ready ? 'ready' : 'unavailable' },
      };
    } catch {
      return {
        status: 'unavailable',
        checks: { mongodb: 'down', replicaSet: 'unavailable' },
      };
    }
  }
}
