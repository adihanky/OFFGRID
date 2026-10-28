import { getAddress } from 'ethers';
import type { ChainTransactionPlan } from '@p2p/contracts';
import type { EthereumProvider } from './external-wallet-client.js';
export async function submitChainTransaction(
  provider: EthereumProvider | undefined,
  plan: ChainTransactionPlan,
  signal: AbortSignal,
  beforeBroadcast: () => void,
) {
  if (!provider) throw new Error('Connect your browser wallet first.');
  if (!['0xaa36a7', '0x7a69'].includes(plan.chainId))
    throw new Error('Only Sepolia and local development transactions are allowed.');
  const from = getAddress(plan.from);
  if (plan.to) getAddress(plan.to);
  if (!/^0x[0-9a-f]+$/i.test(plan.value) || (plan.data && !/^0x(?:[0-9a-f]{2})*$/i.test(plan.data)))
    throw new Error('Invalid transaction plan.');
  const accounts = await provider.request({ method: 'eth_accounts' }),
    chain = await provider.request({ method: 'eth_chainId' });
  if (signal.aborted) throw new Error('Wallet session changed.');
  if (
    !Array.isArray(accounts) ||
    typeof accounts[0] !== 'string' ||
    getAddress(accounts[0]) !== from ||
    typeof chain !== 'string' ||
    BigInt(chain) !== BigInt(plan.chainId)
  )
    throw new Error('Select the verified address and network in your wallet.');
  beforeBroadcast();
  const hash = await provider.request({ method: 'eth_sendTransaction', params: [plan] });
  if (typeof hash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(hash))
    throw new Error('The wallet did not return a hash. Check wallet activity before retrying.');
  return hash;
}
