# Legacy SQL — do not run

These files are kept for historical reference only. They describe systems
that no longer exist and contradict the live database:

- `supabase-setup.sql` — from the PowerSync-era sync design. Defines
  `sync_reading_progress` / `sync_plan_metadata` functions and a
  `plan_metadata` table the current app never calls. The live progress-merge
  function is `upsert_reading_progress` (see `migrations/004`).
- `002_powersync_publication.sql` — created the `powersync` replication
  publication. PowerSync was removed from the app; migration 006 drops the
  publication. (This file previously collided with `002_highlight_style.sql`
  in the migrations folder numbering.)

The real schema is `migrations/001` through `006` applied via the Supabase
dashboard SQL editor. See `apps/pwa-polished/SYNC-SETUP.md` for the current
architecture.
