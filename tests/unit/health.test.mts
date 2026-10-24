import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from '../../apps/api/src/health/health.controller.js';
import {
  createDatabaseFixture,
  databaseFailureMarker,
  type DatabaseCondition,
} from '../support/database-fixture.mjs';

describe('Database readiness', () => {
  it('[happy] accepts a writable primary in the configured replica set', async (context) => {
    const fixture = createDatabaseFixture();
    context.after(() => fixture.close());
    assert.deepEqual(await fixture.database.readiness(), {
      status: 'ready',
      checks: { mongodb: 'up', replicaSet: 'ready' },
    });
  });

  const rejected: [DatabaseCondition, string, 'up' | 'down'][] = [
    ['unreachable', 'negative', 'down'],
    ['wrong replica set', 'negative', 'up'],
    ['no writable primary', 'negative', 'up'],
    ['missing session support', 'edge', 'up'],
    ['invalid session support', 'edge', 'up'],
  ];
  for (const [condition, category, mongodb] of rejected) {
    it(`[${category}] rejects MongoDB with ${condition}`, async (context) => {
      const fixture = createDatabaseFixture(condition);
      context.after(() => fixture.close());
      assert.deepEqual(await fixture.database.readiness(), {
        status: 'unavailable',
        checks: { mongodb, replicaSet: 'unavailable' },
      });
    });
  }

  it('[edge] reflects an outage and recovery instead of caching readiness', async (context) => {
    const fixture = createDatabaseFixture();
    context.after(() => fixture.close());
    assert.equal((await fixture.database.readiness()).status, 'ready');
    fixture.setCondition('unreachable');
    assert.equal((await fixture.database.readiness()).status, 'unavailable');
    fixture.setCondition('ready');
    assert.equal((await fixture.database.readiness()).status, 'ready');
  });
});

describe('Health responses', () => {
  it('[happy] identifies the live API', async (context) => {
    const fixture = createDatabaseFixture();
    context.after(() => fixture.close());
    assert.deepEqual(new HealthController(fixture.database).live(), {
      status: 'ok',
      service: 'p2p-api',
    });
  });

  it('[happy] returns the ready database checks', async (context) => {
    const fixture = createDatabaseFixture();
    context.after(() => fixture.close());
    assert.deepEqual(await new HealthController(fixture.database).ready(), {
      status: 'ready',
      checks: { mongodb: 'up', replicaSet: 'ready' },
    });
  });

  it('[negative] returns 503 without leaking driver errors', async (context) => {
    const fixture = createDatabaseFixture('unreachable');
    context.after(() => fixture.close());
    await assert.rejects(
      () => new HealthController(fixture.database).ready(),
      (error: unknown) => {
        assert.ok(error instanceof ServiceUnavailableException);
        assert.equal(error.getStatus(), 503);
        assert.deepEqual(error.getResponse(), {
          status: 'unavailable',
          checks: { mongodb: 'down', replicaSet: 'unavailable' },
        });
        assert.ok(!JSON.stringify(error.getResponse()).includes(databaseFailureMarker));
        return true;
      },
    );
  });

  it('[edge] stays live during a database outage', async (context) => {
    const fixture = createDatabaseFixture('unreachable');
    context.after(() => fixture.close());
    assert.deepEqual(new HealthController(fixture.database).live(), {
      status: 'ok',
      service: 'p2p-api',
    });
  });
});
