import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { After, Given, When, Then } from '@cucumber/cucumber';
import type { ConsumerRequestView } from '@p2p/contracts';
import {
  createEnhancementHarness,
  type EnhancementHarness,
} from '../support/enhancement-harness.mjs';
import { RequestsService } from '../../apps/api/src/modules/requests/requests.service.js';
import { ObjectId } from 'mongodb';
interface RequestWorld {
  requestFixture?: EnhancementHarness;
  requestRecords?: ConsumerRequestView[];
  requestCommand?: { decision: string; reason: string; revision: string; commandId: string };
  requestKey?: string;
}
When('the funded consumer wallet is suspended', async function (this: RequestWorld) {
  const f = this.requestFixture!;
  const changed = await f.h.database.db
    .collection('wallets')
    .updateOne({ userId: new ObjectId(f.alice.id) }, { $set: { status: 'SUSPENDED' } });
  assert.equal(changed.modifiedCount, 1);
});
Then(
  'the workspace offers Help and explains operator attention',
  async function (this: RequestWorld) {
    const f = this.requestFixture!;
    const response = await f.h.request(f.alice, '/api/v2/workspace');
    assert.equal(response.status, 200);
    const overview = (await response.json()) as {
      nextAction: string;
      capabilities: { send: { enabled: boolean; reason: string } };
    };
    assert.equal(overview.nextAction, 'HELP');
    assert.equal(overview.capabilities.send.enabled, false);
    assert.match(overview.capabilities.send.reason, /operator attention/);
    assert.equal((await f.h.accounts.wallet(f.alice.id)).accounts[0]!.balance, '100.00');
  },
);
Given(
  'an isolated consumer request fixture',
  { timeout: 120000 },
  async function (this: RequestWorld) {
    this.requestFixture = await createEnhancementHarness();
  },
);
After({ tags: '@consumer_requests', timeout: 15000 }, async function (this: RequestWorld) {
  await this.requestFixture?.close();
});
When('the consumer requests access and 5.00 demo units', async function (this: RequestWorld) {
  const f = this.requestFixture!,
    service = f.h.app.get(RequestsService);
  this.requestRecords = [];
  for (const input of [
    { type: 'ACCESS', role: 'AUDITOR', reason: 'Read controlled demo evidence' },
    {
      type: 'DEMO_ALLOCATION',
      assetId: f.asset._id.toHexString(),
      quantity: '5.00',
      reason: 'Run a controlled demo journey',
    },
  ])
    this.requestRecords.push((await service.create(f.bob.id, randomUUID(), input)).request);
});
Then('the requests alone change no role or balance', async function (this: RequestWorld) {
  const f = this.requestFixture!;
  assert.equal((await f.h.accounts.wallet(f.bob.id)).accounts[0]!.balance, '0.00');
  assert.equal(
    await f.h.database.db
      .collection('roleGrants')
      .countDocuments({ userId: new ObjectId(f.bob.id) }),
    0,
  );
});
When(
  'the category administrator explicitly approves both requests',
  async function (this: RequestWorld) {
    const f = this.requestFixture!,
      service = f.h.app.get(RequestsService);
    for (const row of this.requestRecords!)
      await service.decide(f.admin.id, row.id, {
        decision: 'APPROVED',
        reason: 'Approved controlled fixture request',
        revision: row.revision,
        commandId: randomUUID(),
      });
  },
);
Then(
  'the consumer sees linked decisions with one grant and one balanced issuance',
  async function (this: RequestWorld) {
    const f = this.requestFixture!,
      rows = (await f.h.app.get(RequestsService).list(f.bob.id, {})).requests;
    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => row.status === 'APPROVED' && row.operationId));
    assert.equal((await f.h.accounts.wallet(f.bob.id)).accounts[0]!.balance, '5.00');
    assert.equal(
      await f.h.database.db
        .collection('roleGrants')
        .countDocuments({ userId: new ObjectId(f.bob.id), role: 'AUDITOR', status: 'ACTIVE' }),
      1,
    );
    assert.deepEqual(await f.h.transfers.ledger.reconcile(), { ok: true, issues: [] });
  },
);
When('a consumer attempts unauthorized request decisions', async function (this: RequestWorld) {
  const f = this.requestFixture!,
    service = f.h.app.get(RequestsService);
  this.requestKey = randomUUID();
  const input = { type: 'ACCESS', role: 'AUDITOR', reason: 'Read controlled demo evidence' };
  const row = (await service.create(f.bob.id, this.requestKey, input)).request;
  this.requestRecords = [row];
  assert.equal((await service.create(f.bob.id, this.requestKey, input)).request.id, row.id);
  await assert.rejects(
    service.create(f.bob.id, this.requestKey, { ...input, role: 'ASSET_ADMIN' }),
  );
  const decision = {
    decision: 'APPROVED',
    reason: 'Invalid consumer approval',
    revision: '0',
    commandId: randomUUID(),
  };
  for (const actor of [f.alice.id, f.bob.id])
    await assert.rejects(service.decide(actor, row.id, decision));
  await assert.rejects(service.decide(f.admin.id, row.id, { ...decision, revision: '2' }));
  await assert.rejects(service.list(f.alice.id, {}, true));
  assert.deepEqual((await service.list(f.alice.id, {})).requests, []);
});
Then(
  'the request remains open with no role or balance effect',
  async function (this: RequestWorld) {
    const f = this.requestFixture!,
      rows = (await f.h.app.get(RequestsService).list(f.bob.id, {})).requests;
    assert.equal(rows[0]!.status, 'OPEN');
    assert.equal((await f.h.accounts.wallet(f.bob.id)).accounts[0]!.balance, '0.00');
    assert.equal(
      await f.h.database.db
        .collection('roleGrants')
        .countDocuments({ userId: new ObjectId(f.bob.id) }),
      0,
    );
  },
);
When(
  'an allocation decision loses its checkpoint inside the transaction',
  async function (this: RequestWorld) {
    const f = this.requestFixture!,
      service = f.h.app.get(RequestsService);
    const row = (
      await service.create(f.bob.id, randomUUID(), {
        type: 'DEMO_ALLOCATION',
        assetId: f.asset._id.toHexString(),
        quantity: '5.00',
        reason: 'Controlled interrupted approval',
      })
    ).request;
    this.requestRecords = [row];
    this.requestCommand = {
      decision: 'APPROVED',
      reason: 'Controlled administrator approval',
      revision: '0',
      commandId: randomUUID(),
    };
    service.fault = async () => {
      throw new Error('Controlled decision checkpoint interruption');
    };
    await assert.rejects(service.decide(f.admin.id, row.id, this.requestCommand));
  },
);
Then('the allocation and request decision both roll back', async function (this: RequestWorld) {
  const f = this.requestFixture!;
  assert.equal((await f.h.app.get(RequestsService).list(f.bob.id, {})).requests[0]!.status, 'OPEN');
  assert.equal((await f.h.accounts.wallet(f.bob.id)).accounts[0]!.balance, '0.00');
  assert.equal(
    await f.h.database.db
      .collection('demoIssuances')
      .countDocuments({ fixtureKey: `request:${this.requestRecords![0]!.id}:approval` }),
    0,
  );
});
When(
  'the same administrator decision is retried and replayed',
  async function (this: RequestWorld) {
    const f = this.requestFixture!,
      service = f.h.app.get(RequestsService);
    service.fault = undefined;
    await service.decide(f.admin.id, this.requestRecords![0]!.id, this.requestCommand);
    await service.decide(f.admin.id, this.requestRecords![0]!.id, this.requestCommand);
  },
);
Then('the request and financial effect commit exactly once', async function (this: RequestWorld) {
  const f = this.requestFixture!,
    service = f.h.app.get(RequestsService);
  assert.equal((await service.list(f.bob.id, {})).requests[0]!.status, 'APPROVED');
  assert.equal((await f.h.accounts.wallet(f.bob.id)).accounts[0]!.balance, '5.00');
  assert.equal(
    await f.h.database.db
      .collection('demoIssuances')
      .countDocuments({ fixtureKey: `request:${this.requestRecords![0]!.id}:approval` }),
    1,
  );
  assert.equal(
    await f.h.database.db.collection('adminAudit').countDocuments({ action: 'REQUEST_APPROVED' }),
    1,
  );
  await assert.rejects(
    service.decide(f.admin.id, this.requestRecords![0]!.id, {
      ...this.requestCommand,
      commandId: randomUUID(),
    }),
  );
});
