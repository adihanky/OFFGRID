import { useTrustedProxy } from '../../apps/api/src/modules/networks/rpc.js';
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  address,
  blockNumber,
  confirmedStatus,
  tokenAmount,
} from '../../apps/api/src/modules/chain-wallet/chain-input.js';
import { submitChainTransaction } from '../../apps/web/src/chain-wallet-client.js';
describe('Chain quantities, identity and finality', () => {
  it('[happy/edge] preserves exact uint256 quantities with token-specific precision', () => {
    assert.equal(tokenAmount('1.000001', 6), 1000001n);
    assert.equal(tokenAmount('0.000000000000000001', 18), 1n);
    assert.equal(confirmedStatus(true, 11), 'MINED');
    assert.equal(confirmedStatus(true, 12), 'CONFIRMED');
    assert.equal(confirmedStatus(false, 100), 'REVERTED');
  });
  it('[negative] refuses invalid addresses, overprecision, overflow and unsafe block heights', () => {
    for (const value of ['0', '-1', '1e2', '0.0000001', (2n ** 256n).toString()])
      assert.throws(() => tokenAmount(value, 6));
    assert.throws(() => address(`0x${'0'.repeat(40)}`));
    assert.throws(() => blockNumber('0x20000000000000'));
    assert.throws(() => blockNumber('0x01'));
  });
  it('[happy/negative/edge] broadcasts exactly once and refuses mainnet or changed account', async () => {
    const from = `0x${'12'.repeat(20)}`,
      to = `0x${'34'.repeat(20)}`,
      hash = `0x${'ab'.repeat(32)}`;
    let sends = 0,
      marked = false;
    const provider = {
      request: async ({ method }: { method: string }) => {
        if (method === 'eth_accounts') return [from];
        if (method === 'eth_chainId') return '0xaa36a7';
        assert.equal(marked, true);
        sends++;
        return hash;
      },
    };
    assert.equal(
      await submitChainTransaction(
        provider,
        { from, to, value: '0x0', data: '0x1234', chainId: '0xaa36a7' },
        new AbortController().signal,
        () => {
          marked = true;
        },
      ),
      hash,
    );
    await assert.rejects(
      submitChainTransaction(
        provider,
        { from, to, value: '0x0', chainId: '0x1' },
        new AbortController().signal,
        () => assert.fail(),
      ),
    );
    await assert.rejects(
      submitChainTransaction(
        provider,
        { from: to, to: from, value: '0x0', chainId: '0xaa36a7' },
        new AbortController().signal,
        () => assert.fail(),
      ),
    );
    assert.equal(sends, 1);
  });
});

describe('Trusted public RPC proxy routing', () => {
  it('[happy/negative/edge] delegates only fixed HTTPS providers while custom/local destinations remain pinned', () => {
    assert.equal(
      useTrustedProxy(new URL('https://ethereum-sepolia-rpc.publicnode.com/'), false, true),
      true,
    );
    for (const url of [
      'https://attacker.example/',
      'https://ethereum-sepolia-rpc.publicnode.com.attacker.example/',
      'http://ethereum-sepolia-rpc.publicnode.com/',
      'http://127.0.0.1:8545/',
    ])
      assert.equal(useTrustedProxy(new URL(url), false, true), false);
    assert.equal(useTrustedProxy(new URL('https://sepolia.drpc.org/'), false, false), false);
    assert.equal(useTrustedProxy(new URL('https://sepolia.drpc.org/'), true, true), false);
  });
});
