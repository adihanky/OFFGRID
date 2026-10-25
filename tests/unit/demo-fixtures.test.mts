import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertDemoTarget,
  validateDemoPassword,
} from '../../apps/api/src/modules/accounts/demo-target.js';

const local = {
  NODE_ENV: 'development',
  MONGODB_URI: 'mongodb://127.0.0.1:27017/?replicaSet=rs0',
  MONGODB_DB: 'p2p_offgrid',
};

test('demo fixtures accept explicit local development and isolated test databases', () => {
  assert.doesNotThrow(() => assertDemoTarget(local));
  assert.doesNotThrow(() => assertDemoTarget({ ...local, MONGODB_DB: 'p2p_offgrid_demo' }));
  assert.doesNotThrow(() =>
    assertDemoTarget({
      ...local,
      NODE_ENV: 'test',
      MONGODB_URI: 'mongodb://localhost:27017/?directConnection=true',
      MONGODB_DB: `p2p_transfer_test_${'a'.repeat(32)}`,
    }),
  );
});

test('demo fixtures refuse production and unapproved database names', () => {
  for (const NODE_ENV of ['production', '', 'staging']) {
    assert.throws(() => assertDemoTarget({ ...local, NODE_ENV }), /development or test/);
  }
  for (const MONGODB_DB of [
    'production',
    'admin',
    'p2p_transfer_test_',
    `p2p_transfer_test_${'a'.repeat(31)}`,
    'p2p_offgrid_backup',
  ]) {
    assert.throws(() => assertDemoTarget({ ...local, MONGODB_DB }), /allowlisted/);
  }
});

test('demo fixtures accept the quick-start URI database only when it matches the explicit target', () => {
  for (const MONGODB_DB of [
    'p2p_offgrid',
    'p2p_offgrid_demo',
    `p2p_transfer_test_${'a'.repeat(32)}`,
  ]) {
    assert.doesNotThrow(() =>
      assertDemoTarget({
        ...local,
        MONGODB_DB,
        MONGODB_URI: `mongodb://127.0.0.1:27017/${MONGODB_DB}?replicaSet=rs0&directConnection=true`,
      }),
    );
  }
  for (const pathname of [
    '/p2p_offgrid_demo',
    '/p2p_offgrid/extra',
    '/p2p_offgrid/',
    '/%70%32p_offgrid',
  ]) {
    assert.throws(
      () =>
        assertDemoTarget({
          ...local,
          MONGODB_URI: `mongodb://127.0.0.1:27017${pathname}?replicaSet=rs0`,
        }),
      /local MongoDB/,
    );
  }
});

test('demo fixtures refuse remote, credentialed, multi-host or redirected connections', () => {
  for (const MONGODB_URI of [
    'mongodb://example.invalid:27017',
    'mongodb+srv://localhost',
    'mongodb://localhost:27018',
    'mongodb://user:password@localhost:27017',
    'mongodb://localhost:27017,example.invalid:27017',
    'mongodb://localhost:27017/admin',
    'mongodb://localhost:27017/?replicaSet=production',
    'mongodb://localhost:27017/?replicaSet=rs0&replicaSet=production',
    'mongodb://localhost:27017/?proxyHost=example.invalid',
    'mongodb://localhost:27017/?directConnection=false',
    'not a URI',
  ]) {
    assert.throws(() => assertDemoTarget({ ...local, MONGODB_URI }), /local MongoDB/);
  }
});

test('demo password is explicit, bounded, and preserved exactly', () => {
  for (const value of [undefined, '', 'x'.repeat(11), 'x'.repeat(129), 123456789012]) {
    assert.throws(() => validateDemoPassword(value), /DEMO_PASSWORD/);
  }
  for (const value of ['x'.repeat(12), ' x'.repeat(64)])
    assert.equal(validateDemoPassword(value), value);
});
