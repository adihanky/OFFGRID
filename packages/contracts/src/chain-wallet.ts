export interface ChainToken {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  balanceUnits: string;
}
export interface ChainActivity {
  id: string;
  hash: string;
  kind: 'NATIVE' | 'ERC20' | 'CONTRACT';
  tokenAddress: string | null;
  from: string;
  to: string | null;
  amountUnits: string;
  symbol: string;
  decimals: number;
  status: 'PENDING' | 'MINED' | 'CONFIRMED' | 'REVERTED' | 'REORGED';
  blockNumber: number | null;
  confirmations: number;
  contractAddress: string | null;
}
export interface ChainHistory {
  entries: ChainActivity[];
  nextCursor: string | null;
  indexedThrough: number | null;
  startBlock: number | null;
  lastSyncedAt?: string | null;
  lastError?: string | null;
}
export interface ChainTransactionPlan {
  from: string;
  to?: string;
  value: string;
  data?: string;
  chainId: string;
}
