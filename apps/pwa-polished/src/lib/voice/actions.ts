/**
 * Voice Control's actions: what each of Needle's picks does in the app.
 *
 * Every one calls code the app already has, so a voice command does exactly
 * what the same tap would: the search bar's reference reader for a passage,
 * the window pickers' openers, the highlighter's own save, Read Aloud's start
 * and pause. Each says what it did in a short line, and anything that can't be
 * done ("isn't in the app", "isn't downloaded yet") is said in a notice.
 */

import { get } from 'svelte/store';
import type { HighlightStyle } from '@projectbible/core';
import { navigationStore, availableTranslations, lookupReader, switchTranslation, MAIN_READER } from '../../stores/navigationStore';
import { windowStore, type WindowContentType } from '../stores/windowStore';
import { openWindowOfType, harmonyPickerRequest, type WindowContentChoice } from '../windowTypes';
import { readQueryAsRef, verseCount } from '../bibleRefs';
import { findRefs } from './rules';
import { bibleWord } from './soundAlikes';
import type { VoiceCall } from './voiceWorker';
import { IndexedDBCommentaryStore } from '../../adapters/CommentaryStore';
import { lexicalModalStore } from '../../stores/lexicalModalStore';
import { strongsModalStore } from '../../stores/strongsModalStore';
import { lookupStore } from '../../stores/lookupStore';
import { familyTreeStore } from '../../stores/familyTreeStore';
import { searchQuery, triggerSearch } from '../../stores/searchStore';
import { voiceHighlightRequest } from '../../stores/voiceHighlightStore';
import { showNotice, type NoticeAction } from '../../stores/noticeStore';
import { closeLookupCard } from '../openWork';
import { classicId } from '../strongs/entry';
import { HIGHLIGHT_PALETTE } from '../highlightCategories';
import { PACK_CATALOG, installPack } from '../packInstaller';
import { voiceForTap, useVoice } from '../tts/voiceForTap';
import { canSpeakOriginal } from '../tts/originalText';
import { originalLanguageOf } from '../translationKind';
import {
  readingState,
  readingPosition,
  startReading,
  pauseReading,
  resumeReading,
  jumpToVerse,
} from '../tts/readingEngine';

const say = (text: string, action?: NoticeAction) => showNotice(text, 'info', action ? { action } : {});

/** A missing pack, offered for download right in the notice. */
function offerPack(packId: string, text: string): string {
  const pack = PACK_CATALOG.find((p) => p.id === packId);
  say(text, pack ? { label: 'Download', run: () => void installPack(pack) } : undefined);
  return text;
}

/** The main reader goes there, leaving a crumb so Back returns. */
function goTo(book: string, chapter: number, verse: number | null) {
  const nav = get(navigationStore);
  navigationStore.pushHistory(nav, 'voice');
  navigationStore.navigateTo(nav.translation, book, chapter, verse);
}

// ── Passage ─────────────────────────────────────────────────────────────────

function passage(reference: unknown): string {
  const spoken = String(reference ?? '').trim();
  const ref = readQueryAsRef(spoken);
  if (ref?.kind === 'overflow') {
    say(`${ref.message}.`);
    return ref.message;
  }
  if (!ref) {
    say(`Couldn't find ${spoken || 'that passage'}.`);
    return `No passage "${spoken}"`;
  }
  goTo(ref.book, ref.chapter, ref.kind === 'ref' ? ref.verse : null);
  return `Went to ${ref.label}`;
}

// ── Commentary ──────────────────────────────────────────────────────────────

/** The commentaries the app ships, for matching a spoken name. */
const COMMENTARY_AUTHORS = [
  'A.T. Robertson', 'Abbott', 'Adam Clarke', 'Albert Barnes', 'Charles Spurgeon',
  'E.W. Bullinger', 'Family Bible Notes', 'Jamieson-Fausset-Brown', 'John Calvin',
  'John Lightfoot', 'John Wesley', 'KingComments', 'Martin Luther', 'Matthew Henry',
  'Thomas Aquinas (Catena Aurea)', 'Treasury of Scripture Knowledge',
];

const squash = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

/** The commentary a spoken name means, or null. */
function findCommentary(spoken: string): string | null {
  const s = squash(spoken);
  if (!s) return null;
  for (const a of COMMENTARY_AUTHORS) {
    const full = squash(a);
    if (full.includes(s) || s.includes(full)) return a;
    // Any one name of the author on its own ("henry", "calvin").
    const words = a.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
    if (words.some((w) => s === w || s.endsWith(w))) return a;
  }
  if (s === 'jfb') return 'Jamieson-Fausset-Brown';
  if (s === 'tsk') return 'Treasury of Scripture Knowledge';
  return null;
}

const commentaries = new IndexedDBCommentaryStore();

async function commentary(a: Record<string, any>): Promise<string> {
  const installed = await commentaries.getAuthors();
  if (!installed.length) return offerPack('commentaries', "The commentaries aren't downloaded yet.");
  let author: string | undefined;
  if (a.author) {
    const known = findCommentary(String(a.author));
    author = known
      ? installed.find((i) => squash(i) === squash(known)) ?? installed.find((i) => findCommentary(i) === known)
      : undefined;
    if (!author) {
      say(`${a.author} isn't in the app.`);
      return `No commentary "${a.author}"`;
    }
  }
  const place = a.at ? readQueryAsRef(String(a.at)) : null;
  const state: Record<string, unknown> = {
    ...(author ? { author } : {}),
    ...(place?.kind === 'ref' ? { book: place.book, chapter: place.chapter, highlightedVerse: place.verse } : {}),
  };
  const where = place?.kind === 'ref' ? ` at ${place.label}` : '';
  const open = a.new_window ? undefined : get(windowStore).find((w) => w.contentType === 'commentaries');
  if (open) {
    windowStore.updateContentState(open.id, state);
    return `Showed ${author ?? 'the commentary'}${where}`;
  }
  if (!openWindowOfType('commentaries', state)) return 'No room for another window';
  return `Opened ${author ?? 'the commentary'}${where}${a.new_window ? ' in a new window' : ''}`;
}

// ── Word study and Strong's ─────────────────────────────────────────────────

function wordStudy(word: unknown): string {
  const w = bibleWord(word);
  if (!w) {
    say("Didn't catch the word.");
    return 'No word';
  }
  lookupReader.set(MAIN_READER);
  lexicalModalStore.open({ selectedText: w, strongsId: undefined, morphologyData: null, lexicalEntries: null });
  return `Word study on "${w}"`;
}

function strongs(query: unknown): string {
  const q = String(query ?? '').trim();
  const num = /^([GH])(\d{1,4})$/i.exec(q.replace(/\s+/g, ''));
  lookupReader.set(MAIN_READER);
  if (num) {
    strongsModalStore.open({ strongsId: classicId(num[1] + num[2]) });
    return `Strong's ${num[1].toUpperCase()}${num[2]}`;
  }
  strongsModalStore.open({ strongsId: null, search: q || null });
  return q ? `Strong's, searched for "${q}"` : "Opened Strong's";
}

// ── Highlights ──────────────────────────────────────────────────────────────

/** The highlighter's looks, from the words tidy() leaves. */
const LOOK_STYLES: Record<string, Omit<HighlightStyle, 'color'>> = {
  marker: { type: 'background' },
  letters: { type: 'text-color' },
  underline: { type: 'underline', underlineStyle: 'solid' },
  dashed: { type: 'underline', underlineStyle: 'dashed' },
  squiggle: { type: 'underline', underlineStyle: 'wavy' },
  box: { type: 'underline', underlineStyle: 'boxed' },
};

function styleFor(color: string, look: unknown): HighlightStyle | null {
  const hex = HIGHLIGHT_PALETTE.find((p) => p.label.toLowerCase() === color.toLowerCase())?.value;
  if (!hex) return null;
  return { ...(LOOK_STYLES[String(look ?? '')] ?? LOOK_STYLES.marker), color: hex };
}

const range = (a: number, b: number) => Array.from({ length: Math.abs(b - a) + 1 }, (_, i) => Math.min(a, b) + i);

/**
 * Which verses were meant: "16", "16 to 18", "3 and 4" in the chapter on
 * screen, "all of chapter 1" in this book, or a reference of their own
 * ("john 3:16").
 */
function highlightTarget(spoken: string): { book: string; chapter: number; verses: number[] } | null {
  const nav = get(navigationStore);
  const [ref] = findRefs(spoken);
  if (ref) {
    const q = readQueryAsRef(ref.text.replace(/-\d+$/, ''));
    if (q?.kind !== 'ref') return null;
    const n = verseCount(q.book, q.chapter) ?? q.verse;
    if (!ref.text.includes(':')) return { book: q.book, chapter: q.chapter, verses: range(1, n) };
    const end = /-(\d+)$/.exec(ref.text);
    return { book: q.book, chapter: q.chapter, verses: range(q.verse, Math.min(n, end ? +end[1] : q.verse)) };
  }
  const s = spoken.toLowerCase();
  const ch = /\bchapter\s+(\d+)/.exec(s);
  const chapter = ch ? +ch[1] : nav.chapter;
  const n = verseCount(nav.book, chapter);
  if (!n) return null;
  const body = s.replace(/\bchapter\s+\d+/, ' ');
  if (/\b(all|whole|entire|every)\b/.test(s) || (ch && !/\d/.test(body))) return { book: nav.book, chapter, verses: range(1, n) };
  const verses = new Set<number>();
  for (const m of body.matchAll(/(\d+)(?:\s*(?:-|–|to|through|thru)\s*(\d+))?/g)) {
    for (const v of range(+m[1], m[2] ? +m[2] : +m[1])) if (v >= 1 && v <= n) verses.add(v);
  }
  return verses.size ? { book: nav.book, chapter, verses: [...verses].sort((a, b) => a - b) } : null;
}

const versesLabel = (book: string, chapter: number, verses: number[]) =>
  `${book} ${chapter}:${verses.length > 1 && verses[verses.length - 1] - verses[0] === verses.length - 1 ? `${verses[0]}-${verses[verses.length - 1]}` : verses.join(', ')}`;

function highlight(a: Record<string, any>): string {
  const target = highlightTarget(String(a.verses ?? ''));
  if (!target) {
    say("Didn't catch which verses.");
    return 'No verses';
  }
  const style = a.color ? styleFor(String(a.color), a.look) : null;
  const nav = get(navigationStore);
  if (target.book !== nav.book || target.chapter !== nav.chapter) goTo(target.book, target.chapter, target.verses[0]);
  voiceHighlightRequest.set({ ...target, style });
  const label = versesLabel(target.book, target.chapter, target.verses);
  return style ? `Highlighted ${label} ${a.color}${a.look ? ` (${a.look})` : ''}` : `Opened the highlighter on ${label}`;
}

// ── Search ──────────────────────────────────────────────────────────────────

function search(query: unknown): string {
  const q = String(query ?? '').trim();
  if (!q) {
    say("Didn't catch what to search for.");
    return 'No search words';
  }
  searchQuery.set(q);
  triggerSearch.update((n) => n + 1);
  return `Searched for "${q}"`;
}

// ── Windows ─────────────────────────────────────────────────────────────────

const OPENS: Record<string, WindowContentChoice> = { Bible: 'bible', Art: 'art', Notes: 'notes', Journal: 'journal' };

function openWindow(name: unknown): string {
  if (name === 'Harmonies') {
    harmonyPickerRequest.update((n) => n + 1);
    return 'Opened the Harmonies';
  }
  const type = OPENS[String(name)];
  if (!type) {
    say("Didn't catch which window.");
    return 'No window';
  }
  return openWindowOfType(type) ? `Opened ${name}` : 'No room for another window';
}

const CLOSES: Record<string, WindowContentType> = {
  Bible: 'bible', Connections: 'connections', Commentary: 'commentaries', Encyclopedia: 'isbe',
  People: 'person', Topical: 'naves', Strongs: 'strongs', Map: 'map', Timeline: 'timeline',
  Art: 'art', Notes: 'notes', Journal: 'journal',
};
/** Works the lookup card shows, by the window names said for them. */
const CARD_WORKS: Record<string, string> = { Encyclopedia: 'encyclopedia', People: 'people', Topical: 'topical', Strongs: 'strongs' };

/**
 * Close what was named, or with no name the thing on top: the lookup card, the
 * family tree, then the newest window. Harmony panes belong to their view and
 * are left to its own ×.
 */
function closeWindow(name: unknown): string {
  const windows = get(windowStore).filter((w) => !w.transient);
  const card = get(lookupStore);
  const tree = get(familyTreeStore).isOpen;
  if (name === 'all') {
    if (card) closeLookupCard();
    if (tree) familyTreeStore.close();
    for (const w of windows) windowStore.closeWindow(w.id);
    return 'Closed everything';
  }
  if (name === 'Harmonies') {
    say('Close the Harmonies with its × button.');
    return 'Left the Harmonies open';
  }
  if (name === 'Family Tree') {
    if (!tree) {
      say("The family tree isn't open.");
      return 'No family tree open';
    }
    familyTreeStore.close();
    return 'Closed the family tree';
  }
  if (!name) {
    if (card) {
      closeLookupCard();
      return 'Closed the lookup card';
    }
    if (tree) {
      familyTreeStore.close();
      return 'Closed the family tree';
    }
    const last = windows[windows.length - 1];
    if (!last) {
      say('Nothing is open to close.');
      return 'Nothing to close';
    }
    windowStore.closeWindow(last.id);
    return 'Closed the newest window';
  }
  const type = CLOSES[String(name)];
  const win = type && [...windows].reverse().find((w) => w.contentType === type);
  if (win) {
    windowStore.closeWindow(win.id);
    return `Closed ${name}`;
  }
  if (card && card === CARD_WORKS[String(name)]) {
    closeLookupCard();
    return `Closed ${name}`;
  }
  say(`No ${name} window is open.`);
  return `No ${name} open`;
}

// ── Read Aloud ──────────────────────────────────────────────────────────────

async function readAloud(fromVerse: unknown): Promise<string> {
  const verse = Number(fromVerse) > 0 ? Math.floor(Number(fromVerse)) : null;
  const nav = get(navigationStore);
  const state = get(readingState);
  const at = get(readingPosition);
  const live = state === 'playing' || state === 'paused';
  if (live && at?.book === nav.book && at?.chapter === nav.chapter && verse != null) {
    jumpToVerse(verse);
    if (state === 'paused') resumeReading();
    return `Reading from verse ${verse}`;
  }
  if (state === 'paused' && verse == null) {
    resumeReading();
    return 'Reading again';
  }
  const greek = originalLanguageOf(nav.translation) === 'greek' && canSpeakOriginal(nav.translation);
  const check = await voiceForTap(greek);
  if (check.status !== 'ready') {
    say(
      check.status === 'downloading'
        ? 'The Read Aloud voice is still downloading.'
        : 'Read Aloud needs its voice first: tap the speaker under the chapter title.',
    );
    return 'No voice yet';
  }
  useVoice(check.voiceId, greek);
  await startReading(nav.translation, nav.book, nav.chapter, verse);
  return verse != null ? `Reading ${nav.book} ${nav.chapter} from verse ${verse}` : `Reading ${nav.book} ${nav.chapter}`;
}

function stopReading(): string {
  if (get(readingState) !== 'playing') {
    say('Nothing is being read aloud.');
    return 'Nothing to pause';
  }
  pauseReading();
  return 'Paused reading';
}

// ── Translation ─────────────────────────────────────────────────────────────

/** Needle's names for the translations, as the app's ids, best first. */
const TRANSLATION_IDS: Record<string, string[]> = {
  KJV: ['KJV'], WEB: ['WEB'], BSB: ['BSB'], NET: ['NET'], LXX: ['LXX', 'LXX2012'], Byzantine: ['BYZ'], 'Textus Receptus': ['TR'],
};
const TRANSLATION_PACKS: Record<string, string> = {
  KJV: 'translations', WEB: 'translations', BSB: 'translations', LXX: 'ancient-languages', Byzantine: 'ancient-languages', 'Textus Receptus': 'ancient-languages',
};

function translation(name: unknown): string {
  const key = String(name ?? '');
  const installed = get(availableTranslations);
  const id = (TRANSLATION_IDS[key] ?? []).map((t) => installed.find((i) => i.toUpperCase() === t)).find(Boolean);
  if (!id) {
    const pack = TRANSLATION_PACKS[key];
    if (pack) return offerPack(pack, `${key} isn't downloaded yet.`);
    say("Didn't catch which translation.");
    return 'No translation';
  }
  switchTranslation(id);
  return `Switched to ${key}`;
}

// ── All of them ─────────────────────────────────────────────────────────────

/** Carry out one call. Returns what was done, in a short line. */
export async function runCall(call: VoiceCall): Promise<string> {
  const a = call.args;
  switch (call.name) {
    case 'passage': return passage(a.reference);
    case 'commentary': return commentary(a);
    case 'word_study': return wordStudy(a.word);
    case 'strongs': return strongs(a.query);
    case 'highlight': return highlight(a);
    case 'search': return search(a.query);
    case 'window': return openWindow(a.window);
    case 'close_window': return closeWindow(a.window);
    case 'read_aloud': return readAloud(a.from_verse);
    case 'stop_reading': return stopReading();
    case 'translation': return translation(a.translation);
    default: return `Can't do ${call.name} yet`;
  }
}

/** What a call would do, in words for "Did you mean…?". */
export function describeCall(call: VoiceCall): string {
  const a = call.args;
  switch (call.name) {
    case 'passage': return `go to ${a.reference}`;
    case 'commentary': return `open ${a.author ?? 'the commentary'}${a.at ? ` at ${a.at}` : ''}${a.new_window ? ' in a new window' : ''}`;
    case 'word_study': return `a word study on "${bibleWord(a.word)}"`;
    case 'strongs': return a.query ? `Strong's ${a.query}` : "open Strong's";
    case 'highlight': return `${a.color ? 'highlight' : 'select'} ${/^\d/.test(String(a.verses)) ? 'verse ' : ''}${a.verses}${a.color ? ` in ${a.color}` : ''}`;
    case 'search': return `search for "${a.query}"`;
    case 'window': return `open ${a.window}`;
    case 'close_window': return a.window === 'all' ? 'close everything' : a.window ? `close ${a.window}` : 'close the window on top';
    case 'read_aloud': return a.from_verse ? `read aloud from verse ${a.from_verse}` : 'read aloud';
    case 'stop_reading': return 'pause reading';
    case 'translation': return `switch to ${a.translation}`;
    default: return call.name;
  }
}
