import assert from 'node:assert/strict';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import type { AuthUser, TransferView, WalletAccount } from '@p2p/contracts';

const user: AuthUser = {
  id: '111111111111111111111111',
  email: 'alice@example.invalid',
  publicHandle: 'alice',
  displayName: 'Alice',
  emailVerified: false,
  signInMethod: 'email',
};
const peer = { id: '222222222222222222222222', publicHandle: 'bob', displayName: 'Bob' };
export const browserAsset: WalletAccount = {
  assetId: '333333333333333333333333',
  code: 'DEMO',
  displayName: 'Demo credits',
  precision: 2,
  balance: '10.00',
  status: 'active',
};

// Real React/StrictMode and browser events; every API call is intercepted.
// No application database, credentials, or running application servers are used.
export class WalletBrowser {
  server?: ViteDevServer;
  browser?: Browser;
  page!: Page;
  accounts: WalletAccount[] = [];
  failAccounts = false;
  delayAccounts?: Promise<void>;
  releaseAccounts?: () => void;
  posts: { body: unknown; key: string | undefined }[] = [];
  peerReads = 0;
  errors: string[] = [];

  async start(state: string) {
    this.accounts = state === 'empty' ? [] : [{ ...browserAsset }];
    if (state === 'disabled') this.accounts[0]!.status = 'disabled';
    this.failAccounts = state === 'failed';
    if (state === 'loading') {
      this.delayAccounts = new Promise<void>((resolve) => {
        this.releaseAccounts = resolve;
      });
    }
    this.server = await createServer({
      configFile: 'apps/web/vite.config.ts',
      root: 'apps/web',
      logLevel: 'error',
      server: { port: 0, strictPort: false, open: false },
    });
    await this.server.listen();
    this.browser = await chromium.launch({
      headless: true,
      ...(process.env.P2P_TEST_BROWSER_EXECUTABLE
        ? { executablePath: process.env.P2P_TEST_BROWSER_EXECUTABLE }
        : { channel: process.env.P2P_TEST_BROWSER_CHANNEL ?? 'chrome' }),
    });
    this.page = await this.browser.newPage();
    this.page.setDefaultTimeout(8000);
    this.page.on('pageerror', (error) => this.errors.push(error.message));
    await this.page.route('**/api/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      let body: unknown;
      let status = 200;
      switch (url.pathname) {
        case '/api/health/ready':
          body = { status: 'ready' };
          break;
        case '/api/auth/me':
          body = { user };
          break;
        case '/api/auth/providers':
          body = { google: false, email: true };
          break;
        case '/api/auth/csrf':
          body = { csrfToken: 'controlled-browser-fixture' };
          break;
        case '/api/v2/admin/status':
          body = { roles: [], setupAvailable: false, maintenance: false, demoEnabled: true };
          break;
        case '/api/v2/workspace':
          body = {
            serverTime: new Date().toISOString(),
            mode: 'SIMULATED',
            roles: [],
            readiness: {
              wallet: 'READY',
              assets: this.accounts.some((account) => account.status === 'active')
                ? 'AVAILABLE'
                : 'EMPTY',
              balance: 'FUNDED',
              recovery: 'READY',
            },
            pendingCount: 0,
            receive: { publicHandle: user.publicHandle, walletId: '666666666666666666666666' },
            helpUrl: '',
            policyRevision: '0',
            nextAction: 'SEND',
            capabilities: {
              send: { enabled: true, reason: 'Controlled send fixture', action: 'SEND' },
              receive: { enabled: true, reason: 'Controlled receive fixture', action: 'RECEIVE' },
              accessRequest: { enabled: false, reason: 'No request fixture', action: 'HELP' },
              allocationRequest: { enabled: false, reason: 'No request fixture', action: 'HELP' },
            },
          };
          break;
        case '/api/v2/custody':
          body = { events: [], nextCursor: null };
          break;
        case '/api/v2/networks':
          body = { networks: [] };
          break;
        case '/api/v2/assets':
          body = {
            assets: this.accounts.map((account) => ({
              id: account.assetId,
              code: account.code,
              symbol: account.code,
              displayName: account.displayName,
              precision: account.precision,
              kind: 'DEMO_CRYPTO',
              mode: 'SIMULATED',
              lifecycle: account.status === 'active' ? 'ACTIVE' : 'PAUSED',
              revision: '0',
              identityKey: `demo:${account.assetId}`,
            })),
          };
          break;
        case '/api/v2/wallet':
          await this.delayAccounts;
          status = this.failAccounts ? 503 : 200;
          body = this.failAccounts
            ? { message: 'Balances unavailable.' }
            : {
                wallet: {
                  id: '666666666666666666666666',
                  status: 'ACTIVE',
                  revision: '0',
                  bindings: [],
                  holdings: this.accounts.map((account) => ({
                    asset: {
                      id: account.assetId,
                      code: account.code,
                      symbol: account.code,
                      displayName: account.displayName,
                      precision: account.precision,
                      kind: 'DEMO_CRYPTO',
                      mode: 'SIMULATED',
                      lifecycle: account.status === 'active' ? 'ACTIVE' : 'PAUSED',
                      revision: '0',
                      identityKey: `demo:${account.assetId}`,
                      custodyEnabled: true,
                    },
                    source: 'SIMULATED',
                    balance: account.balance,
                    status: account.status === 'active' ? 'AVAILABLE' : 'UNAVAILABLE',
                    stale: false,
                  })),
                },
              };
          break;
        case '/api/v2/peer-resolutions':
          this.peerReads += 1;
          status = request.postDataJSON().lookup.value === 'bob' ? 200 : 404;
          body =
            status === 200
              ? {
                  resolutionId: '777777777777777777777777',
                  expiresAt: new Date(Date.now() + 120000).toISOString(),
                  recipient: {
                    userId: peer.id,
                    walletId: '888888888888888888888888',
                    publicHandle: peer.publicHandle,
                    displayName: peer.displayName,
                  },
                  destination: { mode: 'SIMULATED' },
                  revisions: { senderWallet: '0', recipientWallet: '0', asset: '0' },
                }
              : { message: 'Peer is unavailable.' };
          break;
        case '/api/v2/transfers': {
          if (request.method() === 'GET') {
            body = { transfers: [], nextCursor: null };
            break;
          }
          assert.equal(request.method(), 'POST');
          assert.equal(request.headers()['x-csrf-token'], 'controlled-browser-fixture');
          this.posts.push({
            body: request.postDataJSON(),
            key: request.headers()['idempotency-key'],
          });
          const transfer: TransferView = {
            id: '444444444444444444444444',
            sender: user,
            recipient: peer,
            asset: {
              id: browserAsset.assetId,
              code: 'DEMO',
              displayName: 'Demo credits',
              precision: 2,
            },
            quantity: '3.25',
            status: 'COMMITTED',
            rejectionCode: null,
            createdAt: '2026-10-25T00:00:00.000Z',
            updatedAt: '2026-10-25T00:00:00.000Z',
          };
          this.accounts = [{ ...browserAsset, balance: '6.75' }];
          body = {
            transfer: {
              ...transfer,
              payloadVersion: 2,
              mode: 'SIMULATED',
              senderWalletId: '666666666666666666666666',
              recipientWalletId: '888888888888888888888888',
            },
          };
          status = 201;
          break;
        }
        default:
          throw new Error(`Unexpected browser API request: ${url.pathname}`);
      }
      await route.fulfill({ status, json: body });
    });
    const address = this.server.httpServer!.address();
    assert.ok(address && typeof address === 'object');
    await this.page.goto(`http://127.0.0.1:${address.port}/#/send`);
    await this.page.getByRole('heading', { name: 'Send demo units' }).waitFor();
  }

  async typeDetails(quantity = '3.25') {
    await this.page.getByLabel('Recipient public handle').pressSequentially('bob');
    await this.page.getByLabel('Quantity', { exact: true }).pressSequentially(quantity);
    assert.equal(await this.page.getByLabel('Recipient public handle').inputValue(), 'bob');
    assert.equal(await this.page.getByLabel('Quantity', { exact: true }).inputValue(), quantity);
  }

  async close() {
    this.releaseAccounts?.();
    try {
      await this.browser?.close();
    } finally {
      await this.server?.close();
    }
    assert.deepEqual(this.errors, [], 'Browser must have no unhandled rendering errors');
  }
}
