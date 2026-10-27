import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AuthUser, WalletV2 } from '@p2p/contracts';
import {
  walletReadiness,
  WorkspaceService,
} from '../../apps/api/src/modules/workspace/workspace.service.js';
describe('Consumer workspace readiness', () => {
  const wallet = {
    status: 'ACTIVE',
    holdings: [
      { status: 'AVAILABLE', balance: '0.00', asset: { mode: 'SIMULATED', custodyEnabled: true } },
    ],
  } as unknown as WalletV2;
  it('[happy] distinguishes zero balances from a usable funded demo asset', () => {
    assert.equal(walletReadiness(wallet).balance, 'EMPTY');
    assert.equal(
      walletReadiness({ ...wallet, holdings: [{ ...wallet.holdings[0]!, balance: '0.01' }] })
        .balance,
      'FUNDED',
    );
  });
  it('[negative] missing legacy wallets are an operator migration issue and suspended wallets cannot appear ready', () => {
    assert.equal(walletReadiness(null, true).wallet, 'MIGRATION_REQUIRED');
    assert.equal(walletReadiness({ ...wallet, status: 'SUSPENDED' }).wallet, 'SUSPENDED');
    assert.equal(walletReadiness(null).assets, 'UNAVAILABLE');
  });
  it('[edge] unsupported, paused or unmigrated assets do not imply spendable value', () => {
    const unavailable = {
      ...wallet,
      holdings: [{ ...wallet.holdings[0]!, balance: '100.00', status: 'UNAVAILABLE' as const }],
    };
    assert.equal(walletReadiness(unavailable).assets, 'EMPTY');
    assert.equal(walletReadiness(unavailable).balance, 'EMPTY');
    assert.equal(walletReadiness({ ...wallet, holdings: [] }).assets, 'EMPTY');
  });
  for (const state of [
    'funded',
    'empty',
    'suspended',
    'policy unavailable',
    'no assets',
  ] as const) {
    it(`[happy/negative/edge] suggests a usable next action for ${state}`, async () => {
      const own = {
        ...wallet,
        status: state === 'suspended' ? 'SUSPENDED' : 'ACTIVE',
        holdings:
          state === 'no assets'
            ? []
            : [{ ...wallet.holdings[0]!, balance: state === 'empty' ? '0.00' : '5.00' }],
      } as WalletV2;
      const service = new WorkspaceService(
        { own: async () => own } as unknown as WorkspaceService['wallets'],
        {
          transfers: { countDocuments: async () => 0 },
        } as unknown as WorkspaceService['transfers'],
        {
          status: async () => ({ roles: [], demoEnabled: true }),
        } as unknown as WorkspaceService['admin'],
        {
          support: async () => ({ values: { accessRequests: true, allocationRequests: true } }),
          product: async () => {
            if (state === 'policy unavailable') throw new Error('Controlled unavailable policy');
            return { revision: '0' };
          },
        } as unknown as WorkspaceService['policies'],
      );
      const result = await service.overview({
        id: '000000000000000000000123',
        publicHandle: 'synthetic',
      } as AuthUser);
      assert.equal(
        result.nextAction,
        state === 'funded' ? 'SEND' : state === 'empty' ? 'RECEIVE' : 'HELP',
      );
      assert.equal(result.capabilities.send.enabled, state === 'funded');
      if (state === 'policy unavailable')
        assert.match(result.capabilities.send.reason, /settings are unavailable/);
    });
  }
});
