/**
 * Drawing a share card.
 *
 * One function paints the card onto a canvas, and the same function feeds both
 * the preview and the image that leaves the app, so what the person sees is
 * exactly what is sent. It draws straight onto a 2D canvas and does not
 * screenshot the DOM: those libraries go through SVG foreignObject, where iOS
 * Safari drops web fonts, and a card drawn in the fallback face is the one
 * failure that would be seen by everyone the card is sent to.
 *
 * Layers, back to front: background (color, gradient, photo or painting),
 * texture, the verse (auto-fitted, tapped words bold or accented), the
 * reference with its translation, a painting's credit, the QR code, and at
 * the foot a faint irisBible wordmark, iris dot and all. The mark is always drawn;
 * there is deliberately no switch for it.
 */

import { getReaderFont } from '../readerFonts';
import { WORDMARK_LETTERS } from '../wordmark';
import { luminance } from '../themeColors';
import { drawGradient, getGradient } from './gradients';
import { drawImageBackground } from './image';
import { fitText, largestFit, lineWidth, type FittedText } from './layout';
import { drawQr, qrMatrix } from './qr';
import { drawTexture } from './textures';
import {
  CARD_SIZES,
  TEXT_SIZE_RANGE,
  type CardContent,
  type CardExtras,
  type CardStyle,
  type RenderedCard,
} from './types';

/** Face used when the reader has no custom font — the one NET/BSB/WEB read in. */
const DEFAULT_STACK = "'EB Garamond', Georgia, serif";
/** The picker fonts are latin subsets; Greek falls back to a face that has it. */
const GREEK_STACK = "'EB Garamond', Georgia, serif";
const HEBREW_STACK = "'SBL Hebrew', 'Ezra SIL', 'Times New Roman', serif";
const MARK_FAMILY = 'HexaplaMark';
const MARK_FONT_URL = '/fonts/milonga-400.woff2';
/** The bare iris, not the cream-tiled app icon, so it sits on any card color. */
const ICON_URL = '/pb-gem.png';

const HAS_GREEK = /[\u0370-\u03FF\u1F00-\u1FFF]/;
const HAS_HEBREW = /[\u0590-\u05FF]/;

/** The passage as the card numbers its words. Tapped-word indices refer to this. */
export function cardWords(passage: string): string[] {
  return passage.trim().split(/\s+/).filter(Boolean);
}

// ── Assets ───────────────────────────────────────────────────────────────────

/** Never let a slow or offline font stall the card. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | void> {
  return Promise.race([p, new Promise<void>((r) => setTimeout(r, ms))]);
}

let markFontReady: Promise<void> | null = null;

/**
 * The mark's face is registered here, not borrowed from the tutorial's
 * stylesheet, so the card never depends on the tutorial having been loaded.
 */
function loadMarkFont(): Promise<void> {
  markFontReady ??= (async () => {
    const face = new FontFace(MARK_FAMILY, `url('${MARK_FONT_URL}')`);
    await face.load();
    document.fonts.add(face);
  })().catch((err) => console.warn('[shareCard] mark font failed', err));
  return markFontReady;
}

let iconReady: Promise<HTMLImageElement | null> | null = null;

function loadIcon(): Promise<HTMLImageElement | null> {
  iconReady ??= (async () => {
    const img = new Image();
    img.src = ICON_URL;
    await img.decode();
    return img;
  })().catch((err) => {
    console.warn('[shareCard] icon failed', err);
    iconReady = null; // try again next time rather than never
    return null;
  });
  return iconReady;
}

/** Faces already waited for, so a redraw during a drag doesn't wait again. */
const loadedFaces = new Set<string>();

async function loadTextFont(stack: string, sample: string): Promise<void> {
  if (loadedFaces.has(stack)) return;
  try {
    await withTimeout(
      Promise.all([
        document.fonts.load(`48px ${stack}`, sample.slice(0, 200)),
        document.fonts.load(`700 48px ${stack}`, sample.slice(0, 200)),
      ]),
      4000,
    );
    loadedFaces.add(stack);
  } catch {
    /* the fallback face is still better than no card */
  }
}

// ── Layout cache ─────────────────────────────────────────────────────────────

/**
 * Fitting is the slow part (hundreds of measurements). Panning a photo
 * redraws on every move without changing the words, and dragging the size
 * slider doesn't change how big the words could go, so both are kept.
 */
let lastFit: { key: string; fit: FittedText } | null = null;
let lastLargest: { key: string; size: number } | null = null;

// ── Drawing ──────────────────────────────────────────────────────────────────

interface Face {
  stack: string;
  scale: number;
  lead: number;
  rtl: boolean;
}

function faceFor(style: CardStyle, passage: string): Face {
  if (HAS_HEBREW.test(passage)) return { stack: HEBREW_STACK, scale: 1, lead: 1.1, rtl: true };
  if (HAS_GREEK.test(passage)) return { stack: GREEK_STACK, scale: 1, lead: 1, rtl: false };
  const font = getReaderFont(style.fontId);
  return font
    ? { stack: font.stack, scale: font.scale, lead: font.lead, rtl: false }
    : { stack: DEFAULT_STACK, scale: 1.05, lead: 1, rtl: false };
}

/**
 * Paint the card onto `canvas`, resizing it to the card's full pixel size.
 * Returns where each word was drawn, for tap-to-emphasize, and how big the
 * words could go before running off the card.
 */
export async function renderCard(
  canvas: HTMLCanvasElement,
  content: CardContent,
  style: CardStyle,
  extras: CardExtras = {},
): Promise<RenderedCard> {
  const passage = content.passage.trim().replace(/\s+/g, ' ');
  const face = faceFor(style, passage);
  const [icon, , , qr] = await Promise.all([
    loadIcon(),
    loadMarkFont(),
    loadTextFont(face.stack, passage),
    style.qr && extras.qrUrl ? qrMatrix(extras.qrUrl) : Promise.resolve(null),
  ]);

  const { w: W, h: H } = CARD_SIZES[style.size];
  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  const k = W / 1080;
  const story = style.size === 'story';
  // The margin is the person's to choose, down to nothing; only the card's edge limits the words.
  const padX = style.margin * k;
  const padTop = style.margin * k;
  // Stories put the app's own bars over the bottom ~250px, so the mark sits above them.
  const markSize = 34 * k;
  const markBaseline = H - (story ? 230 : 64) * k;
  // Room kept between the words and the mark, credit or QR below them: follows
  // the margin, but never so little that the words run into them.
  const clear = Math.max(16, Math.min(72, style.margin)) * k;

  // ── Background ──
  const image = style.background === 'photo' || style.background === 'painting' ? extras.image : null;
  if (image) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    drawImageBackground(ctx, image, W, H, style.blur, style.darken);
  } else if (style.background === 'gradient') {
    drawGradient(ctx, getGradient(style.gradientId), W, H);
  } else {
    ctx.fillStyle = style.bgColor;
    ctx.fillRect(0, 0, W, H);
  }
  if (style.texture !== 'none') drawTexture(ctx, style.texture, W, H);

  // ── Space for the words ──
  let areaBottom = markBaseline - markSize - clear;
  const creditSize = 22 * k;
  const creditY = markBaseline - markSize - 34 * k;
  if (image?.credit) areaBottom = creditY - creditSize - Math.min(clear, 40 * k);
  const qrSize = 150 * k;
  const qrX = W - 48 * k - qrSize;
  const qrY = markBaseline + 14 * k - qrSize;
  if (qr) areaBottom = Math.min(areaBottom, qrY - Math.min(clear, 28 * k));

  // Reference block is a fixed size so the verse can take everything else.
  const refSize = 38 * k;
  const refGap = 44 * k;
  const refHeight = refSize * 1.3;
  // A devotional's source line sits under the reference; without one nothing moves.
  const sourceSize = 27 * k;
  const sourceHeight = content.source ? sourceSize * 1.7 : 0;
  const areaTop = padTop;
  const verseMaxHeight = areaBottom - areaTop - refGap - refHeight - sourceHeight;
  const maxWidth = W - padX * 2;

  // ── Words ──
  const words = cardWords(passage);
  if (!face.rtl && words.length) {
    words[0] = `\u201C${words[0]}`;
    words[words.length - 1] = `${words[words.length - 1]}\u201D`;
  }
  const emphasis = extras.emphasis ?? {};
  const fontFor = (s: number, i: number) =>
    `${emphasis[i] === 'bold' || emphasis[i] === 'both' ? '700 ' : ''}${s}px ${face.stack}`;

  ctx.direction = face.rtl ? 'rtl' : 'ltr';
  // Sizes are chosen for a 1080-wide card in the default face; scale both away.
  const unit = k * face.scale;
  const leading = 1.32 * face.lead;
  const box = { font: fontFor, maxWidth, maxHeight: verseMaxHeight, minSize: 32 * unit, leading };
  const boxKey = JSON.stringify([words, face.stack, maxWidth, verseMaxHeight, leading, emphasis]);
  const largest =
    lastLargest?.key === boxKey
      ? lastLargest.size
      : largestFit(ctx, words, { ...box, maxSize: TEXT_SIZE_RANGE.max * unit });
  lastLargest = { key: boxKey, size: largest };
  // Exactly the chosen size, unless that would run the passage off the card.
  const size = Math.min(Math.round(style.textSize * unit), largest);
  const fitKey = JSON.stringify([boxKey, size]);
  const fitted = lastFit?.key === fitKey ? lastFit.fit : fitText(ctx, words, { ...box, maxSize: size });
  lastFit = { key: fitKey, fit: fitted };

  const blockHeight = fitted.lines.length * fitted.lineHeight + refGap + refHeight + sourceHeight;
  const slack = areaBottom - areaTop - blockHeight;
  const top =
    areaTop + (style.position === 'top' ? 0 : style.position === 'bottom' ? slack : slack / 2);
  const centred = style.align === 'center';

  // Pale words on a photo get a soft shadow; on flat color they don't need one.
  if (image && luminance(style.textColor) > 0.4) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = 18 * k;
  }

  const boxes: RenderedCard['boxes'] = [];
  ctx.textBaseline = 'middle';
  fitted.lines.forEach((line, li) => {
    const lw = lineWidth(line, fitted.widths, fitted.space);
    const cy = top + fitted.lineHeight * (li + 0.5);
    // Hebrew runs right to left: start at the right and step leftwards.
    let cursor = face.rtl
      ? centred ? W / 2 + lw / 2 : W - padX
      : centred ? W / 2 - lw / 2 : padX;
    ctx.textAlign = face.rtl ? 'right' : 'left';
    for (const i of line) {
      const w = fitted.widths[i];
      ctx.font = fontFor(fitted.fontSize, i);
      ctx.fillStyle = emphasis[i] === 'accent' || emphasis[i] === 'both' ? style.accentColor : style.textColor;
      ctx.fillText(words[i], cursor, cy);
      const left = face.rtl ? cursor - w : cursor;
      boxes.push({ index: i, x: left, y: cy - fitted.lineHeight / 2, w, h: fitted.lineHeight });
      cursor += face.rtl ? -(w + fitted.space) : w + fitted.space;
    }
  });

  // ── Reference — always with its translation ──
  ctx.direction = 'ltr';
  ctx.textAlign = centred ? 'center' : 'left';
  ctx.globalAlpha = 0.72;
  ctx.fillStyle = style.textColor;
  ctx.font = `600 ${refSize}px ${DEFAULT_STACK}`;
  const refText = `\u2014 ${content.reference} (${content.translationLabel})`;
  const refY = top + fitted.lines.length * fitted.lineHeight + refGap + refHeight / 2;
  ctx.fillText(refText, centred ? W / 2 : padX, refY);
  if (content.source) {
    ctx.globalAlpha = 0.58;
    ctx.font = `${sourceSize}px ${DEFAULT_STACK}`;
    ctx.fillText(ellipsize(ctx, content.source, maxWidth), centred ? W / 2 : padX, refY + refHeight / 2 + sourceHeight / 2);
  }
  ctx.globalAlpha = 1;
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;

  // ── Painting credit ──
  if (image?.credit) {
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = style.textColor;
    ctx.font = `italic ${creditSize}px ${DEFAULT_STACK}`;
    ctx.textAlign = 'center';
    ctx.fillText(ellipsize(ctx, image.credit, W - padX * 2 - (qr ? qrSize * 2 : 0)), W / 2, creditY);
    ctx.restore();
  }

  if (qr) drawQr(ctx, qr, qrX, qrY, qrSize);

  drawMark(ctx, icon, W / 2, markBaseline, markSize, style.textColor);
  return { boxes, largestTextSize: Math.floor(largest / unit) };
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}\u2026`).width > max) t = t.slice(0, -1);
  return `${t.trimEnd()}\u2026`;
}

/**
 * The plain irisBible wordmark, centered on cx: Milonga letters in the card's
 * text color with the iris standing in as the dot of the "i" in Bible, laid
 * out on the same numbers as the wordmark artboards (lib/wordmark.ts). The
 * name is never drawn as bare text, so the iris is part of the mark; only if
 * it failed to load is the plain dotless letter left.
 */
function drawMark(
  ctx: CanvasRenderingContext2D,
  icon: HTMLImageElement | null,
  cx: number,
  baseline: number,
  size: number,
  colour: string,
): void {
  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.direction = 'ltr';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `${size}px '${MARK_FAMILY}', Georgia, serif`;
  ctx.fillStyle = colour;

  // Letter by letter, so the spacing matches the artboards (0.04em) without
  // depending on canvas letterSpacing, which older Safari does not have.
  const spacing = size * 0.04;
  const widths = WORDMARK_LETTERS.map((l) => ctx.measureText(l).width);
  const total = widths.reduce((a, w) => a + w, 0) + spacing * (widths.length - 1);
  let x = cx - total / 2;

  WORDMARK_LETTERS.forEach((letter, n) => {
    ctx.fillText(letter, x, baseline);
    if (letter === 'ı' && icon) {
      // Artboard numbers at 200px type: a 40px iris, centered 29.5px into the
      // letter, its top 0.11em below the top of a 1em line box. Milonga puts
      // that box's baseline 0.865em down, so the top is 0.755em above it.
      const d = size * 0.2;
      ctx.drawImage(icon, x + size * 0.1475 - d / 2, baseline - size * 0.755, d, d);
    }
    x += widths[n] + spacing;
  });
  ctx.restore();
}

/**
 * Whether the card is flat enough for PNG. Photos, paintings and grain are
 * many times larger as PNG than as a high-quality JPEG and look the same.
 */
export function cardMime(style: CardStyle): 'image/png' | 'image/jpeg' {
  const busy = style.background === 'photo' || style.background === 'painting' || style.texture !== 'none';
  return busy ? 'image/jpeg' : 'image/png';
}

/** Read the finished card off a canvas that renderCard has drawn. */
export function canvasToBlob(canvas: HTMLCanvasElement, style: CardStyle): Promise<Blob | null> {
  const mime = cardMime(style);
  return new Promise((r) => canvas.toBlob(r, mime, mime === 'image/jpeg' ? 0.92 : undefined));
}
