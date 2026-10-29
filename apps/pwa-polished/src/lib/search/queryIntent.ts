/**
 * Plain questions typed (or said) into the search box: "verses about
 * anxiety", "who was Boaz", "where is Bethel", "what does the Bible say about
 * worry". The lead-in comes off, so only the words that matter are searched,
 * and it says what the question is after, so that kind of result comes first.
 * Words without a known lead-in are searched exactly as typed.
 *
 * For "verses about…" only, a modern word the Bible doesn't use is searched
 * with the Bible's own wording as well (anxiety → anxious). The list says
 * which words it added, so it never feels like guessing.
 */

import type { SearchCategory, SearchCategoryKey, SearchResult } from '../services/searchService';

export interface QueryIntent {
  /** The words searched: what was typed, the lead-in taken off. */
  text: string;
  /** What the question is after: people, places, or verses on a subject. */
  kind: 'who' | 'where' | 'about' | null;
  /** The Bible's wording searched alongside a modern word, keyed by the word ("anxiety" → anxious). */
  also: Record<string, string[]>;
}

/**
 * Lead-ins, longest first. `short` ones also open verses ("where is thy
 * sting", "who is like unto thee"), so they count only before a few words
 * that don't start the way a quoted verse goes on.
 */
const LEAD_INS: { re: RegExp; kind: QueryIntent['kind']; short?: boolean }[] = [
  {
    re: /^what\s+(?:does|do|did)\s+(?:the\s+)?(?:bible|scriptures?|word|god|jesus)\s+(?:say|says|teach|teaches)\s+(?:about|on|regarding)\s+/i,
    kind: 'about',
  },
  { re: /^what\s+(?:the\s+)?(?:bible|scriptures?)\s+(?:says?|teach(?:es)?)\s+(?:about|on)\s+/i, kind: 'about' },
  {
    re: /^(?:(?:show|find|give)\s+(?:me\s+)?)?(?:some\s+)?(?:bible\s+)?(?:verses?|scriptures?|passages?)\s+(?:about|on|for|regarding|dealing\s+with)\s+/i,
    kind: 'about',
  },
  { re: /^(?:who\s+(?:was|is|were|are)|who's)\s+/i, kind: 'who', short: true },
  { re: /^(?:where\s+(?:was|is|were|are)|where's)\s+/i, kind: 'where', short: true },
  { re: /^tell\s+me\s+(?:about|of)\s+/i, kind: null },
];

/** How a quoted verse goes on after "who is" or "where is": thy God, like unto thee, this that cometh. */
const QUOTE_GOES_ON = /^(?:thy|thine|thee|thou|ye|my|mine|this|that|these|he|she|it|his|her|our|your|their|like|not|there|wise|able|worthy|sufficient)\b/i;

/**
 * Modern words and the Bible's wording for them. Small and hand-made on
 * purpose: each extra word has to be what a reader would accept as meaning
 * the same thing. Plurals and endings need no entry; the word forms cover them.
 */
const BIBLE_WORDING: Record<string, string[]> = {
  anxiety: ['anxious'],
  worry: ['anxious', 'care'],
  worrying: ['anxious', 'care'],
  stress: ['trouble', 'distress'],
  depression: ['despair', 'downcast'],
  depressed: ['despair', 'downcast'],
  sadness: ['sorrow', 'grief'],
  sad: ['sorrow'],
  loneliness: ['alone', 'lonely'],
  happiness: ['joy', 'glad'],
  happy: ['joy', 'glad'],
  anger: ['wrath'],
  angry: ['wrath'],
  forgiveness: ['forgive'],
  forgiving: ['forgive'],
  honesty: ['honest', 'truth'],
  patience: ['patient', 'longsuffering'],
  kindness: ['kind'],
  humility: ['humble'],
  pride: ['proud'],
  greed: ['covet', 'covetousness'],
  jealousy: ['jealous', 'envy'],
  generosity: ['generous', 'liberal'],
  gratitude: ['thanks', 'thankful'],
  thankfulness: ['thanks', 'thankful'],
  obedience: ['obey'],
  courage: ['courageous', 'bold'],
  scared: ['afraid', 'fear'],
  money: ['riches', 'wealth'],
  wealth: ['riches'],
  poverty: ['poor'],
  healing: ['heal'],
  sickness: ['sick', 'disease'],
  illness: ['sick', 'disease'],
  death: ['die', 'dead'],
  dying: ['die', 'dead'],
  grief: ['mourn', 'sorrow'],
  grieving: ['mourn', 'sorrow'],
  temptation: ['tempt'],
  prayer: ['pray'],
  friendship: ['friend'],
  revenge: ['vengeance', 'avenge'],
  protection: ['protect', 'refuge'],
  guidance: ['guide'],
  strength: ['strong'],
  marriage: ['marry'],
  suffering: ['suffer', 'affliction'],
  persecution: ['persecute'],
  success: ['prosper'],
  laziness: ['slothful', 'sluggard'],
  lazy: ['slothful', 'sluggard'],
  gossip: ['talebearer', 'whisperer'],
  drunkenness: ['drunk', 'drunkard'],
  work: ['labor', 'labour'],
  hell: ['hades', 'sheol'],
  salvation: ['saved', 'save'],
  faithfulness: ['faithful'],
  loyalty: ['faithful'],
  contentment: ['content'],
};

/** Words after the lead-in that only frame the question: "the jordan", "bethel located", "love in the bible". */
const FRAMING_START = /^(?:the|a|an)\s+/i;
const FRAMING_END = /\s+(?:in\s+the\s+bible|in\s+scripture|located)$/i;

/** How a search box question reads. Without a lead-in it is the words as typed, with nothing added. */
export function readIntent(query: string): QueryIntent {
  const typed = query.trim();
  for (const { re, kind, short } of LEAD_INS) {
    const lead = typed.match(re);
    if (!lead) continue;
    const text = typed
      .slice(lead[0].length)
      .replace(/[?.!]+$/, '')
      .replace(FRAMING_START, '')
      .replace(FRAMING_END, '')
      .trim();
    // "Who was" on its own is a search for those words, and so is a verse.
    if (!text || (short && (text.split(/\s+/).length > 4 || QUOTE_GOES_ON.test(text)))) break;
    const also: Record<string, string[]> = {};
    if (kind === 'about') {
      for (const word of text.toLowerCase().split(/\s+/)) {
        const extra = BIBLE_WORDING[word.replace(/[^a-z]/g, '')];
        if (extra) also[word.replace(/[^a-z]/g, '')] = extra;
      }
    }
    return { text, kind, also };
  }
  return { text: typed, kind: null, also: {} };
}

/** The category a question is after, which goes first in the list. */
export function leadCategory(intent: QueryIntent): SearchCategoryKey | null {
  if (intent.kind === 'who') return 'characters';
  if (intent.kind === 'where') return 'encyclopedia';
  if (intent.kind === 'about') return 'topical';
  return null;
}

/** Every word added from the table, for "Also searched: anxious, care". */
export function addedWords(intent: QueryIntent): string[] {
  return [...new Set(Object.values(intent.also).flat())];
}

const plainName = (s: unknown) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * A person, place or topic the searched words name exactly ("boaz", "the
 * jordan" → Jordan), to pin above the results. Looked for first where the
 * question points: people for "who", places for "where", topics for "verses
 * about". Null when nothing is named exactly.
 */
export function topMatch(categories: SearchCategory[], intent: QueryIntent): SearchResult | null {
  const want = plainName(intent.text);
  if (!want) return null;
  const order: SearchCategoryKey[] =
    intent.kind === 'where'
      ? ['encyclopedia', 'characters', 'topical']
      : intent.kind === 'about'
        ? ['topical', 'characters', 'encyclopedia']
        : ['characters', 'encyclopedia', 'topical'];
  for (const key of order) {
    const results = categories.find((c) => c.key === key)?.results ?? [];
    const hit = results.find((r) => {
      const name = r.type === 'character' ? r.data?.name : r.data?.primaryName;
      // "Where is…" wants the place, not an article that shares its name.
      if (r.type === 'encyclopedia' && intent.kind === 'where' && !r.data?.isPlace) return false;
      return plainName(name) === want;
    });
    if (hit) return hit;
  }
  return null;
}
