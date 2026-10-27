import { useEffect, useRef, useState, type FormEvent } from 'react';
import type {
  AuthUser,
  HistoricalTransfer,
  TransferHistoryPage,
  TransferReceipt,
  TransferChainEvidence,
} from '@p2p/contracts';
import { walletRequest, WalletApiError } from './wallet-v2-client';

export function TransferHistoryPanel({
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
  const [rows, setRows] = useState<HistoricalTransfer[]>([]),
    [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [version, setVersion] = useState(0);
  const [direction, setDirection] = useState('ALL'),
    [status, setStatus] = useState(''),
    [peer, setPeer] = useState(''),
    [asset, setAsset] = useState(''),
    [from, setFrom] = useState(''),
    [to, setTo] = useState('');
  const query = fragment.split('?')[1] ?? '';
  const detailId = /^#\/activity\/([a-f0-9]{24})$/.exec(fragment)?.[1];
  const lifetime = useRef<AbortController | null>(null);
  function fail(error: unknown) {
    if (error instanceof WalletApiError && error.status === 401) onSessionExpired();
    else setError(error instanceof Error ? error.message : 'Activity unavailable. Retry.');
  }
  useEffect(() => {
    const params = new URLSearchParams(query);
    setDirection(params.get('direction') ?? 'ALL');
    setStatus(params.get('status') ?? '');
    setPeer(params.get('peerHandle') ?? '');
    setAsset(params.get('assetId') ?? '');
    setFrom(params.get('from')?.slice(0, 10) ?? '');
    setTo(params.get('to')?.slice(0, 10) ?? '');
  }, [query]);
  useEffect(() => {
    if (!active || detailId) return;
    const controller = new AbortController();
    lifetime.current = controller;
    setBusy(true);
    setError('');
    setRows([]);
    setCursor(null);
    void walletRequest<TransferHistoryPage>(`v2/transfers${query ? `?${query}` : ''}`, {
      signal: controller.signal,
    })
      .then((page) => {
        if (!controller.signal.aborted) {
          setRows(page.transfers);
          setCursor(page.nextCursor);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) fail(error);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [active, query, detailId, version, onSessionExpired]);
  function filter(event: FormEvent) {
    event.preventDefault();
    const params = new URLSearchParams();
    if (direction !== 'ALL') params.set('direction', direction);
    if (status) params.set('status', status);
    if (peer) params.set('peerHandle', peer.trim().replace(/^@/, '').toLowerCase());
    if (asset) params.set('assetId', asset.trim());
    if (from) params.set('from', `${from}T00:00:00.000Z`);
    if (to) params.set('to', `${to}T23:59:59.999Z`);
    const hash = `#/activity${params.size ? `?${params}` : ''}`;
    if (window.location.hash === hash) setVersion((v) => v + 1);
    else window.location.hash = hash;
  }
  async function more() {
    if (!cursor || busy) return;
    const signal = lifetime.current!.signal;
    setBusy(true);
    setError('');
    try {
      const params = new URLSearchParams(query);
      params.set('cursor', cursor);
      const page = await walletRequest<TransferHistoryPage>(`v2/transfers?${params}`, {
        signal,
      });
      if (!signal.aborted) {
        setRows((old) => [
          ...new Map([...old, ...page.transfers].map((row) => [row.id, row])).values(),
        ]);
        setCursor(page.nextCursor);
      }
    } catch (error) {
      if (!signal.aborted) fail(error);
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  return (
    <section className="wallet-section" aria-labelledby="transfer-history-title">
      <div className="wallet-heading">
        <div>
          <p className="eyebrow">YOUR TRANSFERS</p>
          <h2 id="transfer-history-title">Activity</h2>
        </div>
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() => setVersion((v) => v + 1)}
        >
          Refresh activity
        </button>
      </div>
      <p>
        Find sent and received transfers, including your pending and rejected sends. Filters show a
        live view; outcomes can change while you page. Refresh to see newer transfers.
      </p>
      <div className="transfer-actions">
        <a href="#/home">Home</a>
        <a href="#/send">Send</a>
        <a href="#/wallet">Wallet</a>
      </div>
      {detailId ? (
        <TransferDetail
          key={`${user.id}:${detailId}:${version}`}
          id={detailId}
          active={active}
          onSessionExpired={onSessionExpired}
        />
      ) : (
        <>
          <form className="admin-form history-filters" onSubmit={filter}>
            <label>
              Direction
              <select value={direction} onChange={(event) => setDirection(event.target.value)}>
                <option value="ALL">Sent and received</option>
                <option value="SENT">Sent</option>
                <option value="RECEIVED">Received</option>
              </select>
            </label>
            <label>
              Outcome
              <select value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="">All outcomes</option>
                <option value="PENDING">Pending</option>
                <option value="COMMITTED">Completed</option>
                <option value="REJECTED">Rejected</option>
              </select>
            </label>
            <label>
              Peer handle
              <input
                value={peer}
                maxLength={24}
                onChange={(event) => setPeer(event.target.value)}
              />
            </label>
            <label>
              Asset ID
              <input
                value={asset}
                maxLength={24}
                onChange={(event) => setAsset(event.target.value)}
              />
            </label>
            <label>
              From date (UTC)
              <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            </label>
            <label>
              To date (UTC)
              <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            </label>
            <p>Use both dates together, within 366 days.</p>
            <button className="secondary-button" disabled={busy}>
              Apply activity filters
            </button>
          </form>
          {busy && <p role="status">Loading activity…</p>}
          {error && <p role="alert">{error}</p>}
          {!busy && !error && !rows.length && (
            <p>
              No transfers match these filters. <a href="#/wallet">Share your receive details</a> or{' '}
              <a href="#/activity">clear the filters</a>.
            </p>
          )}
          <ul className="admin-assets" aria-label="Transfer history">
            {rows.map((row) => (
              <li key={row.id}>
                <strong>
                  {row.sender.id === user.id ? 'Sent to' : 'Received from'} @
                  {row.sender.id === user.id ? row.recipient.publicHandle : row.sender.publicHandle}
                </strong>
                <span>
                  {row.quantity} {row.asset.code} ·{' '}
                  {row.status === 'COMMITTED'
                    ? 'Completed'
                    : row.status === 'PENDING'
                      ? 'Pending — still checking'
                      : 'Rejected'}
                </span>
                <time dateTime={row.createdAt}>{new Date(row.createdAt).toLocaleString()}</time>
                <small>Demo · simulated · v{row.payloadVersion}</small>
                <a href={`#/activity/${row.id}`}>
                  {row.status === 'COMMITTED' ? 'View receipt' : 'Check original transfer'}
                </a>
              </li>
            ))}
          </ul>
          {cursor && (
            <button className="secondary-button" disabled={busy} onClick={() => void more()}>
              Load more transfers
            </button>
          )}
        </>
      )}
    </section>
  );
}
function TransferDetail({
  id,
  active,
  onSessionExpired,
}: {
  id: string;
  active: boolean;
  onSessionExpired: () => void;
}) {
  const [transfer, setTransfer] = useState<HistoricalTransfer | null>(null),
    [receipt, setReceipt] = useState<TransferReceipt | null>(null),
    [evidence, setEvidence] = useState<TransferChainEvidence | null>(null);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0),
    [technical, setTechnical] = useState(false);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setBusy(true);
    setError('');
    void (async () => {
      const result = await walletRequest<{ transfer: HistoricalTransfer }>(`v2/transfers/${id}`, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setTransfer(result.transfer);
      if (result.transfer.status === 'COMMITTED') {
        const read = await walletRequest<TransferReceipt>(`v2/transfers/${id}/receipt`, {
          signal: controller.signal,
        });
        if (!controller.signal.aborted) setReceipt(read);
      }
    })()
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          if (error instanceof WalletApiError && error.status === 401) onSessionExpired();
          else setError(error instanceof Error ? error.message : 'Transfer unavailable. Retry.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [id, active, revision, onSessionExpired]);
  useEffect(() => {
    if (!active || !technical || transfer?.status !== 'COMMITTED') return;
    const controller = new AbortController();
    void walletRequest<TransferChainEvidence>(`v2/transfers/${id}/chain`, {
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) setEvidence(value);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          if (error instanceof WalletApiError && error.status === 401) onSessionExpired();
          else setError('Technical evidence unavailable. Close and reopen it to retry.');
        }
      });
    return () => controller.abort();
  }, [active, technical, id, transfer?.status, onSessionExpired]);
  return (
    <div>
      <h3>{transfer?.status === 'COMMITTED' ? 'Transfer receipt' : 'Original transfer outcome'}</h3>
      <button
        className="secondary-button"
        disabled={busy}
        onClick={() => setRevision((v) => v + 1)}
      >
        Check status
      </button>
      {busy && <p role="status">Checking original transfer…</p>}
      {error && <p role="alert">{error}</p>}
      {transfer && (
        <>
          <p role="status">
            {transfer.status === 'PENDING'
              ? 'Still checking. This transfer may complete. You can leave safely and find it again in Activity.'
              : transfer.status === 'COMMITTED'
                ? 'Completed'
                : `Rejected: ${transfer.rejectionCode?.toLowerCase().replaceAll('_', ' ')}`}
          </p>
          <dl className="custody-metadata">
            <dt>Reference</dt>
            <dd>{transfer.id}</dd>
            <dt>From</dt>
            <dd>@{transfer.sender.publicHandle}</dd>
            <dt>To</dt>
            <dd>@{transfer.recipient.publicHandle}</dd>
            <dt>Exact amount</dt>
            <dd>
              {transfer.quantity} {transfer.asset.code}
            </dd>
            <dt>Settlement</dt>
            <dd>Demo · simulated</dd>
            {receipt && (
              <>
                <dt>Completed</dt>
                <dd>{new Date(receipt.committedAt).toLocaleString()}</dd>
              </>
            )}
          </dl>
          {receipt && (
            <>
              <p>{receipt.notice}</p>
              <details onToggle={(event) => setTechnical(event.currentTarget.open)}>
                <summary>Technical transfer evidence</summary>
                {evidence ? (
                  <dl className="custody-metadata">
                    <dt>Sequence</dt>
                    <dd>{evidence.sequence}</dd>
                    <dt>Entry hash</dt>
                    <dd>{evidence.entryHash}</dd>
                    <dt>Predecessor hash</dt>
                    <dd>{evidence.previousHash}</dd>
                    <dt>Evidence scope</dt>
                    <dd>{evidence.notice}</dd>
                  </dl>
                ) : (
                  <p>Loading authorized evidence…</p>
                )}
              </details>
            </>
          )}
        </>
      )}
      <p>
        <a href="#/activity">Back to Activity</a> · <a href="#/home">Return Home</a>
      </p>
    </div>
  );
}
