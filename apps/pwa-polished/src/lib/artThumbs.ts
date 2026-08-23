/**
 * Downscaled previews for the biblical-art gallery.
 *
 * The art pack ships no usable thumbnails: `thumbId` falls back to the full
 * image for every work, so the browse list was decoding 1024-1920px JPEGs
 * (up to 3.4MB each) to paint 52px squares. With a preview-size slider that
 * gets worse, so the pane asks for a small copy instead and this module makes
 * one the first time it is needed.
 *
 * Pixel work only -- storage lives in IndexedDBArtStore.getThumbUrl(), which
 * owns the database and the object-URL lifetime.
 */

/** Long edge of a generated preview, in pixels. */
export const THUMB_MAX_EDGE = 512;

/** Key a derived preview is stored under, alongside the full images. */
export const thumbKey = (imageId: string) => `t${THUMB_MAX_EDGE}:${imageId}`;

/**
 * Sources already this small aren't worth re-encoding -- the few works whose
 * 400px download did succeed land here, and so do small line engravings.
 */
export const THUMB_SKIP_BYTES = 80 * 1024;

/** Paintings are photographs; JPEG at this quality is indistinguishable at tile size. */
const JPEG_QUALITY = 0.82;

/**
 * Decode a blob to something drawable.
 *
 * createImageBitmap decodes off the main thread, which keeps a scrolling grid
 * smooth, but Safari rejects some progressive and CMYK JPEGs -- and the pack is
 * full of Wikimedia scans. Fall back to an <img>, which is slower and on-thread
 * but accepts everything the browser can display at all.
 *
 * Note: createImageBitmap's own resizeWidth/resizeQuality options are NOT used.
 * Safari ignores them, so a canvas pass is needed regardless and relying on
 * them would silently produce full-size thumbnails there.
 */
async function decode(blob: Blob): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      // Fall through to the <img> path.
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      // The bitmap stays alive as long as the <img> does; dropping the object
      // URL and the reference is all that can be done here.
      release: () => URL.revokeObjectURL(url),
    };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

/**
 * Shrink an image blob so its long edge is at most `maxEdge`.
 *
 * Returns null when the source can't be decoded or the canvas won't encode, so
 * callers can fall back to the original bytes rather than showing nothing.
 */
export async function downscaleBlob(
  blob: Blob,
  maxEdge: number = THUMB_MAX_EDGE
): Promise<Blob | null> {
  let decoded: Awaited<ReturnType<typeof decode>> | null = null;
  try {
    decoded = await decode(blob);
    const { source, width, height } = decoded;
    if (!width || !height) return null;

    const scale = Math.min(1, maxEdge / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // JPEG has no alpha, so a transparent PNG source would otherwise composite
    // onto black-ish garbage. Paint the gallery's own backdrop first.
    ctx.fillStyle = '#111111';
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, w, h);

    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((out) => resolve(out), 'image/jpeg', JPEG_QUALITY);
    });
  } catch {
    return null;
  } finally {
    // A 1365x2964 source is ~16MB of RGBA once decoded. Leaking those across 95
    // paintings is the whole risk this module exists to avoid.
    decoded?.release();
  }
}

/**
 * Generate at most two previews at once, and never the same one twice.
 *
 * Concurrency is capped because decoding is memory-hungry, and de-duplicated
 * because two art panes can be open in different windows and would otherwise
 * race to write the same row.
 */
const MAX_CONCURRENT = 2;

const inFlight = new Map<string, Promise<unknown>>();
const queue: (() => void)[] = [];
let active = 0;

function pump() {
  while (active < MAX_CONCURRENT && queue.length) {
    const start = queue.shift();
    if (start) start();
  }
}

/**
 * Run `task` under the shared preview budget, collapsing concurrent callers for
 * the same `key` onto one run.
 */
export function enqueueThumbTask<T>(key: string, task: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const promise = new Promise<T>((resolve, reject) => {
    queue.push(() => {
      active++;
      task()
        .then(resolve, reject)
        .finally(() => {
          active--;
          inFlight.delete(key);
          pump();
        });
    });
    pump();
  });

  inFlight.set(key, promise);
  return promise;
}
