-- Ensure unique constraints exist for ON CONFLICT clauses
ALTER TABLE plan_metadata
DROP CONSTRAINT IF EXISTS plan_metadata_user_plan_unique;

ALTER TABLE plan_metadata
ADD CONSTRAINT plan_metadata_user_plan_unique
UNIQUE (user_id, plan_id);

ALTER TABLE reading_progress
DROP CONSTRAINT IF EXISTS reading_progress_user_plan_day_unique;

ALTER TABLE reading_progress
ADD CONSTRAINT reading_progress_user_plan_day_unique
UNIQUE (user_id, plan_id, day_number);

-- Drop both functions
DROP FUNCTION IF EXISTS sync_reading_progress CASCADE;
DROP FUNCTION IF EXISTS sync_plan_metadata CASCADE;

-- =====================================================
-- FUNCTION: sync_reading_progress (CORRECTED)
-- =====================================================

CREATE OR REPLACE FUNCTION sync_reading_progress(
  p_operation_id TEXT,
  p_user_id TEXT,
  p_plan_id TEXT,
  p_day_number INTEGER,
  p_completed BOOLEAN,
  p_completed_at TIMESTAMPTZ,
  p_started_reading_at TIMESTAMPTZ,
  p_chapters_read JSONB,
  p_catch_up_adjustment JSONB
) 
RETURNS TABLE (
  out_id UUID,
  out_user_id UUID,
  out_plan_id TEXT,
  out_day_number INTEGER,
  out_completed BOOLEAN,
  out_created_at TIMESTAMPTZ,
  out_completed_at TIMESTAMPTZ,
  out_started_reading_at TIMESTAMPTZ,
  out_chapters_read JSONB,
  out_catch_up_adjustment JSONB,
  out_operation_id UUID,
  out_updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_op_uuid UUID;
  v_user_uuid UUID;
  v_existing_op_id UUID;
BEGIN
  -- Convert TEXT parameters to UUID
  v_op_uuid := p_operation_id::uuid;
  v_user_uuid := p_user_id::uuid;

  -- Check if this operation_id already exists (idempotency check)
  SELECT so.operation_id INTO v_existing_op_id
  FROM sync_operations so
  WHERE so.operation_id = v_op_uuid;

  -- If operation doesn't exist, record it
  IF v_existing_op_id IS NULL THEN
    INSERT INTO sync_operations (operation_id, user_id)
    VALUES (v_op_uuid, v_user_uuid);
  END IF;

  -- Insert or update reading_progress
  INSERT INTO reading_progress (
    user_id,
    plan_id,
    day_number,
    completed,
    completed_at,
    started_reading_at,
    chapters_read,
    catch_up_adjustment,
    operation_id
  ) VALUES (
    v_user_uuid,
    p_plan_id,
    p_day_number,
    p_completed,
    p_completed_at,
    p_started_reading_at,
    p_chapters_read,
    p_catch_up_adjustment,
    v_op_uuid
  )
  ON CONFLICT (user_id, plan_id, day_number) 
  DO UPDATE SET
    completed = EXCLUDED.completed,
    completed_at = EXCLUDED.completed_at,
    started_reading_at = EXCLUDED.started_reading_at,
    chapters_read = EXCLUDED.chapters_read,
    catch_up_adjustment = EXCLUDED.catch_up_adjustment,
    operation_id = EXCLUDED.operation_id,
    updated_at = NOW();

  -- Return the synced row
  RETURN QUERY
  SELECT 
    rp.id,
    rp.user_id,
    rp.plan_id,
    rp.day_number,
    rp.completed,
    rp.created_at,
    rp.completed_at,
    rp.started_reading_at,
    rp.chapters_read,
    rp.catch_up_adjustment,
    rp.operation_id,
    rp.updated_at
  FROM reading_progress rp
  WHERE rp.user_id = v_user_uuid
    AND rp.plan_id = p_plan_id
    AND rp.day_number = p_day_number;
END;
$$;

-- =====================================================
-- FUNCTION: sync_plan_metadata (CORRECTED)
-- =====================================================

CREATE OR REPLACE FUNCTION sync_plan_metadata(
  p_operation_id TEXT,
  p_user_id TEXT,
  p_plan_id TEXT,
  p_status TEXT,
  p_plan_definition_hash TEXT,
  p_plan_version INTEGER,
  p_activated_at TIMESTAMPTZ,
  p_archived_at TIMESTAMPTZ,
  p_last_synced_at TIMESTAMPTZ,
  p_sync_conflicts JSONB,
  p_catch_up_adjustment JSONB
) 
RETURNS TABLE (
  out_id UUID,
  out_user_id UUID,
  out_plan_id TEXT,
  out_status TEXT,
  out_plan_definition_hash TEXT,
  out_plan_version INTEGER,
  out_activated_at TIMESTAMPTZ,
  out_archived_at TIMESTAMPTZ,
  out_last_synced_at TIMESTAMPTZ,
  out_sync_conflicts JSONB,
  out_catch_up_adjustment JSONB,
  out_operation_id UUID,
  out_updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_op_uuid UUID;
  v_user_uuid UUID;
  v_existing_op_id UUID;
BEGIN
  -- Convert TEXT parameters to UUID
  v_op_uuid := p_operation_id::uuid;
  v_user_uuid := p_user_id::uuid;

  -- Check if this operation_id already exists (idempotency check)
  SELECT so.operation_id INTO v_existing_op_id
  FROM sync_operations so
  WHERE so.operation_id = v_op_uuid;

  -- If operation doesn't exist, record it
  IF v_existing_op_id IS NULL THEN
    INSERT INTO sync_operations (operation_id, user_id)
    VALUES (v_op_uuid, v_user_uuid);
  END IF;

  -- Insert or update plan_metadata
  INSERT INTO plan_metadata (
    user_id,
    plan_id,
    status,
    plan_definition_hash,
    plan_version,
    activated_at,
    archived_at,
    last_synced_at,
    sync_conflicts,
    catch_up_adjustment,
    operation_id
  ) VALUES (
    v_user_uuid,
    p_plan_id,
    p_status,
    p_plan_definition_hash,
    p_plan_version,
    p_activated_at,
    p_archived_at,
    p_last_synced_at,
    p_sync_conflicts,
    p_catch_up_adjustment,
    v_op_uuid
  )
  ON CONFLICT (user_id, plan_id) 
  DO UPDATE SET
    status = EXCLUDED.status,
    plan_definition_hash = EXCLUDED.plan_definition_hash,
    plan_version = EXCLUDED.plan_version,
    activated_at = EXCLUDED.activated_at,
    archived_at = EXCLUDED.archived_at,
    last_synced_at = EXCLUDED.last_synced_at,
    sync_conflicts = EXCLUDED.sync_conflicts,
    catch_up_adjustment = EXCLUDED.catch_up_adjustment,
    operation_id = EXCLUDED.operation_id,
    updated_at = NOW();

  -- Return the synced row
  RETURN QUERY
  SELECT 
    pm.id,
    pm.user_id,
    pm.plan_id,
    pm.status,
    pm.plan_definition_hash,
    pm.plan_version,
    pm.activated_at,
    pm.archived_at,
    pm.last_synced_at,
    pm.sync_conflicts,
    pm.catch_up_adjustment,
    pm.operation_id,
    pm.updated_at
  FROM plan_metadata pm
  WHERE pm.user_id = v_user_uuid
    AND pm.plan_id = p_plan_id;
END;
$$;

NOTIFY pgrst, 'reload schema';