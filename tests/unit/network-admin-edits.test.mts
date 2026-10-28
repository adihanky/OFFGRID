import assert from 'node:assert/strict';
import { it } from 'node:test';
import { resumeNetworkEdits } from '../../apps/web/src/network-admin-edits.js';

it('[happy/negative/edge] resumes with the edited provider only for the selected paused network', () => {
  const draft = { rpcUrl: 'https://example.invalid/', displayName: 'Edited' };
  assert.deepEqual(
    resumeNetworkEdits({ id: 'one', status: 'PAUSED' }, { id: 'one' }, draft),
    draft,
  );
  assert.deepEqual(resumeNetworkEdits({ id: 'one', status: 'PAUSED' }, { id: 'two' }, draft), {});
  assert.deepEqual(resumeNetworkEdits({ id: 'one', status: 'PAUSED' }, null, draft), {});
  assert.deepEqual(resumeNetworkEdits({ id: 'one', status: 'ACTIVE' }, { id: 'one' }, draft), {});
});
