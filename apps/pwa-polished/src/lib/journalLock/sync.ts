/**
 * Key-slot sync: keeps the device's copy of the journal lock and its key
 * slots in step with the account.
 *
 * Pulled with everything else on sign-in and on every sync pass, and pushed
 * live over a realtime channel of its own, so a second device locks the
 * moment the lock turns on. The channel is kept apart from the main sync
 * channel on purpose: a problem with these two tables can't stall notes,
 * highlights or plans.
 *
 * Signing out drops the journal key.
 */

import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../supabase/client';
import { syncService } from '../sync/SyncService';
import { applyRemoteLock, lockGeneration, lockJournal, onLocalLockChangeSettled } from './lockState';
import { fetchRemoteLock, fetchRemoteSlots } from './slotStore';
import type { DBJournalKeySlot } from '../../adapters/db';

async function signedInUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

/** Re-read the lock and slots from the cloud. Throws when that can't be done. */
export async function refreshLockFromCloud(): Promise<void> {
  const userId = await signedInUserId();
  if (!userId) return;
  const fetchedAt = lockGeneration();
  const row = await fetchRemoteLock(userId);
  let slots: DBJournalKeySlot[] | null = null;
  try {
    slots = await fetchRemoteSlots(userId);
  } catch (err) {
    console.warn('[JournalLock] Could not fetch key slots; keeping this device\'s copies:', err);
  }
  await applyRemoteLock(userId, row, slots, fetchedAt);
}

onLocalLockChangeSettled(() => refreshLockFromCloud());

class JournalLockSync {
  private channel: RealtimeChannel | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  async initialize(): Promise<void> {
    if (this.channel) return;
    const userId = await signedInUserId();
    if (!userId) return;

    const refresh = () => {
      if (this.refreshTimer) clearTimeout(this.refreshTimer);
      this.refreshTimer = setTimeout(() => {
        this.refreshTimer = null;
        refreshLockFromCloud().catch((err) => console.warn('[JournalLock] Refresh failed:', err));
      }, 300);
    };

    const filter = `user_id=eq.${userId}`;
    this.channel = supabase
      .channel(`journal_lock_${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'journal_lock', filter }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'journal_key_slots', filter }, refresh)
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn(`[JournalLock] Realtime channel: ${status}`);
        }
      });
  }

  dispose(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    if (this.channel) {
      const channel = this.channel;
      this.channel = null;
      void supabase.removeChannel(channel);
    }
    void lockJournal();
  }
}

syncService.registerSyncStore(new JournalLockSync());
// Every sync pass pulls journal_lock; the lock re-reads itself rather than
// using those rows, so a pull that raced one of this device's own lock
// changes is never applied.
syncService.registerApplyFn('journal_lock', () =>
  refreshLockFromCloud().catch((err) => console.warn('[JournalLock] Refresh failed:', err)));
