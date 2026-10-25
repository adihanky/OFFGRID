import assert from 'node:assert/strict';
import { Given, When, Then, type World } from '@cucumber/cucumber';
import { assertDemoTarget } from '../../apps/api/src/modules/accounts/demo-target.js';

interface DemoTargetWorld extends World {
  demoEnvironment: { NODE_ENV: string; MONGODB_URI: string; MONGODB_DB: string };
  demoTargetError?: unknown;
}
Given(
  'a demo target URI {string} and database {string}',
  function (this: DemoTargetWorld, uri: string, database: string) {
    this.demoEnvironment = { NODE_ENV: 'development', MONGODB_URI: uri, MONGODB_DB: database };
  },
);
When('the demo connection safety guard runs', function (this: DemoTargetWorld) {
  try {
    assertDemoTarget(this.demoEnvironment);
  } catch (error) {
    this.demoTargetError = error;
  }
});
Then('the demo target is {string}', function (this: DemoTargetWorld, outcome: string) {
  if (outcome === 'accepted') assert.equal(this.demoTargetError, undefined);
  else {
    assert.equal(outcome, 'rejected');
    assert.ok(this.demoTargetError instanceof Error);
  }
});
