import { MongoClient } from 'mongodb';
import { loadEnvironment } from '../apps/api/dist/config/environment.js';
import { readMigrationAssessment } from '../apps/api/dist/modules/wallets/migration-assessment.js';

// Deliberately does not bootstrap Nest or workers. Connection details and private
// user profiles are never printed. This command does not write an assessment file.
const environment = loadEnvironment();
const client = new MongoClient(environment.MONGODB_URI, {
  appName: 'p2p-wallet-read-only-assessment',
  serverSelectionTimeoutMS: 3000,
});
try {
  await client.connect();
  const report = await readMigrationAssessment(client.db(environment.MONGODB_DB));
  console.log(JSON.stringify(report, null, 2));
  if (report.state === 'BLOCKED') process.exitCode = 2;
} catch {
  console.error(
    'Wallet assessment failed; verify replica-set access and the documented size limit. No migration was performed.',
  );
  process.exitCode = 1;
} finally {
  await client.close();
}
