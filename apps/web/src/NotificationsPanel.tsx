import { useEffect, useState } from 'react';
import type { AuthUser, NotificationPage } from '@p2p/contracts';
import { useWalletLifetime, useWalletResource } from './use-wallet-resource';
import { walletRequest, walletWrite, WalletApiError } from './wallet-v2-client';
export function NotificationsPanel({
  user,
  active,
  onSessionExpired,
}: {
  user: AuthUser;
  active: boolean;
  onSessionExpired: () => void;
}) {
  const lifetime = useWalletLifetime();
  const resource = useWalletResource<NotificationPage>(
    'v2/notifications',
    active,
    onSessionExpired,
  );
  const [older, setOlder] = useState<NotificationPage['notifications']>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    if (!active) return;
    const interval = window.setInterval(resource.reload, 10000);
    return () => window.clearInterval(interval);
  }, [active, resource.reload]);
  useEffect(() => {
    setOlder([]);
    setCursor(resource.data?.nextCursor ?? null);
  }, [resource.data]);
  function fail(error: unknown) {
    if (error instanceof WalletApiError && error.status === 401) onSessionExpired();
    else setError(error instanceof Error ? error.message : 'Inbox unavailable. Retry.');
  }
  async function more() {
    const signal = lifetime.current.signal;
    if (!cursor) return;
    setBusy(true);
    setError('');
    try {
      const page = await walletRequest<NotificationPage>(`v2/notifications?cursor=${cursor}`, {
        signal,
      });
      if (signal.aborted) return;
      setOlder((rows) => [...rows, ...page.notifications]);
      setCursor(page.nextCursor);
    } catch (error) {
      if (!signal.aborted) fail(error);
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  const rows = [
    ...new Map(
      [...(resource.data?.notifications ?? []), ...older].map((row) => [row.id, row]),
    ).values(),
  ];
  return (
    <section className="wallet-section" aria-labelledby="notifications-title">
      <div className="wallet-heading">
        <h2 id="notifications-title">Notifications</h2>
        <button
          className="secondary-button"
          disabled={resource.busy || busy}
          onClick={resource.reload}
        >
          Refresh notifications
        </button>
      </div>
      <p>
        New completed transfers appear here. Read state has no effect on a transfer. Use{' '}
        <a href="#/activity">Activity</a> for all historical outcomes.
      </p>
      {(error || resource.error) && <p role="alert">{error || resource.error}</p>}
      {resource.busy && <p role="status">Checking notifications…</p>}
      {resource.data && !rows.length && (
        <p>
          No notifications yet. You can <a href="#/wallet">receive demo units</a> or{' '}
          <a href="#/home">return Home</a>.
        </p>
      )}
      <ul className="admin-assets">
        {rows.map((row) => (
          <li key={row.id}>
            <strong>{row.readAt ? 'Read' : 'Unread'}</strong>
            <p>{row.message}</p>
            <time dateTime={row.createdAt}>{new Date(row.createdAt).toLocaleString()}</time>
            <a href={`#/activity/${row.transferId}`}>View transfer receipt</a>
            <button
              className="secondary-button"
              disabled={busy || !!row.readAt}
              onClick={() => {
                const signal = lifetime.current.signal;
                setBusy(true);
                setError('');
                void walletWrite(user.id, `v2/notifications/${row.id}/read`, {}, { signal })
                  .then(() => {
                    if (!signal.aborted) resource.reload();
                  })
                  .catch((error: unknown) => {
                    if (!signal.aborted) fail(error);
                  })
                  .finally(() => {
                    if (!signal.aborted) setBusy(false);
                  });
              }}
            >
              Mark notification read
            </button>
          </li>
        ))}
      </ul>
      {cursor && (
        <button className="secondary-button" disabled={busy} onClick={() => void more()}>
          Load older notifications
        </button>
      )}
      <a href="#/home">Return Home</a>
    </section>
  );
}
