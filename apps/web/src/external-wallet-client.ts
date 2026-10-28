import type { WalletChallenge, WalletNetwork } from '@p2p/contracts';
export interface EthereumProvider {
  request(input: { method: string; params?: unknown[] }): Promise<unknown>;
}
export function ethereumProvider(): EthereumProvider | undefined {
  return (globalThis as unknown as { ethereum?: EthereumProvider }).ethereum;
}
const hexMessage = (value: string) =>
  `0x${Array.from(new TextEncoder().encode(value), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
export async function connectExternalWallet(
  provider: EthereumProvider | undefined,
  network: WalletNetwork,
  challenge: (address: string) => Promise<WalletChallenge>,
  verify: (id: string, signature: string) => Promise<unknown>,
  signal: AbortSignal,
) {
  if (!provider)
    throw new Error(
      'No EVM wallet was detected. Install a compatible wallet extension or use the manual signature option below.',
    );
  const active = () => {
    if (signal.aborted) throw new Error('Wallet setup was cancelled.');
  };
  try {
    active();
    const accounts = await provider.request({ method: 'eth_requestAccounts' });
    if (
      !Array.isArray(accounts) ||
      typeof accounts[0] !== 'string' ||
      !/^0x[0-9a-f]{40}$/i.test(accounts[0])
    )
      throw new Error('The wallet did not provide an EVM address.');
    const address = accounts[0];
    let chain = await provider.request({ method: 'eth_chainId' });
    if (typeof chain !== 'string') throw new Error('Unable to read the wallet network.');
    if (BigInt(chain) !== BigInt(network.chainId)) {
      try {
        await provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: `0x${BigInt(network.chainId).toString(16)}` }],
        });
      } catch (error) {
        if (
          !error ||
          typeof error !== 'object' ||
          !('code' in error) ||
          error.code !== 4902 ||
          network.chainId !== '11155111'
        )
          throw error;
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: '0xaa36a7',
              chainName: 'Ethereum Sepolia',
              nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 },
              rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com/'],
              blockExplorerUrls: ['https://sepolia.etherscan.io/'],
            },
          ],
        });
        await provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0xaa36a7' }],
        });
      }
      chain = await provider.request({ method: 'eth_chainId' });
      if (typeof chain !== 'string' || BigInt(chain) !== BigInt(network.chainId))
        throw new Error('Select the configured network in your wallet before linking.');
    }
    active();
    const proof = await challenge(address);
    if (proof.address.toLowerCase() !== address.toLowerCase() || proof.networkId !== network.id)
      throw new Error('The ownership challenge did not match your wallet.');
    active();
    const signature = await provider.request({
      method: 'personal_sign',
      params: [hexMessage(proof.message), address],
    });
    const after = await provider.request({ method: 'eth_accounts' });
    const afterChain = await provider.request({ method: 'eth_chainId' });
    active();
    if (
      !Array.isArray(after) ||
      typeof after[0] !== 'string' ||
      after[0].toLowerCase() !== address.toLowerCase() ||
      typeof afterChain !== 'string' ||
      BigInt(afterChain) !== BigInt(network.chainId)
    )
      throw new Error('Your wallet account or network changed. Connect and sign again.');
    if (typeof signature !== 'string') throw new Error('The wallet did not provide a signature.');
    return await verify(proof.id, signature);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 4001)
      throw new Error('The wallet connection or signing request was declined.', { cause: error });
    throw error;
  }
}
