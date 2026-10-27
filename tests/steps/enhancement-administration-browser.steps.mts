import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { When, Then } from '@cucumber/cucumber';
import type { Page, Browser, BrowserContext } from 'playwright-core';
import type { WalletSetupHarness } from '../support/wallet-setup-harness.mjs';
import type { ConsumerRequestView } from '@p2p/contracts';
import { PolicyReader } from '../../apps/api/src/modules/configuration/policy-reader.js';
import { productDefaults } from '../../apps/api/src/modules/configuration/policy-registry.js';
interface AdministrationWorld {
  setupBrowser?: { page: Page; browser: Browser; f: WalletSetupHarness; errors: string[] };
  policyOtherPage?: Page;
  policyOtherContext?: BrowserContext;
  allocationRequest?: ConsumerRequestView;
  allocationDecision?: unknown;
}
function productForm(page: Page) {
  return page
    .locator('form')
    .filter({ has: page.getByRole('heading', { name: 'Product policies', exact: true }) });
}
async function openPolicies(page: Page) {
  await page.goto(`${new URL(page.url()).origin}/#/admin/policies`);
  await page.getByRole('heading', { name: 'Product policies', exact: true }).waitFor();
}
async function reviewPolicy(page: Page, lifetime: string, reason: string) {
  const form = productForm(page);
  await form.getByLabel('Recipient review lifetime', { exact: false }).fill(lifetime);
  await form.getByLabel('Reason for configuration change', { exact: false }).fill(reason);
  await form.getByRole('button', { name: 'Validate and review changes', exact: true }).click();
}
When(
  'two browser policy forms edit the same revision',
  { timeout: 60000 },
  async function (this: AdministrationWorld) {
    const { page, errors } = this.setupBrowser!;
    await openPolicies(page);
    this.policyOtherContext = await this.setupBrowser!.browser.newContext();
    await this.policyOtherContext.addCookies(await page.context().cookies());
    this.policyOtherPage = await this.policyOtherContext.newPage();
    this.policyOtherPage.on('pageerror', (error) => errors.push(error.message));
    await this.policyOtherPage.goto(`${new URL(page.url()).origin}/#/admin/policies`);
    await this.policyOtherPage
      .getByRole('heading', { name: 'Product policies', exact: true })
      .waitFor();
    const other = productForm(this.policyOtherPage);
    await other.getByLabel('Recipient review lifetime', { exact: false }).fill('90');
    await other
      .getByLabel('Reason for configuration change', { exact: false })
      .fill('Retained second browser form');
    await reviewPolicy(page, '45', 'First browser publication');
    await productForm(page)
      .getByRole('button', { name: 'Publish reviewed configuration', exact: true })
      .click();
    await productForm(page).getByText('Published revision 1.', { exact: false }).waitFor();
    await other.getByRole('button', { name: 'Validate and review changes', exact: true }).click();
  },
);
Then(
  'the stale form preserves its draft and compares current values',
  { timeout: 30000 },
  async function (this: AdministrationWorld) {
    const form = productForm(this.policyOtherPage!);
    await form
      .getByRole('alert')
      .getByText('Settings changed to revision 1.', { exact: false })
      .waitFor();
    assert.equal(
      await form.getByLabel('Recipient review lifetime', { exact: false }).inputValue(),
      '90',
    );
    await form.getByText(/Current: 45.*Yours: 90/).waitFor();
  },
);
Then(
  'loading the latest settings permits a new audited publication',
  { timeout: 30000 },
  async function (this: AdministrationWorld) {
    const { f } = this.setupBrowser!,
      page = this.policyOtherPage!,
      form = productForm(page);
    await form
      .getByRole('button', { name: 'Load latest values and discard this form', exact: true })
      .click();
    assert.equal(
      await form.getByLabel('Recipient review lifetime', { exact: false }).inputValue(),
      '45',
    );
    await reviewPolicy(page, '60', 'Second reviewed browser publication');
    await form.getByRole('button', { name: 'Publish reviewed configuration', exact: true }).click();
    await form.getByText('Published revision 2.', { exact: false }).waitFor();
    const policy = await f.h.app.get(PolicyReader).product();
    assert.equal(policy.revision, '2');
    assert.equal(policy.values.reviewSeconds, 60);
    assert.equal(
      await f.h.database.db.collection('adminAudit').countDocuments({ action: 'SETTINGS_PRODUCT' }),
      2,
    );
    await mkdir('.local/test-results/p2p-enhancements', { recursive: true });
    await page.screenshot({
      path: '.local/test-results/p2p-enhancements/policy-publication.png',
      fullPage: true,
    });
    await this.policyOtherContext!.close();
  },
);
When(
  'a consumer allocation request reaches the browser review queue',
  { timeout: 30000 },
  async function (this: AdministrationWorld) {
    const { f, page } = this.setupBrowser!;
    const response = await f.h.request(
      f.alice,
      '/api/v2/requests',
      'POST',
      {
        type: 'DEMO_ALLOCATION',
        assetId: f.asset._id.toHexString(),
        quantity: '5.00',
        reason: 'Controlled browser allocation request',
      },
      { key: randomUUID() },
    );
    assert.equal(response.status, 201);
    this.allocationRequest = ((await response.json()) as { request: ConsumerRequestView }).request;
    page.on('request', (request) => {
      if (
        new URL(request.url()).pathname ===
        `/api/v2/admin/requests/${this.allocationRequest!.id}/decision`
      )
        this.allocationDecision = request.postDataJSON();
    });
    await page.goto(`${new URL(page.url()).origin}/#/admin/requests`);
    await page
      .getByRole('heading', { name: `@${f.alice.handle}: 5.00 WSET`, exact: true })
      .waitFor();
  },
);
When(
  'I review and confirm its exact administrator decision',
  { timeout: 30000 },
  async function (this: AdministrationWorld) {
    const { page, f } = this.setupBrowser!,
      form = page.locator('form').filter({
        has: page.getByRole('heading', { name: `@${f.alice.handle}: 5.00 WSET`, exact: true }),
      });
    await form
      .getByLabel('Decision reason', { exact: true })
      .fill('Approve the controlled browser request');
    await form.getByRole('button', { name: 'Review decision', exact: true }).click();
    await form
      .getByText(`Confirm issuing 5.00 WSET to @${f.alice.handle}.`, { exact: true })
      .waitFor();
    await form.getByRole('button', { name: 'Confirm administrator decision', exact: true }).click();
    await page
      .getByText('No open requests in your authorized categories.', { exact: true })
      .waitFor();
  },
);
Then(
  'the request and one balanced allocation persist even after replay',
  async function (this: AdministrationWorld) {
    const { f } = this.setupBrowser!;
    assert.equal((await f.h.accounts.wallet(f.alice.id)).accounts[0]!.balance, '5.00');
    const replay = await f.h.request(
      f.admin,
      `/api/v2/admin/requests/${this.allocationRequest!.id}/decision`,
      'POST',
      this.allocationDecision,
    );
    assert.equal(replay.status, 201);
    assert.equal((await f.h.accounts.wallet(f.alice.id)).accounts[0]!.balance, '5.00');
    assert.equal(
      await f.h.database.db
        .collection('demoIssuances')
        .countDocuments({ fixtureKey: `request:${this.allocationRequest!.id}:approval` }),
      1,
    );
    assert.deepEqual(await f.h.transfers.ledger.reconcile(), { ok: true, issues: [] });
  },
);
When(
  'I open an administrator policy bookmark without its role',
  async function (this: AdministrationWorld) {
    const page = this.setupBrowser!.page;
    await page.goto(`${new URL(page.url()).origin}/#/admin/policies`);
  },
);
Then(
  'policy publication stays unavailable and the direct API rejects it',
  async function (this: AdministrationWorld) {
    const { page, f } = this.setupBrowser!;
    await page
      .getByText('This account does not have administrator access.', { exact: false })
      .waitFor();
    assert.equal(
      await page
        .getByRole('button', { name: 'Publish reviewed configuration', exact: true })
        .count(),
      0,
    );
    const origin = new URL(page.url()).origin;
    const csrf = await page.request.get(`${origin}/api/auth/csrf`);
    const body = (await csrf.json()) as { csrfToken: string };
    const response = await page.request.patch(`${origin}/api/v2/admin/settings`, {
      headers: { Origin: origin, 'X-CSRF-Token': body.csrfToken, 'If-Match': '"0"' },
      data: {
        scope: 'PRODUCT',
        values: { ...productDefaults, reviewSeconds: 45 },
        reason: 'Unauthorized controlled browser request',
        commandId: randomUUID(),
      },
    });
    assert.equal(response.status(), 403);
    assert.equal((await f.h.app.get(PolicyReader).product()).revision, '0');
  },
);
