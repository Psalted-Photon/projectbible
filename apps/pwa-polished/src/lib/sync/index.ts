/**
 * Sync module exports
 */

export { syncService } from './SyncService';
export { syncQueue } from './SyncQueueService';
export { realtimeService } from './RealtimeService';
export { shouldApplyRemoteChange, nowISO } from './conflictResolver';
export type { 
  SyncOperation, 
  SyncTable, 
  SyncStatus, 
  SyncState, 
  RemoteChange 
} from './types';
