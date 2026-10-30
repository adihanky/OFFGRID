import { TestnetBalance } from './TestnetBalance';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AssetV2, AuthUser, WalletChallenge, WalletNetwork, WalletV2 } from '@p2p/contracts';
import { v2Api, walletRequest, walletWrite, WalletApiError } from './wallet-v2-client';
import { connectExternalWallet, ethereumProvider } from './external-wallet-client';
import type { WalletView } from './wallet-view';
export function WalletSetupPanel({
  user,
  onChanged,
  onSessionExpired,
  showLegacyPreferences = false,
  refreshVersion = 0,
  view = 'network',
}: {
  view?: WalletView;
  showLegacyPreferences?: boolean;
  refreshVersion?: number;
  user: AuthUser;
  onChanged: () => void;
  onSessionExpired: () => void;
}) {
  const [wallet, setWallet] = useState<WalletV2 | null>(null);
  const [assets, setAssets] = useState<AssetV2[]>([]);
  const [networks, setNetworks] = useState<WalletNetwork[]>([]);
  const [displayName, setDisplayName] = useState('My wallet');
  const [preferredAssetId, setPreferredAssetId] = useState('');
  const [networkId, setNetworkId] = useState('');
  const [address, setAddress] = useState('');
  const [challenge, setChallenge] = useState<WalletChallenge | null>(null);
  const [signature, setSignature] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lifetime = useRef<AbortController | null>(null),
    running = useRef(false);
  const selected = networks.find((network) => network.id === networkId);
  function fail(error: unknown) {
    if (error instanceof WalletApiError && error.status === 401) onSessionExpired();
    else setError(error instanceof Error ? error.message : 'Wallet setup failed.');
  }
  async function load(signal?: AbortSignal) {
    const [own, catalogue, supported] = await Promise.all([
      v2Api.wallet(signal),
      walletRequest<{ assets: AssetV2[] }>('v2/assets', { signal }),
      walletRequest<{ networks: WalletNetwork[] }>('v2/networks', { signal }),
    ]);
    if (signal?.aborted) return;
    setWallet(own.wallet);
    setDisplayName(own.wallet.displayName ?? 'My wallet');
    setPreferredAssetId(own.wallet.preferredAssetId ?? '');
    setAssets(catalogue.assets);
    setNetworks(supported.networks);
    setNetworkId((current) =>
      supported.networks.some((network) => network.id === current)
        ? current
        : (supported.networks[0]?.id ?? ''),
    );
  }
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    void load(controller.signal).catch((error: unknown) => {
      if (!controller.signal.aborted) fail(error);
    });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!refreshVersion) return;
    const controller = new AbortController();
    void Promise.all([
      walletRequest<{ networks: WalletNetwork[] }>('v2/networks', { signal: controller.signal }),
      walletRequest<{ assets: AssetV2[] }>('v2/assets', { signal: controller.signal }),
    ])
      .then(([supported, catalogue]) => {
        if (!controller.signal.aborted) {
          setNetworks(supported.networks);
          setAssets(catalogue.assets);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) fail(error);
      });
    return () => controller.abort();
  }, [refreshVersion]);
  async function perform(work: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (error) {
      if (!lifetime.current?.signal.aborted) fail(error);
    } finally {
      running.current = false;
      if (!lifetime.current?.signal.aborted) setBusy(false);
    }
  }
  function submit(event: FormEvent, work: () => Promise<void>) {
    event.preventDefault();
    void perform(work);
  }
  async function refreshWalletState() {
    const signal = lifetime.current!.signal;
    const current = await v2Api.wallet(signal);
    if (signal.aborted) throw new DOMException('Account changed.', 'AbortError');
    setWallet(current.wallet);
  }
  const createChallenge = (address: string) =>
    walletWrite<WalletChallenge>(
      user.id,
      'v2/wallet/binding-challenges',
      { networkId, address },
      { signal: lifetime.current!.signal, timeout: 20000 },
    );
  const verify = (id: string, signature: string) =>
    walletWrite(
      user.id,
      'v2/wallet/bindings',
      { challengeId: id, signature },
      { signal: lifetime.current!.signal, timeout: 20000 },
    );
  return (
    <section className="wallet-section" aria-labelledby="wallet-setup-title">
      <div className="wallet-heading">
        <div>
          <p className="eyebrow">YOUR WALLET SETTINGS</p>
          <h2 id="wallet-setup-title">Set up your wallet</h2>
        </div>
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() => void perform(() => load(lifetime.current!.signal))}
        >
          Refresh wallet setup
        </button>
      </div>
      <p hidden={view !== 'network'}>
        Set up one connected wallet: choose Ethereum Sepolia, verify your address, then fund it with
        free testnet ETH. Your crypto wallet holds and signs for your funds.
      </p>
      {(wallet?.configured ||
        wallet?.bindings.some((binding) => binding.status === 'VERIFIED')) && (
        <p className="admin-notice" role="status">
          Wallet setup complete
        </p>
      )}
      <div className="wallet-setup-grid">
        {view === 'legacy' && (
          <details className="legacy-wallet-preferences" open={showLegacyPreferences}>
            <summary>Legacy demo wallet preferences</summary>
            <form
              className="admin-form"
              onSubmit={(event) =>
                submit(event, async () => {
                  if (!wallet) return;
                  const saved = await walletWrite<{ wallet: WalletV2 }>(
                    user.id,
                    'v2/wallet/settings',
                    {
                      displayName,
                      preferredAssetId: preferredAssetId || null,
                      revision: wallet.configurationRevision ?? '0',
                    },
                    { signal: lifetime.current!.signal },
                  );
                  if (lifetime.current!.signal.aborted) return;
                  setWallet(saved.wallet);
                  setDisplayName(saved.wallet.displayName ?? displayName);
                  setPreferredAssetId(saved.wallet.preferredAssetId ?? '');
                  onChanged();
                })
              }
            >
              <fieldset disabled={busy || !wallet}>
                <h3>Legacy demo preferences</h3>
                <label>
                  Wallet name
                  <input
                    required
                    maxLength={60}
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                  />
                </label>
                <label htmlFor="wallet-default-asset">Default asset</label>
                <select
                  id="wallet-default-asset"
                  value={preferredAssetId}
                  onChange={(event) => setPreferredAssetId(event.target.value)}
                >
                  <option value="">Choose automatically</option>
                  {assets
                    .filter((asset) => asset.lifecycle === 'ACTIVE')
                    .map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        {asset.displayName} ({asset.symbol})
                      </option>
                    ))}
                </select>
                <p>
                  Wallet ID: <code>{wallet?.id ?? 'Loading...'}</code>. Changing settings does not
                  create a second wallet or issue funds.
                </p>
                <button className="primary-button">Save wallet setup</button>
              </fieldset>
            </form>
          </details>
        )}
        <div className="admin-form" hidden={view !== 'network'}>
          <h3>Connect your testnet wallet</h3>
          <p>
            Prove control of an EVM address with a message signature. Linking is free and does not
            authorize token spending. After verification, fund and send Sepolia ETH from this same
            journey.
          </p>
          <fieldset disabled={busy || !wallet}>
            <label>
              Wallet network
              <select
                value={networkId}
                onChange={(event) => {
                  setNetworkId(event.target.value);
                  setChallenge(null);
                  setSignature('');
                }}
              >
                <option value="">Choose a network</option>
                {networks.map((network) => (
                  <option key={network.id} value={network.id}>
                    {network.displayName} · {network.environment.toLowerCase()} · chain{' '}
                    {network.chainId}
                  </option>
                ))}
              </select>
            </label>
            <p>
              Step 1: Enable the supported testnet. This does not require an already linked wallet
              or an administrator role.
            </p>
            <button
              type="button"
              disabled={busy}
              className="secondary-button"
              onClick={() =>
                void perform(async () => {
                  const result = await walletWrite<{ network: WalletNetwork }>(
                    user.id,
                    'v2/wallet/testnet',
                    {},
                    { signal: lifetime.current!.signal, timeout: 20000 },
                  );
                  await load(lifetime.current!.signal);
                  setNetworkId(result.network.id);
                  onChanged();
                })
              }
            >
              Use Ethereum Sepolia
            </button>
            <p>Step 2: Connect and sign the free ownership message.</p>
            <button
              type="button"
              className="primary-button"
              disabled={!selected || busy}
              onClick={() =>
                void perform(async () => {
                  await connectExternalWallet(
                    ethereumProvider(),
                    selected!,
                    createChallenge,
                    verify,
                    lifetime.current!.signal,
                  );
                  await refreshWalletState();
                  onChanged();
                })
              }
            >
              Connect crypto wallet
            </button>
            <details className="manual-proof">
              <summary>Use a manually signed ownership message</summary>
              <label>
                External EVM address
                <input
                  value={address}
                  maxLength={42}
                  onChange={(event) => {
                    setAddress(event.target.value);
                    setChallenge(null);
                  }}
                  placeholder="0x..."
                />
              </label>
              <button
                type="button"
                className="secondary-button"
                disabled={!selected || !address || busy}
                onClick={() =>
                  void perform(async () => {
                    setChallenge(await createChallenge(address));
                    setSignature('');
                  })
                }
              >
                Create ownership challenge
              </button>
              {challenge && (
                <>
                  <p>
                    Sign this exact message with {challenge.address}. It expires at{' '}
                    {new Date(challenge.expiresAt).toLocaleTimeString()}.
                  </p>
                  <pre className="ownership-message">{challenge.message}</pre>
                  <label>
                    Ownership signature
                    <textarea
                      value={signature}
                      maxLength={132}
                      onChange={(event) => setSignature(event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={!signature || busy}
                    onClick={() =>
                      void perform(async () => {
                        await verify(challenge.id, signature);
                        await refreshWalletState();
                        onChanged();
                      })
                    }
                  >
                    Verify and link address
                  </button>
                </>
              )}
            </details>
          </fieldset>
          <ul className="linked-wallets">
            {wallet?.bindings.map((binding) => (
              <li key={binding.id}>
                <strong>
                  {networks.find((network) => network.id === binding.networkId)?.displayName ??
                    'Configured network'}
                </strong>
                <code>{binding.address}</code>
                <span>{binding.status === 'VERIFIED' ? 'Ownership verified' : 'Revoked'}</span>
                {binding.status === 'VERIFIED' &&
                  networks.find((n) => n.id === binding.networkId) && (
                    <TestnetBalance
                      key={binding.id}
                      userId={user.id}
                      bindingId={binding.id}
                      walletAddress={binding.address}
                      network={networks.find((n) => n.id === binding.networkId)!}
                    />
                  )}
                {binding.status === 'VERIFIED' && (
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        await walletWrite(
                          user.id,
                          `v2/wallet/bindings/${binding.id}/revoke`,
                          {
                            revision: binding.revision,
                          },
                          { signal: lifetime.current!.signal },
                        );
                        await refreshWalletState();
                        onChanged();
                      })
                    }
                  >
                    Revoke external link
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p>
            Revocation preserves ownership history. An address cannot be reassigned to another
            registered wallet.
          </p>
        </div>
      </div>
      {busy && <p role="status">Updating wallet setup...</p>}
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
