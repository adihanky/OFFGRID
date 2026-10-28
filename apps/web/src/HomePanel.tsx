import type { WorkspaceOverview } from '@p2p/contracts';
import { useWalletResource } from './use-wallet-resource';
export function HomePanel({
  active,
  version,
  onSessionExpired,
}: {
  active: boolean;
  version: number;
  onSessionExpired: () => void;
}) {
  const resource = useWalletResource<WorkspaceOverview>(
    'v2/workspace',
    active,
    onSessionExpired,
    version,
  );
  const data = resource.data;
  const actions = {
    SEND: ['#/send', 'Send demo units'],
    RECEIVE: ['#/wallet', 'Receive demo units'],
    ACTIVITY: ['#/activity?status=PENDING&direction=SENT', 'Check pending transfers'],
    HELP: ['#/help', 'Open help'],
  } as const;
  return (
    <section className="wallet-section" aria-labelledby="home-title">
      <div className="wallet-heading">
        <div>
          <p className="eyebrow">DEMO · SIMULATED</p>
          <h2 id="home-title">Your workspace</h2>
        </div>
        <button className="secondary-button" disabled={resource.busy} onClick={resource.reload}>
          Refresh overview
        </button>
      </div>
      <p>
        Demo units have no monetary value. A server connection is required to complete transfers.
      </p>
      <p>
        <a href="#/wallet">Set up a connected testnet wallet</a> to receive free Sepolia ETH and
        send with your crypto wallet. The overview below tracks legacy demo activity.
      </p>
      {resource.busy && <p role="status">Checking your workspace…</p>}
      {resource.error && (
        <p role="alert">
          {resource.error} <a href="#/wallet">Open Wallet</a> or retry the overview.
        </p>
      )}
      {data && (
        <>
          {!!data.pendingCount && (
            <div className="admin-notice" role="status">
              <strong>
                {data.pendingCount} pending transfer{data.pendingCount === 1 ? '' : 's'}
              </strong>
              <p>Submitted transfers may still complete. Leaving this page does not cancel them.</p>
              <a href="#/activity?status=PENDING&direction=SENT">Find your original transfers</a>
            </div>
          )}
          <h3>Your next step</h3>
          <p>{data.capabilities.send.reason}</p>
          <a className="primary-button" href={actions[data.nextAction][0]}>
            {actions[data.nextAction][1]}
          </a>
          <dl className="custody-metadata">
            <dt>Application wallet</dt>
            <dd>{data.readiness.wallet.toLowerCase().replaceAll('_', ' ')}</dd>
            <dt>Supported assets</dt>
            <dd>{data.readiness.assets.toLowerCase()}</dd>
            <dt>Available balance</dt>
            <dd>{data.readiness.balance.toLowerCase()}</dd>
            <dt>Transfer recovery</dt>
            <dd>{data.readiness.recovery.toLowerCase()}</dd>
          </dl>
          {data.readiness.wallet === 'MIGRATION_REQUIRED' && (
            <p role="status">
              An operator must complete the existing-user wallet migration. Keep this account;
              registration or wallet setup will not backfill it. <a href="#/help">Get help</a>.
            </p>
          )}
          <p>
            Receive legacy demo units using @{data.receive.publicHandle}. For testnet ETH, use your
            verified crypto address on the Wallet page.
          </p>
          <div className="transfer-actions">
            <a href="#/wallet">Wallet and receive</a>
            <a href="#/activity">Activity and receipts</a>
            <a href="#/settings">Wallet settings</a>
            <a href="#/help">Help and requests</a>
          </div>
        </>
      )}
    </section>
  );
}
