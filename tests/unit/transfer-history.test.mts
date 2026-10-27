import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ObjectId } from 'mongodb';
import {
  historyCursor,
  historyQuery,
} from '../../apps/api/src/modules/transfers/transfer-history-query.js';

const caller = '111111111111111111111111';
describe('Participant transfer history query', () => {
  it('[happy] scopes senders and committed recipients and normalizes bounded filters', () => {
    const result = historyQuery(caller, { peerHandle: '  Bob  ', limit: '3' });
    assert.equal(result.limit, 3);
    assert.deepEqual(result.filter.$and![0], {
      $or: [
        { senderId: new ObjectId(caller), 'recipient.publicHandle': 'bob' },
        { recipientId: new ObjectId(caller), status: 'COMMITTED', 'sender.publicHandle': 'bob' },
      ],
    });
  });
  it('[negative] rejects arbitrary fields, malformed cursors, oversized limits and invalid ranges', () => {
    for (const query of [
      { ownerId: caller },
      { limit: '101' },
      { limit: ['1'] },
      { cursor: 'a'.repeat(1025) },
      { cursor: 'e30' },
      { from: '2026-01-01T00:00:00Z' },
      { from: '2026-03-01T00:00:00Z', to: '2026-01-01T00:00:00Z' },
      { from: '2024-01-01T00:00:00Z', to: '2026-01-01T00:00:00Z' },
    ])
      assert.throws(() => historyQuery(caller, query));
  });
  it('[edge] binds a cursor to caller and filters and orders equal timestamps by ID', () => {
    const query = historyQuery(caller, { status: 'PENDING' });
    const at = new Date('2026-10-26T00:00:00.000Z');
    const last = { _id: new ObjectId(), createdAt: at };
    const cursor = historyCursor(query.digest, last);
    const next = historyQuery(caller, { status: 'PENDING', cursor });
    assert.deepEqual(next.filter.$and!.at(-1), {
      $or: [{ createdAt: { $lt: at } }, { createdAt: at, _id: { $lt: last._id } }],
    });
    assert.throws(() => historyQuery('222222222222222222222222', { status: 'PENDING', cursor }));
    assert.throws(() => historyQuery(caller, { status: 'COMMITTED', cursor }));
  });
  it('[negative/edge] received pending/rejected filters cannot widen committed visibility', () => {
    const query = historyQuery(caller, { direction: 'RECEIVED', status: 'REJECTED' });
    assert.deepEqual(query.filter.$and, [
      { $or: [{ recipientId: new ObjectId(caller), status: 'COMMITTED' }] },
      { status: 'REJECTED' },
    ]);
  });
});
