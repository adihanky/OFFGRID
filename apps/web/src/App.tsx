import { useEffect, useState } from 'react';
import type { ReadinessResponse } from '@p2p/contracts';
import { AuthPanel } from './AuthPanel';

const modules = [
  ['01', 'Authentication', 'Your identity and secure access.'],
  ['02', 'Asset transfers', 'Send assets and review your transfer history.'],
  ['03', 'Transfer chain', 'Follow the verified history of each transfer.'],
  ['04', 'Peer chat', 'Keep conversations close to your transfers.'],
] as const;

export function App() {
  const [status, setStatus] = useState<'checking' | 'ready' | 'unavailable'>('checking');

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
    <main className="workspace">
      <header>
        <a className="brand" href="/" aria-label="Secure P2P home">
          <span className="brand-mark" aria-hidden="true">
            P
          </span>
          Secure P2P
        </a>
        <span className="phase">Your next connection starts here</span>
      </header>
      <div className="auth-layout">
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
        <AuthPanel />
      </div>
      <section className="modules" aria-label="Application modules">
        {modules.map(([number, title, description]) => (
          <article key={number}>
            <span className="module-number">{number}</span>
            <h2>{title}</h2>
            <p>{description}</p>
            <span className="module-state">{number === '01' ? 'Available' : 'Planned'}</span>
          </article>
        ))}
      </section>
      <footer>Development scaffold · Simulated assets</footer>
    </main>
  );
}
