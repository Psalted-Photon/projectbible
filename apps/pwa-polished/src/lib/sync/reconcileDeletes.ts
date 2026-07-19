/**
 * Full-pull deletion reconciliation.
 *
 * When a row is deleted on device A while device B is offline, B never sees
 * the realtime DELETE event — so on B's next full pull, any local row whose
 * id is absent from the remote snapshot must be removed here or it lives on
 * as a ghost. Rows with pending un-uploaded ops are skipped so a brand-new
 * local item is never mistaken for a remotely-deleted one.
 *
 * Must ONLY run on full pulls: a realtime event carries a single row, and
 * reconciling against it would wipe everything else locally.
 */

import { openDB, writeTransaction } from '../../adapters/db';
import { syncQueue } from './SyncQueueService';

export async function reconcileDeletedRows(table: string, remoteRows: any[]): Promise<number> {
  const remoteIds = new Set((remoteRows ?? []).map((r: any) => r.id));
  const pendingIds = await syncQueue.getPendingIdsFor(table);

  const db = await openDB();
  const allLocal: any[] = await new Promise((resolve) => {
    const tx = db.transaction(table, 'readonly');
    const req = tx.objectStore(table).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });

  let removed = 0;
  for (const local of allLocal) {
    if (!remoteIds.has(local.id) && !pendingIds.has(local.id)) {
      await writeTransaction(table, (store) => store.delete(local.id));
      removed++;
    }
  }
  if (removed > 0) {
    console.log(`[Sync] Removed ${removed} remotely-deleted row(s) from ${table}`);
  }
  return removed;
}
