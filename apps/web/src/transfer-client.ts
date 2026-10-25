import type {
  CreateTransferRequest,
  CsrfResponse,
  PeerResponse,
  TransferResponse,
  TransferView,
  WalletAccount,
  WalletResponse,
} from '@p2p/contracts';

export function availableAssetId(accounts: WalletAccount[], current: string): string {
  return (
    accounts.find((account) => account.assetId === current && account.status === 'active')
      ?.assetId ??
    accounts.find((account) => account.status === 'active')?.assetId ??
    ''
  );
}

export interface IntentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
// Defer access: some browsers throw even when reading the sessionStorage property.
export const browserIntentStorage: IntentStorage = {
  getItem: (key) =>
    (globalThis as unknown as { sessionStorage: IntentStorage }).sessionStorage.getItem(key),
  setItem: (key, value) =>
    (globalThis as unknown as { sessionStorage: IntentStorage }).sessionStorage.setItem(key, value),
  removeItem: (key) =>
    (globalThis as unknown as { sessionStorage: IntentStorage }).sessionStorage.removeItem(key),
};
export interface TransferIntent {
  readonly version: 1;
  readonly userId: string;
  readonly key: string;
  readonly request: Readonly<CreateTransferRequest>;
  readonly transferId?: string;
}
export const INTENT_STORAGE_KEY = 'p2p.transfer.intent.v1';
const objectId = /^[a-f0-9]{24}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export function canonicalQuantity(value: string, precision: number): string {
  if (
    !Number.isInteger(precision) ||
    precision < 0 ||
    precision > 8 ||
    typeof value !== 'string' ||
    value.length > 30 ||
    !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)
  )
    throw new Error('Enter a positive decimal quantity.');
  const [whole = '', fraction = ''] = value.split('.');
  if (fraction.length > precision) throw new Error(`Use at most ${precision} decimal places.`);
  const scale = 10n ** BigInt(precision);
  const units = BigInt(whole) * scale + BigInt(fraction.padEnd(precision, '0') || '0');
  if (units <= 0n || units > 9223372036854775807n)
    throw new Error('Quantity is outside the supported range.');
  return precision === 0
    ? units.toString()
    : `${units / scale}.${(units % scale).toString().padStart(precision, '0')}`;
}

export function createIntent(
  userId: string,
  request: CreateTransferRequest,
  key: string = crypto.randomUUID(),
): TransferIntent {
  if (
    !objectId.test(userId) ||
    !objectId.test(request.recipientId) ||
    !objectId.test(request.assetId) ||
    userId === request.recipientId ||
    !uuid.test(key) ||
    typeof request.quantity !== 'string' ||
    request.quantity.length > 30 ||
    !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(request.quantity) ||
    !/[1-9]/.test(request.quantity)
  )
    throw new Error('Invalid transfer intent.');
  return Object.freeze({
    version: 1,
    userId,
    key: key.toLowerCase(),
    request: Object.freeze({ ...request }),
  });
}
export function clearIntent(storage: IntentStorage): void {
  try {
    storage.removeItem(INTENT_STORAGE_KEY);
  } catch {
    /* Restricted browser storage is already inaccessible. */
  }
}
export function saveIntent(storage: IntentStorage, intent: TransferIntent): void {
  storage.setItem(INTENT_STORAGE_KEY, JSON.stringify(intent));
}
export function restoreIntent(storage: IntentStorage, userId: string): TransferIntent | null {
  try {
    const value: unknown = JSON.parse(storage.getItem(INTENT_STORAGE_KEY) ?? 'null');
    if (!value) return null;
    if (
      typeof value !== 'object' ||
      !('version' in value) ||
      value.version !== 1 ||
      !('userId' in value) ||
      value.userId !== userId ||
      !('key' in value) ||
      typeof value.key !== 'string' ||
      !('request' in value) ||
      !value.request ||
      typeof value.request !== 'object'
    )
      throw new Error('Invalid stored intent.');
    const request = value.request as Record<string, unknown>;
    if (
      Object.keys(request).sort().join(',') !== 'assetId,quantity,recipientId' ||
      typeof request.recipientId !== 'string' ||
      typeof request.assetId !== 'string' ||
      typeof request.quantity !== 'string'
    )
      throw new Error('Invalid stored request.');
    const intent = createIntent(userId, request as unknown as CreateTransferRequest, value.key);
    if ('transferId' in value) {
      if (typeof value.transferId !== 'string' || !objectId.test(value.transferId))
        throw new Error('Invalid transfer ID.');
      return Object.freeze({ ...intent, transferId: value.transferId });
    }
    return intent;
  } catch {
    clearIntent(storage);
    return null;
  }
}

export function applyTransferResult(
  intent: TransferIntent,
  transfer: TransferView,
): { intent: TransferIntent; terminal: boolean } {
  if (
    !objectId.test(transfer.id) ||
    transfer.sender.id !== intent.userId ||
    transfer.recipient.id !== intent.request.recipientId ||
    transfer.asset.id !== intent.request.assetId ||
    canonicalQuantity(transfer.quantity, transfer.asset.precision) !==
      canonicalQuantity(intent.request.quantity, transfer.asset.precision) ||
    (intent.transferId && intent.transferId !== transfer.id) ||
    !['PENDING', 'COMMITTED', 'REJECTED'].includes(transfer.status)
  )
    throw new Error(
      'The transfer response did not match this request. Retry to check its outcome.',
    );
  return {
    intent: Object.freeze({ ...intent, transferId: transfer.id }),
    terminal: transfer.status !== 'PENDING',
  };
}
export function clearIntentOnSessionChange(
  storage: IntentStorage,
  previousUserId: string | null,
  nextUserId: string | null,
): void {
  if (!nextUserId || (previousUserId !== null && previousUserId !== nextUserId))
    clearIntent(storage);
  else restoreIntent(storage, nextUserId);
}
export class TransferApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
async function request<T>(path: string, init?: RequestInit, allowRejected = false): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/${path}`, {
      credentials: 'same-origin',
      ...init,
      signal: init?.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(12000)])
        : AbortSignal.timeout(12000),
    });
  } catch {
    throw new TransferApiError(
      0,
      'Connection interrupted. The outcome is unresolved; retry this same request.',
    );
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new TransferApiError(
      response.status === 401 ? 401 : 0,
      response.status === 401
        ? 'Your session has ended. Sign in again.'
        : 'Connection interrupted. The outcome is unresolved; retry this same request.',
    );
  }
  if (
    !response.ok &&
    !(
      allowRejected &&
      response.status === 422 &&
      data &&
      typeof data === 'object' &&
      'transfer' in data
    )
  ) {
    throw new TransferApiError(
      response.status,
      response.status === 401
        ? 'Your session has ended. Sign in again.'
        : data && typeof data === 'object' && 'message' in data && typeof data.message === 'string'
          ? data.message
          : 'Unable to complete the request. Retry to check the outcome.',
    );
  }
  return data as T;
}
export const walletApi = {
  accounts: (signal?: AbortSignal) => request<WalletResponse>('accounts', { signal }),
  peer: (handle: string, signal?: AbortSignal) =>
    request<PeerResponse>(`peers?handle=${encodeURIComponent(handle.trim())}`, { signal }),
  transfer: (id: string, signal?: AbortSignal) =>
    request<TransferResponse>(`transfers/${id}`, { signal }),
  async submit(intent: TransferIntent, signal?: AbortSignal): Promise<TransferResponse> {
    const { csrfToken } = await request<CsrfResponse>('auth/csrf', { signal });
    const current = await request<{ user: { id: string } }>('auth/me', { signal });
    if (current.user.id !== intent.userId)
      throw new TransferApiError(401, 'Your account changed. Sign in again before transferring.');
    return request<TransferResponse>(
      'transfers',
      {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
          'Idempotency-Key': intent.key,
        },
        body: JSON.stringify(intent.request),
      },
      true,
    );
  },
};
