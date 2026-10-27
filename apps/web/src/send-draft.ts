import { browserIntentStorage, type IntentStorage } from './transfer-client.js';
export const SEND_DRAFT_KEY = 'p2p.send.draft.v1';
export interface SendDraft {
  userId: string;
  handle: string;
  assetId: string;
  quantity: string;
}
function valid(value: unknown): value is SendDraft {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    Object.keys(row).sort().join(',') === 'assetId,handle,quantity,userId' &&
    typeof row.userId === 'string' &&
    /^[a-f0-9]{24}$/.test(row.userId) &&
    typeof row.handle === 'string' &&
    row.handle.length <= 24 &&
    typeof row.assetId === 'string' &&
    (row.assetId === '' || /^[a-f0-9]{24}$/.test(row.assetId)) &&
    typeof row.quantity === 'string' &&
    row.quantity.length <= 30
  );
}
export function clearSendDraft(storage: IntentStorage = browserIntentStorage) {
  try {
    storage.removeItem(SEND_DRAFT_KEY);
  } catch {
    /* Restricted storage does not retain another identity in memory. */
  }
}
export function loadSendDraft(
  userId: string,
  storage: IntentStorage = browserIntentStorage,
): SendDraft | null {
  try {
    const raw = storage.getItem(SEND_DRAFT_KEY);
    if (!raw) return null;
    if (raw.length > 1000) throw new Error();
    const value: unknown = JSON.parse(raw);
    if (!valid(value) || value.userId !== userId) throw new Error();
    return value;
  } catch {
    clearSendDraft(storage);
    return null;
  }
}
export function saveSendDraft(draft: SendDraft, storage: IntentStorage = browserIntentStorage) {
  if (!valid(draft)) return false;
  try {
    storage.setItem(SEND_DRAFT_KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}
