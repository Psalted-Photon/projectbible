<script lang="ts">
  /**
   * Two letters on a coloured disc — the badge that says who this is.
   *
   * It was written twice before this existed: once in BibleReader's verse
   * gutter, where a commentator's initials sit beside the verse number, and
   * again in AnnotationPanel's header, where the same commentator gets a
   * rounder version. Shared notebooks want a third copy for their members, so
   * the two became one rather than three.
   *
   * There is no logic here on purpose. Which colour and which letters belong
   * to whom is a question with two different answers — annotationConfig for a
   * commentator, the member row for a person — and neither of them is this
   * component's business. It is handed a colour and two letters and draws them.
   *
   * Two shapes, both exactly as they were:
   *   gutter — 20×14, barely taller than a word, for sitting in a margin.
   *   round  — 22×22, for a heading where there is room to be a proper disc.
   */
  import { createEventDispatcher } from 'svelte';

  export let color: string = '#888888';
  export let initials: string = '··';
  /** The tooltip, and what a screen reader hears when this is a button. */
  export let title: string = '';
  export let variant: 'gutter' | 'round' = 'gutter';
  /** Overrides the round shape's diameter. Ignored by the gutter shape. */
  export let size: number | null = null;
  /** Tappable. A pill that only says who wrote something is not. */
  export let interactive: boolean = false;
  /** The slow pulse that marks the pill whose panel is open. */
  export let breathing: boolean = false;
  /** Kept so callers can add their own class — the tutorial looks for one. */
  export let extraClass: string = '';

  const dispatch = createEventDispatcher<{ select: void }>();

  // The reader's badge is the same gradient it has always had: the colour
  // itself for the first fifth, then a fall into the same near-black. Written
  // once here rather than at each call site.
  $: background = `radial-gradient(circle, ${color} 0%, ${color} 20%, #431407 100%)`;
  $: sizeStyle =
    variant === 'round' && size ? `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.45)}px;` : '';

  /**
   * Both call sites that made this tappable also stopped the click going
   * further — the verse underneath opens its own menu otherwise — so that is
   * part of what being interactive means rather than something each caller
   * remembers separately.
   */
  function fire(e: Event) {
    e.stopPropagation();
    dispatch('select');
  }
</script>

{#if interactive}
  <span
    class="pill {variant} {extraClass}"
    class:anno-breathing={breathing}
    style="background:{background};{sizeStyle}"
    {title}
    role="button"
    tabindex="0"
    on:click={fire}
    on:keypress={fire}>{initials}</span
  >
{:else}
  <span
    class="pill {variant} {extraClass}"
    class:anno-breathing={breathing}
    style="background:{background};{sizeStyle}"
    {title}>{initials}</span
  >
{/if}

<style>
  .pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    color: #fff;
    line-height: 1;
    user-select: none;
    flex-shrink: 0;
  }

  /* The verse-gutter badge, to the pixel it has always been. */
  .gutter {
    width: 20px;
    height: 14px;
    border-radius: 9px;
    font-size: 7px;
    margin: 0 1px;
    vertical-align: super;
  }

  .round {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    font-size: 10px;
  }

  .pill[role='button'] {
    cursor: pointer;
  }

  /* ── The tapped pill, while its panel is open ─────────────────────────────
     A slow scale in and out, so you can find your way back to the icon you
     opened. transform does not affect layout, so nothing around it shifts.
     The reader's cross-reference diamond has the same cadence from its own
     rule — this one travelled here with the pill. */
  @keyframes pill-breathe {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.28); }
  }

  .anno-breathing {
    animation: pill-breathe 2s ease-in-out infinite;
    transform-origin: center;
  }

  @media (prefers-reduced-motion: reduce) {
    /* Hold the enlarged state rather than pulsing — the pill still stands out,
       nothing moves. */
    .anno-breathing {
      animation: none;
      transform: scale(1.28);
    }
  }
</style>
