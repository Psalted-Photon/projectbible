<script lang="ts">
  /**
   * Voice Control's floating mic button: hold to talk, let go and it runs,
   * slide off first to cancel (lib/voice/holdToTalk.ts). The mic is open only
   * while it is held. Switched on per device in Settings → Voice Control.
   *
   * Dragged by its grip like the Read Aloud pill (lib/floatDrag.ts), and the
   * spot it is left in is remembered per device. It starts a little above
   * that pill's spot, so the two don't land on each other. With no mic
   * plugged in it says so, and comes alive when one is.
   *
   * Its size and which side the grip is on are set in Settings → Voice
   * Control. Holding the grip still for 2 seconds offers to hide it.
   *
   * Dark by design and carries `themed`, so it turns with the reader's theme
   * the way the Read Aloud pill does.
   */
  import { onDestroy } from 'svelte';
  import { DotsSix, DotsSixVertical, Microphone, MicrophoneSlash } from 'phosphor-svelte';
  import { portal } from '../lib/portal';
  import { floatDrag } from '../lib/floatDrag';
  import { getMicButtonPos, setMicButtonPos } from '../adapters/settings';
  import { showNotice } from '../stores/noticeStore';
  import BrandSpinner from './BrandSpinner.svelte';
  import {
    micButtonOn,
    setMicButtonOn,
    micButtonSize,
    micButtonGrip,
    voiceReady,
    talk,
    pressToTalk,
    moveTalk,
    releaseTalk,
    cancelTalk,
    startTalk,
  } from '../lib/voice/holdToTalk';

  /** How far above the bottom edge it starts, clear of the Read Aloud pill. */
  const START_ABOVE = 120;
  /** Holding the grip this long without moving offers to hide the button. */
  const HOLD_TO_HIDE_MS = 2000;
  /** Each size, on top of Bar size. */
  const SCALE = { small: 0.8, normal: 1, large: 1.3 };

  let el: HTMLDivElement | null = null;
  let button: HTMLButtonElement;
  const drag = floatDrag({
    // Far right, clamped back onto the screen.
    load: () => getMicButtonPos() ?? { x: 1e5, y: window.innerHeight - START_ABOVE },
    save: setMicButtonPos,
  });

  $: visible = $micButtonOn;
  $: if (visible && el) void drag.place(el);
  $: if (!visible) drag.teardown();

  $: upright = $micButtonGrip === 'top' || $micButtonGrip === 'bottom';

  let holdTimer: ReturnType<typeof setTimeout> | null = null;

  function clearHold() {
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = null;
  }

  /** Down on the grip: a drag, or held still long enough, the offer to hide. */
  function pressGrip(e: PointerEvent) {
    drag.start(e);
    clearHold();
    if (!$drag.dragging) return; // a control's press, not the grip's
    holdTimer = setTimeout(() => {
      holdTimer = null;
      navigator.vibrate?.(15);
      showNotice('Hide the mic button? Turn it back on in Settings → Voice Control.', 'info', {
        action: { label: 'Hide', run: () => setMicButtonOn(false) },
      });
    }, HOLD_TO_HIDE_MS);
  }

  // Moved or let go before the 2 seconds: it was a drag or a touch.
  $: if (holdTimer && (!$drag.dragging || $drag.moved)) clearHold();

  onDestroy(() => {
    clearHold();
    drag.teardown();
  });

  $: mine = $talk.source === 'float';
  $: held = mine && ($talk.phase === 'starting' || $talk.phase === 'listening');
  $: live = held && $talk.phase === 'listening' && !$talk.off;
  $: off = held && $talk.off;
  $: working = mine && $talk.phase === 'working';
  $: noMic = $voiceReady.mic === false;

  // Space or Enter held down talks too.
  const isTalkKey = (e: KeyboardEvent) => e.key === ' ' || e.key === 'Enter';

  function keyDown(e: KeyboardEvent) {
    if (isTalkKey(e)) {
      e.preventDefault();
      if (!e.repeat) startTalk(button, 'float');
    } else if (e.key === 'Escape') {
      cancelTalk();
    }
  }

  function keyUp(e: KeyboardEvent) {
    if (!isTalkKey(e)) return;
    e.preventDefault();
    void releaseTalk();
  }
</script>

{#if visible}
  <div
    bind:this={el}
    use:portal
    class="fmic themed no-edge-gesture grip-{$micButtonGrip}"
    class:dragging={$drag.dragging}
    style="left: {$drag.left}px; top: {$drag.top}px; visibility: {$drag.ready ? 'visible' : 'hidden'}; --mic-scale: {SCALE[$micButtonSize] ?? 1};"
    role="region"
    aria-label="Voice Control"
    on:pointerdown={pressGrip}
    on:contextmenu|preventDefault
  >
    <span class="grip" aria-hidden="true">
      {#if upright}<DotsSix size="1em" weight="bold" />{:else}<DotsSixVertical size="1em" weight="bold" />{/if}
    </span>
    {#if noMic}
      <span class="nomic"><MicrophoneSlash size="1.1em" weight="bold" /> No microphone found</span>
    {:else}
      <button
        bind:this={button}
        type="button"
        class="mic"
        class:live
        class:off
        style="--level: {live ? $talk.level : 0}"
        aria-label="Hold to talk"
        title="Hold to talk"
        on:pointerdown={(e) => pressToTalk(e, 'float')}
        on:pointermove={moveTalk}
        on:pointerup={releaseTalk}
        on:pointercancel={cancelTalk}
        on:keydown={keyDown}
        on:keyup={keyUp}
        on:contextmenu|preventDefault
      >
        {#if working}
          <BrandSpinner size={20} />
        {:else}
          <Microphone size="1.25em" weight={live ? 'fill' : 'bold'} />
        {/if}
      </button>
    {/if}
  </div>
{/if}

<style>
  .fmic {
    --s: calc(var(--bar-scale, 1) * var(--mic-scale, 1));
    position: fixed;
    /* Level with the Read Aloud pills: over popovers, under notices. */
    z-index: 10055;
    display: flex;
    align-items: center;
    gap: calc(2px * var(--s));
    padding: calc(3px * var(--s)) calc(3px * var(--s)) calc(3px * var(--s)) calc(2px * var(--s));
    background: var(--reader-bg, #1c1c1e);
    color: var(--reader-text, rgba(255, 255, 255, 0.92));
    border: 1px solid rgba(127, 127, 127, 0.25);
    border-radius: 999px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
    font-size: calc(16px * var(--s));
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    cursor: grab;
  }

  .fmic.dragging {
    cursor: grabbing;
  }

  /* The grip's side is a touch tighter, as the dots sit in their own padding. */
  .fmic.grip-right {
    flex-direction: row-reverse;
    padding: calc(3px * var(--s)) calc(2px * var(--s)) calc(3px * var(--s)) calc(3px * var(--s));
  }

  .fmic.grip-top {
    flex-direction: column;
    padding: calc(2px * var(--s)) calc(3px * var(--s)) calc(3px * var(--s));
  }

  .fmic.grip-bottom {
    flex-direction: column-reverse;
    padding: calc(3px * var(--s)) calc(3px * var(--s)) calc(2px * var(--s));
  }

  /* Wide enough for a thumb: the button takes the rest of the pill. */
  .grip {
    display: flex;
    flex-shrink: 0;
    padding: calc(10px * var(--s)) calc(5px * var(--s));
    font-size: 0.85em;
    opacity: 0.4;
  }

  .grip-top .grip,
  .grip-bottom .grip {
    padding: calc(5px * var(--s)) calc(10px * var(--s));
  }

  .mic {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: calc(42px * var(--s));
    height: calc(42px * var(--s));
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: #e6b84a;
    font-size: 1em;
    cursor: pointer;
    touch-action: none;
    -webkit-touch-callout: none;
    transition: background 0.15s, box-shadow 0.08s;
  }

  .mic:hover {
    background: rgba(127, 127, 127, 0.18);
  }

  .mic.live {
    background: #e6b84a;
    color: #1c1c1e;
    box-shadow: 0 0 0 calc((3px + var(--level, 0) * 9px) * var(--s)) rgba(230, 184, 74, 0.35);
  }

  .mic.off {
    background: #555;
    color: #eee;
  }

  .nomic {
    display: inline-flex;
    align-items: center;
    gap: calc(6px * var(--s));
    padding: 0 calc(10px * var(--s)) 0 calc(4px * var(--s));
    min-height: calc(42px * var(--s));
    font-size: 0.8em;
    opacity: 0.75;
    white-space: nowrap;
  }
</style>
