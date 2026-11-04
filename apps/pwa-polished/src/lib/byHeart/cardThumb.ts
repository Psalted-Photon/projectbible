/**
 * The small card on a By Heart row, and the picture behind any saved card.
 *
 * A card is a 1080-wide canvas, and a list of them at that size would hold
 * gigabytes of memory on a phone. So each one is drawn once at full size, one
 * at a time, shrunk to a small image, and only that image is kept.
 */

import { IndexedDBArtStore } from '../../adapters/ArtStore';
import type { DBByHeartVerse } from '../../adapters/db';
import { syncedByHeartStore } from '../../adapters/SyncedByHeartStore';
import { decodeImage, renderCard, type CardImage } from '../shareCard';
import { buildShareUrl } from '../shareText';
import { cardContentOf, drawableStyle, savedCardOf, shareRefOf } from './verse';

/** Wide enough for a sharp thumbnail on a 3x phone screen. */
const THUMB_WIDTH = 216;

const artStore = new IndexedDBArtStore();

/**
 * The photo or painting behind a saved card. Null when there is none on this
 * device: a photo picked elsewhere, or a painting whose pack isn't installed.
 */
export async function cardImageOf(verse: DBByHeartVerse): Promise<CardImage | null> {
  const { style, painting } = savedCardOf(verse);
  try {
    if (style.background === 'photo') {
      const photo = await syncedByHeartStore.getPhoto(verse.id);
      if (!photo) return null;
      const decoded = await decodeImage(photo.image);
      return { ...decoded, zoom: photo.zoom, panX: photo.panX, panY: photo.panY };
    }
    if (style.background === 'painting' && painting) {
      const url = await artStore.getImageUrl(painting.imageId);
      if (!url) return null;
      const decoded = await decodeImage(url);
      return { ...decoded, zoom: painting.zoom, panX: painting.panX, panY: painting.panY, credit: painting.credit };
    }
  } catch (err) {
    console.warn('[By Heart] the picture behind a card could not be opened', err);
  }
  return null;
}

/** What a QR code on a saved card opens. */
export function qrUrlOf(verse: DBByHeartVerse): string {
  return buildShareUrl(shareRefOf(verse), verse.translation);
}

const thumbs = new Map<string, { stamp: number; url: Promise<string | null> }>();
/** One at a time: each draw takes a whole card's worth of canvas. */
let line: Promise<unknown> = Promise.resolve();

async function drawThumb(verse: DBByHeartVerse): Promise<string | null> {
  const card = savedCardOf(verse);
  const image = await cardImageOf(verse);
  const full = document.createElement('canvas');
  await renderCard(full, cardContentOf(verse), drawableStyle(card, !!image), {
    image,
    emphasis: card.emphasis,
    qrUrl: qrUrlOf(verse),
  });
  const small = document.createElement('canvas');
  small.width = THUMB_WIDTH;
  small.height = Math.round((full.height / full.width) * THUMB_WIDTH);
  const ctx = small.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(full, 0, 0, small.width, small.height);
  // Let go of the full-size canvas straight away; phones run short on these.
  full.width = full.height = 0;
  const blob = await new Promise<Blob | null>((resolve) => small.toBlob(resolve, 'image/jpeg', 0.85));
  return blob ? URL.createObjectURL(blob) : null;
}

/** The small card for this verse, as an image URL. Drawn again only when the verse has changed. */
export function cardThumb(verse: DBByHeartVerse): Promise<string | null> {
  const held = thumbs.get(verse.id);
  if (held?.stamp === verse.updatedAt) return held.url;
  if (held) void held.url.then((old) => old && URL.revokeObjectURL(old));
  const url = line
    .catch(() => {})
    .then(() => drawThumb(verse))
    .catch((err) => {
      console.warn('[By Heart] a small card could not be drawn', err);
      return null;
    });
  line = url;
  thumbs.set(verse.id, { stamp: verse.updatedAt, url });
  return url;
}

/** Let go of the small cards of verses no longer saved. */
export function keepThumbs(ids: Set<string>): void {
  for (const [id, held] of thumbs) {
    if (ids.has(id)) continue;
    void held.url.then((old) => old && URL.revokeObjectURL(old));
    thumbs.delete(id);
  }
}
