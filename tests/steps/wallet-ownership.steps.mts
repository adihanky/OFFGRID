import 'reflect-metadata';
import assert from 'node:assert/strict';
import { After, Given, When, Then } from '@cucumber/cucumber';
import { ObjectId } from 'mongodb';
import {
  createTransferHarness,
  type TransferHarness,
  type TransferCaller,
} from '../support/transfer-harness.mjs';
import { WalletsService } from '../../apps/api/src/modules/wallets/wallets.service.js';
import type { RecipientResolutionView } from '@p2p/contracts';
import { RoleAuthorization } from '../../apps/api/src/modules/wallets/role-authorization.js';
import { toLong } from '../../apps/api/src/modules/accounts/quantity.js';

interface WalletWorld {
  ownershipHarness?: TransferHarness;
  ownershipCleanupStarted?: boolean;
  ownerAlice?: TransferCaller;
  ownerBob?: TransferCaller;
  aliceWallet?: string;
  bobWallet?: string;
  ownerAsset?: string;
  registrations?: Response[];
  registeredId?: string;
  resolutions?: RecipientResolutionView[];
  resolutionStatuses?: number[];
  expiredError?: unknown;
  roleChecks?: boolean[];
  bindingClaimError?: unknown;
  walletSchemaError?: unknown;
}
Given(
  'an isolated application wallet fixture',
  { timeout: 120000 },
  async function (this: WalletWorld) {
    const harness = await createTransferHarness();
    if (this.ownershipCleanupStarted) {
      await harness.close();
      throw new Error('Ownership fixture completed after scenario cleanup.');
    }
    this.ownershipHarness = harness;
  },
);
When('a new user registers through the application', async function (this: WalletWorld) {
  const h = this.ownershipHarness!;
  await h.csrf(h.anonymous);
  const response = await h.request(h.anonymous, '/api/auth/signup', 'POST', {
    email: 'wallet_signup@example.invalid',
    password: 'Synthetic-wallet-pass-42',
    publicHandle: 'wallet_signup',
  });
  assert.equal(response.status, 201);
  this.registeredId = ((await response.json()) as { user: { id: string } }).user.id;
});
Then('exactly one active empty wallet belongs to the new user', async function (this: WalletWorld) {
  const h = this.ownershipHarness!;
  const wallets = await h.database.db
    .collection('wallets')
    .find({ userId: new ObjectId(this.registeredId) })
    .toArray();
  assert.equal(wallets.length, 1);
  assert.equal(wallets[0]!['status'], 'ACTIVE');
  assert.equal(await h.database.db.collection('accounts').countDocuments(), 0);
  assert.equal(await h.database.db.collection('demoIssuances').countDocuments(), 0);
  const own = await h.request(h.anonymous, '/api/v2/wallet');
  assert.equal(own.status, 200);
  const body = (await own.json()) as { wallet: { id: string; holdings: unknown[] } };
  assert.equal(body.wallet.id, wallets[0]!._id.toHexString());
  assert.deepEqual(body.wallet.holdings, []);
});
When(
  'two requests register the same new identity concurrently',
  async function (this: WalletWorld) {
    const h = this.ownershipHarness!;
    await h.csrf(h.anonymous);
    const body = {
      email: 'wallet_race@example.invalid',
      password: 'Synthetic-wallet-pass-42',
      publicHandle: 'wallet_race',
    };
    this.registrations = await Promise.all([
      h.request(h.anonymous, '/api/auth/signup', 'POST', body),
      h.request(h.anonymous, '/api/auth/signup', 'POST', body),
    ]);
  },
);
Then(
  'one registration succeeds and one conflicts with no orphan wallet',
  async function (this: WalletWorld) {
    assert.deepEqual(this.registrations!.map((r) => r.status).sort(), [201, 409]);
    const db = this.ownershipHarness!.database.db;
    const users = await db.collection('users').find({}).toArray();
    const wallets = await db.collection('wallets').find({}).toArray();
    assert.equal(users.length, 1);
    assert.equal(wallets.length, 1);
    assert.ok(wallets[0]!['userId'].equals(users[0]!._id));
  },
);
Given(
  'two distinct registered application wallets with an enabled demo asset',
  async function (this: WalletWorld) {
    const h = this.ownershipHarness!;
    this.ownerAlice = await h.register('wallet_alice');
    this.ownerBob = await h.register('wallet_bob');
    this.aliceWallet = (await h.app.get(WalletsService).own(this.ownerAlice.id)).id;
    this.bobWallet = (await h.app.get(WalletsService).own(this.ownerBob.id)).id;
    this.ownerAsset = (
      await h.accounts.createAsset({
        code: 'WALLETS',
        displayName: 'Demo wallet asset',
        precision: 2,
      })
    )._id.toHexString();
  },
);
Given('the recipient has signed out', async function (this: WalletWorld) {
  assert.equal(
    (await this.ownershipHarness!.request(this.ownerBob!, '/api/auth/signout', 'POST')).status,
    204,
  );
});
function resolutionBody(
  w: WalletWorld,
  kind: string,
  value: string,
  senderWalletId = w.aliceWallet,
) {
  return { senderWalletId, assetId: w.ownerAsset, lookup: { kind, value } };
}
When(
  'the sender resolves the recipient by exact handle and wallet ID',
  async function (this: WalletWorld) {
    this.resolutions = [];
    for (const [kind, value] of [
      ['HANDLE', ' WALLET_BOB '],
      ['WALLET_ID', this.bobWallet!],
    ]) {
      const response = await this.ownershipHarness!.request(
        this.ownerAlice!,
        '/api/v2/peer-resolutions',
        'POST',
        resolutionBody(this, kind!, value!),
      );
      assert.equal(response.status, 201);
      this.resolutions.push((await response.json()) as RecipientResolutionView);
    }
  },
);
Then(
  'both resolutions name the same compatible recipient without private fields',
  function (this: WalletWorld) {
    for (const resolution of this.resolutions!) {
      assert.equal(resolution.recipient.userId, this.ownerBob!.id);
      assert.equal(resolution.recipient.walletId, this.bobWallet);
      assert.deepEqual(
        Object.keys(resolution.recipient).sort(),
        ['displayName', 'publicHandle', 'userId', 'walletId'].sort(),
      );
      assert.deepEqual(resolution.destination, { mode: 'SIMULATED' });
    }
  },
);
When(
  'the sender looks up unavailable and incompatible wallets',
  async function (this: WalletWorld) {
    const h = this.ownershipHarness!;
    await h.database.db
      .collection('wallets')
      .updateOne({ _id: new ObjectId(this.bobWallet) }, { $set: { status: 'SUSPENDED' } });
    this.resolutionStatuses = [];
    for (const [kind, value] of [
      ['HANDLE', 'wallet_bob'],
      ['HANDLE', 'unknown_peer'],
      ['WALLET_ID', this.aliceWallet!],
      ['CHAIN_ADDRESS', `0x${'1'.repeat(40)}`],
    ])
      this.resolutionStatuses.push(
        (
          await h.request(
            this.ownerAlice!,
            '/api/v2/peer-resolutions',
            'POST',
            resolutionBody(this, kind!, value!),
          )
        ).status,
      );
  },
);
Then(
  'each recipient lookup is unavailable with no resolution persisted',
  async function (this: WalletWorld) {
    assert.deepEqual(this.resolutionStatuses, [404, 404, 404, 404]);
    assert.equal(
      await this.ownershipHarness!.database.db.collection('recipientResolutions').countDocuments(),
      0,
    );
  },
);
When(
  'the sender resolution expires while its record remains stored',
  async function (this: WalletWorld) {
    const h = this.ownershipHarness!;
    const resolution = await h.app
      .get(WalletsService)
      .resolve(this.ownerAlice!.id, resolutionBody(this, 'HANDLE', 'wallet_bob'));
    await h.database.db
      .collection('recipientResolutions')
      .updateOne(
        { _id: new ObjectId(resolution.resolutionId) },
        { $set: { expiresAt: new Date(0) } },
      );
    assert.equal(await h.database.db.collection('recipientResolutions').countDocuments(), 1);
    try {
      await h.app
        .get(WalletsService)
        .reviewed(
          this.ownerAlice!.id,
          resolution.resolutionId,
          this.aliceWallet!,
          this.ownerAsset!,
        );
    } catch (error) {
      this.expiredError = error;
    }
  },
);
Then('the review must be renewed', function (this: WalletWorld) {
  assert.ok(this.expiredError);
  assert.equal((this.expiredError as { getStatus(): number }).getStatus(), 409);
});
When(
  'wallet resolution requests use invalid authentication CSRF or sender ownership',
  async function (this: WalletWorld) {
    const h = this.ownershipHarness!;
    const body = resolutionBody(this, 'HANDLE', 'wallet_bob');
    this.resolutionStatuses = [
      (await h.request(h.anonymous, '/api/v2/wallet')).status,
      (await h.request(this.ownerAlice!, '/api/v2/peer-resolutions', 'POST', body, { csrf: false }))
        .status,
      (
        await h.request(
          this.ownerAlice!,
          '/api/v2/peer-resolutions',
          'POST',
          resolutionBody(this, 'HANDLE', 'wallet_alice', this.bobWallet),
        )
      ).status,
    ];
  },
);
Then(
  'the wallet security requests fail without persisting resolutions',
  async function (this: WalletWorld) {
    assert.deepEqual(this.resolutionStatuses, [401, 403, 404]);
    assert.equal(
      await this.ownershipHarness!.database.db.collection('recipientResolutions').countDocuments(),
      0,
    );
  },
);
After(async function (this: WalletWorld) {
  this.ownershipCleanupStarted = true;
  await this.ownershipHarness?.close();
});
When('an auditor grant is added then revoked for the sender', async function (this: WalletWorld) {
  const h = this.ownershipHarness!;
  const roles = h.app.get(RoleAuthorization);
  const userId = new ObjectId(this.ownerAlice!.id);
  this.roleChecks = [];
  const check = async () => {
    try {
      await roles.require(userId, 'AUDITOR');
      this.roleChecks!.push(true);
    } catch {
      this.roleChecks!.push(false);
    }
  };
  await check();
  const grant = {
    _id: new ObjectId(),
    schemaVersion: 2,
    userId,
    role: 'AUDITOR',
    status: 'ACTIVE',
    revision: toLong(0n),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await h.database.db.collection('roleGrants').insertOne(grant);
  await check();
  await h.database.db
    .collection('roleGrants')
    .updateOne({ _id: grant._id }, { $set: { status: 'REVOKED' } });
  await check();
  await h.database.db
    .collection('roleGrants')
    .updateOne({ _id: grant._id }, { $set: { status: 'ACTIVE' } });
  await h.database.db
    .collection('users')
    .updateOne({ _id: userId }, { $set: { status: 'disabled' } });
  await check();
});
Then(
  'authorization permits only the active grant and rejects a disabled owner',
  function (this: WalletWorld) {
    assert.deepEqual(this.roleChecks, [false, true, false, false]);
  },
);
When(
  'the recipient binding is revoked and another wallet claims the same address',
  async function (this: WalletWorld) {
    const h = this.ownershipHarness!;
    const binding = {
      _id: new ObjectId(),
      schemaVersion: 2,
      walletId: new ObjectId(this.bobWallet),
      networkId: new ObjectId(),
      normalizedAddress: `0x${'1'.repeat(40)}`,
      status: 'VERIFIED',
      proofId: new ObjectId(),
      verifiedAt: new Date(),
      revision: toLong(0n),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await h.database.db.collection('walletBindings').insertOne(binding);
    await h.database.db
      .collection('walletBindings')
      .updateOne({ _id: binding._id }, { $set: { status: 'REVOKED' } });
    try {
      await h.database.db
        .collection('walletBindings')
        .insertOne({ ...binding, _id: new ObjectId(), walletId: new ObjectId(this.aliceWallet) });
    } catch (error) {
      this.bindingClaimError = error;
    }
    try {
      await h.database.db
        .collection('wallets')
        .updateOne({ _id: new ObjectId(this.aliceWallet) }, { $set: { status: 'INVALID' } });
    } catch (error) {
      this.walletSchemaError = error;
    }
  },
);
Then(
  'binding uniqueness rejects reassignment and malformed wallet states',
  async function (this: WalletWorld) {
    assert.equal((this.bindingClaimError as { code: number }).code, 11000);
    assert.equal((this.walletSchemaError as { code: number }).code, 121);
    assert.equal(
      await this.ownershipHarness!.database.db.collection('walletBindings').countDocuments(),
      1,
    );
  },
);
