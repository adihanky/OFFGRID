import type {
  ActivityPage,
  AdministrationStatus,
  RecipientResolutionView,
  SendIntentInput,
  SimulatedTransferV2View,
  TransferView,
  WalletV2,
} from '@p2p/contracts';
import {
  applyTransferResult,
  browserIntentStorage,
  canonicalQuantity,
  clearIntent,
  createIntent,
  restoreIntent,
  saveIntent,
  TransferApiError,
  walletApi,
  type IntentStorage,
  type TransferIntent,
} from './transfer-client.js';

export class WalletApiError extends TransferApiError {
  constructor(
    status: number,
    message: string,
    readonly code?: string,
  ) {
    super(status, message);
  }
}
export async function walletRequest<T>(
  path: string,
  init?: RequestInit,
  timeout = 12000,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/${path}`, {
      credentials: 'same-origin',
      ...init,
      signal: init?.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(timeout)])
        : AbortSignal.timeout(timeout),
    });
  } catch {
    throw new WalletApiError(
      0,
      'Connection interrupted. Retry the same request to check its outcome.',
    );
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new WalletApiError(
      response.status === 401 ? 401 : 0,
      'Unable to read the outcome. Retry the same request.',
    );
  }
  if (
    !response.ok &&
    !(response.status === 422 && data && typeof data === 'object' && 'transfer' in data)
  ) {
    const error = data as { message?: unknown; code?: unknown } | null;
    throw new WalletApiError(
      response.status,
      typeof error?.message === 'string' ? error.message : 'Request failed. Please retry.',
      typeof error?.code === 'string' ? error.code : undefined,
    );
  }
  return data as T;
}
export async function walletWrite<T>(
  userId: string,
  path: string,
  body: unknown,
  options: { key?: string; revision?: string; signal?: AbortSignal; timeout?: number } = {},
): Promise<T> {
  const signal = options.signal;
  const { csrfToken } = await walletRequest<{ csrfToken: string }>('auth/csrf', { signal });
  const { user } = await walletRequest<{ user: { id: string } }>('auth/me', { signal });
  if (user.id !== userId) throw new WalletApiError(401, 'Your account changed. Sign in again.');
  return walletRequest<T>(
    path,
    {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
        ...(options.key ? { 'Idempotency-Key': options.key } : {}),
        ...(options.revision ? { 'If-Match': options.revision } : {}),
      },
      body: JSON.stringify(body),
    },
    options.timeout,
  );
}
export interface V2Intent {
  readonly version: 2;
  readonly userId: string;
  readonly key: string;
  readonly request: Readonly<SendIntentInput>;
  readonly recipientId: string;
  readonly recipientWalletId: string;
  readonly transferId?: string;
}
export type WalletIntent = V2Intent | TransferIntent;
export const V2_STORAGE_KEY = 'p2p.transfer.intent.v2';
const oid = /^[a-f0-9]{24}$/;
export function createV2Intent(
  userId: string,
  request: SendIntentInput,
  resolution: RecipientResolutionView,
  key: string = crypto.randomUUID(),
): V2Intent {
  if (
    ![
      userId,
      request.senderWalletId,
      request.assetId,
      request.recipientResolutionId,
      resolution.recipient.userId,
      resolution.recipient.walletId,
    ].every((id) => oid.test(id)) ||
    userId === resolution.recipient.userId ||
    request.recipientResolutionId !== resolution.resolutionId ||
    resolution.destination.mode !== 'SIMULATED' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(key) ||
    typeof request.quantity !== 'string' ||
    request.quantity.length > 30 ||
    !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(request.quantity) ||
    !/[1-9]/.test(request.quantity)
  )
    throw new Error('Invalid reviewed intent.');
  return Object.freeze({
    version: 2,
    userId,
    key,
    request: Object.freeze({ ...request }),
    recipientId: resolution.recipient.userId,
    recipientWalletId: resolution.recipient.walletId,
  });
}
export function clearWalletIntent(storage: IntentStorage = browserIntentStorage) {
  clearIntent(storage);
  try {
    storage.removeItem(V2_STORAGE_KEY);
  } catch {
    /* Restricted storage. */
  }
}
export function saveWalletIntent(
  intent: WalletIntent,
  storage: IntentStorage = browserIntentStorage,
) {
  if (intent.version === 1) saveIntent(storage, intent);
  else storage.setItem(V2_STORAGE_KEY, JSON.stringify(intent));
}
export function restoreWalletIntent(
  userId: string,
  storage: IntentStorage = browserIntentStorage,
): WalletIntent | null {
  try {
    const value: unknown = JSON.parse(storage.getItem(V2_STORAGE_KEY) ?? 'null');
    if (value) {
      if (
        typeof value !== 'object' ||
        !('version' in value) ||
        value.version !== 2 ||
        !('userId' in value) ||
        value.userId !== userId
      )
        throw new Error();
      const stored = value as V2Intent;
      if (
        !stored.request ||
        Object.keys(stored.request).sort().join(',') !==
          'assetId,quantity,recipientResolutionId,senderWalletId'
      )
        throw new Error();
      const intent = createV2Intent(
        userId,
        stored.request,
        {
          resolutionId: stored.request.recipientResolutionId,
          recipient: {
            userId: stored.recipientId,
            walletId: stored.recipientWalletId,
            displayName: '',
            publicHandle: '',
          },
          destination: { mode: 'SIMULATED' },
          expiresAt: '',
          revisions: { senderWallet: '', recipientWallet: '', asset: '' },
        },
        stored.key,
      );
      if (stored.transferId && !oid.test(stored.transferId)) throw new Error();
      return stored.transferId
        ? Object.freeze({ ...intent, transferId: stored.transferId })
        : intent;
    }
  } catch {
    clearWalletIntent(storage);
    return null;
  }
  return restoreIntent(storage, userId);
}
export function applyWalletResult(
  intent: WalletIntent,
  transfer: TransferView | SimulatedTransferV2View,
) {
  if (intent.version === 1) return applyTransferResult(intent, transfer);
  if (
    !('payloadVersion' in transfer) ||
    transfer.payloadVersion !== 2 ||
    transfer.mode !== 'SIMULATED' ||
    transfer.senderWalletId !== intent.request.senderWalletId ||
    transfer.recipientWalletId !== intent.recipientWalletId
  )
    throw new Error('Transfer response did not match the reviewed wallets.');
  const legacy = createIntent(
    intent.userId,
    {
      assetId: intent.request.assetId,
      quantity: intent.request.quantity,
      recipientId: intent.recipientId,
    },
    intent.key,
  );
  applyTransferResult(
    { ...legacy, ...(intent.transferId ? { transferId: intent.transferId } : {}) },
    transfer,
  );
  return {
    intent: Object.freeze({ ...intent, transferId: transfer.id }),
    terminal: transfer.status !== 'PENDING',
  };
}
export const v2Api = {
  wallet: (signal?: AbortSignal) => walletRequest<{ wallet: WalletV2 }>('v2/wallet', { signal }),
  status: (signal?: AbortSignal) =>
    walletRequest<AdministrationStatus>('v2/admin/status', { signal }),
  activity: (cursor?: string, signal?: AbortSignal) =>
    walletRequest<ActivityPage>(
      `v2/custody${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
      { signal },
    ),
  resolve: (
    userId: string,
    walletId: string,
    assetId: string,
    value: string,
    signal?: AbortSignal,
  ) =>
    walletWrite<RecipientResolutionView>(
      userId,
      'v2/peer-resolutions',
      {
        senderWalletId: walletId,
        assetId,
        lookup: {
          kind: oid.test(value.trim()) ? 'WALLET_ID' : 'HANDLE',
          value: value.trim().replace(/^@/, '').toLowerCase(),
        },
      },
      { signal },
    ),
  async outcome(
    intent: WalletIntent,
    signal?: AbortSignal,
  ): Promise<{ transfer: TransferView | SimulatedTransferV2View }> {
    if (intent.version === 1)
      return intent.transferId
        ? walletApi.transfer(intent.transferId, signal)
        : walletApi.submit(intent, signal);
    return intent.transferId
      ? walletRequest(`v2/transfers/${intent.transferId}`, { signal })
      : walletWrite(intent.userId, 'v2/transfers', intent.request, { key: intent.key, signal });
  },
};
export { canonicalQuantity };
