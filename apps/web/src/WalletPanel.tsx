import { useEffect, useRef, useState, type FormEvent } from 'react';
import type {
  AuthUser,
  PublicPeer,
  RecipientResolutionView,
  TransferView,
  WalletAccount,
  WalletV2,
} from '@p2p/contracts';
import { availableAssetId, canonicalQuantity, TransferApiError } from './transfer-client';
import {
  applyWalletResult,
  clearWalletIntent,
  createV2Intent,
  restoreWalletIntent,
  saveWalletIntent,
  v2Api,
  WalletApiError,
  type WalletIntent,
} from './wallet-v2-client';
import { ActivityPanel } from './ActivityPanel';

interface Review {
  peer: PublicPeer;
  asset: WalletAccount;
  quantity: string;
  resolution: RecipientResolutionView;
}
const reasons: Record<string, string> = {
  INSUFFICIENT_BALANCE: 'Your available balance is too low.',
  RECIPIENT_UNAVAILABLE: 'This recipient cannot receive transfers.',
  SENDER_UNAVAILABLE: 'Your account cannot send transfers.',
  ACCOUNT_UNAVAILABLE: 'An account is unavailable for this transfer.',
  ASSET_UNAVAILABLE: 'This asset is unavailable for transfers.',
  BALANCE_LIMIT_EXCEEDED: 'The recipient cannot receive this quantity.',
  WALLET_UNAVAILABLE: 'A participant wallet is unavailable for this transfer.',
  LOT_LIMIT_EXCEEDED: 'This transfer needs more custody inputs than the current limit allows.',
  QUANTITY_LIMIT_EXCEEDED: "This quantity is outside the asset's current transfer limits.",
};

export function WalletPanel({
  user,
  onSessionExpired,
}: {
  user: AuthUser;
  onSessionExpired: () => void;
}) {
  const [accounts, setAccounts] = useState<WalletAccount[]>([]);
  const [wallet, setWallet] = useState<WalletV2 | null>(null);
  const [activityVersion, setActivityVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [walletFailed, setWalletFailed] = useState(false);
  const [error, setError] = useState('');
  const [handle, setHandle] = useState('');
  const [assetId, setAssetId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [review, setReview] = useState<Review | null>(null);
  const [intent, setIntent] = useState<WalletIntent | null>(() => restoreWalletIntent(user.id));
  const [result, setResult] = useState<TransferView | null>(null);
  const [busy, setBusy] = useState(false);
  const lifetime = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const polls = useRef(0);
  const selectedAsset = accounts.find(
    (account) => account.assetId === assetId && account.status === 'active',
  );

  function failure(error: unknown) {
    if (lifetime.current?.signal.aborted) return;
    if (error instanceof TransferApiError && error.status === 401) {
      clearWalletIntent();
      onSessionExpired();
    } else setError(error instanceof Error ? error.message : 'Unable to complete this request.');
  }
  async function refresh(signal: AbortSignal) {
    setLoading(true);
    try {
      const response = await v2Api.wallet(signal);
      if (!signal.aborted) {
        const balances: WalletAccount[] = response.wallet.holdings.map((holding) => ({
          assetId: holding.asset.id,
          code: holding.asset.symbol,
          displayName: holding.asset.displayName,
          precision: holding.asset.precision,
          balance: holding.balance,
          status:
            holding.status === 'AVAILABLE' && holding.asset.custodyEnabled !== false
              ? 'active'
              : 'disabled',
        }));
        setWallet(response.wallet);
        setAccounts(balances);
        setAssetId((current) =>
          availableAssetId(balances, current || response.wallet.preferredAssetId || ''),
        );
        setWalletFailed(false);
        setActivityVersion((value) => value + 1);
      }
    } catch (error) {
      if (!signal.aborted) setWalletFailed(true);
      throw error;
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    void refresh(controller.signal).catch((error: unknown) => {
      if (!controller.signal.aborted) failure(error);
    });
    return () => controller.abort();
    // This component is keyed by user ID; each identity has an isolated lifetime.
  }, []);

  async function resolveReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    const signal = lifetime.current!.signal;
    try {
      const asset = accounts.find(
        (account) => account.assetId === assetId && account.status === 'active',
      );
      if (!asset) throw new Error('Choose an available asset.');
      const exact = canonicalQuantity(quantity, asset.precision);
      if (!wallet) throw new Error('Refresh your wallet before reviewing.');
      const resolution = await v2Api.resolve(user.id, wallet.id, asset.assetId, handle, signal);
      const peer: PublicPeer = {
        id: resolution.recipient.userId,
        displayName: resolution.recipient.displayName,
        publicHandle: resolution.recipient.publicHandle,
      };
      if (!signal.aborted) setReview({ peer, asset, quantity: exact, resolution });
    } catch (error) {
      if (!signal.aborted) failure(error);
    } finally {
      inFlight.current = false;
      if (!signal.aborted) setBusy(false);
    }
  }
  async function reconcile(current: WalletIntent) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    const signal = lifetime.current!.signal;
    try {
      const response = await v2Api.outcome(current, signal);
      if (signal.aborted) return;
      const applied = applyWalletResult(current, response.transfer);
      setResult(response.transfer);
      if (applied.terminal) {
        clearWalletIntent();
        setIntent(null);
        await refresh(signal);
      } else {
        saveWalletIntent(applied.intent);
        setIntent(applied.intent);
      }
    } catch (error) {
      if (
        !signal.aborted &&
        error instanceof WalletApiError &&
        (error.status === 400 ||
          error.code === 'REVIEW_REQUIRED' ||
          error.code === 'WALLET_MIGRATION_REQUIRED')
      ) {
        clearWalletIntent();
        setIntent(null);
        setReview(null);
      }
      if (!signal.aborted) failure(error);
    } finally {
      inFlight.current = false;
      if (!signal.aborted) setBusy(false);
    }
  }
  function confirm() {
    if (!review || intent || inFlight.current) return;
    try {
      if (!wallet || Date.parse(review.resolution.expiresAt) <= Date.now()) {
        setReview(null);
        throw new Error('Review expired. Find and review the recipient again.');
      }
      const next = createV2Intent(
        user.id,
        {
          senderWalletId: wallet.id,
          recipientResolutionId: review.resolution.resolutionId,
          assetId: review.asset.assetId,
          quantity: review.quantity,
        },
        review.resolution,
      );
      saveWalletIntent(next);
      polls.current = 0;
      setIntent(next);
      void reconcile(next);
    } catch (error) {
      failure(error);
    }
  }
  useEffect(() => {
    if (!intent?.transferId || busy || polls.current >= 10) return;
    const timer = window.setTimeout(() => {
      polls.current += 1;
      void reconcile(intent);
    }, 2000);
    return () => window.clearTimeout(timer);
    // The frozen intent and busy state control one bounded polling sequence.
  }, [intent, busy]);

  return (
    <section className="wallet-section" aria-labelledby="wallet-title">
      <div className="wallet-heading">
        <div>
          <p className="eyebrow">DEMO · SIMULATED</p>
          <h2 id="wallet-title">Your wallet</h2>
        </div>
        <button
          className="secondary-button"
          disabled={busy || loading}
          onClick={() => {
            setError('');
            void refresh(lifetime.current!.signal).catch(failure);
          }}
        >
          Refresh balances
        </button>
      </div>
      <div className="wallet-setup-callout">
        <a className="secondary-button" href="#wallet-setup-title">
          Configure wallet
        </a>
        <a href="#asset-catalogue-title">Browse assets</a>
      </div>
      {wallet && !wallet.configured && (
        <p className="admin-notice">
          Your application wallet is ready. <a href="#wallet-setup-title">Finish wallet setup</a> to
          name it, select a default asset or connect an external crypto wallet.
        </p>
      )}
      {wallet && (
        <p className="wallet-identity">
          {wallet.displayName ?? 'My wallet'} · Wallet <code>{wallet.id}</code> ·{' '}
          {wallet.status === 'ACTIVE' ? 'Active' : 'Suspended'}
        </p>
      )}
      <p className="wallet-note">
        Demo assets have no real monetary value. Send to a registered wallet, even when its owner is
        offline.
      </p>
      {loading ? (
        <p role="status">Loading balances...</p>
      ) : walletFailed ? (
        <p role="status">Unable to load balances. Refresh balances to try again.</p>
      ) : accounts.length === 0 ? (
        <p role="status">
          No assets are configured yet. You can enter transfer details, but an asset must be
          configured before you can review a transfer. Refresh balances after setup.
        </p>
      ) : (
        <ul className="wallet-balances">
          {accounts.map((account) => (
            <li key={account.assetId}>
              <span>
                {account.displayName} <small>{account.code}</small>
              </span>
              <strong>{account.balance}</strong>
              <small>Demo · simulated</small>
              {account.status === 'disabled' && <small>Transfers unavailable</small>}
            </li>
          ))}
        </ul>
      )}
      <div className="transfer-panel" aria-busy={busy}>
        <h3>Send to a peer</h3>
        {!loading && !walletFailed && accounts.length > 0 && !selectedAsset && (
          <p role="status">
            No assets are available for transfers. Refresh balances to check again.
          </p>
        )}
        {intent ? (
          <div role="status" aria-live="polite">
            <p>
              Your transfer outcome is unresolved. It may still complete. Checking or retrying this
              request uses the same transfer identity.
            </p>
            <p>
              {intent.request.quantity} {result?.asset.code ?? review?.asset.code ?? 'units'} to{' '}
              {result?.recipient.publicHandle || review?.peer.publicHandle
                ? `@${result?.recipient.publicHandle ?? review?.peer.publicHandle}`
                : 'your previously confirmed recipient'}
            </p>
            {intent.transferId && (
              <p className="transfer-reference">Transfer {intent.transferId}</p>
            )}
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => void reconcile(intent)}
            >
              {busy ? 'Checking transfer...' : 'Check this transfer'}
            </button>
          </div>
        ) : result ? (
          <div role="status" aria-live="polite">
            <h4>{result.status === 'COMMITTED' ? 'Transfer complete' : 'Transfer rejected'}</h4>
            <p>
              {result.quantity} {result.asset.code} to @{result.recipient.publicHandle}
            </p>
            {result.rejectionCode && (
              <p>{reasons[result.rejectionCode] ?? 'This transfer could not be completed.'}</p>
            )}
            <p className="transfer-reference">Transfer {result.id}</p>
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => {
                setResult(null);
                setReview(null);
                setQuantity('');
                setError('');
              }}
            >
              Start another transfer
            </button>
          </div>
        ) : review ? (
          <div className="transfer-review">
            <h4>Review your transfer</h4>
            <dl>
              <dt>Recipient</dt>
              <dd>
                {review.peer.displayName} (@{review.peer.publicHandle})
              </dd>
              <dt>Wallet</dt>
              <dd>
                <code>{review.resolution.recipient.walletId}</code>
              </dd>
              <dt>Asset</dt>
              <dd>
                {review.asset.displayName} ({review.asset.code})
              </dd>
              <dt>Quantity</dt>
              <dd>{review.quantity}</dd>
            </dl>
            <p>The server checks your current balance when you confirm.</p>
            <p>Review expires at {new Date(review.resolution.expiresAt).toLocaleTimeString()}.</p>
            <div className="transfer-actions">
              <button className="secondary-button" disabled={busy} onClick={() => setReview(null)}>
                Edit transfer
              </button>
              <button className="primary-button" disabled={busy} onClick={confirm}>
                Confirm transfer
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={(event) => void resolveReview(event)}>
            <fieldset disabled={busy}>
              <label htmlFor="peer-handle">Recipient public handle</label>
              <input
                id="peer-handle"
                value={handle}
                onChange={(event) => setHandle(event.target.value)}
                maxLength={24}
                required
                autoComplete="off"
                placeholder="Public handle or wallet ID"
              />
              <label htmlFor="transfer-asset">Asset</label>
              <select
                id="transfer-asset"
                value={assetId}
                onChange={(event) => setAssetId(event.target.value)}
                required
                disabled={loading || walletFailed || !selectedAsset}
              >
                <option value="" disabled>
                  Choose an asset
                </option>
                {accounts.map((account) => (
                  <option
                    key={account.assetId}
                    value={account.assetId}
                    disabled={account.status === 'disabled'}
                  >
                    {account.displayName} ({account.code})
                  </option>
                ))}
              </select>
              <label htmlFor="transfer-quantity">Quantity</label>
              <input
                id="transfer-quantity"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                inputMode="decimal"
                maxLength={30}
                required
                aria-describedby="quantity-help"
              />
              <small id="quantity-help">
                Use a positive decimal quantity. Transfers require a server connection.
              </small>
              <button
                className="primary-button"
                type="submit"
                disabled={loading || walletFailed || !selectedAsset}
              >
                {busy ? 'Finding peer...' : 'Review transfer'}
              </button>
            </fieldset>
          </form>
        )}
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <ActivityPanel key={`${user.id}:${activityVersion}`} onSessionExpired={onSessionExpired} />
    </section>
  );
}
