import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chooseWalletView, walletSelectionFor } from '../../apps/web/src/wallet-view.js';

describe('wallet display selection', () => {
  it('[happy] defaults a fresh workspace to network wallets without opening legacy data', () => {
    assert.deepEqual(walletSelectionFor(null, 'alice'), {
      userId: 'alice',
      view: 'network',
      legacyOpened: false,
    });
  });
  it('[happy/edge] keeps an explicitly opened legacy draft mounted when returning to networks', () => {
    const legacy = chooseWalletView(null, 'alice', 'legacy');
    assert.equal(legacy.view, 'legacy');
    assert.equal(legacy.legacyOpened, true);
    assert.deepEqual(chooseWalletView(legacy, 'alice', 'network'), {
      userId: 'alice',
      view: 'network',
      legacyOpened: true,
    });
    assert.equal(walletSelectionFor(legacy, 'alice'), legacy);
  });
  it("[negative] an account change cannot inherit another user's legacy view or mounted draft", () => {
    const previous = chooseWalletView(null, 'alice', 'legacy');
    assert.deepEqual(walletSelectionFor(previous, 'bob'), {
      userId: 'bob',
      view: 'network',
      legacyOpened: false,
    });
    assert.deepEqual(chooseWalletView(previous, 'bob', 'network'), {
      userId: 'bob',
      view: 'network',
      legacyOpened: false,
    });
  });
});
