import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { retryDelay } from '../../apps/api/src/modules/transfers/transfers.service.js';
import { TransferRecoveryService } from '../../apps/api/src/workers/transfer-recovery.service.js';
import type { TransfersService } from '../../apps/api/src/modules/transfers/transfers.service.js';
import { transferUnitFixture } from '../support/transfer-unit-fixture.mjs';
describe('Recovery fencing and ambiguity R02-R08', () => {
  it('[edge] lost committed response is reconciled without a second effect', async () => {
    const { service, record, state } = transferUnitFixture();
    service.fault = async (stage) => {
      if (stage === 'afterCommit') throw new Error('response lost');
    };
    await service.executeClaim(record);
    assert.equal(record.status, 'COMMITTED');
    await service.executeClaim(record);
    assert.deepEqual(
      [state.debit, state.credit, state.ledger, state.chain, state.outbox],
      [1, 1, 1, 1, 1],
    );
  });
  it('[edge] stale token cannot commit or reject a new claim', async () => {
    const { service, record, state } = transferUnitFixture();
    const stale = { ...record };
    record.attemptToken = 'claim-two';
    await service.executeClaim(stale);
    await service.rejectClaim(stale, 'INSUFFICIENT_BALANCE');
    assert.equal(record.status, 'PENDING');
    assert.equal(record.attemptToken, 'claim-two');
    assert.equal(state.debit, 0);
    await service.executeClaim(record);
    assert.equal(record.status, 'COMMITTED');
    await service.rejectClaim(stale, 'ACCOUNT_UNAVAILABLE');
    assert.equal(record.status, 'COMMITTED');
  });
  it('[negative] ambiguous infrastructure error is not a business rejection', async () => {
    const { service, record } = transferUnitFixture();
    service.fault = async (stage) => {
      if (stage === 'claimed')
        throw Object.assign(new Error('commit uncertainty'), {
          errorLabels: ['UnknownTransactionCommitResult'],
        });
    };
    await service.executeClaim(record);
    assert.equal(record.status, 'PENDING');
    assert.equal(record.rejectionCode, null);
    assert.ok(record.nextAttemptAt > record.createdAt);
  });
  it('[edge] backoff is bounded with controlled jitter', () => {
    assert.equal(
      retryDelay(1, () => 0),
      2000,
    );
    assert.equal(
      retryDelay(10000, () => 0.5),
      60250,
    );
  });
  it('[happy/edge] runner suppresses overlap and stop drains in-flight work', async () => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const worker = new TransferRecoveryService({
      recover: async () => {
        calls++;
        await barrier;
      },
    } as unknown as TransfersService);
    worker.tick();
    worker.tick();
    assert.equal(calls, 1);
    let stopped = false;
    const stop = worker.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    assert.equal(stopped, false);
    release();
    await stop;
    worker.tick();
    assert.equal(calls, 1);
  });
});
