import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createLocalClient, projectRoot, replicaSet } from './lib/database.mjs';

const client = createLocalClient();
try {
  await client.connect();
  const admin = client.db('admin');
  const hello = await admin.command({ hello: 1 });
  const options = await admin.command({ getCmdLineOpts: 1 });
  assert.equal(hello.setName, replicaSet, 'Refusing to stop an unexpected replica set.');
  assert.equal(
    resolve(options.parsed.storage.dbPath).toLowerCase(),
    resolve(projectRoot, '.local/mongodb/data').toLowerCase(),
    'Refusing to stop MongoDB outside this workspace. Use docker compose down for Docker.',
  );
  try {
    await admin.command({ shutdown: 1 });
  } catch (error) {
    if (!['MongoNetworkError', 'MongoServerSelectionError'].includes(error.name)) throw error;
  }
  console.log('Stopped the project-local MongoDB server. Data is retained.');
} finally {
  await client.close();
}
