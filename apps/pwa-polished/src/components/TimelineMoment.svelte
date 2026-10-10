<script lang="ts">
  /**
   * "At this moment": everything going on in the year under the Moment line.
   *
   * One line per lane, each name a plain link colored the way its lane draws
   * it, which opens that item's card. Empty lines are left out, so a year with
   * no king of Israel simply has no Israel line.
   */
  import { formatYear, type TimelineItem } from '../lib/timeline/data';
  import { laneColor } from '../lib/timeline/lanes';
  import { itemColor } from '../lib/timeline/layout';
  import type { Moment } from '../lib/timeline/query';
  import CloseX from './CloseX.svelte';

  export let moment: Moment;
  export let eraTitle: string | undefined = undefined;
  export let onSelect: (item: TimelineItem) => void;
  export let onClose: () => void;

  $: rows = [
    { label: 'Judah', items: moment.judah },
    { label: 'Israel', items: moment.israel },
    { label: 'Prophets', items: moment.prophets },
    { label: 'Power', items: moment.empires },
    { label: 'Rulers', items: moment.rulers },
    { label: 'Being written', items: moment.writing },
    { label: 'Alive', items: moment.alive },
    { label: 'Around then', items: moment.nearby },
  ].filter((r) => r.items.length);

  const colour = (it: TimelineItem) => (it.lane === 'events' ? itemColor(it) : laneColor(it));
</script>

<div class="moment">
  <div class="moment-top">
    <div class="moment-kind">At this moment{#if eraTitle}<span class="moment-era"> · {eraTitle}</span>{/if}</div>
    <CloseX edge on:click={onClose} />
  </div>
  <div class="moment-year">c. {formatYear(moment.year)}</div>
  {#if rows.length}
    <dl class="moment-rows">
      {#each rows as row (row.label)}
        <dt>{row.label}</dt>
        <dd>
          {#each row.items as it, i (it.id)}
            <button class="moment-link" style="color: {colour(it)}" on:click={() => onSelect(it)}>{it.title}</button>{#if i < row.items.length - 1}<span class="moment-sep">, </span>{/if}
          {/each}
        </dd>
      {/each}
    </dl>
  {:else}
    <p class="moment-quiet">Nothing on the strip falls in this year. Drag to move it.</p>
  {/if}
</div>

<style>
  .moment-top { display: flex; align-items: center; gap: 8px; }
  .moment-kind {
    flex: 1; min-width: 0;
    font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: #fbbf24;
  }
  .moment-era { color: var(--dim, #8a8a8a); }
  .moment-year { font-family: var(--display); font-size: 17px; line-height: 1.25; margin-top: 2px; }
  .moment-rows {
    display: grid; grid-template-columns: max-content 1fr; gap: 4px 10px;
    margin: 8px 0 0; font-size: 12.5px; line-height: 1.45;
  }
  dt { color: var(--faint, #5a5a5a); font-size: 11px; padding-top: 1px; }
  dd { margin: 0; color: var(--dim, #8a8a8a); }
  .moment-link {
    background: none; border: 0; padding: 0; cursor: pointer; font: inherit; text-align: left;
  }
  .moment-link:hover { text-decoration: underline; }
  .moment-link:focus-visible { outline: 2px solid var(--focus, #fb7185); outline-offset: 1px; }
  .moment-quiet { color: var(--faint, #5a5a5a); font-size: 12px; margin: 8px 0 0; }
</style>
