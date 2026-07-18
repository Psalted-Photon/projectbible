-- ============================================================
-- 005: Exact plan schedules sync across devices
--
-- Adds reading_plans.plan_data: the creating device's full generated
-- day-by-day schedule (day dates as timezone-free YYYY-MM-DD strings).
-- Other devices restore this exact schedule instead of regenerating from
-- config — regeneration re-rolled shuffled/randomized plans with
-- Math.random, so each device got a different chapter arrangement and
-- checkmarks landed on the wrong readings.
-- ============================================================

ALTER TABLE public.reading_plans
  ADD COLUMN IF NOT EXISTS plan_data TEXT;

NOTIFY pgrst, 'reload schema';
