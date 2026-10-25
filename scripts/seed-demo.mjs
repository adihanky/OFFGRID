import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../apps/api/dist/app.module.js';
import { loadEnvironment } from '../apps/api/dist/config/environment.js';
import { AccountsService } from '../apps/api/dist/modules/accounts/accounts.service.js';
import {
  assertDemoTarget,
  validateDemoPassword,
} from '../apps/api/dist/modules/accounts/demo-target.js';
import { AuthService } from '../apps/api/dist/modules/auth/auth.service.js';
import { PasswordService } from '../apps/api/dist/modules/auth/auth.crypto.js';

// Validate before Nest opens a database connection. Never print the environment/password.
const environment = loadEnvironment();
assertDemoTarget(environment);
const password = validateDemoPassword(process.env.DEMO_PASSWORD);
const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
try {
  const auth = app.get(AuthService);
  const passwords = app.get(PasswordService);
  const accounts = app.get(AccountsService);
  const users = [];
  for (const publicHandle of ['demo_alice', 'demo_bob']) {
    const email = `${publicHandle}@example.invalid`;
    let user = await auth.store.findUser(email);
    if (user) {
      if (
        user.publicHandle !== publicHandle ||
        user.displayName !== publicHandle ||
        user.googleSubject ||
        user.status !== 'active' ||
        !(await passwords.verify(password, user.passwordHash))
      ) {
        throw new Error('A demo identity conflicts with existing data; no identity was changed.');
      }
    } else {
      const result = await auth.signUp({ email, password, publicHandle });
      await auth.signOut(result.token);
      user = await auth.store.findUser(email);
      if (!user) throw new Error('Demo identity creation could not be confirmed.');
    }
    users.push(user);
  }
  const asset = await accounts.createAsset({
    code: 'DEMO',
    displayName: 'Demo credits',
    precision: 2,
  });
  for (const user of users) {
    await accounts.issueDemo({
      fixtureKey: `demo-v1:${user.publicHandle}:DEMO`,
      userId: user._id,
      assetId: asset._id,
      quantityUnits: 100000n,
    });
  }
  console.log('Demo fixtures ready: demo_alice@example.invalid and demo_bob@example.invalid.');
  console.log('Each identity has one 1000.00 DEMO issuance. Reruns do not reset spent balances.');
  console.log('Sign in using DEMO_PASSWORD. Use @demo_alice or @demo_bob for peer lookup.');
} finally {
  await app.close();
}
