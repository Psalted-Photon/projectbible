<script lang="ts">
  /**
   * Where a tap ends and a press begins, for the VC button in games: a quick
   * tap keeps the mic on until tapped again, and a longer press closes it on
   * release. Measures the user's own taps and presses, suggests the line between
   * them, then lets it be tried. The mic stays off here; it's only the timing.
   */
  import { get } from 'svelte/store';
  import { Microphone } from 'phosphor-svelte';
  import { labResults, medianOf, patchResults } from '../../../lib/byHeart/lab/labResults';

  const PER_ROUND = 8;

  const saved = get(labResults).press;
  let mode: 'taps' | 'presses' | 'try' =
    saved.presses.length >= PER_ROUND ? 'try' : saved.taps.length >= PER_ROUND ? 'presses' : 'taps';
  let downAt = 0;
  let held = false;
  let call = '';

  $: press = $labResults.press;
  $: suggested = suggest(press.taps, press.presses);
  $: cutoff = press.cutoff ?? suggested ?? 300;

  /** Halfway between the slower taps and the quicker presses. */
  function suggest(taps: number[], presses: number[]): number | null {
    if (!taps.length || !presses.length) return null;
    const t = [...taps].sort((a, b) => a - b);
    const p = [...presses].sort((a, b) => a - b);
    const slowTap = t[Math.min(t.length - 1, Math.floor(t.length * 0.9))];
    const quickPress = p[Math.floor(p.length * 0.1)];
    return Math.round((slowTap + quickPress) / 2);
  }

  function down(e: PointerEvent) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    downAt = e.timeStamp;
    held = true;
  }

  function up(e: PointerEvent) {
    if (!held) return;
    held = false;
    const ms = e.timeStamp - downAt;
    if (mode === 'taps') {
      const taps = [...press.taps, ms].slice(-PER_ROUND);
      patchResults({ press: { ...press, taps } });
      if (taps.length >= PER_ROUND && press.presses.length < PER_ROUND) mode = 'presses';
    } else if (mode === 'presses') {
      const presses = [...press.presses, ms].slice(-PER_ROUND);
      const finished = presses.length >= PER_ROUND;
      patchResults({ press: { ...press, presses, cutoff: finished ? suggest(press.taps, presses) : press.cutoff } });
      if (finished) mode = 'try';
    } else {
      call = ms < cutoff ? `Tap (${Math.round(ms)} ms): the mic stays on` : `Press (${Math.round(ms)} ms): the mic closes on release`;
      patchResults({ press: { ...press, tries: press.tries + 1 } });
    }
  }

  function setCutoff(e: Event) {
    patchResults({ press: { ...press, cutoff: Number((e.currentTarget as HTMLInputElement).value) } });
  }

  function redo() {
    patchResults({ press: { taps: [], presses: [], cutoff: null, tries: 0, wrongCalls: 0 } });
    mode = 'taps';
    call = '';
  }
</script>

<p class="lab-hint">
  {#if mode === 'taps'}
    Tap the button {PER_ROUND} times, the way you'd tap to turn the mic on and leave it on. {press.taps.length} of {PER_ROUND}.
  {:else if mode === 'presses'}
    Now press and let go {PER_ROUND} times, the way you'd hold it for a few words but as short as you'd ever hold it. {press.presses.length} of {PER_ROUND}.
  {:else}
    Try it: tap and press as you naturally would. It says how each one was taken. If it gets one wrong, tap <b>That was wrong</b>.
  {/if}
</p>

<div class="lab-row lab-center">
  <button
    class="lab-mic press"
    class:live={held}
    aria-label="Test button"
    on:pointerdown={down}
    on:pointerup={up}
    on:pointercancel={() => (held = false)}
    on:contextmenu|preventDefault
  >
    <Microphone size={26} weight={held ? 'fill' : 'bold'} />
  </button>
</div>

{#if mode === 'try'}
  {#if call}<p class="lab-say">{call}</p>{/if}
  <div class="lab-row">
    <label class="grow">Cutoff: {Math.round(cutoff)} ms
      <input type="range" min="80" max="800" step="10" value={cutoff} on:input={setCutoff} />
    </label>
  </div>
  <div class="lab-row">
    <button class="lab-btn" on:click={() => patchResults({ press: { ...press, wrongCalls: press.wrongCalls + 1 } })}>That was wrong ({press.wrongCalls})</button>
    <button class="lab-btn" on:click={redo}>Start over</button>
  </div>
{/if}

{#if press.taps.length || press.presses.length}
  <div class="lab-stats">
    <div>Taps: typically {Math.round(medianOf(press.taps) ?? 0)} ms · Presses: typically {Math.round(medianOf(press.presses) ?? 0)} ms</div>
    {#if suggested != null}<div><b>Suggested cutoff: {suggested} ms</b></div>{/if}
  </div>
{/if}
