import 'reflect-metadata';
import assert from 'node:assert/strict';
import { ObjectId } from 'mongodb';
import { After, Given, When, Then } from '@cucumber/cucumber';
import {
  createTransferHarness,
  type TransferHarness,
  type TransferCaller,
} from '../support/transfer-harness.mjs';
import { ControlledRecoveryDelivery } from '../support/recovery-delivery.mjs';
import { RecoveryService } from '../../apps/api/src/modules/auth/recovery.service.js';
import { PasswordService } from '../../apps/api/src/modules/auth/auth.crypto.js';
interface RecoveryWorld {
  recoveryHarness?: TransferHarness;
  recoveryInbox?: ControlledRecoveryDelivery;
  recoveryOwner?: TransferCaller;
  recoveryOther?: TransferCaller;
  resetTokens?: string[];
  resetResults?: PromiseSettledResult<unknown>[];
  resetAcks?: unknown[];
}
const original = 'Controlled-original-password-2026',
  replacement = 'Controlled-replacement-password-2026';
Given(
  'an isolated account recovery fixture with controlled delivery',
  { timeout: 120000 },
  async function (this: RecoveryWorld) {
    this.recoveryInbox = new ControlledRecoveryDelivery();
    this.recoveryHarness = await createTransferHarness({}, this.recoveryInbox);
    this.recoveryOwner = await this.recoveryHarness.register('recovery_alice');
    this.recoveryOther = await this.recoveryHarness.register('recovery_bob');
    await this.recoveryHarness.database.db.collection('users').updateOne(
      { _id: new ObjectId(this.recoveryOwner.id) },
      {
        $set: {
          passwordHash: await this.recoveryHarness.app.get(PasswordService).hash(original),
        },
      },
    );
  },
);
After({ tags: '@account_recovery', timeout: 15000 }, async function (this: RecoveryWorld) {
  await this.recoveryHarness?.close();
});
When('the owner verifies email through the controlled inbox', async function (this: RecoveryWorld) {
  const service = this.recoveryHarness!.app.get(RecoveryService);
  await service.requestVerification(this.recoveryOwner!.id, {});
  const message = this.recoveryInbox!.messages.at(-1)!;
  assert.equal(message.kind, 'VERIFY');
  await service.consume('VERIFY', { token: message.token }, this.recoveryOwner!.id);
  await assert.rejects(service.consume('VERIFY', { token: message.token }, this.recoveryOwner!.id));
  assert.equal(
    (await service.users.findOne({ _id: new ObjectId(this.recoveryOwner!.id) }))!.emailVerified,
    true,
  );
});
When('the owner consumes a password reset from that inbox', async function (this: RecoveryWorld) {
  const service = this.recoveryHarness!.app.get(RecoveryService);
  await service.requestReset({ email: `${this.recoveryOwner!.handle}@example.invalid` });
  const message = this.recoveryInbox!.messages.at(-1)!;
  assert.equal(message.kind, 'RESET');
  await service.consume('RESET', { token: message.token, password: replacement });
});
Then(
  'the new password signs in and all previous owner sessions are revoked',
  async function (this: RecoveryWorld) {
    const h = this.recoveryHarness!,
      owner = this.recoveryOwner!;
    assert.equal((await h.request(owner, '/api/auth/me')).status, 401);
    assert.equal((await h.request(this.recoveryOther!, '/api/auth/me')).status, 200);
    assert.equal(
      await h.database.db
        .collection('sessions')
        .countDocuments({ userId: new ObjectId(owner.id), revokedAt: null }),
      0,
    );
    await h.csrf(owner);
    assert.equal(
      (
        await h.request(owner, '/api/auth/signin', 'POST', {
          email: `${owner.handle}@example.invalid`,
          password: replacement,
        })
      ).status,
      200,
    );
    assert.equal((await h.request(owner, '/api/auth/me')).status, 200);
  },
);
When(
  'reset requests target unknown, unverified and provider-only identities',
  async function (this: RecoveryWorld) {
    const h = this.recoveryHarness!,
      service = h.app.get(RecoveryService);
    await h.database.db
      .collection('users')
      .updateOne(
        { _id: new ObjectId(this.recoveryOther!.id) },
        { $set: { emailVerified: true, googleSubject: 'controlled-provider-only-subject' } },
      );
    this.resetAcks = [];
    for (const email of [
      'unknown@example.invalid',
      `${this.recoveryOwner!.handle}@example.invalid`,
      `${this.recoveryOther!.handle}@example.invalid`,
    ])
      this.resetAcks.push(await service.requestReset({ email }));
  },
);
Then('all acknowledgments match and no reset is delivered', function (this: RecoveryWorld) {
  assert.deepEqual(this.resetAcks![0], this.resetAcks![1]);
  assert.deepEqual(this.resetAcks![1], this.resetAcks![2]);
  assert.equal(this.recoveryInbox!.messages.length, 0);
});
Then(
  'cross-user session revocation and missing recovery CSRF are rejected',
  async function (this: RecoveryWorld) {
    const h = this.recoveryHarness!,
      service = h.app.get(RecoveryService);
    const other = (
      await service.listSessions(
        this.recoveryOther!.id,
        this.recoveryOther!.jar.get('p2p_session')!,
      )
    ).sessions[0]!;
    await assert.rejects(service.revoke(this.recoveryOwner!.id, other.id));
    const result = await h.request(
      this.recoveryOwner!,
      '/api/auth/password-reset-requests',
      'POST',
      { email: 'unknown@example.invalid' },
      { csrf: false },
    );
    assert.equal(result.status, 403);
    assert.equal((await h.request(this.recoveryOther!, '/api/auth/me')).status, 200);
  },
);
When('two valid password reset links race', async function (this: RecoveryWorld) {
  const service = this.recoveryHarness!.app.get(RecoveryService),
    email = `${this.recoveryOwner!.handle}@example.invalid`;
  await service.requestReset({ email });
  await service.requestReset({ email });
  this.resetTokens = this.recoveryInbox!.messages.filter((message) => message.kind === 'RESET').map(
    (message) => message.token,
  );
  this.resetResults = await Promise.allSettled(
    this.resetTokens.map((token) => service.consume('RESET', { token, password: replacement })),
  );
});
Then(
  'exactly one reset commits and both original links become unusable',
  async function (this: RecoveryWorld) {
    assert.equal(this.resetResults!.filter((result) => result.status === 'fulfilled').length, 1);
    const service = this.recoveryHarness!.app.get(RecoveryService);
    for (const token of this.resetTokens!)
      await assert.rejects(service.consume('RESET', { token, password: original }));
    const user = await service.users.findOne({ _id: new ObjectId(this.recoveryOwner!.id) });
    assert.equal(await service.passwords.verify(replacement, user!.passwordHash), true);
  },
);
Then(
  'an expired verification link and a delivery outage remain safe',
  async function (this: RecoveryWorld) {
    const service = this.recoveryHarness!.app.get(RecoveryService),
      other = this.recoveryOther!;
    await service.requestVerification(other.id, {});
    const token = this.recoveryInbox!.messages.at(-1)!.token;
    await service.tokens.updateMany(
      { userId: new ObjectId(other.id) },
      { $set: { expiresAt: new Date(0) } },
    );
    await assert.rejects(service.consume('VERIFY', { token }, other.id));
    this.recoveryInbox!.failing = true;
    await assert.rejects(service.requestVerification(other.id, {}));
    assert.equal(
      (await service.users.findOne({ _id: new ObjectId(other.id) }))!.emailVerified,
      false,
    );
  },
);
