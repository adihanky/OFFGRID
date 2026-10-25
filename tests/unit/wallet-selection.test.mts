import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WalletAccount } from '@p2p/contracts';
import { availableAssetId } from '../../apps/web/src/transfer-client.js';

const first: WalletAccount = {
  assetId: '111111111111111111111111',
  code: 'DEMO',
  displayName: 'Demo credits',
  precision: 2,
  balance: '0.00',
  status: 'active',
};
const second = { ...first, assetId: '222222222222222222222222' };

test('wallet selects an active asset even with a zero balance and preserves a valid choice', () => {
  assert.equal(availableAssetId([first, second], ''), first.assetId);
  assert.equal(availableAssetId([first, second], second.assetId), second.assetId);
});
test('wallet cannot select disabled assets or an empty catalogue', () => {
  assert.equal(availableAssetId([], first.assetId), '');
  assert.equal(availableAssetId([{ ...first, status: 'disabled' }], first.assetId), '');
});
test('wallet refresh replaces a removed or disabled selection with an active asset', () => {
  assert.equal(availableAssetId([second], first.assetId), second.assetId);
  assert.equal(
    availableAssetId([{ ...first, status: 'disabled' }, second], first.assetId),
    second.assetId,
  );
});
