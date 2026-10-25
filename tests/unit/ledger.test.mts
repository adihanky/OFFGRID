import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ObjectId, type ClientSession } from 'mongodb';
import {
  LedgerService,
  validatePair,
  type JournalPair,
  type LedgerEntry,
} from '../../apps/api/src/modules/ledger/ledger.service.js';
import type { DatabaseService } from '../../apps/api/src/database/database.service.js';
import { MAX_UNITS, units } from '../../apps/api/src/modules/accounts/quantity.js';
const pair = (): JournalPair => ({
  referenceKind: 'transfer',
  referenceId: new ObjectId(),
  debitAccountId: new ObjectId(),
  creditAccountId: new ObjectId(),
  assetId: new ObjectId(),
  quantityUnits: 12n,
  createdAt: new Date('2026-10-24T00:00:00.000Z'),
});
describe('Balanced journal T01/W07-W09', () => {
  it('[happy] writes exact opposite entries using caller session', async () => {
    const entries: LedgerEntry[] = [];
    const session = {} as ClientSession;
    const database = {
      db: {
        collection: () => ({
          insertOne: async (entry: LedgerEntry, options: { session: ClientSession }) => {
            assert.equal(options.session, session);
            entries.push(entry);
          },
        }),
      },
    } as unknown as DatabaseService;
    const input = pair();
    await new LedgerService(database).pair(input, session);
    assert.deepEqual(
      entries.map((e) => e.side),
      ['debit', 'credit'],
    );
    assert.ok(
      entries.every(
        (e) => e.referenceId.equals(input.referenceId) && units(e.quantityUnits) === 12n,
      ),
    );
    assert.ok(entries[0]!.accountId.equals(input.debitAccountId));
    assert.ok(entries[1]!.accountId.equals(input.creditAccountId));
  });
  it('[negative] rejects self journal, zero, negative and overflow', () => {
    const input = pair();
    assert.throws(() => validatePair({ ...input, creditAccountId: input.debitAccountId }));
    for (const quantityUnits of [0n, -1n, MAX_UNITS + 1n])
      assert.throws(() => validatePair({ ...input, quantityUnits }));
  });
  it('[edge] typed issuance reference supports signed system accounting', () => {
    assert.doesNotThrow(() =>
      validatePair({ ...pair(), referenceKind: 'demoIssuance', quantityUnits: MAX_UNITS }),
    );
  });
});
