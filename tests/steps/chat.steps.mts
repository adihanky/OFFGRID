import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { mkdir } from 'node:fs/promises';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import { After, Given, When, Then } from '@cucumber/cucumber';
import type { ChatConversation, ChatMessagePage } from '@p2p/contracts';
import {
  createTransferHarness,
  type TransferHarness,
  type TransferCaller,
} from '../support/transfer-harness.mjs';
interface ChatWorld {
  chatBrowser?: { browser: Browser; web: ViteDevServer; alice: Page; bob: Page };
  chat?: {
    h: TransferHarness;
    alice: TransferCaller;
    bob: TransferCaller;
    stranger: TransferCaller;
    id: string;
    key: string;
    financial: number[];
  };
}
const collections = ['accounts', 'transfers', 'ledgerEntries', 'chainEntries', 'custodyEvents'];
Given(
  'an isolated chat with Alice Bob and a stranger',
  { timeout: 120000 },
  async function (this: ChatWorld) {
    const h = await createTransferHarness();
    this.chat = {
      h,
      alice: await h.register('chat_alice'),
      bob: await h.register('chat_bob'),
      stranger: await h.register('chat_stranger'),
      id: '',
      key: randomUUID(),
      financial: [],
    };
    // Chat eligibility is independent of wallet existence.
    await h.database.db.collection('wallets').deleteMany({});
    this.chat.financial = await Promise.all(
      collections.map((name) => h.database.db.collection(name).countDocuments()),
    );
  },
);
After({ tags: '@chat', timeout: 20000 }, async function (this: ChatWorld) {
  await this.chatBrowser?.browser.close();
  await this.chatBrowser?.web.close();
  await this.chat?.h.close();
});
When('Alice and Bob open their direct chat concurrently', async function (this: ChatWorld) {
  const f = this.chat!;
  const responses = await Promise.all([
    f.h.request(f.alice, '/api/v2/chat/conversations', 'POST', { peerHandle: f.bob.handle }),
    f.h.request(f.bob, '/api/v2/chat/conversations', 'POST', { peerHandle: f.alice.handle }),
  ]);
  const ids: string[] = [];
  for (const response of responses) {
    assert.equal(response.status, 201);
    ids.push(((await response.json()) as { conversation: ChatConversation }).conversation.id);
  }
  assert.equal(ids[0], ids[1]);
  f.id = ids[0]!;
  assert.equal(await f.h.database.db.collection('conversations').countDocuments(), 1);
  const empty = await f.h.request(f.bob, '/api/v2/chat/conversations');
  assert.deepEqual(((await empty.json()) as { conversations: unknown[] }).conversations, []);
});
When('Alice sends the same chat message twice concurrently', async function (this: ChatWorld) {
  const f = this.chat!;
  const responses = await Promise.all(
    [1, 2].map(() =>
      f.h.request(f.alice, `/api/v2/chat/conversations/${f.id}/messages`, 'POST', {
        clientMessageId: f.key,
        text: 'Hello Bob 🙂',
      }),
    ),
  );
  for (const r of responses) assert.equal(r.status, 201);
});
Then('Bob sees one persisted message and one unread item', async function (this: ChatWorld) {
  const f = this.chat!;
  const r = await f.h.request(f.bob, `/api/v2/chat/conversations/${f.id}/messages`);
  assert.equal(r.status, 200);
  const page = (await r.json()) as ChatMessagePage;
  assert.equal(page.messages.length, 1);
  assert.equal(page.messages[0]!.text, 'Hello Bob 🙂');
  assert.equal(page.messages[0]!.sequence, '1');
  assert.equal(page.conversation.unreadCount, 1);
  assert.equal(await f.h.database.db.collection('chatEvents').countDocuments(), 1);
});
Then('Bob can mark it read without changing financial data', async function (this: ChatWorld) {
  const f = this.chat!;
  for (const sequence of ['1', '0', '1'])
    assert.equal(
      (
        await f.h.request(f.bob, `/api/v2/chat/conversations/${f.id}/read`, 'POST', {
          throughSequence: sequence,
        })
      ).status,
      201,
    );
  const page = (await (
    await f.h.request(f.bob, `/api/v2/chat/conversations/${f.id}/messages`)
  ).json()) as ChatMessagePage;
  assert.equal(page.conversation.unreadCount, 0);
  assert.deepEqual(
    await Promise.all(collections.map((name) => f.h.database.db.collection(name).countDocuments())),
    f.financial,
  );
});
Then('the chat survives an API restart', { timeout: 120000 }, async function (this: ChatWorld) {
  const f = this.chat!;
  await f.h.restart();
  const page = (await (
    await f.h.request(f.bob, `/api/v2/chat/conversations/${f.id}/messages`)
  ).json()) as ChatMessagePage;
  assert.equal(page.messages.length, 1);
  assert.equal(page.conversation.unreadCount, 0);
});
Then(
  'strangers anonymous users and invalid writes cannot access chat',
  async function (this: ChatWorld) {
    const f = this.chat!,
      path = `/api/v2/chat/conversations/${f.id}`;
    assert.equal((await f.h.request(f.stranger, path + '/messages')).status, 404);
    assert.equal((await f.h.request(f.h.anonymous, path + '/messages')).status, 401);
    for (const action of ['messages', 'read', 'block'])
      assert.equal(
        (
          await f.h.request(
            f.stranger,
            path + '/' + action,
            'POST',
            action === 'messages'
              ? { clientMessageId: randomUUID(), text: 'No' }
              : action === 'read'
                ? { throughSequence: '0' }
                : { blocked: true },
          )
        ).status,
        404,
      );
    assert.equal(
      (
        await f.h.request(
          f.alice,
          path + '/messages',
          'POST',
          { clientMessageId: randomUUID(), text: 'CSRF' },
          { csrf: false },
        )
      ).status,
      403,
    );
    for (const text of ['  ', 'x'.repeat(4001)])
      assert.equal(
        (
          await f.h.request(f.alice, path + '/messages', 'POST', {
            clientMessageId: randomUUID(),
            text,
          })
        ).status,
        400,
      );
    assert.equal(
      (
        await f.h.request(f.alice, '/api/v2/chat/conversations', 'POST', {
          peerHandle: f.alice.handle,
        })
      ).status,
      404,
    );
    assert.equal(
      (await f.h.request(f.alice, path + '/read', 'POST', { throughSequence: '999' })).status,
      409,
    );
    assert.equal((await f.h.request(f.alice, path + '/messages?before=1&after=0')).status, 400);
    await f.h.database.db
      .collection('users')
      .updateOne({ _id: new ObjectId(f.stranger.id) }, { $set: { status: 'disabled' } });
    assert.equal((await f.h.request(f.stranger, path + '/messages')).status, 401);
  },
);
Then(
  'a changed duplicate body conflicts without another message',
  async function (this: ChatWorld) {
    const f = this.chat!,
      path = `/api/v2/chat/conversations/${f.id}/messages`;
    assert.equal(
      (await f.h.request(f.alice, path, 'POST', { clientMessageId: f.key, text: 'Original' }))
        .status,
      201,
    );
    assert.equal(
      (await f.h.request(f.alice, path, 'POST', { clientMessageId: f.key, text: 'Changed' }))
        .status,
      409,
    );
    assert.equal(await f.h.database.db.collection('messages').countDocuments(), 1);
  },
);
Then('blocking prevents new sends while retaining prior history', async function (this: ChatWorld) {
  const f = this.chat!,
    path = `/api/v2/chat/conversations/${f.id}`;
  assert.equal((await f.h.request(f.bob, path + '/block', 'POST', { blocked: true })).status, 201);
  assert.equal(
    (await f.h.request(f.alice, path + '/block', 'POST', { blocked: false })).status,
    201,
  );
  assert.equal(
    (
      await f.h.request(f.alice, path + '/messages', 'POST', {
        clientMessageId: randomUUID(),
        text: 'Blocked',
      })
    ).status,
    409,
  );
  assert.equal(
    ((await (await f.h.request(f.bob, path + '/messages')).json()) as ChatMessagePage).messages
      .length,
    1,
  );
  assert.equal((await f.h.request(f.bob, path + '/block', 'POST', { blocked: false })).status, 201);
  assert.equal(
    (
      await f.h.request(f.alice, path + '/messages', 'POST', {
        clientMessageId: randomUUID(),
        text: 'Unblocked',
      })
    ).status,
    201,
  );
});
When(
  'Alice sends a chat gap larger than fifty messages',
  { timeout: 60000 },
  async function (this: ChatWorld) {
    const f = this.chat!,
      start = Date.now();
    let i = 0;
    f.h.accounts.rateNow = () => start + Math.floor(i / 20) * 60000;
    for (i = 0; i < 55; i++)
      assert.equal(
        (
          await f.h.request(f.alice, `/api/v2/chat/conversations/${f.id}/messages`, 'POST', {
            clientMessageId: randomUUID(),
            text: `Message ${i}`,
          })
        ).status,
        201,
      );
  },
);
Then('Bob recovers the whole gap in order without duplicates', async function (this: ChatWorld) {
  const f = this.chat!,
    path = `/api/v2/chat/conversations/${f.id}/messages`;
  const first = (await (await f.h.request(f.bob, path + '?after=0')).json()) as ChatMessagePage;
  assert.equal(first.messages.length, 50);
  assert.equal(first.nextCursor, '50');
  const second = (await (
    await f.h.request(f.bob, path + '?after=' + first.nextCursor)
  ).json()) as ChatMessagePage;
  assert.equal(second.messages.length, 5);
  assert.equal(second.nextCursor, null);
  assert.deepEqual(
    [...first.messages, ...second.messages].map((m) => m.sequence),
    Array.from({ length: 55 }, (_, i) => String(i + 1)),
  );
});

When(
  'Alice and Bob chat through two real browser sessions',
  { timeout: 120000 },
  async function (this: ChatWorld) {
    const f = this.chat!;
    const web = await createServer({
      configFile: 'apps/web/vite.config.ts',
      root: 'apps/web',
      logLevel: 'error',
      server: {
        host: '127.0.0.1',
        port: 0,
        open: false,
        proxy: { '/api': { target: await f.h.app.getUrl(), changeOrigin: true } },
      },
    });
    await web.listen();
    const address = web.httpServer!.address();
    assert.ok(address && typeof address === 'object');
    const url = `http://127.0.0.1:${address.port}`;
    f.h.environment.WEB_ORIGIN = url;
    const browser = await chromium.launch({
      headless: true,
      ...(process.env.P2P_TEST_BROWSER_EXECUTABLE
        ? { executablePath: process.env.P2P_TEST_BROWSER_EXECUTABLE }
        : { channel: 'chrome' }),
    });
    const alice = await browser.newPage(),
      bob = await browser.newPage();
    this.chatBrowser = { browser, web, alice, bob };
    for (const [page, caller] of [
      [alice, f.alice],
      [bob, f.bob],
    ] as const) {
      page.setDefaultTimeout(15000);
      await page.context().addCookies(
        [...caller.jar].map(([name, value]) => ({
          name,
          value,
          url,
          httpOnly: name === 'p2p_session',
          sameSite: 'Lax' as const,
        })),
      );
      await page.goto(url + '/#/chat');
    }
    await alice.getByLabel('Start a chat by exact handle').fill(f.bob.handle);
    await alice.getByRole('button', { name: 'New chat', exact: true }).click();
    await alice.getByLabel('Message', { exact: true }).fill('Hello from the browser');
    await alice.getByRole('button', { name: 'Send message', exact: true }).click();
    await alice.getByText('Hello from the browser', { exact: true }).waitFor();
    await bob.getByRole('link', { name: /chat_alice/ }).click();
    await bob.getByText('Hello from the browser', { exact: true }).waitFor();
    await bob.getByLabel('Message', { exact: true }).fill('Reply from Bob');
    await bob.getByRole('button', { name: 'Send message', exact: true }).click();
    await alice.getByText('Reply from Bob', { exact: true }).waitFor();
    await bob.getByRole('button', { name: 'Block peer', exact: true }).click();
    await bob.getByRole('button', { name: 'Unblock peer', exact: true }).waitFor();
    f.id = alice.url().split('/chat/')[1]!;
    assert.equal(await f.h.database.db.collection('messages').countDocuments(), 2);
  },
);
Then(
  'a blocked peer cannot send and the browser chat survives reload',
  { timeout: 30000 },
  async function (this: ChatWorld) {
    const f = this.chatBrowser!;
    await f.alice.reload();
    await f.alice.getByText('Reply from Bob', { exact: true }).waitFor();
    assert.equal(await f.alice.getByLabel('Message', { exact: true }).isDisabled(), true);
    await f.alice.setViewportSize({ width: 360, height: 800 });
    assert.ok(await f.alice.evaluate('document.documentElement.scrollWidth <= innerWidth'));
    await mkdir('.local/test-results/chat', { recursive: true });
    await f.alice.screenshot({ path: '.local/test-results/chat/chat-mobile.png', fullPage: true });
    await f.alice.getByRole('button', { name: 'Sign out', exact: true }).click();
    await f.alice.getByRole('heading', { name: 'Chat', exact: true }).waitFor({ state: 'hidden' });
  },
);
