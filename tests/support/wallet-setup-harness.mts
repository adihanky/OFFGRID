import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Wallet } from 'ethers';
import { createTransferHarness } from './transfer-harness.mjs';
import { AdminService } from '../../apps/api/src/modules/admin/admin.service.js';
import type { WalletNetwork } from '@p2p/contracts';
export const setupFixtureToken = 'wallet-setup-controlled-token-32-characters';
export async function createWalletSetupHarness() {
  const state = { chainId: '0x7a69', genesisHash: `0x${'12'.repeat(32)}`, contract: false };
  const rpc = createServer((request, response) => {
    let text = '';
    request.on('data', (data) => {
      text += String(data);
    });
    request.on('end', () => {
      const message = JSON.parse(text) as { id: string; method: string };
      const result =
        message.method === 'eth_chainId'
          ? state.chainId
          : message.method === 'eth_getBlockByNumber'
            ? { hash: state.genesisHash }
            : state.contract
              ? '0x6000'
              : '0x';
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
    });
  });
  await new Promise<void>((resolve) => rpc.listen(0, '127.0.0.1', resolve));
  const endpoint = rpc.address();
  assert.ok(endpoint && typeof endpoint === 'object');
  const rpcUrl = `http://127.0.0.1:${endpoint.port}/`;
  const h = await createTransferHarness({ ADMIN_SETUP_TOKEN: setupFixtureToken });
  try {
    const admin = await h.register('setup_admin'),
      alice = await h.register('setup_alice'),
      bob = await h.register('setup_bob');
    const asset = await h.accounts.createAsset({
      code: 'WSET',
      displayName: 'Wallet setup coin',
      precision: 2,
    });
    await h.app.get(AdminService).setup(admin.id, { token: setupFixtureToken });
    const input = {
      displayName: 'Controlled local EVM',
      chainId: '31337',
      environment: 'LOCAL',
      rpcUrl,
      reason: 'Isolated provider fixture',
    };
    const result = await h.request(admin, '/api/v2/admin/networks', 'POST', input);
    assert.equal(result.status, 201);
    const network = ((await result.json()) as { network: WalletNetwork }).network;
    return {
      h,
      admin,
      alice,
      bob,
      asset,
      network,
      rpcUrl,
      rpcState: state,
      signer: Wallet.createRandom(),
      async close() {
        try {
          await h.close();
        } finally {
          await new Promise<void>((resolve) => rpc.close(() => resolve()));
        }
      },
    };
  } catch (error) {
    await h.close();
    await new Promise<void>((resolve) => rpc.close(() => resolve()));
    throw error;
  }
}
export type WalletSetupHarness = Awaited<ReturnType<typeof createWalletSetupHarness>>;
