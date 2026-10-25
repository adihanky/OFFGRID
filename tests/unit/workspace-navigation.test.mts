import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { workspaceLinks, workspaceSection } from '../../apps/web/src/workspace-navigation.js';

describe('workspace destinations', () => {
  it('opens the requested task for every visible navigation link', () => {
    for (const link of workspaceLinks) assert.equal(workspaceSection(link.hash), link.section);
    assert.equal(new Set(workspaceLinks.map((link) => link.section)).size, 4);
  });
  it('opens administrator guidance from the existing account bookmark', () => {
    assert.equal(workspaceSection('#admin-account-title'), 'admin');
  });
  it('defaults a fresh session to the wallet', () => {
    assert.equal(workspaceSection(''), 'wallet');
  });
  it('keeps unknown, malformed and external destinations on the wallet', () => {
    for (const hash of [
      '#missing',
      '#%zz',
      '#__proto__',
      'https://example.invalid',
      '#wallet-title/extra',
    ])
      assert.equal(workspaceSection(hash), 'wallet');
  });
  it('requires an exact fragment instead of guessing a privileged destination', () => {
    for (const hash of ['#Administration-title', '#administration-title?role=admin', '#admin'])
      assert.equal(workspaceSection(hash), 'wallet');
  });
});
