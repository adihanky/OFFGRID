import { useEffect, useRef, useState } from 'react';
import type { AuthUser, VerificationJobView } from '@p2p/contracts';
import { useWalletLifetime, useWalletResource } from './use-wallet-resource';
import { walletWrite, WalletApiError } from './wallet-v2-client';
interface Overview {
  pendingTransfers: number;
  oldestPendingAt: string | null;
  notificationBacklog: number;
  historicalEventsRetained: number;
  notificationsSince: string;
  verificationLimit: number;
  notice: string;
}
export function OperationsPanel({
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
  const lifetime = useWalletLifetime();
  const overview = useWalletResource<Overview>('v2/admin/operations', active, onSessionExpired);
  const requested = new URLSearchParams(fragment.split('?')[1] ?? '').get('job');
  const jobId = requested && /^[a-f0-9]{24}$/.test(requested) ? requested : null;
  const job = useWalletResource<{ job: VerificationJobView }>(
    `v2/admin/jobs/${jobId}`,
    active && !!jobId,
    onSessionExpired,
  );
  const key = useRef<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    if (!active || !jobId || !['QUEUED', 'RUNNING'].includes(job.data?.job.status ?? '')) return;
    const timer = window.setInterval(job.reload, 2000);
    return () => window.clearInterval(timer);
  }, [active, jobId, job.data?.job.status, job.reload]);
  async function start() {
    const signal = lifetime.current.signal;
    key.current ??= crypto.randomUUID();
    setBusy(true);
    setError('');
    try {
      const read = await walletWrite<{ job: VerificationJobView }>(
        user.id,
        'v2/admin/verification-jobs',
        { scope: 'DEMO_INTEGRITY' },
        { key: key.current, signal },
      );
      if (signal.aborted) return;
      window.location.hash = `#/admin/operations?job=${read.job.id}`;
      key.current = null;
      job.reload();
      overview.reload();
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof WalletApiError && error.status === 401) onSessionExpired();
      else
        setError(
          error instanceof Error
            ? error.message
            : 'Job admission unavailable. Retry the original job request.',
        );
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  return (
    <section aria-labelledby="operations-title">
      <h3 id="operations-title">Operations</h3>
      <button
        className="secondary-button"
        disabled={overview.busy}
        onClick={() => {
          overview.reload();
          job.reload();
        }}
      >
        Refresh operations
      </button>
      {(overview.error || error) && <p role="alert">{overview.error || error}</p>}
      {overview.data && (
        <>
          <dl className="custody-metadata">
            <dt>Pending transfers</dt>
            <dd>{overview.data.pendingTransfers}</dd>
            <dt>Oldest pending admission</dt>
            <dd>
              {overview.data.oldestPendingAt
                ? new Date(overview.data.oldestPendingAt).toLocaleString()
                : 'None'}
            </dd>
            <dt>Notification backlog</dt>
            <dd>{overview.data.notificationBacklog}</dd>
            <dt>Historical outbox retained</dt>
            <dd>{overview.data.historicalEventsRetained}</dd>
            <dt>Notification activation</dt>
            <dd>{new Date(overview.data.notificationsSince).toLocaleString()}</dd>
          </dl>
          <p>{overview.data.notice}</p>
        </>
      )}
      <h4>Read-only integrity verification</h4>
      <p>
        Check ledger, transfer chain and custody in separate bounded snapshots. At most 5,000
        records per collection. This operation never repairs data or issues units.
      </p>
      <button
        className="primary-button"
        disabled={busy || ['QUEUED', 'RUNNING'].includes(job.data?.job.status ?? '')}
        onClick={() => void start()}
      >
        {key.current ? 'Check original verification request' : 'Run integrity verification'}
      </button>
      {job.error && <p role="alert">{job.error}</p>}
      {job.data && (
        <div role="status">
          <p>
            Job {job.data.job.id}: {job.data.job.status.toLowerCase()} · {job.data.job.progress}/3
            checks.
          </p>
          <ul>
            {job.data.job.results.map((result) => (
              <li key={result.check}>
                {result.check}: {result.ok ? 'Passed' : `${result.issueCount} integrity issue(s)`}
              </li>
            ))}
          </ul>
          {job.data.job.error && <p>{job.data.job.error}</p>}
        </div>
      )}
    </section>
  );
}
