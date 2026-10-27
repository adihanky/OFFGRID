import { useEffect, useState } from 'react';
import type { AssetV2, WalletRole } from '@p2p/contracts';
import { walletRequest, WalletApiError } from './wallet-v2-client';
export function AssetCataloguePanel({
  onSessionExpired,
  consumerMode = false,
  roles = [],
  refreshVersion = 0,
}: {
  onSessionExpired: () => void;
  consumerMode?: boolean;
  roles?: WalletRole[];
  refreshVersion?: number;
}) {
  const [assets, setAssets] = useState<AssetV2[]>([]),
    [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void walletRequest<{ assets: AssetV2[] }>('v2/assets', { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setAssets(result.assets);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          if (error instanceof WalletApiError && error.status === 401) onSessionExpired();
          else setError('Asset catalogue unavailable. Retry this section.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [onSessionExpired, refreshVersion, revision]);
  return (
    <section className="wallet-section" aria-labelledby="asset-catalogue-title">
      <div className="wallet-heading">
        <div>
          <p className="eyebrow">ASSET CATALOGUE</p>
          <h2 id="asset-catalogue-title">Assets</h2>
        </div>
        <a
          className="secondary-button"
          href={consumerMode && !roles.includes('ASSET_ADMIN') ? '#/help' : '#administration-title'}
        >
          {consumerMode
            ? roles.includes('ASSET_ADMIN')
              ? 'Manage assets'
              : 'Request asset access'
            : 'Configure assets'}
        </a>
      </div>
      <p>
        View available assets here. Asset administrators can create, activate, pause and issue demo
        assets in Administration.
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="transfer-actions">
        <button
          className="secondary-button"
          disabled={loading}
          onClick={() => setRevision((value) => value + 1)}
        >
          Retry asset catalogue
        </button>
        {consumerMode && <a href="#/home">Home</a>}
      </div>
      {loading && <p role="status">Loading assets...</p>}
      {!loading && !assets.length && !error && (
        <p>
          No assets have been activated.{' '}
          {consumerMode ? (
            <>
              <a href="#/help">Ask an asset administrator</a> to activate a supported asset.
            </>
          ) : (
            <>
              <a href="#administration-title">Open asset configuration</a> to create the first
              asset.
            </>
          )}
        </p>
      )}
      <ul className="admin-assets">
        {assets.map((asset) => (
          <li key={asset.id}>
            <strong>
              {asset.displayName} ({asset.symbol})
            </strong>
            <span>
              Demo · simulated · {asset.precision} decimal places · {asset.lifecycle.toLowerCase()}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
