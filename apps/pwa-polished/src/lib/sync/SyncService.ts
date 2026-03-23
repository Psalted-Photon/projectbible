/**
 * SyncService - Main orchestrator for sync functionality
 * 
 * Responsibilities:
 * - Connect/disconnect Realtime on auth changes
 * - Process sync queue when online
 * - Pull initial data on sign-in
 * - Provide sync state to UI
 */

import { supabase } from '../supabase/client';
import { syncQueue } from './SyncQueueService';
import { realtimeService } from './RealtimeService';
import type { SyncState, SyncTable } from './types';

interface SyncStore {
  initialize(): Promise<void>;
  dispose(): void;
}

type StateListener = (state: SyncState) => void;

class SyncService {
  private state: SyncState = {
    status: 'idle',
    pendingCount: 0,
    lastSyncedAt: null,
    error: null,
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  };
  
  private listeners: Set<StateListener> = new Set();
  private initialized = false;
  private signingIn = false; // mutex — prevents double-call from onAuthStateChange + getUser()
  private authUnsubscribe: (() => void) | null = null;
  private queueUnsubscribe: (() => void) | null = null;
  private syncStores: SyncStore[] = [];
  private applyFns: Map<SyncTable, (rows: any[]) => Promise<void>> = new Map();

  /**
   * Register a synced store. Called by adapter modules at import time.
   * SyncService will call initialize() on sign-in and dispose() on sign-out.
   */
  registerSyncStore(store: SyncStore): void {
    this.syncStores.push(store);
  }

  /**
   * Register a remote-pull function for a table. Called by adapter modules at import time.
   */
  registerApplyFn(table: SyncTable, fn: (rows: any[]) => Promise<void>): void {
    this.applyFns.set(table, fn);
  }
  
  /**
   * Initialize the sync service
   * Call once on app startup
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    
    // Listen for online/offline
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);
    }
    
    // Listen for queue changes
    this.queueUnsubscribe = syncQueue.subscribe((count) => {
      this.updateState({ pendingCount: count });
    });
    
    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_IN' && session?.user) {
          await this.onSignIn(session.user.id);
        } else if (event === 'SIGNED_OUT') {
          await this.onSignOut();
        }
      }
    );
    this.authUnsubscribe = () => subscription.unsubscribe();
    
    // Check if already signed in
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await this.onSignIn(user.id);
    }
  }
  
  /**
   * Subscribe to sync state changes
   */
  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }
  
  /**
   * Force a sync (manual refresh)
   */
  async forceSync(): Promise<void> {
    if (!navigator.onLine) {
      this.updateState({ error: 'Cannot sync while offline' });
      return;
    }
    
    this.updateState({ status: 'syncing', error: null });
    
    try {
      // Process any pending writes first
      await syncQueue.processQueue();
      
      // Then pull remote changes
      await this.pullRemoteData();
      
      this.updateState({ 
        status: 'idle', 
        lastSyncedAt: new Date(),
        error: null 
      });
    } catch (err: any) {
      this.updateState({ 
        status: 'error', 
        error: err.message 
      });
    }
  }
  
  /**
   * Get current sync state
   */
  getState(): SyncState {
    return { ...this.state };
  }
  
  /**
   * Cleanup on app unmount
   */
  destroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('offline', this.handleOffline);
    }
    this.authUnsubscribe?.();
    this.queueUnsubscribe?.();
    realtimeService.disconnect();
  }
  
  // ========== Private ==========
  
  private async onSignIn(userId: string): Promise<void> {
    if (this.signingIn) return;
    this.signingIn = true;
    console.log('[SyncService] User signed in:', userId.slice(0, 8) + '...');
    
    this.updateState({ status: 'syncing' });
    
    try {
      // Connect to Realtime
      await realtimeService.connect(userId);
      
      // Initialize store Realtime subscriptions (registers handlers on the live channel)
      for (const store of this.syncStores) {
        await store.initialize();
      }
      
      // Pull initial data
      await this.pullRemoteData();
      
      // Process any queued writes
      if (navigator.onLine) {
        await syncQueue.processQueue();
      }
      
      this.updateState({ 
        status: 'idle', 
        lastSyncedAt: new Date(),
        error: null 
      });
    } catch (err: any) {
      console.error('[SyncService] Sign-in sync error:', err);
      this.updateState({ 
        status: 'error', 
        error: err.message 
      });
    } finally {
      this.signingIn = false;
    }
  }
  
  private async onSignOut(): Promise<void> {
    console.log('[SyncService] User signed out');
    
    // Disconnect from Realtime
    await realtimeService.disconnect();
    
    // Dispose store Realtime subscriptions (so they re-initialize on next sign-in)
    for (const store of this.syncStores) {
      store.dispose();
    }
    
    // Clear pending sync queue (don't sync anonymous data)
    await syncQueue.clear();
    
    this.updateState({ 
      status: 'idle', 
      pendingCount: 0,
      lastSyncedAt: null,
      error: null 
    });
  }
  
  private handleOnline = async (): Promise<void> => {
    console.log('[SyncService] Back online');
    this.updateState({ isOnline: true });
    
    // Process any queued operations
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      this.updateState({ status: 'syncing' });
      await syncQueue.processQueue();
      this.updateState({ status: 'idle', lastSyncedAt: new Date() });
    }
  };
  
  private handleOffline = (): void => {
    console.log('[SyncService] Went offline');
    this.updateState({ isOnline: false, status: 'offline' });
  };
  
  private async pullRemoteData(): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const pulls: Promise<void>[] = [];
    for (const [table, applyFn] of this.applyFns) {
      pulls.push(this.pullTable(table, user.id, applyFn));
    }
    await Promise.all(pulls);
  }
  
  private async pullTable(
    table: SyncTable, 
    userId: string,
    applyFn: (rows: any[]) => Promise<void>
  ): Promise<void> {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .eq('user_id', userId);
    
    if (error) {
      console.error(`[SyncService] Failed to pull ${table}:`, error);
      return;
    }
    
    console.log(`[SyncService] Pulled ${data?.length ?? 0} rows from ${table}`);
    if (data && data.length > 0) {
      await applyFn(data);
    }
  }
  
  private updateState(partial: Partial<SyncState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}

export const syncService = new SyncService();
