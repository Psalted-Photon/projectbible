<script lang="ts">
  /**
   * A QR code, drawn in the app.
   *
   * Nothing here scans anything — phone cameras open a QR link by themselves,
   * so the app only ever needs to show one. That makes this the whole of the
   * feature: hold a phone up to another phone and it opens the join link.
   *
   * The generator is 20 KB and is wanted only on the one sheet that shows an
   * invitation, so it is imported on demand the way Lexical is rather than
   * riding along in the main bundle for everyone who never shares a notebook.
   *
   * Drawn as an SVG rather than a canvas so it stays sharp at any size and
   * survives the screenshot people will inevitably take of it.
   */
  export let value = '';
  /** The drawn size in pixels, quiet zone included. */
  export let size = 180;
  export let label = 'QR code';

  type Matrix = { count: number; dark: (r: number, c: number) => boolean };

  let matrix: Matrix | null = null;
  let failed = false;

  /**
   * Four modules of clear space on every side.
   *
   * Part of the spec, not decoration: a scanner finds the code by its quiet
   * zone, and a QR pressed flush against the edge of a dark card is one many
   * phones simply will not see.
   */
  const QUIET = 4;

  $: void render(value);

  async function render(text: string) {
    if (!text) {
      matrix = null;
      failed = false;
      return;
    }
    try {
      const qrcode = (await import('qrcode-generator')).default;
      // Type 0 picks the smallest version the text fits in. Level M corrects
      // around 15% — enough for a screen held at an angle, without the extra
      // modules that make a high level harder to scan at this size.
      const qr = qrcode(0, 'M');
      qr.addData(text);
      qr.make();
      // Copied out rather than held as the generator's object, so the reactive
      // statement below re-runs when a new code replaces an old one.
      const count = qr.getModuleCount();
      matrix = { count, dark: (r, c) => qr.isDark(r, c) };
      failed = false;
    } catch (err) {
      // Offline on first use, or the chunk failed to load. The code and the
      // link are both on the sheet already, so this is a missing convenience
      // rather than a missing feature — say so and let them read the code out.
      console.error('[QrCode] Could not draw a code:', err);
      matrix = null;
      failed = true;
    }
  }

  /**
   * Every dark module as one path.
   *
   * One element instead of several hundred rects: a version-3 code is 29×29,
   * and a node apiece is a real cost on a phone for no gain, since they are all
   * the same colour and none of them is interactive.
   */
  function pathFor(m: Matrix): string {
    const parts: string[] = [];
    for (let row = 0; row < m.count; row++) {
      for (let col = 0; col < m.count; col++) {
        if (m.dark(row, col)) parts.push(`M${col + QUIET} ${row + QUIET}h1v1h-1z`);
      }
    }
    return parts.join('');
  }

  $: span = matrix ? matrix.count + QUIET * 2 : 0;
</script>

{#if matrix}
  <svg
    class="qr"
    width={size}
    height={size}
    viewBox="0 0 {span} {span}"
    shape-rendering="crispEdges"
    role="img"
    aria-label={label}
  >
    <!-- White behind the code, always. Dark-on-light is what every scanner
         reads first, and an inverted code on this app's dark card is one some
         of them refuse outright. -->
    <rect width={span} height={span} fill="#ffffff" />
    <path d={pathFor(matrix)} fill="#000000" />
  </svg>
{:else if failed}
  <p class="qr-failed">The code couldn't be drawn. The link and the code above both still work.</p>
{/if}

<style>
  .qr {
    display: block;
    border-radius: 8px;
  }

  .qr-failed {
    margin: 0;
    font-size: 0.75rem;
    color: #888;
    line-height: 1.45;
  }
</style>
