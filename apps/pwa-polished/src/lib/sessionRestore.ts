/**
 * What was open, brought back when the app is relaunched straight away.
 *
 * Opening a folding phone hands the app from the cover screen to the inner one
 * as a fresh launch, which used to close every panel, the Parallel view, the
 * family tree and Read Aloud. The reader's own line is kept by lib/resume for
 * any relaunch; this is the rest, and only for a quick return: the gap a fold
 * makes is a second or two, and a launch an hour later should start clean the
 * way it always has.
 *
 * Saved whenever the app is hidden or torn down, read once at launch and
 * removed, so it can never apply twice.
 */
import { get } from 'svelte/store';
import { paneStore, type PaneState } from '../stores/paneStore';
import { parallelStore, type ParallelLayout } from '../stores/parallelStore';
import { familyTreeStore } from '../stores/familyTreeStore';
import { windowStore } from './stores/windowStore';
import { openHarmonyView } from './windowTypes';
import { readingState, readingPosition, readingSource, startReading } from './tts/readingEngine';
import { showNotice } from '../stores/noticeStore';
import { SESSION_KEY as KEY, QUICK_RETURN_MS } from './resume';

interface HarmonySnapshot {
  mode: 'accounts' | 'translations';
  label: string;
  layout: ParallelLayout;
  anchorOn: boolean;
  masterIndex: number;
  sectionId: number | null;
  ref: { book: string; chapter: number; verse: number } | null;
  panes: Array<{ book: string; chapter: number; translation: string | null }>;
}

interface Snapshot {
  savedAt: number;
  panes: Array<Pick<PaneState, 'type' | 'position' | 'width' | 'height'>>;
  tree: { focusId: string | null; tribe: string | null } | null;
  harmony: HarmonySnapshot | null;
  reading: { translation: string; book: string; chapter: number; verse: number | null } | null;
}

function captureHarmony(): HarmonySnapshot | null {
  const p = get(parallelStore);
  if (!p.active || p.panes.length === 0) return null;
  const wins = get(windowStore);
  return {
    mode: p.mode,
    label: p.setLabel ?? '',
    layout: p.layout,
    anchorOn: p.anchorOn,
    masterIndex: Math.max(0, p.panes.findIndex((x) => x.paneId === p.masterId)),
    sectionId: p.currentSectionId ?? p.openSectionId,
    ref: p.currentRef,
    panes: p.panes.map((x) => {
      const cs = wins.find((w) => w.id === x.paneId)?.contentState;
      return { book: x.book, chapter: cs?.chapter ?? 1, translation: cs?.translation ?? x.translation };
    }),
  };
}

/** Write down what is open right now. Called as the app is hidden or torn down. */
export function saveSession(): void {
  try {
    const tree = get(familyTreeStore);
    const pos = get(readingPosition);
    const snap: Snapshot = {
      savedAt: Date.now(),
      panes: get(paneStore)
        .filter((p) => p.isOpen)
        .sort((a, b) => a.zIndex - b.zIndex)
        .map(({ type, position, width, height }) => ({ type, position, width, height })),
      tree: tree.isOpen ? { focusId: tree.focusId, tribe: tree.tribe } : null,
      harmony: captureHarmony(),
      // Only scripture comes back. Plain text has no Bible position to reopen
      // at, and a commentary or devotional is not picked up again on its own.
      reading:
        pos && get(readingSource).kind === 'bible' && get(readingState) === 'playing'
          ? { translation: pos.translation, book: pos.book, chapter: pos.chapter, verse: pos.verse }
          : null,
    };
    localStorage.setItem(KEY, JSON.stringify(snap));
  } catch {
    // Blocked storage: a relaunch opens with nothing extra, as it always did.
  }
}

function takeSession(): Snapshot | null {
  try {
    const raw = localStorage.getItem(KEY);
    localStorage.removeItem(KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw) as Snapshot;
    if (!snap || !(Date.now() - snap.savedAt < QUICK_RETURN_MS)) return null;
    return snap;
  } catch {
    return null;
  }
}

function restoreHarmony(h: HarmonySnapshot): void {
  const translations =
    h.mode === 'translations' && h.panes.every((p) => p.translation)
      ? h.panes.map((p) => p.translation as string)
      : undefined;
  // A comparison is one passage in every pane, so each opens on the verse the
  // master was on. A harmony lines its panes up by section, which the view
  // aims at itself once its readers are mounted.
  const ref = translations ? h.ref : null;
  openHarmonyView({
    panes: h.panes.map((p) => (ref ? { book: ref.book, chapter: ref.chapter } : { book: p.book, chapter: p.chapter })),
    label: h.label,
    sectionId: translations ? undefined : (h.sectionId ?? undefined),
    translations,
  });
  const state = get(parallelStore);
  if (!state.active) return;
  if (ref) {
    // Read by each pane's reader as it mounts, which is on the next update.
    for (const pane of state.panes) {
      windowStore.updateContentState(pane.paneId, { openAt: { ...ref, offset: 0 } });
    }
  }
  parallelStore.setLayout(h.layout);
  parallelStore.setAnchor(h.anchorOn);
  const master = state.panes[h.masterIndex]?.paneId;
  if (master) parallelStore.setMaster(master);
}

/**
 * Put back what was open before a quick relaunch. Called once, when the app
 * is ready. Read Aloud is offered rather than started: audio that begins on
 * its own the moment the phone is opened would be a surprise, and a browser
 * will not let it play before a tap anyway.
 */
export function restoreSession(): void {
  const snap = takeSession();
  if (!snap) return;

  for (const p of snap.panes ?? []) {
    paneStore.openPane(p.type, p.position);
    const opened = get(paneStore).find((x) => x.type === p.type);
    const size = p.position === 'bottom' ? p.height : p.width;
    if (opened && size != null) paneStore.resizePane(opened.id, size);
  }

  if (snap.tree) familyTreeStore.open({ focusId: snap.tree.focusId, tribe: snap.tree.tribe });

  if (snap.harmony) {
    try {
      restoreHarmony(snap.harmony);
    } catch (err) {
      console.warn('Could not bring the Parallel view back:', err);
    }
  }

  const r = snap.reading;
  if (r) {
    showNotice('Read Aloud stopped when the app reopened.', 'info', {
      action: {
        label: 'Resume',
        run: () => void startReading(r.translation, r.book, r.chapter, r.verse),
      },
    });
  }
}
