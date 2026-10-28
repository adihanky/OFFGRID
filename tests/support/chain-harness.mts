import assert from 'node:assert/strict';
import ganache from 'ganache';
import { Wallet, JsonRpcProvider, ContractFactory, Interface } from 'ethers';
import type { WalletChallenge, WalletV2, WalletNetwork } from '@p2p/contracts';
import { createTransferHarness } from './transfer-harness.mjs';
import { testTokenBytecode } from '../../apps/web/src/test-token-artifact.js';
const abi = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address,uint256) returns (bool)',
  'function claim()',
  'function decimals() view returns(uint8)',
];
export async function createChainHarness() {
  const evm = ganache.server({
    chain: { chainId: 11155111, hardfork: 'shanghai' },
    logging: { quiet: true },
    wallet: { totalAccounts: 3 },
  });
  await evm.listen(0, '127.0.0.1');
  const endpoint = evm.address();
  assert.ok(endpoint && typeof endpoint === 'object');
  const url = `http://127.0.0.1:${endpoint.port}`;
  const provider = new JsonRpcProvider(url, undefined, { cacheTimeout: -1 });
  const accounts = evm.provider.getInitialAccounts();
  const keys = Object.values(accounts);
  const signer = new Wallet(keys[0]!.secretKey, provider),
    recipient = new Wallet(keys[1]!.secretKey, provider);
  const h = await createTransferHarness({
    ADMIN_SETUP_TOKEN: 'chain-fixture-installation-token-32-characters',
  });
  try {
    const alice = await h.register('chain_alice'),
      bob = await h.register('chain_bob');
    assert.equal(
      (
        await h.request(alice, '/api/v2/admin/setup', 'POST', {
          token: 'chain-fixture-installation-token-32-characters',
        })
      ).status,
      201,
    );
    const response = await h.request(alice, '/api/v2/admin/networks', 'POST', {
      displayName: 'Local EVM acceptance',
      chainId: '11155111',
      environment: 'LOCAL',
      rpcUrl: url,
      reason: 'Isolated real EVM fixture',
    });
    assert.equal(response.status, 201);
    const { network } = (await response.json()) as { network: WalletNetwork };
    async function link(caller: typeof alice, wallet: Wallet) {
      const proof = (await (
        await h.request(caller, '/api/v2/wallet/binding-challenges', 'POST', {
          networkId: network.id,
          address: wallet.address,
        })
      ).json()) as WalletChallenge;
      const linked = await h.request(caller, '/api/v2/wallet/bindings', 'POST', {
        challengeId: proof.id,
        signature: await wallet.signMessage(proof.message),
      });
      assert.equal(linked.status, 201);
      const own = (await (await h.request(caller, '/api/v2/wallet')).json()) as {
        wallet: WalletV2;
      };
      return own.wallet.bindings[0]!.id;
    }
    const binding = await link(alice, signer),
      recipientBinding = await link(bob, recipient);
    return {
      h,
      evm,
      provider,
      signer,
      recipient,
      alice,
      bob,
      binding,
      recipientBinding,
      network,
      url,
      async deploy() {
        const factory = new ContractFactory(
          abi,
          testTokenBytecode,
          await provider.getSigner(signer.address),
        );
        const token = await factory.deploy();
        await token.waitForDeployment();
        return { address: await token.getAddress(), hash: token.deploymentTransaction()!.hash };
      },
      async sendToken(contract: string, to: string, units: bigint) {
        const signer = await provider.getSigner();
        const transaction = await signer.sendTransaction({
          to: contract,
          data: new Interface(abi).encodeFunctionData('transfer', [to, units]),
        });
        await transaction.wait();
        return transaction.hash;
      },
      async close() {
        try {
          await h.close();
        } finally {
          provider.destroy();
          await evm.close();
        }
      },
    };
  } catch (error) {
    await h.close();
    provider.destroy();
    await evm.close();
    throw error;
  }
}
export type ChainHarness = Awaited<ReturnType<typeof createChainHarness>>;
