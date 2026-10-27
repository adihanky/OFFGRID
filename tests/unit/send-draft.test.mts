import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  clearSendDraft,
  loadSendDraft,
  saveSendDraft,
  SEND_DRAFT_KEY,
} from '../../apps/web/src/send-draft.js';
describe('Identity-scoped editable send drafts', () => {
  function fixture() {
    const rows = new Map<string, string>();
    return {
      rows,
      storage: {
        getItem: (key: string) => rows.get(key) ?? null,
        setItem: (key: string, value: string) => {
          rows.set(key, value);
        },
        removeItem: (key: string) => {
          rows.delete(key);
        },
      },
    };
  }
  const userId = '111111111111111111111111',
    draft = { userId, handle: 'partial_peer', assetId: '', quantity: '1.' };
  it('[happy] retains incomplete editable fields across reload without creating an admitted intent', () => {
    const f = fixture();
    assert.equal(saveSendDraft(draft, f.storage), true);
    assert.deepEqual(loadSendDraft(userId, f.storage), draft);
    assert.equal(f.rows.size, 1);
    clearSendDraft(f.storage);
    assert.equal(loadSendDraft(userId, f.storage), null);
  });
  it('[negative] never restores another user or malformed untrusted state', () => {
    const f = fixture();
    saveSendDraft(draft, f.storage);
    assert.equal(loadSendDraft('222222222222222222222222', f.storage), null);
    assert.equal(f.rows.size, 0);
    for (const raw of [
      'invalid',
      JSON.stringify({ ...draft, token: 'untrusted' }),
      'a'.repeat(1001),
    ]) {
      f.rows.set(SEND_DRAFT_KEY, raw);
      assert.equal(loadSendDraft(userId, f.storage), null);
    }
  });
  it('[edge] restricted storage reports that persistence failed and leaves page state usable', () => {
    const storage = {
      getItem: () => {
        throw new Error('Restricted');
      },
      setItem: () => {
        throw new Error('Restricted');
      },
      removeItem: () => {
        throw new Error('Restricted');
      },
    };
    assert.equal(saveSendDraft(draft, storage), false);
    assert.equal(loadSendDraft(userId, storage), null);
    assert.doesNotThrow(() => clearSendDraft(storage));
  });
});
