export interface LivenessResponse {
  status: 'ok';
  service: 'p2p-api';
}

export interface ReadinessResponse {
  status: 'ready' | 'unavailable';
  checks: {
    mongodb: 'up' | 'down';
    replicaSet: 'ready' | 'unavailable';
  };
}

export interface AuthUser {
  id: string;
  email: string;
  publicHandle: string;
  displayName: string;
  emailVerified: boolean;
  signInMethod: 'email' | 'google';
}

export interface AuthResponse {
  user: AuthUser;
}
export interface AuthProvidersResponse {
  google: boolean;
  email: true;
}
export interface CsrfResponse {
  csrfToken: string;
}
export interface SignInRequest {
  email: string;
  password: string;
}
export interface SignUpRequest extends SignInRequest {
  publicHandle: string;
}

export interface PublicPeer {
  id: string;
  publicHandle: string;
  displayName: string;
}
export interface WalletAccount {
  assetId: string;
  code: string;
  displayName: string;
  precision: number;
  balance: string;
  status: 'active' | 'disabled';
}
export interface WalletResponse {
  accounts: WalletAccount[];
}
export interface PeerResponse {
  peer: PublicPeer;
}
export interface CreateTransferRequest {
  recipientId: string;
  assetId: string;
  quantity: string;
}
export type TransferRejectionCode =
  | 'INSUFFICIENT_BALANCE'
  | 'RECIPIENT_UNAVAILABLE'
  | 'SENDER_UNAVAILABLE'
  | 'ACCOUNT_UNAVAILABLE'
  | 'ASSET_UNAVAILABLE'
  | 'BALANCE_LIMIT_EXCEEDED'
  | 'WALLET_UNAVAILABLE'
  | 'LOT_LIMIT_EXCEEDED'
  | 'QUANTITY_LIMIT_EXCEEDED';
export interface TransferView {
  id: string;
  sender: PublicPeer;
  recipient: PublicPeer;
  asset: { id: string; code: string; displayName: string; precision: number };
  quantity: string;
  status: 'PENDING' | 'COMMITTED' | 'REJECTED';
  rejectionCode: TransferRejectionCode | null;
  createdAt: string;
  updatedAt: string;
}
export interface TransferResponse {
  transfer: TransferView;
}
export * from './wallet-v2.js';
export * from './transfer-history.js';
export * from './settings.js';
export * from './requests.js';
export * from './workspace.js';
export * from './notifications.js';
