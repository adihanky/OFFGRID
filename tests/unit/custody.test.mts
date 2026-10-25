import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  allocateLots,
  CustodyLimitExceeded,
} from '../../apps/api/src/modules/custody/custody.service.js';
describe('O05 isolated custody allocation', () => {
  it('[happy] splits a root and retains exact change', () => {
    assert.deepEqual(allocateLots([{ id: 'root', quantity: 100000n }], 12525n, 100), [
      { inputId: 'root', recipientUnits: 12525n, changeUnits: 87475n },
    ]);
  });
  it('[happy] merges FIFO inputs and conserves all units', () => {
    const result = allocateLots(
      [
        { id: 'own', quantity: 100000n },
        { id: 'received', quantity: 12525n },
      ],
      110000n,
      100,
    );
    assert.deepEqual(result, [
      { inputId: 'own', recipientUnits: 100000n, changeUnits: 0n },
      { inputId: 'received', recipientUnits: 10000n, changeUnits: 2525n },
    ]);
    assert.equal(
      result.reduce((sum, a) => sum + a.recipientUnits + a.changeUnits, 0n),
      112525n,
    );
  });
  it('[negative] refuses lot limits rather than reducing the payment', () => {
    assert.throws(
      () =>
        allocateLots(
          [
            { id: 'first', quantity: 1n },
            { id: 'second', quantity: 1n },
          ],
          2n,
          1,
        ),
      CustodyLimitExceeded,
    );
    assert.throws(() => allocateLots([{ id: 'one', quantity: 1n }], 2n, 100), /reconciliation/);
    assert.throws(
      () =>
        allocateLots(
          [
            { id: 'one', quantity: 1n },
            { id: 'one', quantity: 1n },
          ],
          2n,
          100,
        ),
      /Invalid custody input/,
    );
  });
  it('[edge] minimum unit and int64 maximum remain exact', () => {
    assert.deepEqual(allocateLots([{ id: 'root', quantity: 9223372036854775807n }], 1n, 1), [
      { inputId: 'root', recipientUnits: 1n, changeUnits: 9223372036854775806n },
    ]);
    assert.deepEqual(
      allocateLots([{ id: 'root', quantity: 9223372036854775807n }], 9223372036854775807n, 1),
      [{ inputId: 'root', recipientUnits: 9223372036854775807n, changeUnits: 0n }],
    );
    assert.throws(() => allocateLots([], 0n, 1));
    assert.throws(() => allocateLots([], 1n, 1001));
  });
});
