import { supabase } from "../lib/supabase/client";
import { readingProgressStore, type ReadingProgressEntry } from "../stores/ReadingProgressStore";
import { planMetadataStore, type PlanMetadata } from "../stores/PlanMetadataStore";
import { mergeProgress } from "../../../../packages/core/src/ReadingPlanEngine";
import type { ReadingProgressRow, PlanMetadataRow, SyncOperation } from "../lib/supabase/types";

export class SyncService {
  async syncReadingProgress(planId: string): Promise<{ merged: ReadingProgressEntry[]; conflicts: any[] }> {
    const local = await readingProgressStore.getProgressForPlan(planId);
    const localCore = local.map((entry) => this.toCoreEntry(entry));
    const { data: cloudRows, error } = await supabase
      .from("reading_progress")
      .select("*")
      .eq("plan_id", planId);

    if (error) throw error;

    const cloud = (cloudRows ?? []).map((row) => this.fromRow(row));
    const cloudCore = cloud.map((entry) => this.toCoreEntry(entry));
    const { merged, conflicts } = mergeProgress(localCore, cloudCore);

    const mergedStore = merged.map((entry) => this.fromCoreEntry(entry, local));

    await readingProgressStore.upsertEntries(mergedStore);

    const payload = mergedStore.map((entry) => this.toRow(entry));
    const { error: upsertError } = await supabase
      .from("reading_progress")
      .upsert(payload, { onConflict: "plan_id,day_number" });

    if (upsertError) throw upsertError;

    return { merged: mergedStore, conflicts };
  }

  async syncPlanMetadata(): Promise<void> {
    const local = await planMetadataStore.getAll();
    const payload = local.map((meta) => this.toPlanMetadataRow(meta));

    const { error } = await supabase
      .from("plan_metadata")
      .upsert(payload, { onConflict: "plan_id" });

    if (error) throw error;
  }

  private toRow(entry: ReadingProgressEntry) {
    return {
      plan_id: entry.planId,
      day_number: entry.dayNumber,
      completed: entry.completed,
      created_at: new Date(entry.createdAt).toISOString(),
      completed_at: entry.completedAt ? new Date(entry.completedAt).toISOString() : null,
      started_reading_at: entry.startedReadingAt ? new Date(entry.startedReadingAt).toISOString() : null,
      chapters_read: entry.chaptersRead,
      catch_up_adjustment: entry.catchUpAdjustment ?? null,
    };
  }

  private fromRow(row: any): ReadingProgressEntry {
    const planId = row.plan_id;
    const dayNumber = row.day_number;
    return {
      id: `${planId}-${dayNumber}`,
      planId,
      dayNumber,
      completed: Boolean(row.completed),
      createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
      completedAt: row.completed_at ? new Date(row.completed_at).getTime() : undefined,
      startedReadingAt: row.started_reading_at ? new Date(row.started_reading_at).getTime() : undefined,
      chaptersRead: row.chapters_read ?? [],
      catchUpAdjustment: row.catch_up_adjustment ?? undefined,
    };
  }

  private toCoreEntry(entry: ReadingProgressEntry) {
    return {
      planId: entry.planId,
      dayNumber: entry.dayNumber,
      completed: entry.completed,
      completedAt: entry.completedAt,
      chaptersRead: entry.chaptersRead,
    };
  }

  private fromCoreEntry(core: any, existing: ReadingProgressEntry[]): ReadingProgressEntry {
    const match = existing.find(
      (entry) => entry.planId === core.planId && entry.dayNumber === core.dayNumber,
    );
    return {
      id: match?.id ?? `${core.planId}-${core.dayNumber}`,
      planId: core.planId,
      dayNumber: core.dayNumber,
      completed: Boolean(core.completed),
      createdAt: match?.createdAt ?? Date.now(),
      completedAt: core.completedAt ?? undefined,
      startedReadingAt: match?.startedReadingAt,
      chaptersRead: core.chaptersRead ?? [],
      catchUpAdjustment: match?.catchUpAdjustment,
    };
  }

  private toPlanMetadataRow(meta: PlanMetadata) {
    return {
      plan_id: meta.planId,
      status: meta.status,
      plan_definition_hash: meta.planDefinitionHash,
      plan_version: meta.planVersion,
      activated_at: new Date(meta.activatedAt).toISOString(),
      archived_at: meta.archivedAt ? new Date(meta.archivedAt).toISOString() : null,
      last_synced_at: meta.lastSyncedAt ? new Date(meta.lastSyncedAt).toISOString() : null,
      sync_conflicts: meta.syncConflicts ?? null,
      catch_up_adjustment: meta.catchUpAdjustment ?? null,
    };
  }
}

export const syncService = new SyncService();
