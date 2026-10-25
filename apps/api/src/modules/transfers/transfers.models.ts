import type { ObjectId, Long } from 'mongodb';
import type { PublicPeer, TransferRejectionCode, TransferView } from '@p2p/contracts';
export interface TransferRecord {
  _id: ObjectId;
  senderId: ObjectId;
  recipientId: ObjectId;
  assetId: ObjectId;
  quantityUnits: Long;
  idempotencyKey: string;
  payloadVersion: 1 | 2;
  mode?: 'SIMULATED';
  senderWalletId?: ObjectId;
  recipientWalletId?: ObjectId;
  recipientResolutionId?: ObjectId;
  payloadHash: string;
  status: 'PENDING' | 'COMMITTED' | 'REJECTED';
  rejectionCode: TransferRejectionCode | null;
  sender: PublicPeer;
  recipient: PublicPeer;
  asset: TransferView['asset'];
  attemptToken: string | null;
  leaseUntil: Date | null;
  attempts: number;
  nextAttemptAt: Date;
  createdAt: Date;
  updatedAt: Date;
  senderAccountId?: ObjectId;
  recipientAccountId?: ObjectId;
  committedAt?: Date;
  executionRevision?: number;
}
export class BusinessRejection extends Error {
  constructor(readonly code: TransferRejectionCode) {
    super(code);
  }
}
export class LostClaim extends Error {}
