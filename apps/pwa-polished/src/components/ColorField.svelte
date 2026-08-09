<script lang="ts">
  /**
   * In-app colour picker.
   *
   * Replaces `<input type="color">`, which hands rendering to the operating
   * system — desktop Chrome opens a full dialog, phones substitute a cramped
   * system widget, and neither can be styled. Drawing it here is the only way
   * to have one picker that looks and behaves the same everywhere.
   *
   * Pick by touching the spectrum box; hue runs left to right and lightness
   * top to bottom, so every colour is visible at once and nothing has to be
   * reasoned about. The neutrals strip covers white/grey/black, which a
   * rainbow represents badly. The muted/vivid slider is secondary — it only
   * exists to reach desaturated tones, and can be ignored entirely.
   */
  import { createEventDispatcher } from "svelte";
  import { hexToHsl, hslToHex, isValidHex } from "../lib/themeColors";

  export let value: string = "#ffffff";
  export let label: string = "Colour";

  const dispatch = createEventDispatcher<{ change: string }>();

  let boxEl: HTMLDivElement | null = null;
  let stripEl: HTMLDivElement | null = null;
  let dragging: "box" | "strip" | null = null;

  /**
   * Saturation is component state, not derived from `value`, because it has to
   * survive picking a grey. hexToHsl reports s = 0 for any neutral, so reading
   * it back would silently reset the slider to "muted" every time the user
   * touched the neutrals strip, and the box would go grey with it.
   */
  let saturation = 1;

  // Marker position. Derived from `value` so presets, typed hex and synced
  // settings all move the marker, not just local drags.
  $: hsl = hexToHsl(value);
  $: markerX = (hsl.h / 360) * 100;
  $: markerY = (1 - hsl.l) * 100;
  $: isNeutral = hsl.s < 0.04;

  // The box repaints as saturation changes: a rainbow at the current
  // saturation, with white fading in above the midline and black below.
  $: hueStops = [0, 60, 120, 180, 240, 300, 360]
    .map((h) => `${hslToHex(h, saturation, 0.5)} ${(h / 360) * 100}%`)
    .join(", ");

  function commit(hex: string) {
    if (hex === value) return;
    value = hex;
    dispatch("change", hex);
  }

  /** Fraction of the way across/down an element, clamped to its bounds. */
  function ratio(el: HTMLElement, clientX: number, clientY: number) {
    const box = el.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (clientY - box.top) / box.height)),
    };
  }

  function pickFromBox(clientX: number, clientY: number) {
    if (!boxEl) return;
    const { x, y } = ratio(boxEl, clientX, clientY);
    commit(hslToHex(x * 360, saturation, 1 - y));
  }

  function pickFromStrip(clientX: number, clientY: number) {
    if (!stripEl) return;
    const { x } = ratio(stripEl, clientX, clientY);
    commit(hslToHex(0, 0, 1 - x));
  }

  // Pointer capture keeps the drag tracking once the finger leaves the
  // element, and gives mouse and touch a single code path.
  function down(e: PointerEvent, which: "box" | "strip") {
    dragging = which;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (which === "box") pickFromBox(e.clientX, e.clientY);
    else pickFromStrip(e.clientX, e.clientY);
  }

  function move(e: PointerEvent) {
    if (!dragging) return;
    if (dragging === "box") pickFromBox(e.clientX, e.clientY);
    else pickFromStrip(e.clientX, e.clientY);
  }

  function up(e: PointerEvent) {
    if (!dragging) return;
    dragging = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  }

  function onSaturation() {
    // Re-place the current colour at the new saturation, keeping hue and
    // lightness, so the swatch tracks the slider instead of jumping.
    commit(hslToHex(hsl.h, saturation, hsl.l));
  }

  function onHexInput(e: Event) {
    const raw = (e.target as HTMLInputElement).value.trim();
    const hex = raw.startsWith("#") ? raw : `#${raw}`;
    if (!isValidHex(hex)) return; // ignore half-typed values, don't fight the user
    saturation = Math.max(saturation, hexToHsl(hex).s);
    commit(hex.toLowerCase());
  }

  /**
   * Arrow keys nudge the marker for anyone not using a pointer. The box is
   * role="application" rather than role="slider" because it is a
   * two-dimensional surface — ARIA has no 2D slider, and claiming one would
   * promise a single aria-valuenow that cannot exist.
   */
  function onBoxKey(e: KeyboardEvent) {
    const stepH = e.key === "ArrowRight" ? 4 : e.key === "ArrowLeft" ? -4 : 0;
    const stepL = e.key === "ArrowUp" ? 0.02 : e.key === "ArrowDown" ? -0.02 : 0;
    if (!stepH && !stepL) return;
    e.preventDefault();
    commit(hslToHex(hsl.h + stepH, saturation, hsl.l + stepL));
  }

  /** The neutrals strip really is one-dimensional, so it is a proper slider. */
  function onStripKey(e: KeyboardEvent) {
    const step = e.key === "ArrowRight" ? -0.02 : e.key === "ArrowLeft" ? 0.02 : 0;
    if (!step) return;
    e.preventDefault();
    commit(hslToHex(0, 0, hsl.l + step));
  }
</script>

<div class="cf">
  <!-- Spectrum: hue across, white → colour → black down.
       The linter does not count role="application" as interactive, but this
       element is: it takes focus, handles pointer drags and arrow keys.
       ARIA has no two-dimensional slider role to use instead. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    bind:this={boxEl}
    class="cf-box"
    class:dragging={dragging === "box"}
    style="--hues: linear-gradient(to right, {hueStops})"
    role="application"
    tabindex="0"
    aria-label="{label} spectrum. Arrow keys adjust hue and lightness. Current colour {value}."
    on:pointerdown={(e) => down(e, "box")}
    on:pointermove={move}
    on:pointerup={up}
    on:pointercancel={up}
    on:keydown={onBoxKey}
  >
    <span
      class="cf-marker"
      class:hidden={isNeutral}
      style="left: {markerX}%; top: {markerY}%; background: {value}"
    ></span>
  </div>

  <!-- Neutrals: white → grey → black, which the rainbow covers poorly. -->
  <div
    bind:this={stripEl}
    class="cf-strip"
    class:dragging={dragging === "strip"}
    role="slider"
    tabindex="0"
    aria-label="{label} greys"
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={Math.round(hsl.l * 100)}
    aria-valuetext="{Math.round(hsl.l * 100)}% light, {value}"
    on:pointerdown={(e) => down(e, "strip")}
    on:pointermove={move}
    on:pointerup={up}
    on:pointercancel={up}
    on:keydown={onStripKey}
  >
    <span
      class="cf-marker"
      class:hidden={!isNeutral}
      style="left: {(1 - hsl.l) * 100}%; top: 50%; background: {value}"
    ></span>
  </div>

  <label class="cf-sat">
    <span>Muted</span>
    <input
      type="range"
      min="0"
      max="1"
      step="0.01"
      bind:value={saturation}
      on:input={onSaturation}
      aria-label="{label} intensity"
    />
    <span>Vivid</span>
  </label>

  <div class="cf-foot">
    <span class="cf-chip" style="background: {value}"></span>
    <input
      class="cf-hex"
      type="text"
      inputmode="text"
      spellcheck="false"
      autocomplete="off"
      maxlength="7"
      value={value.toUpperCase()}
      on:change={onHexInput}
      on:blur={onHexInput}
      aria-label="{label} hex value"
    />
    <slot />
  </div>
</div>

<style>
  .cf {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .cf-box {
    position: relative;
    width: 100%;
    height: 150px;
    border-radius: 8px;
    border: 1px solid #4a4a4a;
    cursor: crosshair;
    /* touch-action stops the pane behind scrolling while a finger drags here. */
    touch-action: none;
    /* Top layer fades white in above the midline and black in below it, over
       the rainbow underneath — the same construction as hsl() lightness. */
    background:
      linear-gradient(
        to bottom,
        #fff 0%,
        rgba(255, 255, 255, 0) 50%,
        rgba(0, 0, 0, 0) 50%,
        #000 100%
      ),
      var(--hues);
  }
  .cf-box:focus-visible,
  .cf-strip:focus-visible {
    outline: 2px solid #667eea;
    outline-offset: 2px;
  }

  .cf-strip {
    position: relative;
    width: 100%;
    height: 30px;
    border-radius: 8px;
    border: 1px solid #4a4a4a;
    cursor: crosshair;
    touch-action: none;
    background: linear-gradient(to right, #fff, #808080, #000);
  }

  .cf-marker {
    position: absolute;
    width: 18px;
    height: 18px;
    margin: -9px 0 0 -9px;
    border-radius: 50%;
    border: 2px solid #fff;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6), 0 1px 4px rgba(0, 0, 0, 0.5);
    pointer-events: none;
  }
  /* Hue is meaningless for a grey, so the box marker would sit at a lie —
     show whichever marker matches the kind of colour that is selected. */
  .cf-marker.hidden {
    display: none;
  }

  .cf-sat {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.7rem;
    color: #8f8f8f;
  }
  .cf-sat input[type="range"] {
    flex: 1;
    min-width: 0;
  }

  .cf-foot {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .cf-chip {
    width: 30px;
    height: 30px;
    flex: none;
    border-radius: 6px;
    border: 1px solid #4a4a4a;
  }

  .cf-hex {
    flex: 1;
    min-width: 0;
    padding: 6px 8px;
    background: #1a1a1a;
    border: 1px solid #444;
    border-radius: 6px;
    color: #e0e0e0;
    font-size: 0.8rem;
    font-family: ui-monospace, Menlo, Consolas, monospace;
    text-transform: uppercase;
  }
  .cf-hex:focus {
    outline: none;
    border-color: #667eea;
  }

  @media (max-width: 480px) {
    .cf-box {
      height: 130px;
    }
  }
</style>
