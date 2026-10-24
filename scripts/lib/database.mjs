import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';

export const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
process.loadEnvFile(new URL('../../.env', import.meta.url));

export const localUri = 'mongodb://127.0.0.1:27017/?directConnection=true';
export const replicaSet = 'rs0';
export const databaseName = process.env.MONGODB_DB;
if (!databaseName || !/^[a-zA-Z0-9_-]+$/.test(databaseName)) {
  throw new Error('Set a valid MONGODB_DB in the root .env file.');
}

export function createLocalClient() {
  return new MongoClient(localUri, { serverSelectionTimeoutMS: 1500, timeoutMS: 5000 });
}

export const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
