/**
 * Voice Control: a spoken or typed command in, the app's actions out.
 *
 * Whistle and Needle run in their own worker (voiceWorker.ts), loaded from the
 * files voicePack.ts downloaded, on the first command of the session. The
 * worker hands back Needle's picks already put right by the rules; this side
 * decides whether to go ahead, ask "Did you mean…?" or reply, and carries the
 * actions out (actions.ts).
 *
 * How a turn is decided, from the lab: Needle's confidence doesn't separate
 * right picks from wrong ones, so a piece whose trigger words left one action
 * goes ahead. Otherwise its confidence decides: at 0.8 it goes ahead, at 0.4
 * it asks, and below that it's "Didn't catch that". Several commands go ahead
 * only when every one does. A quoted verse goes to that verse.
 */

import { writable } from 'svelte/store';
import { unlockTtsAudio } from '../../adapters/tts';
import { showNotice } from '../../stores/noticeStore';
import { runCall, describeCall } from './actions';
import type { VoiceCall, VoiceChoice, VoicePiece } from './voiceWorker';

/** Where loading has got to, for the first command of a session. */
export const voiceLoadStage = writable<string | null>(null);

const STAGES: Record<string, string> = {
  engine: 'Starting Voice Control…',
  whistle: 'Loading Whistle…',
  needle: 'Loading Needle…',
  verses: 'Reading the verses…',
};

// ── The worker ──────────────────────────────────────────────────────────────

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; onStage?: (s: string) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./voiceWorker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event) => {
    const { id, ok, result, error, progress } = event.data ?? {};
    const entry = pending.get(id);
    if (!entry) return;
    if (progress) {
      entry.onStage?.(progress.stage);
      return;
    }
    pending.delete(id);
    if (ok) entry.resolve(result);
    else entry.reject(new Error(error || 'Voice Control failed'));
  };
  worker.onerror = (event) => {
    for (const [id, entry] of pending) {
      entry.reject(new Error(`Voice Control stopped: ${event.message}`));
      pending.delete(id);
    }
    worker?.terminate();
    worker = null;
    loaded = null;
  };
  return worker;
}

function call<T>(action: string, payload?: Record<string, unknown>, onStage?: (s: string) => void, transfer: Transferable[] = []): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject, onStage });
    getWorker().postMessage({ id, action, payload }, transfer);
  });
}

let loaded: Promise<void> | null = null;

/** Load the models, once a session. A failed load isn't kept, so the next command tries again. */
export function loadVoiceControl(): Promise<void> {
  if (!loaded) {
    loaded = call<void>('load', {}, (stage) => voiceLoadStage.set(STAGES[stage] ?? null))
      .catch((error) => {
        loaded = null;
        throw error;
      })
      .finally(() => voiceLoadStage.set(null));
  }
  return loaded;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** What Needle is told about now and here, with every command. */
function systemFacts(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const device = /Mobi|Android/i.test(navigator.userAgent) ? 'phone' : 'computer';
  return `date: ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${DAYS[d.getDay()]} ${p(d.getHours())}:${p(d.getMinutes())}; locale: ${navigator.language}; device: ${device}`;
}

// ── Deciding ────────────────────────────────────────────────────────────────

const SINGLE_FLOOR = 0.2;
const ACT_AT = 0.8;
const ASK_AT = 0.4;

const CANT_ANSWER = "I can steer the wheel, but can't answer questions.";
const NOT_CAUGHT = "Didn't catch that.";
/** The map, people, timeline and the other lookups, which voice can't open yet. */
const NOT_YET = "I can't do that one yet.";
const QUESTION_RE = /^\s*(who|whom|whose|what|what's|whats|when|where|why|how|which|is|are|was|were|does|do|did|can|could|will|would|should)\b|\?\s*$/i;

type Verdict = 'act' | 'ask' | 'no';

function verdictOf(p: VoicePiece): Verdict {
  const c = p.confidence;
  if (!p.calls.length) return 'no';
  if (p.refProblem) return p.refProblem.startsWith('Did you mean') ? 'ask' : 'no';
  if (p.promoted) return 'act';
  if (p.single && (c == null || c >= SINGLE_FLOOR || p.grounded)) return 'act';
  if (c == null || c >= ACT_AT) return 'act';
  return c >= ASK_AT ? 'ask' : 'no';
}

export type VoicePlan =
  | { kind: 'act'; calls: VoiceCall[] }
  | { kind: 'ask'; question: string; calls: VoiceCall[] }
  | { kind: 'reply'; text: string };

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * What to do with what was said: Needle's picks as the worker settled them,
 * unless the words quote a verse (most of what was said, or Needle had nothing
 * better than a search or a bare book).
 */
export function decide(said: string, choice: VoiceChoice | null): VoicePlan {
  if (!choice) return { kind: 'reply', text: NOT_CAUGHT };
  if (choice.noop != null) return { kind: 'reply', text: choice.noop };
  const verdicts = choice.pieces.map(verdictOf);
  const calls = choice.pieces.flatMap((p) => p.calls);
  const all = verdicts.length > 0 && verdicts.every((v) => v === 'act');
  const q = choice.quote;
  if (q?.ref) {
    const strong = q.whole || ((q.run ?? 0) >= 4 && (q.run ?? 0) / (q.of ?? 1) >= 0.75);
    const weak = !calls.length || !all
      || calls.every((c) => c.name === 'search' || (c.name === 'passage' && !/\d/.test(String(c.args.reference ?? ''))));
    if (strong || weak) return { kind: 'act', calls: [{ name: 'passage', args: { reference: q.ref } }] };
  }
  if (all) return { kind: 'act', calls };
  const kept = choice.pieces.filter((_, i) => verdicts[i] !== 'no');
  if (kept.length) {
    const keptCalls = kept.flatMap((p) => p.calls);
    const problem = kept.length === 1 ? kept[0].refProblem : null;
    return { kind: 'ask', question: problem ?? `Did you mean: ${sentence(keptCalls.map(describeCall).join(', then '))}?`, calls: keptCalls };
  }
  const refProblem = choice.pieces.map((p) => p.refProblem).find(Boolean);
  if (refProblem) return { kind: 'reply', text: refProblem };
  if (choice.pieces.some((p) => p.notYet)) return { kind: 'reply', text: NOT_YET };
  return { kind: 'reply', text: QUESTION_RE.test(said) ? CANT_ANSWER : NOT_CAUGHT };
}

// ── Carrying it out ─────────────────────────────────────────────────────────

/** One command, start to finish, for whoever shows it. */
export interface VoiceOutcome {
  heard: string;
  plan: VoicePlan;
  /** What each action did, in order. */
  done: string[];
}

async function runCalls(calls: VoiceCall[]): Promise<string[]> {
  const done: string[] = [];
  for (const c of calls) {
    try {
      done.push(await runCall(c));
    } catch (error) {
      console.error('[Voice] action failed:', c, error);
      done.push(`${c.name} failed`);
    }
  }
  return done;
}

async function carryOut(heard: string, plan: VoicePlan): Promise<VoiceOutcome> {
  if (plan.kind === 'act') return { heard, plan, done: await runCalls(plan.calls) };
  if (plan.kind === 'ask') {
    showNotice(plan.question, 'info', { action: { label: 'Yes', run: () => void runCalls(plan.calls) } });
  } else if (plan.text) {
    showNotice(plan.text, 'info');
  }
  return { heard, plan, done: [] };
}

/**
 * Call at the start of the tap or press that gives the command, before any
 * wait: Read Aloud can only start playing from a gesture, and this unlocks it.
 */
export function voiceGesture(): void {
  unlockTtsAudio();
}

/** A spoken command: 16 kHz mono speech, start to finish. */
export async function hearCommand(pcm: Float32Array): Promise<VoiceOutcome> {
  await loadVoiceControl();
  const { heard, choice } = await call<{ heard: string; choice: VoiceChoice | null }>('command', { pcm, system: systemFacts() }, undefined, [pcm.buffer as ArrayBuffer]);
  return carryOut(heard, decide(heard, choice));
}

/** A typed command, the same way, without Whistle. */
export async function typedCommand(text: string): Promise<VoiceOutcome> {
  await loadVoiceControl();
  const choice = await call<VoiceChoice>('choose', { text, system: systemFacts() });
  return carryOut(text, decide(text, choice));
}
