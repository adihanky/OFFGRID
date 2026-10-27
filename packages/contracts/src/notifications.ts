export interface InboxNotification {
  id: string;
  transferId: string;
  createdAt: string;
  readAt: string | null;
  message: string;
}
export interface NotificationPage {
  notifications: InboxNotification[];
  nextCursor: string | null;
}
export interface VerificationJobView {
  id: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  progress: number;
  total: 3;
  createdAt: string;
  completedAt?: string;
  results: Array<{ check: 'LEDGER' | 'CHAIN' | 'CUSTODY'; ok: boolean; issueCount: number }>;
  error?: string;
}
