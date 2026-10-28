import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { After, Given, When, Then } from '@cucumber/cucumber';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createServer as createVite, type ViteDevServer } from 'vite';
import { getBytes } from 'ethers';
import { ObjectId } from 'mongodb';
import {
  createWalletSetupHarness,
  type WalletSetupHarness,
  setupFixtureToken,
} from '../support/wallet-setup-harness.mjs';
import type { EthereumProvider } from '../../apps/web/src/external-wallet-client.js';
interface SetupBrowserWorld {
  setupBrowser?: {
    f: WalletSetupHarness;
    browser: Browser;
    web: ViteDevServer;
    page: Page;
    errors: string[];
  };
  submitted?: unknown[][];
  secondRpc?: Server;
  secondRpcUrl?: string;
}
Given(
  'a real wallet setup browser for a(n) {string}',
  { timeout: 120000 },
  async function (this: SetupBrowserWorld, role: string) {
    const f = await createWalletSetupHarness();
    if (role === 'first administrator') {
      // Only this disposable fixture: model an installation with an unused bootstrap token.
      await f.h.database.db.collection('roleGrants').deleteMany({});
      await f.h.database.db.collection('applicationState').deleteOne({ key: 'admin-setup' });
    }
    const web = await createVite({
      configFile: 'apps/web/vite.config.ts',
      root: 'apps/web',
      logLevel: 'error',
      server: {
        host: '127.0.0.1',
        port: 0,
        strictPort: false,
        open: false,
        proxy: { '/api': { target: await f.h.app.getUrl(), changeOrigin: true } },
      },
    });
    await web.listen();
    const address = web.httpServer!.address();
    assert.ok(address && typeof address === 'object');
    const url = `http://127.0.0.1:${address.port}`;
    f.h.environment.WEB_ORIGIN = url;
    const browser = await chromium.launch({
      headless: true,
      ...(process.env.P2P_TEST_BROWSER_EXECUTABLE
        ? { executablePath: process.env.P2P_TEST_BROWSER_EXECUTABLE }
        : { channel: process.env.P2P_TEST_BROWSER_CHANNEL ?? 'chrome' }),
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(20000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    if (role === 'asset administrator')
      await page.context().addCookies(
        [...f.admin.jar].map(([name, value]) => ({
          name,
          value,
          url,
          httpOnly: true,
          sameSite: 'Lax' as const,
        })),
      );
    await page.exposeFunction(
      'controlledWalletRequest',
      async (input: { method: string; params?: unknown[] }) => {
        if (['eth_requestAccounts', 'eth_accounts'].includes(input.method))
          return [f.signer.address];
        if (input.method === 'eth_chainId') return f.rpcState.chainId;
        if (input.method === 'eth_sendTransaction') {
          (this.submitted ??= []).push(input.params!);
          return `0x${'ab'.repeat(32)}`;
        }
        if (input.method === 'personal_sign')
          return f.signer.signMessage(getBytes(input.params![0] as string));
        throw new Error('Unexpected wallet provider method');
      },
    );
    // Keep tsx's Node-side function-name helper out of browser serialization.
    await page.addInitScript(
      'globalThis.ethereum = { request: function(input) { return globalThis.controlledWalletRequest(input); } };',
    );
    this.setupBrowser = { f, browser, web, page, errors };
    await page.goto(role === 'asset administrator' ? `${url}/#/send` : url);
    if (role === 'asset administrator')
      await page.getByRole('heading', { name: 'Send demo units', exact: true }).waitFor();
  },
);
When(
  'I register and open wallet setup from the main navigation',
  { timeout: 60000 },
  async function (this: SetupBrowserWorld) {
    const page = this.setupBrowser!.page;
    await page.getByRole('button', { name: 'Create an account', exact: true }).click();
    await page.getByLabel('Email', { exact: true }).fill('setup_browser@example.invalid');
    await page.getByLabel('Public handle', { exact: true }).fill('setup_browser');
    await page.getByLabel('Password', { exact: true }).fill('Controlled-setup-browser-pass-2026');
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await page.getByRole('heading', { name: 'Set up your wallet', exact: true }).waitFor();
    assert.match(page.url(), /#\/settings$/);
  },
);
When(
  'I save my wallet name and default asset in the browser',
  { timeout: 30000 },
  async function (this: SetupBrowserWorld) {
    const page = this.setupBrowser!.page;
    await page.getByLabel('Wallet name', { exact: true }).fill('My browser wallet');
    await page
      .getByLabel('Default asset', { exact: true })
      .selectOption(this.setupBrowser!.f.asset._id.toHexString());
    await page.getByRole('button', { name: 'Save wallet setup', exact: true }).click();
    await page.getByText('Wallet setup complete', { exact: true }).waitFor();
  },
);
When(
  'I connect and sign with a controlled external wallet provider',
  { timeout: 60000 },
  async function (this: SetupBrowserWorld) {
    const page = this.setupBrowser!.page;
    await page.getByRole('button', { name: 'Connect crypto wallet', exact: true }).click();
    await page.getByText('Ownership verified', { exact: true }).waitFor();
  },
);
Then(
  'wallet preferences and verified ownership survive a browser reload',
  { timeout: 30000 },
  async function (this: SetupBrowserWorld) {
    const { page, f } = this.setupBrowser!;
    await page.reload();
    await page.getByText('Wallet setup complete', { exact: true }).waitFor();
    assert.equal(
      await page.getByLabel('Wallet name', { exact: true }).inputValue(),
      'My browser wallet',
    );
    assert.equal(
      await page.getByLabel('Default asset', { exact: true }).inputValue(),
      f.asset._id.toHexString(),
    );
    await page.getByText('Ownership verified', { exact: true }).waitFor();
    await page.getByText(f.signer.address, { exact: true }).waitFor();
    assert.equal(await f.h.database.db.collection('walletBindings').countDocuments(), 1);
    assert.ok(!(await page.content()).includes(f.signer.privateKey));
    await mkdir('.local/test-results/wallet-setup', { recursive: true });
    await page.screenshot({
      path: '.local/test-results/wallet-setup/new-user-setup.png',
      fullPage: true,
    });
  },
);
When(
  'I open asset configuration and create and activate a new demo asset',
  { timeout: 60000 },
  async function (this: SetupBrowserWorld) {
    const page = this.setupBrowser!.page;
    await page.getByRole('link', { name: 'Assets', exact: true }).click();
    await page.getByRole('link', { name: 'Manage assets', exact: true }).click();
    await page.getByRole('button', { name: 'Assets & issuance', exact: true }).click();
    for (const [label, value] of [
      ['Asset code', 'UICFG'],
      ['Symbol', 'UICFG'],
      ['Asset name', 'UI configured coin'],
      ['Supply cap', '1000.00'],
      ['Minimum transfer', '0.01'],
      ['Maximum transfer', '1000.00'],
      ['Asset change reason', 'Browser asset configuration'],
    ])
      await page.getByLabel(label!, { exact: true }).fill(value!);
    await page.getByRole('button', { name: 'Create draft', exact: true }).click();
    await page.getByRole('button', { name: 'Manage UICFG', exact: true }).click();
    await page.getByLabel('Asset change reason').fill('Activate verified fixture');
    await page.getByRole('button', { name: 'Verify & activate', exact: true }).click();
    await page.getByText('Asset active.', { exact: true }).waitFor();
  },
);
When(
  'I add a verified local EVM network through the network form',
  { timeout: 60000 },
  async function (this: SetupBrowserWorld) {
    const server = (this.secondRpc = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => {
        body += String(chunk);
      });
      request.on('end', () => {
        const message = JSON.parse(body) as { id: string; method: string };
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            result: message.method === 'eth_chainId' ? '0x7a6a' : { hash: `0x${'34'.repeat(32)}` },
          }),
        );
      });
    }));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    this.secondRpcUrl = `http://127.0.0.1:${address.port}/`;
    const page = this.setupBrowser!.page;
    await page.getByRole('button', { name: 'Networks', exact: true }).click();
    await page.getByLabel('Network name', { exact: true }).fill('Browser configured EVM');
    await page.getByLabel('Expected chain ID').fill('31338');
    await page.getByLabel('Network environment').selectOption('LOCAL');
    await page.getByLabel('Public RPC URL').fill(this.secondRpcUrl);
    await page.getByLabel('Network change reason').fill('Verify controlled local provider');
    await page.getByRole('button', { name: 'Verify & add network', exact: true }).click();
    await page
      .getByText('Network identity verified and configuration saved.', { exact: true })
      .waitFor();
  },
);
Then(
  'the asset and network configurations are persisted and visible in the browser',
  { timeout: 60000 },
  async function (this: SetupBrowserWorld) {
    const { f, page } = this.setupBrowser!;
    assert.equal((await f.h.accounts.assets.findOne({ code: 'UICFG' }))!.lifecycle, 'ACTIVE');
    assert.equal(
      await f.h.database.db
        .collection('networks')
        .countDocuments({ chainId: '31338', status: 'ACTIVE' }),
      1,
    );
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await page
      .getByLabel('Wallet network')
      .selectOption({ label: 'Browser configured EVM · local · chain 31338' });
    await page.getByRole('link', { name: 'Administration', exact: true }).click();
    await page
      .getByRole('button', { name: 'Manage network Browser configured EVM', exact: true })
      .click();
    assert.equal(await page.getByLabel('Expected chain ID').isDisabled(), true);
    await page.getByLabel('Network name', { exact: true }).fill('Renamed browser EVM');
    await page.getByLabel('Network change reason').fill('Update provider display policy');
    await page.getByRole('button', { name: 'Verify & save network', exact: true }).click();
    await page.getByRole('button', { name: 'Verify & add network', exact: true }).waitFor();
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await page
      .getByLabel('Wallet network')
      .selectOption({ label: 'Renamed browser EVM · local · chain 31338' });
    assert.equal(
      await f.h.database.db
        .collection('networks')
        .countDocuments({ chainId: '31338', displayName: 'Renamed browser EVM' }),
      1,
    );
    await mkdir('.local/test-results/wallet-setup', { recursive: true });
    await page.screenshot({
      path: '.local/test-results/wallet-setup/asset-network-ui.png',
      fullPage: true,
    });
  },
);
When(
  'no external wallet provider is available in the browser',
  async function (this: SetupBrowserWorld) {
    const page = this.setupBrowser!.page;
    await page.evaluate(() => {
      delete (globalThis as unknown as { ethereum?: EthereumProvider }).ethereum;
    });
    await page.getByRole('button', { name: 'Connect crypto wallet', exact: true }).click();
  },
);
Then(
  'the UI explains manual linking and administrator-only asset configuration',
  async function (this: SetupBrowserWorld) {
    const { page, f } = this.setupBrowser!;
    await page
      .getByRole('alert')
      .getByText('No EVM wallet was detected.', { exact: false })
      .waitFor();
    await page.getByText('Use a manually signed ownership message', { exact: true }).waitFor();
    await page.getByRole('link', { name: 'Assets', exact: true }).click();
    await page.getByRole('link', { name: 'Request asset access', exact: true }).click();
    await page.getByRole('heading', { name: 'Help', exact: true }).waitFor();
    await page
      .getByRole('navigation', { name: 'Workspace navigation' })
      .getByRole('link', { name: 'Administration', exact: true })
      .click();
    await page
      .getByText('Asset and network configuration requires an ASSET_ADMIN grant.', { exact: false })
      .waitFor();
    assert.equal(await page.getByRole('button', { name: 'Create draft', exact: true }).count(), 0);
    assert.equal(await f.h.database.db.collection('walletBindings').countDocuments(), 0);
  },
);
When(
  'I create an account through the administrator setup entry',
  { timeout: 60000 },
  async function (this: SetupBrowserWorld) {
    const page = this.setupBrowser!.page;
    await page.getByText('Set up administrator account', { exact: true }).click();
    await page.getByRole('button', { name: 'Create administrator account', exact: true }).click();
    await page.getByLabel('Email', { exact: true }).fill('admin_browser@example.invalid');
    await page.getByLabel('Public handle', { exact: true }).fill('admin_browser');
    await page.getByLabel('Password', { exact: true }).fill('Controlled-admin-browser-pass-2026');
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await page.getByRole('link', { name: 'Admin account', exact: true }).click();
    await page.locator('details[open] > #admin-account-title').waitFor();
  },
);
When(
  'I submit an invalid installation token then the valid setup token',
  { timeout: 60000 },
  async function (this: SetupBrowserWorld) {
    const { page, f } = this.setupBrowser!;
    await page.getByLabel('Installation setup token').fill('invalid-controlled-token');
    await page.getByRole('button', { name: 'Enable administration', exact: true }).click();
    await page
      .getByRole('alert')
      .getByText('Setup token is unavailable or invalid.', { exact: true })
      .waitFor();
    assert.equal(await f.h.database.db.collection('roleGrants').countDocuments(), 0);
    await page.getByLabel('Installation setup token').fill(setupFixtureToken);
    await page.getByRole('button', { name: 'Enable administration', exact: true }).click();
    await page.getByText('Administration enabled for your account.', { exact: true }).waitFor();
  },
);
Then(
  'the new account has persisted administrator access and the setup token is cleared',
  { timeout: 30000 },
  async function (this: SetupBrowserWorld) {
    const { page, f } = this.setupBrowser!;
    const identity = await page.request.get(`${new URL(page.url()).origin}/api/auth/me`);
    assert.equal(identity.status(), 200);
    const current = (await identity.json()) as { user: { id: string } };
    const user = await f.h.database.db
      .collection('users')
      .findOne({ _id: new ObjectId(current.user.id) });
    assert.ok(user);
    assert.equal(
      await f.h.database.db
        .collection('roleGrants')
        .countDocuments({ userId: user._id, status: 'ACTIVE' }),
      4,
    );
    assert.equal(await page.getByLabel('Installation setup token').count(), 0);
    assert.equal(
      await page.evaluate(
        (token) => JSON.stringify({ ...localStorage, ...sessionStorage }).includes(token),
        setupFixtureToken,
      ),
      false,
    );
    const repeated = await f.h.request(f.alice, '/api/v2/admin/setup', 'POST', {
      token: setupFixtureToken,
    });
    assert.equal(repeated.status, 409);
    assert.equal(
      await f.h.database.db
        .collection('roleGrants')
        .countDocuments({ userId: new ObjectId(f.alice.id) }),
      0,
    );
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByRole('heading', { name: 'Sign in to your account', exact: true }).waitFor();
    await page.getByLabel('Email', { exact: true }).fill('admin_browser@example.invalid');
    await page.getByLabel('Password', { exact: true }).fill('Controlled-admin-browser-pass-2026');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('link', { name: 'Admin account', exact: true }).click();
    await page.getByText('Your administrator access is active.', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Assets & issuance', exact: true }).waitFor();
  },
);
Then(
  'admin account setup explains the role grant requirement without offering bootstrap',
  async function (this: SetupBrowserWorld) {
    const { page, f } = this.setupBrowser!;
    await page
      .getByText('This account does not have administrator access.', { exact: false })
      .waitFor();
    assert.equal(await page.getByLabel('Installation setup token').count(), 0);
    assert.equal(
      await page
        .getByRole('button', { name: 'Manage administrator accounts', exact: true })
        .count(),
      0,
    );
    const identity = await page.request.get(`${new URL(page.url()).origin}/api/auth/me`);
    assert.equal(identity.status(), 200);
    const current = (await identity.json()) as { user: { id: string } };
    const user = await f.h.database.db
      .collection('users')
      .findOne({ _id: new ObjectId(current.user.id) });
    assert.ok(user);
    assert.equal(
      await f.h.database.db.collection('roleGrants').countDocuments({ userId: user._id }),
      0,
    );
  },
);
When(
  'I open administrator account management from the main navigation',
  async function (this: SetupBrowserWorld) {
    const page = this.setupBrowser!.page;
    await page.getByRole('link', { name: 'Admin account', exact: true }).click();
    await page.getByRole('button', { name: 'Manage administrator accounts', exact: true }).click();
  },
);
Then(
  'the Access form is visible for granting another registered account administrator roles',
  { timeout: 60000 },
  async function (this: SetupBrowserWorld) {
    const page = this.setupBrowser!.page;
    await page.getByRole('heading', { name: 'Access grants', exact: true }).waitFor();
    assert.equal(await page.getByLabel('User handle', { exact: true }).isVisible(), true);
    await page.getByLabel('Role', { exact: true }).selectOption('ASSET_ADMIN');
    await page.getByLabel('User handle', { exact: true }).fill('setup_bob');
    await page.getByLabel('Access change reason').fill('Grant fixture administrator account');
    await page.getByRole('button', { name: 'Update access', exact: true }).click();
    await page.getByText('Access grant updated.', { exact: true }).waitFor();
    assert.equal(
      await this.setupBrowser!.f.h.database.db.collection('roleGrants').countDocuments({
        userId: new ObjectId(this.setupBrowser!.f.bob.id),
        role: 'ASSET_ADMIN',
        status: 'ACTIVE',
      }),
      1,
    );
  },
);
After({ tags: '@wallet_setup_browser', timeout: 30000 }, async function (this: SetupBrowserWorld) {
  const fixture = this.setupBrowser;
  try {
    await fixture?.browser.close();
  } finally {
    try {
      await fixture?.web.close();
    } finally {
      await fixture?.f.close();
      if (this.secondRpc)
        await new Promise<void>((resolve) => this.secondRpc!.close(() => resolve()));
    }
  }
  assert.deepEqual(fixture?.errors ?? [], []);
});

Then(
  'the unified wallet shows the verified native balance and survives reload',
  { timeout: 30000 },
  async function (this: SetupBrowserWorld) {
    const { page } = this.setupBrowser!;
    await page.getByText('1.000000000000000001 ETH', { exact: true }).waitFor();
    await page.getByRole('link', { name: 'Wallet', exact: true }).click();
    await page.getByText('1.000000000000000001 ETH', { exact: true }).waitFor();
    await page.reload();
    await page.getByText('Ownership verified', { exact: true }).waitFor();
    await page.getByText('1.000000000000000001 ETH', { exact: true }).waitFor();
    await mkdir('.local/test-results/testnet-wallet', { recursive: true });
    await page.screenshot({
      path: '.local/test-results/testnet-wallet/unified-wallet.png',
      fullPage: true,
    });
  },
);

When(
  'the controlled local network uses the Sepolia chain ID',
  async function (this: SetupBrowserWorld) {
    const { f } = this.setupBrowser!;
    f.rpcState.chainId = '0xaa36a7';
    await f.h.database.db
      .collection('networks')
      .updateOne({ _id: new ObjectId(f.network.id) }, { $set: { chainId: '11155111' } });
  },
);
When(
  'I submit one wei using the unified wallet send form',
  { timeout: 30000 },
  async function (this: SetupBrowserWorld) {
    const { page } = this.setupBrowser!;
    await page.getByText('1.000000000000000001 ETH', { exact: true }).waitFor();
    await page.getByLabel('Recipient address', { exact: true }).fill(`0x${'34'.repeat(20)}`);
    await page.getByLabel('Amount in ETH', { exact: true }).fill('0.000000000000000001');
    await page.getByRole('button', { name: 'Review and send in wallet', exact: true }).click();
    await page.getByRole('link', { name: 'View transaction on Sepolia', exact: true }).waitFor();
  },
);
Then(
  'the wallet submission is shown as pending and retained across reload without duplicate sending',
  { timeout: 30000 },
  async function (this: SetupBrowserWorld) {
    const { page, f } = this.setupBrowser!;
    assert.deepEqual(this.submitted, [
      [
        {
          from: f.signer.address,
          to: `0x${'34'.repeat(20)}`,
          value: '0x1',
          chainId: '0xaa36a7',
        },
      ],
    ]);
    await page.reload();
    await page.getByRole('link', { name: 'View transaction on Sepolia', exact: true }).waitFor();
    assert.equal(
      await page
        .getByRole('button', { name: 'Review and send in wallet', exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(this.submitted?.length, 1);
    assert.equal(await f.h.accounts.issuances.countDocuments(), 0);
  },
);
