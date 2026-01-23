export interface ReadingProgressRow {
  id: string;
  user_id: string;
  plan_id: string;
  day_number: number;
  completed: boolean;
  created_at: string;
  completed_at: string | null;
  started_reading_at: string | null;
  chapters_read: any[];
  catch_up_adjustment: any | null;
  operation_id: string | null;
  updated_at: string;
}

export interface PlanMetadataRow {
  id: string;
  user_id: string;
  plan_id: string;
  status: string;
  plan_definition_hash: string;
  plan_version: number;
  activated_at: string;
  archived_at: string | null;
  last_synced_at: string | null;
  sync_conflicts: any | null;
  catch_up_adjustment: any | null;
  operation_id: string | null;
  updated_at: string;
}

export interface SyncOperation {
  operation_id: string;
  user_id: string;
  created_at: string;
}
