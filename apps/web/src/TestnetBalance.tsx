import { ChainAssetsPanel } from './ChainAssetsPanel';
import { useEffect, useRef, useState } from 'react';
import type { WalletNetwork } from '@p2p/contracts';
import { walletRequest, walletWrite } from './wallet-v2-client';
import { ethereumProvider } from './external-wallet-client';
import { formatEth, sendTestnetEth } from './testnet-wallet-client';

export function TestnetBalance({
  bindingId,
  network,
  userId,
  walletAddress,
}: {
  bindingId: string;
  network: WalletNetwork;
  userId: string;
  walletAddress: string;
}) {
  const [balance, setBalance] = useState<{
    address: string;
    balanceWei: string;
    observedAt: string;
  } | null>(null);
  const sending = useRef(false);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [to, setTo] = useState(''),
    [quantity, setQuantity] = useState('');
  const key = `testnet-send:${userId}:${bindingId}`;
  const [transaction, setTransaction] = useState(
    () => localStorage.getItem(key) ?? sessionStorage.getItem(key) ?? '',
  );
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setBalance(null);
    void walletRequest<{ address: string; balanceWei: string; observedAt: string }>(
      `v2/wallet/bindings/${bindingId}/balance`,
      { signal: controller.signal },
      20000,
    )
      .then((result) => {
        if (!controller.signal.aborted) setBalance(result);
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : 'Balance unavailable');
      });
    return () => controller.abort();
  }, [bindingId, version]);
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);
  return (
    <div className="admin-form">
      <h3>Testnet ETH</h3>
      <p>
        {balance
          ? `${formatEth(balance.balanceWei)} ETH`
          : 'Balance unavailable until verified with the network.'}
      </p>
      {balance && (
        <p>
          Observed {new Date(balance.observedAt).toLocaleTimeString()}. Gas fees also require
          testnet ETH.
        </p>
      )}
      {network.chainId === '11155111' && (
        <p>
          <a
            href="https://ethereum.org/en/developers/docs/networks/#sepolia"
            target="_blank"
            rel="noreferrer"
          >
            Get free Sepolia ETH from a faucet
          </a>
          . Copy your verified address above. Testnet funds have no monetary value.
        </p>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setError('');
          setVersion((v) => v + 1);
        }}
      >
        Refresh on-chain balance
      </button>
      {network.chainId === '11155111' && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (sending.current || busy || transaction || !balance) return;
            sending.current = true;
            setBusy(true);
            setError('');
            void sendTestnetEth(
              ethereumProvider(),
              { from: balance.address, to, quantity, chainId: network.chainId },
              lifetime.current!.signal,
              () => {
                localStorage.setItem(key, 'unknown');
                setTransaction('unknown');
              },
            )
              .then(async (hash) => {
                localStorage.setItem(key, hash);
                setTransaction(hash);
                await walletWrite(
                  userId,
                  `v2/wallet/bindings/${bindingId}/chain/transactions`,
                  { hash },
                  { signal: lifetime.current!.signal, timeout: 20000 },
                );
              })
              .catch((e: unknown) => {
                setError(e instanceof Error ? e.message : 'Wallet request failed.');
              })
              .finally(() => {
                sending.current = false;
                setBusy(false);
              });
          }}
        >
          <fieldset disabled={busy || !!transaction || !balance}>
            <legend>Send Sepolia ETH</legend>
            <label>
              Recipient address
              <input required value={to} onChange={(e) => setTo(e.target.value)} maxLength={42} />
            </label>
            <label>
              Amount in ETH
              <input
                required
                inputMode="decimal"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </label>
            <p>
              Review the recipient, amount and network in your wallet before approving. Your wallet
              estimates gas.
            </p>
            <button type="submit">Review and send in wallet</button>
          </fieldset>
        </form>
      )}
      {transaction && (
        <div role="status">
          {transaction === 'unknown' ? (
            <p>
              Wallet request started; outcome is unconfirmed. Check your wallet activity before
              another send.
            </p>
          ) : (
            <p>
              Submitted (confirmation pending):{' '}
              <a
                href={`https://sepolia.etherscan.io/tx/${transaction}`}
                target="_blank"
                rel="noreferrer"
              >
                View transaction on Sepolia
              </a>
            </p>
          )}
          {transaction !== 'unknown' && (
            <button
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError('');
                void walletWrite(
                  userId,
                  `v2/wallet/bindings/${bindingId}/chain/transactions`,
                  { hash: transaction },
                  { signal: lifetime.current!.signal, timeout: 20000 },
                )
                  .catch((error: unknown) =>
                    setError(error instanceof Error ? error.message : 'Recording failed.'),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              Record native transaction hash
            </button>
          )}
          <button
            disabled={busy}
            onClick={() => {
              sessionStorage.removeItem(key);
              localStorage.removeItem(key);
              setTransaction('');
              setVersion((v) => v + 1);
            }}
          >
            I checked wallet activity; start a new send
          </button>
        </div>
      )}
      <ChainAssetsPanel
        bindingId={bindingId}
        network={network}
        userId={userId}
        address={walletAddress}
      />
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
