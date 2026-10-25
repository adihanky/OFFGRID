import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EJSON, ObjectId } from 'bson';
import { After, Given, When, Then } from '@cucumber/cucumber';
import type { ActivityPage, AssetV2, SeedPreview } from '@p2p/contracts';
import {
  createTransferHarness,
  type TransferHarness,
  type TransferCaller,
} from '../support/transfer-harness.mjs';
import {
  migrateLegacyWallets,
  MIGRATION_POLICY,
} from '../../apps/api/src/modules/wallets/wallet-migration.js';
import { CustodyService } from '../../apps/api/src/modules/custody/custody.service.js';
import { WalletsService } from '../../apps/api/src/modules/wallets/wallets.service.js';
import { DemoService } from '../../apps/api/src/modules/admin/demo.service.js';
import { AdminService } from '../../apps/api/src/modules/admin/admin.service.js';
import { AuthService } from '../../apps/api/src/modules/auth/auth.service.js';
import { toLong } from '../../apps/api/src/modules/accounts/quantity.js';

const setupToken = 'isolated-setup-token-at-least-32-characters';
const seedPassword = 'Isolated-demo-password-2026';
interface DeliveryWorld {
  delivery?: TransferHarness;
  actor?: TransferCaller;
  bob?: TransferCaller;
  stranger?: TransferCaller;
  asset?: AssetV2;
  legacyAsset?: string;
  before?: string;
  error?: unknown;
  denied?: number[];
  migrated?: unknown;
  preview?: SeedPreview;
  counts?: number[];
  afterSpend?: string;
  eventId?: string;
}
const draft = {
  code: 'CONFIG',
  symbol: 'CFG',
  displayName: 'Configured demo',
  precision: 2,
  supplyCap: '10.00',
  minimum: '0.01',
  maximum: '10.00',
  reason: 'Controlled scenario',
};
async function evidence(h: TransferHarness) {
  const result: Record<string, unknown> = {};
  for (const name of ['accounts', 'demoIssuances', 'transfers', 'ledgerEntries', 'chainEntries']) {
    const rows = await h.database.db
      .collection(name, { promoteLongs: false })
      .find({})
      .sort({ _id: 1 })
      .toArray();
    for (const row of rows) if (name === 'accounts') delete row['walletId'];
    result[name] = rows;
  }
  return EJSON.stringify(result, { relaxed: false });
}
Given(
  'an isolated legacy wallet with issuance and a committed transfer',
  { timeout: 60000 },
  async function (this: DeliveryWorld) {
    const h = (this.delivery = await createTransferHarness());
    this.actor = await h.register('legacy_alice');
    this.bob = await h.register('legacy_bob');
    const asset = await h.accounts.createAsset({
      code: 'LEGACY',
      displayName: 'Legacy demo',
      precision: 2,
    });
    this.legacyAsset = asset._id.toHexString();
    await h.accounts.assets.updateOne(
      { _id: asset._id },
      {
        $unset: {
          custodyEnabled: '',
          schemaVersion: '',
          kind: '',
          mode: '',
          lifecycle: '',
          revision: '',
          identityKey: '',
          symbol: '',
        },
      },
    );
    await h.issue(this.actor, this.legacyAsset, 10000n);
    await h.issue(this.bob, this.legacyAsset, 10000n);
    assert.equal(
      (
        await h.transfers.submit(
          this.actor.id,
          { recipientId: this.bob.id, assetId: this.legacyAsset, quantity: '12.50' },
          randomUUID(),
        )
      ).transfer.status,
      'COMMITTED',
    );
    await h.database.db.collection('wallets').deleteMany({});
    this.before = await evidence(h);
  },
);
When(
  'the legacy wallets are migrated with the explicit provenance policy',
  async function (this: DeliveryWorld) {
    this.migrated = await migrateLegacyWallets(
      this.delivery!.database,
      this.delivery!.app.get(CustodyService),
      MIGRATION_POLICY,
    );
  },
);
Then(
  'balances, transfer IDs, journal and old chain hashes are preserved',
  async function (this: DeliveryWorld) {
    assert.equal(await evidence(this.delivery!), this.before);
    assert.equal(await this.delivery!.database.db.collection('wallets').countDocuments(), 2);
    assert.equal(
      (await this.delivery!.accounts.wallet(this.actor!.id)).accounts[0]!.balance,
      '87.50',
    );
  },
);
Then('migrated custody is labeled and reconciled', async function (this: DeliveryWorld) {
  const h = this.delivery!;
  assert.deepEqual(await h.app.get(CustodyService).verify(), { ok: true, issues: [] });
  const result = await h.request(this.actor!, '/api/v2/custody');
  assert.equal(result.status, 200);
  const page = (await result.json()) as ActivityPage;
  assert.equal(page.events.length, 2);
  assert.ok(page.events.every((event) => event.provenance === 'MIGRATED_POLICY'));
});
When('migration runs again after a new v2 payment', async function (this: DeliveryWorld) {
  const h = this.delivery!,
    wallets = h.app.get(WalletsService),
    wallet = await wallets.own(this.actor!.id);
  const review = await wallets.resolve(this.actor!.id, {
    assetId: this.legacyAsset,
    senderWalletId: wallet.id,
    lookup: { kind: 'HANDLE', value: this.bob!.handle },
  });
  assert.equal(
    (
      await h.transfers.submitV2(
        this.actor!.id,
        {
          assetId: this.legacyAsset,
          senderWalletId: wallet.id,
          recipientResolutionId: review.resolutionId,
          quantity: '1.00',
        },
        randomUUID(),
      )
    ).transfer.status,
    'COMMITTED',
  );
  this.counts = await Promise.all(
    ['wallets', 'custodyEvents', 'transfers'].map((name) =>
      h.database.db.collection(name).countDocuments(),
    ),
  );
  this.migrated = await migrateLegacyWallets(
    h.database,
    h.app.get(CustodyService),
    MIGRATION_POLICY,
  );
});
Then('no migration or payment is duplicated', async function (this: DeliveryWorld) {
  assert.deepEqual(this.migrated, { alreadyComplete: true });
  assert.deepEqual(
    await Promise.all(
      ['wallets', 'custodyEvents', 'transfers'].map((name) =>
        this.delivery!.database.db.collection(name).countDocuments(),
      ),
    ),
    this.counts,
  );
});
When(
  'a legacy balance is corrupted and migration is attempted',
  async function (this: DeliveryWorld) {
    await this.delivery!.accounts.accounts.updateOne(
      { ownerType: 'user', userId: new ObjectId(this.actor!.id) },
      { $inc: { balanceUnits: toLong(1n) } },
    );
    try {
      await migrateLegacyWallets(
        this.delivery!.database,
        this.delivery!.app.get(CustodyService),
        MIGRATION_POLICY,
      );
    } catch (error) {
      this.error = error;
    }
  },
);
When(
  'custody reconstruction fails halfway through migration',
  async function (this: DeliveryWorld) {
    const custody = this.delivery!.app.get(CustodyService);
    const original = custody.write.bind(custody);
    let count = 0;
    custody.write = async (...args) => {
      if (++count === 2) throw new Error('Controlled reconstruction failure');
      return original(...args);
    };
    try {
      await migrateLegacyWallets(this.delivery!.database, custody, MIGRATION_POLICY);
    } catch (error) {
      this.error = error;
    } finally {
      custody.write = original;
    }
  },
);
Then(
  'migration leaves wallets, assets and custody untouched',
  async function (this: DeliveryWorld) {
    assert.ok(this.error);
    const h = this.delivery!;
    assert.equal(await h.database.db.collection('wallets').countDocuments(), 0);
    assert.equal(await h.database.db.collection('walletMigrations').countDocuments(), 0);
    assert.equal(await h.database.db.collection('custodyEvents').countDocuments(), 0);
    assert.equal(
      (await h.accounts.assets.findOne({ _id: new ObjectId(this.legacyAsset) }))!.custodyEnabled,
      undefined,
    );
  },
);
Given(
  'an isolated administration fixture',
  { timeout: 60000 },
  async function (this: DeliveryWorld) {
    const h = (this.delivery = await createTransferHarness({ ADMIN_SETUP_TOKEN: setupToken }));
    this.actor = await h.register('delivery_admin');
    this.bob = await h.register('delivery_bob');
    this.stranger = await h.register('delivery_stranger');
  },
);
When(
  'an ordinary user tries asset administration and invalid setup',
  async function (this: DeliveryWorld) {
    const h = this.delivery!;
    this.denied = [
      (await h.request(this.actor!, '/api/v2/admin/assets', 'POST', draft)).status,
      (await h.request(this.actor!, '/api/v2/admin/setup', 'POST', { token: 'incorrect' })).status,
    ];
  },
);
Then('no asset or privilege is created', async function (this: DeliveryWorld) {
  assert.deepEqual(this.denied, [403, 403]);
  assert.equal(await this.delivery!.accounts.assets.countDocuments(), 0);
  assert.equal(await this.delivery!.database.db.collection('roleGrants').countDocuments(), 0);
});
When(
  'the administrator completes setup and creates a draft asset',
  async function (this: DeliveryWorld) {
    const h = this.delivery!;
    assert.equal(
      (await h.request(this.actor!, '/api/v2/admin/setup', 'POST', { token: setupToken })).status,
      201,
    );
    const result = await h.request(this.actor!, '/api/v2/admin/assets', 'POST', draft);
    assert.equal(result.status, 201);
    this.asset = ((await result.json()) as { asset: AssetV2 }).asset;
    assert.equal(this.asset.lifecycle, 'DRAFT');
  },
);
function issuance(w: DeliveryWorld, quantity = '10.00') {
  return {
    assetId: w.asset!.id,
    handle: w.actor!.handle,
    quantity,
    key: randomUUID(),
    reason: 'Controlled issuance',
  };
}
Then('the draft cannot receive issuance before activation', async function (this: DeliveryWorld) {
  assert.equal(
    (await this.delivery!.request(this.actor!, '/api/v2/admin/issuances', 'POST', issuance(this)))
      .status,
    400,
  );
  assert.equal(await this.delivery!.accounts.issuances.countDocuments(), 0);
});
When(
  'the administrator activates the asset and issues 10.00 units',
  async function (this: DeliveryWorld) {
    const response = await this.delivery!.request(
      this.actor!,
      `/api/v2/admin/assets/${this.asset!.id}`,
      'POST',
      {
        lifecycle: 'ACTIVE',
        displayName: draft.displayName,
        supplyCap: draft.supplyCap,
        minimum: draft.minimum,
        maximum: draft.maximum,
        reason: draft.reason,
      },
      { revision: this.asset!.revision },
    );
    assert.equal(response.status, 201);
    this.asset = ((await response.json()) as { asset: AssetV2 }).asset;
    const body = issuance(this);
    assert.equal(
      (await this.delivery!.request(this.actor!, '/api/v2/admin/issuances', 'POST', body)).status,
      201,
    );
    assert.equal(
      (await this.delivery!.request(this.actor!, '/api/v2/admin/issuances', 'POST', body)).status,
      201,
    );
  },
);
Then(
  'the wallet has 10.00 units with an issuance custody root',
  async function (this: DeliveryWorld) {
    assert.equal(
      (await this.delivery!.accounts.wallet(this.actor!.id)).accounts[0]!.balance,
      '10.00',
    );
    assert.equal(await this.delivery!.accounts.issuances.countDocuments(), 1);
    assert.equal(await this.delivery!.database.db.collection('custodyEvents').countDocuments(), 1);
  },
);
Then(
  'stale edits, cap overflow, forged CSRF and repeat setup are rejected',
  async function (this: DeliveryWorld) {
    const h = this.delivery!;
    assert.equal(
      (
        await h.request(
          this.actor!,
          `/api/v2/admin/assets/${this.asset!.id}`,
          'POST',
          {
            lifecycle: 'PAUSED',
            displayName: draft.displayName,
            supplyCap: draft.supplyCap,
            minimum: draft.minimum,
            maximum: draft.maximum,
            reason: draft.reason,
          },
          { revision: '0' },
        )
      ).status,
      409,
    );
    assert.equal(
      (await h.request(this.actor!, '/api/v2/admin/issuances', 'POST', issuance(this, '0.01')))
        .status,
      400,
    );
    assert.equal(
      (
        await h.request(this.actor!, '/api/v2/admin/issuances', 'POST', issuance(this), {
          csrfValue: 'forged',
        })
      ).status,
      403,
    );
    assert.equal(
      (await h.request(this.actor!, '/api/v2/admin/setup', 'POST', { token: setupToken })).status,
      409,
    );
    assert.deepEqual(await h.app.get(CustodyService).verify(), { ok: true, issues: [] });
  },
);
Then('the last access administrator cannot be removed', async function (this: DeliveryWorld) {
  const h = this.delivery!,
    response = await h.request(this.actor!, '/api/v2/admin/roles');
  const grants = (
    (await response.json()) as { grants: Array<{ handle: string; role: string; revision: string }> }
  ).grants;
  const grant = grants.find(
    (row) => row.handle === this.actor!.handle && row.role === 'ACCESS_ADMIN',
  )!;
  assert.equal(
    (
      await h.request(this.actor!, '/api/v2/admin/roles', 'POST', {
        handle: this.actor!.handle,
        role: 'ACCESS_ADMIN',
        status: 'REVOKED',
        revision: grant.revision,
        reason: 'Controlled removal',
      })
    ).status,
    409,
  );
});
When(
  'the administrator runs the default demo profile',
  { timeout: 120000 },
  async function (this: DeliveryWorld) {
    const h = this.delivery!;
    await h.app.get(AdminService).setup(this.actor!.id, { token: setupToken });
    this.preview = await h.app
      .get(DemoService)
      .preview(this.actor!.id, { userCount: 4, transferDepth: 3 });
    const response = await h.request(this.actor!, '/api/v2/admin/seed/run', 'POST', {
      previewId: this.preview.id,
      password: seedPassword,
    });
    assert.equal(response.status, 201, await response.text());
  },
);
Then(
  'four synthetic wallets have the expected exact DEMO and DETH balances',
  async function (this: DeliveryWorld) {
    const expected = [
      ['874.75', '1.99999999'],
      ['25.25', '2.00000000'],
      ['2099.99', '2.00000000'],
      ['1000.01', '2.00000001'],
    ];
    for (const [i, peer] of this.preview!.users.entries()) {
      const user = await this.delivery!.app.get(AuthService).store.findUser(peer.email);
      assert.ok(user);
      const wallet = await this.delivery!.app.get(WalletsService).own(user._id.toHexString());
      assert.equal(
        wallet.holdings.find((row) => row.asset.code === 'DEMO')!.balance,
        expected[i]![0],
      );
      assert.equal(
        wallet.holdings.find((row) => row.asset.code === 'DETH')!.balance,
        expected[i]![1],
      );
    }
    assert.deepEqual(await this.delivery!.app.get(CustodyService).verify(), {
      ok: true,
      issues: [],
    });
  },
);
When(
  'a synthetic peer spends and the same seed profile runs again',
  { timeout: 120000 },
  async function (this: DeliveryWorld) {
    const h = this.delivery!,
      auth = h.app.get(AuthService),
      alice = (await auth.store.findUser(this.preview!.users[0]!.email))!,
      bob = (await auth.store.findUser(this.preview!.users[1]!.email))!;
    const asset = (await h.accounts.assets.findOne({ code: 'DEMO' }))!;
    assert.equal(
      (
        await h.transfers.submit(
          alice._id.toHexString(),
          {
            recipientId: bob._id.toHexString(),
            assetId: asset._id.toHexString(),
            quantity: '5.00',
          },
          randomUUID(),
        )
      ).transfer.status,
      'COMMITTED',
    );
    this.before = await evidence(h);
    this.afterSpend = (await h.accounts.wallet(alice._id.toHexString())).accounts.find(
      (row) => row.code === 'DEMO',
    )!.balance;
    const result = await h.app
      .get(DemoService)
      .run(this.actor!.id, { previewId: this.preview!.id, password: seedPassword });
    assert.equal(result.alreadyComplete, true);
  },
);
Then(
  'spending is preserved with no duplicate financial effects',
  async function (this: DeliveryWorld) {
    assert.equal(await evidence(this.delivery!), this.before);
    assert.equal(this.afterSpend, '869.75');
  },
);
When(
  'a seed identity conflicts and an operator without a role tries to seed',
  async function (this: DeliveryWorld) {
    const h = this.delivery!;
    await h.app.get(AdminService).setup(this.actor!.id, { token: setupToken });
    const preview = await h.app
      .get(DemoService)
      .preview(this.actor!.id, { userCount: 4, transferDepth: 3 });
    await h.register('sample_alice'); // Controlled identity has no password; never overwrite it.
    this.denied = [
      (
        await h.request(this.actor!, '/api/v2/admin/seed/run', 'POST', {
          previewId: preview.id,
          password: seedPassword,
        })
      ).status,
      (
        await h.request(this.bob!, '/api/v2/admin/seed/preview', 'POST', {
          userCount: 4,
          transferDepth: 3,
        })
      ).status,
    ];
    const admin = h.app.get(AdminService);
    await admin.grants.updateOne(
      { userId: new ObjectId(this.actor!.id), role: 'DEMO_OPERATOR' },
      { $set: { status: 'REVOKED' } },
    );
    this.denied.push(
      (
        await h.request(this.actor!, '/api/v2/admin/seed/run', 'POST', {
          previewId: preview.id,
          password: seedPassword,
        })
      ).status,
    );
  },
);
Then('seed operations are rejected without issuing units', async function (this: DeliveryWorld) {
  assert.deepEqual(this.denied, [409, 403, 403]);
  assert.equal(await this.delivery!.accounts.issuances.countDocuments(), 0);
});
When(
  'issuance and a transfer create participant custody activity',
  async function (this: DeliveryWorld) {
    const h = this.delivery!;
    const asset = await h.accounts.createAsset({
      code: 'GRAPH',
      displayName: 'Graph',
      precision: 2,
    });
    this.legacyAsset = asset._id.toHexString();
    for (let i = 0; i < 22; i++) await h.issue(this.actor!, this.legacyAsset, 100n, `graph:${i}`);
    const result = await h.transfers.submit(
      this.actor!.id,
      { recipientId: this.bob!.id, assetId: this.legacyAsset, quantity: '1.25' },
      randomUUID(),
    );
    assert.equal(result.transfer.status, 'COMMITTED');
    this.eventId = (await h.app
      .get(CustodyService)
      .events.findOne({ referenceId: new ObjectId(result.transfer.id) }))!._id.toHexString();
  },
);
Then(
  'participants can inspect their event graph but strangers cannot',
  async function (this: DeliveryWorld) {
    const h = this.delivery!;
    for (const caller of [this.actor!, this.bob!]) {
      const response = await h.request(caller, `/api/v2/custody/${this.eventId}`);
      assert.equal(response.status, 200);
      const page = (await response.json()) as ActivityPage;
      assert.equal(page.events[0]!.inputs.length, 2);
      assert.equal(page.events[0]!.allocations.length, 3);
      const data = JSON.stringify(page);
      assert.ok(!data.includes('userId'));
      assert.ok(!data.includes('walletId'));
      assert.ok(!data.includes('normalizedEmail'));
      assert.ok(!data.includes(this.stranger!.id));
    }
    assert.equal((await h.request(this.stranger!, `/api/v2/custody/${this.eventId}`)).status, 404);
    assert.equal((await h.request(h.anonymous, '/api/v2/custody')).status, 401);
  },
);
Then(
  'activity pagination returns each event once without exposing other identities',
  async function (this: DeliveryWorld) {
    const h = this.delivery!,
      first = (await (await h.request(this.actor!, '/api/v2/custody')).json()) as ActivityPage;
    assert.equal(first.events.length, 20);
    assert.ok(first.nextCursor);
    const second = (await (
      await h.request(this.actor!, `/api/v2/custody?cursor=${first.nextCursor}`)
    ).json()) as ActivityPage;
    assert.equal(second.events.length, 3);
    assert.equal(second.nextCursor, null);
    assert.equal(new Set([...first.events, ...second.events].map((event) => event.id)).size, 23);
    assert.equal((await h.request(this.actor!, '/api/v2/custody?cursor=invalid')).status, 400);
  },
);
After({ tags: '@wallet_delivery', timeout: 30000 }, async function (this: DeliveryWorld) {
  await this.delivery?.close();
});

When(
  'a seed acknowledgement is lost after a committed transfer',
  { timeout: 120000 },
  async function (this: DeliveryWorld) {
    const h = this.delivery!;
    await h.app.get(AdminService).setup(this.actor!.id, { token: setupToken });
    this.preview = await h.app
      .get(DemoService)
      .preview(this.actor!.id, { userCount: 4, transferDepth: 3 });
    const original = h.transfers.submit.bind(h.transfers);
    let injected = false;
    h.transfers.submit = async (...args) => {
      const result = await original(...args);
      if (!injected) {
        injected = true;
        throw new Error('Controlled lost acknowledgement after commit');
      }
      return result;
    };
    try {
      await assert.rejects(() =>
        h.app
          .get(DemoService)
          .run(this.actor!.id, { previewId: this.preview!.id, password: seedPassword }),
      );
    } finally {
      h.transfers.submit = original;
    }
    assert.equal(await h.transfers.transfers.countDocuments({ status: 'COMMITTED' }), 1);
    assert.equal(
      (await h.database.db.collection('seedRuns').findOne({ key: 'wallet-demo-v2' }))!['state'],
      'INCOMPLETE',
    );
  },
);
When(
  'the service restarts and resumes the original seed run',
  { timeout: 120000 },
  async function (this: DeliveryWorld) {
    await this.delivery!.restart();
    await this.delivery!.app.get(DemoService).run(this.actor!.id, {
      previewId: this.preview!.id,
      password: seedPassword,
    });
  },
);
Then('each seed issuance and transfer exists exactly once', async function (this: DeliveryWorld) {
  assert.equal(await this.delivery!.accounts.issuances.countDocuments(), 8);
  assert.equal(await this.delivery!.transfers.transfers.countDocuments(), 4);
  assert.equal(await this.delivery!.database.db.collection('custodyEvents').countDocuments(), 12);
});

When(
  'a seed transfer is reported pending after another executor commits it',
  { timeout: 120000 },
  async function (this: DeliveryWorld) {
    const h = this.delivery!;
    await h.app.get(AdminService).setup(this.actor!.id, { token: setupToken });
    this.preview = await h.app
      .get(DemoService)
      .preview(this.actor!.id, { userCount: 4, transferDepth: 3 });
    const original = h.transfers.submit.bind(h.transfers);
    let reportedPending = false;
    h.transfers.submit = async (...args) => {
      const result = await original(...args);
      if (!reportedPending) {
        reportedPending = true;
        return { statusCode: 202, transfer: { ...result.transfer, status: 'PENDING' } };
      }
      return result;
    };
    try {
      await h.app
        .get(DemoService)
        .run(this.actor!.id, { previewId: this.preview!.id, password: seedPassword });
    } finally {
      h.transfers.submit = original;
    }
    assert.equal(reportedPending, true);
  },
);
