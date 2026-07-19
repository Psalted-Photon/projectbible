# Sync Architecture

How ProjectBible keeps user data in sync across devices via Supabase.
(Rewritten July 2026 after the sync overhaul; the previous version of this
doc described a half-built system left over from the PowerSync removal.)

## The shape of it

Local-first, three legs:

1. **Local write** — every user action writes IndexedDB (or localStorage for
   plan definitions/settings) immediately. The UI never waits on the network.
2. **Push** — the same action enqueues an upload into the IndexedDB
   `sync_queue`, drained by `SyncQueueService`: oldest-first, one coalesced
   op per row, exponential backoff on failures (5s doubling, 15min cap).
   Most tables use plain PostgREST upsert/update/delete; `reading_progress`
   goes through the `upsert_reading_progress` RPC which union-merges
   chapter checkmarks server-side so two devices can never erase each
   other's progress.
3. **Pull** — full per-table pull on sign-in and on `forceSync` (which also
   runs on tab-visibility resume, throttled 30s). Supabase Realtime
   subscriptions (`RealtimeService`, per-user channel, self-healing with
   reconnect backoff) deliver live deltas as a bonus path.

## Who owns what

| Data | Local store | Table | Sync owner |
|---|---|---|---|
| Notes | IndexedDB `user_notes` | `user_notes` | `SyncedUserDataStore` |
| Verse highlights | IndexedDB `user_highlights` | `user_highlights` | `SyncedUserDataStore` (sole owner) |
| Word highlights | IndexedDB `user_word_highlights` | `user_word_highlights` | `SyncedHighlightAdapter` (sole owner) |
| Bookmarks | IndexedDB `user_bookmarks` | `user_bookmarks` | `SyncedUserDataStore` |
| Journal | IndexedDB `journal_entries` | `journal_entries` | `SyncedJournalStore` |
| Plan definitions | localStorage (full generated schedule) | `reading_plans` (`plan_data` = exact day-by-day schedule) | `SyncedReadingAdapter` |
| Plan progress | IndexedDB `reading_progress` | `reading_progress` (RPC union merge) | `SyncedReadingAdapter` via `registerProgressSyncHook` — **every** `ReadingProgressStore` mutation pushes automatically |
| Settings (synced subset) | localStorage `projectbible_settings` | `user_settings` JSONB | `lib/sync/settingsSync` — theme, timezone, translations, interlinear, red-letter, headings; font size/spacing/layout stay per-device |

Exactly one apply-fn and one realtime handler per table. Full pulls run
deletion reconciliation (`lib/sync/reconcileDeletes`): local rows absent
from the remote snapshot are removed, except rows whose upload is still
queued. Realtime single-row events never reconcile (a lesson learned —
doing so once wiped local notes).

Not synced by design: last-read position, window layout, repeats overlay,
per-device display settings. `reading_history` exists as a table but the
feature has no callers in the app — nothing records or syncs it.

## Conflict rules

- Chapter checkmarks: union-merged (client `upsertEntries` + server RPC).
  Progress marked anywhere survives everywhere; unchecks propagate via
  latest-action-per-chapter.
- Notes/journal: last-write-wins on `updated_at`. Journal also resolves
  same-date collisions between different ids.
- Highlights/bookmarks: last-write-wins on `created_at`.
- Settings: whole-blob LWW on `updated_at`, synced keys only; a fresh
  install never overwrites account settings with an empty blob.
- All day math (today, overdue, streak) uses the user's timezone setting
  via `clockStore.localDateStr` / `todayStore`; plan-day labels are
  timezone-free `YYYY-MM-DD` strings in `plan_data`.

## Database

Schema = `supabase/migrations/001` … `006`, applied through the dashboard
SQL editor (the repo has only the anon key; there is no CLI pipeline).
Realtime broadcasting requires tables to be in the `supabase_realtime`
publication — currently all synced tables are members. `supabase/legacy/`
holds superseded files kept for reference; never run them.

Server functions: `upsert_reading_progress` (004) and `delete_account`
(006, called by the twice-confirmed Delete Account button).

## Deploying

Push to `main` → Vercel builds the PWA. Installed apps cache aggressively:
fully close and reopen (twice if needed) on every device before judging a
deploy — a stale build is indistinguishable from a broken one.
