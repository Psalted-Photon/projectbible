<script lang="ts">
  /**
   * The card at the foot of the Timeline window: everything about one item and
   * everywhere it leads.
   *
   * Passages are the app's ordinary reference rows (VerseRefRow): the reference
   * in its book's colour over the opening words, the same as every verse list
   * in the app. Other items on the strip (the event this is part of, the events
   * inside it) are plain text links. People and places stay chips, which is the
   * app's rule for things that have no verse to preview: a chip leaves
   * Scripture for a bio or the map.
   */
  import VerseRefRow from './VerseRefRow.svelte';
  import { personModalStore } from '../stores/personModalStore';
  import { openMapWindow } from '../lib/openMapWindow';
  import { formatItemSpan, formatSpan, formatYear, type TimelineData, type TimelineItem, type TimelinePassage } from '../lib/timeline/data';
  import { itemColor } from '../lib/timeline/layout';
  import { laneColor, VERDICT_COLOR } from '../lib/timeline/lanes';
  import { neighbours } from '../lib/timeline/query';

  export let item: TimelineItem;
  export let data: TimelineData;
  /** The deepest event tier showing, so back and next step through what is on the strip. */
  export let tier: 1 | 2 | 3;
  export let onSelect: (item: TimelineItem) => void;
  export let onRead: (passage: TimelinePassage) => void;
  export let onClose: () => void;

  const PASSAGES_SHOWN = 6;
  const CHILDREN_SHOWN = 8;

  let allPassages = false;
  let allChildren = false;
  // A new item starts folded again.
  $: if (item) {
    allPassages = false;
    allChildren = false;
  }

  $: era = item.kind === 'era' ? undefined : data.byId.get(item.era_id ?? '');
  $: parent = item.parent_id ? data.byId.get(item.parent_id) : undefined;
  $: children =
    item.kind === 'era'
      ? data.events.filter((e) => e.era_id === item.id && (e.tier ?? 3) <= 2)
      : data.children.get(item.id) ?? [];
  $: near = neighbours(data, item, tier);

  $: color = item.lane === 'events' || item.lane === 'eras' ? itemColor(item.kind === 'era' ? item : era ?? item) : laneColor(item);
  $: kindLine =
    item.kind === 'era'
      ? 'Era'
      : item.kind === 'event'
        ? era?.title ?? 'Event'
        : item.subtitle ?? '';

  /** "29 years", for a reign, a prophet's ministry, a book's writing. */
  $: length = (() => {
    if (item.kind === 'event' || item.kind === 'era' || item.kind === 'life') return '';
    const n = item.year_end - item.year_start + (item.year_start < 0 && item.year_end > 0 ? -1 : 0);
    if (n < 1) return item.kind === 'reign' ? 'under a year' : '';
    return `${n} year${n === 1 ? '' : 's'}`;
  })();

  const VERDICT_TEXT: Record<string, string> = {
    right: 'Did what was right in the eyes of the LORD',
    evil: 'Did evil in the eyes of the LORD',
    mixed: 'Did right, but not with a whole heart',
  };

  /** "1 Chronicles 10:13-14" → the verse it opens at. */
  function parseRef(ref: string | undefined): TimelinePassage | null {
    const m = ref?.match(/^(.+?)\s+(\d+):(\d+)(?:-(\d+))?/);
    if (!m) return null;
    const c = +m[2];
    const v = +m[3];
    return { b: m[1], c, v, ec: c, ev: m[4] ? +m[4] : v, label: ref!.replace('-', '–') };
  }
  $: verdictPassage = parseRef(item.verdict_ref);

  /** Where the map should be set: an event's own year, the middle of anything longer. */
  $: mapYear = (() => {
    const y = item.kind === 'event' ? item.year_start : Math.round((item.year_start + item.year_end) / 2);
    return y === 0 ? -1 : y;
  })();
  $: markers = item.places.map((p) => ({ name: p.name, latitude: p.lat, longitude: p.lon }));

  function showOnMap() {
    openMapWindow(item.title, markers, { year: mapYear });
  }

  function showPlace(p: { name: string; lat: number; lon: number }) {
    openMapWindow(p.name, [{ name: p.name, latitude: p.lat, longitude: p.lon }], { year: mapYear });
  }

  function showPerson(p: { id: string; name: string }) {
    personModalStore.open({ personId: p.id, primaryName: p.name });
  }
</script>

<div class="card">
  <div class="card-top">
    <div class="card-kind" style="--c: {color}">{kindLine}</div>
    <div class="card-buttons">
      <button class="card-btn" aria-label="Back" title={near.prev ? near.prev.title : ''} disabled={!near.prev} on:click={() => near.prev && onSelect(near.prev)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <button class="card-btn" aria-label="Next" title={near.next ? near.next.title : ''} disabled={!near.next} on:click={() => near.next && onSelect(near.next)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
      <button class="card-btn card-close" aria-label="Close" on:click={onClose}>×</button>
    </div>
  </div>

  <div class="card-title">{item.title}</div>
  <div class="card-span">
    {formatItemSpan(item)}{#if length}<span class="card-dot">·</span>{length}{/if}
  </div>
  {#if item.co_start !== undefined}
    <div class="card-note">Co-regent from {formatYear(item.year_start)}, reigned alone from {formatYear(item.co_start)}</div>
  {/if}
  {#if item.kind === 'book' && item.covers_start !== undefined && item.covers_end !== undefined}
    <div class="card-note">Its events: {formatSpan(item.covers_start, item.covers_end, true)}</div>
  {/if}
  {#if parent}
    <div class="card-note">Part of <button class="card-link" on:click={() => onSelect(parent)}>{parent.title}</button></div>
  {/if}

  {#if item.summary}
    <p class="card-body">{item.summary}</p>
  {/if}

  {#if item.verdict}
    <div class="card-verdict" style="--v: {VERDICT_COLOR[item.verdict]}">{VERDICT_TEXT[item.verdict]}</div>
    {#if verdictPassage}
      {@const v = verdictPassage}
      <div class="card-refs">
        <VerseRefRow book={v.b} chapter={v.c} verse={v.v} label={v.label} onOpen={() => onRead(v)} />
      </div>
    {/if}
  {/if}

  {#if item.passages.length}
    <div class="card-h">{item.passages.length === 1 ? 'Passage' : 'Passages'}</div>
    <div class="card-refs">
      {#each allPassages ? item.passages : item.passages.slice(0, PASSAGES_SHOWN) as p (p.label)}
        <VerseRefRow book={p.b} chapter={p.c} verse={p.v} label={p.label} onOpen={() => onRead(p)} />
      {/each}
    </div>
    {#if item.passages.length > PASSAGES_SHOWN}
      <button class="card-more" on:click={() => (allPassages = !allPassages)}>
        {allPassages ? 'Show fewer' : `+${item.passages.length - PASSAGES_SHOWN} more`}
      </button>
    {/if}
  {:else if item.kind !== 'era'}
    <p class="card-quiet">No passage is tied to this one.</p>
  {/if}

  {#if children.length}
    <div class="card-h">{item.kind === 'era' ? 'In this era' : 'Inside it'}</div>
    <div class="card-list">
      {#each allChildren ? children : children.slice(0, CHILDREN_SHOWN) as child (child.id)}
        <button class="card-row" on:click={() => onSelect(child)}>
          <span class="card-row-name">{child.title}</span>
          <span class="card-row-year">{formatYear(child.year_start)}</span>
        </button>
      {/each}
    </div>
    {#if children.length > CHILDREN_SHOWN}
      <button class="card-more" on:click={() => (allChildren = !allChildren)}>
        {allChildren ? 'Show fewer' : `+${children.length - CHILDREN_SHOWN} more`}
      </button>
    {/if}
  {/if}

  {#if item.people.length}
    <div class="card-h">People</div>
    <div class="card-chips">
      {#each item.people as p (p.id)}
        <button class="chip" on:click={() => showPerson(p)}>{p.name}</button>
      {/each}
    </div>
  {/if}

  {#if item.places.length}
    <div class="card-h">Places</div>
    <div class="card-chips">
      {#each item.places as p (p.id)}
        <button class="chip chip-place" on:click={() => showPlace(p)}>{p.name}</button>
      {/each}
    </div>
  {/if}

  <button class="card-map" on:click={showOnMap}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/></svg>
    {markers.length ? 'Show on the map' : `The map in ${formatYear(mapYear)}`}
  </button>
</div>

<style>
  .card { position: relative; }
  .card-top { display: flex; align-items: center; gap: 8px; }
  .card-kind {
    flex: 1; min-width: 0;
    font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase;
    color: var(--c); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .card-buttons { display: flex; gap: 2px; flex: none; }
  .card-btn {
    width: 28px; height: 28px; border-radius: 6px; display: grid; place-items: center;
    background: transparent; border: 0; color: var(--dim, #8a8a8a); cursor: pointer;
    font-size: 19px; line-height: 1;
  }
  .card-btn svg { width: 16px; height: 16px; }
  .card-btn:hover:not(:disabled) { background: var(--chrome-2, #212121); color: var(--text, #e0e0e0); }
  .card-btn:disabled { opacity: .3; cursor: default; }

  .card-title { font-family: var(--display); font-size: 17px; line-height: 1.25; margin-top: 2px; }
  .card-span { color: var(--dim, #8a8a8a); font-size: 12px; margin-top: 2px; }
  .card-dot { margin: 0 6px; }
  .card-note { color: var(--dim, #8a8a8a); font-size: 12px; margin-top: 3px; }
  .card-body { color: #c2c6cd; font-size: 13px; line-height: 1.6; margin: 8px 0 0; }
  .card-quiet { color: var(--faint, #5a5a5a); font-size: 12px; margin: 10px 0 0; }

  .card-verdict {
    margin-top: 10px; font-size: 12.5px; font-weight: 600; color: var(--v);
  }

  .card-h {
    margin: 12px 0 5px;
    font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--faint, #5a5a5a);
  }
  .card-refs { display: flex; flex-direction: column; gap: 4px; }
  .card-verdict + .card-refs { margin-top: 5px; }

  /* Other items on the strip: plain links, coloured like the app's links. */
  .card-link {
    background: none; border: 0; padding: 0; cursor: pointer;
    color: var(--color-primary, #4a90e2); font: inherit; text-align: left;
  }
  .card-link:hover { text-decoration: underline; }
  .card-list { display: flex; flex-direction: column; }
  .card-row {
    display: flex; align-items: baseline; gap: 8px; width: 100%;
    background: none; border: 0; padding: 4px 0; cursor: pointer; text-align: left; font: inherit;
  }
  .card-row-name { flex: 1; min-width: 0; color: var(--color-primary, #4a90e2); font-size: 13px; }
  .card-row:hover .card-row-name { text-decoration: underline; }
  .card-row-year { color: var(--faint, #5a5a5a); font-size: 11px; flex: none; }

  .card-more {
    margin-top: 5px; background: none; border: 0; padding: 2px 0; cursor: pointer;
    color: var(--dim, #8a8a8a); font: inherit; font-size: 12px;
  }
  .card-more:hover { color: var(--text, #e0e0e0); }

  .card-chips { display: flex; flex-wrap: wrap; gap: 5px; }
  .chip {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    color: var(--color-primary, #4a90e2);
    font: inherit; font-size: 12px;
    padding: 3px 8px; cursor: pointer; white-space: nowrap;
  }
  .chip:hover { background: rgba(74, 144, 226, 0.15); border-color: var(--color-primary, #4a90e2); }
  .chip-place { color: #c98b7a; }
  .chip-place:hover { background: rgba(201, 139, 122, 0.15); border-color: #c98b7a; }

  .card-map {
    margin-top: 14px; padding: 7px 11px; border-radius: 6px; cursor: pointer;
    background: var(--chrome-2, #212121); border: 1px solid var(--line-2, #3a3a3a); color: var(--text, #e0e0e0);
    font: inherit; font-size: 13px; display: inline-flex; align-items: center; gap: 8px;
  }
  .card-map svg { width: 15px; height: 15px; }
  .card-map:hover { border-color: var(--focus, #fb7185); }
  .card-map:focus-visible, .chip:focus-visible, .card-row:focus-visible, .card-btn:focus-visible {
    outline: 2px solid var(--focus, #fb7185); outline-offset: 1px;
  }
</style>
