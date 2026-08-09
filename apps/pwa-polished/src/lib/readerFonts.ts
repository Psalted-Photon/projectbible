/**
 * Reader fonts for the Custom theme.
 *
 * All twenty are self-hosted from /fonts/ (latin subset woff2) and declared
 * in index.html. Every one is OFL or Apache licensed — the app serves the
 * font file to every user, which counts as redistribution, so "free for
 * personal use" faces can never be added here.
 *
 * ── Why every font carries scale/lead ──────────────────────────────────
 * X-heights differ enormously across these faces. Tangerine set at 19px
 * renders at roughly half the visual size of Bitter at 19px, and Rock Salt's
 * ascenders collide at normal line spacing. Without normalisation, switching
 * typeface would make the text lurch even though the user never touched the
 * font-size slider.
 *
 * `scale` and `lead` MULTIPLY the user's --base-font-size and --line-spacing
 * rather than replacing them, so both sliders keep working exactly as before.
 * Values were tuned by eye against real verse text; see the round-3 preview
 * generator in the scratchpad if they ever need revisiting.
 */

export interface ReaderFont {
  /** Stable id — this is what gets saved and synced. Never renumber. */
  id: string;
  /** Name shown in the picker. */
  label: string;
  /** Full CSS font-family stack, including fallbacks. */
  stack: string;
  /** <optgroup> heading in the picker. */
  group: string;
  /** Multiplier on --base-font-size to even out x-heights. */
  scale: number;
  /** Multiplier on --line-spacing, for faces that need more room. */
  lead: number;
  /** Shown under the picker so the choice isn't blind. */
  note?: string;
}

/** Ordered — the picker renders groups in this sequence. */
export const READER_FONT_GROUPS = [
  'Serif',
  'Elegant',
  'Old & Gothic',
  'Typewriter',
  'Rounded',
  'Display',
  'Handwritten',
  'Calligraphy',
] as const;

export const READER_FONTS: ReaderFont[] = [
  { id: 'bitter', label: 'Bitter', group: 'Serif', scale: 1.0, lead: 1.0,
    stack: "'Bitter', Georgia, serif", note: 'Sturdy slab serif. Grounded and very legible.' },

  { id: 'cormorant', label: 'Cormorant Garamond', group: 'Elegant', scale: 1.15, lead: 1.0,
    stack: "'CormorantGaramond', Georgia, serif", note: 'Delicate and high-contrast.' },
  { id: 'marcellus', label: 'Marcellus', group: 'Elegant', scale: 1.0, lead: 1.0,
    stack: "'Marcellus', Georgia, serif", note: 'Roman inscriptional feel. Formal and quiet.' },

  { id: 'imfell', label: 'IM Fell English', group: 'Old & Gothic', scale: 1.05, lead: 1.0,
    stack: "'IMFellEnglish', Georgia, serif", note: 'A real 17th-century letterpress face.' },
  { id: 'grenze', label: 'Grenze Gotisch', group: 'Old & Gothic', scale: 1.05, lead: 1.0,
    stack: "'GrenzeGotisch', Georgia, serif", note: 'Blackletter flavour, far more readable than true fraktur.' },

  { id: 'specialelite', label: 'Special Elite', group: 'Typewriter', scale: 0.95, lead: 1.0,
    stack: "'SpecialElite', Courier, monospace", note: 'Distressed typewriter with ink bleed.' },

  { id: 'comfortaa', label: 'Comfortaa', group: 'Rounded', scale: 0.95, lead: 1.0,
    stack: "'Comfortaa', Arial, sans-serif", note: 'Very round and friendly.' },
  { id: 'fredoka', label: 'Fredoka', group: 'Rounded', scale: 0.95, lead: 1.0,
    stack: "'Fredoka', Arial, sans-serif", note: 'Chunky and playful.' },
  { id: 'sniglet', label: 'Sniglet', group: 'Rounded', scale: 0.95, lead: 1.0,
    stack: "'Sniglet', Arial, sans-serif", note: 'Rounded and soft.' },
  { id: 'chewy', label: 'Chewy', group: 'Rounded', scale: 0.95, lead: 1.0,
    stack: "'Chewy', Arial, sans-serif", note: 'Fat, bouncy and sweet.' },

  { id: 'bangers', label: 'Bangers', group: 'Display', scale: 1.0, lead: 1.0,
    stack: "'Bangers', Impact, sans-serif", note: 'Comic-book shout lettering. All caps — no true lowercase.' },
  { id: 'titanone', label: 'Titan One', group: 'Display', scale: 0.95, lead: 1.0,
    stack: "'TitanOne', Impact, sans-serif", note: 'Thick cartoon poster face.' },

  { id: 'caveat', label: 'Caveat', group: 'Handwritten', scale: 1.25, lead: 1.0,
    stack: "'Caveat', cursive", note: 'Loose handwriting. Feels like margin notes.' },
  { id: 'patrickhand', label: 'Patrick Hand', group: 'Handwritten', scale: 1.05, lead: 1.0,
    stack: "'PatrickHand', cursive", note: 'Neat, tidy handwriting.' },
  { id: 'gloria', label: 'Gloria Hallelujah', group: 'Handwritten', scale: 0.95, lead: 1.1,
    stack: "'GloriaHallelujah', cursive", note: 'Bouncy schoolbook handwriting.' },
  { id: 'shantell', label: 'Shantell Sans', group: 'Handwritten', scale: 0.95, lead: 1.0,
    stack: "'ShantellSans', Arial, sans-serif", note: 'Handwriting and sans in one.' },
  { id: 'handlee', label: 'Handlee', group: 'Handwritten', scale: 1.0, lead: 1.0,
    stack: "'Handlee', cursive", note: 'Neat, slightly slanted handwriting.' },
  { id: 'rocksalt', label: 'Rock Salt', group: 'Handwritten', scale: 0.85, lead: 1.25,
    stack: "'RockSalt', cursive", note: 'Rough marker handwriting. Needs generous line spacing.' },

  { id: 'tangerine', label: 'Tangerine', group: 'Calligraphy', scale: 1.55, lead: 1.0,
    stack: "'Tangerine', cursive", note: 'Thin, delicate calligraphy with long sweeping ascenders.' },
  { id: 'greatvibes', label: 'Great Vibes', group: 'Calligraphy', scale: 1.25, lead: 1.05,
    stack: "'GreatVibes', cursive", note: 'Classic flowing formal script.' },
];

const BY_ID = new Map(READER_FONTS.map((f) => [f.id, f]));

/**
 * Look up a font by id. Returns undefined for '' (match-translation, the
 * default) and for ids this build doesn't know — a device on an older deploy
 * can receive a synced id it has never heard of, and must fall back rather
 * than render nothing.
 */
export function getReaderFont(id: string | undefined): ReaderFont | undefined {
  return id ? BY_ID.get(id) : undefined;
}

/** Fonts for one <optgroup>, in table order. */
export function fontsInGroup(group: string): ReaderFont[] {
  return READER_FONTS.filter((f) => f.group === group);
}
