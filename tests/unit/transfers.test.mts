import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  normalizeKey,
  payloadHash,
  transferView,
} from '../../apps/api/src/modules/transfers/transfers.service.js';
import { transferUnitFixture } from '../support/transfer-unit-fixture.mjs';
describe('Transfer orchestration and identity T01-T12/R01', () => {
  it('[happy] commits balances journal chain state and event in caller session', async () => {
    const { service, record, state } = transferUnitFixture();
    await service.executeClaim(record);
    assert.equal(record.status, 'COMMITTED');
    assert.deepEqual(
      [state.debit, state.credit, state.ledger, state.custody, state.chain, state.outbox],
      [1, 1, 1, 1, 1, 1],
    );
    assert.ok(state.sessionChecks >= 11);
  });
  for (const [name, field, code] of [
    ['insufficient', 'debitAllowed', 'INSUFFICIENT_BALANCE'],
    ['overflow', 'creditAllowed', 'BALANCE_LIMIT_EXCEEDED'],
    ['account disabled', 'accountActive', 'ACCOUNT_UNAVAILABLE'],
  ] as const)
    it(`[negative] ${name} aborts before durable rejection`, async () => {
      const { service, record, state } = transferUnitFixture();
      state[field] = false;
      await service.executeClaim(record);
      assert.equal(record.status, 'REJECTED');
      assert.equal(record.rejectionCode, code);
      assert.deepEqual(
        [state.debit, state.credit, state.ledger, state.custody, state.chain, state.outbox],
        [0, 0, 0, 0, 0, 0],
      );
    });
  it('[negative] inactive identity refuses any financial mutation', async () => {
    const { service, record, state } = transferUnitFixture();
    state.eligible = false;
    await service.executeClaim(record);
    assert.equal(record.status, 'REJECTED');
    assert.match(record.rejectionCode!, /UNAVAILABLE/);
    assert.equal(state.debit, 0);
  });
  for (const boundary of ['debit', 'credit', 'ledger', 'custody', 'chain', 'status', 'outbox'])
    it(`[negative] ${boundary} failure rolls back all effects and remains pending`, async () => {
      const { service, record, state } = transferUnitFixture();
      service.fault = async (stage) => {
        if (stage === boundary) throw new Error('isolated infrastructure fault');
      };
      await service.executeClaim(record);
      assert.equal(record.status, 'PENDING');
      assert.equal(record.rejectionCode, null);
      assert.deepEqual(
        [state.debit, state.credit, state.ledger, state.custody, state.chain, state.outbox],
        [0, 0, 0, 0, 0, 0],
      );
      assert.ok(record.nextAttemptAt > record.createdAt);
    });
  it('[edge] canonical identity changes only with effective content or sender', () => {
    assert.equal(payloadHash('a', 'b', 'c', 100n), payloadHash('a', 'b', 'c', 100n));
    for (const tuple of [
      ['d', 'b', 'c', 100n],
      ['a', 'd', 'c', 100n],
      ['a', 'b', 'd', 100n],
      ['a', 'b', 'c', 101n],
    ] as const)
      assert.notEqual(
        payloadHash(tuple[0], tuple[1], tuple[2], tuple[3]),
        payloadHash('a', 'b', 'c', 100n),
      );
    assert.equal(
      normalizeKey('CE706C77-6A1B-4546-B471-F752C8D451FA'),
      'ce706c77-6a1b-4546-b471-f752C8D451FA'.toLowerCase(),
    );
    assert.throws(() => normalizeKey('bad'));
    assert.throws(() => normalizeKey(['ce706c77-6a1b-4546-b471-f752c8d451fa']));
  });
  it('[security] public projection excludes private execution metadata', () => {
    const { record } = transferUnitFixture();
    const response = transferView(record);
    assert.equal(response.quantity, '3.25');
    for (const field of [
      'payloadHash',
      'idempotencyKey',
      'attemptToken',
      'leaseUntil',
      'attempts',
      'quantityUnits',
    ])
      assert.ok(!(field in response));
  });
});
