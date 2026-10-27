import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { After, Given, When, Then } from '@cucumber/cucumber';
import type { TransferHistoryPage, TransferReceipt, TransferChainEvidence } from '@p2p/contracts';
import {
  createTransferHarness,
  type TransferHarness,
  type TransferCaller,
} from '../support/transfer-harness.mjs';
import { WalletsService } from '../../apps/api/src/modules/wallets/wallets.service.js';
import {
  newToken,
  tokenHash,
  csrfForSession,
} from '../../apps/api/src/modules/auth/auth.crypto.js';

interface HistoryWorld {
  history?: TransferHarness;
  historySender?: TransferCaller;
  historyRecipient?: TransferCaller;
  historyStranger?: TransferCaller;
  historyAsset?: string;
  historyIds?: string[];
  historyPages?: TransferHistoryPage[];
  historyCursor?: string;
  historyResponse?: Response;
}
async function page(w: HistoryWorld, caller = w.historySender!, query = '') {
  const response = await w.history!.request(caller, `/api/v2/transfers${query}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return (await response.json()) as TransferHistoryPage;
}

Given(
  'isolated history participants with committed, rejected and pending sends',
  { timeout: 120000 },
  async function (this: HistoryWorld) {
    const h = (this.history = await createTransferHarness());
    const sender = (this.historySender = await h.register('history_alice'));
    const recipient = (this.historyRecipient = await h.register('history_bob'));
    this.historyStranger = await h.register('history_carol');
    this.historyAsset = (
      await h.accounts.createAsset({ code: 'HIST', displayName: 'History demo', precision: 2 })
    )._id.toHexString();
    await h.issue(sender, this.historyAsset, 10000n);
    this.historyIds = [];
    for (const quantity of ['1.25', '999.00']) {
      const response = await h.request(
        sender,
        '/api/transfers',
        'POST',
        { recipientId: recipient.id, assetId: this.historyAsset, quantity },
        { key: randomUUID() },
      );
      assert.equal(response.status, quantity === '1.25' ? 201 : 422);
      this.historyIds.push(((await response.json()) as { transfer: { id: string } }).transfer.id);
    }
    const wallets = h.app.get(WalletsService);
    const wallet = await wallets.own(sender.id);
    const resolution = await wallets.resolve(sender.id, {
      senderWalletId: wallet.id,
      assetId: this.historyAsset,
      lookup: { kind: 'HANDLE', value: recipient.handle },
    });
    h.transfers.fault = async (stage) => {
      if (stage === 'claimed') throw new Error('Controlled pre-execution outage');
    };
    const pending = await h.request(
      sender,
      '/api/v2/transfers',
      'POST',
      {
        senderWalletId: wallet.id,
        recipientResolutionId: resolution.resolutionId,
        assetId: this.historyAsset,
        quantity: '2.50',
      },
      { key: randomUUID() },
    );
    assert.equal(pending.status, 202);
    this.historyIds.push(((await pending.json()) as { transfer: { id: string } }).transfer.id);
  },
);
After({ tags: '@transfer_history', timeout: 15000 }, async function (this: HistoryWorld) {
  await this.history?.close();
});

When('the sender and recipient query their transfer history', async function (this: HistoryWorld) {
  this.historyPages = [await page(this), await page(this, this.historyRecipient)];
});
Then(
  'the sender sees all own outcomes and the recipient sees only committed transfers',
  async function (this: HistoryWorld) {
    assert.deepEqual(
      this.historyPages![0]!.transfers.map((t) => t.id).sort(),
      [...this.historyIds!].sort(),
    );
    assert.deepEqual(
      this.historyPages![1]!.transfers.map((t) => t.id),
      [this.historyIds![0]],
    );
    assert.deepEqual((await page(this, this.historyRecipient, '?status=PENDING')).transfers, []);
    assert.deepEqual((await page(this, this.historySender, '?direction=RECEIVED')).transfers, []);
    assert.equal(
      (
        await page(
          this,
          this.historySender,
          '?direction=SENT&status=REJECTED&peerHandle=history_bob',
        )
      ).transfers[0]!.id,
      this.historyIds![1],
    );
    const serialized = JSON.stringify(this.historyPages);
    for (const privateField of [
      'idempotencyKey',
      'payloadHash',
      'attemptToken',
      'senderAccountId',
      'email',
      'leaseUntil',
    ])
      assert.ok(!serialized.includes(privateField), privateField);
  },
);
Then(
  'the committed receipt and chain evidence match the persisted journal',
  async function (this: HistoryWorld) {
    const h = this.history!,
      id = this.historyIds![0]!;
    for (const caller of [this.historySender!, this.historyRecipient!]) {
      const response = await h.request(caller, `/api/v2/transfers/${id}/receipt`);
      assert.equal(response.status, 200);
      const receipt = (await response.json()) as TransferReceipt;
      assert.equal(receipt.transfer.quantity, '1.25');
      assert.equal(receipt.transfer.payloadVersion, 1);
      assert.equal(receipt.identitySource, 'ADMISSION_SNAPSHOT');
      const journal = await h.database.db
        .collection('ledgerEntries', { promoteLongs: false })
        .find({ referenceId: new ObjectId(id) })
        .toArray();
      assert.equal(journal.length, 2);
      assert.ok(journal.every((row) => row['quantityUnits'].toString() === '125'));
      const chainResponse = await h.request(caller, `/api/v2/transfers/${id}/chain`);
      assert.equal(chainResponse.status, 200);
      const evidence = (await chainResponse.json()) as TransferChainEvidence;
      const stored = await h.transfers.chain.entries.findOne({ transferId: new ObjectId(id) });
      assert.equal(evidence.entryHash, stored!.entryHash);
      assert.equal(evidence.committedAt, receipt.committedAt);
      assert.equal('canonicalPayload' in evidence, false);
      assert.equal('senderAccountId' in evidence, false);
    }
  },
);
When('another user queries transfer history and evidence', async function (this: HistoryWorld) {
  this.historyPages = [await page(this, this.historyStranger)];
});
Then('private attempts and foreign receipts are unavailable', async function (this: HistoryWorld) {
  const h = this.history!;
  assert.deepEqual(this.historyPages![0]!.transfers, []);
  for (const id of this.historyIds!) {
    for (const suffix of ['', '/receipt', '/chain'])
      assert.equal(
        (await h.request(this.historyStranger!, `/api/v2/transfers/${id}${suffix}`)).status,
        404,
      );
  }
  for (const id of this.historyIds!.slice(1)) {
    assert.equal((await h.request(this.historyRecipient!, `/api/v2/transfers/${id}`)).status, 404);
    assert.equal(
      (await h.request(this.historySender!, `/api/v2/transfers/${id}/receipt`)).status,
      404,
    );
  }
  assert.equal((await h.request(h.anonymous, '/api/v2/transfers')).status, 401);
});
Then('malformed history filters and cursors are rejected', async function (this: HistoryWorld) {
  for (const query of [
    'limit=101',
    'limit=-1',
    'cursor=broken',
    'direction=EVERYONE',
    'ownerId=111111111111111111111111',
    'status=PENDING&status=COMMITTED',
    'from=2026-01-01T00:00:00Z',
    'assetId=invalid',
  ]) {
    assert.equal(
      (await this.history!.request(this.historySender!, `/api/v2/transfers?${query}`)).status,
      400,
      query,
    );
  }
});
When('the sender pages history with equal admission times', async function (this: HistoryWorld) {
  await this.history!.transfers.transfers.updateMany(
    {},
    { $set: { createdAt: new Date('2026-10-26T00:00:00.000Z') } },
  );
  this.historyPages = [];
  let cursor: string | null = null;
  do {
    const result: TransferHistoryPage = await page(
      this,
      this.historySender,
      `?limit=1${cursor ? `&cursor=${cursor}` : ''}`,
    );
    this.historyPages.push(result);
    this.historyCursor ??= result.nextCursor ?? undefined;
    cursor = result.nextCursor;
    assert.ok(this.historyPages.length <= 3);
  } while (cursor);
});
Then('every admitted transfer appears exactly once', function (this: HistoryWorld) {
  const ids = this.historyPages!.flatMap((p) => p.transfers.map((t) => t.id));
  assert.equal(new Set(ids).size, 3);
  assert.deepEqual(ids, [...this.historyIds!].sort().reverse());
});
Then('changing the filters or caller invalidates the cursor', async function (this: HistoryWorld) {
  for (const [caller, query] of [
    [this.historyRecipient!, 'limit=1'],
    [this.historySender!, 'limit=1&status=PENDING'],
  ] as const)
    assert.equal(
      (
        await this.history!.request(
          caller,
          `/api/v2/transfers?${query}&cursor=${this.historyCursor}`,
        )
      ).status,
      400,
    );
});
Then(
  'an archived asset and original v1 identity remain readable',
  async function (this: HistoryWorld) {
    await this.history!.accounts.setAssetStatus(new ObjectId(this.historyAsset), 'disabled');
    await this.history!.accounts.assets.updateOne(
      { _id: new ObjectId(this.historyAsset) },
      { $set: { lifecycle: 'ARCHIVED' } },
    );
    const result = await page(this, this.historySender, `?assetId=${this.historyAsset}`);
    assert.equal(result.transfers.length, 3);
    assert.equal(result.transfers.find((t) => t.id === this.historyIds![0])!.payloadVersion, 1);
  },
);
When(
  'the sender replaces its session with an empty browser jar',
  async function (this: HistoryWorld) {
    const h = this.history!,
      caller = this.historySender!;
    assert.equal((await h.request(caller, '/api/auth/signout', 'POST')).status, 204);
    caller.jar.clear();
    const token = newToken();
    caller.csrf = csrfForSession(token);
    await h.database.db.collection('sessions').insertOne({
      _id: new ObjectId(),
      userId: new ObjectId(caller.id),
      tokenHash: tokenHash(token),
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 3600000),
      revokedAt: null,
    });
    caller.jar.set('p2p_session', token);
    caller.jar.set('p2p_csrf', caller.csrf);
  },
);
Then('server history discovers the original pending transfer', async function (this: HistoryWorld) {
  const result = await page(this, this.historySender, '?direction=SENT&status=PENDING');
  assert.deepEqual(
    result.transfers.map((t) => t.id),
    [this.historyIds![2]],
  );
  assert.equal(result.transfers[0]!.payloadVersion, 2);
});
Then(
  'checking and recovering the original ID creates one financial effect',
  async function (this: HistoryWorld) {
    const h = this.history!,
      id = this.historyIds![2]!;
    const checked = await h.request(this.historySender!, `/api/v2/transfers/${id}`);
    assert.equal(checked.status, 200);
    h.transfers.fault = undefined;
    await h.transfers.transfers.updateOne(
      { _id: new ObjectId(id) },
      { $set: { nextAttemptAt: new Date(0) } },
    );
    await h.transfers.recover();
    await h.transfers.recover();
    assert.equal((await page(this, this.historySender, '?status=PENDING')).transfers.length, 0);
    const record = await h.transfers.transfers.findOne({ _id: new ObjectId(id) });
    assert.equal(record!.status, 'COMMITTED');
    assert.equal(
      await h.database.db.collection('ledgerEntries').countDocuments({ referenceId: record!._id }),
      2,
    );
    assert.equal(
      await h.database.db.collection('chainEntries').countDocuments({ transferId: record!._id }),
      1,
    );
    assert.equal(
      await h.database.db.collection('outboxEvents').countDocuments({ aggregateId: record!._id }),
      1,
    );
    assert.equal((await h.accounts.wallet(this.historySender!.id)).accounts[0]!.balance, '96.25');
  },
);
