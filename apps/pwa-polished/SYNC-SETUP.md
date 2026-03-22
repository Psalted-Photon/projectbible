# Supabase Realtime Sync Setup

## What's Implemented

Replaced PowerSync with a simpler sync solution using:
- **Supabase REST API** for writes (online)
- **Supabase Realtime** for receiving changes from other devices
- **IndexedDB sync_queue** for offline write buffering
- **Last-write-wins** conflict resolution using `updated_at` timestamps

This works on **Supabase free tier** — no PowerSync or paid add-ons required.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Svelte Components                             │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   Synced Store (SyncedUserDataStore/SyncedJournalStore)│
│  - Writes to IndexedDB immediately (optimistic UI)                   │
│  - Queues writes for Supabase upload                                 │
│  - Subscribes to Realtime for remote changes                         │
└──────────┬───────────────────┬───────────────────┬──────────────────┘
           │                   │                   │
           ▼                   ▼                   ▼
┌──────────────────┐  ┌─────────────────┐  ┌────────────────────────┐
│   IndexedDB      │  │   SyncQueue     │  │  Supabase Realtime     │
│  (Local Data)    │  │  (Pending Ops)  │  │  (Cross-Device Sync)   │
└──────────────────┘  └────────┬────────┘  └───────────┬────────────┘
                               │                       │
                               ▼                       │
                      ┌─────────────────┐              │
                      │   SyncService   │◄─────────────┘
                      │  - Process queue│
                      │  - Handle online│
                      │  - Conflict res │
                      └────────┬────────┘
                               │
                               ▼
                      ┌─────────────────┐
                      │  Supabase REST  │
                      │  (Cloud DB)     │
                      └─────────────────┘
```

---

## Files Created

| File | Purpose |
|------|---------|
| `src/lib/sync/types.ts` | TypeScript types for sync operations |
| `src/lib/sync/conflictResolver.ts` | Last-write-wins conflict handling |
| `src/lib/sync/SyncQueueService.ts` | Manages offline queue (enqueue, process, retry) |
| `src/lib/sync/RealtimeService.ts` | Supabase Realtime subscriptions |
| `src/lib/sync/SyncService.ts` | Orchestrates queue + realtime + online state |
| `src/lib/sync/index.ts` | Module exports |
| `src/adapters/SyncedUserDataStore.ts` | Synced version of notes/highlights/bookmarks |
| `src/adapters/SyncedJournalStore.ts` | Synced version of journal entries |

---

## Setup Steps

### 1. Run Supabase Migrations (Already Done)

The tables already exist in Supabase:
- `user_notes`
- `user_highlights`
- `user_bookmarks`
- `journal_entries`
- `reading_plans`
- `reading_progress`
- `reading_history`

### 2. Enable Supabase Realtime

In the Supabase dashboard:
1. Go to **Database → Tables**
2. For each user data table, click the table name
3. Look for **Realtime** toggle and enable it
4. Repeat for all 7 user data tables

Alternatively, run this SQL in the SQL Editor:
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE user_notes;
ALTER PUBLICATION supabase_realtime ADD TABLE user_highlights;
ALTER PUBLICATION supabase_realtime ADD TABLE user_bookmarks;
ALTER PUBLICATION supabase_realtime ADD TABLE journal_entries;
ALTER PUBLICATION supabase_realtime ADD TABLE reading_plans;
ALTER PUBLICATION supabase_realtime ADD TABLE reading_progress;
ALTER PUBLICATION supabase_realtime ADD TABLE reading_history;
```

### 3. Test

1. Run the app: `npm run dev` in `apps/pwa-polished`
2. Sign in with your account
3. Create a note or journal entry
4. Open another browser/device and sign in with the same account
5. Verify the data appears within a few seconds

---

## How It Works

### Writing Data

1. User creates a note/highlight/bookmark/journal entry
2. `SyncedUserDataStore` or `SyncedJournalStore` saves to IndexedDB immediately (fast, optimistic)
3. The write is queued via `SyncQueueService.enqueue()`
4. If online, the queue is processed immediately — data is sent to Supabase via REST API
5. If offline, writes stay in the queue until the app goes online

### Receiving Data

1. On sign-in, `SyncService` connects to Supabase Realtime
2. It subscribes to `postgres_changes` for all user data tables, filtered by `user_id`
3. When another device creates/updates/deletes data, the change is broadcast
4. `RealtimeService` receives the change and calls the appropriate handler
5. The handler uses `shouldApplyRemoteChange()` for conflict resolution
6. If remote is newer, the local IndexedDB is updated

### Conflict Resolution

Simple **last-write-wins** based on `updated_at` timestamps:
- When a remote change arrives, compare `local.updatedAt` vs `remote.updated_at`
- If remote is newer, overwrite local
- If local is newer (rare race condition), keep local

---

## What Syncs Now

| Data Type | Syncs? | Notes |
|-----------|--------|-------|
| Notes | ✅ Yes | Via SyncedUserDataStore |
| Highlights | ✅ Yes | Via SyncedUserDataStore |
| Bookmarks | ✅ Yes | Via SyncedUserDataStore |
| Journal | ✅ Yes | Via SyncedJournalStore |
| Reading Plans | ❌ Not yet | Tables ready, stores need migration |
| Reading Progress | ❌ Not yet | Tables ready, stores need migration |
| Reading History | ❌ Not yet | Tables ready, stores need migration |

---

## Limitations

1. **Requires online** for initial sync — data only syncs when you're connected
2. **No merge conflicts** — last write wins, which may lose data in rare race conditions
3. **Reading plans still local** — need to migrate ReadingProgressStore and PlanMetadataStore in Phase 2

---

## Deleted (PowerSync)

The following PowerSync code was removed because it requires Supabase Pro + IPv4 add-on ($29+/month):
- `src/lib/powersync/` directory
- `src/services/PowerSyncService.ts`
- `src/adapters/PowerSyncUserDataStore.ts`
- `src/adapters/PowerSyncJournalStore.ts`
