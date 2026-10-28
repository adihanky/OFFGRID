import { NetworksService } from '../../apps/api/src/modules/networks/networks.service.js';
import assert from 'node:assert/strict';
import { After, Given, When, Then } from '@cucumber/cucumber';
import { Wallet } from 'ethers';
import { ObjectId } from 'mongodb';
import { tokenHash } from '../../apps/api/src/modules/auth/auth.crypto.js';
import type { WalletChallenge, WalletV2 } from '@p2p/contracts';
import {
  createWalletSetupHarness,
  type WalletSetupHarness,
} from '../support/wallet-setup-harness.mjs';
import type { TransferCaller } from '../support/transfer-harness.mjs';
interface SetupWorld {
  setup?: WalletSetupHarness;
  beforeWallets?: number;
  challenge?: WalletChallenge;
  proof?: { challengeId: string; signature: string };
  denied?: number[];
  claims?: number[];
  bindingId?: string;
}
async function challenge(h: WalletSetupHarness, caller: TransferCaller) {
  const response = await h.h.request(caller, '/api/v2/wallet/binding-challenges', 'POST', {
    networkId: h.network.id,
    address: h.signer.address,
  });
  assert.equal(response.status, 201);
  return (await response.json()) as WalletChallenge;
}
Given('an isolated wallet setup fixture', { timeout: 120000 }, async function (this: SetupWorld) {
  this.setup = await createWalletSetupHarness();
});
When('an ordinary user saves a wallet name and preferred asset', async function (this: SetupWorld) {
  const f = this.setup!;
  this.beforeWallets = await f.h.database.db.collection('wallets').countDocuments();
  const result = await f.h.request(f.alice, '/api/v2/wallet/settings', 'POST', {
    displayName: 'My personal wallet',
    preferredAssetId: f.asset._id.toHexString(),
    revision: '0',
  });
  assert.equal(result.status, 201);
});
Then(
  'those settings survive reload with one wallet and unchanged balances',
  async function (this: SetupWorld) {
    const f = this.setup!,
      response = await f.h.request(f.alice, '/api/v2/wallet');
    const { wallet } = (await response.json()) as { wallet: WalletV2 };
    assert.equal(wallet.displayName, 'My personal wallet');
    assert.equal(wallet.configured, true);
    assert.equal(wallet.preferredAssetId, f.asset._id.toHexString());
    assert.equal(await f.h.database.db.collection('wallets').countDocuments(), this.beforeWallets);
    assert.equal(await f.h.accounts.issuances.countDocuments(), 0);
    assert.equal(await f.h.accounts.accounts.countDocuments(), 0);
  },
);
Then(
  'stale settings, forged CSRF and administrator-only configuration are rejected',
  async function (this: SetupWorld) {
    const f = this.setup!,
      input = { displayName: 'Stale settings', preferredAssetId: null, revision: '0' };
    assert.equal(
      (await f.h.request(f.alice, '/api/v2/wallet/settings', 'POST', input)).status,
      409,
    );
    assert.equal(
      (
        await f.h.request(
          f.alice,
          '/api/v2/wallet/settings',
          'POST',
          { ...input, revision: '1' },
          { csrfValue: 'forged' },
        )
      ).status,
      403,
    );
    assert.equal((await f.h.request(f.alice, '/api/v2/admin/networks')).status, 403);
    assert.equal((await f.h.request(f.alice, '/api/v2/admin/assets')).status, 403);
  },
);
When('a user signs and verifies the server ownership challenge', async function (this: SetupWorld) {
  const f = this.setup!;
  this.challenge = await challenge(f, f.alice);
  this.proof = {
    challengeId: this.challenge.id,
    signature: await f.signer.signMessage(this.challenge.message),
  };
  const response = await f.h.request(f.alice, '/api/v2/wallet/bindings', 'POST', this.proof);
  assert.equal(response.status, 201);
  this.bindingId = ((await response.json()) as { binding: { id: string } }).binding.id;
});
Then(
  'the user has one verified binding without exposing signatures or private keys',
  async function (this: SetupWorld) {
    const f = this.setup!,
      response = await f.h.request(f.alice, '/api/v2/wallet');
    const data = (await response.json()) as { wallet: WalletV2 };
    assert.equal(data.wallet.bindings.length, 1);
    assert.equal(data.wallet.bindings[0]!.address, f.signer.address);
    assert.equal(data.wallet.bindings[0]!.status, 'VERIFIED');
    assert.ok(!JSON.stringify(data).includes(this.proof!.signature));
    assert.ok(!JSON.stringify(data).includes(f.signer.privateKey));
    assert.equal(await f.h.database.db.collection('walletProofAudits').countDocuments(), 1);
  },
);
When('the user revokes and reverifies the same address', async function (this: SetupWorld) {
  const f = this.setup!;
  assert.equal(
    (
      await f.h.request(f.alice, `/api/v2/wallet/bindings/${this.bindingId}/revoke`, 'POST', {
        revision: '0',
      })
    ).status,
    201,
  );
  const p = await challenge(f, f.alice);
  assert.equal(
    (
      await f.h.request(f.alice, '/api/v2/wallet/bindings', 'POST', {
        challengeId: p.id,
        signature: await f.signer.signMessage(p.message),
      })
    ).status,
    201,
  );
});
Then('ownership history and address uniqueness are preserved', async function (this: SetupWorld) {
  const f = this.setup!,
    binding = await f.h.database.db
      .collection('walletBindings')
      .findOne({ _id: new ObjectId(this.bindingId) });
  assert.equal(await f.h.database.db.collection('walletBindings').countDocuments(), 1);
  assert.equal(binding!['status'], 'VERIFIED');
  assert.equal(await f.h.database.db.collection('walletProofAudits').countDocuments(), 2);
  const p = await challenge(f, f.bob);
  assert.equal(
    (
      await f.h.request(f.bob, '/api/v2/wallet/bindings', 'POST', {
        challengeId: p.id,
        signature: await f.signer.signMessage(p.message),
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await f.h.request(f.alice, '/api/v2/wallet/binding-challenges', 'POST', {
        networkId: f.network.id,
        address: Wallet.createRandom().address,
      })
    ).status,
    409,
  );
});
When(
  'invalid ownership proofs are submitted',
  { timeout: 30000 },
  async function (this: SetupWorld) {
    const f = this.setup!,
      p = await challenge(f, f.alice);
    this.denied = [];
    this.denied.push(
      (
        await f.h.request(f.alice, '/api/v2/wallet/bindings', 'POST', {
          challengeId: p.id,
          signature: await Wallet.createRandom().signMessage(p.message),
        })
      ).status,
    );
    this.denied.push(
      (
        await f.h.request(f.alice, '/api/v2/wallet/bindings', 'POST', {
          challengeId: p.id,
          signature: await f.signer.signMessage(p.message.replace('Secure P2P', 'Attacker')),
        })
      ).status,
    );
    const bobProof = { challengeId: p.id, signature: await f.signer.signMessage(p.message) };
    this.denied.push(
      (await f.h.request(f.bob, '/api/v2/wallet/bindings', 'POST', bobProof)).status,
    );
    await f.h.database.db
      .collection('walletProofs')
      .updateOne({ _id: new ObjectId(p.id) }, { $set: { expiresAt: new Date(0) } });
    this.denied.push(
      (await f.h.request(f.alice, '/api/v2/wallet/bindings', 'POST', bobProof)).status,
    );
    const anotherSession = await challenge(f, f.alice);
    await f.h.database.db
      .collection('walletProofs')
      .updateOne(
        { _id: new ObjectId(anotherSession.id) },
        { $set: { sessionHash: tokenHash('controlled-other-session') } },
      );
    this.denied.push(
      (
        await f.h.request(f.alice, '/api/v2/wallet/bindings', 'POST', {
          challengeId: anotherSession.id,
          signature: await f.signer.signMessage(anotherSession.message),
        })
      ).status,
    );
  },
);
Then('no invalid external binding is persisted', async function (this: SetupWorld) {
  assert.deepEqual(this.denied, [400, 400, 400, 400, 400]);
  assert.equal(await this.setup!.h.database.db.collection('walletBindings').countDocuments(), 0);
});
When(
  'two registered wallets concurrently claim the same external address',
  async function (this: SetupWorld) {
    const f = this.setup!,
      a = await challenge(f, f.alice),
      b = await challenge(f, f.bob);
    this.claims = (
      await Promise.all([
        f.h.request(f.alice, '/api/v2/wallet/bindings', 'POST', {
          challengeId: a.id,
          signature: await f.signer.signMessage(a.message),
        }),
        f.h.request(f.bob, '/api/v2/wallet/bindings', 'POST', {
          challengeId: b.id,
          signature: await f.signer.signMessage(b.message),
        }),
      ])
    ).map((response) => response.status);
    const winner = this.claims[0] === 201 ? f.alice : f.bob,
      proof = this.claims[0] === 201 ? a : b;
    this.denied = [
      (
        await f.h.request(winner, '/api/v2/wallet/bindings', 'POST', {
          challengeId: proof.id,
          signature: await f.signer.signMessage(proof.message),
        })
      ).status,
    ];
  },
);
Then(
  'exactly one owner is verified and replay cannot claim it again',
  async function (this: SetupWorld) {
    assert.deepEqual(this.claims!.sort(), [201, 409]);
    assert.deepEqual(this.denied, [400]);
    assert.equal(await this.setup!.h.database.db.collection('walletBindings').countDocuments(), 1);
  },
);
When(
  'unsafe providers, wrong chain identity and contract wallets are requested',
  { timeout: 30000 },
  async function (this: SetupWorld) {
    const f = this.setup!,
      base = {
        displayName: 'Invalid network',
        chainId: '31337',
        environment: 'LOCAL',
        rpcUrl: f.rpcUrl,
        reason: 'Negative fixture',
      };
    this.denied = [];
    for (const input of [
      { ...base, rpcUrl: 'http://169.254.169.254/' },
      { ...base, chainId: '31338' },
    ])
      this.denied.push(
        (await f.h.request(f.admin, '/api/v2/admin/networks', 'POST', input)).status,
      );
    f.rpcState.genesisHash = `0X${'0'.repeat(64)}`;
    this.denied.push((await f.h.request(f.admin, '/api/v2/admin/networks', 'POST', base)).status);
    f.rpcState.genesisHash = `0x${'12'.repeat(32)}`;
    f.rpcState.contract = true;
    this.denied.push(
      (
        await f.h.request(f.alice, '/api/v2/wallet/binding-challenges', 'POST', {
          networkId: f.network.id,
          address: f.signer.address,
        })
      ).status,
    );
    f.rpcState.contract = false;
    const prior = await challenge(f, f.alice);
    const changed = await f.h.request(f.admin, `/api/v2/admin/networks/${f.network.id}`, 'POST', {
      displayName: 'Renamed controlled EVM',
      rpcUrl: f.rpcUrl,
      status: 'ACTIVE',
      revision: '0',
      reason: 'Reverify provider settings',
    });
    assert.equal(changed.status, 201);
    this.denied.push(
      (
        await f.h.request(f.alice, '/api/v2/wallet/bindings', 'POST', {
          challengeId: prior.id,
          signature: await f.signer.signMessage(prior.message),
        })
      ).status,
    );
    this.denied.push(
      (
        await f.h.request(f.admin, `/api/v2/admin/networks/${f.network.id}`, 'POST', {
          status: 'PAUSED',
          revision: '0',
          reason: 'Stale settings must fail',
        })
      ).status,
    );
  },
);
Then(
  'the network and wallet registry contain no invalid new records',
  async function (this: SetupWorld) {
    // Invalid provider data is unavailable (503); invalid caller input is a bad request (400).
    assert.deepEqual(this.denied, [400, 400, 503, 400, 409, 409]);
    assert.equal(await this.setup!.h.database.db.collection('networks').countDocuments(), 1);
    assert.equal(await this.setup!.h.database.db.collection('walletBindings').countDocuments(), 0);
  },
);
After({ tags: '@wallet_setup', timeout: 30000 }, async function (this: SetupWorld) {
  await this.setup?.close();
});

When(
  'an ordinary user enables the canonical Sepolia preset twice',
  async function (this: SetupWorld) {
    const f = this.setup!;
    const service = f.h.app.get(NetworksService);
    Object.defineProperty(service, 'transport', {
      value: async (_url: URL, method: string) =>
        method === 'eth_chainId'
          ? '0xaa36a7'
          : { hash: '0x25a5cc106eea7138acab33231d7160d69cb777ee0c2c553fcddf5138993e6dd9' },
    });
    for (let i = 0; i < 2; i++)
      assert.equal((await f.h.request(f.alice, '/api/v2/wallet/testnet', 'POST', {})).status, 201);
  },
);
Then(
  'exactly one active Sepolia network exists without granting administration',
  async function (this: SetupWorld) {
    const f = this.setup!;
    assert.equal(
      await f.h.database.db
        .collection('networks')
        .countDocuments({ chainId: '11155111', status: 'ACTIVE' }),
      1,
    );
    assert.equal((await f.h.request(f.alice, '/api/v2/admin/networks')).status, 403);
    assert.equal(await f.h.database.db.collection('walletBindings').countDocuments(), 0);
  },
);
Then('paused networks and arbitrary preset inputs are rejected', async function (this: SetupWorld) {
  const f = this.setup!;
  await f.h.database.db
    .collection('networks')
    .updateOne({ chainId: '11155111' }, { $set: { status: 'PAUSED' } });
  assert.equal((await f.h.request(f.alice, '/api/v2/wallet/testnet', 'POST', {})).status, 409);
  assert.equal(
    (await f.h.request(f.alice, '/api/v2/wallet/testnet', 'POST', { rpcUrl: 'http://127.0.0.1/' }))
      .status,
    400,
  );
  assert.equal(
    (await f.h.request(f.alice, '/api/v2/wallet/testnet', 'POST', {}, { csrfValue: 'forged' }))
      .status,
    403,
  );
});
Then(
  'the linked owner sees the exact native balance while other users cannot',
  async function (this: SetupWorld) {
    const f = this.setup!;
    const wallet = (
      (await (await f.h.request(f.alice, '/api/v2/wallet')).json()) as { wallet: WalletV2 }
    ).wallet;
    const id = wallet.bindings[0]!.id;
    const response = await f.h.request(f.alice, `/api/v2/wallet/bindings/${id}/balance`);
    assert.equal(response.status, 200);
    assert.equal(
      ((await response.json()) as { balanceWei: string }).balanceWei,
      '1000000000000000001',
    );
    assert.equal((await f.h.request(f.bob, `/api/v2/wallet/bindings/${id}/balance`)).status, 404);
    assert.equal(await f.h.accounts.issuances.countDocuments(), 0);
    f.rpcState.balance = 'invalid';
    assert.equal((await f.h.request(f.alice, `/api/v2/wallet/bindings/${id}/balance`)).status, 503);
  },
);
