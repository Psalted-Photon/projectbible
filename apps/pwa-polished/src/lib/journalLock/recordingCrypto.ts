/**
 * Journal recordings and the journal lock.
 *
 * While the lock is on, a journal recording's audio, name and transcript
 * tail are scrambled with the same journal key as the entries. Each 2-second
 * piece is bound to its recording and its place in it (crypto.ts
 * recordingContext), the way an entry's fields are bound to the entry. The
 * length, date and the day it belongs to stay readable, as an entry's date
 * does.
 *
 * Opening one is for memory only: playing it, writing it out, or saving it
 * as a file after unlocking, which saves it readable, the same rule as the
 * backup file. Turning the lock on or off brings this device's journal
 * recordings in line (sweepRecordings, run by sweep.ts with the entries).
 *
 * Recordings stay on the device: they never go to the cloud or the backup.
 */

import { derived, get, type Readable } from 'svelte/store';
import {
  changeRecording,
  isBusy,
  recordingBlob,
  recordingChunks,
  recordings,
  refreshRecordings,
  replaceRecordingChunks,
  type Recording,
  type TranscriptTail,
} from '../recorder/recordings';
import { isScrambled, recordingContext, scrambleBytes, scrambleText, unscrambleBytes, unscrambleText } from './crypto';
import { JournalLockedError } from './entryCrypto';
import { currentLockView, getContentKey, journalLock } from './lockState';

// ── Pieces, name and tail ─────────────────────────────────────────────────

const pieceContext = (recId: string, seq: number) => recordingContext(recId, `piece ${seq}`);
const nameContext = (recId: string) => recordingContext(recId, 'name');
const tailContext = (recId: string) => recordingContext(recId, 'tail');

/** One 2-second piece, scrambled for saving. */
export async function sealPiece(key: CryptoKey, recId: string, seq: number, blob: Blob): Promise<Blob> {
  return new Blob([await scrambleBytes(key, pieceContext(recId, seq), new Uint8Array(await blob.arrayBuffer()))]);
}

async function openPiece(key: CryptoKey, recId: string, seq: number, blob: Blob): Promise<Uint8Array<ArrayBuffer>> {
  return unscrambleBytes(key, pieceContext(recId, seq), new Uint8Array(await blob.arrayBuffer()));
}

export function sealName(key: CryptoKey, recId: string, name: string): Promise<string> {
  return scrambleText(key, nameContext(recId), name);
}

/** A transcript's tail, scrambled the same way, since it is the entry's own words. One already scrambled stays as it is. */
export async function sealTail(key: CryptoKey, recId: string, tail: TranscriptTail | null): Promise<TranscriptTail | null> {
  if (!tail || isScrambled(tail.text)) return tail;
  return { kind: tail.kind, text: await scrambleText(key, tailContext(recId), tail.text) };
}

/** The tail as written. Null when it can't be opened, which only costs carrying the last line on. */
export async function openTail(rec: Recording): Promise<TranscriptTail | null> {
  const tail = rec.transcript?.tail ?? null;
  if (!tail || !isScrambled(tail.text)) return tail;
  const key = getContentKey();
  if (!key) return null;
  try {
    return { kind: tail.kind, text: await unscrambleText(key, tailContext(rec.id), tail.text) };
  } catch {
    return null;
  }
}

/** Its name, opened. Null while the journal is locked, or when the key can't open it. */
export async function openName(rec: Recording): Promise<string | null> {
  if (!rec.scrambled || !isScrambled(rec.name)) return rec.name;
  const key = getContentKey();
  if (!key) return null;
  try {
    return await unscrambleText(key, nameContext(rec.id), rec.name);
  } catch {
    return null;
  }
}

/** The audio, opened in memory. Throws JournalLockedError while the journal is locked. */
export async function openRecordingBlob(rec: Recording): Promise<Blob> {
  if (!rec.scrambled) return recordingBlob(rec);
  const key = getContentKey();
  if (!key) throw new JournalLockedError();
  const chunks = await recordingChunks(rec.id);
  const parts = await Promise.all(chunks.map((c) => openPiece(key, rec.id, c.seq, c.blob)));
  return new Blob(parts, { type: rec.mime });
}

/** Renames one, scrambling the new name while the recording is scrambled. */
export async function renameAnyRecording(rec: Recording, name: string): Promise<void> {
  const clean = name.trim();
  if (!clean) return;
  let stored = clean;
  if (rec.scrambled) {
    const key = getContentKey();
    if (!key) throw new JournalLockedError();
    stored = await sealName(key, rec.id, clean);
  }
  // Only onto the same kind it was read as: the lock's pass may have changed it since.
  await changeRecording(rec.id, (latest) => (!!latest.scrambled === !!rec.scrambled ? { ...latest, name: stored } : null));
}

// ── What a row is called ──────────────────────────────────────────────────

/** Opened names of scrambled recordings, by id, while the journal is unlocked. */
export const openedNames: Readable<Record<string, string>> = derived(
  [recordings, journalLock],
  ([$list, $lock], set) => {
    const scrambled = $list.filter((r) => r.scrambled);
    if (!$lock.unlocked || scrambled.length === 0) {
      set({});
      return;
    }
    let live = true;
    void Promise.all(scrambled.map(async (r) => [r.id, await openName(r)] as const)).then((pairs) => {
      if (!live) return;
      const out: Record<string, string> = {};
      for (const [id, name] of pairs) if (name) out[id] = name;
      set(out);
    });
    return () => {
      live = false;
    };
  },
  {} as Record<string, string>,
);

/** What to call a recording on screen: its name, or "Journal recording" while that is locked away. */
export function recordingLabel(rec: Recording, names: Record<string, string> = get(openedNames)): string {
  if (!rec.scrambled) return rec.name;
  return names[rec.id] ?? 'Journal recording';
}

/** Playing it, writing it out or saving it needs the journal unlocked first. */
export function recordingLocked(rec: Recording): boolean {
  return !!rec.scrambled && !getContentKey();
}

/**
 * Writing a journal recording out needs the key: its audio is scrambled, or
 * its words go into an entry that is.
 */
export function needsJournalKey(rec: Recording): boolean {
  return !!rec.scrambled || (!!rec.journal && currentLockView().mode !== 'off');
}

/** Out of line with the lock, so the lock's pass has work to do once it's free. */
export function recordingOutOfStep(rec: Recording): boolean {
  if (!rec.journal) return false;
  return (currentLockView().mode === 'on') !== !!rec.scrambled;
}

// ── The lock's pass ───────────────────────────────────────────────────────

export interface RecordingSweepResult {
  changed: number;
  failed: number;
}

/** This account's journal recordings that `target` would change, read fresh from the device. */
export async function recordingsToSweep(target: 'scrambled' | 'readable'): Promise<Recording[]> {
  const userId = currentLockView().userId;
  const all = await refreshRecordings();
  return all.filter(
    (r) =>
      r.journal &&
      r.state === 'done' &&
      (!r.journal.userId || !userId || r.journal.userId === userId) &&
      (target === 'scrambled' ? !r.scrambled : !!r.scrambled),
  );
}

/**
 * Scrambles readable journal recordings, or opens scrambled ones, to match
 * `target`. One being recorded or written out is left for the next pass.
 * Stops cleanly if the journal locks or the lock changes direction part way.
 */
export async function sweepRecordings(
  todo: Recording[],
  target: 'scrambled' | 'readable',
  stillGoing: () => boolean,
  onEach?: (done: number) => void,
): Promise<RecordingSweepResult> {
  const result: RecordingSweepResult = { changed: 0, failed: 0 };
  for (const rec of todo) {
    const key = getContentKey();
    if (!key || !stillGoing()) break;
    if (isBusy(rec.id)) continue;
    try {
      const ok = await (target === 'scrambled' ? scrambleOne(key, rec) : openOne(key, rec));
      if (ok) result.changed++;
    } catch (err) {
      console.error('[JournalLock] A recording couldn’t be changed:', err);
      result.failed++;
    }
    onEach?.(result.changed + result.failed);
  }
  return result;
}

async function scrambleOne(key: CryptoKey, rec: Recording): Promise<boolean> {
  const chunks = await recordingChunks(rec.id);
  const sealed = await Promise.all(chunks.map(async (c) => ({ seq: c.seq, blob: await sealPiece(key, rec.id, c.seq, c.blob) })));
  const name = await sealName(key, rec.id, rec.name);
  const tail = await sealTail(key, rec.id, rec.transcript?.tail ?? null);
  return replaceRecordingChunks(rec.id, sealed, (latest) =>
    !isBusy(rec.id) && unchanged(latest, rec)
      ? { ...latest, scrambled: true, name, transcript: latest.transcript ? { ...latest.transcript, tail } : latest.transcript }
      : null,
  );
}

async function openOne(key: CryptoKey, rec: Recording): Promise<boolean> {
  const chunks = await recordingChunks(rec.id);
  const opened = await Promise.all(chunks.map(async (c) => ({ seq: c.seq, blob: new Blob([await openPiece(key, rec.id, c.seq, c.blob)]) })));
  const name = (await openName(rec)) ?? rec.name;
  if (isScrambled(name)) throw new Error('Its name couldn’t be opened.');
  const tail = await openTail(rec);
  return replaceRecordingChunks(rec.id, opened, (latest) =>
    !isBusy(rec.id) && unchanged(latest, rec)
      ? { ...latest, scrambled: false, name, transcript: latest.transcript ? { ...latest.transcript, tail } : latest.transcript }
      : null,
  );
}

/**
 * Nothing this pass read has moved on since: no rename, no new tail, no
 * other pass. Checked, with busy, inside the transaction that writes, so a
 * recording taken up while its pieces were being changed is left as it was.
 */
function unchanged(latest: Recording, read: Recording): boolean {
  return (
    !!latest.scrambled === !!read.scrambled &&
    latest.name === read.name &&
    latest.pieces === read.pieces &&
    (latest.transcript?.tail?.text ?? null) === (read.transcript?.tail?.text ?? null)
  );
}
