import 'reflect-metadata';
import assert from 'node:assert/strict';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { After, Before, Given, Then, When, World, setWorldConstructor } from '@cucumber/cucumber';
import { DatabaseService } from '../../apps/api/src/database/database.service.js';
import { HealthController } from '../../apps/api/src/health/health.controller.js';
import { createDatabaseFixture, databaseFailureMarker } from '../support/database-fixture.mjs';

class HealthTestModule {}

class HealthWorld extends World {
  fixture = createDatabaseFixture();
  app?: INestApplication;
  origin = '';
  response?: Response;
  body: unknown;
}

setWorldConstructor(HealthWorld);

Before({ tags: '@health' }, async function (this: HealthWorld) {
  this.app = await NestFactory.create(
    {
      module: HealthTestModule,
      controllers: [HealthController],
      // The wrapper deliberately excludes DatabaseService lifecycle hooks:
      // readiness uses the real service with an isolated MongoDB command fixture.
      providers: [
        {
          provide: DatabaseService,
          useValue: { readiness: () => this.fixture.database.readiness() },
        },
      ],
    },
    { logger: false, abortOnError: false },
  );
  this.app.setGlobalPrefix('api');
  await this.app.listen(0, '127.0.0.1');
  this.origin = await this.app.getUrl();
});

After({ tags: '@health' }, async function (this: HealthWorld) {
  try {
    await this.app?.close();
  } finally {
    await this.fixture.close();
  }
});

Given('MongoDB is {string}', function (this: HealthWorld, condition: string) {
  this.fixture.setCondition(condition);
});

When('MongoDB becomes {string}', function (this: HealthWorld, condition: string) {
  this.fixture.setCondition(condition);
});

When('I request GET {string}', async function (this: HealthWorld, path: string) {
  assert.ok(path.startsWith('/api/health/'), 'Health scenarios must target the local health API.');
  this.response = await fetch(`${this.origin}${path}`, { signal: AbortSignal.timeout(3000) });
  this.body = await this.response.json();
});

Then('the response status is {int}', function (this: HealthWorld, status: number) {
  assert.ok(this.response, 'No HTTP response received.');
  assert.equal(this.response.status, status);
});

Then('the live service is {string}', function (this: HealthWorld, service: string) {
  assert.deepEqual(this.body, { status: 'ok', service });
});

Then('the readiness status is {string}', function (this: HealthWorld, status: string) {
  assert.ok(this.body !== null && typeof this.body === 'object' && 'status' in this.body);
  assert.equal(this.body.status, status);
});

Then(
  'the readiness checks report MongoDB {string} and replica set {string}',
  function (this: HealthWorld, mongodb: string, replicaSet: string) {
    assert.ok(this.body !== null && typeof this.body === 'object' && 'checks' in this.body);
    assert.deepEqual(this.body.checks, { mongodb, replicaSet });
  },
);

Then('the response does not reveal private driver errors', function (this: HealthWorld) {
  assert.ok(!JSON.stringify(this.body).includes(databaseFailureMarker));
});
