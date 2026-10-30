import type { PublicPeer } from './index.js';
export interface ChatConversation {
  id: string;
  peer: PublicPeer;
  lastMessageAt: string | null;
  unreadCount: number;
  blockedByMe: boolean;
  blocked: boolean;
}
export interface ChatMessage {
  id: string;
  conversationId: string;
  sequence: string;
  senderId: string;
  clientMessageId: string;
  text: string;
  createdAt: string;
}
export interface ChatMessagePage {
  conversation: ChatConversation;
  messages: ChatMessage[];
  nextCursor: string | null;
  highWaterSequence: string;
}
export interface ChatConversationPage {
  conversations: ChatConversation[];
  nextCursor: string | null;
}
