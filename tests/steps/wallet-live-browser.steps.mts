import 'reflect-metadata';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { After, Given, When, Then } from '@cucumber/cucumber';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import {
  createTransferHarness,
  type TransferHarness,
  type TransferCaller,
} from '../support/transfer-harness.mjs';
import { CustodyService } from '../../apps/api/src/modules/custody/custody.service.js';
import { LedgerService } from '../../apps/api/src/modules/ledger/ledger.service.js';
import { ChainService } from '../../apps/api/src/modules/chain/chain.service.js';
const token = 'real-browser-controlled-setup-token-2026';
interface LiveWorld {
  live?: TransferHarness;
  liveCleanupStarted?: boolean;
  web?: ViteDevServer;
  browser?: Browser;
  page?: Page;
  offline?: TransferCaller;
  errors?: string[];
}
Given(
  'a browser connected to an isolated real wallet service',
  { timeout: 120000 },
  async function (this: LiveWorld) {
    const live = await createTransferHarness({ ADMIN_SETUP_TOKEN: token });
    if (this.liveCleanupStarted) {
      await live.close();
      throw new Error('Live browser fixture completed after scenario cleanup.');
    }
    this.live = live;
    this.offline = await this.live.register('browser_bob');
    await this.live.request(this.offline, '/api/auth/signout', 'POST');
    this.web = await createServer({
      configFile: 'apps/web/vite.config.ts',
      root: 'apps/web',
      logLevel: 'error',
      server: {
        port: 0,
        strictPort: false,
        host: '127.0.0.1',
        open: false,
        proxy: { '/api': { target: await this.live.app.getUrl(), changeOrigin: true } },
      },
    });
    await this.web.listen();
    const address = this.web.httpServer!.address();
    assert.ok(address && typeof address === 'object');
    const url = `http://127.0.0.1:${address.port}`;
    this.live.environment.WEB_ORIGIN = url;
    this.browser = await chromium.launch({
      headless: true,
      ...(process.env.P2P_TEST_BROWSER_EXECUTABLE
        ? { executablePath: process.env.P2P_TEST_BROWSER_EXECUTABLE }
        : { channel: process.env.P2P_TEST_BROWSER_CHANNEL ?? 'chrome' }),
    });
    this.page = await this.browser.newPage({ viewport: { width: 1440, height: 1000 } });
    this.page.setDefaultTimeout(15000);
    this.errors = [];
    this.page.on('pageerror', (error) => this.errors!.push(error.message));
    // No page.route or API interception: the proxy reaches Nest and real MongoDB.
    await this.page.goto(url);
  },
);
When(
  'I register and enable administration in the browser',
  { timeout: 60000 },
  async function (this: LiveWorld) {
    const page = this.page!;
    await page.getByRole('button', { name: 'Create an account', exact: true }).click();
    await page.getByLabel('Email', { exact: true }).fill('browser_operator@example.invalid');
    await page.getByLabel('Public handle', { exact: true }).fill('browser_operator');
    await page.getByLabel('Password', { exact: true }).fill('Isolated-browser-password-2026');
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await page.getByRole('heading', { name: 'Your workspace', exact: true }).waitFor();
    await page
      .getByRole('navigation', { name: 'Workspace navigation' })
      .getByRole('link', { name: 'Wallet', exact: true })
      .click();
    const walletPosition = await page
      .getByRole('heading', { name: 'Set up your wallet', exact: true })
      .boundingBox();
    assert.ok(
      walletPosition && walletPosition.y < (page.viewportSize()?.height ?? 600),
      'Unified wallet setup must be visible near the top after sign-in',
    );
    await page.getByRole('link', { name: 'Administration', exact: true }).click();
    await page.getByLabel('Installation setup token').fill(token);
    await page.getByRole('button', { name: 'Enable administration' }).click();
    await page.getByRole('heading', { name: 'Create a demo asset' }).waitFor();
  },
);
When(
  'I create and activate a demo asset and issue 100.00 units in the browser',
  { timeout: 60000 },
  async function (this: LiveWorld) {
    const page = this.page!;
    for (const [label, value] of [
      ['Asset code', 'LIVE'],
      ['Symbol', 'LIVE'],
      ['Asset name', 'Live demo'],
      ['Supply cap', '1000.00'],
      ['Minimum transfer', '0.01'],
      ['Maximum transfer', '1000.00'],
      ['Asset change reason', 'Browser verification'],
    ])
      await page.getByLabel(label!, { exact: true }).fill(value!);
    await page.getByRole('button', { name: 'Create draft', exact: true }).click();
    await page.getByRole('button', { name: 'Manage LIVE' }).click();
    await page.getByLabel('Asset change reason').fill('Activate verified demo');
    await page.getByRole('button', { name: 'Verify & activate' }).click();
    await page.getByText('Asset active.', { exact: true }).waitFor();
    await page.getByLabel('Issuance asset').selectOption({ label: 'LIVE' });
    await page.getByLabel('Recipient handle', { exact: true }).fill('browser_operator');
    await page.getByLabel('Issuance quantity').fill('100.00');
    await page.getByLabel('Issuance reason').fill('Fund controlled browser wallet');
    await page.getByRole('button', { name: 'Issue demo units', exact: true }).click();
    await page
      .getByRole('navigation', { name: 'Workspace navigation' })
      .getByRole('link', { name: 'Send', exact: true })
      .click();
    await page.locator('.wallet-balances').getByText('100.00', { exact: true }).waitFor();
  },
);
When(
  'I review and send 12.50 units to the logged-out peer in the browser',
  { timeout: 60000 },
  async function (this: LiveWorld) {
    const page = this.page!;
    await page.getByLabel('Recipient public handle').fill('browser_bob');
    await page.getByLabel('Asset', { exact: true }).selectOption({ label: 'Live demo (LIVE)' });
    await page.getByLabel('Quantity', { exact: true }).fill('12.50');
    await page.getByRole('button', { name: 'Review transfer' }).click();
    await page.getByRole('heading', { name: 'Review your transfer' }).waitFor();
    assert.match(await page.locator('.transfer-review').innerText(), /browser_bob/);
    await page.getByRole('button', { name: 'Confirm transfer' }).click();
    await page.getByRole('heading', { name: 'Transfer complete' }).waitFor();
    await page.locator('.wallet-balances').getByText('87.50', { exact: true }).waitFor();
    await page
      .getByRole('navigation', { name: 'Workspace navigation' })
      .getByRole('link', { name: 'Wallet', exact: true })
      .click();
    await page
      .getByRole('region', { name: 'Custody activity' })
      .getByText('12.50 LIVE', { exact: true })
      .waitFor();
  },
);
Then(
  'the real wallet balances, ledger, transfer chain and custody agree',
  async function (this: LiveWorld) {
    const h = this.live!;
    assert.equal((await h.accounts.wallet(this.offline!.id)).accounts[0]!.balance, '12.50');
    const record = await h.transfers.transfers.findOne({ status: 'COMMITTED' });
    assert.equal(record!.payloadVersion, 2);
    assert.deepEqual(await h.app.get(CustodyService).verify(), { ok: true, issues: [] });
    assert.equal((await h.app.get(LedgerService).reconcile()).ok, true);
    assert.equal((await h.app.get(ChainService).verify()).ok, true);
    await mkdir('.local/test-results/wallet-delivery', { recursive: true });
    await this.page!.screenshot({
      path: '.local/test-results/wallet-delivery/real-browser-transfer.png',
      fullPage: true,
    });
  },
);
Then(
  'I can manage access, inspect audit and run demo data in the browser',
  { timeout: 180000 },
  async function (this: LiveWorld) {
    const page = this.page!;
    await page.getByRole('link', { name: 'Administration', exact: true }).click();
    await page.getByRole('button', { name: 'Access', exact: true }).click();
    await page.getByLabel('User handle').fill('browser_bob');
    await page.getByLabel('Access change reason').fill('Controlled access grant');
    await page.getByRole('button', { name: 'Update access' }).click();
    await page.getByText('Access grant updated.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Audit', exact: true }).click();
    await page.getByText('ROLE_ACTIVE_ASSET_ADMIN', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Demo data', exact: true }).click();
    await page.getByRole('button', { name: 'Preview demo data' }).click();
    await page.getByLabel('Demo account password').fill('Isolated-seed-browser-password-2026');
    await page.getByRole('button', { name: 'Run or resume demo data' }).click();
    await page.getByText('Demo data ready.', { exact: false }).waitFor({ timeout: 120000 });
    await page.screenshot({
      path: '.local/test-results/wallet-delivery/real-browser-administration.png',
      fullPage: true,
    });
  },
);
When(
  'I try an unknown recipient and then overspend in the browser',
  { timeout: 60000 },
  async function (this: LiveWorld) {
    const page = this.page!;
    await page.getByLabel('Recipient public handle').fill('unknown_peer');
    await page.getByLabel('Quantity', { exact: true }).fill('1.00');
    await page.getByRole('button', { name: 'Review transfer' }).click();
    await page.getByRole('alert').getByText('Recipient is unavailable.', { exact: true }).waitFor();
    await page.getByLabel('Recipient public handle').fill('browser_bob');
    await page.getByLabel('Quantity', { exact: true }).fill('100.01');
    await page.getByRole('button', { name: 'Review transfer' }).click();
    await page.getByRole('button', { name: 'Confirm transfer' }).click();
    await page.getByRole('heading', { name: 'Transfer rejected' }).waitFor();
    await page.getByText('Your available balance is too low.', { exact: true }).waitFor();
  },
);
Then('no payment commits and my form can start another transfer', async function (this: LiveWorld) {
  assert.equal(await this.live!.transfers.transfers.countDocuments({ status: 'COMMITTED' }), 0);
  assert.equal(await this.live!.transfers.transfers.countDocuments({ status: 'REJECTED' }), 1);
  assert.equal((await this.live!.accounts.wallet(this.offline!.id)).accounts[0]!.balance, '0.00');
  await this.page!.getByRole('button', { name: 'Start another transfer' }).click();
  await this.page!.getByLabel('Quantity', { exact: true }).fill('1.00');
});
After({ tags: '@wallet_live_browser', timeout: 30000 }, async function (this: LiveWorld) {
  this.liveCleanupStarted = true;
  try {
    await this.browser?.close();
  } finally {
    try {
      await this.web?.close();
    } finally {
      await this.live?.close();
    }
  }
  assert.deepEqual(this.errors ?? [], []);
});

When(
  'the recipient review expires on the server before browser confirmation',
  { timeout: 60000 },
  async function (this: LiveWorld) {
    const page = this.page!;
    await page.getByLabel('Recipient public handle').fill('browser_bob');
    await page.getByLabel('Quantity', { exact: true }).fill('1.00');
    await page.getByRole('button', { name: 'Review transfer' }).click();
    await page.getByRole('heading', { name: 'Review your transfer' }).waitFor();
    await this.live!.database.db.collection('recipientResolutions').updateMany(
      {},
      { $set: { expiresAt: new Date(0) } },
    );
    await page.getByRole('button', { name: 'Confirm transfer' }).click();
  },
);
Then(
  'the browser requests a fresh review without creating a payment',
  async function (this: LiveWorld) {
    await this.page!.getByRole('alert')
      .getByText('Resolve and review the recipient again.', { exact: true })
      .waitFor();
    assert.equal(await this.live!.transfers.transfers.countDocuments(), 0);
    assert.equal(
      await this.page!.getByLabel('Recipient public handle').inputValue(),
      'browser_bob',
    );
    await this.page!.getByLabel('Quantity', { exact: true }).fill('2.00');
    await this.page!.getByRole('button', { name: 'Review transfer' }).click();
    await this.page!.getByRole('heading', { name: 'Review your transfer' }).waitFor();
  },
);
