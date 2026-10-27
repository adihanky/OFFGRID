import { useEffect, useState, type FormEvent } from 'react';
import type {
  AuthUser,
  AssetV2,
  ConsumerRequestInput,
  ConsumerRequestView,
  ConsumerRequestPage,
  WorkspaceOverview,
  WalletRole,
} from '@p2p/contracts';
import { useWalletLifetime, useWalletResource } from './use-wallet-resource';
import { walletWrite, WalletApiError } from './wallet-v2-client';

export function RequestsPanel({
  user,
  active,
  onSessionExpired,
}: {
  user: AuthUser;
  active: boolean;
  onSessionExpired: () => void;
}) {
  const lifetime = useWalletLifetime();
  const requests = useWalletResource<ConsumerRequestPage>('v2/requests', active, onSessionExpired);
  const overview = useWalletResource<WorkspaceOverview>('v2/workspace', active, onSessionExpired);
  const assets = useWalletResource<{ assets: AssetV2[] }>('v2/assets', active, onSessionExpired);
  const [type, setType] = useState<'ACCESS' | 'DEMO_ALLOCATION'>('DEMO_ALLOCATION'),
    [role, setRole] = useState('ASSET_ADMIN'),
    [assetId, setAssetId] = useState(''),
    [quantity, setQuantity] = useState(''),
    [reason, setReason] = useState('');
  const [original, setOriginal] = useState<{ key: string; body: ConsumerRequestInput } | null>(
      null,
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  useEffect(() => {
    const first = assets.data?.assets.find(
      (asset) => asset.lifecycle === 'ACTIVE' && asset.custodyEnabled,
    );
    if (first) setAssetId((old) => old || first.id);
  }, [assets.data]);
  const enabled =
    overview.data?.capabilities[type === 'ACCESS' ? 'accessRequest' : 'allocationRequest'].enabled;
  async function submit(event?: FormEvent) {
    const signal = lifetime.current.signal;
    event?.preventDefault();
    if (busy) return;
    const command = original ?? {
      key: crypto.randomUUID(),
      body:
        type === 'ACCESS'
          ? { type, role: role as Exclude<WalletRole, 'USER'>, reason }
          : { type, assetId, quantity, reason },
    };
    setOriginal(command);
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await walletWrite<{ request: ConsumerRequestView }>(
        user.id,
        'v2/requests',
        command.body,
        { key: command.key, signal },
      );
      if (signal.aborted) return;
      setNotice(
        `Request ${result.request.id} is ${result.request.status.toLowerCase()}. An administrator must decide it; submitting never grants access or credits.`,
      );
      setOriginal(null);
      setReason('');
      setQuantity('');
      requests.reload();
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof WalletApiError && error.status === 401) onSessionExpired();
      else {
        setError(
          error instanceof Error
            ? error.message
            : 'Request outcome unavailable. Check the original request.',
        );
        if (error instanceof WalletApiError && [400, 403, 409].includes(error.status)) {
          setOriginal(null);
          requests.reload();
        }
      }
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  return (
    <section className="wallet-section" aria-labelledby="help-title">
      <div className="wallet-heading">
        <div>
          <p className="eyebrow">HELP AND TRACKED REQUESTS</p>
          <h2 id="help-title">Help</h2>
        </div>
        <button
          className="secondary-button"
          disabled={requests.busy}
          onClick={() => {
            requests.reload();
            overview.reload();
            assets.reload();
          }}
        >
          Refresh help
        </button>
      </div>
      <p>
        Receive demo units from another registered peer using your handle, or ask an administrator
        for an allocation. Demo units have no monetary value. External wallet linking does not fund
        this wallet.
      </p>
      <div className="transfer-actions">
        <a href="#/home">Home</a>
        <a href="#/wallet">Receive details</a>
        <a href="#/activity">Check a transfer</a>
        <a href="#/settings/security">Account security</a>
        {overview.data?.helpUrl && (
          <a href={overview.data.helpUrl} target="_blank" rel="noopener noreferrer">
            Organization help page
          </a>
        )}
      </div>
      {overview.error && <p role="alert">{overview.error}</p>}
      {assets.error && <p role="alert">{assets.error}</p>}
      <form className="admin-form" onSubmit={(event) => void submit(event)}>
        <h3>Submit a request</h3>
        <fieldset disabled={busy || !!original}>
          <label>
            Request category
            <select value={type} onChange={(event) => setType(event.target.value as typeof type)}>
              <option value="DEMO_ALLOCATION">Demo allocation</option>
              <option value="ACCESS">Administrator access</option>
            </select>
          </label>
          {type === 'ACCESS' ? (
            <label>
              Requested role
              <select value={role} onChange={(event) => setRole(event.target.value)}>
                <option value="ASSET_ADMIN">Asset administrator</option>
                <option value="ACCESS_ADMIN">Access administrator</option>
                <option value="DEMO_OPERATOR">Demo operator</option>
                <option value="AUDITOR">Auditor</option>
              </select>
            </label>
          ) : (
            <>
              <label>
                Requested demo asset
                <select
                  value={assetId}
                  required
                  onChange={(event) => setAssetId(event.target.value)}
                >
                  <option value="">Choose a supported demo asset</option>
                  {assets.data?.assets
                    .filter((asset) => asset.lifecycle === 'ACTIVE' && asset.custodyEnabled)
                    .map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        {asset.displayName} ({asset.symbol})
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Requested quantity
                <input
                  value={quantity}
                  required
                  maxLength={30}
                  inputMode="decimal"
                  onChange={(event) => setQuantity(event.target.value)}
                />
              </label>
            </>
          )}
          <label>
            Reason for request
            <input
              value={reason}
              required
              minLength={3}
              maxLength={200}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <p>
            {enabled
              ? 'An authorized administrator reviews every request. You can follow the decision below.'
              : 'New requests in this category are currently unavailable. Your existing requests remain visible.'}
          </p>
          <button className="primary-button" disabled={!enabled}>
            Submit tracked request
          </button>
        </fieldset>
      </form>
      {original && (
        <div role="status">
          <p>The request outcome needs checking. Checking uses the original request key.</p>
          <button className="secondary-button" disabled={busy} onClick={() => void submit()}>
            Check original request
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <h3>Your requests</h3>
      {requests.error && <p role="alert">{requests.error}</p>}
      {requests.busy && <p role="status">Loading your requests…</p>}
      {requests.data && !requests.data.requests.length && (
        <p>No requests yet. You can continue using Wallet, Activity and Settings.</p>
      )}
      <RequestList rows={requests.data?.requests ?? []} />
      {requests.data?.nextCursor && (
        <RequestOlder
          cursor={requests.data.nextCursor}
          active={active}
          onSessionExpired={onSessionExpired}
        />
      )}
    </section>
  );
}
function RequestList({ rows }: { rows: ConsumerRequestView[] }) {
  return (
    <ul className="admin-assets" aria-label="Tracked requests">
      {rows.map((row) => (
        <li key={row.id}>
          <strong>
            {row.type === 'ACCESS' ? `Access: ${row.role}` : `${row.quantity} ${row.asset?.code}`}
          </strong>
          <span>
            {row.status.toLowerCase()} · {new Date(row.createdAt).toLocaleString()}
          </span>
          <p>{row.reason}</p>
          {row.decisionReason && <p>Administrator: {row.decisionReason}</p>}
          <small>
            Request {row.id}
            {row.operationId ? ` · Applied operation ${row.operationId}` : ''}
          </small>
          {row.status === 'REJECTED' && <a href="#/home">Continue to Home</a>}
        </li>
      ))}
    </ul>
  );
}
function RequestOlder({
  cursor,
  active,
  onSessionExpired,
}: {
  cursor: string;
  active: boolean;
  onSessionExpired: () => void;
}) {
  const [open, setOpen] = useState(false),
    resource = useWalletResource<ConsumerRequestPage>(
      `v2/requests?cursor=${cursor}`,
      active && open,
      onSessionExpired,
    );
  return (
    <div>
      <button className="secondary-button" onClick={() => setOpen(true)}>
        Load older requests
      </button>
      {resource.error && <p role="alert">{resource.error}</p>}
      {open && <RequestList rows={resource.data?.requests ?? []} />}
      {resource.data?.nextCursor && (
        <RequestOlder
          key={resource.data.nextCursor}
          cursor={resource.data.nextCursor}
          active={active && open}
          onSessionExpired={onSessionExpired}
        />
      )}
    </div>
  );
}
export function RequestReviewPanel({
  user,
  roles,
  active,
  onChanged,
  onSessionExpired,
}: {
  user: AuthUser;
  roles: WalletRole[];
  active: boolean;
  onChanged: () => void;
  onSessionExpired: () => void;
}) {
  const resource = useWalletResource<ConsumerRequestPage>(
    'v2/admin/requests?status=OPEN',
    active,
    onSessionExpired,
  );
  return (
    <section aria-labelledby="request-review-title">
      <h3 id="request-review-title">Request review queue</h3>
      <p>
        Approval invokes the existing guarded domain service. Review the exact effect before
        confirming. Another administrator must review your own requests.
      </p>
      <button className="secondary-button" disabled={resource.busy} onClick={resource.reload}>
        Refresh review queue
      </button>
      {resource.error && <p role="alert">{resource.error}</p>}
      {resource.busy && <p role="status">Loading requests…</p>}
      {resource.data && !resource.data.requests.length && (
        <p>No open requests in your authorized categories.</p>
      )}
      {resource.data?.requests.map((row) => (
        <ReviewCard
          key={row.id}
          row={row}
          user={user}
          allowed={
            row.owner.id !== user.id &&
            roles.includes(row.type === 'ACCESS' ? 'ACCESS_ADMIN' : 'ASSET_ADMIN')
          }
          onChanged={() => {
            resource.reload();
            onChanged();
          }}
          onSessionExpired={onSessionExpired}
        />
      ))}
      {resource.data?.nextCursor && (
        <p>
          Showing the newest 20 open requests. Deciding these and refreshing reveals the next open
          requests.
        </p>
      )}
    </section>
  );
}
function ReviewCard({
  row,
  user,
  allowed,
  onChanged,
  onSessionExpired,
}: {
  row: ConsumerRequestView;
  user: AuthUser;
  allowed: boolean;
  onChanged: () => void;
  onSessionExpired: () => void;
}) {
  const lifetime = useWalletLifetime();
  const [decision, setDecision] = useState<'APPROVED' | 'REJECTED'>('APPROVED'),
    [reason, setReason] = useState(''),
    [review, setReview] = useState(false),
    [command, setCommand] = useState<unknown>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function confirm() {
    const signal = lifetime.current.signal;
    if (busy) return;
    const original = command ?? {
      decision,
      reason,
      revision: row.revision,
      commandId: crypto.randomUUID(),
    };
    setCommand(original);
    setBusy(true);
    setError('');
    try {
      await walletWrite(user.id, `v2/admin/requests/${row.id}/decision`, original, { signal });
      if (signal.aborted) return;
      setCommand(null);
      setReview(false);
      onChanged();
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof WalletApiError && error.status === 401) onSessionExpired();
      else {
        setError(
          error instanceof Error
            ? error.message
            : 'Decision outcome unavailable. Check the original decision.',
        );
        if (error instanceof WalletApiError && [400, 403, 409].includes(error.status)) {
          setCommand(null);
          setReview(false);
          onChanged();
        }
      }
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  return (
    <form
      className="admin-form"
      onSubmit={(event) => {
        event.preventDefault();
        setReview(true);
      }}
    >
      <h4>
        @{row.owner.publicHandle}:{' '}
        {row.type === 'ACCESS' ? row.role : `${row.quantity} ${row.asset?.code}`}
      </h4>
      <p>{row.reason}</p>
      <small>
        Request {row.id} · revision {row.revision}
      </small>
      <fieldset disabled={!allowed || busy || !!command || review}>
        <label>
          Decision
          <select
            value={decision}
            onChange={(event) => setDecision(event.target.value as typeof decision)}
          >
            <option value="APPROVED">Approve</option>
            <option value="REJECTED">Reject</option>
          </select>
        </label>
        <label>
          Decision reason
          <input
            value={reason}
            required
            minLength={3}
            maxLength={200}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <button className="secondary-button">Review decision</button>
      </fieldset>
      {!allowed && <p>Self-approval is unavailable, and the category role is required.</p>}
      {review && (
        <div className="admin-notice">
          <p>
            {decision === 'APPROVED'
              ? `Confirm ${row.type === 'ACCESS' ? `granting ${row.role}` : `issuing ${row.quantity} ${row.asset?.code}`} to @${row.owner.publicHandle}.`
              : `Reject this request from @${row.owner.publicHandle} without changing any role or balance.`}
          </p>
          <button
            type="button"
            className="primary-button"
            disabled={busy}
            onClick={() => void confirm()}
          >
            {command ? 'Check original decision' : 'Confirm administrator decision'}
          </button>
          {!command && (
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => setReview(false)}
            >
              Keep editing decision
            </button>
          )}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
