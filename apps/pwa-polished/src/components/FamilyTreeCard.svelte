<script lang="ts">
  /**
   * The card that names whoever is hovered or pinned on the tree.
   *
   * Ported from the lab's showHover() (markup and CSS) and its ancestor-list
   * click handler, as real Svelte rather than innerHTML strings. The "Full
   * bio would appear here" placeholder is left out — Phase 2 puts a real
   * Read bio button in its place.
   */
  import { generationOf, ancestorChain, type TreeModel, type TreeRec } from '../lib/familyTree/layout';
  import { ROOT_COLOURS, STONES, LINEN, GOD_ID } from '../lib/familyTree/config';

  export let model: TreeModel;
  export let person: TreeRec;
  /** Hover-only cards (mouse, nobody pinned) skip the ancestor toggle and take
   *  no pointer events, so they never fight the canvas underneath them. */
  export let pinned = true;
  /** Set once the tree is pinned; tapping a name here traces from them instead. */
  export let onTraceAncestor: ((rec: TreeRec) => void) | null = null;

  let gensOpen = false;
  // Reset whenever the card starts naming someone else, so walking the tree
  // doesn't leave a stranger's ancestor list stuck open under the new name.
  $: person, (gensOpen = false);

  $: isWife = !!person.spouseOf;
  $: husband = isWife ? model.rootById.get(person.spouseOf!) : null;
  $: branchColour = ROOT_COLOURS[person.branch || 'Trunk'] || ROOT_COLOURS.Trunk;
  $: stone = !person.root ? STONES[person.tribe || ''] : null;

  $: fromGod = generationOf(model, person.id);
  $: toJesus = model.toJesus.get(person.id);

  $: chain = pinned && fromGod && fromGod > 0 ? ancestorChain(model, person).slice(1) : [];

  function traceTo(rec: TreeRec) {
    onTraceAncestor?.(rec);
  }
</script>

<div class="readout-box" class:pinned>
  <div class="nm">{person.label}</div>
  {#if person.meaning}<div class="mn">“{person.meaning}”</div>{/if}

  {#if isWife}
    <div class="tr" style="color:{branchColour.lit}">
      wife of {husband ? husband.label : 'a man on the tree'}
    </div>
  {:else if person.root}
    <div class="tr" style="color:{branchColour.lit}">
      {person.branch === 'Trunk' ? 'The trunk, God to Jacob' : `${person.branch}’s bough`}
    </div>
  {:else}
    <div class="tr" style="color:{stone?.lit || LINEN}">
      {person.tribe}{stone?.stone ? ` · ${stone.stone}` : ''}
    </div>
  {/if}

  {#if typeof person.lived === 'number' && person.lived > 0}
    <div class="tr lived">lived {person.lived} years</div>
  {/if}

  {#if person.verseCount}
    <div class="tr verses">{person.verseCount} verse{person.verseCount === 1 ? '' : 's'}</div>
  {/if}

  {#if (fromGod && fromGod > 0) || (toJesus && toJesus > 0)}
    <div class="tr gens">
      {#if fromGod && fromGod > 0}
        {#if pinned && chain.length}
          <button class="gens-toggle" class:open={gensOpen} on:click={() => (gensOpen = !gensOpen)}>
            {fromGod} from God
          </button>
        {:else}
          <span>{fromGod} from God</span>
        {/if}
      {/if}
      {#if toJesus && toJesus > 0}
        <span>{fromGod && fromGod > 0 ? ' · ' : ''}{toJesus} to Jesus</span>
      {/if}
    </div>
  {/if}

  {#if gensOpen && chain.length}
    <div class="gens-list">
      {#each chain as rec (rec.id)}
        <button class:god={rec.id === GOD_ID} on:click={() => traceTo(rec)}>{rec.label}</button>
      {/each}
    </div>
  {/if}

  <slot />
</div>

<style>
  .readout-box {
    position: absolute;
    /* Top right, below the ✕ Close button (which sits in the same corner). */
    top: calc(env(safe-area-inset-top, 0px) + 58px);
    right: calc(env(safe-area-inset-right, 0px) + 12px);
    background: rgba(13, 12, 11, 0.82);
    border: 1px solid #241f1a;
    border-radius: 7px;
    padding: 9px 11px;
    font-size: 11.5px;
    color: #a89a85;
    line-height: 1.6;
    max-width: 260px;
    backdrop-filter: blur(6px);
    /* Hover cards take no pointer events, so they never fight the canvas
       underneath them — only a pinned card's ancestor list is clickable. */
    pointer-events: none;
  }
  .readout-box.pinned {
    pointer-events: auto;
  }

  .nm {
    color: #e8dcc8;
    font-family: Milonga, serif;
    font-size: 15px;
  }
  .mn {
    color: #7d7264;
    font-style: italic;
  }
  .tr {
    font-size: 10.5px;
    letter-spacing: 0.04em;
  }
  .lived,
  .verses {
    color: #8a7d6b;
  }
  .gens {
    color: #6b6153;
  }

  .gens-toggle {
    background: none;
    border: none;
    padding: 0;
    color: inherit;
    font: inherit;
    font-size: 10.5px;
    letter-spacing: 0.04em;
    cursor: pointer;
  }
  .gens-toggle:hover {
    color: #cdbfa8;
  }
  .gens-toggle::after {
    content: ' \25be';
    font-size: 9px;
  }
  .gens-toggle.open::after {
    content: ' \25b4';
  }

  .gens-list {
    margin-top: 6px;
    max-height: 220px;
    overflow-y: auto;
    border-top: 1px solid #241f1a;
    padding-top: 6px;
  }
  .gens-list button {
    display: block;
    width: 100%;
    background: none;
    border: none;
    padding: 3px 2px;
    color: #a89a85;
    font: inherit;
    text-align: left;
    text-decoration: none;
    font-size: 11px;
    border-radius: 3px;
    cursor: pointer;
  }
  .gens-list button:hover {
    background: #1c1916;
    color: #e0d4bf;
  }
  .gens-list button.god {
    color: #cdbfa8;
    font-weight: 600;
  }

  @media (max-width: 480px) {
    .readout-box {
      max-width: 190px;
      font-size: 11px;
    }
  }
</style>
