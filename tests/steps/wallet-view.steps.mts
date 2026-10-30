import assert from 'node:assert/strict';
import { When, Then } from '@cucumber/cucumber';
import type { Page } from 'playwright-core';

interface WalletViewWorld {
  setupBrowser?: { page: Page };
}
const legacyButton = (page: Page) =>
  page.getByRole('button', { name: 'Legacy simulated wallets', exact: true });
const networkButton = (page: Page) =>
  page.getByRole('button', { name: 'Network / testnet wallets', exact: true });

When(
  'I reload the Wallet task without selecting legacy wallets',
  async function (this: WalletViewWorld) {
    const page = this.setupBrowser!.page;
    await page.getByRole('link', { name: 'Wallet', exact: true }).click();
    await page.reload();
    await networkButton(page).waitFor();
  },
);
Then(
  'network wallets are selected and legacy controls are absent',
  async function (this: WalletViewWorld) {
    const page = this.setupBrowser!.page;
    assert.equal(await networkButton(page).getAttribute('aria-pressed'), 'true');
    assert.equal(await legacyButton(page).getAttribute('aria-pressed'), 'false');
    assert.equal(
      await page.getByRole('button', { name: 'Connect crypto wallet', exact: true }).isVisible(),
      true,
    );
    assert.equal(await page.locator('.wallet-balances').count(), 0);
    assert.equal(await page.getByLabel('Wallet name', { exact: true }).count(), 0);
    assert.equal(await page.getByLabel('Recipient public handle').count(), 0);
  },
);
When(
  'I select legacy wallets in the wallet display options',
  async function (this: WalletViewWorld) {
    await legacyButton(this.setupBrowser!.page).click();
  },
);
Then(
  'legacy balances are available and network controls are hidden',
  async function (this: WalletViewWorld) {
    const page = this.setupBrowser!.page;
    await page.getByRole('button', { name: 'Refresh balances', exact: true }).waitFor();
    assert.equal(await legacyButton(page).getAttribute('aria-pressed'), 'true');
    assert.equal(
      await page.getByRole('button', { name: 'Connect crypto wallet', exact: true }).isVisible(),
      false,
    );
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    assert.equal(await page.getByLabel('Wallet name', { exact: true }).isVisible(), true);
  },
);
When(
  'I change wallet views with a legacy draft on a narrow screen',
  async function (this: WalletViewWorld) {
    const page = this.setupBrowser!.page;
    await page.setViewportSize({ width: 360, height: 800 });
    await page.getByLabel('Recipient public handle').fill('draft_peer');
    await page.getByLabel('Quantity', { exact: true }).fill('2.50');
    await networkButton(page).focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.getByLabel('Recipient public handle').isVisible(), false);
    assert.equal(
      await page.getByRole('button', { name: 'Connect crypto wallet', exact: true }).isVisible(),
      true,
    );
    await legacyButton(page).focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  },
);
Then(
  'the draft is retained and reloading returns to network wallets',
  async function (this: WalletViewWorld) {
    const page = this.setupBrowser!.page;
    assert.equal(await page.getByLabel('Recipient public handle').inputValue(), 'draft_peer');
    assert.equal(await page.getByLabel('Quantity', { exact: true }).inputValue(), '2.50');
    await page.reload();
    await networkButton(page).waitFor();
    assert.equal(await networkButton(page).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.getByLabel('Recipient public handle').count(), 0);
    await legacyButton(page).click();
    assert.equal(await page.getByLabel('Recipient public handle').inputValue(), 'draft_peer');
  },
);
When(
  'I sign out after selecting legacy wallets and register a new wallet viewer',
  async function (this: WalletViewWorld) {
    const page = this.setupBrowser!.page;
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByRole('button', { name: 'Create an account', exact: true }).click();
    await page.getByLabel('Email', { exact: true }).fill('wallet_viewer@example.invalid');
    await page.getByLabel('Public handle', { exact: true }).fill('wallet_viewer');
    await page.getByLabel('Password', { exact: true }).fill('Controlled-wallet-viewer-pass-2026');
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await page.getByRole('link', { name: 'Wallet', exact: true }).click();
  },
);
Then('the new wallet viewer starts with network wallets', async function (this: WalletViewWorld) {
  const page = this.setupBrowser!.page;
  assert.equal(await networkButton(page).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.getByLabel('Recipient public handle').count(), 0);
  assert.equal(await page.locator('.wallet-balances').count(), 0);
});
