/**
 * Where the journal lock and its key slots are kept: on the device in
 * IndexedDB, so unlocking works offline, and in Supabase, so they follow the
 * account. Plain reads and writes only — deciding what to do with them is
 * lockState.ts's job.
 */

import { openDB } from '../../adapters/db';
import type { DBJournalKeySlot, DBJournalLock } from '../../adapters/db';
import { supabase } from '../supabase/client';

export type LockMode = DBJournalLock['state'];

// ── On the device ─────────────────────────────────────────────────────────

function readAll<T>(storeName: string): Promise<T[]> {
  return openDB().then((db) => new Promise<T[]>((resolve) => {
    try {
      const req = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
      req.onsuccess = () => resolve((req.result as T[]) ?? []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  }));
}

/** Replace a whole store's contents in one transaction. */
function replaceAll<T>(storeName: string, rows: T[]): Promise<void> {
  return openDB().then((db) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.clear();
    for (const row of rows) store.put(row);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error(`${storeName} write aborted`));
  }));
}

/** The lock as this device last heard it. Only one account's is kept. */
export async function readLocalLock(): Promise<DBJournalLock | null> {
  const rows = await readAll<DBJournalLock>('journal_lock');
  if (rows.length === 0) return null;
  return rows.sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

export function writeLocalLock(lock: DBJournalLock): Promise<void> {
  return replaceAll('journal_lock', [lock]);
}

export async function readLocalSlots(): Promise<DBJournalKeySlot[]> {
  return readAll<DBJournalKeySlot>('journal_key_slots');
}

export function replaceLocalSlots(slots: DBJournalKeySlot[]): Promise<void> {
  return replaceAll('journal_key_slots', slots);
}

// ── In the cloud ──────────────────────────────────────────────────────────

export function lockFromRow(row: any, userId: string): DBJournalLock {
  const state: LockMode = row?.state === 'on' || row?.state === 'turning_off' ? row.state : 'off';
  return {
    userId,
    state,
    keyId: state === 'off' ? null : (row?.key_id ?? null),
    updatedAt: row?.updated_at ? new Date(row.updated_at).getTime() : 0,
  };
}

export function slotFromRow(row: any): DBJournalKeySlot {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind === 'passkey' ? 'passkey' : 'recovery',
    keyId: row.key_id,
    label: row.label ?? '',
    credentialId: row.credential_id ?? null,
    rpId: row.rp_id ?? null,
    salt: row.salt,
    wrappedKey: row.wrapped_key,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
  };
}

function slotToRow(slot: DBJournalKeySlot) {
  return {
    id: slot.id,
    user_id: slot.userId,
    kind: slot.kind,
    key_id: slot.keyId,
    label: slot.label,
    credential_id: slot.credentialId,
    rp_id: slot.rpId,
    salt: slot.salt,
    wrapped_key: slot.wrappedKey,
    created_at: new Date(slot.createdAt).toISOString(),
  };
}

/** The account's lock row, or null when it has never had one. Throws when offline. */
export async function fetchRemoteLock(userId: string): Promise<any | null> {
  const { data, error } = await supabase.from('journal_lock').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function fetchRemoteSlots(userId: string): Promise<DBJournalKeySlot[]> {
  const { data, error } = await supabase.from('journal_key_slots').select('*').eq('user_id', userId);
  if (error) throw error;
  return (data ?? []).map(slotFromRow);
}

export async function uploadSlots(slots: DBJournalKeySlot[]): Promise<void> {
  if (slots.length === 0) return;
  const { error } = await supabase.from('journal_key_slots').upsert(slots.map(slotToRow));
  if (error) throw error;
}

export async function deleteRemoteSlots(userId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from('journal_key_slots').delete().eq('user_id', userId).in('id', ids);
  if (error) throw error;
}

export async function deleteAllRemoteSlots(userId: string): Promise<void> {
  const { error } = await supabase.from('journal_key_slots').delete().eq('user_id', userId);
  if (error) throw error;
}

export async function setRemoteLock(userId: string, state: LockMode, keyId: string | null): Promise<DBJournalLock> {
  const updatedAt = new Date();
  const { error } = await supabase.from('journal_lock').upsert({
    user_id: userId,
    state,
    key_id: state === 'off' ? null : keyId,
    updated_at: updatedAt.toISOString(),
  });
  if (error) throw error;
  return { userId, state, keyId: state === 'off' ? null : keyId, updatedAt: updatedAt.getTime() };
}
