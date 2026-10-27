import { useState } from 'react';
import type { AuthUser, SettingsView, SettingsRevision, WalletRole } from '@p2p/contracts';
import { useWalletLifetime, useWalletResource } from './use-wallet-resource';
import { walletRequest, walletWrite, WalletApiError } from './wallet-v2-client';
type Values = Record<string, number | boolean | string>;
interface Preview {
  revision: string;
  changes: Array<{ key: string; before: unknown; after: unknown }>;
  impact: string;
}
export function ConfigurationPanel({
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
  const resource = useWalletResource<{ settings: SettingsView[] }>(
    'v2/admin/settings',
    active,
    onSessionExpired,
  );
  const [search, setSearch] = useState('');
  return (
    <section aria-labelledby="configuration-title">
      <h3 id="configuration-title">Configuration overview</h3>
      <p>
        Supported settings show their owner, bounds and application timing. Infrastructure and
        unimplemented payment adapters remain installation concerns.
      </p>
      <label>
        Find a setting
        <input value={search} onChange={(event) => setSearch(event.target.value)} />
      </label>
      <div className="transfer-actions">
        <a href="#/settings">My wallet settings</a>
        <a href="#/admin/assets">Assets and issuance</a>
        <a href="#/admin/networks">Networks</a>
        <a href="#/admin/access">Access</a>
        <a href="#/admin/operations">Operations</a>
      </div>
      <button className="secondary-button" disabled={resource.busy} onClick={resource.reload}>
        Refresh configuration
      </button>
      {resource.error && <p role="alert">{resource.error}</p>}
      {resource.busy && <p role="status">Loading effective settings…</p>}
      {resource.data?.settings.map((setting) => (
        <div
          key={setting.scope}
          hidden={
            !`${setting.scope} ${setting.fields.map((field) => field.label).join(' ')}`
              .toLowerCase()
              .includes(search.toLowerCase())
          }
        >
          <SettingEditor
            user={user}
            setting={setting}
            editable={roles.includes(setting.ownerRole)}
            onPublished={() => {
              resource.reload();
              onChanged();
            }}
            onSessionExpired={onSessionExpired}
          />
        </div>
      ))}
      {resource.data && !resource.data.settings.length && (
        <p>
          Product policy needs ASSET_ADMIN and support policy needs ACCESS_ADMIN.{' '}
          <a href="#/help">Request access</a> or <a href="#/home">return Home</a>.
        </p>
      )}
    </section>
  );
}
function SettingEditor({
  user,
  setting,
  editable,
  onPublished,
  onSessionExpired,
}: {
  user: AuthUser;
  setting: SettingsView;
  editable: boolean;
  onPublished: () => void;
  onSessionExpired: () => void;
}) {
  const lifetime = useWalletLifetime();
  const [values, setValues] = useState<Values>(() => ({ ...setting.values }));
  const [baseRevision, setBaseRevision] = useState(setting.revision),
    [reason, setReason] = useState(''),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null),
    [command, setCommand] = useState<{ body: unknown; revision: string } | null>(null),
    [historyOpen, setHistoryOpen] = useState(false);
  const history = useWalletResource<{ revisions: SettingsRevision[]; nextCursor: string | null }>(
    `v2/admin/settings/revisions?scope=${setting.scope}`,
    historyOpen,
    onSessionExpired,
  );
  function fail(error: unknown) {
    if (error instanceof WalletApiError && error.status === 401) onSessionExpired();
    else setError(error instanceof Error ? error.message : 'Configuration unavailable. Retry.');
  }
  async function validate() {
    const signal = lifetime.current.signal;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const read = await walletWrite<Preview>(
        user.id,
        'v2/admin/settings/validate',
        {
          scope: setting.scope,
          values,
        },
        { signal },
      );
      if (signal.aborted) return;
      if (read.revision !== baseRevision) {
        setPreview(null);
        setError(
          `Settings changed to revision ${read.revision}. Your entries are retained. Compare or load the latest values.`,
        );
        onPublished();
      } else setPreview(read);
    } catch (error) {
      if (!signal.aborted) fail(error);
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  async function publish() {
    const signal = lifetime.current.signal;
    if (!preview && !command) return;
    const original = command ?? {
      revision: baseRevision,
      body: { scope: setting.scope, values: { ...values }, reason, commandId: crypto.randomUUID() },
    };
    setCommand(original);
    setBusy(true);
    setError('');
    try {
      const result = await walletWrite<{ revision: string }>(
        user.id,
        'v2/admin/settings',
        original.body,
        { method: 'PATCH', revision: JSON.stringify(original.revision), signal },
      );
      const read = await walletRequest<{ settings: SettingsView[] }>('v2/admin/settings', {
        signal,
      });
      if (signal.aborted) return;
      const effective = read.settings.find((row) => row.scope === setting.scope);
      if (!effective)
        throw new WalletApiError(
          403,
          'Your configuration access changed. Refresh administration or open Help.',
        );
      setMessage(
        `Published revision ${result.revision}. Current effective revision ${effective.revision}; applied by authoritative reads.`,
      );
      setValues({ ...effective.values });
      setBaseRevision(effective.revision);
      setPreview(null);
      setCommand(null);
      setReason('');
      history.reload();
      onPublished();
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof WalletApiError && error.status === 412) {
        setCommand(null);
        setPreview(null);
        onPublished();
      }
      fail(error);
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  return (
    <form
      className="admin-form"
      onSubmit={(event) => {
        event.preventDefault();
        void validate();
      }}
    >
      <h4>{setting.scope === 'PRODUCT' ? 'Product policies' : 'Help and request availability'}</h4>
      <p>
        Owner: {setting.ownerRole}. Effective revision: {setting.revision}. Editing revision:{' '}
        {baseRevision}.
      </p>
      {setting.revision !== baseRevision && (
        <div className="admin-notice">
          <p>The current configuration differs from this form. Your entries are retained.</p>
          <dl>
            {Object.entries(setting.values).map(([key, value]) => (
              <div key={key}>
                <dt>{setting.fields.find((field) => field.key === key)?.label ?? key}</dt>
                <dd>
                  Current: {String(value)} · Yours: {String(values[key])}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      <fieldset disabled={!editable || busy || !!command}>
        {setting.fields.map((field) => (
          <label key={field.key}>
            {field.label}
            {field.type === 'boolean' ? (
              <input
                type="checkbox"
                checked={Boolean(values[field.key])}
                onChange={(event) => {
                  setValues((old) => ({ ...old, [field.key]: event.target.checked }));
                  setPreview(null);
                }}
              />
            ) : (
              <input
                type={field.type === 'integer' ? 'number' : 'url'}
                min={field.minimum}
                max={field.maximum}
                maxLength={field.type === 'url' ? 300 : undefined}
                value={String(values[field.key] ?? '')}
                required={field.type === 'integer'}
                onChange={(event) => {
                  setValues((old) => ({
                    ...old,
                    [field.key]:
                      field.type === 'integer' ? Number(event.target.value) : event.target.value,
                  }));
                  setPreview(null);
                }}
              />
            )}
            <small>
              {field.minimum !== undefined
                ? `${field.minimum}–${field.maximum} ${field.unit}. `
                : ''}
              {field.impact} Default: {String((setting.defaults as unknown as Values)[field.key])}.
            </small>
          </label>
        ))}
        <label>
          Reason for configuration change
          <input
            value={reason}
            minLength={3}
            maxLength={200}
            required
            onChange={(event) => {
              setReason(event.target.value);
              setPreview(null);
            }}
          />
        </label>
        {editable && (
          <button className="secondary-button" type="submit">
            Validate and review changes
          </button>
        )}
      </fieldset>
      {preview && (
        <div className="admin-notice">
          <h4>Review configuration publication</h4>
          <p>{preview.impact}</p>
          {preview.changes.length ? (
            <ul>
              {preview.changes.map((change) => (
                <li key={change.key}>
                  {setting.fields.find((field) => field.key === change.key)?.label}:{' '}
                  {String(change.before)} → {String(change.after)}
                </li>
              ))}
            </ul>
          ) : (
            <p>No value changes. Publishing still creates an audited revision.</p>
          )}
          <button
            className="primary-button"
            type="button"
            disabled={busy}
            onClick={() => void publish()}
          >
            Publish reviewed configuration
          </button>
          {!command && (
            <button
              className="secondary-button"
              type="button"
              disabled={busy}
              onClick={() => setPreview(null)}
            >
              Keep editing
            </button>
          )}
        </div>
      )}
      {command && error && (
        <div role="status">
          <p>
            The publication outcome needs checking. Retry the original command to reconcile it
            safely.
          </p>
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => void publish()}
          >
            Check original publication
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <button
        type="button"
        className="secondary-button"
        disabled={busy || !!command}
        onClick={() => {
          setValues({ ...setting.values });
          setBaseRevision(setting.revision);
          setPreview(null);
          setReason('');
          setError('');
        }}
      >
        Load latest values and discard this form
      </button>
      <details onToggle={(event) => setHistoryOpen(event.currentTarget.open)}>
        <summary>Configuration revision history</summary>
        {history.error && <p role="alert">{history.error}</p>}
        {history.data?.revisions.map((revision) => (
          <RevisionDetails key={revision.id} revision={revision} setting={setting} />
        ))}
        {history.data?.nextCursor && (
          <OlderRevisions
            key={history.data.nextCursor}
            setting={setting}
            cursor={history.data.nextCursor}
            active={historyOpen}
            onSessionExpired={onSessionExpired}
          />
        )}
      </details>
    </form>
  );
}
function RevisionDetails({
  revision,
  setting,
}: {
  revision: SettingsRevision;
  setting: SettingsView;
}) {
  return (
    <details>
      <summary>
        Revision {revision.revision} · {new Date(revision.createdAt).toLocaleString()} ·{' '}
        {revision.reason}
      </summary>
      <dl>
        {Object.entries(revision.values).map(([key, value]) => (
          <div key={key}>
            <dt>{setting.fields.find((field) => field.key === key)?.label ?? key}</dt>
            <dd>{String(value)}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
function OlderRevisions({
  setting,
  cursor,
  active,
  onSessionExpired,
}: {
  setting: SettingsView;
  cursor: string;
  active: boolean;
  onSessionExpired: () => void;
}) {
  const [open, setOpen] = useState(false);
  const resource = useWalletResource<{ revisions: SettingsRevision[]; nextCursor: string | null }>(
    `v2/admin/settings/revisions?scope=${setting.scope}&cursor=${cursor}`,
    active && open,
    onSessionExpired,
  );
  return (
    <div>
      <button type="button" className="secondary-button" onClick={() => setOpen(true)}>
        Load older configuration revisions
      </button>
      {resource.error && <p role="alert">{resource.error}</p>}
      {resource.data?.revisions.map((revision) => (
        <RevisionDetails key={revision.id} revision={revision} setting={setting} />
      ))}
      {resource.data?.nextCursor && (
        <OlderRevisions
          key={resource.data.nextCursor}
          setting={setting}
          cursor={resource.data.nextCursor}
          active={active && open}
          onSessionExpired={onSessionExpired}
        />
      )}
    </div>
  );
}
