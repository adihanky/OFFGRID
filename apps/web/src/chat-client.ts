import type { ChatMessage } from '@p2p/contracts';
export interface PendingChatMessage {
  clientMessageId: string;
  text: string;
}
export function pendingMessage(text: string): PendingChatMessage {
  return { clientMessageId: crypto.randomUUID(), text };
}
export function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) =>
    BigInt(a.sequence) < BigInt(b.sequence) ? -1 : BigInt(a.sequence) > BigInt(b.sequence) ? 1 : 0,
  );
}
