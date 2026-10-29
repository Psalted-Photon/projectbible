/**
 * What a recording's pill in the writing says (lib/lexical/RecordingNode.ts).
 *
 * The page only holds the recording's id. Everything shown comes from this
 * device: the recorder, the line of transcripts, the recordings themselves
 * and the journal lock. Every pill on screen is repainted when any of those
 * change. The length is all a pill ever shows of a recording, never its name.
 */

import { get } from 'svelte/store';
import { clock, recordings, recordingsLoaded, refreshRecordings, type Recording } from './recordings';
import { recorder } from './recorder';
import { transcribing, transcribeQueue } from '../voice/transcribe';
import { journalLock } from '../journalLock/lockState';

export type ChipState = 'loading' | 'live' | 'paused' | 'saving' | 'queued' | 'writing' | 'waiting' | 'ready' | 'locked' | 'missing';

export interface ChipStatus {
  state: ChipState;
  /** What the pill says. */
  label: string;
  rec: Recording | null;
}

/** How far a transcript has got, 0–100. */
export function writtenPercent(readSec: number, totalSec: number): number {
  return totalSec ? Math.min(100, Math.round((readSec / totalSec) * 100)) : 0;
}

export function chipStatus(recId: string): ChipStatus {
  const r = get(recorder);
  const rec = get(recordings).find((x) => x.id === recId) ?? null;
  if (r.id === recId && r.phase !== 'idle') {
    if (r.phase === 'paused') return { state: 'paused', label: 'Paused', rec };
    if (r.phase === 'stopping') return { state: 'saving', label: 'Saving…', rec };
    return { state: 'live', label: 'Recording', rec };
  }
  if (!rec) {
    return get(recordingsLoaded) ? { state: 'missing', label: 'On another device', rec } : { state: 'loading', label: 'Recording', rec };
  }
  const t = get(transcribing);
  if (t.id === recId) {
    const label = t.phase === 'loading' ? 'Writing it out…' : `Writing ${writtenPercent(t.readSec, rec.durationSec)}%`;
    return { state: 'writing', label, rec };
  }
  if (get(transcribeQueue).includes(recId) || rec.transcript?.state === 'queued') {
    return { state: 'queued', label: 'Waiting its turn', rec };
  }
  if (rec.transcript?.state === 'waiting') {
    return { state: 'waiting', label: rec.transcript.forUnlock ? 'Waiting for unlock' : 'Waiting to carry on', rec };
  }
  if (rec.scrambled && !get(journalLock).unlocked) return { state: 'locked', label: clock(rec.durationSec), rec };
  return { state: 'ready', label: clock(rec.durationSec), rec };
}

// ── Painting ────────────────────────────────────────────────────────────────

/** Phosphor's fill icons (256 × 256), drawn by hand: the pill is plain DOM inside the editor. */
const ICON: Partial<Record<ChipState, string>> = {
  ready:
    'M240,128a15.74,15.74,0,0,1-7.6,13.51L88.32,229.65a16,16,0,0,1-16.2.3A15.86,15.86,0,0,1,64,216.13V39.87a15.86,15.86,0,0,1,8.12-13.82,16,16,0,0,1,16.2.3L232.4,114.49A15.74,15.74,0,0,1,240,128Z',
  locked:
    'M208,80H176V56a48,48,0,0,0-96,0V80H48A16,16,0,0,0,32,96V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V96A16,16,0,0,0,208,80Zm-80,84a12,12,0,1,1,12-12A12,12,0,0,1,128,164Zm32-84H96V56a32,32,0,0,1,64,0Z',
  missing:
    'M80,128V64a48,48,0,0,1,96,0v64a48,48,0,0,1-96,0Zm128,0a8,8,0,0,0-16,0,64,64,0,0,1-128,0,8,8,0,0,0-16,0,80.11,80.11,0,0,0,72,79.6V240a8,8,0,0,0,16,0V207.6A80.11,80.11,0,0,0,208,128Z',
  queued:
    'M200,75.64V40a16,16,0,0,0-16-16H72A16,16,0,0,0,56,40V76a16.08,16.08,0,0,0,6.41,12.8L114.67,128,62.4,167.2A16.07,16.07,0,0,0,56,180v36a16,16,0,0,0,16,16H184a16,16,0,0,0,16-16V180.36a16,16,0,0,0-6.36-12.77L141.26,128l52.38-39.59A16.05,16.05,0,0,0,200,75.64Z',
};
ICON.loading = ICON.missing;
ICON.waiting = ICON.queued;

const TITLE: Record<ChipState, string> = {
  loading: 'A recording',
  live: 'Recording now. Tap to stop.',
  paused: 'Recording, paused. Tap to stop.',
  saving: 'Saving the recording',
  queued: 'Waiting its turn to be written out',
  writing: 'Being written out',
  waiting: 'Waiting to carry on writing it out',
  ready: 'A recording. Tap to play it, write it out or delete it.',
  locked: 'A recording, locked with the journal',
  missing: 'This recording is on another device.',
};

function draw(el: HTMLElement, recId: string): void {
  const s = chipStatus(recId);
  const drawn = `${s.state}|${s.label}`;
  if (el.dataset.drawn === drawn) return;
  el.dataset.drawn = drawn;
  el.dataset.rec = recId;
  el.className = `rec-chip is-${s.state}`;
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', `${TITLE[s.state]} ${s.label}`);
  el.title = TITLE[s.state];
  const live = s.state === 'live' || s.state === 'paused' || s.state === 'saving';
  const icon = ICON[s.state];
  el.innerHTML = live
    ? '<i class="rec-chip-dot" aria-hidden="true"></i><span class="rec-chip-label"></span>'
    : `${icon ? `<svg class="rec-chip-icon" viewBox="0 0 256 256" aria-hidden="true"><path fill="currentColor" d="${icon}"/></svg>` : ''}<span class="rec-chip-label"></span>`;
  (el.lastElementChild as HTMLElement).textContent = s.label;
}

let watching = false;
let frame = 0;

function repaintAll(): void {
  if (frame || typeof document === 'undefined') return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    document.querySelectorAll<HTMLElement>('.rec-chip[data-rec]').forEach((el) => draw(el, el.dataset.rec!));
  });
}

function watch(): void {
  if (watching) return;
  watching = true;
  recorder.subscribe(repaintAll);
  recordings.subscribe(repaintAll);
  recordingsLoaded.subscribe(repaintAll);
  transcribing.subscribe(repaintAll);
  transcribeQueue.subscribe(repaintAll);
  journalLock.subscribe(repaintAll);
  if (!get(recordingsLoaded)) void refreshRecordings();
}

/** Called by RecordingNode for each pill it makes. */
export function paintChip(el: HTMLElement, recId: string): void {
  watch();
  el.classList.add('rec-chip');
  draw(el, recId);
}
