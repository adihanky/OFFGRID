import type { WalletView } from './wallet-view';

export function WalletViewSwitch({
  view,
  onChange,
}: {
  view: WalletView;
  onChange: (view: WalletView) => void;
}) {
  return (
    <section className="wallet-view-switch" aria-label="Wallet view">
      <div className="wallet-view-buttons" role="group" aria-label="Choose wallet type">
        <button
          type="button"
          className={view === 'network' ? 'primary-button' : 'secondary-button'}
          aria-pressed={view === 'network'}
          onClick={() => onChange('network')}
        >
          Network / testnet wallets
        </button>
        <button
          type="button"
          className={view === 'legacy' ? 'primary-button' : 'secondary-button'}
          aria-pressed={view === 'legacy'}
          onClick={() => onChange('legacy')}
        >
          Legacy simulated wallets
        </button>
      </div>
      <p>
        {view === 'network'
          ? 'Network wallets use your connected crypto wallet. Sepolia funds are testnet assets.'
          : 'Legacy wallets contain simulated demo units, separate from network funds.'}
      </p>
    </section>
  );
}
