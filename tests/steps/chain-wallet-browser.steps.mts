import type { TransactionRequest } from 'ethers';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { Given, When, Then, After } from '@cucumber/cucumber';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import { createChainHarness, type ChainHarness } from '../support/chain-harness.mjs';
interface BrowserWorld {
  evmBrowser?: {
    f: ChainHarness;
    web: ViteDevServer;
    browser: Browser;
    page: Page;
    errors: string[];
  };
}
Given(
  'a browser connected to an isolated real EVM and API',
  { timeout: 120000 },
  async function (this: BrowserWorld) {
    const f = await createChainHarness();
    const web = await createServer({
      configFile: 'apps/web/vite.config.ts',
      root: 'apps/web',
      logLevel: 'error',
      server: {
        host: '127.0.0.1',
        port: 0,
        proxy: { '/api': { target: await f.h.app.getUrl(), changeOrigin: true } },
      },
    });
    await web.listen();
    const endpoint = web.httpServer!.address();
    assert.ok(endpoint && typeof endpoint === 'object');
    const url = `http://127.0.0.1:${endpoint.port}`;
    f.h.environment.WEB_ORIGIN = url;
    const browser = await chromium.launch({
      headless: true,
      ...(process.env.P2P_TEST_BROWSER_EXECUTABLE
        ? { executablePath: process.env.P2P_TEST_BROWSER_EXECUTABLE }
        : { channel: 'chrome' }),
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(20000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.context().addCookies(
      [...f.alice.jar].map(([name, value]) => ({
        name,
        value,
        url,
        httpOnly: true,
        sameSite: 'Lax' as const,
      })),
    );
    await page.exposeFunction(
      'evmRequest',
      async (input: { method: string; params?: unknown[] }) => {
        if (['eth_requestAccounts', 'eth_accounts'].includes(input.method))
          return [f.signer.address];
        if (input.method === 'eth_chainId') return f.provider.send('eth_chainId', []);
        if (input.method === 'eth_sendTransaction')
          return (
            await (
              await f.provider.getSigner()
            ).sendTransaction(input.params![0] as TransactionRequest)
          ).hash;
        throw new Error('Unexpected browser wallet method');
      },
    );
    await page.addInitScript(
      'globalThis.ethereum = {request: function(input) {return globalThis.evmRequest(input);}};',
    );
    this.evmBrowser = { f, web, browser, page, errors };
    await page.goto(`${url}/#/wallet`);
    await page.getByRole('heading', { name: 'ERC-20 test tokens', exact: true }).waitFor();
  },
);
When(
  'I deploy a faucet token and import it through the wallet UI',
  { timeout: 120000 },
  async function (this: BrowserWorld) {
    const { page } = this.evmBrowser!;
    await page.getByRole('button', { name: 'Deploy test faucet token', exact: true }).click();
    await page
      .getByText('Transaction recorded.', { exact: false })
      .waitFor()
      .catch(async () => {
        throw new Error((await page.getByRole('alert').allTextContents()).join('; '));
      });
    await page
      .getByRole('button', { name: 'Refresh chain history and balances', exact: true })
      .click();
    await page.getByRole('button', { name: /Use deployed token address/ }).click();
    await page.getByRole('button', { name: 'Import ERC-20 token', exact: true }).click();
    await page.getByText('Token imported from the verified network.', { exact: true }).waitFor();
    await page
      .getByRole('button', {
        name: 'I checked wallet activity; allow a new transaction',
        exact: true,
      })
      .click();
  },
);
When(
  'I transfer test tokens through the browser wallet',
  { timeout: 120000 },
  async function (this: BrowserWorld) {
    const { page, f } = this.evmBrowser!;
    await page.getByLabel('Token recipient address', { exact: true }).fill(f.recipient.address);
    await page.getByLabel('Token amount', { exact: true }).fill('2.5');
    await page
      .getByRole('button', { name: 'Review token transfer in wallet', exact: true })
      .click();
    await page
      .getByText('Transaction recorded.', { exact: false })
      .waitFor()
      .catch(async () => {
        throw new Error((await page.getByRole('alert').allTextContents()).join('; '));
      });
    await page
      .getByRole('button', { name: 'Refresh chain history and balances', exact: true })
      .click();
    await page
      .getByRole('region', { name: 'On-chain assets and history', exact: true })
      .locator('li')
      .filter({ hasText: '2.5 OGT' })
      .getByText('ERC20 · MINED', { exact: true })
      .waitFor();
  },
);
Then(
  'the actual token balance and indexed transfer survive browser reload',
  { timeout: 120000 },
  async function (this: BrowserWorld) {
    const { page, f } = this.evmBrowser!;
    await page.reload();
    await page
      .getByRole('region', { name: 'On-chain assets and history', exact: true })
      .locator('li')
      .filter({ hasText: '2.5 OGT' })
      .getByText('ERC20 · MINED', { exact: true })
      .waitFor();
    const tokens = await f.h.database.db
      .collection('chainTokens')
      .find({ bindingId: f.binding })
      .toArray();
    assert.equal(tokens.length, 1);
    const events = await f.h.database.db
      .collection('chainActivity')
      .find({ bindingId: f.binding, kind: 'ERC20', to: f.recipient.address.toLowerCase() })
      .toArray();
    assert.equal(events.length, 1);
    assert.equal(events[0]!.amountUnits, '2500000000000000000');
    await page.getByText(/997.5/).first().waitFor();
    assert.equal(await f.h.accounts.issuances.countDocuments(), 0);
    await mkdir('.local/test-results/chain-wallet', { recursive: true });
    await page.screenshot({
      path: '.local/test-results/chain-wallet/real-evm.png',
      fullPage: true,
    });
    await page.getByRole('link', { name: 'Activity', exact: true }).click();
    await page.getByRole('heading', { name: 'On-chain Activity', exact: true }).waitFor();
    await page
      .getByRole('region', { name: 'On-chain Activity', exact: true })
      .locator('li')
      .filter({ hasText: '2.5 OGT' })
      .waitFor();
    assert.deepEqual(this.evmBrowser!.errors, []);
  },
);
After({ tags: '@chain_wallet_browser', timeout: 30000 }, async function (this: BrowserWorld) {
  const b = this.evmBrowser;
  if (!b) return;
  try {
    await b.browser.close();
  } finally {
    try {
      await b.web.close();
    } finally {
      await b.f.close();
    }
  }
});
