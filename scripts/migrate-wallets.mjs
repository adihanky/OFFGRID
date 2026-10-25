import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { EJSON } from 'bson';
import { loadEnvironment } from '../apps/api/dist/config/environment.js';
import { DatabaseService } from '../apps/api/dist/database/database.service.js';
import { CustodyService } from '../apps/api/dist/modules/custody/custody.service.js';
import { assertDemoTarget } from '../apps/api/dist/modules/accounts/demo-target.js';
import { initializeWalletSchema } from '../apps/api/dist/modules/wallets/wallet-schema.js';
import {
  migrateLegacyWallets,
  MIGRATION_POLICY,
} from '../apps/api/dist/modules/wallets/wallet-migration.js';

// Local/demo only. API and its worker must be stopped; never migrate on startup.
const environment = loadEnvironment();
assertDemoTarget(environment);
if (!process.argv.includes('--execute'))
  throw new Error('Use --execute after reading the migration policy in docs/WALLETS.md.');
const listening = await new Promise((resolve) => {
  const socket = connect({ host: '127.0.0.1', port: environment.API_PORT });
  socket.setTimeout(2000);
  socket.once('connect', () => {
    socket.destroy();
    resolve(true);
  });
  socket.once('error', () => {
    socket.destroy();
    resolve(false);
  });
  socket.once('timeout', () => {
    socket.destroy();
    resolve(true);
  });
});
if (listening) throw new Error('Stop the local API and its recovery worker before migration.');
const database = new DatabaseService(environment);
const cloneName = `p2p_transfer_test_${randomUUID().replaceAll('-', '')}`;
const clone = new DatabaseService({ ...environment, MONGODB_DB: cloneName });
const fingerprint = async (db) => {
  const rows = {};
  for (const name of [
    'accounts',
    'demoIssuances',
    'ledgerEntries',
    'transfers',
    'chainEntries',
    'chainHeads',
  ]) {
    rows[name] = await db
      .collection(name, { promoteLongs: false })
      .find({})
      .sort({ _id: 1 })
      .toArray();
    for (const row of rows[name]) {
      if (name === 'accounts') delete row.walletId;
      if (name === 'chainHeads') delete row.issuanceRevision;
    }
  }
  return EJSON.stringify(rows, { relaxed: false });
};
try {
  await database.onModuleInit();
  if (await database.db.collection('walletMigrations').findOne({ _id: 'wallet-v2' })) {
    console.log('Wallet migration already completed; no records changed.');
  } else {
    const snapshot = [];
    for (const info of await database.db.listCollections().toArray()) {
      const documents = await database.db
        .collection(info.name, { promoteLongs: false })
        .find({})
        .limit(50001)
        .toArray();
      if (documents.length > 50000) throw new Error('Backup dataset exceeds bounded tool limit.');
      snapshot.push({
        name: info.name,
        options: info.options,
        indexes: await database.db.collection(info.name).listIndexes().toArray(),
        documents,
      });
    }
    await mkdir('.local/wallet-backups', { recursive: true });
    const path = `.local/wallet-backups/pre-v2-${Date.now()}.ejson`;
    await writeFile(path, EJSON.stringify(snapshot, { relaxed: false }), { flag: 'wx' });
    // Restore the file, rather than the in-memory rows, into an isolated rehearsal database.
    const restored = EJSON.parse(await readFile(path, 'utf8'), { relaxed: false });
    await clone.onModuleInit();
    for (const collection of restored) {
      await clone.db.createCollection(collection.name, collection.options);
      if (collection.documents.length)
        await clone.db.collection(collection.name).insertMany(collection.documents);
      for (const index of collection.indexes.filter((row) => row.name !== '_id_')) {
        const { key, name, unique, sparse, partialFilterExpression, expireAfterSeconds } = index;
        await clone.db.collection(collection.name).createIndex(key, {
          name,
          ...(unique !== undefined ? { unique } : {}),
          ...(sparse !== undefined ? { sparse } : {}),
          ...(partialFilterExpression ? { partialFilterExpression } : {}),
          ...(expireAfterSeconds !== undefined ? { expireAfterSeconds } : {}),
        });
      }
    }
    const before = await fingerprint(database.db);
    if ((await fingerprint(clone.db)) !== before)
      throw new Error('Restored backup does not match financial data.');
    for (const target of [clone, database]) {
      await initializeWalletSchema(target.db);
      const custody = new CustodyService(target);
      await custody.onModuleInit();
      await target.db
        .collection('applicationState')
        .updateOne({ key: 'maintenance' }, { $set: { active: true } }, { upsert: true });
      // A failed cutover deliberately keeps maintenance active for investigation.
      const result = await migrateLegacyWallets(target, custody, MIGRATION_POLICY);
      if ((await fingerprint(target.db)) !== before)
        throw new Error('Migration changed legacy financial evidence.');
      if (!(await custody.verify()).ok)
        throw new Error('Migrated custody verification failed. Maintenance remains active.');
      await target.db
        .collection('applicationState')
        .updateOne({ key: 'maintenance' }, { $set: { active: false } });
      console.log(
        `${target === clone ? 'Rehearsal' : 'Local cutover'} verified: ${JSON.stringify(result)}`,
      );
    }
    console.log(
      `Backup restored and rehearsed; original financial records preserved. Backup: ${path}`,
    );
  }
} finally {
  if (/^p2p_transfer_test_[a-f0-9]{32}$/.test(cloneName)) {
    try {
      await clone.db.dropDatabase();
    } finally {
      await clone.onApplicationShutdown();
    }
  }
  await database.onApplicationShutdown();
}
