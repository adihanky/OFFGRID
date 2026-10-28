import { useEffect, useState } from 'react';
import { formatUnits } from 'ethers';
import type { ChainHistory, WalletV2 } from '@p2p/contracts';
import { walletRequest, walletWrite, WalletApiError } from './wallet-v2-client';
export function OnChainActivityPanel({
  userId,
  active,
  onSessionExpired,
}: {
  userId: string;
  active: boolean;
  onSessionExpired: () => void;
}) {
  const [wallet, setWallet] = useState<WalletV2 | null>(null),
    [pages, setPages] = useState<Record<string, ChainHistory>>({}),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [version, setVersion] = useState(0);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setBusy(true);
    setError('');
    void walletRequest<{ wallet: WalletV2 }>('v2/wallet', { signal: controller.signal })
      .then(async ({ wallet }) => {
        const entries = await Promise.all(
          wallet.bindings.map(
            async (binding) =>
              [
                binding.id,
                await walletRequest<ChainHistory>(
                  `v2/wallet/bindings/${binding.id}/chain/history`,
                  { signal: controller.signal },
                ),
              ] as const,
          ),
        );
        if (!controller.signal.aborted) {
          setWallet(wallet);
          setPages(Object.fromEntries(entries));
        }
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        if (e instanceof WalletApiError && e.status === 401) onSessionExpired();
        else setError(e instanceof Error ? e.message : 'Chain history unavailable.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [active, userId, version]);
  return (
    <section className="wallet-section" aria-label="On-chain Activity">
      <h2>On-chain Activity</h2>
      <p>
        Native transactions, deployed contracts and imported ERC-20 transfer events. Records are
        separate from legacy simulated transfers. Confirmed means at least 12 blocks; reorganized
        records remain visible as evidence.
      </p>
      <button disabled={busy} onClick={() => setVersion((v) => v + 1)}>
        Reload indexed activity
      </button>
      {!wallet?.bindings.length && (
        <p>
          <a href="#/wallet">Connect a testnet wallet</a> to begin indexing.
        </p>
      )}
      {wallet?.bindings.map((binding) => {
        const page = pages[binding.id];
        return (
          <article key={binding.id}>
            <h3>{binding.address}</h3>
            <p>
              Last synchronized:{' '}
              {page?.lastSyncedAt ? new Date(page.lastSyncedAt).toLocaleString() : 'not yet'}.
              Indexed from {page?.startBlock ?? 'not started'} through{' '}
              {page?.indexedThrough ?? 'not started'}.
            </p>
            {page?.lastError && <p role="alert">{page.lastError}</p>}
            <button
              disabled={busy || binding.status !== 'VERIFIED'}
              onClick={() => {
                setBusy(true);
                setError('');
                void walletWrite(
                  userId,
                  `v2/wallet/bindings/${binding.id}/chain/sync`,
                  {},
                  { timeout: 120000 },
                )
                  .then(() => setVersion((v) => v + 1))
                  .catch((e: unknown) =>
                    setError(e instanceof Error ? e.message : 'Synchronization failed.'),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              Sync this address
            </button>
            <ul>
              {page?.entries.map((entry) => (
                <li key={entry.id}>
                  <strong>
                    {entry.status} · {entry.kind}
                  </strong>{' '}
                  · {formatUnits(entry.amountUnits, entry.decimals)} {entry.symbol}
                  <br />
                  <code>{entry.hash}</code>
                  <p>
                    {entry.from} → {entry.to ?? 'Contract deployment'} · Block{' '}
                    {entry.blockNumber ?? 'pending'} · {entry.confirmations} confirmations
                  </p>
                </li>
              ))}
            </ul>
            {page?.nextCursor && (
              <button
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void walletRequest<ChainHistory>(
                    `v2/wallet/bindings/${binding.id}/chain/history?cursor=${page.nextCursor}`,
                  )
                    .then((next) =>
                      setPages((old) => ({
                        ...old,
                        [binding.id]: { ...next, entries: [...page.entries, ...next.entries] },
                      })),
                    )
                    .catch((e: unknown) =>
                      setError(e instanceof Error ? e.message : 'History unavailable.'),
                    )
                    .finally(() => setBusy(false));
                }}
              >
                Older on-chain records
              </button>
            )}
          </article>
        );
      })}
      {error && <p role="alert">{error}</p>}
      {busy && <p role="status">Loading chain activity…</p>}
    </section>
  );
}
