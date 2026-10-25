import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { administratorAccess } from '../../apps/web/src/administrator-access.js';

describe('Administrator account onboarding', () => {
  it('[happy] offers first-account bootstrap only when the server enables setup', () => {
    assert.equal(administratorAccess({ roles: [], setupAvailable: true }), 'bootstrap');
    assert.equal(administratorAccess({ roles: ['ACCESS_ADMIN'], setupAvailable: false }), 'manage');
  });
  it('[negative] registration and USER role cannot expose role management', () => {
    assert.equal(administratorAccess({ roles: [], setupAvailable: false }), 'request');
    assert.equal(administratorAccess({ roles: ['USER'], setupAvailable: false }), 'request');
  });
  it('[edge] an asset administrator still needs ACCESS_ADMIN to add administrators', () => {
    assert.equal(administratorAccess({ roles: ['ASSET_ADMIN'], setupAvailable: false }), 'granted');
    assert.equal(
      administratorAccess({ roles: ['ASSET_ADMIN', 'ACCESS_ADMIN'], setupAvailable: false }),
      'manage',
    );
  });
});
