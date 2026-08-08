/**
 * Sync module exports
 */

export { syncService } from './SyncService';
export { syncQueue } from './SyncQueueService';
export { realtimeService } from './RealtimeService';
export { shouldApplyRemoteChange, nowISO } from './conflictResolver';
export { formatSyncLabel, isSyncRunning, SYNC_SCOPE_TOOLTIP } from './syncLabel';
export type {
  SyncOperation,
  SyncTable,
  SyncStatus,
  SyncActivity,
  SyncState,
  RemoteChange
} from './types';
