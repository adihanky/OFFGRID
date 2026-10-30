import { OnChainActivityPanel } from './OnChainActivityPanel';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuthUser, WorkspaceOverview } from '@p2p/contracts';
import { consumerLinks, consumerSection } from './consumer-navigation';
import { HomePanel } from './HomePanel';
import { WalletPanel } from './WalletPanel';
import { TransferHistoryPanel } from './TransferHistoryPanel';
import { WalletSetupPanel } from './WalletSetupPanel';
import { AssetCataloguePanel } from './AssetCataloguePanel';
import { AdminPanel } from './AdminPanel';
import { RequestsPanel } from './RequestsPanel';
import { NotificationsPanel } from './NotificationsPanel';
import { SecurityPanel } from './SecurityPanel';
import { useWalletResource } from './use-wallet-resource';
import { WalletViewSwitch } from './WalletViewSwitch';
import { ChatPanel } from './ChatPanel';
import { chooseWalletView, walletSelectionFor, type WalletSelection } from './wallet-view';

export function UserWorkspace({
  user,
  fragment,
  onSessionExpired,
  onIdentityChanged,
}: {
  user: AuthUser;
  fragment: string;
  onSessionExpired: () => void;
  onIdentityChanged: (user: AuthUser) => void;
}) {
  const [version, setVersion] = useState(0),
    content = useRef<HTMLDivElement>(null);
  const [walletSelection, setWalletSelection] = useState<WalletSelection | null>(null);
  const walletView = walletSelectionFor(walletSelection, user.id);
  const section = consumerSection(fragment);
  const onChanged = useCallback(() => setVersion((value) => value + 1), []);
  const overview = useWalletResource<WorkspaceOverview>(
    'v2/workspace',
    true,
    onSessionExpired,
    version,
  );
  useEffect(() => {
    if (fragment) {
      content.current?.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }
  }, [fragment]);
  useEffect(() => {
    if (section === 'send') overview.reload();
  }, [section, overview.reload]);
  return (
    <>
      <nav className="primary-navigation" aria-label="Workspace navigation">
        {consumerLinks.map((link) => (
          <a
            key={link.hash}
            href={link.hash}
            aria-current={
              section === link.section ||
              (section === 'security' && link.section === 'setup') ||
              (section === 'notifications' && link.section === 'activity')
                ? 'page'
                : undefined
            }
          >
            {link.label}
          </a>
        ))}
        <a className="admin-account-link" href="#admin-account-title">
          Admin account
        </a>
      </nav>
      <div className="workspace-content" ref={content} tabIndex={-1}>
        <div hidden={section !== 'chat'}>
          <ChatPanel
            key={user.id}
            user={user}
            active={section === 'chat'}
            fragment={fragment}
            onSessionExpired={onSessionExpired}
          />
        </div>
        <section
          hidden={!['wallet', 'send', 'setup', 'activity'].includes(section)}
          aria-label="Wallet display options"
        >
          <WalletViewSwitch
            view={walletView.view}
            onChange={(view) =>
              setWalletSelection((current) => chooseWalletView(current, user.id, view))
            }
          />
        </section>
        <div hidden={section !== 'home'}>
          <HomePanel
            active={section === 'home'}
            version={version}
            onSessionExpired={onSessionExpired}
          />
          <p>
            <a href="#/notifications">Open notifications</a>
          </p>
        </div>
        <section hidden={section !== 'wallet' && section !== 'send' && section !== 'setup'}>
          <WalletSetupPanel
            user={user}
            onChanged={onChanged}
            onSessionExpired={onSessionExpired}
            showLegacyPreferences={section === 'setup'}
            view={walletView.view}
            refreshVersion={version}
          />
        </section>
        <div hidden={walletView.view !== 'legacy' || (section !== 'wallet' && section !== 'send')}>
          {walletView.legacyOpened && (
            <WalletPanel
              key={user.id}
              user={user}
              consumerMode
              view={section === 'send' ? 'send' : 'wallet'}
              refreshVersion={version}
              pendingCount={
                overview.busy || overview.error || !overview.data
                  ? null
                  : overview.data.pendingCount
              }
              onOutcomeChanged={onChanged}
              onSessionExpired={onSessionExpired}
            />
          )}
        </div>
        <div hidden={section !== 'activity'}>
          {walletView.view === 'network' ? (
            <OnChainActivityPanel
              userId={user.id}
              active={section === 'activity'}
              onSessionExpired={onSessionExpired}
            />
          ) : (
            <>
              <p>Legacy demo activity</p>
              <TransferHistoryPanel
                user={user}
                active={section === 'activity'}
                fragment={fragment}
                onSessionExpired={onSessionExpired}
              />
            </>
          )}
          <a href="#/notifications">Notifications</a>
        </div>
        <div hidden={section !== 'setup'}>
          <div className="wallet-section">
            <div className="transfer-actions">
              <a href="#/settings/security">Account security and sessions</a>
              <a href="#/home">Home</a>
              <a href="#/help">Help</a>
            </div>
          </div>
        </div>
        <div hidden={section !== 'assets'}>
          <AssetCataloguePanel
            onSessionExpired={onSessionExpired}
            consumerMode
            roles={overview.data?.roles ?? []}
            refreshVersion={version}
          />
        </div>
        <div hidden={section !== 'admin'}>
          <AdminPanel
            user={user}
            onChanged={onChanged}
            onSessionExpired={onSessionExpired}
            accountSetupRequested={fragment === '#admin-account-title'}
            fragment={fragment || '#/admin'}
            active={section === 'admin'}
          />
        </div>
        <div hidden={section !== 'help'}>
          <RequestsPanel
            user={user}
            active={section === 'help'}
            onSessionExpired={onSessionExpired}
          />
        </div>
        <div hidden={section !== 'notifications'}>
          <NotificationsPanel
            user={user}
            active={section === 'notifications'}
            onSessionExpired={onSessionExpired}
          />
        </div>
        <div hidden={section !== 'security'}>
          <SecurityPanel
            user={user}
            active={section === 'security'}
            onSessionExpired={onSessionExpired}
            onIdentityChanged={onIdentityChanged}
          />
        </div>
      </div>
    </>
  );
}
