/**
 * Share card — the shapes a card can take and what it is drawn from.
 *
 * A card is a picture of one passage: the words, where they come from, and a
 * small app mark. Everything that makes up a *look* lives in CardStyle, so a
 * look can be saved, synced and reused on another verse. Everything that
 * belongs to this one card only — the words, a photo, which words were tapped
 * for emphasis — lives in CardContent and CardExtras and is never saved.
 */

/** The three shapes social apps actually use. */
export type CardSize = 'square' | 'portrait' | 'story';

export const CARD_SIZES: Record<CardSize, { w: number; h: number; label: string }> = {
  square: { w: 1080, h: 1080, label: 'Square' },
  portrait: { w: 1080, h: 1350, label: 'Portrait' },
  story: { w: 1080, h: 1920, label: 'Story' },
};

export type CardBackground = 'solid' | 'gradient' | 'photo' | 'painting';
export type CardTexture = 'none' | 'grain' | 'paper';

export interface CardStyle {
  size: CardSize;
  /** Font id from lib/readerFonts.ts. '' means the card's own default face. */
  fontId: string;
  textColor: string;   // hex
  /** Colour for words tapped to "accent", and nothing else. */
  accentColor: string; // hex
  /** Solid background, and the colour a photo falls back to in a saved look. */
  bgColor: string;     // hex
  align: 'left' | 'center';
  /** Where the verse block sits in the space above the app mark. */
  position: 'top' | 'middle' | 'bottom';
  /**
   * Multiplier on the largest size the verse may be drawn at. The text still
   * shrinks to fit, so this only ever makes short verses smaller or larger.
   */
  sizeNudge: number;
  background: CardBackground;
  /** Id from gradients.ts, used when background is 'gradient'. */
  gradientId: string;
  texture: CardTexture;
  /** Photo and painting only: 0 (sharp) to 1 (very soft). */
  blur: number;
  /** Photo and painting only: 0 (as taken) to 1 (nearly black). */
  darken: number;
  /** A small QR code that opens the verse in the app. */
  qr: boolean;
}

export interface CardContent {
  /** The verse, or the phrase picked out of it. */
  passage: string;
  /** "John 3:16" — already formatted. */
  reference: string;
  /** "NET" — always drawn; NET quotes must carry it. */
  translationLabel: string;
}

/** How a tapped word is drawn. Absent means plain. */
export type Emphasis = 'bold' | 'accent';

/** A photo or painting, already decoded and downscaled, with its framing. */
export interface CardImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  /** 1 fills the card exactly; larger zooms in. */
  zoom: number;
  /** Offset of the image centre from the card centre, in card pixels. */
  panX: number;
  panY: number;
  /** Small credit line, for a painting. */
  credit?: string;
}

export interface CardExtras {
  /** Used when style.background is 'photo' or 'painting'. */
  image?: CardImage | null;
  /** Word index (in the passage split on spaces) → emphasis. */
  emphasis?: Record<number, Emphasis>;
  /** What the QR code opens, when style.qr is on. */
  qrUrl?: string;
}

/** Where one word was drawn, in card pixels — for turning a tap into a word. */
export interface WordBox {
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
}
