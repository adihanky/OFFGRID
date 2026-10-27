import type { TransferView } from './index.js';

export interface HistoricalTransfer extends TransferView {
  payloadVersion: 1 | 2;
  mode: 'SIMULATED';
  senderWalletId?: string;
  recipientWalletId?: string;
}
export interface TransferHistoryFilters {
  direction?: 'ALL' | 'SENT' | 'RECEIVED';
  status?: TransferView['status'];
  assetId?: string;
  peerHandle?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}
export interface TransferHistoryPage {
  transfers: HistoricalTransfer[];
  nextCursor: string | null;
}
export interface TransferReceipt {
  transfer: HistoricalTransfer;
  committedAt: string;
  identitySource: 'ADMISSION_SNAPSHOT';
  notice: string;
}
export interface TransferChainEvidence {
  transferId: string;
  assetId: string;
  sequence: string;
  entryHash: string;
  previousHash: string;
  canonicalVersion: 1;
  committedAt: string;
  notice: string;
}
