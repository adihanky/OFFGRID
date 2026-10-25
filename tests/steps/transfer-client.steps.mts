import assert from 'node:assert/strict';
import { After, Before, Given, Then, When, type World } from '@cucumber/cucumber';
import type { TransferView } from '@p2p/contracts';
import {
  applyTransferResult,
  canonicalQuantity,
  clearIntentOnSessionChange,
  createIntent,
  INTENT_STORAGE_KEY,
  restoreIntent,
  saveIntent,
  TransferApiError,
  walletApi,
  type IntentStorage,
  type TransferIntent,
} from '../../apps/web/src/transfer-client.js';

const userId = '111111111111111111111111';
const recipientId = '222222222222222222222222';
const assetId = '333333333333333333333333';
const requestKey = '12345678-1234-4123-8123-123456789abc';
interface ClientWorld extends World {
  storage: IntentStorage;
  quantity: string;
  intent?: TransferIntent;
  original?: TransferIntent;
  result?: TransferView;
  terminal?: boolean;
  error?: unknown;
  originalFetch: typeof fetch;
  posts: number;
}
Before({ tags: '@transfer_client' }, function (this: ClientWorld) {
  const map = new Map<string, string>();
  this.storage = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
  this.originalFetch = globalThis.fetch;
  this.posts = 0;
});
After({ tags: '@transfer_client' }, function (this: ClientWorld) {
  globalThis.fetch = this.originalFetch;
});
Given(
  'a reviewed client transfer of {string} precision {int}',
  function (this: ClientWorld, quantity: string, precision: number) {
    this.quantity = canonicalQuantity(quantity, precision);
  },
);
When('the reviewed client transfer is confirmed', function (this: ClientWorld) {
  this.intent = createIntent(userId, { recipientId, assetId, quantity: this.quantity }, requestKey);
  this.original = this.intent;
  saveIntent(this.storage, this.intent);
});
Then('the client request quantity is {string}', function (this: ClientWorld, quantity: string) {
  assert.equal(this.intent!.request.quantity, quantity);
});
Then('the client intent and payload cannot be mutated', function (this: ClientWorld) {
  assert.ok(Object.isFrozen(this.intent));
  assert.ok(Object.isFrozen(this.intent!.request));
  assert.throws(() => {
    Object.assign(this.intent!, { key: 'different' });
  }, TypeError);
  assert.throws(() => {
    Object.assign(this.intent!.request, { quantity: '2.00' });
  }, TypeError);
});
When(
  'the server confirms the client transfer as {string}',
  function (this: ClientWorld, status: string) {
    assert.ok(status === 'PENDING' || status === 'COMMITTED' || status === 'REJECTED');
    this.result = {
      id: '444444444444444444444444',
      sender: { id: userId, publicHandle: 'alice', displayName: 'Alice' },
      recipient: { id: recipientId, publicHandle: 'bob', displayName: 'Bob' },
      asset: { id: assetId, code: 'DEMO', displayName: 'Demo credits', precision: 2 },
      quantity: '1.00',
      status,
      rejectionCode: status === 'REJECTED' ? 'INSUFFICIENT_BALANCE' : null,
      createdAt: '2026-10-24T00:00:00.000Z',
      updatedAt: '2026-10-24T00:00:01.000Z',
    };
    const result = applyTransferResult(this.intent!, this.result);
    this.intent = result.intent;
    this.terminal = result.terminal;
    saveIntent(this.storage, this.intent);
  },
);
Then('the client outcome is terminal', function (this: ClientWorld) {
  assert.equal(this.terminal, true);
});
Then('the client result is not committed', function (this: ClientWorld) {
  assert.equal(this.result!.status, 'REJECTED');
});
Then('the client outcome is unresolved', function (this: ClientWorld) {
  assert.equal(this.terminal, false);
});
When('the same user reloads the transfer tab', function (this: ClientWorld) {
  this.intent = restoreIntent(this.storage, userId) ?? undefined;
});
Then('the restored request keeps its original key and payload', function (this: ClientWorld) {
  const restored = restoreIntent(this.storage, userId);
  assert.ok(restored);
  assert.equal(restored.key, this.original!.key);
  assert.deepEqual(restored.request, this.original!.request);
});
When('the transfer HTTP response is lost', async function (this: ClientWorld) {
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/auth/csrf')) return Response.json({ csrfToken: 'controlled-test-csrf' });
    if (url.endsWith('/auth/me')) return Response.json({ user: { id: userId } });
    throw new TypeError('Controlled lost response');
  };
  try {
    await walletApi.submit(this.intent!);
  } catch (error) {
    this.error = error;
  }
});
Then('the client reports an unresolved connection outcome', function (this: ClientWorld) {
  assert.ok(this.error instanceof TransferApiError);
  assert.equal(this.error.status, 0);
  assert.match(this.error.message, /unresolved/);
});
When('the transfer HTTP response body is interrupted', async function (this: ClientWorld) {
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/auth/csrf')) return Response.json({ csrfToken: 'controlled-test-csrf' });
    if (url.endsWith('/auth/me')) return Response.json({ user: { id: userId } });
    return new Response('{"transfer":', { status: 201 });
  };
  try {
    await walletApi.submit(this.intent!);
  } catch (error) {
    this.error = error;
  }
});
When('the client session changes to {string}', function (this: ClientWorld, identity: string) {
  clearIntentOnSessionChange(
    this.storage,
    userId,
    identity === 'another user' ? recipientId : null,
  );
});
Then('no client transfer intent remains in storage', function (this: ClientWorld) {
  assert.equal(this.storage.getItem(INTENT_STORAGE_KEY), null);
});
When(
  'the authenticated HTTP identity changes before submission',
  async function (this: ClientWorld) {
    globalThis.fetch = async (input, init) => {
      if (init?.method === 'POST') this.posts++;
      const path = String(input);
      if (path.endsWith('/auth/csrf')) return Response.json({ csrfToken: 'controlled-test-csrf' });
      return Response.json({ user: { id: recipientId } });
    };
    try {
      await walletApi.submit(this.intent!);
    } catch (error) {
      this.error = error;
    }
  },
);
Then('the client refuses to post the stored transfer', function (this: ClientWorld) {
  assert.ok(this.error instanceof TransferApiError);
  assert.equal(this.error.status, 401);
  assert.equal(this.posts, 0);
});
When('client review receives quantity {string}', function (this: ClientWorld, quantity: string) {
  try {
    canonicalQuantity(quantity, 2);
  } catch (error) {
    this.error = error;
  }
});
Then('client review fails', function (this: ClientWorld) {
  assert.ok(this.error instanceof Error);
});
When('client storage contains a malformed transfer intent', function (this: ClientWorld) {
  this.storage.setItem(INTENT_STORAGE_KEY, '{invalid json');
  assert.equal(restoreIntent(this.storage, userId), null);
});
