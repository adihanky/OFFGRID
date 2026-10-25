import { ObjectId } from 'mongodb';
import { toLong } from '../accounts/quantity.js';
import type { WalletRecord } from './wallets.models.js';

/** Shared persistence factory; Auth does not import the Wallets Nest module. */
export function walletDocument(userId: ObjectId, now = new Date()): WalletRecord {
  return {
    _id: new ObjectId(),
    schemaVersion: 2,
    userId,
    status: 'ACTIVE',
    eligibilityRevision: toLong(0n),
    createdAt: now,
    updatedAt: now,
  };
}
