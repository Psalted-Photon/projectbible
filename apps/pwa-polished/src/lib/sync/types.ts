/**
 * Sync system type definitions
 */

export type SyncOperationType = 'INSERT' | 'UPDATE' | 'DELETE';

export interface SyncOperation {
  type: SyncOperationType;
  table: SyncTable;
  id: string;
  data?: Record<string, any>;
}

export type SyncTable =
  | 'user_notes'
  | 'user_highlights'
  | 'user_word_highlights'
  | 'user_bookmarks'
  | 'journal_entries'
  | 'notebooks'
  | 'notebook_pages'
  | 'reading_plans'
  | 'reading_progress';

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline';

/** What an in-flight sync is doing, so the UI can say more than "Syncing...". */
export type SyncActivity = 'uploading' | 'checking';

export interface SyncState {
  status: SyncStatus;
  pendingCount: number;
  lastSyncedAt: Date | null;
  error: string | null;
  isOnline: boolean;
  /** Current step of an in-flight sync; null whenever status !== 'syncing'. */
  activity: SyncActivity | null;
  /** Queued changes the last completed sync actually uploaded. */
  lastUploadedCount: number;
}

export interface RemoteChange {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  table: SyncTable;
  new?: Record<string, any>;
  old?: Record<string, any>;
}
