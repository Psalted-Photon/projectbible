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
  | 'user_bookmarks'
  | 'journal_entries'
  | 'reading_plans'
  | 'reading_progress'
  | 'reading_history';

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline';

export interface SyncState {
  status: SyncStatus;
  pendingCount: number;
  lastSyncedAt: Date | null;
  error: string | null;
  isOnline: boolean;
}

export interface RemoteChange {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  table: SyncTable;
  new?: Record<string, any>;
  old?: Record<string, any>;
}
