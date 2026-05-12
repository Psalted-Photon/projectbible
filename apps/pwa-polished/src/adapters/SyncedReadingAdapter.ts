/**
 * SyncedReadingAdapter - Reading plan & progress sync
 *
 * Handles pulling reading_plans and reading_progress from Supabase
 * and restoring them to localStorage / IndexedDB.
 *
 * Plans are stored in Supabase as a `config` JSON string; on pull we
 * regenerate the full ReadingPlan object and write it to localStorage
 * so ReadingPlanModal picks it up normally.
 */

import { generateReadingPlan } from '@projectbible/core';
import { readingProgressStore } from '../stores/ReadingProgressStore';

const STORAGE_ACTIVE_PLAN = 'projectbible_active_reading_plan'; // legacy key
const STORAGE_ACTIVE_PLANS = 'projectbible_active_reading_plans'; // new multi-plan key
const STORAGE_PLAN_HISTORY = 'projectbible_reading_plan_history';

// ─── Reading Plans ────────────────────────────────────────────────────

/**
 * Apply remote reading_plans rows to localStorage.
 * Picks the most recently activated active plan and regenerates it.
 * Called by SyncService on initial pull.
 */
export async function applyRemoteReadingPlans(rows: any[]): Promise<void> {
  if (!rows || rows.length === 0) return;

  // Separate active from archived/deleted
  const activeRows = rows.filter(r => r.status === 'active');
  const archivedRows = rows.filter(r => r.status === 'archived' || r.status === 'completed');
  // Rows with status === 'deleted' or anything else are skipped entirely

  // ── Active plans: restore ALL active rows ──────────────────────────────────
  const currentPlansRaw = localStorage.getItem(STORAGE_ACTIVE_PLANS);
  let currentPlans: Array<{id: string, plan: any}> = currentPlansRaw ? JSON.parse(currentPlansRaw) : [];

  // Build a set of plan IDs the server considers active
  const remoteActiveIds = new Set(activeRows.map(r => r.id));

  // Remove any local plans the server no longer has as active (deleted/archived remotely)
  const before = currentPlans.length;
  currentPlans = currentPlans.filter(e => remoteActiveIds.has(e.id));
  let changed = currentPlans.length !== before;

  for (const row of activeRows) {
    const existing = currentPlans.find(e => e.id === row.id);
    if (existing) {
      // Plan already exists locally — only apply a name change from the server
      if (row.name && existing.plan?.config?.name !== row.name) {
        existing.plan.config.name = row.name;
        changed = true;
        console.log('[SyncedReading] Updated name for reading plan:', row.id, '->', row.name);
      }
      continue;
    }
    // Plan is new locally — restore it from the server
    try {
      const config = typeof row.config === 'string' ? JSON.parse(row.config) : row.config;
      if (config.startDate && typeof config.startDate === 'string') config.startDate = new Date(config.startDate);
      if (config.endDate && typeof config.endDate === 'string') config.endDate = new Date(config.endDate);
      const plan = generateReadingPlan(config);
      if (row.name) plan.config.name = row.name;
      currentPlans.push({ id: row.id, plan });
      changed = true;
      console.log('[SyncedReading] Restored active reading plan:', row.id);
    } catch (err) {
      console.error('[SyncedReading] Failed to restore reading plan:', row.id, err);
    }
  }

  // Also check legacy single-plan key and migrate if needed
  if (!currentPlansRaw) {
    const existingOld = localStorage.getItem(STORAGE_ACTIVE_PLAN);
    if (existingOld) {
      try {
        const existingData = JSON.parse(existingOld);
        if (!currentPlans.some(e => e.id === existingData.id)) {
          currentPlans.push({ id: existingData.id, plan: existingData.plan });
          changed = true;
        }
      } catch { /* ignore */ }
    }
  }

  if (changed || currentPlans.length > 0) {
    localStorage.setItem(STORAGE_ACTIVE_PLANS, JSON.stringify(currentPlans));
    localStorage.removeItem(STORAGE_ACTIVE_PLAN);
  }

  // ── History: merge archived rows ───────────────────────────────────────────
  try {
    const history: any[] = [];
    for (const r of archivedRows) {
      try {
        const cfg = typeof r.config === 'string' ? JSON.parse(r.config) : r.config;
        if (cfg.startDate && typeof cfg.startDate === 'string') cfg.startDate = new Date(cfg.startDate);
        if (cfg.endDate && typeof cfg.endDate === 'string') cfg.endDate = new Date(cfg.endDate);
        const plan = generateReadingPlan(cfg);
        if (r.name) plan.config.name = r.name;
        history.push({
          id: r.id,
          plan,
          createdAt: r.activated_at ? new Date(r.activated_at).toISOString() : new Date().toISOString(),
          completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : (r.archived_at ? new Date(r.archived_at).toISOString() : null),
        });
      } catch { /* skip rows with invalid config */ }
    }

    if (history.length > 0) {
      const existingHistory = localStorage.getItem(STORAGE_PLAN_HISTORY);
      const merged: any[] = existingHistory ? JSON.parse(existingHistory) : [];
      const ids = new Set(history.map((h: any) => h.id));
      const kept = merged.filter((h: any) => !ids.has(h.id));
      localStorage.setItem(STORAGE_PLAN_HISTORY, JSON.stringify([...kept, ...history]));
    }
  } catch { /* history update is best-effort */ }
}

// ─── Reading Progress ─────────────────────────────────────────────────

/**
 * Apply remote reading_progress rows to IndexedDB.
 * Called by SyncService on initial pull.
 */
export async function applyRemoteReadingProgress(rows: any[]): Promise<void> {
  if (!rows || rows.length === 0) return;

  for (const row of rows) {
    try {
      const chaptersRead = typeof row.chapters_read === 'string'
        ? JSON.parse(row.chapters_read)
        : (row.chapters_read ?? []);

      const catchUpAdjustment = row.catch_up_adjustment
        ? (typeof row.catch_up_adjustment === 'string'
            ? JSON.parse(row.catch_up_adjustment)
            : row.catch_up_adjustment)
        : undefined;

      // created_at / completed_at / started_reading_at may be ISO strings
      // (TIMESTAMPTZ) or epoch-ms numbers — normalise to epoch-ms for IndexedDB.
      const toMs = (v: any): number | undefined =>
        v == null ? undefined : typeof v === 'number' ? v : new Date(v).getTime();

      // Write directly to IndexedDB (bypasses the read-progress write queue)
      await readingProgressStore.upsertEntries([{
        id: row.id,
        planId: row.plan_id,
        dayNumber: row.day_number,
        completed: row.completed === 1 || row.completed === true,
        createdAt: toMs(row.created_at) ?? 0,
        completedAt: toMs(row.completed_at),
        startedReadingAt: toMs(row.started_reading_at),
        chaptersRead,
        catchUpAdjustment,
      }]);
    } catch (err) {
      console.error('[SyncedReading] Failed to apply progress row:', row.id, err);
    }
  }

  console.log(`[SyncedReading] Applied ${rows.length} reading_progress rows`);
  bumpReadingProgressVersion();
}

// ─── Realtime handler for reading_progress ───────────────────────────
//
// When another device writes a progress row, Supabase fires a Realtime
// INSERT/UPDATE event. We apply it directly to IndexedDB so the modal
// updates without requiring a manual refresh or second tab-switch.

async function handleRealtimeProgressChange(change: any): Promise<void> {
  if (change.eventType === 'DELETE') return; // nothing to apply
  const row = change.new;
  if (!row?.id) return;
  try {
    await applyRemoteReadingProgress([row]);
    // bumpReadingProgressVersion is already called inside applyRemoteReadingProgress
  } catch (err) {
    console.error('[SyncedReading] Realtime progress apply error:', err);
  }
}

// ─── Self-register with SyncService ──────────────────────────────────

import { syncService } from '../lib/sync/SyncService';
import { realtimeService } from '../lib/sync/RealtimeService';
import { bumpReadingProgressVersion } from '../stores/readingProgressVersionStore';
syncService.registerApplyFn('reading_plans', applyRemoteReadingPlans);
syncService.registerApplyFn('reading_progress', applyRemoteReadingProgress);
realtimeService.onTableChange('reading_progress', handleRealtimeProgressChange);
