import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { After, Given, When, Then } from '@cucumber/cucumber';
import {
  createEnhancementHarness,
  type EnhancementHarness,
} from '../support/enhancement-harness.mjs';
import { SettingsService } from '../../apps/api/src/modules/configuration/settings.service.js';
import { productDefaults } from '../../apps/api/src/modules/configuration/policy-registry.js';
import { WalletsService } from '../../apps/api/src/modules/wallets/wallets.service.js';
import type { RecipientResolutionView } from '@p2p/contracts';
interface SettingsWorld {
  enhancement?: EnhancementHarness;
  settingReview?: RecipientResolutionView;
  settingWallet?: string;
  settingRace?: PromiseSettledResult<{ scope: string; revision: string }>[];
  settingCommands?: Array<{
    scope: 'PRODUCT';
    values: typeof productDefaults;
    reason: string;
    commandId: string;
  }>;
  settingWinner?: number;
}
Given(
  'an isolated enhancement administration fixture',
  { timeout: 120000 },
  async function (this: SettingsWorld) {
    this.enhancement = await createEnhancementHarness();
  },
);
After({ tags: '@settings', timeout: 15000 }, async function (this: SettingsWorld) {
  await this.enhancement?.close();
});
When('the administrator publishes a validated review policy', async function (this: SettingsWorld) {
  const f = this.enhancement!,
    wallets = f.h.app.get(WalletsService);
  this.settingWallet = (await wallets.own(f.alice.id)).id;
  this.settingReview = await wallets.resolve(f.alice.id, {
    senderWalletId: this.settingWallet,
    assetId: f.asset._id.toHexString(),
    lookup: { kind: 'HANDLE', value: f.bob.handle },
  });
  const settings = f.h.app.get(SettingsService);
  const values = { ...productDefaults, reviewSeconds: 45 };
  const preview = await settings.validate(f.admin.id, { scope: 'PRODUCT', values });
  assert.equal(preview.revision, '0');
  assert.deepEqual(preview.changes, [{ key: 'reviewSeconds', before: 120, after: 45 }]);
  assert.equal(
    (
      await settings.publish(f.admin.id, '0', {
        scope: 'PRODUCT',
        values,
        reason: 'Short controlled review',
        commandId: randomUUID(),
      })
    ).revision,
    '1',
  );
});
Then('new recipient reviews use the published lifetime', async function (this: SettingsWorld) {
  const f = this.enhancement!,
    before = Date.now();
  const review = await f.h.app.get(WalletsService).resolve(f.alice.id, {
    senderWalletId: this.settingWallet,
    assetId: f.asset._id.toHexString(),
    lookup: { kind: 'HANDLE', value: f.bob.handle },
  });
  const remaining = Date.parse(review.expiresAt) - before;
  assert.ok(remaining >= 45000 && remaining < 47000, String(remaining));
});
Then('an unsubmitted old review requires review again', async function (this: SettingsWorld) {
  const f = this.enhancement!;
  await assert.rejects(
    f.h.app
      .get(WalletsService)
      .reviewed(
        f.alice.id,
        this.settingReview!.resolutionId,
        this.settingWallet!,
        f.asset._id.toHexString(),
      ),
    (error) =>
      !!error &&
      typeof error === 'object' &&
      'getStatus' in error &&
      (error.getStatus as () => number)() === 409,
  );
});
Then('the policy revision and reason persist in history', async function (this: SettingsWorld) {
  const f = this.enhancement!,
    settings = f.h.app.get(SettingsService);
  const current = await settings.list(f.admin.id);
  assert.equal(current.settings.find((s) => s.scope === 'PRODUCT')!.revision, '1');
  const history = await settings.revisions(f.admin.id, 'PRODUCT');
  assert.equal(history.revisions[0]!.reason, 'Short controlled review');
  assert.equal(history.revisions[0]!.revision, '1');
});
When(
  'an ordinary user or an invalid publication targets settings',
  async function (this: SettingsWorld) {
    const f = this.enhancement!,
      settings = f.h.app.get(SettingsService);
    const valid = {
      scope: 'PRODUCT',
      values: productDefaults,
      reason: 'Controlled publication',
      commandId: randomUUID(),
    };
    await assert.rejects(
      settings.publish(f.alice.id, '0', valid),
      (error) =>
        !!error &&
        typeof error === 'object' &&
        'getStatus' in error &&
        (error.getStatus as () => number)() === 403,
    );
    await assert.rejects(
      settings.publish(f.admin.id, '0', {
        ...valid,
        values: { ...productDefaults, mainnet: true },
      }),
    );
    const response = await f.h.request(f.admin, '/api/v2/admin/settings', 'PATCH', valid, {
      revision: '0',
      csrf: false,
    });
    assert.equal(response.status, 403);
    const unquoted = await f.h.request(f.admin, '/api/v2/admin/settings', 'PATCH', valid, {
      revision: '0',
    });
    assert.equal(unquoted.status, 400);
    const stale = await f.h.request(f.admin, '/api/v2/admin/settings', 'PATCH', valid, {
      revision: '"1"',
    });
    assert.equal(stale.status, 412);
  },
);
Then('configuration and audit remain unchanged', async function (this: SettingsWorld) {
  const f = this.enhancement!;
  assert.equal((await f.h.app.get(SettingsService).reader.product()).revision, '0');
  assert.equal(
    await f.h.database.db.collection('adminAudit').countDocuments({ action: 'SETTINGS_PRODUCT' }),
    0,
  );
});
When('two policy publications race from the same revision', async function (this: SettingsWorld) {
  const f = this.enhancement!,
    service = f.h.app.get(SettingsService);
  this.settingCommands = [45, 90].map((reviewSeconds) => ({
    scope: 'PRODUCT',
    values: { ...productDefaults, reviewSeconds },
    reason: 'Controlled racing publication',
    commandId: randomUUID(),
  }));
  this.settingRace = await Promise.allSettled(
    this.settingCommands.map((command) => service.publish(f.admin.id, '0', command)),
  );
});
Then(
  'exactly one publication wins and the other receives a stale revision',
  function (this: SettingsWorld) {
    assert.equal(this.settingRace!.filter((result) => result.status === 'fulfilled').length, 1);
    const rejected = this.settingRace!.find(
      (result) => result.status === 'rejected',
    ) as PromiseRejectedResult;
    assert.equal(rejected.reason.getStatus(), 412);
    this.settingWinner = this.settingRace!.findIndex((result) => result.status === 'fulfilled');
  },
);
Then(
  'replaying the winning publication returns its original revision once',
  async function (this: SettingsWorld) {
    const f = this.enhancement!,
      service = f.h.app.get(SettingsService);
    const result = await service.publish(
      f.admin.id,
      '0',
      this.settingCommands![this.settingWinner!]!,
    );
    assert.equal(result.revision, '1');
    assert.equal(
      await f.h.database.db.collection('adminAudit').countDocuments({ action: 'SETTINGS_PRODUCT' }),
      1,
    );
    assert.equal((await service.reader.product()).revision, '1');
  },
);
Then('reusing its command for different values conflicts', async function (this: SettingsWorld) {
  const f = this.enhancement!,
    command = this.settingCommands![this.settingWinner!]!;
  await assert.rejects(
    f.h.app
      .get(SettingsService)
      .publish(f.admin.id, '0', { ...command, reason: 'Another reason for the same command' }),
    (error) =>
      !!error &&
      typeof error === 'object' &&
      'getStatus' in error &&
      (error.getStatus as () => number)() === 409,
  );
});
