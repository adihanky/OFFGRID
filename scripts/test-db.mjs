import assert from 'node:assert/strict';
import { MongoClient, MongoNetworkError } from 'mongodb';

const action = process.argv[2] ?? 'verify';
assert.ok(['start', 'verify', 'stop'].includes(action));
const client = new MongoClient('mongodb://127.0.0.1:27018/?directConnection=true', {
  serverSelectionTimeoutMS: 1500,
  timeoutMS: 5000,
});
const pause = () => new Promise((resolve) => setTimeout(resolve, 500));
try {
  let connected = false;
  for (let attempt = 0; attempt < (action === 'start' ? 60 : 1); attempt++) {
    try {
      await client.connect();
      connected = true;
      break;
    } catch {
      await pause();
    }
  }
  assert.ok(connected, 'Isolated MongoDB did not start on 127.0.0.1:27018.');
  const admin = client.db('admin');
  try {
    const status = await admin.command({ replSetGetStatus: 1 });
    assert.equal(status.set, 'rs0');
  } catch (error) {
    if (error.code !== 94 || action !== 'start') throw error;
    await admin.command({
      replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: '127.0.0.1:27018' }] },
    });
  }
  const config = await admin.command({ replSetGetConfig: 1 });
  assert.deepEqual(
    config.config.members.map((member) => member.host),
    ['127.0.0.1:27018'],
  );
  const diagnostics = await admin.command({ getParameter: 1, diagnosticDataCollectionEnabled: 1 });
  assert.equal(diagnostics.diagnosticDataCollectionEnabled, false);
  if (action === 'stop') {
    try {
      await admin.command({ shutdown: 1 });
    } catch (error) {
      if (!(error instanceof MongoNetworkError)) throw error;
    }
    console.log('Isolated test MongoDB stopped; its data directory was preserved.');
  } else {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      const hello = await admin.command({ hello: 1 });
      if (hello.setName === 'rs0' && hello.isWritablePrimary) {
        ready = true;
        break;
      }
      await pause();
    }
    assert.ok(ready, 'Isolated replica set did not elect a primary.');
    console.log(
      'Isolated test rs0 ready at 127.0.0.1:27018; diagnostics disabled; demo target untouched.',
    );
  }
} finally {
  await client.close();
}
