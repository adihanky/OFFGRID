import type { WalletRole } from './wallet-v2.js';
export interface WorkspaceOverview {
  serverTime: string;
  mode: 'SIMULATED';
  roles: WalletRole[];
  readiness: {
    wallet: 'READY' | 'SUSPENDED' | 'MIGRATION_REQUIRED' | 'UNAVAILABLE';
    assets: 'AVAILABLE' | 'EMPTY' | 'UNAVAILABLE';
    balance: 'FUNDED' | 'EMPTY' | 'UNAVAILABLE';
    recovery: 'READY' | 'UNAVAILABLE';
  };
  capabilities: Record<
    'send' | 'receive' | 'accessRequest' | 'allocationRequest',
    { enabled: boolean; reason: string; action: 'SEND' | 'RECEIVE' | 'ACTIVITY' | 'HELP' }
  >;
  nextAction: 'SEND' | 'RECEIVE' | 'ACTIVITY' | 'HELP';
  pendingCount: number | null;
  receive: { publicHandle: string; walletId?: string };
  helpUrl: string;
  policyRevision: string;
}
