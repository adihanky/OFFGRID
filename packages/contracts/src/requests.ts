import type { WalletRole } from './wallet-v2.js';
export type ConsumerRequestInput =
  | { type: 'ACCESS'; role: Exclude<WalletRole, 'USER'>; reason: string }
  | { type: 'DEMO_ALLOCATION'; assetId: string; quantity: string; reason: string };
export interface ConsumerRequestView {
  id: string;
  owner: { id: string; publicHandle: string };
  type: 'ACCESS' | 'DEMO_ALLOCATION';
  role?: Exclude<WalletRole, 'USER'>;
  asset?: { id: string; code: string; precision: number };
  quantity?: string;
  reason: string;
  status: 'OPEN' | 'APPROVED' | 'REJECTED';
  revision: string;
  decisionReason?: string;
  operationId?: string;
  createdAt: string;
  decidedAt?: string;
}
export interface ConsumerRequestPage {
  requests: ConsumerRequestView[];
  nextCursor: string | null;
}
