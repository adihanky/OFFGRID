import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createLocalClient, databaseName, replicaSet } from './lib/database.mjs';

const client = createLocalClient();
let collection;
try {
  await client.connect();
  const hello = await client.db('admin').command({ hello: 1 });
  assert.equal(hello.setName, replicaSet);
  assert.equal(hello.isWritablePrimary, true);
  const db = client.db(databaseName);
  collection = await db.createCollection(`__setup_probe_${randomUUID().replaceAll('-', '')}`);
  const session = client.startSession();
  try {
    await session.withTransaction(
      async () => {
        await collection.insertOne({ state: 'committed' }, { session });
      },
      { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
    );
    session.startTransaction();
    await collection.insertOne({ state: 'aborted' }, { session });
    await session.abortTransaction();
    assert.equal(await collection.countDocuments({ state: 'committed' }), 1);
    assert.equal(await collection.countDocuments({ state: 'aborted' }), 0);
    console.log('PASS: replica set primary, transaction commit, and transaction rollback.');
  } finally {
    await session.endSession();
  }
} finally {
  try {
    if (collection) await collection.drop();
  } finally {
    await client.close();
  }
}
