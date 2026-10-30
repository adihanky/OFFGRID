import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { ObjectId } from 'mongodb';
import { When, Then } from '@cucumber/cucumber';
import type { Page } from 'playwright-core';
import type { WalletSetupHarness } from '../support/wallet-setup-harness.mjs';
import { PasswordService } from '../../apps/api/src/modules/auth/auth.crypto.js';
interface HistoryBrowserWorld {
  setupBrowser?: { page: Page; f: WalletSetupHarness };
  browserTransferId?: string;
  browserSendCount?: number;
}
When(
  'I admit a pending transfer through Send and sign in again with empty storage',
  { timeout: 60000 },
  async function (this: HistoryBrowserWorld) {
    const { page, f } = this.setupBrowser!,
      password = 'Controlled-history-browser-password-2026';
    await f.h.database.db
      .collection('users')
      .updateOne(
        { _id: new ObjectId(f.admin.id) },
        { $set: { passwordHash: await f.h.app.get(PasswordService).hash(password) } },
      );
    await f.h.issue(f.admin, f.asset._id.toHexString(), 10000n);
    this.browserSendCount = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v2/transfers')
        this.browserSendCount!++;
    });
    await page
      .getByRole('navigation', { name: 'Workspace navigation' })
      .getByRole('link', { name: 'Send', exact: true })
      .click();
    await page.getByRole('button', { name: 'Refresh balances', exact: true }).click();
    await page.getByLabel('Recipient public handle').fill(f.bob.handle);
    await page.getByLabel('Quantity', { exact: true }).fill('1.25');
    await page.getByRole('button', { name: 'Review transfer', exact: true }).click();
    await page.getByRole('heading', { name: 'Review your transfer', exact: true }).waitFor();
    f.h.transfers.fault = async (stage) => {
      if (stage === 'claimed') throw new Error('Controlled browser pending boundary');
    };
    const admitted = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/v2/transfers' &&
        response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Confirm transfer', exact: true }).click();
    const response = await admitted;
    assert.equal(response.status(), 202);
    const outcome = (await response.json()) as { transfer: { id: string; status: string } };
    assert.equal(outcome.transfer.status, 'PENDING');
    await page.getByText('Your transfer outcome is unresolved.', { exact: false }).waitFor();
    const record = await f.h.transfers.transfers.findOne({
      _id: new ObjectId(outcome.transfer.id),
      senderId: new ObjectId(f.admin.id),
      status: 'PENDING',
    });
    assert.ok(record);
    this.browserTransferId = record._id.toHexString();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByRole('heading', { name: 'Sign in to your account', exact: true }).waitFor();
    await page.evaluate('sessionStorage.clear()');
    await page.getByLabel('Email', { exact: true }).fill(`${f.admin.handle}@example.invalid`);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('heading', { name: 'Your workspace', exact: true }).waitFor();
    await page.getByText('1 pending transfer', { exact: true }).waitFor();
  },
);
Then(
  'Activity discovers and checks the original pending transfer without another send',
  { timeout: 30000 },
  async function (this: HistoryBrowserWorld) {
    const page = this.setupBrowser!.page;
    await page
      .getByRole('navigation', { name: 'Workspace navigation' })
      .getByRole('link', { name: 'Activity', exact: true })
      .click();
    await page.getByRole('button', { name: 'Legacy simulated wallets', exact: true }).click();
    await page.locator(`a[href="#/activity/${this.browserTransferId}"]`).click();
    await page.getByRole('heading', { name: 'Original transfer outcome', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Check status', exact: true }).click();
    await page.getByText('Still checking.', { exact: false }).waitFor();
    assert.equal(this.browserSendCount, 1);
  },
);
When('the original admitted transfer recovers', async function (this: HistoryBrowserWorld) {
  const { f } = this.setupBrowser!;
  f.h.transfers.fault = undefined;
  await f.h.transfers.transfers.updateOne(
    { _id: new ObjectId(this.browserTransferId) },
    { $set: { nextAttemptAt: new Date(0) } },
  );
  await f.h.transfers.recover();
});
Then(
  'the browser receipt matches one persisted financial effect',
  { timeout: 30000 },
  async function (this: HistoryBrowserWorld) {
    const { page, f } = this.setupBrowser!,
      id = new ObjectId(this.browserTransferId);
    await page.getByRole('button', { name: 'Check status', exact: true }).click();
    await page.getByRole('heading', { name: 'Transfer receipt', exact: true }).waitFor();
    await page.getByText('1.25 WSET', { exact: true }).waitFor();
    await page.getByText('Technical transfer evidence', { exact: true }).click();
    const chain = await f.h.transfers.chain.entries.findOne({ transferId: id });
    await page.getByText(chain!.entryHash, { exact: true }).waitFor();
    assert.equal(this.browserSendCount, 1);
    assert.equal(await f.h.transfers.transfers.countDocuments(), 1);
    assert.equal(
      await f.h.database.db.collection('ledgerEntries').countDocuments({ referenceId: id }),
      2,
    );
    assert.equal(
      await f.h.database.db.collection('chainEntries').countDocuments({ transferId: id }),
      1,
    );
    assert.equal(
      await f.h.database.db.collection('custodyEvents').countDocuments({ referenceId: id }),
      1,
    );
    await mkdir('.local/test-results/p2p-enhancements', { recursive: true });
    await page.screenshot({
      path: '.local/test-results/p2p-enhancements/recovered-receipt.png',
      fullPage: true,
    });
  },
);
