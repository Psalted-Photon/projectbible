<script lang="ts">
  import { get } from "svelte/store";
  import Gem from "./Gem.svelte";
  import NavesPointRefs, { navesRefKey } from "./library/NavesPointRefs.svelte";
  import { stoneForTribe } from "../lib/gems/stones";
  import { STONES } from "../lib/familyTree/config";
  import { TRIBE_READING, tribeSection, type TribePart } from "../lib/gems/tribes";
  import { getBookColor } from "../lib/bibleData.js";
  import { parseOsisRef } from "../lib/parseRefString";
  import { IndexedDBTextStore } from "../adapters/TextStore";
  import { navigationStore } from "../stores/navigationStore";
  import { isbeModalStore } from "../stores/isbeModalStore";
  import { getIsbeEntry, getNavesTopic, type NavesPoint, type NavesRef } from "../adapters/lexicon-lookup.js";

  /**
   * One tribe, in the family tree's sheet: its breastplate stone, a short
   * history from the ISBE and the verses Nave's gathers under it. Opened by
   * tapping the stone on a tribal bio. Everything here leaves the tree the
   * same way a verse in a bio does, through `onClose`.
   */
  export let tribe: string;
  /** Leaves the tree for the reader (or another card) — the sheet's verse exit. */
  export let onClose: () => void;

  $: stone = stoneForTribe(tribe);
  /** The tree's brightened shade, so onyx's near-black still reads. */
  $: stoneColour = STONES[tribe]?.lit ?? stone?.sw;

  type LoadedPart = {
    part: TribePart;
    /** The chosen paragraphs, as the article's own HTML, links tinted. */
    history: string[];
    points: NavesPoint[];
  };

  let parts: LoadedPart[] = [];
  let loading = true;
  let loadedFor = "";

  $: if (tribe !== loadedFor) load(tribe);

  async function load(t: string) {
    loadedFor = t;
    loading = true;
    parts = [];
    expanded = {};
    const found = await Promise.all(
      (TRIBE_READING[t] ?? []).map(async (part) => {
        const [entry, topic] = await Promise.all([
          getIsbeEntry(part.isbe.entryId).catch(() => null),
          getNavesTopic(part.naves.topicId).catch(() => null),
        ]);
        return {
          part,
          history: entry ? pickParagraphs(entry.bodyHtml, part.isbe.paras) : [],
          points: topic ? (part.naves.section ? sectionPoints(topic.points) : topic.points) : [],
        };
      }),
    );
    // A slower load for a tribe you've already left behind is dropped.
    if (loadedFor !== t) return;
    parts = found;
    loading = false;
  }

  /**
   * The tribe's own section, less its heading's wording: "2. Tribe of" says
   * nothing on a card already titled with the tribe. Whatever follows a colon
   * ("2. Tribe of: Census of, by families") is a real point and stays, and
   * the heading's own references stay either way.
   */
  function sectionPoints(points: NavesPoint[]): NavesPoint[] {
    const [head, ...rest] = tribeSection(points);
    if (!head) return [];
    const after = head.text.includes(":") ? head.text.slice(head.text.indexOf(":") + 1).trim() : "";
    return [{ ...head, text: after }, ...rest];
  }

  $: nothingInstalled = !loading && parts.every((p) => !p.history.length && !p.points.length);

  /** The article's paragraphs by position, scripture links tinted by book. */
  function pickParagraphs(html: string, which: number[]): string[] {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const ps = [...doc.body.querySelectorAll("p")];
    return which
      .map((i) => ps[i])
      .filter((p): p is HTMLParagraphElement => !!p)
      .map((p) => {
        p.querySelectorAll<HTMLAnchorElement>("a[data-osis]").forEach((a) => {
          const target = parseOsisRef(a.getAttribute("data-osis") ?? "");
          if (target) a.style.color = getBookColor(target.book);
        });
        return p.innerHTML;
      });
  }

  // --- Leaving for the reader -------------------------------------------
  function navigateToVerse(book: string, chapter: number, verse: number) {
    const current = get(navigationStore);
    // The back arrow walks the reader back to where it was. The tribe card
    // itself isn't a saved surface, so it doesn't reopen with it.
    navigationStore.pushHistory(current, "library");
    navigationStore.navigateToVerse(current.translation, book, chapter, verse);
    onClose();
  }

  /** A scripture reference. Ranges land on their first verse. */
  function openRef(osis: string) {
    const target = parseOsisRef(osis);
    if (!target) return;
    navigateToVerse(target.book, target.chapter, target.verse ?? 1);
  }

  function onHistoryClick(e: MouseEvent) {
    const a = (e.target as HTMLElement).closest("a[data-osis]");
    if (!a) return;
    e.preventDefault();
    openRef(a.getAttribute("data-osis") ?? "");
  }

  function readArticle(part: TribePart) {
    // The encyclopedia card sits under the tree, so the tree goes first.
    onClose();
    isbeModalStore.openEntry(part.isbe.entryId, part.isbe.name);
  }

  function readBreastplate() {
    navigateToVerse("Exodus", 28, 17);
  }

  // --- Verse lists ------------------------------------------------------
  let expanded: Record<string, boolean> = {};
  let versePreviews: Record<string, string> = {};
  const verseTextStore = new IndexedDBTextStore();

  async function toggleRefs(key: string, refs: NavesRef[]) {
    const opening = !expanded[key];
    expanded = { ...expanded, [key]: opening };
    if (!opening) return;
    const translation = get(navigationStore).translation;
    const wanted = new Map<string, { book: string; chapter: number; verse: number }>();
    for (const r of refs) {
      const k = navesRefKey(r.osis);
      const t = parseOsisRef(r.osis);
      if (!k || !t || versePreviews[k] !== undefined) continue;
      wanted.set(k, { book: t.book, chapter: t.chapter, verse: t.verse ?? 1 });
    }
    if (!wanted.size) return;
    const loaded = await Promise.all(
      [...wanted].map(async ([k, t]) => {
        const text = (await verseTextStore.getVerse(translation, t.book, t.chapter, t.verse)) ?? "";
        return [k, text] as const;
      }),
    );
    versePreviews = { ...versePreviews, ...Object.fromEntries(loaded) };
  }

  /** Nave's own numbering ("2. Tribe of") reads oddly out of its topic. */
  function pointText(text: string): string {
    return text.replace(/^\d+\.\s*/, "");
  }
</script>

<div class="tribe-content">
  {#if stone}
    <div class="stone">
      <Gem {tribe} size={112} stage={false} />
      <div class="stone-text">
        <div class="stone-name">
          <span class="stone-kjv" style="color:{stoneColour}">{stone.kjv}</span>
          <span class="stone-heb" lang="he">{stone.heb}</span>
        </div>
        <div class="stone-tr">{stone.tr}</div>
        <div class="stone-as">Drawn as {stone.as}.</div>
        <button class="stone-ref" on:click={readBreastplate}>
          The high priest's breastplate, Exodus 28:17–20
        </button>
      </div>
    </div>
  {/if}

  {#if loading}
    <p class="muted">Loading…</p>
  {:else if nothingInstalled}
    <p class="muted">This tribe's history and verses come from the encyclopedia and Nave's packs. Install them from Packs to read them here.</p>
  {:else}
    {#each parts as p, pi}
      {#if p.part.label}
        <h3 class="part-label">{p.part.label}</h3>
      {/if}

      {#if p.history.length}
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
        <div class="history" on:click={onHistoryClick}>
          {#each p.history as para}
            <p>{@html para}</p>
          {/each}
        </div>
        <button class="read-more" on:click={() => readArticle(p.part)}>
          Read the full article on {p.part.isbe.name}
        </button>
      {/if}

      {#if p.points.length}
        <h4 class="verses-head">In Scripture</h4>
        <div class="points">
          {#each p.points as point, i}
            {#if point.text || point.refs.length}
              <div class="point" class:sub={point.depth > 0}>
                {#if point.text}<div class="point-text">{pointText(point.text)}</div>{/if}
                <NavesPointRefs
                  refs={point.refs}
                  links={[]}
                  open={!!expanded[`${pi}.${i}`]}
                  previews={versePreviews}
                  onToggle={() => toggleRefs(`${pi}.${i}`, point.refs)}
                  onRef={openRef}
                  onLink={() => {}}
                />
              </div>
            {/if}
          {/each}
        </div>
      {/if}
    {/each}
    <p class="attrib">History from the International Standard Bible Encyclopedia (1915); verses from Nave's Topical Bible.</p>
  {/if}
</div>

<style>
  .tribe-content {
    padding: 4px 2px 16px;
  }

  .stone {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 16px;
  }
  .stone-text {
    min-width: 0;
  }
  .stone-name {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
  }
  .stone-kjv {
    font-family: Milonga, serif;
    font-size: 19px;
  }
  .stone-heb {
    font-size: 18px;
    color: var(--text-color, #e8e8e8);
  }
  .stone-tr {
    font-size: 13px;
    color: var(--text-muted, #999);
    font-style: italic;
  }
  .stone-as {
    font-size: 13px;
    color: var(--text-muted, #aaa);
    margin-top: 4px;
    line-height: 1.45;
  }
  .stone-ref {
    background: none;
    border: none;
    padding: 0;
    margin-top: 6px;
    color: var(--color-primary, #4a90e2);
    font: inherit;
    font-size: 12.5px;
    text-align: left;
    cursor: pointer;
  }

  .part-label {
    font-family: Milonga, serif;
    font-size: 17px;
    font-weight: normal;
    margin: 18px 0 6px;
    color: var(--text-color, #fff);
  }

  .history {
    font-size: 14.5px;
    line-height: 1.6;
    color: var(--text-color, #e8e8e8);
  }
  .history p {
    margin: 0 0 10px;
  }
  .history :global(a[data-osis]) {
    color: #8a8f98;
    cursor: pointer;
    text-decoration: none;
    border-bottom: 1px dotted currentColor;
  }
  .read-more {
    background: none;
    border: 1px solid var(--border-color, #444);
    border-radius: 14px;
    color: var(--text-muted, #aaa);
    font: inherit;
    font-size: 12.5px;
    padding: 5px 12px;
    cursor: pointer;
    margin-bottom: 6px;
  }
  .read-more:hover {
    color: var(--text-color, #fff);
    border-color: var(--color-primary, #4a90e2);
  }

  .verses-head {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-muted, #999);
    margin: 18px 0 4px;
  }
  .point {
    border-top: 1px solid rgba(255, 255, 255, 0.07);
    padding: 9px 2px;
  }
  .point.sub {
    border-top: none;
    padding: 5px 2px 5px 12px;
  }
  .point-text {
    font-size: 13.5px;
    line-height: 1.5;
    color: var(--text-color, #e8e8e8);
  }

  .muted {
    color: var(--text-muted, #999);
    font-size: 14px;
  }
  .attrib {
    margin-top: 18px;
    font-size: 11px;
    color: var(--text-muted, #777);
  }
</style>
