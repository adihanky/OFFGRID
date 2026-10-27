import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { After, Given, When, Then } from '@cucumber/cucumber';
import type { RecipientResolutionView, SimulatedTransferV2View } from '@p2p/contracts';
import {
  createTransferHarness,
  type TransferHarness,
  type TransferCaller,
} from '../support/transfer-harness.mjs';
import { WalletsService } from '../../apps/api/src/modules/wallets/wallets.service.js';
import { CustodyService } from '../../apps/api/src/modules/custody/custody.service.js';
interface V2World {
  v2?: TransferHarness;
  v2CleanupStarted?: boolean;
  v2Alice?: TransferCaller;
  v2Bob?: TransferCaller;
  v2Carol?: TransferCaller;
  v2Asset?: string;
  v2Wallet?: string;
  v2Resolution?: RecipientResolutionView;
  v2Key?: string;
  v2Response?: Response;
  v2Body?: { transfer?: SimulatedTransferV2View; code?: string };
  v2Id?: string;
  v2ReviewStatuses?: number[];
}
Given(
  'an isolated funded v2 transfer fixture',
  { timeout: 120000 },
  async function (this: V2World) {
    const h = await createTransferHarness();
    if (this.v2CleanupStarted) {
      await h.close();
      throw new Error('V2 fixture completed after scenario cleanup.');
    }
    this.v2 = h;
    this.v2Alice = await h.register('v2_alice');
    this.v2Bob = await h.register('v2_bob');
    this.v2Carol = await h.register('v2_carol');
    this.v2Asset = (
      await h.accounts.createAsset({ code: 'V2DEMO', displayName: 'V2 demo', precision: 2 })
    )._id.toHexString();
    await h.issue(this.v2Alice, this.v2Asset, 1000n);
    await h.request(this.v2Bob, '/api/auth/signout', 'POST');
    this.v2Wallet = (await h.app.get(WalletsService).own(this.v2Alice.id)).id;
    this.v2Resolution = await h.app.get(WalletsService).resolve(this.v2Alice.id, {
      assetId: this.v2Asset,
      senderWalletId: this.v2Wallet,
      lookup: { kind: 'HANDLE', value: 'v2_bob' },
    });
    this.v2Key = randomUUID();
  },
);
function body(w: V2World, quantity = '3.25') {
  return {
    recipientResolutionId: w.v2Resolution!.resolutionId,
    senderWalletId: w.v2Wallet,
    assetId: w.v2Asset,
    quantity,
  };
}
async function confirm(w: V2World, caller = w.v2Alice!, quantity = '3.25') {
  w.v2Response = await w.v2!.request(caller, '/api/v2/transfers', 'POST', body(w, quantity), {
    key: w.v2Key,
  });
  w.v2Body = (await w.v2Response.json()) as V2World['v2Body'];
  w.v2Id ??= w.v2Body?.transfer?.id;
}
When('the v2 sender confirms 3.25 for the resolved recipient', async function (this: V2World) {
  await confirm(this);
});
Then(
  'the v2 transfer commits with balances 6.75 and 3.25 and valid custody',
  async function (this: V2World) {
    assert.equal(this.v2Response!.status, 201);
    assert.equal(this.v2Body!.transfer!.mode, 'SIMULATED');
    assert.equal(this.v2Body!.transfer!.payloadVersion, 2);
    assert.equal((await this.v2!.accounts.wallet(this.v2Alice!.id)).accounts[0]!.balance, '6.75');
    assert.equal((await this.v2!.accounts.wallet(this.v2Bob!.id)).accounts[0]!.balance, '3.25');
    assert.deepEqual(await this.v2!.app.get(CustodyService).verify(), { ok: true, issues: [] });
  },
);
When('the stored v2 review expires', async function (this: V2World) {
  await this.v2!.database.db.collection('recipientResolutions').updateOne(
    { _id: new ObjectId(this.v2Resolution!.resolutionId) },
    { $set: { expiresAt: new Date(0) } },
  );
});
When('the v2 sender retries the unchanged intent', async function (this: V2World) {
  await confirm(this);
});
Then(
  'the original v2 result is returned with one complete financial effect',
  async function (this: V2World) {
    const h = this.v2!;
    assert.ok([200, 201].includes(this.v2Response!.status));
    assert.equal(this.v2Body!.transfer!.id, this.v2Id);
    assert.equal(this.v2Body!.transfer!.status, 'COMMITTED');
    for (const [name, filter, count] of [
      ['transfers', { status: 'COMMITTED' }, 1],
      ['ledgerEntries', { referenceKind: 'transfer' }, 2],
      ['chainEntries', {}, 1],
      ['outboxEvents', {}, 1],
      ['custodyEvents', { kind: 'TRANSFER' }, 1],
    ] as const)
      assert.equal(await h.database.db.collection(name).countDocuments(filter), count, name);
    assert.deepEqual(await h.app.get(CustodyService).verify(), { ok: true, issues: [] });
    const own = await h.request(this.v2Alice!, `/api/v2/transfers/${this.v2Id}`);
    assert.equal(own.status, 200);
    const projection = (await own.json()) as { transfer: SimulatedTransferV2View };
    assert.equal(projection.transfer.payloadVersion, 2);
    assert.equal(projection.transfer.senderWalletId, this.v2Wallet);
    assert.equal((await h.request(this.v2Carol!, `/api/v2/transfers/${this.v2Id}`)).status, 404);
  },
);
Then('the same key through v1 conflicts', async function (this: V2World) {
  const response = await this.v2!.request(
    this.v2Alice!,
    '/api/transfers',
    'POST',
    { recipientId: this.v2Bob!.id, assetId: this.v2Asset, quantity: '3.25' },
    { key: this.v2Key },
  );
  assert.equal(response.status, 409);
});
Given('the v2 recipient wallet was suspended after review', async function (this: V2World) {
  await this.v2!.database.db.collection('wallets').updateOne(
    { userId: new ObjectId(this.v2Bob!.id) },
    { $set: { status: 'SUSPENDED' } },
  );
});
Given('the v2 asset was paused after review', async function (this: V2World) {
  await this.v2!.accounts.setAssetStatus(new ObjectId(this.v2Asset), 'disabled');
});
Then(
  'v2 returns review required with no transfer admission or effects',
  async function (this: V2World) {
    assert.equal(this.v2Response!.status, 409);
    assert.equal(this.v2Body!.code, 'REVIEW_REQUIRED');
    assert.equal(await this.v2!.database.db.collection('transfers').countDocuments(), 0);
    assert.equal(await this.v2!.database.db.collection('custodyEvents').countDocuments(), 1);
  },
);
When('another caller submits the v2 sender resolution', async function (this: V2World) {
  await confirm(this, this.v2Carol);
});
When(
  'another caller repeatedly submits the foreign v2 resolution',
  { timeout: 60000 },
  async function (this: V2World) {
    const instant = Date.now();
    this.v2!.accounts.rateNow = () => instant;
    this.v2ReviewStatuses = [];
    for (let i = 0; i < 61; i++)
      this.v2ReviewStatuses.push(
        (
          await this.v2!.request(this.v2Carol!, '/api/v2/transfers', 'POST', body(this), {
            key: this.v2Key,
          })
        ).status,
      );
  },
);
Then('v2 rejects the excess reviews without financial admission', async function (this: V2World) {
  assert.ok(this.v2ReviewStatuses!.slice(0, 60).every((s) => s === 409));
  assert.equal(this.v2ReviewStatuses![60], 429);
  assert.equal(await this.v2!.database.db.collection('transfers').countDocuments(), 0);
  assert.equal(await this.v2!.database.db.collection('custodyEvents').countDocuments(), 1);
});
When('two v2 confirmations race under the same key', async function (this: V2World) {
  const responses = await Promise.all([
    this.v2!.request(this.v2Alice!, '/api/v2/transfers', 'POST', body(this), { key: this.v2Key }),
    this.v2!.request(this.v2Alice!, '/api/v2/transfers', 'POST', body(this), { key: this.v2Key }),
  ]);
  const results = await Promise.all(
    responses.map((r) => r.json() as Promise<{ transfer: SimulatedTransferV2View }>),
  );
  assert.ok(responses.every((r) => [200, 201, 202].includes(r.status)));
  assert.equal(results[0]!.transfer.id, results[1]!.transfer.id);
  this.v2Response = responses[0];
  this.v2Body = results[0];
  this.v2Id = results[0]!.transfer.id;
  await confirm(this);
});
Given('v2 settlement fails after writing custody', function (this: V2World) {
  this.v2!.transfers.fault = async (stage) => {
    if (stage === 'custody') throw new Error('fixture rollback');
  };
});
Then(
  'the v2 request is pending with unchanged balances and custody roots',
  async function (this: V2World) {
    assert.equal(this.v2Response!.status, 202);
    assert.equal((await this.v2!.accounts.wallet(this.v2Alice!.id)).accounts[0]!.balance, '10.00');
    assert.equal((await this.v2!.accounts.wallet(this.v2Bob!.id)).accounts[0]!.balance, '0.00');
    assert.equal(await this.v2!.database.db.collection('custodyEvents').countDocuments(), 1);
    assert.equal(await this.v2!.database.db.collection('custodyEdges').countDocuments(), 0);
    assert.equal(
      await this.v2!.database.db.collection('ledgerEntries').countDocuments({
        referenceKind: 'transfer',
      }),
      0,
    );
    assert.equal(await this.v2!.database.db.collection('chainEntries').countDocuments(), 0);
  },
);
When('the v2 pending transfer is recovered', async function (this: V2World) {
  this.v2!.transfers.fault = undefined;
  await this.v2!.database.db.collection('transfers').updateOne(
    { _id: new ObjectId(this.v2Id) },
    { $set: { nextAttemptAt: new Date(0), leaseUntil: null } },
  );
  await this.v2!.transfers.recover();
  await confirm(this);
});
After(async function (this: V2World) {
  this.v2CleanupStarted = true;
  await this.v2?.close();
});
