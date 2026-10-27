import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fixtureMongoUri } from '../support/test-database-target.mjs';
import { assertDemoTarget } from '../../apps/api/src/modules/accounts/demo-target.js';

describe('Isolated fixture database target', () => {
  const generated = `p2p_transfer_test_${'a'.repeat(32)}`;
  it('[happy] uses an explicit loopback-only replica-set URI for either supported port', () => {
    for (const port of ['27017', '27018']) {
      const target = new URL(fixtureMongoUri(port));
      assert.equal(target.hostname, '127.0.0.1');
      assert.equal(target.port, port);
      assert.equal(target.searchParams.get('replicaSet'), 'rs0');
      assert.equal(target.searchParams.get('directConnection'), 'true');
    }
  });
  it('[negative] refuses blank, arbitrary and injected port selections', () => {
    for (const port of ['', '27019', '27018@remote.invalid', '27018/?proxyHost=remote.invalid'])
      assert.throws(() => fixtureMongoUri(port), /P2P_TEST_MONGODB_PORT/);
  });
  it('[edge] permits the alternate port only for generated transfer fixtures in test mode', () => {
    const environment = {
      NODE_ENV: 'test',
      MONGODB_DB: generated,
      MONGODB_URI: fixtureMongoUri('27018'),
    };
    assert.doesNotThrow(() => assertDemoTarget(environment));
    for (const override of [
      { NODE_ENV: 'development' },
      { NODE_ENV: 'production' },
      { MONGODB_DB: 'p2p_offgrid' },
      { MONGODB_DB: 'p2p_offgrid_demo' },
      { MONGODB_DB: 'p2p_transfer_test_not_random' },
    ])
      assert.throws(() => assertDemoTarget({ ...environment, ...override }));
  });
});
