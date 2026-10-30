import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  conversationInput,
  messageDigest,
  messageInput,
  messageQuery,
  pairKey,
  sequenceInput,
} from '../../apps/api/src/modules/chat/chat-input.js';
import { mergeMessages } from '../../apps/web/src/chat-client.js';
import { consumerSection } from '../../apps/web/src/consumer-navigation.js';
import type { ChatMessage } from '@p2p/contracts';
test('chat accepts exact handles and preserves safe plain text without HTML interpretation', () => {
  assert.deepEqual(conversationInput.parse({ peerHandle: ' Bob ' }), { peerHandle: 'bob' });
  const body = { clientMessageId: randomUUID(), text: '<script>alert(1)</script>\n🙂' };
  assert.deepEqual(messageInput.parse(body), body);
  assert.equal(pairKey('a', 'b'), pairKey('b', 'a'));
});
test('chat rejects empty, excessive and malformed Unicode messages and unknown fields', () => {
  for (const text of ['', '  \n', 'a'.repeat(4001), '\ud800', '🙂'.repeat(4001)])
    assert.equal(messageInput.safeParse({ clientMessageId: randomUUID(), text }).success, false);
  assert.equal(messageInput.safeParse({ clientMessageId: 'bad', text: 'hello' }).success, false);
  assert.equal(
    messageInput.safeParse({ clientMessageId: randomUUID(), text: 'hello', senderId: 'forged' })
      .success,
    false,
  );
  for (const handle of ['a', 'a/b', 'bob@example.invalid', 'bob*'])
    assert.equal(conversationInput.safeParse({ peerHandle: handle }).success, false);
});
test('chat accepts the precise message boundary and distinguishes changed duplicate bodies', () => {
  assert.equal(
    messageInput.safeParse({ clientMessageId: randomUUID(), text: '🙂'.repeat(4000) }).success,
    true,
  );
  assert.equal(messageDigest('hi'), messageDigest('hi'));
  assert.notEqual(messageDigest('hi'), messageDigest('hi '));
});
test('chat cursors preserve int64 precision and reject conflicting pagination directions', () => {
  assert.equal(sequenceInput.parse('9223372036854775807'), '9223372036854775807');
  for (const input of ['-1', '01', '1.0', '9223372036854775808'])
    assert.equal(sequenceInput.safeParse(input).success, false);
  assert.equal(messageQuery.safeParse({ before: '3', after: '1' }).success, false);
});
test('chat merge deduplicates reconnect history and orders sequences beyond JavaScript number precision', () => {
  const row = (id: string, sequence: string) => ({ id, sequence, text: id }) as ChatMessage;
  const a = row('a', '9007199254740992'),
    b = row('b', '9007199254740993');
  assert.deepEqual(
    mergeMessages([b], [a, b]).map((row) => row.id),
    ['a', 'b'],
  );
});
test('chat routes accept bookmarks and reject malformed or oversized identifiers', () => {
  assert.equal(consumerSection('#/chat'), 'chat');
  assert.equal(consumerSection('#/chat/' + 'a'.repeat(24)), 'chat');
  assert.equal(consumerSection('#/chat/nope'), 'home');
  assert.equal(consumerSection('#/chat/' + 'a'.repeat(2048)), 'home');
});
