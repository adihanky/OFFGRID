import assert from 'node:assert/strict';
import { Given, When, Then } from '@cucumber/cucumber';
import { fixtureMongoUri } from '../support/test-database-target.mjs';
import { assertDemoTarget } from '../../apps/api/src/modules/accounts/demo-target.js';
interface TargetWorld {
  fixturePort?: string;
  fixtureTarget?: { NODE_ENV: string; MONGODB_DB: string; MONGODB_URI: string };
}
Given('the isolated fixture port is {string}', function (this: TargetWorld, port: string) {
  this.fixturePort = port;
});
When(
  'a generated transfer database is configured in {string} mode',
  function (this: TargetWorld, mode: string) {
    this.fixtureTarget = {
      NODE_ENV: mode,
      MONGODB_DB: `p2p_transfer_test_${'a'.repeat(32)}`,
      MONGODB_URI: fixtureMongoUri(this.fixturePort!),
    };
  },
);
When(
  'the fixture database is {string} in {string} mode',
  function (this: TargetWorld, database: string, mode: string) {
    this.fixtureTarget = {
      NODE_ENV: mode,
      MONGODB_DB: database,
      MONGODB_URI: fixtureMongoUri(this.fixturePort!),
    };
  },
);
Then('its fixture target is accepted without connecting to the demo', function (this: TargetWorld) {
  assert.doesNotThrow(() => assertDemoTarget(this.fixtureTarget!));
  assert.equal(new URL(this.fixtureTarget!.MONGODB_URI).port, '27018');
});
Then('its fixture target is rejected before a connection', function (this: TargetWorld) {
  assert.throws(() => assertDemoTarget(this.fixtureTarget!));
});
Then('URI construction is rejected before a connection', function (this: TargetWorld) {
  assert.throws(() => fixtureMongoUri(this.fixturePort!), /P2P_TEST_MONGODB_PORT/);
});
