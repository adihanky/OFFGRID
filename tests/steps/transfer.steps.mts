import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { After, Before, Given, Then, When, type World } from '@cucumber/cucumber';
import { Long, MongoServerError, ObjectId } from 'mongodb';
import type { TransferView, WalletResponse, PeerResponse } from '@p2p/contracts';
import { tokenHash } from '../../apps/api/src/modules/auth/auth.crypto.js';
import { IdentityEligibility } from '../../apps/api/src/modules/auth/identity-eligibility.service.js';
import { LedgerService } from '../../apps/api/src/modules/ledger/ledger.service.js';
import { ChainService } from '../../apps/api/src/modules/chain/chain.service.js';
import { CustodyService } from '../../apps/api/src/modules/custody/custody.service.js';
import { assertDemoTarget } from '../../apps/api/src/modules/accounts/demo-target.js';
import {
  createTransferHarness,
  type TransferHarness,
  type TransferCaller,
} from '../support/transfer-harness.mjs';

interface TransferWorld extends World {
  harness: TransferHarness;
  callers: Record<string, TransferCaller>;
  assetId: string;
  response: Response;
  body: unknown;
  originalId?: string;
  lastId?: string;
  key: string;
  requestBody: { recipientId: string; assetId: string; quantity: string };
  results: { status: number; body: unknown }[];
  operationError?: unknown;
  reconciliation?: { ok: boolean; issues: string[] };
  stale?: NonNullable<Awaited<ReturnType<TransferHarness['transfers']['claim']>>>;
  restoreDriver?: () => void;
  commits?: number;
}
const oid = (value: string) => new ObjectId(value);
const transfer = (world: TransferWorld) => (world.body as { transfer: TransferView }).transfer;
const db = (world: TransferWorld) => world.harness.database.db;
const collection = (world: TransferWorld, name: string) =>
  db(world).collection(name, { promoteLongs: false });
function caller(world: TransferWorld, name: string) {
  assert.ok(world.callers[name]);
  return world.callers[name]!;
}
async function remember(world: TransferWorld, response: Response) {
  world.response = response;
  world.body = response.headers.get('content-type')?.includes('application/json')
    ? await response.json()
    : await response.text();
  const result = (world.body as { transfer?: TransferView }).transfer;
  if (result) {
    world.lastId = result.id;
    world.originalId ??= result.id;
  }
}
async function balance(world: TransferWorld, name: string) {
  const account = await collection(world, 'accounts').findOne({
    userId: oid(caller(world, name).id),
    assetId: oid(world.assetId),
    ownerType: 'user',
  });
  return account ? BigInt(String(account.balanceUnits)) : 0n;
}
async function submit(
  world: TransferWorld,
  name: string,
  quantity: string,
  recipient = 'Bob',
  key: string = randomUUID(),
) {
  world.key = key;
  world.requestBody = {
    recipientId: caller(world, recipient).id,
    assetId: world.assetId,
    quantity,
  };
  await remember(
    world,
    await world.harness.request(caller(world, name), '/api/transfers', 'POST', world.requestBody, {
      key,
    }),
  );
}
async function noEffects(world: TransferWorld) {
  assert.equal(
    await collection(world, 'ledgerEntries').countDocuments({ referenceKind: 'transfer' }),
    0,
  );
  assert.equal(await collection(world, 'chainEntries').countDocuments(), 0);
  assert.equal(await collection(world, 'outboxEvents').countDocuments(), 0);
  assert.equal(await collection(world, 'transfers').countDocuments({ status: 'COMMITTED' }), 0);
  assert.equal(await collection(world, 'custodyEvents').countDocuments({ kind: 'TRANSFER' }), 0);
  assert.equal(await collection(world, 'custodyEdges').countDocuments(), 0);
  assert.equal(await collection(world, 'custodyLots').countDocuments({ status: 'SPENT' }), 0);
  for (const head of await collection(world, 'chainHeads').find({}).toArray()) {
    assert.equal(String(head.latestSequence), '0');
    assert.equal(head.latestHash, '0'.repeat(64));
  }
}
async function makeDue(world: TransferWorld) {
  await collection(world, 'transfers').updateMany(
    { status: 'PENDING' },
    {
      $set: { leaseUntil: new Date(0), nextAttemptAt: new Date(0) },
    },
  );
}

Before({ tags: '@wallet or @transfer', timeout: 60000 }, async function (this: TransferWorld) {
  this.harness = await createTransferHarness();
  this.callers = {};
  this.results = [];
});
After({ tags: '@wallet or @transfer', timeout: 15000 }, async function (this: TransferWorld) {
  this.restoreDriver?.();
  await this.harness?.close();
});
Given(
  'isolated transfer peers and a precision-2 asset',
  { timeout: 20000 },
  async function (this: TransferWorld) {
    for (const name of ['Alice', 'Bob', 'Carol'])
      this.callers[name] = await this.harness.register(name.toLowerCase());
    const asset = await this.harness.accounts.createAsset({
      code: 'DEMO',
      displayName: 'Demo credits',
      precision: 2,
    });
    this.assetId = asset._id.toHexString();
  },
);
Given(
  /^(Alice|Bob|Carol) has "([0-9]+)" base units$/,
  async function (this: TransferWorld, name: string, value: string) {
    await this.harness.issue(caller(this, name), this.assetId, BigInt(value));
  },
);
When('Alice reads the wallet', async function (this: TransferWorld) {
  await remember(this, await this.harness.request(caller(this, 'Alice'), '/api/accounts'));
});
When('Alice reads wallet path {string}', async function (this: TransferWorld, path: string) {
  await remember(this, await this.harness.request(caller(this, 'Alice'), path));
});
Then('the wallet balance is {string}', function (this: TransferWorld, value: string) {
  assert.equal(this.response.status, 200);
  assert.equal(this.response.headers.get('cache-control'), 'no-store');
  const rows = (this.body as WalletResponse).accounts;
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.balance, value);
  assert.deepEqual(Object.keys(rows[0]!).sort(), [
    'assetId',
    'balance',
    'code',
    'displayName',
    'precision',
    'status',
  ]);
});
Then(
  'there are {int} stored accounts and {int} ledger entries',
  async function (this: TransferWorld, accounts: number, entries: number) {
    assert.equal(await collection(this, 'accounts').countDocuments(), accounts);
    assert.equal(await collection(this, 'ledgerEntries').countDocuments(), entries);
  },
);
Given('the isolated asset catalogue is empty', async function (this: TransferWorld) {
  await collection(this, 'assetTypes').deleteMany({});
  await collection(this, 'chainHeads').deleteMany({});
});
Then('the accounts list is empty', function (this: TransferWorld) {
  assert.deepEqual(this.body, { accounts: [] });
});
When('Alice looks up handle {string}', async function (this: TransferWorld, handle: string) {
  await remember(
    this,
    await this.harness.request(
      caller(this, 'Alice'),
      `/api/peers?handle=${encodeURIComponent(handle)}`,
    ),
  );
});
Then("only Bob's public peer identity is returned", function (this: TransferWorld) {
  assert.equal(this.response.status, 200);
  const peer = (this.body as PeerResponse).peer;
  assert.deepEqual(Object.keys(peer).sort(), ['displayName', 'id', 'publicHandle']);
  assert.equal(peer.id, caller(this, 'Bob').id);
  assert.equal(peer.publicHandle, 'bob');
});
Given("Bob's identity is {string}", async function (this: TransferWorld, state: string) {
  assert.ok(state === 'active' || state === 'disabled');
  await this.harness.app.get(IdentityEligibility).setStatus(oid(caller(this, 'Bob').id), state);
});
Given("Alice's transfer session is {string}", async function (this: TransferWorld, state: string) {
  const alice = caller(this, 'Alice');
  if (state === 'anonymous') alice.jar.clear();
  else if (state === 'disabled')
    await this.harness.app.get(IdentityEligibility).setStatus(oid(alice.id), 'disabled');
  else {
    const token = alice.jar.get('p2p_session');
    assert.ok(token);
    assert.ok(state === 'expired' || state === 'revoked');
    await collection(this, 'sessions').updateOne(
      { tokenHash: tokenHash(token) },
      {
        $set: state === 'expired' ? { expiresAt: new Date(0) } : { revokedAt: new Date() },
      },
    );
  }
});
When('Alice requests protected wallet routes', async function (this: TransferWorld) {
  for (const path of [
    '/api/accounts',
    '/api/peers?handle=bob',
    `/api/transfers/${new ObjectId()}`,
  ]) {
    const response = await this.harness.request(caller(this, 'Alice'), path);
    this.results.push({ status: response.status, body: await response.json() });
  }
  const response = await this.harness.request(
    caller(this, 'Alice'),
    '/api/transfers',
    'POST',
    {
      recipientId: caller(this, 'Bob').id,
      assetId: this.assetId,
      quantity: '1.00',
    },
    { key: randomUUID() },
  );
  this.results.push({ status: response.status, body: await response.json() });
});
Then('every protected response is unauthorized', function (this: TransferWorld) {
  assert.equal(this.results.length, 4);
  for (const result of this.results) assert.equal(result.status, 401);
});
Then('the transfer HTTP status is {int}', function (this: TransferWorld, status: number) {
  assert.equal(this.response.status, status, JSON.stringify(this.body));
});
When('the same Alice issuance is repeated', async function (this: TransferWorld) {
  await this.harness.issue(caller(this, 'Alice'), this.assetId, 1000n);
});
When(
  'the Alice issuance key is reused with {string} units',
  async function (this: TransferWorld, value: string) {
    try {
      await this.harness.issue(caller(this, 'Alice'), this.assetId, BigInt(value));
    } catch (error) {
      this.operationError = error;
    }
  },
);
Then('the operation fails', function (this: TransferWorld) {
  assert.ok(this.operationError instanceof Error);
});
Then(
  'there is one balanced demo issuance of {string} units',
  async function (this: TransferWorld, value: string) {
    const issuances = await collection(this, 'demoIssuances').find({}).toArray();
    assert.equal(issuances.length, 1);
    const pair = await collection(this, 'ledgerEntries')
      .find({ referenceKind: 'demoIssuance', referenceId: issuances[0]!._id })
      .toArray();
    assert.equal(pair.length, 2);
    assert.deepEqual(pair.map((entry) => entry.side).sort(), ['credit', 'debit']);
    for (const entry of pair) assert.equal(String(entry.quantityUnits), value);
    assert.equal(await balance(this, 'Alice'), BigInt(value));
    const system = await collection(this, 'accounts').findOne({ ownerType: 'system' });
    assert.equal(String(system!.balanceUnits), `-${value}`);
  },
);
Then('ledger reconciliation is clean', async function (this: TransferWorld) {
  const result = await this.harness.app.get(LedgerService).reconcile();
  assert.deepEqual(result, { ok: true, issues: [] });
});
Given(
  "Alice's stored balance is corrupted to {string}",
  async function (this: TransferWorld, value: string) {
    await collection(this, 'accounts').updateOne(
      { userId: oid(caller(this, 'Alice').id), assetId: oid(this.assetId) },
      { $set: { balanceUnits: Long.fromString(value) } },
    );
  },
);
When('ledger reconciliation runs', async function (this: TransferWorld) {
  this.reconciliation = await this.harness.app.get(LedgerService).reconcile();
});
Then('ledger reconciliation reports a mismatch', function (this: TransferWorld) {
  assert.equal(this.reconciliation!.ok, false);
  assert.ok(this.reconciliation!.issues.some((issue) => /mismatch/i.test(issue)));
});
Then(
  'account validators and unique indexes enforce ownership and exact integers',
  async function (this: TransferWorld) {
    const accounts = collection(this, 'accounts');
    const account = await accounts.findOne({ userId: oid(caller(this, 'Alice').id) });
    assert.ok(account);
    assert.ok(Long.isLong(account.balanceUnits));
    await assert.rejects(accounts.insertOne({ ...account, _id: new ObjectId() }), { code: 11000 });
    await assert.rejects(
      accounts.updateOne({ _id: account._id }, { $set: { balanceUnits: 1.5 } }),
      { code: 121 },
    );
    await assert.rejects(
      accounts.updateOne({ _id: account._id }, { $set: { balanceUnits: Long.fromInt(-1) } }),
      { code: 121 },
    );
    await assert.rejects(
      accounts.updateOne({ _id: account._id }, { $set: { systemKey: 'forbidden-mixed-owner' } }),
      { code: 121 },
    );
    assert.equal(await balance(this, 'Alice'), 1000n);
  },
);
When('Alice transfers {string} to Bob', async function (this: TransferWorld, quantity: string) {
  await submit(this, 'Alice', quantity);
});
Then('the transfer is {string}', function (this: TransferWorld, status: string) {
  assert.equal(transfer(this).status, status, JSON.stringify(this.body));
});
Then('the rejection reason is {string}', function (this: TransferWorld, reason: string) {
  assert.equal(transfer(this).status, 'REJECTED');
  assert.equal(transfer(this).rejectionCode, reason);
});
Then(
  'Alice has {string} and Bob has {string} stored units',
  async function (this: TransferWorld, alice: string, bob: string) {
    assert.equal(await balance(this, 'Alice'), BigInt(alice));
    assert.equal(await balance(this, 'Bob'), BigInt(bob));
  },
);
Then(
  /^(Alice|Bob|Carol) has "([0-9]+)" stored units$/,
  async function (this: TransferWorld, name: string, value: string) {
    assert.equal(await balance(this, name), BigInt(value));
  },
);
Then('no settlement effects exist', async function (this: TransferWorld) {
  await noEffects(this);
});
Then('no transfer requests or settlement effects exist', async function (this: TransferWorld) {
  await noEffects(this);
  assert.equal(await collection(this, 'transfers').countDocuments(), 0);
});
Then('exactly {int} transfer requests exist', async function (this: TransferWorld, count: number) {
  assert.equal(await collection(this, 'transfers').countDocuments(), count);
});
Then(
  'exactly {int} complete transfer effects exist',
  async function (this: TransferWorld, count: number) {
    const rows = await collection(this, 'transfers').find({ status: 'COMMITTED' }).toArray();
    assert.equal(rows.length, count);
    assert.equal(
      await collection(this, 'ledgerEntries').countDocuments({ referenceKind: 'transfer' }),
      2 * count,
    );
    assert.equal(await collection(this, 'chainEntries').countDocuments(), count);
    assert.equal(await collection(this, 'outboxEvents').countDocuments(), count);
    assert.equal(
      await collection(this, 'custodyEvents').countDocuments({ kind: 'TRANSFER' }),
      count,
    );
    assert.deepEqual(await this.harness.app.get(CustodyService).verify(), { ok: true, issues: [] });
    for (const row of rows) {
      const pair = await collection(this, 'ledgerEntries')
        .find({ referenceKind: 'transfer', referenceId: row._id })
        .toArray();
      assert.deepEqual(pair.map((entry) => entry.side).sort(), ['credit', 'debit']);
      for (const entry of pair) {
        assert.equal(String(entry.quantityUnits), String(row.quantityUnits));
        assert.equal(String(entry.assetId), String(row.assetId));
      }
      assert.equal(
        String(pair.find((entry) => entry.side === 'debit')!.accountId),
        String(row.senderAccountId),
      );
      assert.equal(
        String(pair.find((entry) => entry.side === 'credit')!.accountId),
        String(row.recipientAccountId),
      );
      const chain = await collection(this, 'chainEntries').findOne({ transferId: row._id });
      assert.ok(chain);
      const event = await collection(this, 'outboxEvents').findOne({ aggregateId: row._id });
      assert.ok(event);
      assert.equal(event.deliveredAt, null);
      assert.equal(event.eventId, `transfer:${row._id}:committed`);
    }
  },
);
Then('the response contains no private transfer metadata', function (this: TransferWorld) {
  const serialized = JSON.stringify(this.body);
  for (const field of [
    'normalizedEmail',
    'email',
    'passwordHash',
    'tokenHash',
    'payloadHash',
    'idempotencyKey',
    'attemptToken',
    'leaseUntil',
    'systemKey',
    'stack',
  ])
    assert.equal(serialized.includes(`"${field}"`), false, field);
});
When(
  /^(Alice|Bob|Carol) reads the last transfer$/,
  async function (this: TransferWorld, name: string) {
    assert.ok(this.lastId);
    await remember(
      this,
      await this.harness.request(caller(this, name), `/api/transfers/${this.lastId}`),
    );
  },
);
When(
  'Alice submits a transfer with {string}',
  async function (this: TransferWorld, problem: string) {
    const body: Record<string, unknown> = {
      recipientId: caller(this, 'Bob').id,
      assetId: this.assetId,
      quantity: '1.00',
    };
    const options: { key?: string; csrf?: boolean; csrfValue?: string; origin?: string } = {
      key: randomUUID(),
    };
    const quantityCases: Record<string, unknown> = {
      zero: '0',
      negative: '-1',
      exponent: '1e2',
      'numeric quantity': 1,
      whitespace: ' 1',
      'excess precision': '1.000',
      'oversized quantity': '1'.repeat(31),
      'overflow quantity': '92233720368547758.08',
    };
    if (problem in quantityCases) body.quantity = quantityCases[problem];
    else if (problem === 'unknown field') body.unexpected = true;
    else if (problem === 'sender injection') body.senderId = caller(this, 'Carol').id;
    else if (problem === 'malformed recipient') body.recipientId = { $ne: null };
    else if (problem === 'unsupported asset') body.assetId = new ObjectId().toHexString();
    else if (problem === 'self transfer') body.recipientId = caller(this, 'Alice').id;
    else if (problem === 'missing key') delete options.key;
    else if (problem === 'malformed key') options.key = 'not-a-uuid';
    else if (problem === 'missing csrf') options.csrf = false;
    else if (problem === 'another session csrf') options.csrfValue = caller(this, 'Bob').csrf;
    else if (problem === 'foreign origin') options.origin = 'https://attacker.invalid';
    else assert.fail(`Unknown request problem: ${problem}`);
    await remember(
      this,
      await this.harness.request(caller(this, 'Alice'), '/api/transfers', 'POST', body, options),
    );
  },
);
Given(
  'the transfer eligibility problem is {string}',
  async function (this: TransferWorld, problem: string) {
    if (problem === 'disabled recipient')
      await this.harness.app
        .get(IdentityEligibility)
        .setStatus(oid(caller(this, 'Bob').id), 'disabled');
    else if (problem === 'missing recipient')
      await collection(this, 'users').deleteOne({ _id: oid(caller(this, 'Bob').id) });
    else if (problem === 'disabled asset')
      await this.harness.accounts.setAssetStatus(oid(this.assetId), 'disabled');
    else {
      const name = problem === 'disabled sender account' ? 'Alice' : 'Bob';
      if (name === 'Bob') await this.harness.issue(caller(this, name), this.assetId, 1n);
      await collection(this, 'accounts').updateOne(
        { userId: oid(caller(this, name).id), assetId: oid(this.assetId) },
        { $set: { status: 'disabled' } },
      );
    }
  },
);
Given("Bob's application wallet is suspended", async function (this: TransferWorld) {
  await collection(this, 'wallets').updateOne(
    { userId: oid(caller(this, 'Bob').id) },
    { $set: { status: 'SUSPENDED' }, $inc: { eligibilityRevision: Long.fromNumber(1) } },
  );
});
Given(
  "Bob's stored balance is set to {string}",
  async function (this: TransferWorld, value: string) {
    await this.harness.issue(caller(this, 'Bob'), this.assetId, 1n);
    await collection(this, 'accounts').updateOne(
      { userId: oid(caller(this, 'Bob').id), assetId: oid(this.assetId) },
      { $set: { balanceUnits: Long.fromString(value) } },
    );
  },
);
When(
  'Alice replays the last request with quantity {string}',
  async function (this: TransferWorld, quantity: string) {
    this.requestBody.quantity = quantity;
    await remember(
      this,
      await this.harness.request(
        caller(this, 'Alice'),
        '/api/transfers',
        'POST',
        this.requestBody,
        { key: this.key },
      ),
    );
  },
);
Then('the original transfer identity is returned', function (this: TransferWorld) {
  assert.ok(this.originalId);
  assert.equal(transfer(this).id, this.originalId);
});
When(
  'Alice concurrently sends {string} to Bob and Carol',
  async function (this: TransferWorld, quantity: string) {
    this.results = await Promise.all(
      ['Bob', 'Carol'].map(async (name) => {
        const response = await this.harness.request(
          caller(this, 'Alice'),
          '/api/transfers',
          'POST',
          { recipientId: caller(this, name).id, assetId: this.assetId, quantity },
          { key: randomUUID() },
        );
        return { status: response.status, body: await response.json() };
      }),
    );
  },
);
Then(
  'one transfer commits and one rejects for insufficient balance',
  function (this: TransferWorld) {
    assert.deepEqual(this.results.map((result) => result.status).sort(), [201, 422]);
    const rows = this.results.map((result) => (result.body as { transfer: TransferView }).transfer);
    assert.equal(
      rows.find((row) => row.status === 'REJECTED')!.rejectionCode,
      'INSUFFICIENT_BALANCE',
    );
  },
);
Then(
  'Bob and Carol together have {string} stored units',
  async function (this: TransferWorld, value: string) {
    assert.equal((await balance(this, 'Bob')) + (await balance(this, 'Carol')), BigInt(value));
  },
);
When(
  'Alice and Carol concurrently send {string} to Bob',
  async function (this: TransferWorld, quantity: string) {
    const responses = await Promise.all(
      ['Alice', 'Carol'].map((name) =>
        this.harness.request(
          caller(this, name),
          '/api/transfers',
          'POST',
          { recipientId: caller(this, 'Bob').id, assetId: this.assetId, quantity },
          { key: randomUUID() },
        ),
      ),
    );
    for (const response of responses) {
      assert.equal(response.status, 201, await response.text());
    }
  },
);
Then(
  'Bob has {string} stored units in one account',
  async function (this: TransferWorld, value: string) {
    assert.equal(await balance(this, 'Bob'), BigInt(value));
    assert.equal(
      await collection(this, 'accounts').countDocuments({
        userId: oid(caller(this, 'Bob').id),
        assetId: oid(this.assetId),
      }),
      1,
    );
  },
);
When('Alice concurrently submits the same request twice', async function (this: TransferWorld) {
  this.key = randomUUID();
  this.requestBody = {
    recipientId: caller(this, 'Bob').id,
    assetId: this.assetId,
    quantity: '1.00',
  };
  this.results = await Promise.all(
    [1, 2].map(async () => {
      const response = await this.harness.request(
        caller(this, 'Alice'),
        '/api/transfers',
        'POST',
        this.requestBody,
        { key: this.key },
      );
      return { status: response.status, body: await response.json() };
    }),
  );
});
Then('both submissions refer to the same transfer', async function (this: TransferWorld) {
  const rows = this.results.map((result) => (result.body as { transfer: TransferView }).transfer);
  for (const result of this.results)
    assert.ok([200, 201, 202].includes(result.status), JSON.stringify(result));
  assert.equal(rows[0]!.id, rows[1]!.id);
  assert.equal(await collection(this, 'transfers').countDocuments(), 1);
});
When(
  'Alice reuses the request key changing {string}',
  async function (this: TransferWorld, field: string) {
    const body = { ...this.requestBody };
    if (field === 'quantity') body.quantity = '2.00';
    else if (field === 'recipient') body.recipientId = caller(this, 'Carol').id;
    else if (field === 'unsupported asset') body.assetId = new ObjectId().toHexString();
    else {
      assert.equal(field, 'asset');
      const asset = await this.harness.accounts.createAsset({
        code: 'OTHER',
        displayName: 'Other credits',
        precision: 2,
      });
      body.assetId = asset._id.toHexString();
    }
    await remember(
      this,
      await this.harness.request(caller(this, 'Alice'), '/api/transfers', 'POST', body, {
        key: this.key,
      }),
    );
  },
);
When('Carol submits the same key to Bob', async function (this: TransferWorld) {
  await submit(this, 'Carol', '1.00', 'Bob', this.key);
});
When('the asset is disabled', async function (this: TransferWorld) {
  await this.harness.accounts.setAssetStatus(oid(this.assetId), 'disabled');
});
When('Carol compares unknown and unrelated transfer details', async function (this: TransferWorld) {
  for (const id of [this.lastId!, new ObjectId().toHexString()]) {
    const response = await this.harness.request(caller(this, 'Carol'), `/api/transfers/${id}`);
    this.results.push({ status: response.status, body: await response.json() });
  }
});
Then('both missing detail responses are identical', function (this: TransferWorld) {
  assert.equal(this.results[0]!.status, 404);
  assert.deepEqual(this.results[0], this.results[1]);
});
Given(
  'a precision-{int} boundary asset with {string} Alice units',
  async function (this: TransferWorld, precision: number, value: string) {
    const asset = await this.harness.accounts.createAsset({
      code: 'BOUNDARY',
      displayName: 'Boundary units',
      precision,
    });
    this.assetId = asset._id.toHexString();
    await this.harness.issue(caller(this, 'Alice'), this.assetId, BigInt(value));
  },
);
Then('the transfer chain is valid', async function (this: TransferWorld) {
  const result = await this.harness.app.get(ChainService).verify(oid(this.assetId));
  assert.deepEqual(result, { ok: true, issues: [] });
});
When(
  'the transfer chain is corrupted at {string}',
  async function (this: TransferWorld, part: string) {
    if (part === 'missing') await collection(this, 'chainEntries').deleteMany({});
    else if (part === 'head')
      await collection(this, 'chainHeads').updateOne(
        { assetId: oid(this.assetId) },
        { $set: { latestHash: 'f'.repeat(64) } },
      );
    else if (part === 'journal')
      await collection(this, 'ledgerEntries').deleteOne({
        referenceKind: 'transfer',
        side: 'credit',
      });
    else
      await collection(this, 'chainEntries').updateOne(
        {},
        {
          $set:
            part === 'payload' ? { canonicalPayload: 'corrupt' } : { entryHash: 'f'.repeat(64) },
        },
      );
  },
);
Then('the transfer chain reports corruption', async function (this: TransferWorld) {
  const result = await this.harness.app.get(ChainService).verify(oid(this.assetId));
  assert.equal(result.ok, false);
  assert.ok(result.issues.length > 0);
});
Given('execution fails after {string}', function (this: TransferWorld, target: string) {
  this.harness.transfers.fault = async (stage) => {
    if (stage === target) throw new Error('Synthetic isolated executor failure');
  };
});
When('transfer recovery is allowed to run', async function (this: TransferWorld) {
  this.harness.transfers.fault = undefined;
  await makeDue(this);
  await this.harness.transfers.recover();
});
When('Alice signs out after admission', async function (this: TransferWorld) {
  const response = await this.harness.request(
    caller(this, 'Alice'),
    '/api/auth/signout',
    'POST',
    {},
  );
  assert.equal(response.status, 204);
  const check = await this.harness.request(caller(this, 'Alice'), `/api/transfers/${this.lastId}`);
  assert.equal(check.status, 401);
  await check.body?.cancel();
});
When(
  'the application restarts with the same isolated database',
  { timeout: 20000 },
  async function (this: TransferWorld) {
    await this.harness.restart();
  },
);
When('recovery retries while the failure remains', async function (this: TransferWorld) {
  await makeDue(this);
  await this.harness.transfers.recover();
});
Then(
  'the stored transfer remains pending with a future retry',
  async function (this: TransferWorld) {
    const row = await collection(this, 'transfers').findOne({});
    assert.ok(row);
    assert.equal(row.status, 'PENDING');
    assert.ok(row.nextAttemptAt > new Date());
    assert.ok(row.attempts >= 2);
    assert.equal(row.rejectionCode, null);
  },
);
Given('a pending transfer with an expired execution claim', async function (this: TransferWorld) {
  this.harness.transfers.fault = async (stage) => {
    if (stage === 'claimed') throw new Error('Synthetic interruption');
  };
  await submit(this, 'Alice', '1.00');
  this.harness.transfers.fault = undefined;
  await makeDue(this);
  this.stale = (await this.harness.transfers.claim(oid(this.lastId!)))!;
  assert.ok(this.stale);
  await makeDue(this);
});
When('a new executor takes over and commits', async function (this: TransferWorld) {
  await this.harness.transfers.execute(oid(this.lastId!));
});
When('the stale executor tries rejection and execution', async function (this: TransferWorld) {
  assert.ok(this.stale);
  await this.harness.transfers.rejectClaim(this.stale, 'INSUFFICIENT_BALANCE');
  await this.harness.transfers.executeClaim(this.stale);
});
Then('the stored transfer is committed', async function (this: TransferWorld) {
  assert.equal(
    (await collection(this, 'transfers').findOne({ _id: oid(this.lastId!) }))!.status,
    'COMMITTED',
  );
});
When('two recovery runners resume the pending transfer', async function (this: TransferWorld) {
  this.harness.transfers.fault = undefined;
  await makeDue(this);
  await Promise.all([
    this.harness.transfers.recover(),
    this.harness.transfers.recover(),
    this.harness.transfers.execute(oid(this.lastId!)),
  ]);
});
Given('Bob is disabled at the claimed execution boundary', function (this: TransferWorld) {
  this.harness.transfers.fault = async (stage) => {
    if (stage === 'claimed')
      await this.harness.app
        .get(IdentityEligibility)
        .setStatus(oid(caller(this, 'Bob').id), 'disabled');
  };
});
When("Alice's transfer admission allowance is exhausted", async function (this: TransferWorld) {
  const bucket = Math.floor(Date.now() / 60000);
  const limits = db(this).collection<{ _id: string; hits: number; expiresAt: Date }>(
    'transferRateLimits',
  );
  for (const minute of [bucket, bucket + 1]) {
    const _id = createHash('sha256')
      .update(`${caller(this, 'Alice').id}:submit:${minute}`)
      .digest('hex');
    await limits.updateOne(
      { _id },
      { $set: { hits: 60, expiresAt: new Date((minute + 2) * 60000) } },
      { upsert: true },
    );
  }
});
When(
  'Alice submits a fresh transfer without replacing the original intent',
  async function (this: TransferWorld) {
    await remember(
      this,
      await this.harness.request(
        caller(this, 'Alice'),
        '/api/transfers',
        'POST',
        this.requestBody,
        { key: randomUUID() },
      ),
    );
  },
);
Given(
  'the MongoDB commit acknowledgement is lost once after server commit',
  function (this: TransferWorld) {
    const client = this.harness.database.client;
    const original = client.startSession;
    this.commits = 0;
    let thrown = false;
    client.startSession = (options) => {
      const session = original.call(client, options);
      const commit = session.commitTransaction.bind(session);
      session.commitTransaction = async (options) => {
        this.commits!++;
        await commit(options);
        if (!thrown) {
          thrown = true;
          throw new MongoServerError({
            message: 'Synthetic lost commit acknowledgement',
            code: 91,
            errorLabels: ['UnknownTransactionCommitResult'],
          });
        }
      };
      return session;
    };
    this.restoreDriver = () => {
      client.startSession = original;
    };
  },
);
Then('the driver retried the same transaction commit', function (this: TransferWorld) {
  assert.ok(this.commits! >= 2);
  this.restoreDriver?.();
  this.restoreDriver = undefined;
});
When('a demo fixture is requested for {string}', function (this: TransferWorld, target: string) {
  const environment = { ...this.harness.environment };
  if (target === 'production') environment.NODE_ENV = 'production';
  else if (target === 'remote')
    environment.MONGODB_URI = 'mongodb://example.invalid:27017/?replicaSet=rs0';
  else {
    assert.equal(target, 'unapproved name');
    environment.MONGODB_DB = 'unapproved_database';
  }
  try {
    assertDemoTarget(environment);
  } catch (error) {
    this.operationError = error;
  }
});
When('one more issuance unit is requested', async function (this: TransferWorld) {
  try {
    await this.harness.issue(caller(this, 'Carol'), this.assetId, 1n);
  } catch (error) {
    this.operationError = error;
  }
});
Then('the issuance system remains at its signed minimum', async function (this: TransferWorld) {
  const system = await collection(this, 'accounts').findOne({
    ownerType: 'system',
    assetId: oid(this.assetId),
  });
  assert.equal(String(system!.balanceUnits), '-9223372036854775808');
  assert.equal(await collection(this, 'demoIssuances').countDocuments(), 2);
  assert.equal(await collection(this, 'ledgerEntries').countDocuments(), 4);
  assert.equal(await balance(this, 'Carol'), 0n);
});
When('a journal uses the same debit and credit account', async function (this: TransferWorld) {
  const accountId = new ObjectId();
  const session = this.harness.database.client.startSession();
  try {
    await session.withTransaction(async () => {
      await this.harness.app.get(LedgerService).pair(
        {
          referenceKind: 'demoIssuance',
          referenceId: new ObjectId(),
          debitAccountId: accountId,
          creditAccountId: accountId,
          assetId: oid(this.assetId),
          quantityUnits: 1n,
          createdAt: new Date(),
        },
        session,
      );
    });
  } catch (error) {
    this.operationError = error;
  } finally {
    await session.endSession();
  }
});
Given('the issuance journal is removed', async function (this: TransferWorld) {
  await collection(this, 'ledgerEntries').deleteMany({ referenceKind: 'demoIssuance' });
});
