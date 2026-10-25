import type { Db } from 'mongodb';
import { collectionSchema, date, long, oid, text } from '../accounts/schema.js';
import { toLong } from '../accounts/quantity.js';

const schemaVersion = { enum: [2] };
const revision = { ...long, minimum: toLong(0n) };
const timestamps = { createdAt: date, updatedAt: date };
const address = { ...text, pattern: '^0x[0-9a-f]{40}$' };
/** These are additive schemas; no existing user, account or asset is backfilled. */
export async function initializeWalletSchema(db: Db) {
  await collectionSchema(
    db,
    'wallets',
    {
      schemaVersion,
      userId: oid,
      status: { enum: ['ACTIVE', 'SUSPENDED'] },
      eligibilityRevision: revision,
      displayName: { ...text, minLength: 1, maxLength: 60 },
      configurationRevision: revision,
      preferredAssetId: { bsonType: ['objectId', 'null'] },
      setupCompletedAt: date,
      ...timestamps,
    },
    ['schemaVersion', 'userId', 'status', 'eligibilityRevision', 'createdAt', 'updatedAt'],
    { additionalProperties: false },
  );
  await db.collection('wallets').createIndex({ userId: 1 }, { unique: true, name: 'wallet_user' });
  await collectionSchema(
    db,
    'walletBindings',
    {
      schemaVersion,
      walletId: oid,
      networkId: oid,
      normalizedAddress: address,
      status: { enum: ['VERIFIED', 'REVOKED'] },
      proofId: oid,
      verifiedAt: date,
      revision,
      ...timestamps,
    },
    undefined,
    { additionalProperties: false },
  );
  await db
    .collection('walletBindings')
    .createIndex(
      { networkId: 1, normalizedAddress: 1 },
      { unique: true, name: 'binding_lifetime_address' },
    );
  await db
    .collection('walletBindings')
    .createIndex({ walletId: 1, networkId: 1 }, { unique: true, name: 'binding_wallet_network' });
  await collectionSchema(
    db,
    'roleGrants',
    {
      schemaVersion,
      userId: oid,
      role: { enum: ['USER', 'ASSET_ADMIN', 'DEMO_OPERATOR', 'AUDITOR', 'ACCESS_ADMIN'] },
      status: { enum: ['ACTIVE', 'REVOKED'] },
      revision,
      ...timestamps,
    },
    undefined,
    { additionalProperties: false },
  );
  await db
    .collection('roleGrants')
    .createIndex({ userId: 1, role: 1 }, { unique: true, name: 'role_user' });
}
