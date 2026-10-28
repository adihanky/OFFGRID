import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AuthUser, WalletNetwork } from '@p2p/contracts';
import { walletRequest, walletWrite, WalletApiError } from './wallet-v2-client';
import { resumeNetworkEdits } from './network-admin-edits';
export function NetworkAdminPanel({
  user,
  onChanged,
  onSessionExpired,
}: {
  user: AuthUser;
  onChanged: () => void;
  onSessionExpired: () => void;
}) {
  const [networks, setNetworks] = useState<Array<WalletNetwork & { rpcUrl: string }>>([]);
  const [editing, setEditing] = useState<(WalletNetwork & { rpcUrl: string }) | null>(null);
  const [draft, setDraft] = useState({
    displayName: 'Ethereum Sepolia',
    chainId: '11155111',
    environment: 'TESTNET',
    rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com/',
    reason: '',
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const running = useRef(false);
  async function load(signal?: AbortSignal) {
    const result = await walletRequest<{ networks: Array<WalletNetwork & { rpcUrl: string }> }>(
      'v2/admin/networks',
      { signal },
    );
    if (!signal?.aborted) setNetworks(result.networks);
  }
  function fail(error: unknown) {
    if (error instanceof WalletApiError && error.status === 401) onSessionExpired();
    else setError(error instanceof Error ? error.message : 'Network configuration failed.');
  }
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch((error: unknown) => {
      if (!controller.signal.aborted) fail(error);
    });
    return () => controller.abort();
  }, []);
  async function perform(work: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
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
      running.current = false;
      setBusy(false);
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void perform(async () => {
      if (editing)
        await walletWrite(
          user.id,
          `v2/admin/networks/${editing.id}`,
          {
            displayName: draft.displayName,
            rpcUrl: draft.rpcUrl,
            revision: editing.revision,
            status: editing.status,
            reason: draft.reason,
          },
          { timeout: 20000 },
        );
      else await walletWrite(user.id, 'v2/admin/networks', draft, { timeout: 20000 });
      setEditing(null);
      setNotice('Network identity verified and configuration saved.');
    });
  }
  return (
    <div className="admin-grid" aria-label="Network configuration">
      <form className="admin-form" onSubmit={submit}>
        <h3 id="network-configuration-title">Configure wallet networks</h3>
        <p>
          Verify a testnet or guarded local RPC before users link addresses. This enables ownership
          proof; token payments remain unavailable.
        </p>
        <fieldset disabled={busy}>
          <label>
            Network name
            <input
              required
              maxLength={60}
              value={draft.displayName}
              onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}
            />
          </label>
          <label>
            Expected chain ID
            <input
              required
              disabled={!!editing}
              inputMode="numeric"
              value={draft.chainId}
              onChange={(event) => setDraft({ ...draft, chainId: event.target.value })}
            />
          </label>
          <label>
            Network environment
            <select
              disabled={!!editing}
              value={draft.environment}
              onChange={(event) => setDraft({ ...draft, environment: event.target.value })}
            >
              <option value="TESTNET">Testnet</option>
              <option value="LOCAL">Local development</option>
            </select>
          </label>
          <label>
            Public RPC URL
            <input
              required
              type="url"
              value={draft.rpcUrl}
              onChange={(event) => setDraft({ ...draft, rpcUrl: event.target.value })}
            />
          </label>
          <label>
            Network change reason
            <input
              required
              minLength={3}
              maxLength={200}
              value={draft.reason}
              onChange={(event) => setDraft({ ...draft, reason: event.target.value })}
            />
          </label>
          <p>
            Public RPC hosts must be approved by this installation. Credentials and API keys are not
            accepted in URLs.
          </p>
          <button className="primary-button">
            {editing ? 'Verify & save network' : 'Verify & add network'}
          </button>
          {editing && (
            <button type="button" className="secondary-button" onClick={() => setEditing(null)}>
              Create another network
            </button>
          )}
        </fieldset>
      </form>
      <div>
        <h3>Configured networks</h3>
        <ul className="admin-assets">
          {networks.map((network) => (
            <li key={network.id}>
              <strong>{network.displayName}</strong>
              <span>
                Chain {network.chainId} · {network.environment.toLowerCase()} ·{' '}
                {network.status.toLowerCase()}
              </span>
              <small>Genesis {network.genesisHash}</small>
              <small>Saved RPC {network.rpcUrl}</small>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setEditing(network);
                  setDraft({
                    displayName: network.displayName,
                    chainId: network.chainId,
                    environment: network.environment,
                    rpcUrl: network.rpcUrl,
                    reason: '',
                  });
                }}
              >
                Manage network {network.displayName}
              </button>
              <button
                className="secondary-button"
                disabled={busy || draft.reason.trim().length < 3}
                onClick={() =>
                  void perform(async () => {
                    await walletWrite(
                      user.id,
                      `v2/admin/networks/${network.id}`,
                      {
                        revision: network.revision,
                        status: network.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE',
                        reason: draft.reason,
                        ...resumeNetworkEdits(network, editing, draft),
                      },
                      { timeout: 20000 },
                    );
                    setEditing(null);
                    setNotice('Network availability updated.');
                  })
                }
              >
                {network.status === 'ACTIVE' ? 'Pause network' : 'Verify & resume network'}
              </button>
            </li>
          ))}
        </ul>
        {!networks.length && (
          <p>
            No networks configured. Add a verified provider to enable the external-wallet connection
            form.
          </p>
        )}
        {busy && <p role="status">Verifying network configuration...</p>}
        {notice && <p role="status">{notice}</p>}
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
