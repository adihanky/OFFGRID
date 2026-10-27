import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { When, Then } from '@cucumber/cucumber';
import type { Page } from 'playwright-core';

interface NavigationWorld {
  setupBrowser?: { page: Page };
}
async function active(page: Page, label: string) {
  await page.waitForFunction(
    `document.querySelector('.primary-navigation [aria-current="page"]')?.textContent === ${JSON.stringify(label)}`,
  );
  assert.equal(await page.locator('.workspace-content > div:visible').count(), 1);
}
When(
  'I switch workspace tasks with an unfinished transfer',
  async function (this: NavigationWorld) {
    const page = this.setupBrowser!.page;
    await page.getByLabel('Recipient public handle').fill('navigation_peer');
    await page.getByLabel('Quantity', { exact: true }).fill('2.50');
    await page.getByRole('link', { name: 'Assets', exact: true }).click();
    await active(page, 'Assets');
    assert.equal(await page.getByLabel('Recipient public handle').isVisible(), false);
    assert.equal(await page.getByRole('region', { name: 'Application modules' }).count(), 0);
  },
);
Then(
  'browser Back restores the wallet with my transfer draft',
  async function (this: NavigationWorld) {
    const page = this.setupBrowser!.page;
    await page.goBack();
    await active(page, 'Send');
    assert.equal(await page.getByLabel('Recipient public handle').inputValue(), 'navigation_peer');
    assert.equal(await page.getByLabel('Quantity', { exact: true }).inputValue(), '2.50');
    await page.goForward();
    await active(page, 'Assets');
  },
);
Then(
  'reloading a bookmarked task opens only that task',
  { timeout: 30000 },
  async function (this: NavigationWorld) {
    const page = this.setupBrowser!.page;
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await page.getByLabel('Wallet name', { exact: true }).fill('Unsaved navigation draft');
    await page.getByRole('link', { name: 'Assets', exact: true }).click();
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    assert.equal(
      await page.getByLabel('Wallet name', { exact: true }).inputValue(),
      'Unsaved navigation draft',
    );
    await page.reload();
    await page.getByLabel('Wallet name', { exact: true }).waitFor();
    await active(page, 'Settings');
    assert.match(page.url(), /#\/settings$/);
    await page.goto(`${new URL(page.url()).origin}/#wallet-setup-title`);
    await page.reload();
    await page.getByLabel('Wallet name', { exact: true }).waitFor();
    await active(page, 'Settings');
    assert.match(page.url(), /#wallet-setup-title$/);
  },
);
When('I open an unknown workspace bookmark', async function (this: NavigationWorld) {
  const page = this.setupBrowser!.page;
  await page.goto(`${new URL(page.url()).origin}/#not-a-task`);
});
Then(
  'only Home is visible and sign-out clears workspace navigation',
  async function (this: NavigationWorld) {
    const page = this.setupBrowser!.page;
    await active(page, 'Home');
    await page.getByRole('link', { name: 'Administration', exact: true }).click();
    await active(page, 'Administration');
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByRole('heading', { name: 'Sign in to your account', exact: true }).waitFor();
    assert.equal(new URL(page.url()).hash, '');
    assert.equal(await page.getByRole('navigation', { name: 'Workspace navigation' }).count(), 0);
    assert.equal(await page.getByLabel('Recipient public handle').count(), 0);
  },
);
When(
  'I navigate the workspace with a keyboard on a narrow screen',
  async function (this: NavigationWorld) {
    const page = this.setupBrowser!.page;
    await page.setViewportSize({ width: 360, height: 800 });
    const link = page.getByRole('link', { name: 'Settings', exact: true });
    await link.focus();
    await page.keyboard.press('Enter');
    await active(page, 'Settings');
    assert.equal(
      await page.evaluate(
        'document.querySelector(".workspace-content") === document.activeElement',
      ),
      true,
    );
  },
);
Then(
  'all workspace tasks fit the viewport and the active task is announced',
  async function (this: NavigationWorld) {
    const page = this.setupBrowser!.page;
    for (const label of [
      'Home',
      'Wallet',
      'Send',
      'Activity',
      'Settings',
      'Assets',
      'Help',
      'Administration',
    ]) {
      await page
        .getByRole('navigation', { name: 'Workspace navigation' })
        .getByRole('link', { name: label, exact: true })
        .click();
      await active(page, label);
      assert.equal(await page.evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    }
    await mkdir('.local/test-results/frontend-streamline', { recursive: true });
    await page.screenshot({
      path: '.local/test-results/frontend-streamline/mobile.png',
      fullPage: true,
    });
  },
);
When('I open administration from the focused workspace', async function (this: NavigationWorld) {
  const page = this.setupBrowser!.page;
  await page.getByRole('link', { name: 'Administration', exact: true }).click();
  await active(page, 'Administration');
});
