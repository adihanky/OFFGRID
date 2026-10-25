import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../apps/api/dist/app.module.js';
import { loadEnvironment } from '../apps/api/dist/config/environment.js';
import {
  assertDemoTarget,
  validateDemoPassword,
} from '../apps/api/dist/modules/accounts/demo-target.js';
import { DemoService } from '../apps/api/dist/modules/admin/demo.service.js';
const environment = loadEnvironment();
assertDemoTarget(environment);
const password = validateDemoPassword(process.env.DEMO_PASSWORD);
const handle = process.env.DEMO_OPERATOR_HANDLE;
if (!handle || !/^[a-z][a-z0-9_]{2,23}$/.test(handle))
  throw new Error(
    'Set DEMO_OPERATOR_HANDLE to a registered operator with an active DEMO_OPERATOR grant.',
  );
const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
try {
  const demo = app.get(DemoService);
  const users = await demo.admin.accounts.identities.peer(handle);
  if (!users) throw new Error('Operator unavailable.');
  const preview = await demo.preview(users.id, { userCount: 4, transferDepth: 3 });
  const result = await demo.run(users.id, { previewId: preview.id, password });
  console.log(
    JSON.stringify({
      state: result.state,
      alreadyComplete: result.alreadyComplete,
      operations: result.operations,
    }),
  );
} finally {
  await app.close();
}
