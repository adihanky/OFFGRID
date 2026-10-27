import { useCallback, useEffect, useRef, useState } from 'react';
import { walletRequest, WalletApiError } from './wallet-v2-client';
export function useWalletResource<T>(
  path: string,
  active: boolean,
  onSessionExpired: () => void,
  version = 0,
) {
  const [data, setData] = useState<T | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setBusy(true);
    setError('');
    void walletRequest<T>(path, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof WalletApiError && error.status === 401) onSessionExpired();
        else
          setError(
            error instanceof Error ? error.message : 'This section is unavailable. Retry below.',
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [path, active, onSessionExpired, version, revision]);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  return { data, busy, error, reload };
}
export function useWalletLifetime() {
  const lifetime = useRef(new AbortController());
  useEffect(() => {
    if (lifetime.current.signal.aborted) lifetime.current = new AbortController();
    const current = lifetime.current;
    return () => current.abort();
  }, []);
  return lifetime;
}
