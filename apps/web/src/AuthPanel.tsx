import { useEffect, useState, type FormEvent } from 'react';
import type { AuthUser } from '@p2p/contracts';
import { authApi, AuthApiError } from './auth';

export function AuthPanel({
  user,
  onUserChange,
}: {
  user: AuthUser | null;
  onUserChange: (user: AuthUser | null) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [administratorSetup, setAdministratorSetup] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const onAbort = () => {
      setLoading(false);
      setError('Unable to check your session. Please refresh and try again.');
    };
    controller.signal.addEventListener('abort', onAbort);
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    const url = new URL(window.location.href);
    const oauthError = url.searchParams.get('auth_error');
    if (oauthError) {
      setError(
        oauthError === 'account_exists'
          ? 'This email already has an account. Use your original sign-in method.'
          : 'Google sign-in did not finish. Please try again.',
      );
      url.searchParams.delete('auth_error');
      window.history.replaceState(null, '', url);
    }
    const identity = authApi
      .me(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) onUserChange(result.user);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted && failure instanceof AuthApiError && failure.status === 401)
          onUserChange(null);
        if (
          !controller.signal.aborted &&
          !(failure instanceof AuthApiError && failure.status === 401)
        )
          setError('Unable to check your session. Please refresh and try again.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    const providers = authApi
      .providers(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setGoogleEnabled(result.google);
      })
      .catch(() => {});
    void Promise.allSettled([identity, providers]).finally(() => window.clearTimeout(timeout));
    return () => {
      controller.signal.removeEventListener('abort', onAbort);
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [onUserChange]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const email = String(fields.get('email') ?? '');
    const password = String(fields.get('password') ?? '');
    const publicHandle = String(fields.get('publicHandle') ?? '');
    setBusy(true);
    setError('');
    try {
      const result =
        mode === 'signup'
          ? await authApi.signUp({ email, password, publicHandle })
          : await authApi.signIn({ email, password });
      onUserChange(result.user);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Sign-in failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  async function signOut() {
    setBusy(true);
    setError('');
    try {
      await authApi.signOut();
      setMode('signin');
      setAdministratorSetup(false);
      onUserChange(null);
    } catch (failure) {
      if (failure instanceof AuthApiError && failure.status === 401) onUserChange(null);
      else
        setError(failure instanceof Error ? failure.message : 'Sign-out failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className={`auth-panel${user ? ' account-summary' : ''}`}
      aria-labelledby="auth-title"
      aria-busy={busy || loading}
    >
      {loading ? (
        <>
          <h2 id="auth-title">Your account</h2>
          <p role="status">Checking your session...</p>
        </>
      ) : user ? (
        <>
          <div>
            <p className="eyebrow">YOUR WORKSPACE</p>
            <h2 id="auth-title">Welcome, {user.displayName}.</h2>
            <p className="auth-detail">
              {user.email} · <strong>@{user.publicHandle}</strong>
            </p>
          </div>
          <button className="primary-button" disabled={busy} onClick={() => void signOut()}>
            {busy ? 'Signing out...' : 'Sign out'}
          </button>
          <small>
            Signing out clears this tab’s editable draft. Submitted transfers remain recoverable in
            Activity.
          </small>
        </>
      ) : (
        <>
          <p className="eyebrow">WELCOME TO SECURE P2P</p>
          <h2 id="auth-title">
            {mode === 'signin' ? 'Sign in to your account' : 'Create your account'}
          </h2>
          {mode === 'signin' && (
            <p>
              <a href="#/recover">Recover account access</a>
            </p>
          )}
          {googleEnabled ? (
            <a className="google-button" href="/api/auth/google">
              Continue with Google
            </a>
          ) : (
            <button className="google-button" disabled>
              Google sign-in is currently unavailable
            </button>
          )}
          <div className="auth-divider">
            <span>or continue with email</span>
          </div>
          <form key={mode} onSubmit={(event) => void submit(event)}>
            <fieldset disabled={busy}>
              <label htmlFor="email">Email</label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                maxLength={254}
                required
              />
              {mode === 'signup' && (
                <>
                  <label htmlFor="publicHandle">Public handle</label>
                  <input
                    id="publicHandle"
                    name="publicHandle"
                    autoComplete="nickname"
                    minLength={3}
                    maxLength={24}
                    pattern="[a-zA-Z][a-zA-Z0-9_]{2,23}"
                    aria-describedby="handle-help"
                    required
                  />
                  <small id="handle-help">
                    3–24 letters, numbers, or underscores; start with a letter.
                  </small>
                </>
              )}
              <label htmlFor="password">Password</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                minLength={mode === 'signup' ? 12 : 1}
                maxLength={128}
                aria-describedby={mode === 'signup' ? 'password-help' : undefined}
                required
              />
              {mode === 'signup' && <small id="password-help">Use 12–128 characters.</small>}
              <button className="primary-button" type="submit">
                {busy ? 'Please wait...' : mode === 'signup' ? 'Create account' : 'Sign in'}
              </button>
            </fieldset>
          </form>
          <p className="auth-switch">
            {mode === 'signin' ? 'New here?' : 'Already have an account?'}{' '}
            <button
              disabled={busy}
              onClick={() => {
                setMode(mode === 'signin' ? 'signup' : 'signin');
                setError('');
              }}
            >
              {mode === 'signin' ? 'Create an account' : 'Sign in'}
            </button>
          </p>
          <details className="administrator-entry" open={administratorSetup}>
            <summary
              onClick={(event) => {
                event.preventDefault();
                setAdministratorSetup((open) => !open);
              }}
            >
              Set up administrator account
            </summary>
            <p>
              Create an account or sign in, then open Admin account. The first administrator needs
              the installation setup token. Additional administrators need a role grant from an
              existing access administrator.
            </p>
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => {
                setMode('signup');
                setError('');
              }}
            >
              Create administrator account
            </button>{' '}
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => {
                setMode('signin');
                setError('');
              }}
            >
              Use existing account
            </button>
            <p>Creating an account alone does not grant administrator access.</p>
          </details>
        </>
      )}
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
