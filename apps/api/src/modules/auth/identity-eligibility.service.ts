import { Inject, Injectable } from '@nestjs/common';
import { Long, type ClientSession, type ObjectId } from 'mongodb';
import type { PublicPeer } from '@p2p/contracts';
import { DatabaseService } from '../../database/database.service.js';
import type { UserRecord } from './auth.models.js';
@Injectable()
export class IdentityEligibility {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}
  private get users() {
    return this.database.db.collection<UserRecord>('users');
  }
  async profile(id: ObjectId): Promise<PublicPeer | null> {
    const user = await this.users.findOne({ _id: id });
    return user
      ? {
          id: user._id.toHexString(),
          publicHandle: user.publicHandle,
          displayName: user.displayName,
        }
      : null;
  }
  async peer(handle: string): Promise<PublicPeer | null> {
    const user = await this.users.findOne({ publicHandle: handle, status: 'active' });
    return user
      ? {
          id: user._id.toHexString(),
          publicHandle: user.publicHandle,
          displayName: user.displayName,
        }
      : null;
  }
  async fence(id: ObjectId, session: ClientSession): Promise<boolean> {
    return (
      (
        await this.users.updateOne(
          { _id: id, status: 'active' },
          { $inc: { transferEligibilityRevision: Long.ONE } },
          { session },
        )
      ).matchedCount === 1
    );
  }
  async setStatus(id: ObjectId, state: 'active' | 'disabled') {
    await this.users.updateOne(
      { _id: id },
      { $set: { status: state, updatedAt: new Date() } },
      { writeConcern: { w: 'majority' } },
    );
  }
}
