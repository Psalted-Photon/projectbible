/**
 * Share card — the shapes a card can take and what it is drawn from.
 *
 * A card is a picture of one passage: the words, where they come from, and a
 * small app mark. Everything the person can change lives in CardStyle so a
 * look can later be saved and reused; everything that comes from the verse
 * lives in CardContent and is never edited on the card.
 */

/** The three shapes social apps actually use. */
export type CardSize = 'square' | 'portrait' | 'story';

export const CARD_SIZES: Record<CardSize, { w: number; h: number; label: string }> = {
  square: { w: 1080, h: 1080, label: 'Square' },
  portrait: { w: 1080, h: 1350, label: 'Portrait' },
  story: { w: 1080, h: 1920, label: 'Story' },
};

export interface CardStyle {
  size: CardSize;
  /** Font id from lib/readerFonts.ts. '' means the card's own default face. */
  fontId: string;
  textColor: string; // hex
  bgColor: string;   // hex
  align: 'left' | 'center';
  /** Where the verse block sits in the space above the app mark. */
  position: 'top' | 'middle' | 'bottom';
  /**
   * Multiplier on the largest size the verse may be drawn at. The text still
   * shrinks to fit, so this only ever makes short verses smaller or larger.
   */
  sizeNudge: number;
}

export interface CardContent {
  /** The verse, or the phrase picked out of it. */
  passage: string;
  /** "John 3:16" — already formatted. */
  reference: string;
  /** "NET" — always drawn; NET quotes must carry it. */
  translationLabel: string;
}
