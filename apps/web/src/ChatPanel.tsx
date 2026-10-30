import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type {
  AuthUser,
  ChatConversation,
  ChatConversationPage,
  ChatMessage,
  ChatMessagePage,
} from '@p2p/contracts';
import { walletRequest, walletWrite, WalletApiError } from './wallet-v2-client';
import { mergeMessages, pendingMessage, type PendingChatMessage } from './chat-client';
type ChatDraft = { text: string; pending: PendingChatMessage | null };

export function ChatPanel({
  user,
  active,
  fragment,
  onSessionExpired,
}: {
  user: AuthUser;
  active: boolean;
  fragment: string;
  onSessionExpired: () => void;
}) {
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [handle, setHandle] = useState('');
  const [notice, setNotice] = useState('');
  const [opening, setOpening] = useState(false);
  const drafts = useRef(new Map<string, ChatDraft>());
  const selected = /^#\/chat\/([a-f0-9]{24})$/.exec(fragment)?.[1] ?? null;
  const lifetime = useRef<AbortController | null>(null);
  const fail = useCallback(
    (error: unknown) => {
      if (error instanceof WalletApiError && error.status === 401) onSessionExpired();
      else setNotice(error instanceof Error ? error.message : 'Chat unavailable. Try again.');
    },
    [onSessionExpired],
  );
  const refresh = useCallback(async (signal: AbortSignal) => {
    const page = await walletRequest<ChatConversationPage>('v2/chat/conversations', { signal });
    if (!signal.aborted) {
      setConversations(page.conversations);
      setCursor(page.nextCursor);
    }
  }, []);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    lifetime.current = controller;
    setOpening(false);
    let running = false;
    const load = async () => {
      if (running || document.hidden) return;
      running = true;
      try {
        await refresh(controller.signal);
        if (!controller.signal.aborted) setNotice('');
      } catch (error) {
        if (!controller.signal.aborted) fail(error);
      } finally {
        running = false;
      }
    };
    void load();
    const timer = setInterval(() => void load(), 5000);
    window.addEventListener('focus', load);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener('focus', load);
    };
  }, [active, refresh, fail]);
  async function open(event: FormEvent) {
    event.preventDefault();
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted) return;
    setOpening(true);
    setNotice('');
    try {
      const result = await walletWrite<{ conversation: ChatConversation }>(
        user.id,
        'v2/chat/conversations',
        { peerHandle: handle },
        { signal },
      );
      if (!signal.aborted) {
        window.location.hash = `#/chat/${result.conversation.id}`;
        setHandle('');
      }
    } catch (error) {
      if (!signal.aborted) fail(error);
    } finally {
      if (!signal.aborted) setOpening(false);
    }
  }
  async function more() {
    const signal = lifetime.current?.signal;
    if (!cursor || !signal || signal.aborted) return;
    try {
      const page = await walletRequest<ChatConversationPage>(
        `v2/chat/conversations?cursor=${encodeURIComponent(cursor)}`,
        { signal },
      );
      if (!signal.aborted) {
        setConversations((old) => [
          ...new Map([...old, ...page.conversations].map((row) => [row.id, row])).values(),
        ]);
        setCursor(page.nextCursor);
      }
    } catch (error) {
      if (!signal.aborted) fail(error);
    }
  }
  return (
    <section aria-labelledby="chat-title" className="wallet-section">
      <h2 id="chat-title">Chat</h2>
      <p>Talk directly with a peer. Messages refresh while this page is open.</p>
      {notice && <p role="status">{notice}</p>}
      <div className="chat-layout">
        <aside aria-label="Conversations">
          <form onSubmit={(event) => void open(event)}>
            <label htmlFor="chat-peer">Start a chat by exact handle</label>
            <input
              id="chat-peer"
              value={handle}
              onChange={(event) => setHandle(event.target.value)}
              maxLength={24}
              required
              autoComplete="off"
            />
            <button disabled={opening}>{opening ? 'Opening…' : 'New chat'}</button>
          </form>
          <ul className="chat-conversations">
            {conversations.map((row) => (
              <li key={row.id}>
                <a
                  href={`#/chat/${row.id}`}
                  aria-current={selected === row.id ? 'page' : undefined}
                >
                  {row.peer.displayName} <span>@{row.peer.publicHandle}</span>
                  {row.unreadCount > 0 && <strong> · {row.unreadCount} unread</strong>}
                </a>
              </li>
            ))}
          </ul>
          {!conversations.length && <p>No messages yet. Start with a peer’s public handle.</p>}
          {cursor && (
            <button type="button" onClick={() => void more()}>
              More conversations
            </button>
          )}
        </aside>
        {selected ? (
          <ChatThread
            key={`${user.id}:${selected}`}
            user={user}
            id={selected}
            active={active}
            onSessionExpired={onSessionExpired}
            drafts={drafts.current}
            onChanged={() => {
              const signal = lifetime.current?.signal;
              if (signal && !signal.aborted) void refresh(signal).catch(fail);
            }}
          />
        ) : (
          <p>Select a conversation to read and send messages.</p>
        )}
      </div>
    </section>
  );
}

function ChatThread({
  user,
  id,
  active,
  onSessionExpired,
  onChanged,
  drafts,
}: {
  user: AuthUser;
  id: string;
  active: boolean;
  onSessionExpired: () => void;
  onChanged: () => void;
  drafts: Map<string, ChatDraft>;
}) {
  const [conversation, setConversation] = useState<ChatConversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [before, setBefore] = useState<string | null>(null);
  const [text, setText] = useState(drafts.get(id)?.text ?? '');
  const [pending, setPending] = useState<PendingChatMessage | null>(
    drafts.get(id)?.pending ?? null,
  );
  useEffect(() => {
    drafts.set(id, { text, pending });
  }, [drafts, id, text, pending]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [lastChecked, setLastChecked] = useState('');
  const lastSequence = useRef<string | null>(null);
  const lifetime = useRef<AbortController | null>(null);
  const sending = useRef(false);
  const fail = useCallback(
    (error: unknown) => {
      if (error instanceof WalletApiError && error.status === 401) onSessionExpired();
      else setError(error instanceof Error ? error.message : 'Chat unavailable. Try again.');
    },
    [onSessionExpired],
  );
  const load = useCallback(
    async (signal: AbortSignal, earlier?: string) => {
      let after = lastSequence.current;
      do {
        const query = earlier ? `before=${earlier}` : after ? `after=${after}` : '';
        const page = await walletRequest<ChatMessagePage>(
          `v2/chat/conversations/${id}/messages${query ? `?${query}` : ''}`,
          { signal },
        );
        if (signal.aborted) return;
        setConversation(page.conversation);
        setMessages((old) => mergeMessages(old, page.messages));
        if (earlier || after === null) setBefore(page.nextCursor);
        if (!earlier) lastSequence.current = page.messages.at(-1)?.sequence ?? after ?? '0';
        setLastChecked(new Date().toLocaleTimeString());
        if (earlier || after === null || !page.nextCursor) break;
        after = page.nextCursor;
      } while (!signal.aborted);
    },
    [id],
  );
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    lifetime.current = controller;
    setBusy(false);
    let loading = false;
    const refresh = async () => {
      if (loading || document.hidden) return;
      loading = true;
      try {
        await load(controller.signal);
      } catch (error) {
        if (!controller.signal.aborted) fail(error);
      } finally {
        loading = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    window.addEventListener('focus', refresh);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [active, load, fail]);
  async function send(event: FormEvent) {
    event.preventDefault();
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted || sending.current) return;
    const intent = pending ?? pendingMessage(text);
    setPending(intent);
    setBusy(true);
    sending.current = true;
    setError('');
    try {
      const { message } = await walletWrite<{ message: ChatMessage }>(
        user.id,
        `v2/chat/conversations/${id}/messages`,
        intent,
        { signal },
      );
      if (!signal.aborted) {
        setMessages((old) => mergeMessages(old, [message]));
        setPending(null);
        setText('');
        await load(signal);
        onChanged();
      }
    } catch (error) {
      if (!signal.aborted) {
        if (error instanceof WalletApiError && error.status >= 400 && error.status < 500)
          setPending(null);
        fail(error);
      }
    } finally {
      sending.current = false;
      if (!signal.aborted) setBusy(false);
    }
  }
  async function action(kind: 'read' | 'block', body: unknown) {
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted || busy) return;
    setBusy(true);
    setError('');
    try {
      await walletWrite(user.id, `v2/chat/conversations/${id}/${kind}`, body, { signal });
      await load(signal);
      if (!signal.aborted) onChanged();
    } catch (error) {
      if (!signal.aborted) fail(error);
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  return (
    <section aria-label="Chat thread" className="chat-thread">
      <a href="#/chat">Back to chats</a>
      <h3>
        {conversation
          ? `${conversation.peer.displayName} · @${conversation.peer.publicHandle}`
          : 'Loading conversation…'}
      </h3>
      {error && <p role="alert">{error}</p>}
      <p role="status">{lastChecked ? `Last checked ${lastChecked}` : 'Connecting…'}</p>
      <button
        type="button"
        onClick={() => {
          const signal = lifetime.current?.signal;
          if (signal) void load(signal).catch(fail);
        }}
      >
        Refresh messages
      </button>
      {before && (
        <button
          type="button"
          onClick={() => {
            const signal = lifetime.current?.signal;
            if (signal) void load(signal, before).catch(fail);
          }}
        >
          Earlier messages
        </button>
      )}
      <ol className="chat-messages" aria-label="Messages">
        {messages.map((message) => (
          <li key={message.id} data-own={message.senderId === user.id}>
            <strong>{message.senderId === user.id ? 'You' : conversation?.peer.displayName}</strong>
            <p>{message.text}</p>
            <small>
              <time dateTime={message.createdAt}>
                {new Date(message.createdAt).toLocaleString()}
              </time>{' '}
              · Sent
            </small>
          </li>
        ))}
      </ol>
      {conversation && (
        <>
          {messages.length > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void action('read', { throughSequence: messages.at(-1)!.sequence })}
            >
              Mark conversation as read
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => void action('block', { blocked: !conversation.blockedByMe })}
          >
            {conversation.blockedByMe ? 'Unblock peer' : 'Block peer'}
          </button>
          {conversation.blocked && (
            <p>Messaging is blocked. Each participant controls their own block.</p>
          )}
          <form onSubmit={(event) => void send(event)}>
            <label htmlFor="chat-text">Message</label>
            <textarea
              id="chat-text"
              value={text}
              disabled={!!pending || conversation.blocked}
              maxLength={16000}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  if (
                    !busy &&
                    !pending &&
                    !conversation.blocked &&
                    text.trim() &&
                    [...text].length <= 4000
                  )
                    event.currentTarget.form?.requestSubmit();
                }
              }}
              required
              rows={3}
            />
            <p>{[...text].length} / 4000 characters</p>
            {pending && !busy && (
              <p role="status">
                Delivery is uncertain. Retry checks the same message without creating a duplicate.
              </p>
            )}
            <button
              disabled={busy || conversation.blocked || !text.trim() || [...text].length > 4000}
            >
              {busy ? 'Sending…' : pending ? 'Retry same message' : 'Send message'}
            </button>
          </form>
        </>
      )}
    </section>
  );
}
