import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TransferView } from '@p2p/contracts';
import {
  applyTransferResult,
  canonicalQuantity,
  clearIntent,
  clearIntentOnSessionChange,
  createIntent,
  INTENT_STORAGE_KEY,
  restoreIntent,
  saveIntent,
  TransferApiError,
  walletApi,
} from '../../apps/web/src/transfer-client.js';

const alice = '111111111111111111111111';
const bob = '222222222222222222222222';
const assetId = '333333333333333333333333';
const key = 'abcdefab-1234-4123-8123-abcdefabcdef';
const request = { recipientId: bob, assetId, quantity: '1.00' };
const intent = () => createIntent(alice, request, key);
function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}
function result(status: TransferView['status'] = 'COMMITTED'): TransferView {
  return {
    id: '444444444444444444444444',
    sender: { id: alice, publicHandle: 'alice', displayName: 'Alice' },
    recipient: { id: bob, publicHandle: 'bob', displayName: 'Bob' },
    asset: { id: assetId, code: 'DEMO', displayName: 'Demo', precision: 2 },
    quantity: '1.00',
    status,
    rejectionCode: status === 'REJECTED' ? 'INSUFFICIENT_BALANCE' : null,
    createdAt: '2026-10-24T00:00:00.000Z',
    updatedAt: '2026-10-24T00:00:00.000Z',
  };
}

test('client canonical quantities preserve precision and values above the safe integer limit', () => {
  for (const value of ['1', '1.0', '1.00']) assert.equal(canonicalQuantity(value, 2), '1.00');
  assert.equal(canonicalQuantity('9223372036854775807', 0), '9223372036854775807');
  assert.equal(canonicalQuantity('0.00000001', 8), '0.00000001');
  assert.equal(canonicalQuantity('0.01', 2), '0.01');
});
test('client refuses invalid, zero, excessive precision and overflowing review amounts', () => {
  for (const value of [
    '0',
    '0.00',
    '-1',
    '1e2',
    ' 1',
    '1.',
    '.1',
    '01',
    '1.000',
    '92233720368547758.08',
    '9'.repeat(31),
  ])
    assert.throws(() => canonicalQuantity(value, 2));
  assert.throws(() => canonicalQuantity('1.0', 0));
  for (const precision of [-1, 9, 1.5]) assert.throws(() => canonicalQuantity('1', precision));
});
test('confirmation freezes canonical request and one normalized key independently of form edits', () => {
  const form = { ...request };
  const confirmed = createIntent(alice, form, key.toUpperCase());
  form.quantity = '2.00';
  assert.equal(confirmed.key, key);
  assert.equal(confirmed.request.quantity, '1.00');
  assert.ok(Object.isFrozen(confirmed));
  assert.ok(Object.isFrozen(confirmed.request));
  assert.throws(() => createIntent(alice, { ...request, recipientId: alice }, key));
  assert.throws(() => createIntent(alice, request, 'invalid'));
});
test('pending reload preserves the same identity and payload while terminal outcomes remain authoritative', () => {
  const saved = storage();
  const pending = applyTransferResult(intent(), result('PENDING'));
  assert.equal(pending.terminal, false);
  saveIntent(saved, pending.intent);
  assert.deepEqual(restoreIntent(saved, alice), pending.intent);
  assert.equal(applyTransferResult(pending.intent, result()).terminal, true);
  assert.equal(applyTransferResult(pending.intent, result('REJECTED')).terminal, true);
  clearIntent(saved);
  assert.equal(restoreIntent(saved, alice), null);
});
test('mismatched or malformed responses cannot complete another intent', () => {
  assert.throws(() => applyTransferResult(intent(), { ...result(), quantity: '2.00' }));
  assert.throws(() =>
    applyTransferResult(intent(), { ...result(), sender: { ...result().sender, id: bob } }),
  );
  assert.throws(() =>
    applyTransferResult({ ...intent(), transferId: '555555555555555555555555' }, result()),
  );
});
test('stored intent is cleared on 401, signout, account switch or corrupt storage', () => {
  const saved = storage();
  saveIntent(saved, intent());
  clearIntentOnSessionChange(saved, null, alice);
  assert.equal(restoreIntent(saved, alice)?.key, key);
  clearIntentOnSessionChange(saved, alice, bob);
  assert.equal(saved.getItem(INTENT_STORAGE_KEY), null);
  saveIntent(saved, intent());
  clearIntentOnSessionChange(saved, alice, null);
  assert.equal(saved.getItem(INTENT_STORAGE_KEY), null);
  saveIntent(saved, intent());
  assert.equal(restoreIntent(saved, bob), null);
  for (const corrupt of [
    '{',
    JSON.stringify({ ...intent(), version: 2 }),
    JSON.stringify({ ...intent(), request: { ...request, senderId: alice } }),
  ]) {
    saved.setItem(INTENT_STORAGE_KEY, corrupt);
    assert.equal(restoreIntent(saved, alice), null);
    assert.equal(saved.getItem(INTENT_STORAGE_KEY), null);
  }
});
test('HTTP client retains 422 rejection details and binds POST to confirmed key and current session', async (context) => {
  const calls: { url: string; init?: RequestInit }[] = [];
  context.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const body = url.endsWith('/csrf')
      ? { csrfToken: 'test-csrf' }
      : url.endsWith('/me')
        ? { user: { id: alice } }
        : { transfer: result('REJECTED') };
    return new Response(JSON.stringify(body), { status: url.endsWith('/transfers') ? 422 : 200 });
  });
  const response = await walletApi.submit(intent());
  assert.equal(response.transfer.status, 'REJECTED');
  assert.deepEqual(
    calls.map((call) => call.url),
    ['/api/auth/csrf', '/api/auth/me', '/api/transfers'],
  );
  assert.equal(new Headers(calls[2]!.init!.headers).get('Idempotency-Key'), key);
  assert.equal(new Headers(calls[2]!.init!.headers).get('X-CSRF-Token'), 'test-csrf');
  assert.deepEqual(JSON.parse(String(calls[2]!.init!.body)), request);
});
test('timeout leaves intent unchanged for exact same-key retry', async (context) => {
  const confirmed = intent();
  const saved = storage();
  saveIntent(saved, confirmed);
  context.mock.method(globalThis, 'fetch', async () => {
    throw new Error('timeout');
  });
  await assert.rejects(
    walletApi.submit(confirmed),
    (error: unknown) => error instanceof TransferApiError && error.status === 0,
  );
  assert.deepEqual(restoreIntent(saved, alice), confirmed);
});
test('account changed in another tab prevents POST under the other identity', async (context) => {
  let calls = 0;
  context.mock.method(globalThis, 'fetch', async (url: string) => {
    calls += 1;
    return new Response(
      JSON.stringify(url.endsWith('/csrf') ? { csrfToken: 'test-csrf' } : { user: { id: bob } }),
    );
  });
  await assert.rejects(
    walletApi.submit(intent()),
    (error: unknown) => error instanceof TransferApiError && error.status === 401,
  );
  assert.equal(calls, 2);
});

test('interrupted response bodies keep the confirmed intent unresolved for same-key retry', async (context) => {
  const confirmed = intent();
  const saved = storage();
  saveIntent(saved, confirmed);
  let posts = 0;
  context.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
    if (url.endsWith('/csrf')) return Response.json({ csrfToken: 'test-csrf' });
    if (url.endsWith('/me')) return Response.json({ user: { id: alice } });
    posts++;
    assert.equal(new Headers(init?.headers).get('Idempotency-Key'), key);
    return posts === 1
      ? new Response('{"transfer":', { status: 201 })
      : Response.json({ transfer: result() });
  });
  await assert.rejects(
    walletApi.submit(confirmed),
    (error: unknown) =>
      error instanceof TransferApiError && error.status === 0 && /unresolved/.test(error.message),
  );
  const restored = restoreIntent(saved, alice);
  assert.deepEqual(restored, confirmed);
  const response = await walletApi.submit(restored!);
  assert.equal(applyTransferResult(restored!, response.transfer).terminal, true);
  assert.equal(posts, 2);
});

test('an unreadable unauthorized response still expires the client session', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => new Response('', { status: 401 }));
  await assert.rejects(
    walletApi.accounts(),
    (error: unknown) => error instanceof TransferApiError && error.status === 401,
  );
});

test('caller cancellation retains the finite network timeout', async (context) => {
  const deadline = new AbortController();
  const lifetime = new AbortController();
  let received: AbortSignal | null | undefined;
  context.mock.method(AbortSignal, 'timeout', (milliseconds: number) => {
    assert.equal(milliseconds, 12000);
    return deadline.signal;
  });
  context.mock.method(globalThis, 'fetch', async (_url: string, init?: RequestInit) => {
    received = init?.signal;
    return new Promise<Response>((_resolve, reject) => {
      received?.addEventListener('abort', () => reject(new Error('deadline')), { once: true });
    });
  });
  const pending = walletApi.accounts(lifetime.signal);
  deadline.abort();
  await assert.rejects(
    pending,
    (error: unknown) => error instanceof TransferApiError && error.status === 0,
  );
  assert.ok(received?.aborted);
  assert.equal(lifetime.signal.aborted, false);
});

test('unavailable storage does not break signout but prevents persisting a new submission', () => {
  const unavailable = {
    getItem: () => {
      throw new Error('storage disabled');
    },
    setItem: () => {
      throw new Error('storage disabled');
    },
    removeItem: () => {
      throw new Error('storage disabled');
    },
  };
  assert.equal(restoreIntent(unavailable, alice), null);
  assert.doesNotThrow(() => clearIntentOnSessionChange(unavailable, alice, null));
  assert.throws(() => saveIntent(unavailable, intent()));
});
