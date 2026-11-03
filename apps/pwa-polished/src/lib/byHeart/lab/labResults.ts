/**
 * The By Heart lab's results, kept on this device so a relaunch (unfolding
 * the Fold) doesn't lose a finished test, and the summary Copy results makes.
 * Comes out with the lab.
 */

import { writable, get } from 'svelte/store';
import type { FrameStats } from './frames';
import type { RunStats } from './liveRun';

export type CoverKind = 'pill' | 'wordblur' | 'box';

export const COVER_NAMES: Record<CoverKind, string> = {
  pill: 'Blur pills',
  wordblur: 'Word blur',
  box: 'Black box',
};

export interface RunResult {
  id: string;
  title: string;
  method: string;
  favor: number;
  /** Where the blur slider was, as a share of the text size. */
  blur: number;
  passage: string;
  stats: RunStats;
  /** A wrong-word run: the wrong word got through. Null otherwise. */
  falsePass: boolean | null;
  at: string;
}

export interface BlurRound {
  size: 'small' | 'large';
  fontPx: number;
  /** Blur over text size at the moment the words became readable. */
  ratio: number;
  right: boolean;
  cover: CoverKind;
}

export interface CoverSpeed {
  words: number;
  sweep: FrameStats;
  reveal: FrameStats;
  /** Word blur only: how long the blurred copy of the card takes to make. */
  buildMs: number | null;
}

export interface LimitResult {
  words: number;
  size: string;
  fontCardPx: number;
  /** What the words come to on this screen, full screen as a game shows them. */
  fontScreenPx: number;
  drawMs: number;
  readable: boolean | null;
  frames: FrameStats | null;
}

export interface LabResults {
  loadMs: number | null;
  runs: RunResult[];
  blur: BlurRound[];
  speed: Partial<Record<CoverKind, CoverSpeed>>;
  speedPassage: string;
  bestCover: CoverKind | null;
  smooth: boolean | null;
  color: Partial<Record<CoverKind, { seen: boolean; blur: number }>>;
  press: { taps: number[]; presses: number[]; cutoff: number | null; tries: number; wrongCalls: number };
  reader: { picked: string | null; words: number | null; checks: Record<string, boolean> };
  limit: LimitResult[];
  notes: string;
}

const KEY = 'by-heart-lab-results';

function empty(): LabResults {
  return {
    loadMs: null,
    runs: [],
    blur: [],
    speed: {},
    speedPassage: '',
    bestCover: null,
    smooth: null,
    color: {},
    press: { taps: [], presses: [], cutoff: null, tries: 0, wrongCalls: 0 },
    reader: { picked: null, words: null, checks: {} },
    limit: [],
    notes: '',
  };
}

function restore(): LabResults {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<LabResults>;
      // Runs from before the word check stayed with the screen don't count any more.
      return { ...empty(), ...saved, runs: (saved.runs ?? []).filter((run) => run.stats?.freshStarts != null) };
    }
  } catch {
    /* no storage, or an unreadable value: start over */
  }
  return empty();
}

export const labResults = writable<LabResults>(restore());

labResults.subscribe((r) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(r));
  } catch {
    /* no storage: they last until the app closes */
  }
});

export function patchResults(patch: Partial<LabResults>): void {
  labResults.update((r) => ({ ...r, ...patch }));
}

export function clearResults(): void {
  labResults.set(empty());
}

// ── Numbers ─────────────────────────────────────────────────────────────────

export function medianOf(xs: number[]): number | null {
  if (!xs.length) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** The blur rounds the user read right: the line for each size and overall. */
export function blurLine(rounds: BlurRound[]): { small: number | null; large: number | null; line: number | null } {
  const right = rounds.filter((r) => r.right);
  const of = (size: BlurRound['size']) => medianOf(right.filter((r) => r.size === size).map((r) => r.ratio));
  return { small: of('small'), large: of('large'), line: medianOf(right.map((r) => r.ratio)) };
}

const ms = (n: number | null | undefined) => (n == null ? '–' : `${Math.round(n)}`);
const ratio = (n: number | null | undefined) => (n == null ? '–' : n.toFixed(3));

function deviceLine(): string {
  const ua = navigator.userAgent;
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : 'Other';
  const browser = /Chrome\/(\d+)/.exec(ua)?.[0] ?? /Firefox\/(\d+)/.exec(ua)?.[0] ?? /Version\/(\d+).*Safari/.exec(ua)?.[0] ?? 'browser?';
  const memory = (navigator as { deviceMemory?: number }).deviceMemory;
  return `${os} · ${browser} · ${navigator.hardwareConcurrency ?? '?'} cores${memory ? ` · ${memory} GB` : ''} · screen ${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}`;
}

function runLines(r: RunResult): string[] {
  const s = r.stats;
  const lines = [
    `${r.title} · ${r.method} · favor ${r.favor} · blur ${r.blur.toFixed(2)} · ${r.passage}: ${s.shown}/${s.total} shown, ${s.tapped} tapped`,
    `  lag ms: median ${ms(s.lagMedian)} · 90% ${ms(s.lagP90)} · max ${ms(s.lagMax)} (${s.timed} words timed, ${s.early} early)`,
    `  passes: ${s.passes} · median ${ms(s.passMedian)} ms · max ${ms(s.passMax)} · first ${ms(s.passFirst)} → last ${ms(s.passLast)} · round trip ${ms(s.roundMedian)} · fresh starts ${s.freshStarts}`,
    `  shown at once ${s.atOnce} · after settling ${s.settled} · shown but never settled ${s.overran}`,
    `  small words dropped ${s.dropped.length}/${s.smallWords}${s.dropped.length ? ` (${s.dropped.join(', ')})` : ''}`,
  ];
  if (r.falsePass != null) lines.push(`  wrong word got through: ${r.falsePass ? 'YES' : 'no'}`);
  if (s.alike.length) lines.push(`  passed as sound-alikes: ${s.alike.join(', ')}`);
  if (s.wrong.length) lines.push(`  heard but wrong: ${s.wrong.join(', ')}`);
  lines.push(`  heard: ${s.heard}`);
  if (s.lastGuess) lines.push(`  last guess: ${s.lastGuess}`);
  return lines;
}

const yesNo = (v: boolean | null | undefined) => (v == null ? 'not answered' : v ? 'yes' : 'no');

/** Everything so far, as text to paste back. */
export function resultsText(): string {
  const r = get(labResults);
  const out: string[] = ['BY HEART LAB', deviceLine(), `Whistle load: ${ms(r.loadMs)} ms`, ''];

  out.push('LIVE RUNS');
  if (!r.runs.length) out.push('  none yet');
  for (const run of r.runs) out.push(...runLines(run));
  const sample = r.runs.find((run) => run.stats.sample)?.stats.sample;
  const timed = r.runs.reduce((a, run) => a + run.stats.timed, 0);
  out.push(`Word timings: ${timed ? `yes, ${timed} words timed across the runs` : 'none seen yet'}`);
  if (sample) out.push(`  a reply: ${sample}`);
  out.push('');

  const line = blurLine(r.blur);
  out.push('BLUR LINE (blur ÷ text size)');
  for (const b of r.blur) out.push(`  ${b.size} ${Math.round(b.fontPx)}px · ${COVER_NAMES[b.cover]}: ${ratio(b.ratio)} ${b.right ? 'read right' : 'read WRONG'}`);
  out.push(`  small ${ratio(line.small)} · large ${ratio(line.large)} · line ${ratio(line.line)}`, '');

  out.push(`PILLS AND SPEED (${r.speedPassage || 'not run'})`);
  for (const kind of Object.keys(COVER_NAMES) as CoverKind[]) {
    const s = r.speed[kind];
    if (!s) continue;
    out.push(
      `  ${COVER_NAMES[kind]}, ${s.words} words: slider ${s.sweep.fps} fps, worst ${s.sweep.worst} ms, ${s.sweep.slow} slow · reveal ${s.reveal.fps} fps, worst ${s.reveal.worst} ms, ${s.reveal.slow} slow${s.buildMs != null ? ` · blurred copy ${ms(s.buildMs)} ms` : ''}`,
    );
  }
  out.push(`  best look: ${r.bestCover ? COVER_NAMES[r.bestCover] : 'not answered'} · looked smooth: ${yesNo(r.smooth)}`, '');

  out.push('WORD COLOR THROUGH BLUR');
  for (const kind of Object.keys(COVER_NAMES) as CoverKind[]) {
    const c = r.color[kind];
    if (c) out.push(`  ${COVER_NAMES[kind]} at blur ${c.blur.toFixed(2)}: green ${c.seen ? 'shows' : 'does NOT show'}`);
  }
  if (!Object.keys(r.color).length) out.push('  not answered');
  out.push('');

  const p = r.press;
  out.push('TAP AND PRESS');
  out.push(`  taps ms: ${p.taps.map(Math.round).join(', ') || '–'}`);
  out.push(`  presses ms: ${p.presses.map(Math.round).join(', ') || '–'}`);
  out.push(`  cutoff: ${ms(p.cutoff)} ms · tried ${p.tries}, wrong calls ${p.wrongCalls}`, '');

  out.push('SIMPLE READER');
  out.push(`  last pick: ${r.reader.picked ?? 'none'}${r.reader.words != null ? ` (${r.reader.words} words)` : ''}`);
  for (const [check, ok] of Object.entries(r.reader.checks)) out.push(`  ${check}: ${yesNo(ok)}`);
  out.push('');

  out.push('WORD LIMIT');
  if (!r.limit.length) out.push('  not run');
  for (const l of r.limit) {
    out.push(
      `  ${l.words} words, ${l.size}: ${Math.round(l.fontCardPx)}px on the card, ${l.fontScreenPx.toFixed(1)}px on this screen · drawn in ${ms(l.drawMs)} ms · readable: ${yesNo(l.readable)}${l.frames ? ` · pills ${l.frames.fps} fps, worst ${l.frames.worst} ms` : ''}`,
    );
  }
  out.push('');

  if (r.notes.trim()) out.push('NOTES', r.notes.trim());
  return out.join('\n').trim();
}
