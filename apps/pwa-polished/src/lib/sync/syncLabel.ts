/**
 * One place that turns SyncState into the words the user reads.
 *
 * Previously the profile and the reading plan each formatted their own string,
 * and the reading plan additionally wrote the label by hand on button click —
 * which is how it could print "Synced 3:42 PM" for a sync that never ran.
 * Every sync label in the app now comes from here.
 */

import type { SyncState } from './types';

/** What a sync actually covers — shown on hover, since it's otherwise invisible. */
export const SYNC_SCOPE_TOOLTIP =
  'Syncs notes, highlights, bookmarks, journal, notebooks, reading plans, ' +
  'reading progress, settings and the wake alarm across your devices.';

function plural(n: number): string {
  return n === 1 ? 'change' : 'changes';
}

function clockTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function formatSyncLabel(state: SyncState, isSignedIn = true): string {
  if (!isSignedIn) return 'Not synced';
  if (!state.isOnline || state.status === 'offline') return 'Offline';

  if (state.status === 'syncing') {
    return state.activity === 'uploading' && state.pendingCount > 0
      ? `Syncing ${state.pendingCount} ${plural(state.pendingCount)}…`
      : 'Checking for updates…';
  }

  if (state.status === 'error') {
    return state.error ?? 'Sync failed — tap to retry';
  }

  // idle
  if (state.pendingCount > 0) {
    return `${state.pendingCount} ${plural(state.pendingCount)} waiting`;
  }
  if (!state.lastSyncedAt) return 'Ready';
  return state.lastUploadedCount > 0
    ? `Saved ${state.lastUploadedCount} ${plural(state.lastUploadedCount)} · ${clockTime(state.lastSyncedAt)}`
    : `Up to date · ${clockTime(state.lastSyncedAt)}`;
}

/** True while a sync is genuinely running — drives the spinner. */
export function isSyncRunning(state: SyncState): boolean {
  return state.status === 'syncing';
}
