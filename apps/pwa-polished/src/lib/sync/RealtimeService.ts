/**
 * RealtimeService - Supabase Realtime subscriptions
 * 
 * Subscribes to Postgres changes for all user data tables
 * and notifies registered handlers when remote changes occur.
 */

import { supabase } from '../supabase/client';
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import type { SyncTable, RemoteChange } from './types';

const SYNC_TABLES: SyncTable[] = [
  'user_notes',
  'user_highlights',
  'user_word_highlights',
  'user_bookmarks',
  'journal_entries',
  'reading_plans',
  'reading_progress',
  'reading_history'
];

type ChangeHandler = (change: RemoteChange) => void;

class RealtimeService {
  private channel: RealtimeChannel | null = null;
  private handlers: Map<SyncTable, Set<ChangeHandler>> = new Map();
  private userId: string | null = null;
  
  /**
   * Connect to Realtime and start listening for changes
   */
  async connect(userId: string): Promise<void> {
    if (this.channel) {
      // Already connected, maybe for different user
      if (this.userId === userId) return;
      await this.disconnect();
    }
    
    this.userId = userId;
    this.channel = supabase.channel(`user_sync_${userId}`);
    
    // Subscribe to all user data tables
    for (const table of SYNC_TABLES) {
      this.channel.on(
        'postgres_changes',
        {
          event: '*', // INSERT, UPDATE, DELETE
          schema: 'public',
          table,
          filter: `user_id=eq.${userId}`,
        },
        (payload: RealtimePostgresChangesPayload<any>) => {
          this.handleChange(table, payload);
        }
      );
    }
    
    const status = await this.channel.subscribe();
    console.log(`[Realtime] Connected for user ${userId.slice(0, 8)}..., status:`, status);
  }
  
  /**
   * Disconnect from Realtime
   */
  async disconnect(): Promise<void> {
    if (this.channel) {
      await supabase.removeChannel(this.channel);
      this.channel = null;
      this.userId = null;
      console.log('[Realtime] Disconnected');
    }
  }
  
  /**
   * Register a handler for changes on a specific table
   * Returns an unsubscribe function
   */
  onTableChange(table: SyncTable, handler: ChangeHandler): () => void {
    if (!this.handlers.has(table)) {
      this.handlers.set(table, new Set());
    }
    this.handlers.get(table)!.add(handler);
    
    return () => {
      const handlers = this.handlers.get(table);
      if (handlers) {
        handlers.delete(handler);
      }
    };
  }
  
  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.channel !== null;
  }
  
  private handleChange(
    table: SyncTable, 
    payload: RealtimePostgresChangesPayload<any>
  ): void {
    const change: RemoteChange = {
      eventType: payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE',
      table,
      new: payload.new as Record<string, any> | undefined,
      old: payload.old as Record<string, any> | undefined,
    };
    
    console.log(`[Realtime] ${change.eventType} on ${table}:`, change.new?.id || change.old?.id);
    
    const handlers = this.handlers.get(table);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(change);
        } catch (err) {
          console.error(`[Realtime] Handler error for ${table}:`, err);
        }
      }
    }
  }
}

export const realtimeService = new RealtimeService();
