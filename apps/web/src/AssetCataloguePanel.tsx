import { useEffect, useState } from 'react';
import type { AssetV2 } from '@p2p/contracts';
import { walletRequest, WalletApiError } from './wallet-v2-client';
export function AssetCataloguePanel({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [assets, setAssets] = useState<AssetV2[]>([]),
    [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void walletRequest<{ assets: AssetV2[] }>('v2/assets', { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setAssets(result.assets);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          if (error instanceof WalletApiError && error.status === 401) onSessionExpired();
          else setError('Asset catalogue unavailable. Refresh the page to retry.');
        }
      });
    return () => controller.abort();
  }, [onSessionExpired]);
  return (
    <section className="wallet-section" aria-labelledby="asset-catalogue-title">
      <div className="wallet-heading">
        <div>
          <p className="eyebrow">ASSET CATALOGUE</p>
          <h2 id="asset-catalogue-title">Assets</h2>
        </div>
        <a className="secondary-button" href="#administration-title">
          Configure assets
        </a>
      </div>
      <p>
        View available assets here. Asset administrators can create, activate, pause and issue demo
        assets using the controls below.
      </p>
      {error && <p role="alert">{error}</p>}
      {!assets.length && !error && (
        <p>
          No assets have been activated.{' '}
          <a href="#administration-title">Open asset configuration</a> to create the first asset.
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
