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
import { packInstallFinished } from '../../adapters/db-manager';
import { lookupPerson, searchIsbeEntries, searchNaves } from '../../adapters/lexicon-lookup';
import { personModalStore } from '../../stores/personModalStore';
import { isbeModalStore } from '../../stores/isbeModalStore';
import { navesModalStore } from '../../stores/navesModalStore';
import { repeatsStore, normalizeRepeatWord } from '../../stores/repeatsStore';
import { MAX_REPEAT_GROUPS } from '../repeatColors';
import { openFamilyTree } from '../windowTypes';
import { openWorkIndex } from '../openWork';
import { openMapWindow } from '../openMapWindow';
import { openConnectionsWindow } from '../openConnectionsWindow';
import { openTimelineWindow } from '../openTimelineWindow';
import { atlasInstalled, loadAtlasIndex, getAtlasJson } from '../atlas/data';
import { ScriptureSearch } from '../atlas/search.js';
import { timelineInstalled, loadTimeline } from '../timeline/data';
import { searchItems } from '../timeline/query';
import { voiceForTap, useVoice } from '../tts/voiceForTap';
import { getTodayPlaylist, hasActivePlan, goToPlanStart, playPlanPlaylist } from '../tts/planPlaylist';
import { readingPlanModalStore } from '../../stores/readingPlanModalStore';
import { openDailyGreeting } from '../../stores/dailyGreetingStore';
import { openDevotional } from '../../stores/devotionalStore';
import { devotionalTargetFromParams } from '../devotionals/deepLink';
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

/** The Read Aloud voice made the one to read with, or a notice saying why it can't be. */
async function voiceReady(greek: boolean): Promise<boolean> {
  const check = await voiceForTap(greek);
  if (check.status !== 'ready') {
    say(
      check.status === 'downloading'
        ? 'The Read Aloud voice is still downloading.'
        : 'Read Aloud needs its voice first: tap the speaker under the chapter title.',
    );
    return false;
  }
  useVoice(check.voiceId, greek);
  return true;
}

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
  if (!(await voiceReady(greek))) return 'No voice yet';
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

// ── Repeats ─────────────────────────────────────────────────────────────────

function repeats(word: unknown): string {
  const w = bibleWord(word);
  if (!w) {
    say("Didn't catch the word.");
    return 'No word';
  }
  const groups = get(repeatsStore);
  if (groups.some((g) => g.word === normalizeRepeatWord(w))) {
    say(`"${w}" is already marked everywhere.`);
    return `Already marking "${w}"`;
  }
  if (groups.length >= MAX_REPEAT_GROUPS) {
    say(`Repeats holds ${MAX_REPEAT_GROUPS} words. Take one off first.`);
    return 'Repeats is full';
  }
  repeatsStore.add(w, { translation: get(navigationStore).translation });
  return `Marking "${w}" everywhere`;
}

// ── Map ─────────────────────────────────────────────────────────────────────

/** A year as said ("1000 BC", "AD 30"), negative for BC. Without either, BC: the Bible map's eras mostly are. */
function yearOf(spoken: unknown): number | null {
  const m = /(\d{1,4})/.exec(String(spoken ?? ''));
  if (!m) return null;
  return /\b(AD|CE)\b/i.test(String(spoken)) ? +m[1] : -m[1];
}

const yearLabel = (year: number) => (year < 0 ? `${-year} BC` : `AD ${year}`);

/** The place Scripture names (or an ancient name) that was said, from the map pack. */
async function findPlace(name: string): Promise<{ name: string; lat: number; lon: number; modern?: string; type?: string } | null> {
  const index = await loadAtlasIndex();
  const [places, ancient] = await Promise.all([getAtlasJson(index.biblicalPlaces.file), getAtlasJson(index.ancientNames.file)]);
  return new ScriptureSearch(places, ancient).search(name.replace(/^the\s+/i, ''), 1)[0] ?? null;
}

async function map(a: Record<string, any>): Promise<string> {
  if (!(await atlasInstalled())) return offerPack('atlas-map', "The Historical Map isn't downloaded yet.");
  const year = a.year ? yearOf(a.year) : null;
  const said = String(a.place ?? '').trim();
  const place = said ? await findPlace(said) : null;
  const when = year != null ? ` in ${yearLabel(year)}` : '';
  if (said && !place) say(`Couldn't find ${said} on the map.`);
  if (place) {
    const marker = { name: place.name, latitude: place.lat, longitude: place.lon, modernName: place.modern || null, placeType: place.type || null };
    if (!openMapWindow(place.name, [marker], year != null ? { year } : {})) return 'No room for another window';
    return `Map at ${place.name}${when}`;
  }
  if (year != null) return openMapWindow('', [], { year }) ? `Map${when}` : 'No room for another window';
  if (get(windowStore).some((w) => w.contentType === 'map')) return 'The map is open';
  return openWindowOfType('map') ? 'Opened the map' : 'No room for another window';
}

// ── Connections ─────────────────────────────────────────────────────────────

function connections(reference: unknown): string {
  const spoken = String(reference ?? '').trim();
  const nav = get(navigationStore);
  const ref = spoken ? readQueryAsRef(spoken) : null;
  if (spoken && ref?.kind !== 'ref' && ref?.kind !== 'book') {
    say(`Couldn't find ${spoken}.`);
    return `No passage "${spoken}"`;
  }
  const at = ref?.kind === 'ref' || ref?.kind === 'book' ? ref : null;
  const book = at?.book ?? nav.book;
  const chapter = at?.chapter ?? nav.chapter;
  // A chapter alone lands on its first verse; only a verse said lights one.
  const verses = at?.kind === 'ref' && spoken.includes(':') ? [at.verse] : undefined;
  if (!openConnectionsWindow(book, chapter, verses)) return 'No room for another window';
  return `Connections for ${at?.label ?? `${book} ${chapter}`}`;
}

// ── People ──────────────────────────────────────────────────────────────────

const titleCase = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

/**
 * The person a call names, from the people list: the most-mentioned one of
 * that name, with the others alongside. Says why when there's no one.
 */
async function personFor(call: VoiceCall): Promise<{ found: NonNullable<Awaited<ReturnType<typeof lookupPerson>>>; said: string } | string> {
  const said = String(call.args.person ?? '').trim();
  const found = await lookupPerson(call.person ?? said);
  if (found) {
    // Only the people it is the name of, as the worker found them.
    const keep = call.personIds?.length ? new Set(call.personIds) : null;
    if (keep) {
      const all = [found.person, ...found.alternates].filter((p) => keep.has(p.id));
      all.sort((a, b) => call.personIds!.indexOf(a.id) - call.personIds!.indexOf(b.id));
      if (all.length) {
        found.person = all[0];
        found.alternates = all.slice(1);
      }
    }
    return { found, said: titleCase(call.person ?? said) };
  }
  if (!(await packInstallFinished('people-biblical-v1').catch(() => false))) {
    return offerPack('people-biblical-v1', "The people list isn't downloaded yet.");
  }
  say(`Couldn't find ${said} in the people list.`);
  return `No one named "${said}"`;
}

async function familyTree(call: VoiceCall): Promise<string> {
  if (!String(call.args.person ?? '').trim()) {
    openFamilyTree();
    return 'Opened the family tree';
  }
  const who = await personFor(call);
  if (typeof who === 'string') return who;
  const p = who.found.person;
  familyTreeStore.open({ focusId: p.id });
  return `Family tree on ${p.displayTitle || p.name}`;
}

/** The bio, with everyone else of that name to pick from ("Who was James?"). */
async function biography(call: VoiceCall): Promise<string> {
  lookupReader.set(MAIN_READER);
  if (!String(call.args.person ?? '').trim()) {
    openWorkIndex('people', null);
    return 'Opened the people list';
  }
  const who = await personFor(call);
  if (typeof who === 'string') return who;
  const r = who.found;
  personModalStore.open({
    personId: r.person.id,
    primaryName: r.person.displayTitle || r.person.name,
    lookup: r.alternates.length ? r : null,
    clickedWord: who.said,
  });
  return r.alternates.length
    ? `Bio of ${r.person.displayTitle || r.person.name}, with ${r.alternates.length} more named ${who.said}`
    : `Bio of ${r.person.displayTitle || r.person.name}`;
}

// ── Encyclopedia and topical ────────────────────────────────────────────────

const subject = (topic: unknown) => String(topic ?? '').trim().replace(/^(the|a|an)\s+/i, '');

async function encyclopedia(topic: unknown): Promise<string> {
  if (!(await packInstallFinished('encyclotopical').catch(() => false))) {
    return offerPack('encyclotopical', "The encyclopedia isn't downloaded yet.");
  }
  lookupReader.set(MAIN_READER);
  const q = subject(topic);
  if (!q) {
    openWorkIndex('encyclopedia', null);
    return 'Opened the encyclopedia';
  }
  const [row] = await searchIsbeEntries(q, 1);
  if (!row) {
    say(`The encyclopedia has no article on ${q}.`);
    return `No article on "${q}"`;
  }
  isbeModalStore.open({ kind: 'entry', entryId: Number(row.id), placeId: null, primaryName: row.name });
  return `Encyclopedia: ${row.name}`;
}

async function topical(topic: unknown): Promise<string> {
  if (!(await packInstallFinished('encyclotopical').catch(() => false))) {
    return offerPack('encyclotopical', "The topical index isn't downloaded yet.");
  }
  lookupReader.set(MAIN_READER);
  const q = subject(topic);
  if (!q) {
    openWorkIndex('topical', null);
    return 'Opened the topical index';
  }
  const [row] = await searchNaves(q, 1);
  if (!row) {
    say(`The topical index has nothing on ${q}.`);
    return `No topic "${q}"`;
  }
  navesModalStore.open({ topicId: Number(row.id), primaryName: row.name });
  return `Topical: ${row.name}`;
}

// ── Timeline ────────────────────────────────────────────────────────────────

async function timeline(event: unknown): Promise<string> {
  if (!(await timelineInstalled())) return offerPack('timeline', "The Timeline isn't downloaded yet.");
  const q = subject(event);
  const [item] = q ? searchItems(await loadTimeline(), q, 1) : [];
  if (item) return openTimelineWindow(item.id) ? `Timeline at ${item.title}` : 'No room for another window';
  if (q) say(`Couldn't find ${q} on the timeline.`);
  if (get(windowStore).some((w) => w.contentType === 'timeline')) return 'The timeline is open';
  return openWindowOfType('timeline') ? 'Opened the timeline' : 'No room for another window';
}

// ── Reading plan, Verse of the Day, devotional ──────────────────────────────

/** The plan, or today's reading in it: gone to, or played the way Play this reading plays it. */
async function readingPlan(a: Record<string, any>): Promise<string> {
  if (!a.today && !a.aloud) {
    readingPlanModalStore.open();
    return 'Opened the reading plan';
  }
  const playlist = await getTodayPlaylist();
  if (!playlist) {
    readingPlanModalStore.open();
    say(hasActivePlan() ? 'Nothing is due on your reading plan today.' : "You haven't started a reading plan yet.");
    return 'No reading today';
  }
  if (a.aloud && !(await voiceReady(false))) return 'No voice yet';
  navigationStore.pushHistory(get(navigationStore), 'voice');
  if (a.aloud) playPlanPlaylist(playlist);
  else goToPlanStart(playlist);
  const first = playlist.passages[0];
  return `${a.aloud ? "Reading today's reading" : "Went to today's reading"}, ${first.book} ${first.chapter}`;
}

/** The devotionals' ids, by the names the rules give them. */
const DEVOTIONAL_IDS: Record<string, string> = {
  'Morning and Evening': 'spurgeon-me', "Faith's Checkbook": 'faiths-checkbook', 'Daily Light': 'daily-light',
};

/** Today's reading, the same one a ?devo=today link opens, in the morning or evening one when that was said. */
function devotional(a: Record<string, any>): string {
  const params = new URLSearchParams({ devo: DEVOTIONAL_IDS[String(a.work)] ?? 'today' });
  if (a.time) params.set('s', String(a.time));
  openDevotional(devotionalTargetFromParams(params)!);
  return `Opened today's ${a.work ?? 'devotional'}`;
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
    case 'repeats': return repeats(a.word);
    case 'map': return map(a);
    case 'connections': return connections(a.reference);
    case 'family_tree': return familyTree(call);
    case 'biography': return biography(call);
    case 'encyclopedia': return encyclopedia(a.topic);
    case 'topical': return topical(a.topic);
    case 'timeline': return timeline(a.event);
    case 'reading_plan': return readingPlan(a);
    case 'verse_of_the_day':
      openDailyGreeting();
      return 'Opened the Verse of the Day';
    case 'devotional': return devotional(a);
    default: return `Can't do ${call.name}`;
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
    case 'repeats': return `mark "${bibleWord(a.word)}" everywhere`;
    case 'map': return `the map${a.place ? ` at ${a.place}` : ''}${a.year ? ` in ${a.year}` : ''}`;
    case 'connections': return `the connections for ${a.reference || 'this chapter'}`;
    case 'family_tree': return `the family tree${a.person ? ` of ${titleCase(call.person ?? String(a.person))}` : ''}`;
    case 'biography': return a.person ? `the bio of ${titleCase(call.person ?? String(a.person))}` : 'the people list';
    case 'encyclopedia': return a.topic ? `the encyclopedia on "${subject(a.topic)}"` : 'the encyclopedia';
    case 'topical': return a.topic ? `the topical index on "${subject(a.topic)}"` : 'the topical index';
    case 'timeline': return a.event ? `the timeline at ${a.event}` : 'the timeline';
    case 'reading_plan': return a.aloud ? "play today's reading" : a.today ? "go to today's reading" : 'open the reading plan';
    case 'verse_of_the_day': return 'the Verse of the Day';
    case 'devotional': return `today's ${a.work ?? 'devotional'}${a.time ? ` (${a.time})` : ''}`;
    default: return call.name;
  }
}
