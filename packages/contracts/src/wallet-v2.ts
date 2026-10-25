import type { TransferView } from './index.js';
/** Versioned contracts. V1 transfer statuses and payload hashes remain unchanged. */
export type AssetKind = 'DEMO_CRYPTO' | 'DECENTRALIZED_TOKEN';
export type SettlementMode = 'SIMULATED' | 'EVM_ERC20';
export type AssetLifecycle = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
export type WalletLifecycle = 'ACTIVE' | 'SUSPENDED';
export type BindingLifecycle = 'VERIFIED' | 'REVOKED';
export type NetworkEnvironment = 'LOCAL' | 'TESTNET' | 'MAINNET';
export type WalletRole = 'USER' | 'ASSET_ADMIN' | 'DEMO_OPERATOR' | 'AUDITOR' | 'ACCESS_ADMIN';

export interface AssetV2 {
  id: string;
  code: string;
  symbol: string;
  displayName: string;
  precision: number;
  kind: AssetKind;
  mode: SettlementMode;
  lifecycle: AssetLifecycle;
  revision: string;
  identityKey: string;
  networkId?: string;
  contractAddress?: string;
  custodyEnabled?: boolean;
  supplyCap?: string;
  minimum?: string;
  maximum?: string;
}

export interface AdministrationStatus {
  roles: WalletRole[];
  setupAvailable: boolean;
  maintenance: boolean;
  demoEnabled: boolean;
}
export interface CustodyActivity {
  id: string;
  kind: 'ISSUE' | 'TRANSFER';
  asset: { id: string; code: string; precision: number };
  quantity: string;
  direction: 'ISSUED' | 'SENT' | 'RECEIVED';
  referenceId: string;
  createdAt: string;
  sequence: string;
  hash: string;
  previousHash: string;
  provenance: 'OBSERVED' | 'MIGRATED_POLICY';
  inputs: Array<{ id: string; quantity: string }>;
  outputs: Array<{
    id: string;
    quantity: string;
    owner: 'YOU' | 'COUNTERPARTY';
    status: 'SPENT' | 'UNSPENT';
  }>;
  allocations: Array<{ inputId: string; outputId: string; quantity: string }>;
}
export interface ActivityPage {
  events: CustodyActivity[];
  nextCursor: string | null;
}
export interface DemoProfile {
  userCount: number;
  transferDepth: number;
}
export interface SeedPreview {
  id: string;
  profile: DemoProfile;
  profileHash: string;
  expiresAt: string;
  users: Array<{ handle: string; email: string }>;
  allocations: Array<{ code: string; quantityPerUser: string }>;
  transferCount: number;
}
export interface WalletBindingView {
  id: string;
  networkId: string;
  address: string;
  status: BindingLifecycle;
  revision: string;
  networkName?: string;
  chainId?: string;
}
export interface WalletNetwork {
  id: string;
  displayName: string;
  chainId: string;
  genesisHash: string;
  environment: 'LOCAL' | 'TESTNET';
  status: 'ACTIVE' | 'PAUSED';
  revision: string;
}
export interface WalletChallenge {
  id: string;
  message: string;
  expiresAt: string;
  address: string;
  networkId: string;
}
export interface WalletV2 {
  id: string;
  status: WalletLifecycle;
  revision: string;
  displayName?: string;
  configured?: boolean;
  configurationRevision?: string;
  preferredAssetId?: string | null;
  bindings: WalletBindingView[];
  holdings: Array<{
    asset: AssetV2;
    source: 'SIMULATED' | 'CHAIN';
    balance: string;
    status: 'AVAILABLE' | 'UNAVAILABLE';
    stale: boolean;
    observedAt?: string;
    block?: { number: string; hash: string };
  }>;
}
export interface RecipientLookupInput {
  assetId: string;
  senderWalletId: string;
  lookup: { kind: 'HANDLE' | 'WALLET_ID' | 'CHAIN_ADDRESS'; value: string };
}
export interface RecipientResolutionView {
  resolutionId: string;
  expiresAt: string;
  recipient: { userId: string; publicHandle: string; displayName: string; walletId: string };
  destination: { mode: SettlementMode; networkId?: string; address?: string };
  revisions: { senderWallet: string; recipientWallet: string; asset: string; binding?: string };
}
export interface SendIntentInput {
  recipientResolutionId: string;
  senderWalletId: string;
  assetId: string;
  quantity: string;
}
export interface SimulatedTransferV2View extends TransferView {
  payloadVersion: 2;
  mode: 'SIMULATED';
  senderWalletId: string;
  recipientWalletId: string;
}
export type ChainPhase =
  | 'PREPARED'
  | 'BROADCAST_UNKNOWN'
  | 'SUBMITTED'
  | 'INCLUDED'
  | 'FINALIZED'
  | 'REVERTED'
  | 'REPLACED'
  | 'EXPIRED'
  | 'NEEDS_RECONCILIATION';
export interface ChainTransferView {
  id: string;
  mode: 'EVM_ERC20';
  phase: ChainPhase;
  asset: AssetV2;
  quantity: string;
  senderWalletId: string;
  recipientWalletId: string;
  intent: {
    chainId: string;
    from: string;
    to: string;
    data: string;
    value: '0';
    nonce?: string;
    expiresAt: string;
  };
  transactionHashes: string[];
  eligibilityChanged: boolean;
}
export interface MigrationIssue {
  code: string;
  collection: string;
  recordId?: string;
}
export interface MigrationAssessment {
  reportVersion: 1;
  assessedAt: string;
  snapshot: true;
  targetSchemaVersion: 2;
  state: 'BLOCKED' | 'POLICY_REQUIRED' | 'READY_FOR_BACKFILL';
  /** An assessment never authorizes or performs cutover. */
  cutoverEnabled: false;
  counts: {
    users: number;
    wallets: number;
    usersWithoutWallets: number;
    userAccountsWithoutWallets: number;
    legacyAssets: number;
    pendingTransfers: number;
    issuances: number;
    committedTransfers: number;
  };
  assets: Array<{
    assetId: string;
    userUnits: string;
    systemUnits: string;
    issuedUnits: string;
    provenance: 'EMPTY' | 'MIGRATED_POLICY_REQUIRED' | 'INVALID';
  }>;
  blockers: MigrationIssue[];
  policyRequirements: string[];
  collections: Array<{
    name: string;
    validatorPresent: boolean;
    indexes: Array<{ name: string; key: Record<string, unknown>; unique: boolean }>;
  }>;
}
