/**
 * RealtimeService - Supabase Realtime subscriptions
 * 
 * Subscribes to Postgres changes for all user data tables
 * and notifies registered handlers when remote changes occur.
 */

import { supabase } from '../supabase/client';
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import type { SyncTable, RemoteChange } from './types';

// reading_history is deliberately absent: the feature has no callers in the
// app (nothing records or displays it), so subscribing was dead wiring.
const SYNC_TABLES: SyncTable[] = [
  'user_notes',
  'user_highlights',
  'user_word_highlights',
  'user_bookmarks',
  'journal_entries',
  'notebooks',
  'notebook_pages',
  'reading_plans',
  'reading_progress'
];

type ChangeHandler = (change: RemoteChange) => void;

const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 30_000;

class RealtimeService {
  private channel: RealtimeChannel | null = null;
  private handlers: Map<SyncTable, Set<ChangeHandler>> = new Map();
  private userId: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelayMs = RECONNECT_BASE_MS;

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

    this.channel.subscribe((status) => {
      console.log(`[Realtime] Channel status: ${status}`);
      if (status === 'SUBSCRIBED') {
        this.reconnectDelayMs = RECONNECT_BASE_MS;
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        // CLOSED also fires on intentional disconnect — userId is nulled first there.
        if (this.userId) this.scheduleReconnect();
      }
    });
    console.log(`[Realtime] Subscribing for user ${userId.slice(0, 8)}...`);
  }

  /**
   * Disconnect from Realtime
   */
  async disconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.channel) {
      const channel = this.channel;
      // Null state first so the CLOSED status callback doesn't schedule a reconnect
      this.channel = null;
      this.userId = null;
      await supabase.removeChannel(channel);
      console.log('[Realtime] Disconnected');
    }
  }

  /**
   * Rejoin the channel if it isn't healthy. Called from forceSync, which
   * already runs on tab-visibility resume and back-online — exactly the
   * moments a woken phone/laptop needs its realtime connection re-checked.
   */
  async ensureConnected(): Promise<void> {
    if (!this.userId) return; // signed out — nothing to connect
    if (this.channel && this.channel.state === 'joined') return;
    console.log(`[Realtime] Channel unhealthy (state: ${this.channel?.state ?? 'none'}), reconnecting`);
    await this.reconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || !this.userId) return;
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, RECONNECT_MAX_MS);
    console.log(`[Realtime] Reconnecting in ${Math.round(delay / 1000)}s`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.reconnect();
    }, delay);
  }

  private async reconnect(): Promise<void> {
    const userId = this.userId;
    if (!userId) return;
    if (this.channel) {
      const channel = this.channel;
      this.channel = null;
      try {
        await supabase.removeChannel(channel);
      } catch { /* stale channel — ignore */ }
    }
    this.userId = null; // let connect() rebuild from scratch
    await this.connect(userId);
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
