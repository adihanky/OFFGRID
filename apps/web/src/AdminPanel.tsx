import { useEffect, useRef, useState, type FormEvent } from 'react';
import type {
  AdministrationStatus,
  AssetV2,
  AuthUser,
  SeedPreview,
  WalletRole,
} from '@p2p/contracts';
import { v2Api, walletRequest, walletWrite, WalletApiError } from './wallet-v2-client';
import { NetworkAdminPanel } from './NetworkAdminPanel';
import { administratorAccess } from './administrator-access';
import { ConfigurationPanel } from './ConfigurationPanel';
import { RequestReviewPanel } from './RequestsPanel';
import { OperationsPanel } from './OperationsPanel';
import { adminDestination } from './consumer-navigation';

type Grant = { id: string; handle: string; role: WalletRole; status: string; revision: string };
type Audit = { id: string; action: string; reason: string; createdAt: string };
export function AdminPanel({
  user,
  onChanged,
  onSessionExpired,
  accountSetupRequested = false,
  fragment = '',
  active = true,
}: {
  user: AuthUser;
  onChanged: () => void;
  onSessionExpired: () => void;
  accountSetupRequested?: boolean;
  fragment?: string;
  active?: boolean;
}) {
  const [status, setStatus] = useState<AdministrationStatus | null>(null);
  const [assets, setAssets] = useState<AssetV2[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [tab, setTab] = useState('assets');
  useEffect(() => {
    const requested = adminDestination(fragment);
    if (requested) setTab(requested);
  }, [fragment]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [token, setToken] = useState('');
  const [editing, setEditing] = useState<AssetV2 | null>(null);
  const [draft, setDraft] = useState({
    code: '',
    symbol: '',
    displayName: '',
    precision: 2,
    supplyCap: '1000000.00',
    minimum: '0.01',
    maximum: '1000000.00',
    reason: '',
  });
  const [issue, setIssue] = useState({
    assetId: '',
    handle: '',
    quantity: '',
    reason: '',
    key: crypto.randomUUID(),
  });
  const [profile, setProfile] = useState({ userCount: 4, transferDepth: 3 });
  const [preview, setPreview] = useState<SeedPreview | null>(null);
  const [password, setPassword] = useState('');
  const [seedState, setSeedState] = useState<{
    state: string;
    operations: number;
    resumeAfter: string | null;
  } | null>(null);
  const [role, setRole] = useState({
    handle: '',
    role: 'ASSET_ADMIN' as WalletRole,
    status: 'ACTIVE',
    reason: '',
  });
  const inFlight = useRef(false);
  const accountDetails = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (accountSetupRequested && accountDetails.current) accountDetails.current.open = true;
  }, [accountSetupRequested, status]);
  async function load(signal?: AbortSignal) {
    const next = await v2Api.status(signal);
    if (signal?.aborted) return;
    setStatus(next);
    setTab((current) => {
      const required: Record<string, WalletRole[]> = {
        assets: ['ASSET_ADMIN'],
        networks: ['ASSET_ADMIN'],
        demo: ['DEMO_OPERATOR'],
        access: ['ACCESS_ADMIN'],
        audit: ['AUDITOR'],
        policies: ['ASSET_ADMIN', 'ACCESS_ADMIN', 'AUDITOR'],
        requests: ['ASSET_ADMIN', 'ACCESS_ADMIN'],
        operations: ['AUDITOR'],
      };
      return required[current]?.some((role) => next.roles.includes(role))
        ? current
        : (Object.keys(required).find((key) =>
            required[key]!.some((role) => next.roles.includes(role)),
          ) ?? 'assets');
    });
    if (next.demoEnabled && next.roles.includes('DEMO_OPERATOR')) {
      const progress = await walletRequest<{
        state: string;
        operations: number;
        resumeAfter: string | null;
      }>('v2/admin/seed/status', { signal });
      if (!signal?.aborted) setSeedState(progress);
    }
    if (next.roles.includes('ASSET_ADMIN')) {
      const result = await walletRequest<{ assets: AssetV2[] }>('v2/admin/assets', { signal });
      if (!signal?.aborted) {
        setAssets(result.assets);
        setIssue((old) => ({
          ...old,
          assetId:
            old.assetId || result.assets.find((asset) => asset.lifecycle === 'ACTIVE')?.id || '',
        }));
      }
    }
    if (next.roles.includes('ACCESS_ADMIN')) {
      const result = await walletRequest<{ grants: Grant[] }>('v2/admin/roles', { signal });
      if (!signal?.aborted) setGrants(result.grants);
    }
    if (next.roles.includes('AUDITOR')) {
      const result = await walletRequest<{ entries: Audit[] }>('v2/admin/audit', { signal });
      if (!signal?.aborted) setAudit(result.entries);
    }
  }
  function fail(error: unknown) {
    if (error instanceof WalletApiError && error.status === 401) onSessionExpired();
    else setError(error instanceof Error ? error.message : 'Unable to complete the operation.');
  }
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch((error: unknown) => {
      if (!controller.signal.aborted) fail(error);
    });
    return () => controller.abort();
    // The parent keys this panel by authenticated identity.
  }, []);
  async function perform(work: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
      await load();
      onChanged();
    } catch (error) {
      fail(error);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  function submit(event: FormEvent, work: () => Promise<void>) {
    event.preventDefault();
    void perform(work);
  }
  function edit(asset: AssetV2) {
    setEditing(asset);
    setDraft({
      code: asset.code,
      symbol: asset.symbol,
      displayName: asset.displayName,
      precision: asset.precision,
      supplyCap:
        asset.supplyCap ?? (9223372036854775807n / 10n ** BigInt(asset.precision)).toString(),
      minimum: asset.minimum ?? (asset.precision ? `0.${'0'.repeat(asset.precision - 1)}1` : '1'),
      maximum: asset.maximum ?? (9223372036854775807n / 10n ** BigInt(asset.precision)).toString(),
      reason: '',
    });
  }
  if (!status)
    return (
      <section className="wallet-section" aria-label="Administration">
        <h2>Administration</h2>
        {error ? (
          <p role="alert">Administration unavailable: {error}</p>
        ) : (
          <p role="status">Loading administration...</p>
        )}
        {error && (
          <button className="secondary-button" onClick={() => void perform(async () => undefined)}>
            Retry administration
          </button>
        )}
      </section>
    );
  return (
    <section className="wallet-section admin-section" aria-label="Administration">
      <div className="wallet-heading">
        <div>
          <p className="eyebrow">WORKSPACE CONTROLS</p>
          <h2 id="administration-title">Administration</h2>
        </div>
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() => void perform(async () => undefined)}
        >
          Refresh administration
        </button>
      </div>
      <details
        ref={accountDetails}
        open={status.roles.length === 0 || accountSetupRequested}
        className="admin-form administrator-entry"
        aria-labelledby="admin-account-title"
      >
        <summary id="admin-account-title">Set up administrator account</summary>
        <p>
          Current account: <strong>@{user.publicHandle}</strong>.
        </p>
        {administratorAccess(status) === 'bootstrap' ? (
          <p>
            First administrator setup is available. Enter the installation setup token below to
            enable administration for this account.
          </p>
        ) : administratorAccess(status) === 'manage' ? (
          <>
            <p>
              Your administrator access is active. To add another administrator, have them register
              an account, then grant their public handle the required roles in Access.
            </p>
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => {
                setTab('access');
                if (fragment) window.location.hash = '#/admin/access';
              }}
            >
              Manage administrator accounts
            </button>
          </>
        ) : (
          <>
            <p>
              {administratorAccess(status) === 'granted'
                ? 'Your assigned administrator roles are active.'
                : 'This account does not have administrator access.'}{' '}
              Ask an access administrator to grant your public handle ASSET_ADMIN for asset and
              network configuration, or ACCESS_ADMIN to manage other administrators. Then refresh
              administration.
            </p>
            <p>
              Installation setup belongs to the installation operator. You can continue using
              Wallet, Activity and Settings while an administrator reviews your access request.
            </p>
            {fragment && (
              <p>
                <a href="#/help">Request administrator access</a> · <a href="#/home">Return Home</a>
                . Installation setup belongs to the installation operator.
              </p>
            )}
          </>
        )}
      </details>
      {!status.roles.includes('ASSET_ADMIN') && (
        <p className="admin-notice">
          Asset and network configuration requires an ASSET_ADMIN grant. Sign in with the configured
          administrator account, or ask an access administrator to grant that role. Your own wallet
          setup is available to every registered user.
        </p>
      )}
      {status.maintenance && (
        <p role="status">
          Wallet maintenance is in progress. New transfers and issuance are paused.
        </p>
      )}
      {status.setupAvailable && (
        <form
          className="admin-form"
          onSubmit={(event) =>
            submit(event, async () => {
              await walletWrite(user.id, 'v2/admin/setup', { token });
              setToken('');
              setNotice('Administration enabled for your account.');
            })
          }
        >
          <h3>Set up administration</h3>
          <p>Use the installation setup token to enable the first administrator.</p>
          <label>
            Installation setup token
            <input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              required
              autoComplete="off"
              maxLength={256}
            />
          </label>
          <button className="primary-button" disabled={busy}>
            Enable administration
          </button>
        </form>
      )}
      {status.roles.length > 0 && (
        <>
          <nav className="workspace-tabs" aria-label="Administration sections">
            {(
              [
                ['assets', 'Assets & issuance', 'ASSET_ADMIN'],
                ['networks', 'Networks', 'ASSET_ADMIN'],
                ['demo', 'Demo data', 'DEMO_OPERATOR'],
                ['access', 'Access', 'ACCESS_ADMIN'],
                ['audit', 'Audit', 'AUDITOR'],
              ] as const
            )
              .filter((item) => status.roles.includes(item[2]))
              .map(([id, label]) => (
                <button
                  key={id}
                  className={tab === id ? 'selected' : ''}
                  aria-pressed={tab === id}
                  onClick={() => {
                    setTab(id);
                    if (fragment) window.location.hash = `#/admin/${id}`;
                  }}
                >
                  {label}
                </button>
              ))}
            {status.roles.some((role) =>
              ['ASSET_ADMIN', 'ACCESS_ADMIN', 'AUDITOR'].includes(role),
            ) && (
              <button
                className={tab === 'policies' ? 'selected' : ''}
                aria-pressed={tab === 'policies'}
                onClick={() => {
                  setTab('policies');
                  if (fragment) window.location.hash = '#/admin/policies';
                }}
              >
                Configuration
              </button>
            )}
            {status.roles.some((role) => ['ASSET_ADMIN', 'ACCESS_ADMIN'].includes(role)) && (
              <button
                className={tab === 'requests' ? 'selected' : ''}
                aria-pressed={tab === 'requests'}
                onClick={() => {
                  setTab('requests');
                  if (fragment) window.location.hash = '#/admin/requests';
                }}
              >
                Requests
              </button>
            )}
            {status.roles.includes('AUDITOR') && (
              <button
                className={tab === 'operations' ? 'selected' : ''}
                aria-pressed={tab === 'operations'}
                onClick={() => {
                  setTab('operations');
                  if (fragment) window.location.hash = '#/admin/operations';
                }}
              >
                Operations
              </button>
            )}
          </nav>
          {status.roles.some((role) =>
            ['ASSET_ADMIN', 'ACCESS_ADMIN', 'AUDITOR'].includes(role),
          ) && (
            <div hidden={tab !== 'policies'}>
              <ConfigurationPanel
                user={user}
                roles={status.roles}
                active={active && tab === 'policies'}
                onChanged={onChanged}
                onSessionExpired={onSessionExpired}
              />
            </div>
          )}
          {status.roles.some((role) => ['ASSET_ADMIN', 'ACCESS_ADMIN'].includes(role)) && (
            <div hidden={tab !== 'requests'}>
              <RequestReviewPanel
                user={user}
                roles={status.roles}
                active={active && tab === 'requests'}
                onChanged={onChanged}
                onSessionExpired={onSessionExpired}
              />
            </div>
          )}
          {status.roles.includes('AUDITOR') && (
            <div hidden={tab !== 'operations'}>
              <OperationsPanel
                user={user}
                active={active && tab === 'operations'}
                fragment={fragment}
                onSessionExpired={onSessionExpired}
              />
            </div>
          )}
          {status.roles.includes('ASSET_ADMIN') && (
            <div hidden={tab !== 'networks'}>
              <NetworkAdminPanel
                user={user}
                onChanged={onChanged}
                onSessionExpired={onSessionExpired}
              />
            </div>
          )}
          {tab === 'assets' && status.roles.includes('ASSET_ADMIN') && (
            <div className="admin-grid">
              <div>
                <h3>Demo asset catalogue</h3>
                <p>Demo · simulated. No real monetary value.</p>
                <ul className="admin-assets">
                  {assets.map((asset) => (
                    <li key={asset.id}>
                      <strong>
                        {asset.displayName} ({asset.symbol})
                      </strong>
                      <small>
                        {asset.lifecycle} · precision {asset.precision} · revision {asset.revision}
                      </small>
                      <button className="secondary-button" onClick={() => edit(asset)}>
                        Manage {asset.code}
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  className="secondary-button"
                  onClick={() => {
                    setEditing(null);
                    setDraft({
                      code: '',
                      symbol: '',
                      displayName: '',
                      precision: 2,
                      supplyCap: '1000000.00',
                      minimum: '0.01',
                      maximum: '1000000.00',
                      reason: '',
                    });
                  }}
                >
                  New demo asset
                </button>
                <form
                  className="admin-form"
                  onSubmit={(event) =>
                    submit(event, async () => {
                      if (editing) return;
                      await walletWrite(user.id, 'v2/admin/assets', draft);
                      setNotice('Draft created. Select it to verify and activate.');
                    })
                  }
                >
                  <h3>{editing ? `Manage ${editing.code}` : 'Create a demo asset'}</h3>
                  <fieldset disabled={busy}>
                    <label>
                      Asset code
                      <input
                        required
                        value={draft.code}
                        maxLength={16}
                        disabled={!!editing}
                        onChange={(event) =>
                          setDraft({ ...draft, code: event.target.value.toUpperCase() })
                        }
                      />
                    </label>
                    <label>
                      Symbol
                      <input
                        required
                        value={draft.symbol}
                        maxLength={12}
                        disabled={!!editing}
                        onChange={(event) =>
                          setDraft({ ...draft, symbol: event.target.value.toUpperCase() })
                        }
                      />
                    </label>
                    <label>
                      Asset name
                      <input
                        required
                        value={draft.displayName}
                        maxLength={80}
                        onChange={(event) =>
                          setDraft({ ...draft, displayName: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      Decimal places
                      <input
                        type="number"
                        min="0"
                        max="8"
                        required
                        value={draft.precision}
                        disabled={!!editing}
                        onChange={(event) =>
                          setDraft({ ...draft, precision: Number(event.target.value) })
                        }
                      />
                    </label>
                    <label>
                      Supply cap
                      <input
                        required
                        value={draft.supplyCap}
                        onChange={(event) => setDraft({ ...draft, supplyCap: event.target.value })}
                      />
                    </label>
                    <label>
                      Minimum transfer
                      <input
                        required
                        value={draft.minimum}
                        onChange={(event) => setDraft({ ...draft, minimum: event.target.value })}
                      />
                    </label>
                    <label>
                      Maximum transfer
                      <input
                        required
                        value={draft.maximum}
                        onChange={(event) => setDraft({ ...draft, maximum: event.target.value })}
                      />
                    </label>
                    <label>
                      Asset change reason
                      <input
                        required
                        minLength={3}
                        maxLength={200}
                        value={draft.reason}
                        onChange={(event) => setDraft({ ...draft, reason: event.target.value })}
                      />
                    </label>
                    {editing ? (
                      <>
                        <p>
                          Identity and precision are locked. Activation verifies the demo policy and
                          enables sending.
                        </p>
                        <div className="transfer-actions">
                          {(['ACTIVE', 'PAUSED', 'ARCHIVED'] as const).map((state) => (
                            <button
                              type="button"
                              className="secondary-button"
                              key={state}
                              disabled={busy || draft.reason.trim().length < 3}
                              onClick={() =>
                                void perform(async () => {
                                  const { asset } = await walletWrite<{ asset: AssetV2 }>(
                                    user.id,
                                    `v2/admin/assets/${editing.id}`,
                                    {
                                      displayName: draft.displayName,
                                      supplyCap: draft.supplyCap,
                                      minimum: draft.minimum,
                                      maximum: draft.maximum,
                                      reason: draft.reason,
                                      lifecycle: state,
                                    },
                                    { revision: editing.revision },
                                  );
                                  edit(asset);
                                  setNotice(`Asset ${state.toLowerCase()}.`);
                                })
                              }
                            >
                              {state === 'ACTIVE'
                                ? 'Verify & activate'
                                : state === 'PAUSED'
                                  ? 'Pause asset'
                                  : 'Archive asset'}
                            </button>
                          ))}
                        </div>
                      </>
                    ) : (
                      <button className="primary-button">Create draft</button>
                    )}
                  </fieldset>
                </form>
              </div>
              <form
                className="admin-form"
                onSubmit={(event) =>
                  submit(event, async () => {
                    const result = await walletWrite<{ quantity: string }>(
                      user.id,
                      'v2/admin/issuances',
                      issue,
                    );
                    setNotice(`Issued ${result.quantity} demo units. Balances refreshed.`);
                    setIssue({ ...issue, quantity: '', key: crypto.randomUUID() });
                  })
                }
              >
                <h3>Issue demo units</h3>
                <p>Issuance creates a balanced ledger entry and a custody root.</p>
                <fieldset disabled={busy}>
                  <label>
                    Issuance asset
                    <select
                      required
                      value={issue.assetId}
                      onChange={(event) => setIssue({ ...issue, assetId: event.target.value })}
                    >
                      <option value="">Choose an active asset</option>
                      {assets
                        .filter((asset) => asset.lifecycle === 'ACTIVE')
                        .map((asset) => (
                          <option key={asset.id} value={asset.id}>
                            {asset.code}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Recipient handle
                    <input
                      required
                      value={issue.handle}
                      onChange={(event) => setIssue({ ...issue, handle: event.target.value })}
                    />
                  </label>
                  <label>
                    Issuance quantity
                    <input
                      required
                      value={issue.quantity}
                      onChange={(event) => setIssue({ ...issue, quantity: event.target.value })}
                    />
                  </label>
                  <label>
                    Issuance reason
                    <input
                      required
                      minLength={3}
                      value={issue.reason}
                      onChange={(event) => setIssue({ ...issue, reason: event.target.value })}
                    />
                  </label>
                  <button className="primary-button">Issue demo units</button>
                </fieldset>
              </form>
            </div>
          )}
          {tab === 'demo' && status.roles.includes('DEMO_OPERATOR') && (
            <div className="admin-form">
              <h3>Repeatable demo data</h3>
              {seedState && (
                <p role="status">
                  Run state: {seedState.state.toLowerCase().replaceAll('_', ' ')} ·{' '}
                  {seedState.operations} operations.{' '}
                  {seedState.resumeAfter &&
                    `An active run holds its lease until ${new Date(seedState.resumeAfter).toLocaleTimeString()}.`}
                </p>
              )}
              <p>
                Create synthetic registered peers, DEMO and DETH balances, and custody history.
                Reruns preserve spending.
              </p>
              {!status.demoEnabled ? (
                <p>Demo data is unavailable on this target.</p>
              ) : (
                <>
                  <form
                    onSubmit={(event) =>
                      submit(event, async () => {
                        const next = await walletWrite<SeedPreview>(
                          user.id,
                          'v2/admin/seed/preview',
                          profile,
                        );
                        setPreview(next);
                      })
                    }
                  >
                    <fieldset disabled={busy}>
                      <label>
                        Synthetic user count
                        <input
                          type="number"
                          required
                          min="2"
                          max="100"
                          value={profile.userCount}
                          onChange={(event) => {
                            setPreview(null);
                            setProfile({ ...profile, userCount: Number(event.target.value) });
                          }}
                        />
                      </label>
                      <label>
                        Transfer history depth
                        <input
                          type="number"
                          required
                          min="0"
                          max="100"
                          value={profile.transferDepth}
                          onChange={(event) => {
                            setPreview(null);
                            setProfile({ ...profile, transferDepth: Number(event.target.value) });
                          }}
                        />
                      </label>
                      <button className="secondary-button">Preview demo data</button>
                    </fieldset>
                  </form>
                  {preview && (
                    <form
                      onSubmit={(event) =>
                        submit(event, async () => {
                          const result = await walletWrite<{
                            alreadyComplete: boolean;
                            operations: number;
                          }>(
                            user.id,
                            'v2/admin/seed/run',
                            { previewId: preview.id, password },
                            { timeout: 180000 },
                          );
                          setPassword('');
                          setNotice(
                            result.alreadyComplete
                              ? 'Demo run already completed. Existing spending is preserved.'
                              : `Demo data ready. ${result.operations} operations completed.`,
                          );
                        })
                      }
                    >
                      <h4>
                        Preview: {preview.users.length} peers · {preview.transferCount} transfers
                      </h4>
                      <p>Each peer receives 1000.00 DEMO and 2.00000000 DETH once.</p>
                      <ul>
                        {preview.users.map((peer) => (
                          <li key={peer.handle}>
                            @{peer.handle} · {peer.email}
                          </li>
                        ))}
                      </ul>
                      <p>
                        Use the password below to sign in to these synthetic accounts. Existing
                        matching accounts require their original password.
                      </p>
                      <label>
                        Demo account password
                        <input
                          type="password"
                          minLength={12}
                          maxLength={128}
                          autoComplete="new-password"
                          required
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                        />
                      </label>
                      <button className="primary-button" disabled={busy}>
                        Run or resume demo data
                      </button>
                    </form>
                  )}
                </>
              )}
            </div>
          )}
          {tab === 'access' && status.roles.includes('ACCESS_ADMIN') && (
            <div className="admin-form">
              <h3>Access grants</h3>
              <ul>
                {grants.map((grant) => (
                  <li key={grant.id}>
                    @{grant.handle} · {grant.role} · {grant.status}
                  </li>
                ))}
              </ul>
              <form
                onSubmit={(event) =>
                  submit(event, async () => {
                    const current = grants.find(
                      (grant) => grant.handle === role.handle && grant.role === role.role,
                    );
                    await walletWrite(user.id, 'v2/admin/roles', {
                      ...role,
                      revision: current?.revision ?? null,
                    });
                    setNotice('Access grant updated.');
                  })
                }
              >
                <fieldset disabled={busy}>
                  <label>
                    User handle
                    <input
                      required
                      value={role.handle}
                      onChange={(event) => setRole({ ...role, handle: event.target.value })}
                    />
                  </label>
                  <label htmlFor="administrator-grant-role">Role</label>
                  <select
                    id="administrator-grant-role"
                    value={role.role}
                    onChange={(event) =>
                      setRole({ ...role, role: event.target.value as WalletRole })
                    }
                  >
                    {['ASSET_ADMIN', 'DEMO_OPERATOR', 'AUDITOR', 'ACCESS_ADMIN'].map((name) => (
                      <option key={name}>{name}</option>
                    ))}
                  </select>
                  <label htmlFor="administrator-grant-status">Grant status</label>
                  <select
                    id="administrator-grant-status"
                    value={role.status}
                    onChange={(event) => setRole({ ...role, status: event.target.value })}
                  >
                    <option value="ACTIVE">Active</option>
                    <option value="REVOKED">Revoked</option>
                  </select>
                  <label>
                    Access change reason
                    <input
                      required
                      minLength={3}
                      value={role.reason}
                      onChange={(event) => setRole({ ...role, reason: event.target.value })}
                    />
                  </label>
                  <button className="primary-button">Update access</button>
                </fieldset>
              </form>
            </div>
          )}
          {tab === 'audit' && status.roles.includes('AUDITOR') && (
            <div>
              <h3>Configuration audit</h3>
              <ul className="admin-assets">
                {audit.map((entry) => (
                  <li key={entry.id}>
                    <strong>{entry.action}</strong>
                    <span>{entry.reason}</span>
                    <small>{new Date(entry.createdAt).toLocaleString()}</small>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      {busy && <p role="status">Applying changes...</p>}
      {notice && (
        <p className="admin-notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
