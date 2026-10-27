import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { workspaceLinks, workspaceSection } from '../../apps/web/src/workspace-navigation.js';

describe('workspace destinations', () => {
  it('opens the requested task for every visible navigation link', () => {
    for (const link of workspaceLinks) assert.equal(workspaceSection(link.hash), link.section);
    assert.equal(new Set(workspaceLinks.map((link) => link.section)).size, 8);
  });
  it('opens administrator guidance from the existing account bookmark', () => {
    assert.equal(workspaceSection('#admin-account-title'), 'admin');
  });
  it('defaults a fresh session to Home', () => {
    assert.equal(workspaceSection(''), 'home');
  });
  it('keeps unknown, malformed and external destinations on Home', () => {
    for (const hash of [
      '#missing',
      '#%zz',
      '#__proto__',
      'https://example.invalid',
      '#wallet-title/extra',
    ])
      assert.equal(workspaceSection(hash), 'home');
  });
  it('requires an exact fragment instead of guessing a privileged destination', () => {
    for (const hash of ['#Administration-title', '#administration-title?role=admin', '#admin'])
      assert.equal(workspaceSection(hash), 'home');
  });
  it('[happy/edge] preserves old bookmarks and participant-detail destinations', () => {
    assert.equal(workspaceSection('#wallet-title'), 'wallet');
    assert.equal(workspaceSection('#wallet-setup-title'), 'setup');
    assert.equal(workspaceSection('#/activity/111111111111111111111111'), 'activity');
    assert.equal(workspaceSection('#/settings/security'), 'security');
    assert.equal(workspaceSection('#/admin/policies'), 'admin');
    assert.equal(workspaceSection('#/activity?status=PENDING'), 'activity');
  });
});
