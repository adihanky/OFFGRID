import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ethToWei, formatEth, sendTestnetEth } from '../../apps/web/src/testnet-wallet-client.js';
const from = `0x${'12'.repeat(20)}`,
  to = `0x${'34'.repeat(20)}`,
  hash = `0x${'ab'.repeat(32)}`;
describe('Testnet wallet exact amounts and transaction boundaries', () => {
  it('[happy/edge] retains all 18 decimal places without floating point', () => {
    assert.equal(ethToWei('0.000000000000000001'), 1n);
    assert.equal(formatEth('1000000000000000001'), '1.000000000000000001');
    for (const invalid of ['0', '-1', '1e3', 'NaN', '01', '0.0000000000000000001'])
      assert.throws(() => ethToWei(invalid));
  });
  it('[happy] submits exactly once to the selected Sepolia account after recording intent', async () => {
    const calls: string[] = [];
    let recorded = false;
    const result = await sendTestnetEth(
      {
        request: async ({ method, params }) => {
          calls.push(method);
          if (method === 'eth_accounts') return [from];
          if (method === 'eth_chainId') return '0xaa36a7';
          assert.equal(recorded, true);
          assert.deepEqual(params, [{ from, to, value: '0x1', chainId: '0xaa36a7' }]);
          return hash;
        },
      },
      { from, to, quantity: '0.000000000000000001', chainId: '11155111' },
      new AbortController().signal,
      () => {
        recorded = true;
      },
    );
    assert.equal(result, hash);
    assert.equal(calls.filter((x) => x === 'eth_sendTransaction').length, 1);
  });
  it('[negative/edge] rejects mainnet, account changes, cancellation and bad recipients before broadcast', async () => {
    for (const variant of [{ chainId: '1' }, { to: from }, { to: '0x0' }, {}]) {
      let broadcast = false;
      await assert.rejects(
        sendTestnetEth(
          { request: async ({ method }) => (method === 'eth_accounts' ? [to] : '0xaa36a7') },
          { from, to, quantity: '1', chainId: '11155111', ...variant },
          new AbortController().signal,
          () => {
            broadcast = true;
          },
        ),
      );
      assert.equal(broadcast, false);
    }
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      sendTestnetEth(
        { request: async ({ method }) => (method === 'eth_accounts' ? [from] : '0xaa36a7') },
        { from, to, quantity: '1', chainId: '11155111' },
        controller.signal,
        () => assert.fail('No broadcast'),
      ),
    );
  });
  it('[negative] preserves an uncertain submission and never retries a lost wallet reply', async () => {
    let calls = 0,
      recorded = false;
    await assert.rejects(
      sendTestnetEth(
        {
          request: async ({ method }) => {
            if (method === 'eth_accounts') return [from];
            if (method === 'eth_chainId') return '0xaa36a7';
            calls++;
            throw new Error('Lost reply');
          },
        },
        { from, to, quantity: '1', chainId: '11155111' },
        new AbortController().signal,
        () => {
          recorded = true;
        },
      ),
    );
    assert.equal(recorded, true);
    assert.equal(calls, 1);
  });
});
