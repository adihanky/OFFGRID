import 'reflect-metadata';
import type { Environment } from '../../apps/api/src/config/environment.js';
import { DatabaseService } from '../../apps/api/src/database/database.service.js';

export type DatabaseCondition =
  | 'ready'
  | 'unreachable'
  | 'wrong replica set'
  | 'no writable primary'
  | 'missing session support'
  | 'invalid session support';

const environment: Environment = {
  NODE_ENV: 'test',
  API_PORT: 3000,
  WEB_ORIGIN: 'http://localhost:5173',
  MONGODB_URI: 'mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true',
  MONGODB_DB: 'p2p_offgrid_test',
  MONGODB_REPLICA_SET: 'rs0',
  SESSION_TTL_SECONDS: 604800,
  GOOGLE_CLIENT_ID: '',
  GOOGLE_CLIENT_SECRET: '',
  GOOGLE_REDIRECT_URI: '',
  ADMIN_SETUP_TOKEN: '',
  EVM_RPC_ALLOWED_HOSTS: '',
};

export const databaseFailureMarker = 'synthetic-private-driver-error';

export function createDatabaseFixture(initial: DatabaseCondition = 'ready') {
  let condition = initial;
  const database = new DatabaseService(environment);

  // Replace only the MongoDB command boundary. The real readiness logic runs,
  // but tests never connect to or modify a database.
  Object.defineProperty(database, 'db', {
    get: () => ({
      admin: () => ({
        command: async () => {
          if (condition === 'unreachable') throw new Error(databaseFailureMarker);
          const hello: Record<string, unknown> = {
            setName: condition === 'wrong replica set' ? 'another-set' : 'rs0',
            isWritablePrimary: condition !== 'no writable primary',
            logicalSessionTimeoutMinutes: 30,
          };
          if (condition === 'missing session support') delete hello.logicalSessionTimeoutMinutes;
          if (condition === 'invalid session support') hello.logicalSessionTimeoutMinutes = '30';
          return hello;
        },
      }),
    }),
  });

  return {
    database,
    setCondition(value: string) {
      const conditions: DatabaseCondition[] = [
        'ready',
        'unreachable',
        'wrong replica set',
        'no writable primary',
        'missing session support',
        'invalid session support',
      ];
      if (!conditions.includes(value as DatabaseCondition)) {
        throw new Error(`Unknown test database condition: ${value}`);
      }
      condition = value as DatabaseCondition;
    },
    close: () => database.client.close(),
  };
}
