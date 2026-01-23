import { supabase } from '../supabase/client';
import type { ReadingProgressRow, PlanMetadataRow } from '../supabase/types';

export async function syncReadingProgress(params: {
  operationId: string;
  userId: string;
  planId: string;
  dayNumber: number;
  completed: boolean;
  completedAt: string | null;
  startedReadingAt: string | null;
  chaptersRead: any[];
  catchUpAdjustment: any | null;
}): Promise<ReadingProgressRow | null> {
  const { data, error } = await supabase.rpc('sync_reading_progress', {
    p_operation_id: params.operationId,
    p_user_id: params.userId,
    p_plan_id: params.planId,
    p_day_number: params.dayNumber,
    p_completed: params.completed,
    p_completed_at: params.completedAt,
    p_started_reading_at: params.startedReadingAt,
    p_chapters_read: params.chaptersRead,
    p_catch_up_adjustment: params.catchUpAdjustment,
  });

  if (error) {
    console.error('sync_reading_progress error', error);
    throw error;
  }

  return data as ReadingProgressRow | null;
}

export async function syncPlanMetadata(params: {
  operationId: string;
  userId: string;
  planId: string;
  status: string;
  planDefinitionHash: string;
  planVersion: number;
  activatedAt: string;
  archivedAt: string | null;
  lastSyncedAt: string | null;
  syncConflicts: any | null;
  catchUpAdjustment: any | null;
}): Promise<PlanMetadataRow | null> {
  const { data, error } = await supabase.rpc('sync_plan_metadata', {
    p_operation_id: params.operationId,
    p_user_id: params.userId,
    p_plan_id: params.planId,
    p_status: params.status,
    p_plan_definition_hash: params.planDefinitionHash,
    p_plan_version: params.planVersion,
    p_activated_at: params.activatedAt,
    p_archived_at: params.archivedAt,
    p_last_synced_at: params.lastSyncedAt,
    p_sync_conflicts: params.syncConflicts,
    p_catch_up_adjustment: params.catchUpAdjustment,
  });

  if (error) {
    console.error('sync_plan_metadata error', error);
    throw error;
  }

  return data as PlanMetadataRow | null;
}
