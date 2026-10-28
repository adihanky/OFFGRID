import type { EthereumProvider } from './external-wallet-client.js';

export function ethToWei(value: string): bigint {
  if (!/^(0|[1-9][0-9]{0,18})(\.[0-9]{1,18})?$/.test(value))
    throw new Error('Enter a positive ETH amount with at most 18 decimals.');
  const [whole, fraction = ''] = value.split('.');
  const wei = BigInt(whole!) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'));
  if (wei <= 0n) throw new Error('Amount must be greater than zero.');
  return wei;
}
export function formatEth(wei: string): string {
  const value = BigInt(wei);
  return `${value / 10n ** 18n}.${(value % 10n ** 18n).toString().padStart(18, '0')}`;
}
export async function sendTestnetEth(
  provider: EthereumProvider | undefined,
  input: {
    from: string;
    to: string;
    quantity: string;
    chainId: string;
  },
  signal: AbortSignal,
  beforeBroadcast: () => void,
) {
  if (!provider) throw new Error('Connect your browser wallet first.');
  if (input.chainId !== '11155111')
    throw new Error('Sending is available only on Ethereum Sepolia.');
  if (!/^0x[0-9a-f]{40}$/i.test(input.to) || /^0x0{40}$/i.test(input.to))
    throw new Error('Enter a nonzero recipient EVM address.');
  if (input.to.toLowerCase() === input.from.toLowerCase())
    throw new Error('Choose another recipient.');
  const value = `0x${ethToWei(input.quantity).toString(16)}`;
  const accounts = await provider.request({ method: 'eth_accounts' });
  const chain = await provider.request({ method: 'eth_chainId' });
  if (signal.aborted) throw new Error('Wallet session changed.');
  if (
    !Array.isArray(accounts) ||
    typeof accounts[0] !== 'string' ||
    accounts[0].toLowerCase() !== input.from.toLowerCase() ||
    typeof chain !== 'string' ||
    BigInt(chain).toString() !== input.chainId
  )
    throw new Error('Select the verified address and Sepolia in your wallet.');
  beforeBroadcast();
  // Never retry eth_sendTransaction automatically: a lost response can conceal a successful send.
  const hash = await provider.request({
    method: 'eth_sendTransaction',
    params: [
      {
        from: input.from,
        to: input.to,
        value,
        chainId: '0xaa36a7',
      },
    ],
  });
  if (typeof hash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(hash))
    throw new Error(
      'No transaction hash was returned. Check wallet activity before sending again.',
    );
  return hash;
}
