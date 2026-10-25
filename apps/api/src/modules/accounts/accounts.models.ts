import type { Long, ObjectId } from 'mongodb';
export interface AssetRecord {
  _id: ObjectId;
  code: string;
  displayName: string;
  precision: number;
  status: 'active' | 'disabled';
  createdAt: Date;
  schemaVersion?: 2;
  custodyEnabled?: boolean;
  kind?: 'DEMO_CRYPTO';
  mode?: 'SIMULATED';
  lifecycle?: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
  revision?: Long;
  identityKey?: string;
  symbol?: string;
  capUnits?: Long;
  minimumUnits?: Long;
  maximumUnits?: Long;
}
export interface AccountRecord {
  _id: ObjectId;
  ownerType: 'user' | 'system';
  userId?: ObjectId;
  walletId?: ObjectId;
  systemKey?: string;
  assetId: ObjectId;
  balanceUnits: Long;
  status: 'active' | 'disabled';
  createdAt: Date;
  updatedAt: Date;
}
export interface IssuanceRecord {
  _id: ObjectId;
  fixtureKey: string;
  assetId: ObjectId;
  systemAccountId: ObjectId;
  recipientAccountId: ObjectId;
  quantityUnits: Long;
  createdAt: Date;
}
