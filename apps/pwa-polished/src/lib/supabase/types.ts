export interface ReadingProgressRow {
  out_id: string;
  out_user_id: string;
  out_plan_id: string;
  out_day_number: number;
  out_completed: boolean;
  out_created_at: string;
  out_completed_at: string | null;
  out_started_reading_at: string | null;
  out_chapters_read: any[];
  out_catch_up_adjustment: any | null;
  out_operation_id: string | null;
  out_updated_at: string;
}

export interface PlanMetadataRow {
  out_id: string;
  out_user_id: string;
  out_plan_id: string;
  out_status: string;
  out_plan_definition_hash: string;
  out_plan_version: number;
  out_activated_at: string;
  out_archived_at: string | null;
  out_last_synced_at: string | null;
  out_sync_conflicts: any | null;
  out_catch_up_adjustment: any | null;
  out_operation_id: string | null;
  out_updated_at: string;
}

export interface SyncOperation {
  operation_id: string;
  user_id: string;
  created_at: string;
}
