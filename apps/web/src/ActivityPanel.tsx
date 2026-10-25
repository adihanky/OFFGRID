import { useEffect, useState } from 'react';
import type { CustodyActivity } from '@p2p/contracts';
import { v2Api, WalletApiError } from './wallet-v2-client';
export function ActivityPanel({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [events, setEvents] = useState<CustodyActivity[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    void v2Api
      .activity(undefined, controller.signal)
      .then((page) => {
        if (!controller.signal.aborted) {
          setEvents(page.events);
          setCursor(page.nextCursor);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          if (error instanceof WalletApiError && error.status === 401) onSessionExpired();
          else setError('Activity unavailable. Refresh your wallet to retry.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [onSessionExpired]);
  return (
    <section className="activity-section" aria-label="Custody activity">
      <h3>Custody & activity</h3>
      <p>Issuance and transfers form a record of how demo units move between wallets.</p>
      {busy && <p role="status">Loading activity...</p>}
      {!busy && !events.length && !error && (
        <p>No custody activity yet. Issued demo assets and completed transfers will appear here.</p>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="activity-list">
        {events.map((event) => (
          <details key={event.id}>
            <summary>
              <span>
                {event.direction === 'ISSUED'
                  ? 'Issued'
                  : event.direction === 'SENT'
                    ? 'Sent'
                    : 'Received'}
              </span>
              <strong>
                {event.quantity} {event.asset.code}
              </strong>
              <small>{new Date(event.createdAt).toLocaleString()}</small>
            </summary>
            <p>
              {event.provenance === 'MIGRATED_POLICY'
                ? 'Reconstructed provenance · issuance first, then recorded transfer order.'
                : 'Observed demo custody · recorded atomically with settlement.'}
            </p>
            <dl className="custody-metadata">
              <dt>Reference</dt>
              <dd>{event.referenceId}</dd>
              <dt>Sequence</dt>
              <dd>{event.sequence}</dd>
              <dt>Hash</dt>
              <dd>{event.hash}</dd>
              <dt>Previous hash</dt>
              <dd>{event.previousHash}</dd>
            </dl>
            <p>
              Inputs:{' '}
              {event.inputs.length
                ? event.inputs.map((input) => `${input.quantity} (lot ${input.id})`).join(', ')
                : 'Issuance root'}
            </p>
            <ul>
              {event.outputs.map((output) => (
                <li key={output.id}>
                  {output.quantity} → {output.owner === 'YOU' ? 'Your wallet' : 'Counterparty'} ·{' '}
                  {output.status.toLowerCase()}
                  <small> Lot {output.id}</small>
                </li>
              ))}
            </ul>
            {event.allocations.length > 0 && (
              <ul>
                {event.allocations.map((edge) => (
                  <li key={`${edge.inputId}:${edge.outputId}`}>
                    {edge.quantity}: {edge.inputId} → {edge.outputId}
                  </li>
                ))}
              </ul>
            )}
          </details>
        ))}
      </div>
      {cursor && (
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void v2Api
              .activity(cursor)
              .then((page) => {
                setEvents((old) => [...old, ...page.events]);
                setCursor(page.nextCursor);
              })
              .catch(() => setError('Unable to load more activity. Retry.'))
              .finally(() => setBusy(false));
          }}
        >
          Load more activity
        </button>
      )}
    </section>
  );
}
