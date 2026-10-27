import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ObjectId } from 'mongodb';
import {
  consumerRequestSchema,
  requestDigest,
  requestView,
} from '../../apps/api/src/modules/requests/requests.service.js';
import { toLong } from '../../apps/api/src/modules/accounts/quantity.js';
describe('Consumer request contracts', () => {
  it('[happy] accepts an explicit bounded request without granting access', () => {
    const input = consumerRequestSchema.parse({
      type: 'ACCESS',
      role: 'ASSET_ADMIN',
      reason: ' Need demo administration ',
    });
    assert.equal(input.reason, 'Need demo administration');
    assert.equal(requestDigest(input), requestDigest({ ...input }));
  });
  it('[negative] rejects caller-supplied decisions, owners, unsupported roles and unbounded input', () => {
    for (const value of [
      { type: 'ACCESS', role: 'ROOT', reason: 'Request access' },
      { type: 'ACCESS', role: 'AUDITOR', reason: 'x' },
      { type: 'ACCESS', role: 'AUDITOR', reason: 'Request access', status: 'APPROVED' },
      { type: 'DEMO_ALLOCATION', assetId: 'invalid', quantity: '1.00', reason: 'Need units' },
    ])
      assert.equal(consumerRequestSchema.safeParse(value).success, false);
  });
  it('[edge] projects only owner-facing fields and preserves the exact requested quantity', () => {
    const ownerId = new ObjectId();
    const row = {
      _id: new ObjectId(),
      ownerId,
      ownerHandle: 'fixture_owner',
      type: 'DEMO_ALLOCATION' as const,
      input: {
        type: 'DEMO_ALLOCATION' as const,
        assetId: new ObjectId().toHexString(),
        quantity: '1.25',
        reason: 'Controlled allocation',
      },
      key: 'private-key',
      digest: 'private-digest',
      decisionDigest: 'private-decision',
      status: 'OPEN' as const,
      revision: toLong(0n),
      createdAt: new Date('2026-10-26T00:00:00Z'),
    };
    const view = requestView(row);
    assert.equal(view.quantity, '1.25');
    assert.equal(view.revision, '0');
    assert.equal(view.owner.id, ownerId.toHexString());
    assert.ok(!JSON.stringify(view).includes('private-'));
    assert.notEqual(requestDigest(row.input), requestDigest({ ...row.input, quantity: '2.00' }));
  });
});
