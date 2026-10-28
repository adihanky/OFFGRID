import assert from 'node:assert/strict';
import { Given, When, Then, After } from '@cucumber/cucumber';
import { Interface, parseEther } from 'ethers';
import type { ChainHistory, ChainToken, ChainTransactionPlan } from '@p2p/contracts';
import { createChainHarness, type ChainHarness } from '../support/chain-harness.mjs';
interface World {
  chain?: ChainHarness;
  contract?: string;
  nativeHash?: string;
  tokenHash?: string;
}
const path = (f: ChainHarness, route: string) =>
  `/api/v2/wallet/bindings/${f.binding}/chain/${route}`;
async function post(f: ChainHarness, route: string, body: unknown = {}) {
  return f.h.request(f.alice, path(f, route), 'POST', body);
}
Given('an isolated real EVM wallet fixture', { timeout: 120000 }, async function (this: World) {
  this.chain = await createChainHarness();
});
When(
  'I deploy and import the test token through the chain API',
  { timeout: 30000 },
  async function (this: World) {
    const f = this.chain!,
      token = await f.deploy();
    this.contract = token.address;
    assert.equal((await post(f, 'transactions', { hash: token.hash })).status, 201);
    assert.equal((await post(f, 'tokens', { address: token.address })).status, 201);
    const result = (await (await f.h.request(f.alice, path(f, 'tokens'))).json()) as {
      tokens: ChainToken[];
    };
    assert.equal(result.tokens[0]!.balanceUnits, parseEther('1000').toString());
  },
);
When(
  'I send native ETH and ERC-20 tokens on the EVM',
  { timeout: 30000 },
  async function (this: World) {
    const f = this.chain!,
      sender = await f.provider.getSigner();
    const native = await sender.sendTransaction({ to: f.recipient.address, value: 1n });
    await native.wait();
    this.nativeHash = native.hash;
    assert.equal((await post(f, 'transactions', { hash: native.hash })).status, 201);
    const plan = await post(f, 'prepare', {
      token: this.contract,
      recipient: f.recipient.address,
      quantity: '3.25',
    });
    assert.equal(plan.status, 201);
    const { transaction } = (await plan.json()) as { transaction: ChainTransactionPlan };
    assert.equal(transaction.value, '0x0');
    const sent = await sender.sendTransaction(transaction);
    await sent.wait();
    this.tokenHash = sent.hash;
    assert.equal((await post(f, 'transactions', { hash: sent.hash })).status, 201);
  },
);
Then(
  'balances and indexed receipts reflect executed transfers without demo issuance',
  { timeout: 30000 },
  async function (this: World) {
    const f = this.chain!;
    assert.equal((await post(f, 'sync')).status, 201);
    const balances = (await (await f.h.request(f.alice, path(f, 'tokens'))).json()) as {
      tokens: ChainToken[];
    };
    assert.equal(balances.tokens[0]!.balanceUnits, parseEther('996.75').toString());
    const history = (await (await f.h.request(f.alice, path(f, 'history'))).json()) as ChainHistory;
    assert.ok(
      history.entries.some(
        (row) =>
          row.hash === this.nativeHash &&
          row.kind === 'NATIVE' &&
          row.amountUnits === '1' &&
          row.status === 'MINED',
      ),
    );
    assert.ok(
      history.entries.some(
        (row) =>
          row.hash === this.tokenHash &&
          row.kind === 'ERC20' &&
          row.amountUnits === parseEther('3.25').toString() &&
          row.to === f.recipient.address.toLowerCase(),
      ),
    );
    assert.equal(await f.h.accounts.issuances.countDocuments(), 0);
    for (let i = 0; i < 12; i++) await f.provider.send('evm_mine', []);
    assert.equal((await post(f, 'sync')).status, 201);
    const confirmed = (await (
      await f.h.request(f.alice, path(f, 'history'))
    ).json()) as ChainHistory;
    assert.ok(
      confirmed.entries.some((row) => row.hash === this.tokenHash && row.status === 'CONFIRMED'),
    );
  },
);
Then(
  'repeated indexing is idempotent and other users cannot read the address history',
  { timeout: 30000 },
  async function (this: World) {
    const f = this.chain!,
      before = await f.h.database.db.collection('chainActivity').countDocuments();
    assert.equal((await post(f, 'sync')).status, 201);
    assert.equal((await post(f, 'sync')).status, 201);
    assert.equal(await f.h.database.db.collection('chainActivity').countDocuments(), before);
    assert.equal((await f.h.request(f.bob, path(f, 'history'))).status, 404);
    assert.equal((await f.h.request(f.bob, path(f, 'tokens'))).status, 404);
    // Recipient imports the same on-chain asset and discovers the incoming event.
    const base = `/api/v2/wallet/bindings/${f.recipientBinding}/chain`;
    assert.equal(
      (await f.h.request(f.bob, `${base}/tokens`, 'POST', { address: this.contract })).status,
      201,
    );
    assert.equal((await f.h.request(f.bob, `${base}/sync`, 'POST', {})).status, 201);
    const incoming = (await (await f.h.request(f.bob, `${base}/history`)).json()) as ChainHistory;
    assert.ok(incoming.entries.some((row) => row.hash === this.tokenHash && row.kind === 'ERC20'));
  },
);
Then(
  'invalid token operations are rejected without broadcasting',
  { timeout: 30000 },
  async function (this: World) {
    const f = this.chain!,
      height = await f.provider.getBlockNumber();
    assert.equal((await post(f, 'tokens', { address: f.recipient.address })).status, 400);
    for (const quantity of ['0', '-1', '1e2', '0.0000000000000000001', '1001'])
      assert.equal(
        (
          await post(f, 'prepare', {
            token: this.contract,
            recipient: f.recipient.address,
            quantity,
          })
        ).status,
        400,
      );
    assert.equal(
      (
        await f.h.request(
          f.alice,
          path(f, 'prepare'),
          'POST',
          { token: this.contract, recipient: f.recipient.address, quantity: '1' },
          { csrfValue: 'forged' },
        )
      ).status,
      403,
    );
    const unrelated = await (
      await f.provider.getSigner(f.recipient.address)
    ).sendTransaction({ to: f.signer.address, value: 1n });
    await unrelated.wait();
    assert.equal((await post(f, 'transactions', { hash: unrelated.hash })).status, 404);
    assert.equal(await f.provider.getBlockNumber(), height + 1);
  },
);
Then(
  'a real reverted transaction is indexed as reverted',
  { timeout: 30000 },
  async function (this: World) {
    const f = this.chain!,
      sender = await f.provider.getSigner();
    const tx = await sender.sendTransaction({
      to: this.contract,
      data: new Interface(['function transfer(address,uint256)']).encodeFunctionData('transfer', [
        f.recipient.address,
        parseEther('2000'),
      ]),
      gasLimit: 100000,
    });
    try {
      await tx.wait();
      assert.fail('Expected revert');
    } catch (error) {
      assert.ok(error);
    }
    assert.equal((await post(f, 'transactions', { hash: tx.hash })).status, 201);
    assert.equal((await post(f, 'sync')).status, 201);
    const history = (await (await f.h.request(f.alice, path(f, 'history'))).json()) as ChainHistory;
    assert.ok(history.entries.some((row) => row.hash === tx.hash && row.status === 'REVERTED'));
  },
);
Then(
  'an EVM rollback removes provisional transfer evidence',
  { timeout: 30000 },
  async function (this: World) {
    const f = this.chain!,
      snapshot = await f.provider.send('evm_snapshot', []);
    const hash = await f.sendToken(this.contract!, f.recipient.address, 1n);
    assert.equal((await post(f, 'sync')).status, 201);
    assert.equal(await f.provider.send('evm_revert', [snapshot]), true);
    await f.provider.send('evm_mine', []);
    assert.equal((await post(f, 'sync')).status, 201);
    const history = (await (await f.h.request(f.alice, path(f, 'history'))).json()) as ChainHistory;
    assert.ok(history.entries.some((row) => row.hash === hash && row.status === 'REORGED'));
  },
);
After({ tags: '@chain_wallet', timeout: 30000 }, async function (this: World) {
  await this.chain?.close();
});
