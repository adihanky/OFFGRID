import type { Long, ObjectId } from 'mongodb';
import type { BindingLifecycle, WalletLifecycle, WalletRole } from '@p2p/contracts';

export interface WalletRecord {
  _id: ObjectId;
  schemaVersion: 2;
  userId: ObjectId;
  status: WalletLifecycle;
  eligibilityRevision: Long;
  createdAt: Date;
  updatedAt: Date;
}
export interface WalletBindingRecord {
  _id: ObjectId;
  schemaVersion: 2;
  walletId: ObjectId;
  networkId: ObjectId;
  normalizedAddress: string;
  status: BindingLifecycle;
  proofId: ObjectId;
  verifiedAt: Date;
  revision: Long;
  createdAt: Date;
  updatedAt: Date;
}
export interface RoleGrantRecord {
  _id: ObjectId;
  schemaVersion: 2;
  userId: ObjectId;
  role: WalletRole;
  status: 'ACTIVE' | 'REVOKED';
  revision: Long;
  createdAt: Date;
  updatedAt: Date;
}
