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
 * Layers, back to front: background (colour, gradient, photo or painting),
 * texture, the verse (auto-fitted, tapped words bold or accented), the
 * reference with its translation, a painting's credit, the QR code, and at
 * the foot a faint "Hexapla" mark with the app icon. The mark is always drawn;
 * there is deliberately no switch for it.
 */

import { getReaderFont } from '../readerFonts';
import { luminance } from '../themeColors';
import { drawGradient, getGradient } from './gradients';
import { drawImageBackground } from './image';
import { fitText, lineWidth, type FittedText } from './layout';
import { drawQr, qrMatrix } from './qr';
import { drawTexture } from './textures';
import { CARD_SIZES, type CardContent, type CardExtras, type CardStyle, type WordBox } from './types';

/** Face used when the reader has no custom font — the one NET/BSB/WEB read in. */
const DEFAULT_STACK = "'EB Garamond', Georgia, serif";
/** The picker fonts are latin subsets; Greek falls back to a face that has it. */
const GREEK_STACK = "'EB Garamond', Georgia, serif";
const HEBREW_STACK = "'SBL Hebrew', 'Ezra SIL', 'Times New Roman', serif";
const MARK_FAMILY = 'HexaplaMark';
const MARK_FONT_URL = '/fonts/tutorial/fredericka-the-great-400.woff2';
const ICON_URL = '/pwa-192x192.png';

const HAS_GREEK = /[Ͱ-Ͽἀ-῿]/;
const HAS_HEBREW = /[֐-׿]/;

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
 * redraws on every move without changing the words, so the last fit is kept.
 */
let lastFit: { key: string; fit: FittedText } | null = null;

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
 * Returns where each word was drawn, for tap-to-emphasise.
 */
export async function renderCard(
  canvas: HTMLCanvasElement,
  content: CardContent,
  style: CardStyle,
  extras: CardExtras = {},
): Promise<WordBox[]> {
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
  // Stories put the app's own bars over the top and bottom ~250px.
  const padX = 108 * k;
  const padTop = (story ? 260 : 108) * k;
  const markSize = 34 * k;
  const markBaseline = H - (story ? 230 : 64) * k;

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
  let areaBottom = markBaseline - markSize - 72 * k;
  const creditSize = 22 * k;
  const creditY = markBaseline - markSize - 34 * k;
  if (image?.credit) areaBottom = creditY - creditSize - 40 * k;
  const qrSize = 150 * k;
  const qrX = W - 48 * k - qrSize;
  const qrY = markBaseline + 14 * k - qrSize;
  if (qr) areaBottom = Math.min(areaBottom, qrY - 28 * k);

  // Reference block is a fixed size so the verse can take everything else.
  const refSize = 38 * k;
  const refGap = 44 * k;
  const refHeight = refSize * 1.3;
  const areaTop = padTop;
  const verseMaxHeight = areaBottom - areaTop - refGap - refHeight;
  const maxWidth = W - padX * 2;

  // ── Words ──
  const words = cardWords(passage);
  if (!face.rtl && words.length) {
    words[0] = `“${words[0]}`;
    words[words.length - 1] = `${words[words.length - 1]}”`;
  }
  const emphasis = extras.emphasis ?? {};
  const fontFor = (s: number, i: number) =>
    `${emphasis[i] === 'bold' ? '700 ' : ''}${s}px ${face.stack}`;

  ctx.direction = face.rtl ? 'rtl' : 'ltr';
  const maxSize = 96 * k * face.scale * style.sizeNudge;
  const leading = 1.32 * face.lead;
  const fitKey = JSON.stringify([words, face.stack, maxSize, maxWidth, verseMaxHeight, leading, emphasis]);
  const fitted =
    lastFit?.key === fitKey
      ? lastFit.fit
      : fitText(ctx, words, { font: fontFor, maxWidth, maxHeight: verseMaxHeight, maxSize, minSize: 32 * k * face.scale, leading });
  lastFit = { key: fitKey, fit: fitted };

  const blockHeight = fitted.lines.length * fitted.lineHeight + refGap + refHeight;
  const slack = areaBottom - areaTop - blockHeight;
  const top =
    areaTop + (style.position === 'top' ? 0 : style.position === 'bottom' ? slack : slack / 2);
  const centred = style.align === 'center';

  // Pale words on a photo get a soft shadow; on flat colour they don't need one.
  if (image && luminance(style.textColor) > 0.4) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = 18 * k;
  }

  const boxes: WordBox[] = [];
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
      ctx.fillStyle = emphasis[i] === 'accent' ? style.accentColor : style.textColor;
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
  const refText = `— ${content.reference} (${content.translationLabel})`;
  const refY = top + fitted.lines.length * fitted.lineHeight + refGap + refHeight / 2;
  ctx.fillText(refText, centred ? W / 2 : padX, refY);
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
  return boxes;
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/** "Hexapla" in Fredericka the Great, the app icon to its right, centred on cx. */
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

  const word = 'Hexapla';
  const textW = ctx.measureText(word).width;
  const iconSize = icon ? size * 1.25 : 0;
  const gap = icon ? size * 0.35 : 0;
  const left = cx - (textW + gap + iconSize) / 2;

  ctx.fillText(word, left, baseline);
  if (icon) {
    // Sit the icon on the text's optical middle: cap height is about 0.7em.
    const iconTop = baseline - size * 0.35 - iconSize / 2;
    ctx.drawImage(icon, left + textW + gap, iconTop, iconSize, iconSize);
  }
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
