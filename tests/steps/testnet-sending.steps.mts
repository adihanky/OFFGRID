import assert from 'node:assert/strict';
import { Given, When, Then } from '@cucumber/cucumber';
import { sendTestnetEth } from '../../apps/web/src/testnet-wallet-client.js';
import type { EthereumProvider } from '../../apps/web/src/external-wallet-client.js';
const from = `0x${'12'.repeat(20)}`,
  to = `0x${'34'.repeat(20)}`,
  hash = `0x${'ab'.repeat(32)}`;
interface SendWorld {
  native?: {
    provider: EthereumProvider;
    calls: unknown[][];
    recorded: boolean;
    changed: boolean;
    lost: boolean;
    hash?: string;
  };
}
Given('a controlled connected Sepolia signer', function (this: SendWorld) {
  const state = { calls: [] as unknown[][], recorded: false, changed: false, lost: false };
  this.native = {
    ...state,
    provider: {
      request: async ({ method, params }) => {
        const s = this.native!;
        if (method === 'eth_accounts') return [s.changed ? to : from];
        if (method === 'eth_chainId') return '0xaa36a7';
        assert.equal(method, 'eth_sendTransaction');
        assert.equal(s.recorded, true);
        s.calls.push(params!);
        if (s.lost) throw new Error('Lost response');
        return hash;
      },
    },
  };
});
const input = { from, to, quantity: '0.000000000000000001', chainId: '11155111' };
When('I approve a one wei testnet payment', async function (this: SendWorld) {
  const s = this.native!;
  s.hash = await sendTestnetEth(s.provider, input, new AbortController().signal, () => {
    s.recorded = true;
  });
});
Then(
  'the provider receives one native transaction and returns its hash',
  function (this: SendWorld) {
    assert.deepEqual(this.native!.calls, [[{ from, to, value: '0x1', chainId: '0xaa36a7' }]]);
    assert.equal(this.native!.hash, hash);
  },
);
Then('an account change prevents the testnet payment', async function (this: SendWorld) {
  const s = this.native!;
  s.changed = true;
  await assert.rejects(
    sendTestnetEth(s.provider, input, new AbortController().signal, () => {
      s.recorded = true;
    }),
  );
  assert.equal(s.calls.length, 0);
  assert.equal(s.recorded, false);
});
Then(
  'a lost submission reply remains uncertain without another payment',
  async function (this: SendWorld) {
    const s = this.native!;
    s.changed = false;
    s.lost = true;
    await assert.rejects(
      sendTestnetEth(s.provider, input, new AbortController().signal, () => {
        s.recorded = true;
      }),
    );
    assert.equal(s.calls.length, 1);
    assert.equal(s.recorded, true);
  },
);
