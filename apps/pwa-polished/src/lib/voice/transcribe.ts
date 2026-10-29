/**
 * Writing out: a recording's words into a notebook page or a journal day, in
 * the background while the app is used. One recording at a time; one that
 * stops while another is being written out waits its turn.
 *
 * The work is in transcribeWorker.ts. Each piece it finishes goes in straight
 * away, in front of the recording's pill (transcriptSink.ts), through the
 * editor when the page or day is open, so the words can be read as they
 * come. Progress is saved after each piece: closing the app stops it where
 * it is, and opening the app again carries on from there by itself, the way
 * pack downloads do. The screen stays awake while it runs.
 *
 * A recording started from a page goes into that page, and one started from
 * the journal into that day's entry. One started from Recordings gets a page
 * of its own in Quick Notes, named after it.
 *
 * Every Stop asks what next (StopRecordingCard.svelte): write it out and keep
 * the recording, write it out and then delete the recording, or keep the
 * recording only. A kept one stays as a "▶ 0:42" chip at the end of its words.
 *
 * A journal recording while the lock is on is opened in memory only to be
 * written out, and its words go into the entry through the journal store,
 * so they are scrambled like typing. If the journal locks part way, it
 * pauses and carries on after unlock; after a relaunch it waits for the
 * unlock too.
 *
 * Needs Whistle (Voice Control's download) and the Transcribe add-on; the
 * first tap offers whichever is missing.
 */

import { get, writable } from 'svelte/store';
import { showNotice, errorText } from '../../stores/noticeStore';
import { userProfileStore } from '../../stores/userProfileStore';
import { syncedNotebookStore } from '../../adapters/SyncedNotebookStore';
import { syncedJournalStore } from '../../adapters/SyncedJournalStore';
import { stayAwake, allowSleep } from '../installAwake';
import { openNotesPage, NOTES_PAGE_WRITTEN, type NotesPageRef } from '../openNotesPage';
import { openJournalDay } from '../openJournalDay';
import {
  changeRecording,
  clock,
  deleteRecording,
  getRecording,
  markBusy,
  refreshRecordings,
  type JournalTarget,
  type Recording,
  type TranscriptProgress,
} from '../recorder/recordings';
import { stopRecording } from '../recorder/recorder';
import { currentLockView, getContentKey, journalLock, onUnlocked } from '../journalLock/lockState';
import { JournalLockedError } from '../journalLock/entryCrypto';
import { needsJournalKey, openName, openRecordingBlob, openTail, recordingOutOfStep, sealTail } from '../journalLock/recordingCrypto';
import { sweepJournal } from '../journalLock/sweep';
import { voiceInstalledHere, type VoiceDownloadId } from './voicePack';
import { openTranscribeCard } from './holdToTalk';
import {
  placeRecordingInHtml,
  removeRecordingFromHtml,
  writeBlocksIntoHtml,
  type TranscriptBlock,
  type TranscriptTail,
} from './transcriptSink';
import type { TranscriptPiece } from './transcribeWorker';

export interface TranscribeState {
  /** The recording being transcribed. */
  id: string | null;
  phase: 'idle' | 'loading' | 'running' | 'stopping';
  /** Seconds of the recording read so far. */
  readSec: number;
  totalSec: number;
  /** What loading is doing, the first time. */
  stage: string | null;
}

const IDLE: TranscribeState = { id: null, phase: 'idle', readSec: 0, totalSec: 0, stage: null };

export const transcribing = writable<TranscribeState>(IDLE);

const STAGES: Record<string, string> = {
  engine: 'Starting…',
  whistle: 'Loading Whistle…',
  punct: 'Loading punctuation…',
  vad: 'Loading the voice detector…',
};

/** The notebook a recording's page goes in when it wasn't started from one. Same name the Notes pane uses. */
const QUICK_NOTES = 'Quick Notes';

// ── The worker ──────────────────────────────────────────────────────────────

let worker: Worker | null = null;
let nextId = 1;
interface Pending {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  onProgress?: (p: { stage?: string; readSec?: number }) => void;
  onPiece?: (p: TranscriptPiece) => void;
}
const pending = new Map<number, Pending>();
let loaded: Promise<void> | null = null;

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./transcribeWorker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event) => {
    const { id, ok, result, error, progress, piece } = event.data ?? {};
    const entry = pending.get(id);
    if (!entry) return;
    if (piece) return entry.onPiece?.(piece);
    if (progress) return entry.onProgress?.(progress);
    pending.delete(id);
    if (ok) entry.resolve(result);
    else entry.reject(new Error(error || 'Transcribe failed'));
  };
  worker.onerror = (event) => {
    for (const [id, entry] of pending) {
      entry.reject(new Error(`Transcribe stopped: ${event.message}`));
      pending.delete(id);
    }
    worker?.terminate();
    worker = null;
    loaded = null;
  };
  return worker;
}

function call<T>(action: string, payload: Record<string, unknown> = {}, handlers: Omit<Pending, 'resolve' | 'reject'> = {}, transfer: Transferable[] = []): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject, ...handlers });
    getWorker().postMessage({ id, action, payload }, transfer);
  });
}

function load(): Promise<void> {
  if (!loaded) {
    loaded = call<void>('load', {}, { onProgress: (p) => p.stage && transcribing.update((s) => ({ ...s, stage: STAGES[p.stage!] ?? null })) })
      .catch((err) => {
        loaded = null;
        throw err;
      })
      .finally(() => transcribing.update((s) => ({ ...s, stage: null })));
  }
  return loaded;
}

// ── Where the words go ──────────────────────────────────────────────────────

export type TranscriptTarget =
  | { kind: 'page'; page: NotesPageRef }
  | { kind: 'journal'; journal: JournalTarget };

function targetOf(rec: Recording): TranscriptTarget | null {
  if (rec.journal) return { kind: 'journal', journal: rec.journal };
  if (rec.page) return { kind: 'page', page: rec.page };
  return null;
}

const keyOf = (t: TranscriptTarget) => (t.kind === 'page' ? `page:${t.page.pageId}` : `journal:${t.journal.date}`);

/** An open editor taking a page's or a day's words, pills and saves. */
export interface TargetWriter {
  /** A transcript's next piece, in front of the pill. Undefined while the editor isn't ready. */
  write(recId: string, blocks: TranscriptBlock[], tail: TranscriptTail | null): TranscriptTail | null | undefined;
  /** Drops a recording's pill at the cursor. False while the editor isn't ready. */
  place(recId: string): boolean;
  /** Takes a pill out. Undefined while the editor isn't ready. */
  remove(recId: string): boolean | undefined;
  /** Saves now. False when it couldn't be. */
  save(): Promise<boolean>;
}

const writers = new Map<string, TargetWriter>();

function register(key: string, writer: TargetWriter): () => void {
  writers.set(key, writer);
  return () => {
    if (writers.get(key) === writer) writers.delete(key);
  };
}

/** The Notes pane has this page open in its editor: pieces go through it. Returns the undo. */
export function registerPageWriter(pageId: string, writer: TargetWriter): () => void {
  return register(`page:${pageId}`, writer);
}

/** The journal has this day open: pieces go through its editor. Returns the undo. */
export function registerJournalWriter(date: string, writer: TargetWriter): () => void {
  return register(`journal:${date}`, writer);
}

/**
 * Changes the saved text of a page or day that isn't open: `edit` returns
 * the new text, or null to leave it. A day's entry goes through the journal
 * store, so it is scrambled like typing while the lock is on, and can't be
 * written while the journal is locked (JournalLockedError).
 */
async function editSaved(target: TranscriptTarget, edit: (html: string) => Promise<string | null>): Promise<void> {
  if (target.kind === 'page') {
    const saved = await syncedNotebookStore.getPage(target.page.pageId);
    if (!saved) throw new Error('The page it was going into has been deleted.');
    const next = await edit(saved.text);
    if (next === null) return;
    await syncedNotebookStore.updatePage(target.page.pageId, { text: next });
    window.dispatchEvent(new CustomEvent(NOTES_PAGE_WRITTEN, { detail: target.page.pageId }));
    return;
  }
  const { date, userId } = target.journal;
  const profile = get(userProfileStore);
  if (!profile.isSignedIn) throw new Error('Sign in to write it into your journal.');
  if (userId && profile.userId !== userId) throw new Error('Its journal belongs to another account. Sign in to that one to write it out.');
  const entry = await syncedJournalStore.getEntryByDate(date);
  if (entry?.locked) throw new JournalLockedError();
  if (entry?.unreadable) throw new Error('That day’s journal entry couldn’t be opened, so it wasn’t written over.');
  const next = await edit(entry?.text ?? '');
  if (next === null) return;
  if (entry) await syncedJournalStore.updateEntry(entry.id, { text: next });
  else await syncedJournalStore.saveEntry({ date, text: next });
}

async function writeBlocks(target: TranscriptTarget, recId: string, blocks: TranscriptBlock[], tail: TranscriptTail | null): Promise<TranscriptTail | null> {
  if (!blocks.length) return tail;
  // The editor may still be loading: a few moments to let it, rather than
  // write under an editor that would then save over the words.
  for (let i = 0; i < 20; i++) {
    const w = writers.get(keyOf(target));
    if (!w) break;
    const out = w.write(recId, blocks, tail);
    if (out !== undefined) return out;
    await new Promise((r) => setTimeout(r, 250));
  }
  let out = tail;
  await editSaved(target, async (html) => {
    const next = await writeBlocksIntoHtml(html, recId, blocks, tail);
    out = next.tail;
    return next.html;
  });
  return out;
}

/** A recording has started: its pill goes in at the cursor of the page or day it was started from. */
export async function placeRecordingChip(rec: Recording): Promise<void> {
  const target = targetOf(rec);
  if (!target) return;
  if (writers.get(keyOf(target))?.place(rec.id)) return;
  await editSaved(target, (html) => placeRecordingInHtml(html, rec.id)).catch((err) =>
    console.warn('[transcribe] The recording’s pill couldn’t be added:', err),
  );
}

/** Takes a recording's pill out of its page or day, and saves. False when the save didn't happen. */
async function removeChip(target: TranscriptTarget, recId: string): Promise<boolean> {
  const w = writers.get(keyOf(target));
  if (w && w.remove(recId) !== undefined) return w.save();
  await editSaved(target, (html) => removeRecordingFromHtml(html, recId));
  return true;
}

/** Where the words go: the page or day it was recorded from, or a new page in Quick Notes. */
async function targetFor(rec: Recording): Promise<TranscriptTarget> {
  if (rec.journal) return { kind: 'journal', journal: rec.journal };
  if (rec.page && (await syncedNotebookStore.getPage(rec.page.pageId))) return { kind: 'page', page: rec.page };
  const books = await syncedNotebookStore.getNotebooks();
  const quick = books.find((n) => n.name === QUICK_NOTES) ?? (await syncedNotebookStore.createNotebook(QUICK_NOTES));
  // Its pill goes in from the start, so a kept recording stays with its words.
  const text = (await placeRecordingInHtml('', rec.id)) ?? '';
  const page = await syncedNotebookStore.createPage({ notebookId: quick.id, title: rec.name, text });
  return { kind: 'page', page: { notebookId: quick.id, pageId: page.id } };
}

function opener(target: TranscriptTarget): () => void {
  return target.kind === 'page' ? () => openNotesPage(target.page) : () => openJournalDay(target.journal.date);
}

/** What a notice calls it: its name, or "the recording" while that's locked away. */
async function noticeName(rec: Recording): Promise<string> {
  const name = await openName(rec);
  return name ? `“${name}”` : 'the recording';
}

// ── Decoding on the page ────────────────────────────────────────────────────

/** A file the worker can't read a little at a time: decoded whole here, at 16 kHz. */
async function decodeHere(blob: Blob): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, 1, 16000);
  const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
  if (audio.numberOfChannels === 1) return audio.getChannelData(0).slice();
  const out = new Float32Array(audio.length);
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const ch = audio.getChannelData(c);
    for (let i = 0; i < ch.length; i++) out[i] += ch[i] / audio.numberOfChannels;
  }
  return out;
}

// ── Downloads ───────────────────────────────────────────────────────────────

/** Which of Transcribe's downloads aren't on this device. */
async function missingDownloads(): Promise<VoiceDownloadId[]> {
  const ids: VoiceDownloadId[] = ['voice-control', 'voice-transcribe'];
  const here = await Promise.all(ids.map((id) => voiceInstalledHere(id).catch(() => false)));
  return ids.filter((_, i) => !here[i]);
}

// ── Writing it out ──────────────────────────────────────────────────────────

/** Recordings waiting their turn, in order. */
export const transcribeQueue = writable<string[]>([]);

const dequeue = (id: string) => transcribeQueue.update((q) => q.filter((x) => x !== id));

const FRESH: TranscriptProgress = { state: 'running', doneSec: 0, pieces: 0, tail: null };

export interface TranscribeOptions {
  /** Leaves out the notices, for one picked up by itself. */
  quiet?: boolean;
  /** Delete the recording and its pill once the words are safely in. Left as it was when unset. */
  deleteAfter?: boolean;
}

/** The recording the controller has taken on, from the first moment, so two taps can't both start. */
let claimed: string | null = null;
let stopAsked = false;
/** The journal locked under a journal recording's transcript. */
let stopForLock = false;
/** The one being written out, for the lock to check. */
let current: Recording | null = null;

/** The transcript as it stands, set to a new state: a finished one starts again from the top. */
function restate(rec: Recording, state: TranscriptProgress['state'], opts: TranscribeOptions, forUnlock = false): Recording {
  const base = rec.transcript && rec.transcript.state !== 'done' ? rec.transcript : FRESH;
  const deleteAfter = opts.deleteAfter ?? base.deleteAfter;
  return { ...rec, transcript: { ...base, state, error: undefined, forUnlock, deleteAfter } };
}

/** Puts one in line behind the one being written out. */
async function waitItsTurn(id: string, opts: TranscribeOptions): Promise<void> {
  const already = get(transcribeQueue).includes(id);
  transcribeQueue.update((q) => (q.includes(id) ? q : [...q, id]));
  await changeRecording(id, (rec) => restate(rec, 'queued', opts), false);
  if (!opts.quiet && !already) showNotice('Waiting its turn: another recording is being written out first.', 'info');
}

/**
 * Writes a recording out, or carries on with one stopped part way. One
 * asked for while another is running waits its turn.
 */
export async function transcribeRecording(id: string, opts: TranscribeOptions = {}): Promise<void> {
  if (claimed !== null || get(transcribing).phase !== 'idle') {
    if (claimed !== id && get(transcribing).id !== id) await waitItsTurn(id, opts);
    return;
  }
  claimed = id;
  // Busy before it is even read, so the lock's pass can't change it underneath.
  markBusy(id, true);
  try {
    await run(id, opts);
  } finally {
    markBusy(id, false);
    claimed = null;
    // Left out of the lock's pass while it was busy.
    const latest = await getRecording(id).catch(() => null);
    if (latest && recordingOutOfStep(latest) && getContentKey()) void sweepJournal().catch(() => {});
    next();
  }
}

/** On to the next in line. */
function next(): void {
  const [id] = get(transcribeQueue);
  if (id) void transcribeRecording(id, { quiet: true });
}

async function run(id: string, opts: TranscribeOptions): Promise<void> {
  dequeue(id);
  const missing = await missingDownloads();
  if (missing.length) {
    if (!opts.quiet) openTranscribeCard(missing, () => void transcribeRecording(id, opts));
    return;
  }
  await refreshRecordings();
  const rec = await getRecording(id);
  if (!rec || rec.state !== 'done') return;
  const name = await noticeName(rec);

  // Locked away: written out once the journal is unlocked.
  if (needsJournalKey(rec) && !getContentKey()) {
    await changeRecording(id, (latest) => restate(latest, 'waiting', opts, true), false);
    if (!opts.quiet) showNotice('The journal is locked. Unlock it and the recording is written out then.', 'info');
    return;
  }

  stopAsked = false;
  stopForLock = false;
  current = rec;
  const resuming = !!rec.transcript && rec.transcript.state !== 'done';
  const progress: TranscriptProgress = resuming
    ? { ...rec.transcript!, tail: await openTail(rec), state: 'running', error: undefined, forUnlock: false }
    : { ...FRESH };
  if (opts.deleteAfter !== undefined) progress.deleteAfter = opts.deleteAfter;
  transcribing.set({ id, phase: 'loading', readSec: progress.doneSec, totalSec: rec.durationSec, stage: null });
  stayAwake('transcribe');

  // A journal recording's tail is the entry's own words: kept scrambled
  // whenever the journal is.
  const sealTails = !!rec.journal && (!!rec.scrambled || currentLockView().mode !== 'off');
  const save = async (patch: Partial<Recording> = {}) => {
    const key = sealTails ? getContentKey() : null;
    const tail = sealTails ? (key ? await sealTail(key, id, progress.tail) : null) : progress.tail;
    const transcript = { ...progress, tail };
    await changeRecording(id, (latest) => ({ ...latest, ...patch, transcript }), false);
  };

  try {
    const target = await targetFor(rec);
    await save(target.kind === 'page' ? { page: target.page } : {});
    await load();
    if (stopAsked) throw new Stopped();
    transcribing.update((s) => ({ ...s, phase: 'running' }));
    if (!opts.quiet && progress.doneSec > 0) showNotice(`Carrying on with ${name} from ${clock(progress.doneSec)}.`, 'info');

    // Opened in memory only, for a scrambled one.
    const blob = await openRecordingBlob(rec);
    // Pieces are written in order, each after the last.
    let writing = Promise.resolve();
    let writeFailed: Error | null = null;
    const onPiece = (piece: TranscriptPiece) => {
      writing = writing.then(async () => {
        if (writeFailed) return;
        try {
          progress.tail = await writeBlocks(target, id, piece.blocks, progress.tail);
          progress.doneSec = piece.doneSec;
          if (piece.blocks.length) progress.pieces++;
          await save();
        } catch (err) {
          writeFailed = err instanceof Error ? err : new Error(String(err));
          void call('cancel');
        }
      });
    };
    const onProgress = (p: { readSec?: number }) => {
      if (p.readSec != null) transcribing.update((s) => ({ ...s, readSec: p.readSec! }));
    };

    let result = await call<{ cancelled: boolean; needsPcm?: boolean; doneSec: number }>(
      'transcribe',
      { blob, fromSec: progress.doneSec },
      { onPiece, onProgress },
    );
    if (result.needsPcm && !stopAsked) {
      const pcm = await decodeHere(blob);
      result = await call('transcribe', { pcm, fromSec: progress.doneSec }, { onPiece, onProgress }, [pcm.buffer]);
    }
    await writing;
    if (writeFailed) throw writeFailed;
    if (result.cancelled || stopAsked) throw new Stopped();

    progress.state = 'done';
    progress.doneSec = rec.durationSec;
    await save();
    await finished(rec, target, progress, name);
  } catch (err) {
    if (err instanceof Stopped || err instanceof JournalLockedError || stopForLock) {
      const forUnlock = stopForLock || err instanceof JournalLockedError;
      progress.state = forUnlock ? 'waiting' : 'paused';
      progress.forUnlock = forUnlock;
      await save().catch(() => {});
      if (forUnlock) showNotice('Writing out paused while the journal is locked. It carries on after you unlock.', 'info');
    } else {
      progress.state = 'failed';
      progress.error = errorText(err);
      await save().catch(() => {});
      showNotice(`Writing out ${name} stopped: ${progress.error}${progress.deleteAfter ? ' The recording was kept.' : ''}`, 'error');
    }
  } finally {
    current = null;
    allowSleep('transcribe');
    transcribing.set(IDLE);
    void refreshRecordings();
  }
}

/** All written: delete it now if that was asked, once the words are safely in. */
async function finished(rec: Recording, target: TranscriptTarget, progress: TranscriptProgress, name: string): Promise<void> {
  const open = { action: { label: 'Open', run: opener(target) } };
  if (!progress.pieces) {
    showNotice(`No speech was found in ${name}${progress.deleteAfter ? ', so it was kept' : ''}.`, 'info');
    return;
  }
  if (!progress.deleteAfter) {
    showNotice(`Wrote out ${name}.`, 'success', open);
    return;
  }
  let saved = false;
  try {
    saved = await removeChip(target, rec.id);
  } catch {
    saved = false;
  }
  if (!saved) {
    showNotice(`Wrote out ${name}. The words couldn’t be saved just yet, so the recording was kept.`, 'info', open);
    return;
  }
  await deleteRecording(rec.id);
  showNotice(`Wrote out ${name} and deleted the recording.`, 'success', open);
}

class Stopped extends Error {}

/** Stops the transcript where it is. Write it out again carries on from there. */
export function stopTranscribing(): void {
  if (get(transcribing).phase === 'idle') return;
  stopAsked = true;
  transcribing.update((s) => ({ ...s, phase: 'stopping' }));
  if (worker) void call('cancel').catch(() => {});
}

// The journal locked part way through a journal recording's transcript: it
// pauses, and carries on after the unlock.
let wasUnlocked = false;
journalLock.subscribe((view) => {
  if (wasUnlocked && !view.unlocked && current && needsJournalKey(current) && get(transcribing).phase !== 'idle') {
    stopForLock = true;
    stopTranscribing();
  }
  wasUnlocked = view.unlocked;
});

/** Everything waiting for the unlock, in the order it was recorded. */
async function carryOnAfterUnlock(): Promise<void> {
  const all = await refreshRecordings();
  const waiting = all
    .filter((r) => r.transcript?.state === 'waiting' && r.transcript.forUnlock)
    .sort((a, b) => a.createdAt - b.createdAt);
  if (!waiting.length) return;
  if ((await missingDownloads()).length) return;
  for (const r of waiting) void transcribeRecording(r.id, { quiet: true });
}

onUnlocked(carryOnAfterUnlock);

/**
 * At launch: transcripts the app closed on, or left waiting their turn,
 * carry on by themselves once the app has settled. Signed out, they wait, as
 * their pages can't be written; a locked journal's wait for the unlock.
 */
export async function resumeWaitingTranscript(): Promise<void> {
  const all = await refreshRecordings();
  const todo = all
    .filter((r) => r.transcript?.state === 'waiting' || r.transcript?.state === 'queued')
    .sort((a, b) => a.createdAt - b.createdAt);
  if (!todo.length || !get(userProfileStore).isSignedIn) return;
  if ((await missingDownloads()).length) return;
  const ready = todo.filter((r) => !(needsJournalKey(r) && !getContentKey()));
  for (const r of todo) {
    if (ready.includes(r)) continue;
    await changeRecording(r.id, (rec) => (rec.transcript ? { ...rec, transcript: { ...rec.transcript, state: 'waiting', forUnlock: true } } : null), false);
  }
  if (!ready.length) return;
  showNotice(`Carrying on writing out ${await noticeName(ready[0])}.`, 'info');
  for (const r of ready) void transcribeRecording(r.id, { quiet: true });
}

// ── Stop ────────────────────────────────────────────────────────────────────

/** A recording just stopped, for the Stop card (StopRecordingCard.svelte) to ask about. */
export const stoppedRecording = writable<Recording | null>(null);

/** Every Stop: the page's or the day's, the pill's, the pocket screen's and Recordings'. */
export async function stopAndAsk(): Promise<void> {
  const rec = await stopRecording();
  if (rec) stoppedRecording.set(rec);
}

export type StopChoice = 'write' | 'write-delete' | 'keep';

/** The Stop card's answer. Closing it keeps the recording, which loses nothing. */
export function afterStop(choice: StopChoice): void {
  const rec = get(stoppedRecording);
  stoppedRecording.set(null);
  if (!rec) return;
  if (choice !== 'keep') {
    void transcribeRecording(rec.id, { deleteAfter: choice === 'write-delete' });
    return;
  }
  showNotice(
    rec.journal
      ? `Kept the recording (${clock(rec.durationSec)}) with the day’s entry.`
      : `Saved “${rec.name}” (${clock(rec.durationSec)}) to Recordings in Notes.`,
    'success',
  );
}

/** Deletes a recording for good, and takes its pill out of the page or day it's in. */
export async function forgetRecording(rec: Recording): Promise<void> {
  if (get(transcribing).id === rec.id) stopTranscribing();
  dequeue(rec.id);
  await deleteRecording(rec.id);
  const target = targetOf(rec);
  if (target) await removeChip(target, rec.id).catch(() => {});
}
