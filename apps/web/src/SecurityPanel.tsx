import { useEffect, useState } from 'react';
import type { AuthUser } from '@p2p/contracts';
import { useWalletLifetime, useWalletResource } from './use-wallet-resource';
import { walletWrite, WalletApiError } from './wallet-v2-client';
import { authApi } from './auth';
interface RecoveryStatus {
  deliveryEnabled: boolean;
  message: string;
}
interface Session {
  id: string;
  current: boolean;
  createdAt: string;
  expiresAt: string;
  label: string;
}
export function SecurityPanel({
  user,
  active,
  onSessionExpired,
  onIdentityChanged,
}: {
  user: AuthUser;
  active: boolean;
  onSessionExpired: () => void;
  onIdentityChanged: (user: AuthUser) => void;
}) {
  const lifetime = useWalletLifetime();
  const capability = useWalletResource<RecoveryStatus>(
      'auth/recovery-status',
      active,
      onSessionExpired,
    ),
    sessions = useWalletResource<{ sessions: Session[] }>(
      'auth/sessions',
      active,
      onSessionExpired,
    );
  const [token, setToken] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  async function perform(work: (signal: AbortSignal) => Promise<void>) {
    const signal = lifetime.current.signal;
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await work(signal);
      if (!signal.aborted) sessions.reload();
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof WalletApiError && error.status === 401) onSessionExpired();
      else setError(error instanceof Error ? error.message : 'Security action unavailable. Retry.');
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  return (
    <section className="wallet-section" aria-labelledby="security-title">
      <div className="wallet-heading">
        <h2 id="security-title">Account security</h2>
        <button
          className="secondary-button"
          disabled={busy || sessions.busy}
          onClick={() => {
            sessions.reload();
            capability.reload();
          }}
        >
          Refresh security
        </button>
      </div>
      <p>
        Sign-in method: {user.signInMethod === 'google' ? 'Google' : 'Email and password'}. Email:{' '}
        {user.emailVerified ? 'verified' : 'not yet verified'}.
      </p>
      <p>
        Password recovery requires a verified email and an existing password. Google-only accounts
        keep Google sign-in. Verification does not link identities.
      </p>
      {capability.data && <p role="status">{capability.data.message}</p>}
      {capability.error && <p role="alert">{capability.error}</p>}
      {!user.emailVerified && (
        <div>
          <button
            className="secondary-button"
            disabled={busy || !capability.data?.deliveryEnabled}
            onClick={() =>
              void perform(async (signal) => {
                await walletWrite(user.id, 'auth/email-verification-requests', {}, { signal });
                if (signal.aborted) return;
                setMessage('Verification instructions requested. Check your configured inbox.');
              })
            }
          >
            Request email verification
          </button>
          <form
            className="admin-form"
            onSubmit={(event) => {
              event.preventDefault();
              void perform(async (signal) => {
                const result = await walletWrite<{ message: string }>(
                  user.id,
                  'auth/email-verifications',
                  { token },
                  { signal },
                );
                if (signal.aborted) return;
                setToken('');
                setMessage(result.message);
                const identity = await authApi.me(signal);
                if (!signal.aborted) onIdentityChanged(identity.user);
              });
            }}
          >
            <label>
              Verification code
              <input
                type="password"
                value={token}
                maxLength={43}
                minLength={43}
                required
                autoComplete="one-time-code"
                onChange={(event) => setToken(event.target.value)}
              />
            </label>
            <button className="secondary-button" disabled={busy || !token}>
              Verify my email
            </button>
          </form>
        </div>
      )}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
      <h3>Active sessions</h3>
      {sessions.error && <p role="alert">{sessions.error}</p>}
      {sessions.busy && <p role="status">Loading sessions…</p>}
      <button
        className="secondary-button"
        disabled={busy || !sessions.data}
        onClick={() =>
          void perform(async (signal) => {
            await walletWrite(user.id, 'auth/sessions/revoke-others', {}, { signal });
            if (signal.aborted) return;
            setMessage('Other sessions revoked. This session remains active.');
          })
        }
      >
        Revoke all other sessions
      </button>
      <ul className="admin-assets">
        {sessions.data?.sessions.map((session) => (
          <li key={session.id}>
            <strong>{session.current ? 'This browser session' : session.label}</strong>
            <span>Created {new Date(session.createdAt).toLocaleString()}</span>
            <span>Expires {new Date(session.expiresAt).toLocaleString()}</span>
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() =>
                void perform(async (signal) => {
                  await walletWrite(user.id, `auth/sessions/${session.id}/revoke`, {}, { signal });
                  if (signal.aborted) return;
                  if (session.current) onSessionExpired();
                  else setMessage('Session revoked.');
                })
              }
            >
              {session.current ? 'Revoke this session and sign out' : 'Revoke session'}
            </button>
          </li>
        ))}
      </ul>
      <p>
        At most 100 active sessions are listed. Revoke all other sessions also covers older
        sessions.
      </p>
      <div className="transfer-actions">
        <a href="#/settings">Wallet settings</a>
        <a href="#/home">Home</a>
        <a href="#/help">Help</a>
      </div>
    </section>
  );
}
export function PasswordRecoveryPanel({
  active,
  onResetComplete,
}: {
  active: boolean;
  onResetComplete?: () => void;
}) {
  const lifetime = useWalletLifetime();
  const [email, setEmail] = useState(''),
    [token, setToken] = useState(
      () => new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('token') ?? '',
    ),
    [password, setPassword] = useState(''),
    [usingCode, setUsingCode] = useState(() => window.location.hash.includes('token='));
  const [status, setStatus] = useState<RecoveryStatus | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    void authApi
      .recoveryStatus(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setStatus(value);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError('Recovery capability unavailable. Retry or return to sign-in.');
      });
    return () => controller.abort();
  }, [active, revision]);
  useEffect(() => {
    if (active && window.location.hash.includes('token=')) {
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${window.location.search}#/recover`,
      );
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }
  }, [active]);
  async function submit() {
    const signal = lifetime.current.signal;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = usingCode
        ? await authApi.resetPassword(token, password, signal)
        : await authApi.requestPasswordReset(email, signal);
      if (signal.aborted) return;
      setMessage(result.message);
      if (usingCode) {
        setToken('');
        setPassword('');
        onResetComplete?.();
      }
    } catch (error) {
      if (!signal.aborted)
        setError(error instanceof Error ? error.message : 'Recovery unavailable. Try again.');
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  return (
    <section className="auth-panel" aria-labelledby="password-recovery-title">
      <h2 id="password-recovery-title">Recover account access</h2>
      {status && <p role="status">{status.message}</p>}
      <p>
        Reset links expire after 15 minutes and can be used once. Only verified email accounts with
        a password are eligible. Continue using Google for a Google-only account.
      </p>
      <div className="transfer-actions">
        <button className="secondary-button" onClick={() => setUsingCode(false)} disabled={busy}>
          Request a reset link
        </button>
        <button className="secondary-button" onClick={() => setUsingCode(true)} disabled={busy}>
          Use a reset code
        </button>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <fieldset disabled={busy}>
          {usingCode ? (
            <>
              <label>
                Reset code
                <input
                  type="password"
                  value={token}
                  required
                  minLength={43}
                  maxLength={43}
                  autoComplete="one-time-code"
                  onChange={(event) => setToken(event.target.value)}
                />
              </label>
              <label>
                New password
                <input
                  type="password"
                  value={password}
                  required
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
            </>
          ) : (
            <>
              <label>
                Email for recovery
                <input
                  type="email"
                  value={email}
                  maxLength={254}
                  required
                  autoComplete="email"
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
            </>
          )}
          <button className="primary-button" disabled={!usingCode && !status?.deliveryEnabled}>
            {usingCode ? 'Set new password' : 'Request recovery instructions'}
          </button>
        </fieldset>
      </form>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <button
        className="secondary-button"
        disabled={busy}
        onClick={() => setRevision((value) => value + 1)}
      >
        Retry recovery availability
      </button>
      <p>
        <a href="#/signin">Return to sign-in</a>
      </p>
    </section>
  );
}
