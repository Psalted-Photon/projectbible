/**
 * The irisBible wordmark: eight looks, and which one is showing right now.
 *
 * Each look is "text color, ground, shadow". The code names read the same way:
 *
 *   conce = cream text, on cream, extrude      boncg = black text, on cream, glow
 *   conbg = cream text, on black, glow         bonbe = black text, on black, extrude
 *
 * The look changes with the time of day and flips between even and odd days of
 * the month (the device's own clock, so it follows the reader's morning):
 *
 *                    even days   odd days
 *   midnight – 6am     concg       boncg
 *   6am – noon         bonce       conce
 *   noon – 6pm         bonbe       conbe
 *   6pm – midnight     conbg       bonbg
 *
 * Every size here is in em, taken from the 200px artboards the wordmark was
 * drawn on, so the whole word scales with the font size it is given.
 */

export type WordmarkCode = 'conce' | 'concg' | 'conbe' | 'conbg' | 'bonce' | 'boncg' | 'bonbe' | 'bonbg';

export interface WordmarkLook {
  /** The ground the look was drawn on; the splash takes it as its background. */
  ground: string;
  /** Color of the letters (and of the ring around the iris). */
  ink: string;
  effect: 'extrude' | 'glow';
  /** Shadow depth in px on the 200px artboard. */
  depth: number;
}

/** The app icon's tile, and the cream ground. Always this exact cream. */
export const CREAM = '#fffaed';
export const NIGHT = '#0b0e14';

export const WORDMARKS: Record<WordmarkCode, WordmarkLook> = {
  conce: { ground: CREAM, ink: CREAM, effect: 'extrude', depth: 12 },
  concg: { ground: CREAM, ink: CREAM, effect: 'glow', depth: 7 },
  conbe: { ground: NIGHT, ink: CREAM, effect: 'extrude', depth: 12 },
  conbg: { ground: NIGHT, ink: CREAM, effect: 'glow', depth: 12 },
  bonce: { ground: CREAM, ink: NIGHT, effect: 'extrude', depth: 12 },
  boncg: { ground: CREAM, ink: NIGHT, effect: 'glow', depth: 7 },
  bonbe: { ground: NIGHT, ink: NIGHT, effect: 'extrude', depth: 12 },
  bonbg: { ground: NIGHT, ink: NIGHT, effect: 'glow', depth: 7 },
};

/** [even days, odd days] for each quarter of the day. */
const SCHEDULE: [WordmarkCode, WordmarkCode][] = [
  ['concg', 'boncg'], // midnight – 6am
  ['bonce', 'conce'], // 6am – noon
  ['bonbe', 'conbe'], // noon – 6pm
  ['conbg', 'bonbg'], // 6pm – midnight
];

/** Which look shows at this moment, by the device's local time. */
export function wordmarkAt(when: Date = new Date()): WordmarkCode {
  const quarter = Math.floor(when.getHours() / 6);
  const odd = when.getDate() % 2 === 1;
  return SCHEDULE[quarter][odd ? 1 : 0];
}

/** i r i s B ı b l e — the dotless ı carries the iris. */
export const WORDMARK_LETTERS = ['i', 'r', 'i', 's', 'B', 'ı', 'b', 'l', 'e'] as const;

/** One earth color per letter: moss, ochre, slate, brick, umber, olive, lake, mustard, sienna. */
const LETTER_COLORS = ['#5e7b3a', '#b5862c', '#3e6b8c', '#9e3f2c', '#7a5232', '#86913f', '#2f6a78', '#cfa43a', '#a65a32'];
const IRIS_SHADOW = '#86913f';

const PX = 200; // the artboard's font size
const em = (px: number) => `${+(px / PX).toFixed(4)}em`;

function shadow(look: WordmarkLook, color: string, spread = 0): string {
  const d = look.depth;
  if (look.effect === 'glow') {
    const s = spread ? ` ${em(spread)}` : '';
    return [
      `0 0 ${em(d * 1.2)}${s} ${color}`,
      `0 0 ${em(d * 2.6)}${s} ${color}`,
      `0 0 ${em(d * 4.5)} ${color}`,
    ].join(', ');
  }
  const parts: string[] = [];
  for (let k = 1; k <= d; k++) parts.push(`${em(k)} ${em(k)} 0${spread ? ` ${em(spread)}` : ''} ${color}`);
  return parts.join(', ');
}

/** The text-shadow for each of the nine letters. */
export function letterShadows(look: WordmarkLook): string[] {
  return LETTER_COLORS.map((c) => shadow(look, c));
}

/** The iris dot's box-shadow: a ring in the letter color, then the shadow. */
export function irisShadow(look: WordmarkLook): string {
  return `0 0 0 ${em(3)} ${look.ink}, ${shadow(look, IRIS_SHADOW, 3)}`;
}
