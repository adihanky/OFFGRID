import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { ObjectId } from 'mongodb';
import type { WalletRole } from '@p2p/contracts';
import { DatabaseService } from '../../database/database.service.js';
import type { RoleGrantRecord } from './wallets.models.js';

/** Roles are never inferred from registration order, a cookie or client claims. */
@Injectable()
export class RoleAuthorization {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async require(userId: ObjectId, role: Exclude<WalletRole, 'USER'>) {
    const user = await this.database.db
      .collection('users')
      .findOne({ _id: userId, status: 'active' }, { projection: { _id: 1 } });
    const grant =
      user &&
      (await this.database.db
        .collection<RoleGrantRecord>('roleGrants')
        .findOne({ userId, role, status: 'ACTIVE' }, { projection: { _id: 1, revision: 1 } }));
    if (!grant) throw new ForbiddenException('This operation requires an active role grant.');
    return grant;
  }
}
