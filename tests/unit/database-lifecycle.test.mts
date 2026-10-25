import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Test } from '@nestjs/testing';
import { ExpressAdapter } from '@nestjs/platform-express';
import { ENVIRONMENT, EnvironmentModule } from '../../apps/api/src/config/environment.module.js';
import { DatabaseModule } from '../../apps/api/src/database/database.module.js';
import { DatabaseService } from '../../apps/api/src/database/database.service.js';
import { TransfersService } from '../../apps/api/src/modules/transfers/transfers.service.js';
import { TransferRecoveryService } from '../../apps/api/src/workers/transfer-recovery.service.js';
import { testEnvironment } from '../support/auth-fixture.mjs';

test('application shutdown drains in-flight recovery before closing shared database', async (context) => {
  const environment = testEnvironment();
  const database = new DatabaseService(environment);
  const events: string[] = [];
  context.mock.method(database.client, 'connect', async () => database.client);
  context.mock.method(database.client, 'close', async () => {
    events.push('database closed');
  });
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const running = new Promise<void>((resolve) => {
    started = resolve;
  });
  const module = await Test.createTestingModule({
    imports: [EnvironmentModule, DatabaseModule],
    providers: [
      TransferRecoveryService,
      {
        provide: TransfersService,
        useValue: {
          recover: async () => {
            started();
            await gate;
            events.push('recovery drained');
          },
        },
      },
    ],
  })
    .overrideProvider(ENVIRONMENT)
    .useValue(environment)
    .overrideProvider(DatabaseService)
    .useValue(database)
    .compile();
  // Load the HTTP adapter with the fixture imports instead of charging its lazy
  // Windows module-loading cost to the bounded shutdown assertion.
  const app = module.createNestApplication(new ExpressAdapter(), { logger: false });
  await app.init();
  module.get(TransferRecoveryService).tick();
  await running;
  const closing = app.close();
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(events, []);
  } finally {
    release();
    await closing;
  }
  assert.deepEqual(events, ['recovery drained', 'database closed']);
});
