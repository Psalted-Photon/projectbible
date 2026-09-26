/**
 * Drawing a share card.
 *
 * One function paints the card onto a canvas, and the same function feeds both
 * the preview and the PNG that leaves the app, so what the person sees is
 * exactly what is sent. It draws straight onto a 2D canvas and does not
 * screenshot the DOM: those libraries go through SVG foreignObject, where iOS
 * Safari drops web fonts, and a card drawn in the fallback face is the one
 * failure that would be seen by everyone the card is sent to.
 *
 * Layout, top to bottom: the verse (auto-fitted), the reference with its
 * translation, and at the foot a faint "Hexapla" mark with the app icon. The
 * mark is always drawn; there is deliberately no switch for it.
 */

import { getReaderFont } from '../readerFonts';
import { mix } from '../themeColors';
import { fitText } from './layout';
import { CARD_SIZES, type CardContent, type CardStyle } from './types';

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

async function loadTextFont(stack: string, sample: string): Promise<void> {
  try {
    await withTimeout(document.fonts.load(`48px ${stack}`, sample.slice(0, 200)), 4000);
  } catch {
    /* the fallback face is still better than no card */
  }
}

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

/** Paint the card onto `canvas`, resizing it to the card's full pixel size. */
export async function renderCard(
  canvas: HTMLCanvasElement,
  content: CardContent,
  style: CardStyle,
): Promise<void> {
  const passage = content.passage.trim().replace(/\s+/g, ' ');
  const face = faceFor(style, passage);
  const [icon] = await Promise.all([
    loadIcon(),
    loadMarkFont(),
    loadTextFont(face.stack, passage),
  ]);

  const { w: W, h: H } = CARD_SIZES[style.size];
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas');

  const k = W / 1080;
  const story = style.size === 'story';
  // Stories put the app's own bars over the top and bottom ~250px.
  const padX = 108 * k;
  const padTop = (story ? 260 : 108) * k;
  const markSize = 34 * k;
  const markBaseline = H - (story ? 230 : 64) * k;

  // Background
  ctx.fillStyle = style.bgColor;
  ctx.fillRect(0, 0, W, H);

  // Reference block is a fixed size so the verse can take everything else.
  const refSize = 38 * k;
  const refGap = 44 * k;
  const refHeight = refSize * 1.3;
  const areaTop = padTop;
  const areaBottom = markBaseline - markSize - 72 * k;
  const verseMaxHeight = areaBottom - areaTop - refGap - refHeight;
  const maxWidth = W - padX * 2;

  ctx.direction = face.rtl ? 'rtl' : 'ltr';
  const quoted = face.rtl ? passage : `“${passage}”`;
  const fitted = fitText(ctx, quoted, {
    font: (s) => `${s}px ${face.stack}`,
    maxWidth,
    maxHeight: verseMaxHeight,
    maxSize: 96 * k * face.scale * style.sizeNudge,
    minSize: 32 * k * face.scale,
    leading: 1.32 * face.lead,
  });

  const blockHeight = fitted.lines.length * fitted.lineHeight + refGap + refHeight;
  const slack = areaBottom - areaTop - blockHeight;
  const top =
    areaTop + (style.position === 'top' ? 0 : style.position === 'bottom' ? slack : slack / 2);

  // Left alignment follows the script: "start" is the right edge for Hebrew.
  const centred = style.align === 'center';
  const x = centred ? W / 2 : face.rtl ? W - padX : padX;
  ctx.textAlign = centred ? 'center' : 'start';
  ctx.textBaseline = 'middle';

  // Verse
  ctx.fillStyle = style.textColor;
  ctx.font = `${fitted.fontSize}px ${face.stack}`;
  fitted.lines.forEach((line, i) => {
    ctx.fillText(line, x, top + fitted.lineHeight * (i + 0.5));
  });

  // Reference — always with its translation.
  ctx.direction = 'ltr';
  const refX = centred ? W / 2 : padX;
  ctx.textAlign = centred ? 'center' : 'left';
  ctx.fillStyle = mix(style.textColor, style.bgColor, 0.3);
  ctx.font = `600 ${refSize}px ${DEFAULT_STACK}`;
  const refText = `— ${content.reference} (${content.translationLabel})`;
  const refY = top + fitted.lines.length * fitted.lineHeight + refGap + refHeight / 2;
  ctx.fillText(refText, refX, refY);

  drawMark(ctx, icon, W / 2, markBaseline, markSize, style.textColor);
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

/** The finished card as a PNG, ready for the share sheet or a download. */
export async function renderCardBlob(content: CardContent, style: CardStyle): Promise<Blob> {
  const canvas = document.createElement('canvas');
  await renderCard(canvas, content, style);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Card PNG failed'))), 'image/png'),
  );
}
