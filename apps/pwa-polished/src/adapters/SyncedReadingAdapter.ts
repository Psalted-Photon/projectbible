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

const STORAGE_ACTIVE_PLAN = 'projectbible_active_reading_plan';
const STORAGE_PLAN_HISTORY = 'projectbible_reading_plan_history';

// ─── Reading Plans ────────────────────────────────────────────────────

/**
 * Apply remote reading_plans rows to localStorage.
 * Picks the most recently activated active plan and regenerates it.
 * Called by SyncService on initial pull.
 */
export async function applyRemoteReadingPlans(rows: any[]): Promise<void> {
  if (!rows || rows.length === 0) return;

  // Sort by activated_at descending, active plans first
  const sorted = [...rows].sort((a, b) => {
    if (a.status === 'active' && b.status !== 'active') return -1;
    if (b.status === 'active' && a.status !== 'active') return 1;
    return (b.activated_at ?? 0) - (a.activated_at ?? 0);
  });

  const activePlanRow = sorted.find(r => r.status === 'active') ?? sorted[0];
  if (!activePlanRow) return;

  try {
    const config = typeof activePlanRow.config === 'string'
      ? JSON.parse(activePlanRow.config)
      : activePlanRow.config;

    // Restore Date objects that were serialized as strings
    if (config.startDate && typeof config.startDate === 'string') {
      config.startDate = new Date(config.startDate);
    }
    if (config.endDate && typeof config.endDate === 'string') {
      config.endDate = new Date(config.endDate);
    }

    // Regenerate the full plan from the stored config
    const plan = generateReadingPlan(config);

    // Only overwrite localStorage if the remote plan is newer than what we have (or we have nothing)
    const existing = localStorage.getItem(STORAGE_ACTIVE_PLAN);
    if (existing) {
      try {
        const existingData = JSON.parse(existing);
        // If the same plan id is already in localStorage, don't overwrite
        if (existingData.id === activePlanRow.id) return;
      } catch {
        // Corrupted localStorage — fall through and overwrite
      }
    }

    localStorage.setItem(STORAGE_ACTIVE_PLAN, JSON.stringify({
      plan,
      id: activePlanRow.id,
    }));

    console.log('[SyncedReading] Restored active reading plan:', activePlanRow.id);
  } catch (err) {
    console.error('[SyncedReading] Failed to restore reading plan:', err);
  }

  // Also update the plan history — include full plan object so the history tab renders correctly
  try {
    const history: any[] = [];
    for (const r of rows) {
      try {
        const cfg = typeof r.config === 'string' ? JSON.parse(r.config) : r.config;
        if (cfg.startDate && typeof cfg.startDate === 'string') cfg.startDate = new Date(cfg.startDate);
        if (cfg.endDate && typeof cfg.endDate === 'string') cfg.endDate = new Date(cfg.endDate);
        const plan = generateReadingPlan(cfg);
        history.push({
          id: r.id,
          plan,
          createdAt: r.activated_at ? new Date(r.activated_at).toISOString() : new Date().toISOString(),
          completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : null,
        });
      } catch {
        // Skip rows with invalid config
      }
    }

    const existingHistory = localStorage.getItem(STORAGE_PLAN_HISTORY);
    const merged = existingHistory ? JSON.parse(existingHistory) : [];
    const ids = new Set(history.map((h: any) => h.id));
    const kept = merged.filter((h: any) => !ids.has(h.id));
    localStorage.setItem(STORAGE_PLAN_HISTORY, JSON.stringify([...kept, ...history]));
  } catch {
    // History update is best-effort
  }
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
}

// ─── Self-register with SyncService ──────────────────────────────────

import { syncService } from '../lib/sync/SyncService';
syncService.registerApplyFn('reading_plans', applyRemoteReadingPlans);
syncService.registerApplyFn('reading_progress', applyRemoteReadingProgress);
