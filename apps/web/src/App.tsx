import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuthUser, ReadinessResponse } from '@p2p/contracts';
import { AuthPanel } from './AuthPanel';
import { browserIntentStorage, clearIntentOnSessionChange } from './transfer-client';
import { clearWalletIntent, restoreWalletIntent } from './wallet-v2-client';
import { clearSendDraft } from './send-draft';
import { UserWorkspace } from './UserWorkspace';
import { PasswordRecoveryPanel } from './SecurityPanel';

const modules = [
  ['01', 'Authentication', 'Your identity and secure access.'],
  ['02', 'Wallet and transfers', 'View your balances and send simulated assets to a peer.'],
  ['03', 'Activity and receipts', 'Find original outcomes and authorized transfer evidence.'],
  ['04', 'Peer chat', 'Keep conversations close to your transfers.'],
] as const;

export function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [fragment, setFragment] = useState(() => window.location.hash);
  const [authNotice, setAuthNotice] = useState('');
  const recoveryActive = /^#\/recover(?:\?|$)/.test(fragment);
  const currentUserId = useRef<string | null>(null);
  const onUserChange = useCallback((next: AuthUser | null) => {
    const previous = currentUserId.current;
    if (!next || (previous !== null && previous !== next.id)) {
      clearWalletIntent();
      clearSendDraft();
    } else restoreWalletIntent(next.id);
    clearIntentOnSessionChange(browserIntentStorage, currentUserId.current, next?.id ?? null);
    currentUserId.current = next?.id ?? null;
    if (!next && (previous !== null || !/^#\/recover(?:\?|$)/.test(window.location.hash))) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      setFragment('');
    }
    if (next) setAuthNotice('');
    setUser(next);
  }, []);
  const onSessionExpired = useCallback(() => onUserChange(null), [onUserChange]);
  const [status, setStatus] = useState<'checking' | 'ready' | 'unavailable'>('checking');

  useEffect(() => {
    const navigate = () => setFragment(window.location.hash);
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 6000);
    void fetch('/api/health/ready', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Service unavailable');
        const health = (await response.json()) as ReadinessResponse;
        if (active) setStatus(health.status === 'ready' ? 'ready' : 'unavailable');
      })
      .catch(() => {
        if (active) setStatus('unavailable');
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  return (
    <main className={`workspace${user ? ' signed-in' : ''}`}>
      <header>
        <a className="brand" href={user ? '#/home' : '#/signin'} aria-label="Secure P2P home">
          <span className="brand-mark" aria-hidden="true">
            P
          </span>
          Secure P2P
        </a>
        <span className="phase">
          {user ? 'Testnet wallet workspace' : 'Your next connection starts here'}
        </span>
      </header>
      <div className="auth-layout" hidden={recoveryActive}>
        <section className="intro" aria-labelledby="intro-title">
          <p className="eyebrow">PEER TO PEER / BUILT ON TRUST</p>
          <h1 id="intro-title">
            A secure connection.
            <br />
            For every transfer.
          </h1>
          <p className="description">
            Sign in to your Secure P2P account. Your identity is the first step toward asset
            transfers, a verified history, and conversations with your peers.
          </p>
          <div className={`connection ${status}`} role="status" aria-live="polite">
            <span className="status-dot" aria-hidden="true" />
            {status === 'checking' && 'Checking service connection...'}
            {status === 'ready' && 'API and database connected'}
            {status === 'unavailable' &&
              'Service unavailable. Check that the API and database are running.'}
          </div>
        </section>
        <AuthPanel user={user} onUserChange={onUserChange} />
      </div>
      {authNotice && <p role="status">{authNotice}</p>}
      {recoveryActive && (
        <PasswordRecoveryPanel
          active
          onResetComplete={() => {
            onUserChange(null);
            setAuthNotice(
              'Password updated. Previous sessions were revoked. Sign in with your new password.',
            );
            window.location.hash = '#/signin';
          }}
        />
      )}
      {user && !recoveryActive && (
        <UserWorkspace
          key={user.id}
          user={user}
          fragment={fragment}
          onSessionExpired={onSessionExpired}
          onIdentityChanged={onUserChange}
        />
      )}
      {!user && !recoveryActive && (
        <section className="modules" aria-label="Application modules">
          {modules.map(([number, title, description]) => (
            <article key={number}>
              <span className="module-number">{number}</span>
              <h2>{title}</h2>
              <p>{description}</p>
              <span className="module-state">{number === '04' ? 'Planned' : 'Available'}</span>
            </article>
          ))}
        </section>
      )}
      <footer>Secure P2P · Testnet funds and legacy demo assets</footer>
    </main>
  );
}
