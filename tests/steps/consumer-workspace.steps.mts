import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { When, Then } from '@cucumber/cucumber';
import type { Page } from 'playwright-core';
import type { WalletSetupHarness } from '../support/wallet-setup-harness.mjs';
import { SEND_DRAFT_KEY } from '../../apps/web/src/send-draft.js';
interface ConsumerWorld {
  setupBrowser?: { page: Page; f: WalletSetupHarness };
}
async function task(page: Page, label: string) {
  await page
    .getByRole('navigation', { name: 'Workspace navigation' })
    .getByRole('link', { name: label, exact: true })
    .click();
}
When('I open the consumer Home task', async function (this: ConsumerWorld) {
  const page = this.setupBrowser!.page;
  await page.goto(new URL(page.url()).origin);
  await page.getByRole('heading', { name: 'Your workspace', exact: true }).waitFor();
});
Then(
  'Home explains demo readiness and receiving without external wallet setup',
  async function (this: ConsumerWorld) {
    const { page, f } = this.setupBrowser!;
    await page.getByRole('link', { name: 'Receive demo units', exact: true }).waitFor();
    await page
      .getByText('External wallet linking is optional and proves ownership only.', { exact: false })
      .waitFor();
    assert.equal(await page.locator('.workspace-content > div:visible').count(), 1);
    await task(page, 'Wallet');
    await page.getByRole('region', { name: 'Receive demo units' }).waitFor();
    const walletId = (
      await f.h.app
        .get((await import('../../apps/api/src/modules/wallets/wallets.service.js')).WalletsService)
        .own(f.admin.id)
    ).id;
    await page.getByText(walletId, { exact: true }).first().waitFor();
    await page.setViewportSize({ width: 360, height: 800 });
    assert.equal(await page.evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    await mkdir('.local/test-results/p2p-enhancements', { recursive: true });
    await page.screenshot({
      path: '.local/test-results/p2p-enhancements/receive-mobile.png',
      fullPage: true,
    });
  },
);
When(
  'I save wallet settings while a send draft is unfinished',
  { timeout: 30000 },
  async function (this: ConsumerWorld) {
    const { page, f } = this.setupBrowser!;
    await task(page, 'Send');
    await page.getByLabel('Recipient public handle').fill('setup_bob');
    await page.getByLabel('Quantity', { exact: true }).fill('1.25');
    await page.getByText('Editable draft saved in this tab.', { exact: false }).waitFor();
    await task(page, 'Settings');
    await page.getByLabel('Wallet name', { exact: true }).fill('Consumer saved preference');
    await page.getByLabel('Default asset', { exact: true }).selectOption(f.asset._id.toHexString());
    await page.getByRole('button', { name: 'Save wallet setup', exact: true }).click();
    await page.getByText('Wallet setup complete', { exact: true }).waitFor();
  },
);
Then(
  'the editable send draft survives settings, Back and reload',
  { timeout: 30000 },
  async function (this: ConsumerWorld) {
    const page = this.setupBrowser!.page;
    await page.goBack();
    await page.getByRole('heading', { name: 'Send demo units', exact: true }).waitFor();
    for (const reload of [false, true]) {
      if (reload) {
        await page.reload();
        await page.getByRole('heading', { name: 'Send demo units', exact: true }).waitFor();
      }
      assert.equal(await page.getByLabel('Recipient public handle').inputValue(), 'setup_bob');
      assert.equal(await page.getByLabel('Quantity', { exact: true }).inputValue(), '1.25');
    }
    await mkdir('.local/test-results/p2p-enhancements', { recursive: true });
    await page.screenshot({
      path: '.local/test-results/p2p-enhancements/draft-retained.png',
      fullPage: true,
    });
  },
);
When(
  'I sign out with an editable send draft and register another consumer',
  { timeout: 30000 },
  async function (this: ConsumerWorld) {
    const page = this.setupBrowser!.page;
    await task(page, 'Send');
    await page.getByLabel('Recipient public handle').fill('private_peer');
    await page.getByLabel('Quantity', { exact: true }).fill('3.25');
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByRole('heading', { name: 'Sign in to your account', exact: true }).waitFor();
    assert.equal(await page.evaluate((key) => sessionStorage.getItem(key), SEND_DRAFT_KEY), null);
    await page.getByRole('button', { name: 'Create an account', exact: true }).click();
    await page.getByLabel('Email', { exact: true }).fill('consumer_new@example.invalid');
    await page.getByLabel('Public handle', { exact: true }).fill('consumer_new');
    await page
      .getByLabel('Password', { exact: true })
      .fill('Controlled-new-consumer-password-2026');
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await page.getByRole('heading', { name: 'Your workspace', exact: true }).waitFor();
  },
);
Then(
  'the new identity has an empty draft and useful Home navigation',
  async function (this: ConsumerWorld) {
    const { page, f } = this.setupBrowser!;
    await page.getByRole('link', { name: 'Receive demo units', exact: true }).waitFor();
    await task(page, 'Send');
    assert.equal(await page.getByLabel('Recipient public handle').inputValue(), '');
    assert.equal(await page.getByLabel('Quantity', { exact: true }).inputValue(), '');
    assert.equal((await page.content()).includes('private_peer'), false);
    const user = await f.h.database.db
      .collection('users')
      .findOne({ publicHandle: 'consumer_new' });
    assert.ok(user);
    assert.equal(
      await f.h.database.db.collection('wallets').countDocuments({ userId: user._id }),
      1,
    );
    assert.equal(
      await f.h.database.db.collection('accounts').countDocuments({ userId: user._id }),
      0,
    );
  },
);
