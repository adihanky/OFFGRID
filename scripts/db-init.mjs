import { createLocalClient, pause, replicaSet } from './lib/database.mjs';

const client = createLocalClient();
try {
  let connected = false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await client.connect();
      connected = true;
      break;
    } catch {
      await pause(500);
    }
  }
  if (!connected) throw new Error('Local MongoDB did not start on 127.0.0.1:27017.');
  const admin = client.db('admin');
  try {
    const status = await admin.command({ replSetGetStatus: 1 });
    if (status.set !== replicaSet)
      throw new Error('Existing replica set is not rs0; refusing to change it.');
  } catch (error) {
    if (error.code !== 94) throw error;
    await admin.command({
      replSetInitiate: { _id: replicaSet, members: [{ _id: 0, host: '127.0.0.1:27017' }] },
    });
    console.log('Initialized the local rs0 replica set.');
  }
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const hello = await admin.command({ hello: 1 });
    if (hello.setName === replicaSet && hello.isWritablePrimary) {
      ready = true;
      break;
    }
    await pause(500);
  }
  if (!ready) throw new Error('Replica set did not elect a writable primary.');
  console.log('MongoDB rs0 is ready for transactions at 127.0.0.1:27017.');
} finally {
  await client.close();
}
