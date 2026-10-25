import assert from 'node:assert/strict';
import { After, Given, Then, When, type World } from '@cucumber/cucumber';
import { browserAsset, WalletBrowser } from '../support/wallet-browser.mjs';

interface BrowserWorld extends World {
  walletBrowser: WalletBrowser;
}
Given(
  'a browser wallet with {string} assets',
  { timeout: 60000 },
  async function (this: BrowserWorld, state: string) {
    this.walletBrowser = new WalletBrowser();
    await this.walletBrowser.start(state);
  },
);
After({ tags: '@wallet_browser', timeout: 15000 }, async function (this: BrowserWorld) {
  await this.walletBrowser?.close();
});
When('I type recipient and quantity in the wallet', async function (this: BrowserWorld) {
  await this.walletBrowser.typeDetails();
});
Then('the browser wallet explains {string}', async function (this: BrowserWorld, message: string) {
  await this.walletBrowser.page.getByText(message, { exact: false }).first().waitFor();
});
Then('transfer review is disabled without sending a transfer', async function (this: BrowserWorld) {
  assert.equal(
    await this.walletBrowser.page.getByRole('button', { name: 'Review transfer' }).isDisabled(),
    true,
  );
  assert.equal(this.walletBrowser.posts.length, 0);
  assert.equal(this.walletBrowser.peerReads, 0);
});
When('I review and edit the browser transfer', async function (this: BrowserWorld) {
  const { page, posts } = this.walletBrowser;
  await page.getByRole('button', { name: 'Review transfer' }).click();
  await page.getByRole('heading', { name: 'Review your transfer' }).waitFor();
  assert.match(await page.locator('.transfer-review').innerText(), /Bob \(@bob\)/);
  assert.match(await page.locator('.transfer-review').innerText(), /3\.25/);
  assert.equal(posts.length, 0, 'Review must not submit');
  await page.getByRole('button', { name: 'Edit transfer' }).click();
  assert.equal(await page.getByLabel('Quantity', { exact: true }).inputValue(), '3.25');
  await page.getByRole('button', { name: 'Review transfer' }).click();
});
When('I confirm the browser transfer', async function (this: BrowserWorld) {
  await this.walletBrowser.page.getByRole('button', { name: 'Confirm transfer' }).click();
});
Then(
  'the browser shows one completed transfer and the refreshed balance',
  async function (this: BrowserWorld) {
    const { page, posts } = this.walletBrowser;
    await page.getByRole('heading', { name: 'Transfer complete' }).waitFor();
    await page.locator('.wallet-balances').getByText('6.75', { exact: true }).waitFor();
    assert.equal(posts.length, 1);
    assert.deepEqual(posts[0]!.body, {
      senderWalletId: '666666666666666666666666',
      recipientResolutionId: '777777777777777777777777',
      assetId: browserAsset.assetId,
      quantity: '3.25',
    });
    assert.match(posts[0]!.key ?? '', /^[a-f0-9-]{36}$/);
    await page.getByRole('button', { name: 'Start another transfer' }).click();
    await page.getByLabel('Quantity', { exact: true }).fill('1.00');
    assert.equal(await page.getByLabel('Quantity', { exact: true }).inputValue(), '1.00');
  },
);
When(
  'I type an invalid quantity and review the browser transfer',
  async function (this: BrowserWorld) {
    await this.walletBrowser.typeDetails('1.001');
    await this.walletBrowser.page.getByRole('button', { name: 'Review transfer' }).click();
  },
);
Then(
  'the browser explains the quantity error without submitting',
  async function (this: BrowserWorld) {
    const { page, posts, peerReads } = this.walletBrowser;
    await page.getByRole('alert').getByText('Use at most 2 decimal places.').waitFor();
    assert.equal(posts.length, 0);
    assert.equal(peerReads, 0);
    await page.getByLabel('Quantity', { exact: true }).fill('1.00');
    assert.equal(await page.getByLabel('Quantity', { exact: true }).inputValue(), '1.00');
  },
);
When('active assets become available and I refresh balances', async function (this: BrowserWorld) {
  this.walletBrowser.accounts = [{ ...browserAsset }];
  this.walletBrowser.failAccounts = false;
  await this.walletBrowser.page.getByRole('button', { name: 'Refresh balances' }).click();
});
When('the browser balances finish loading', function (this: BrowserWorld) {
  this.walletBrowser.releaseAccounts!();
});
When(
  'the selected asset becomes disabled and I refresh balances',
  async function (this: BrowserWorld) {
    this.walletBrowser.accounts = [
      { ...browserAsset, status: 'disabled' },
      { ...browserAsset, assetId: '555555555555555555555555', code: 'NEXT' },
    ];
    await this.walletBrowser.page.getByRole('button', { name: 'Refresh balances' }).click();
  },
);
Then('the typed browser details can be reviewed', async function (this: BrowserWorld) {
  const { page } = this.walletBrowser;
  assert.equal(await page.getByLabel('Recipient public handle').inputValue(), 'bob');
  assert.equal(await page.getByLabel('Quantity', { exact: true }).inputValue(), '3.25');
  await page.getByRole('button', { name: 'Review transfer' }).click();
  await page.getByRole('heading', { name: 'Review your transfer' }).waitFor();
  assert.equal(this.walletBrowser.posts.length, 0);
});
