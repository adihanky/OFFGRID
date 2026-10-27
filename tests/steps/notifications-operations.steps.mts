import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { After, Given, When, Then } from '@cucumber/cucumber';
import {
  createEnhancementHarness,
  type EnhancementHarness,
} from '../support/enhancement-harness.mjs';
import { OperationsService } from '../../apps/api/src/modules/operations/operations.service.js';
interface OperationsWorld {
  operationsFixture?: EnhancementHarness;
  operationsTransfer?: string;
  operationsJob?: string;
  operationsCounts?: number[];
  operationsInstant?: number;
}
Given(
  'an isolated operations fixture with a completed transfer',
  { timeout: 120000 },
  async function (this: OperationsWorld) {
    const f = (this.operationsFixture = await createEnhancementHarness());
    const response = await f.h.request(
      f.alice,
      '/api/transfers',
      'POST',
      { recipientId: f.bob.id, assetId: f.asset._id.toHexString(), quantity: '1.00' },
      { key: randomUUID() },
    );
    assert.equal(response.status, 201);
    this.operationsTransfer = ((await response.json()) as { transfer: { id: string } }).transfer.id;
    this.operationsInstant = Date.now();
    this.operationsCounts = await Promise.all(
      ['ledgerEntries', 'chainEntries', 'custodyEvents', 'demoIssuances'].map((name) =>
        f.h.database.db.collection(name).countDocuments(),
      ),
    );
  },
);
After(
  { tags: '@notifications_operations', timeout: 15000 },
  async function (this: OperationsWorld) {
    await this.operationsFixture?.close();
  },
);
When(
  'the outbox notification is delivered and delivered again',
  async function (this: OperationsWorld) {
    const service = this.operationsFixture!.h.app.get(OperationsService);
    assert.equal(await service.deliverOne(), true);
    await service.events.updateOne(
      { aggregateId: new ObjectId(this.operationsTransfer) },
      { $set: { deliveredAt: null, deliveryLeaseUntil: null } },
    );
    assert.equal(await service.deliverOne(), true);
  },
);
Then(
  'each participant has one notification and strangers have none',
  async function (this: OperationsWorld) {
    const f = this.operationsFixture!,
      service = f.h.app.get(OperationsService);
    for (const caller of [f.alice, f.bob]) {
      const page = await service.notificationPage(caller.id, {});
      assert.equal(page.notifications.length, 1);
      assert.equal(page.notifications[0]!.transferId, this.operationsTransfer);
    }
    assert.equal((await service.notificationPage(f.admin.id, {})).notifications.length, 0);
    assert.equal(await service.inbox.countDocuments(), 2);
  },
);
Then(
  'marking the notification read twice preserves settlement',
  async function (this: OperationsWorld) {
    const f = this.operationsFixture!,
      service = f.h.app.get(OperationsService),
      notification = (await service.notificationPage(f.alice.id, {})).notifications[0]!;
    await service.read(f.alice.id, notification.id);
    const first = (await service.notificationPage(f.alice.id, {})).notifications[0]!.readAt;
    await service.read(f.alice.id, notification.id);
    assert.equal((await service.notificationPage(f.alice.id, {})).notifications[0]!.readAt, first);
    assert.equal(
      (await service.notificationPage(f.alice.id, { unread: 'true' })).notifications.length,
      0,
    );
    assert.deepEqual(
      await Promise.all(
        ['ledgerEntries', 'chainEntries', 'custodyEvents', 'demoIssuances'].map((name) =>
          f.h.database.db.collection(name).countDocuments(),
        ),
      ),
      this.operationsCounts,
    );
  },
);
When(
  'another user accesses notifications and verification jobs',
  async function (this: OperationsWorld) {
    const f = this.operationsFixture!,
      service = f.h.app.get(OperationsService);
    await service.deliverOne();
    this.operationsJob = (
      await service.createJob(f.admin.id, randomUUID(), { scope: 'DEMO_INTEGRITY' })
    ).job.id;
  },
);
Then('cross-user read and job access are rejected', async function (this: OperationsWorld) {
  const f = this.operationsFixture!,
    service = f.h.app.get(OperationsService),
    row = (await service.notificationPage(f.alice.id, {})).notifications[0]!;
  await assert.rejects(service.read(f.bob.id, row.id));
  await assert.rejects(service.overview(f.alice.id));
  await assert.rejects(service.job(f.alice.id, this.operationsJob!));
  await f.service.setRole(f.admin.id, {
    handle: f.alice.handle,
    role: 'AUDITOR',
    status: 'ACTIVE',
    revision: null,
    reason: 'Controlled job access test',
  });
  await assert.rejects(service.job(f.alice.id, this.operationsJob!));
  await assert.rejects(service.notificationPage(f.alice.id, { ownerId: f.bob.id }));
});
Then(
  'unsupported verification scopes are rejected without financial writes',
  async function (this: OperationsWorld) {
    const f = this.operationsFixture!,
      service = f.h.app.get(OperationsService);
    await assert.rejects(service.createJob(f.admin.id, randomUUID(), { scope: 'REPAIR' }));
    await assert.rejects(service.ledger.reconcile(1), /budget exceeded/);
    await assert.rejects(service.chain.verify(undefined, 1), /budget exceeded/);
    await assert.rejects(service.custody.verify(1), /budget exceeded/);
    assert.deepEqual(
      await Promise.all(
        ['ledgerEntries', 'chainEntries', 'custodyEvents', 'demoIssuances'].map((name) =>
          f.h.database.db.collection(name).countDocuments(),
        ),
      ),
      this.operationsCounts,
    );
  },
);
When(
  'a notification delivery loses its lease before acknowledgment',
  async function (this: OperationsWorld) {
    const service = this.operationsFixture!.h.app.get(OperationsService);
    service.fault = async (stage) => {
      if (stage === 'beforeDelivered')
        await service.events.updateOne(
          { aggregateId: new ObjectId(this.operationsTransfer) },
          {
            $set: {
              deliveryToken: 'controlled-newer-delivery',
              deliveryLeaseUntil: new Date(Date.now() + 30000),
            },
          },
        );
    };
    await service.deliverOne();
  },
);
Then(
  'no inbox rows or false delivery acknowledgment survive',
  async function (this: OperationsWorld) {
    const service = this.operationsFixture!.h.app.get(OperationsService);
    assert.equal(await service.inbox.countDocuments(), 0);
    const event = await service.events.findOne({
      aggregateId: new ObjectId(this.operationsTransfer),
    });
    assert.equal(event!.deliveredAt, null);
    assert.equal(event!.deliveryToken, 'controlled-newer-delivery');
  },
);
When(
  'a current delivery worker resumes after lease expiry',
  async function (this: OperationsWorld) {
    const service = this.operationsFixture!.h.app.get(OperationsService);
    service.fault = undefined;
    service.now = () => new Date(Date.now() + 60000);
    await service.deliverOne();
  },
);
When(
  'an auditor starts a verification job whose checkpoint lease changes',
  async function (this: OperationsWorld) {
    const f = this.operationsFixture!,
      service = f.h.app.get(OperationsService),
      key = randomUUID();
    this.operationsJob = (
      await service.createJob(f.admin.id, key, { scope: 'DEMO_INTEGRITY' })
    ).job.id;
    assert.equal(
      (await service.createJob(f.admin.id, key, { scope: 'DEMO_INTEGRITY' })).job.id,
      this.operationsJob,
    );
    service.fault = async (stage) => {
      if (stage === 'jobCheckpoint')
        await service.jobs.updateOne(
          { _id: new ObjectId(this.operationsJob) },
          { $set: { token: 'controlled-newer-job', leaseUntil: new Date(Date.now() + 120000) } },
        );
    };
    await service.runJob();
  },
);
Then('the stale job cannot overwrite the newer claim', async function (this: OperationsWorld) {
  const job = await this.operationsFixture!.h.app.get(OperationsService).jobs.findOne({
    _id: new ObjectId(this.operationsJob),
  });
  assert.equal(job!.token, 'controlled-newer-job');
  assert.equal(job!.progress, 0);
  assert.equal(job!.status, 'RUNNING');
});
When('the read-only job resumes after lease expiry', async function (this: OperationsWorld) {
  const service = this.operationsFixture!.h.app.get(OperationsService);
  service.fault = undefined;
  service.now = () => new Date(Date.now() + 180000);
  await service.runJob();
});
Then(
  'it completes all three checks without changing financial evidence',
  async function (this: OperationsWorld) {
    const f = this.operationsFixture!,
      job = (await f.h.app.get(OperationsService).job(f.admin.id, this.operationsJob!)).job;
    assert.equal(job.status, 'COMPLETED');
    assert.equal(job.progress, 3);
    assert.ok(job.results.every((result) => result.ok && result.issueCount === 0));
    assert.deepEqual(
      await Promise.all(
        ['ledgerEntries', 'chainEntries', 'custodyEvents', 'demoIssuances'].map((name) =>
          f.h.database.db.collection(name).countDocuments(),
        ),
      ),
      this.operationsCounts,
    );
  },
);
