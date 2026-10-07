<script lang="ts">
  import { get } from "svelte/store";
  import { getBookColor } from "../../lib/bibleData.js";
  import StrongsVerseList from "../StrongsVerseList.svelte";
  import {
    loadStrongsUsage,
    buildVerseUses,
    buildFormGroups,
    sourcesByTestament,
    summarizeArc,
    buildDistribution,
    refKey,
    type StrongsUsage,
    type VerseUse,
  } from "../../lib/strongsUsage";
  import { navigationStore } from "../../stores/navigationStore";
  import { parseOsisRef } from "../../lib/parseRefString";
  import { expandRmacCode, expandOshbCode, expandStepBiblePOS } from "../../lib/morphologyExpander";
  import { languageColor, isRtl, type StrongsEntryData, type EntryTab } from "../../lib/strongs/entry";
  import { reveal } from "../../lib/motion";

  /**
   * One Strong's entry: the definition, and how the word is used across the
   * installed original texts. Lived inside the Dictionary card until Strong's
   * became its own work; the frame around it (tabs, header, pin, close) is
   * StrongsContent's.
   */
  export let entry: StrongsEntryData;
  export let activeTab: EntryTab = "definition";
  /** A verse followed out of the entry — the frame decides what happens to the card. */
  export let onVerse: (target: { book: string; chapter: number; verse: number }) => void;
  /** Another entry asked for from this one: a related word. */
  export let onOpenEntry: (id: string) => void;
  /** Reports a tab change, so a window can keep it. */
  export let onTab: ((tab: EntryTab) => void) | null = null;

  function selectTab(tab: EntryTab) {
    activeTab = tab;
    onTab?.(tab);
  }

  // --- Usage: the Forms, Occurrences, Arc and Spread tabs -----------------
  // All four answer questions about the same set of tagged words, so they
  // share one scan of the morphology store rather than running one apiece.
  let usage: StrongsUsage | null = null;
  let usageLoading = false;
  let usageLoadedFor = "";
  /** Which edition is being studied. Null means all of them at once. */
  let source: string | null = null;
  /** Refs already followed, dimmed on return. Shared by both lists, since they
   *  are two views of the same verses. */
  let visitedRefs = new Set<string>();
  /** Which inflected form is open. One at a time: the table is the index you
   *  scan, and several open at once buries it. */
  let openForm: string | null = null;

  $: verseUses = usage ? buildVerseUses(usage, source) : [];
  $: formGroups = usage ? buildFormGroups(usage, source) : [];
  $: variantBaseline = usage ? sourcesByTestament(usage) : { OT: [], NT: [] };
  /**
   * A badge says the editions disagree about a verse, which is only a question
   * worth asking when you are looking at all of them. Studying one edition,
   * every row would trivially be "only in" that edition and the badge would
   * become wallpaper.
   */
  $: activeBaseline = source === null ? variantBaseline : { OT: [], NT: [] };
  $: arc = summarizeArc(verseUses);
  $: distribution = buildDistribution(verseUses);
  /** The picker only earns its row when there is a choice to make. A Hebrew
   *  entry only ever appears in one text. */
  $: showSourcePicker = (usage?.sources.length ?? 0) > 1;
  $: rtl = isRtl(entry.language);

  /** Words sharing this one's sense, grouped in two tiers. Greek only: the
   *  domain tagging comes from the Greek NT, so a Hebrew entry has none. */
  $: related = entry.related;

  // A different word, whether by a related link or the host swapping it:
  // the previous word's verses must not stay up under the new heading while
  // the fresh scan runs.
  let usageEntry = "";
  $: if (entry.id !== usageEntry) {
    usageEntry = entry.id;
    resetUsage();
  }

  function resetUsage() {
    usage = null;
    usageLoadedFor = "";
    source = null;
    visitedRefs = new Set();
    openForm = null;
  }

  /**
   * Every tagged word carrying this number, in one pass.
   *
   * All four tabs read from the result, and the source picker filters it in
   * memory, so switching editions or tabs never goes back to the database.
   */
  async function loadUsage(id: string) {
    if (usageLoadedFor === id || usageLoading) return;
    usageLoading = true;
    let found: StrongsUsage;
    try {
      found = await loadStrongsUsage(id);
    } catch (err) {
      console.error("Failed to load Strong's usage:", err);
      found = { rows: [], sources: [] };
    }
    usageLoading = false;
    if (entry.id === id) {
      usage = found;
      usageLoadedFor = id;
      source = defaultSource(found.sources);
    } else if (needsUsage) {
      // A slower scan must not land on a word opened since — and that word
      // still needs its own, which waited on this one.
      loadUsage(entry.id);
    }
  }

  $: needsUsage =
    activeTab === "forms" || activeTab === "occurrences" || activeTab === "arc" || activeTab === "spread";
  $: if (needsUsage && usageEntry) loadUsage(usageEntry);

  /** Open on the text you are already reading when that is one of the originals,
   *  so the study agrees with the passage beside it. */
  function defaultSource(sources: string[]): string | null {
    if (sources.length < 2) return null;
    const reading = get(navigationStore).translation?.toLowerCase();
    const match = sources.find((s) => s.toLowerCase() === reading);
    return match ?? null;
  }

  function handleVerseClick(use: VerseUse) {
    visitedRefs = new Set(visitedRefs).add(refKey(use));
    onVerse({ book: use.book, chapter: use.chapter, verse: use.verse });
  }

  /** Parsing in words. Hebrew and Aramaic are coded differently from Greek. */
  function parseOf(morphCode: string): string {
    return rtl ? expandOshbCode(morphCode) : expandRmacCode(morphCode);
  }

  function toggleForm(key: string) {
    openForm = openForm === key ? null : key;
  }

  /**
   * Convert SWORD/Thayer markup to safe HTML for {@html} rendering.
   * Handles: <b>, <i>, <BR />, <ref='...'>, __ numbered items.
   * Any other tags are stripped.
   */
  function renderStrongsMarkup(text: string): string {
    if (!text) return "";
    return text
      // Bold and italic pass-through
      .replace(/<b>([\s\S]*?)<\/b>/gi, "<strong>$1</strong>")
      .replace(/<i>([\s\S]*?)<\/i>/gi, "<em>$1</em>")
      // Line breaks (various SWORD spellings)
      .replace(/<BR\s*\/>/gi, "<br>")
      // Scripture refs → clickable buttons
      .replace(
        /<ref='([^']+)'>([\s\S]*?)<\/ref>/gi,
        '<button class="scripture-ref" data-ref="$1">$2</button>',
      )
      // Numbered items: __ at start of a segment → indented block
      .replace(/(^|\n|<br>)__(\d+\.)/g, '$1<span class="strongs-item">$2</span> ')
      // Strip any remaining unknown tags
      .replace(/<(?!\/?(strong|em|br|button|span)[^>]*>)[^>]+>/gi, "");
  }

  /**
   * Strong's KJV usage is one long comma-separated string carrying its own
   * notation, which reads as noise until it is broken apart:
   *   X    the KJV supplied this word with nothing behind it in the Greek
   *   +    the word is only ever rendered in combination with another
   *   ( )  alternative endings, or optional words — "alway(-s)"
   * Commas inside brackets belong to a rendering rather than separating two,
   * so "all (manner of, means)" must not split into three.
   */
  type Rendering = { text: string; marker: "supplied" | "combined" | null };

  function parseKjvUsage(usage: string): Rendering[] {
    const parts: string[] = [];
    let depth = 0;
    let buf = "";
    for (const ch of usage) {
      if (ch === "(" || ch === "[") depth++;
      else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
      if (ch === "," && depth === 0) {
        parts.push(buf);
        buf = "";
        continue;
      }
      buf += ch;
    }
    parts.push(buf);

    const out: Rendering[] = [];
    for (const raw of parts) {
      // Strong's sometimes closes a list with a prose aside riding on the last
      // rendering — "principal. Compare names in 'Abi-'." Cut at the sentence
      // boundary so the aside does not become a rendering.
      let t = raw.replace(/\s+/g, " ").trim().split(/\.\s+(?=[A-Z])/)[0];
      t = t.replace(/\.$/, "").trim();
      if (!t || /^compare\b/i.test(t)) continue;
      let marker: Rendering["marker"] = null;
      if (/^X\s+/.test(t)) {
        marker = "supplied";
        t = t.replace(/^X\s+/, "");
      } else if (/^\+\s*/.test(t)) {
        marker = "combined";
        t = t.replace(/^\+\s*/, "");
      }
      if (t) out.push({ text: t, marker });
    }
    return out;
  }

  $: kjvRenderings = entry.kjvUsage ? parseKjvUsage(entry.kjvUsage) : [];
  $: kjvHasMarkers = kjvRenderings.some((r) => r.marker);

  /** Handle clicks on rendered Strong's markup — catches scripture-ref buttons. */
  function handleDefinitionClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.classList.contains("scripture-ref")) return;
    const osisRef = target.dataset.ref;
    if (!osisRef) return;
    const parsed = parseOsisRef(osisRef);
    if (!parsed) return;
    onVerse({ book: parsed.book, chapter: parsed.chapter, verse: parsed.verse ?? 1 });
  }

  const TABS: { key: EntryTab; label: string }[] = [
    { key: "definition", label: "Definition" },
    { key: "forms", label: "Forms" },
    { key: "occurrences", label: "Occurrences" },
    { key: "arc", label: "Arc" },
    { key: "spread", label: "Spread" },
    { key: "related", label: "Related" },
  ];
</script>

<div class="tabs">
  {#each TABS as t (t.key)}
    <button class="tab" class:active={activeTab === t.key} on:click={() => selectTab(t.key)}>
      {t.label}
    </button>
  {/each}
</div>

<div class="tab-content">
  <!-- Which text is being studied. Sits above the pane rather than inside
       each tab, so switching between Forms and Occurrences keeps the
       control in one place and the choice applies to both. -->
  {#if showSourcePicker && activeTab !== "definition" && activeTab !== "related"}
    <div class="source-picker" role="group" aria-label="Source text">
      {#each usage?.sources ?? [] as s (s)}
        <button class="src" class:active={source === s} on:click={() => (source = s)}>
          {s.toUpperCase()}
        </button>
      {/each}
      <button class="src" class:active={source === null} on:click={() => (source = null)}>
        All
      </button>
    </div>
  {/if}
  {#if activeTab === "definition"}
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div class="definition-view" on:click={handleDefinitionClick}>
      <div class="info-section">
        <h3>Entry Information</h3>
        <dl>
          <dt>Strong's ID:</dt>
          <dd style="color: {languageColor(entry.language)}">
            {entry.id}
          </dd>

          <dt>Lemma:</dt>
          <dd class="lemma-text" dir={rtl ? "rtl" : "ltr"}>{entry.lemma}</dd>

          {#if entry.transliteration}
            <dt>Transliteration:</dt>
            <dd>{entry.transliteration}</dd>
          {/if}

          {#if entry.pronunciation?.phonetic}
            <dt>Pronunciation:</dt>
            <dd class="phonetic">{entry.pronunciation.phonetic}</dd>
          {/if}

          <dt>Language:</dt>
          <dd style="color: {languageColor(entry.language)}; text-transform: capitalize;">
            {entry.language}
          </dd>

          {#if entry.partOfSpeech}
            <dt>Part of Speech:</dt>
            <dd>
              {expandStepBiblePOS(entry.partOfSpeech)}
              <span class="code-raw">({entry.partOfSpeech})</span>
            </dd>
          {/if}

          <!-- No occurrence count here: the lexicon lookup never fills
               `occurrences`, so this row only ever rendered as nothing.
               The Occurrences tab counts the real verses instead. -->
        </dl>
      </div>

      {#if entry.shortDefinition}
        <div class="info-section">
          <h3>Short Definition</h3>
          <p class="short-def">{entry.shortDefinition}</p>
        </div>
      {/if}

      <div class="info-section">
        <h3>Full Definition</h3>
        <p class="full-def">{@html renderStrongsMarkup(entry.definition)}</p>
      </div>

      {#if kjvRenderings.length}
        <div class="info-section">
          <h3>KJV Renderings</h3>
          <div class="renderings">
            {#each kjvRenderings as r (r.text + (r.marker ?? ""))}
              <span class="rendering" class:marked={r.marker}>
                {#if r.marker === "supplied"}<span class="rend-mark" title="Supplied by the KJV translators — nothing stands behind it in the Greek">✛</span>{/if}
                {#if r.marker === "combined"}<span class="rend-mark" title="Rendered only in combination with another word">+</span>{/if}
                {r.text}
              </span>
            {/each}
          </div>
          {#if kjvHasMarkers}
            <p class="rend-legend">
              <span class="rend-mark">✛</span> supplied by the translators
              &nbsp;·&nbsp;
              <span class="rend-mark">+</span> only in combination
            </p>
          {/if}
        </div>
      {/if}

      {#if entry.derivation}
        <div class="info-section">
          <h3>Derivation</h3>
          <p class="derivation">{@html renderStrongsMarkup(entry.derivation)}</p>
        </div>
      {/if}
    </div>
  {:else if activeTab === "forms"}
    <div class="usage-view">
      {#if usageLoading}
        <p class="hint">Loading forms…</p>
      {:else if formGroups.length === 0}
        <p class="coming-soon">No tagged forms found in the installed texts.</p>
      {:else}
        <p class="usage-count">
          {formGroups.length} form{formGroups.length === 1 ? "" : "s"}
        </p>
        <div class="forms">
          {#each formGroups as f (f.key)}
            <div class="form-group">
              <button class="form-row" on:click={() => toggleForm(f.key)}>
                <span class="form-caret motion-caret" class:open={openForm === f.key}>▶</span>
                <span class="form-text" dir={rtl ? "rtl" : "ltr"}>{f.form}</span>
                <span class="form-parse">{parseOf(f.morphCode)}</span>
                <span class="form-count">{f.count}</span>
              </button>
              {#if openForm === f.key}
                <div class="form-verses" in:reveal>
                  <StrongsVerseList
                    uses={f.uses}
                    {rtl}
                    variantBaseline={activeBaseline}
                    visited={visitedRefs}
                    onNavigate={handleVerseClick}
                  />
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {:else if activeTab === "occurrences"}
    <div class="usage-view">
      {#if usageLoading}
        <p class="hint">Loading occurrences…</p>
      {:else if verseUses.length === 0}
        <p class="coming-soon">No occurrences found in the installed texts.</p>
      {:else}
        <p class="usage-count">
          {verseUses.length} verse{verseUses.length === 1 ? "" : "s"}
        </p>
        <StrongsVerseList
          uses={verseUses}
          {rtl}
          variantBaseline={activeBaseline}
          visited={visitedRefs}
          onNavigate={handleVerseClick}
        />
      {/if}
    </div>
  {:else if activeTab === "arc"}
    <div class="usage-view">
      {#if usageLoading}
        <p class="hint show-late">Loading…</p>
      {:else if arc.first && arc.last}
        <!-- Bound once here so the click handlers close over a verse that
             is known to exist, rather than re-reading a nullable field
             whenever they happen to fire. -->
        {@const first = arc.first}
        {@const last = arc.last}
        {#if arc.hapax}
          <p class="hapax">
            <strong>Hapax legomenon</strong> — used once in the whole of the
            text installed. Everything this word means rests on one verse.
          </p>
        {/if}
        <dl class="arc">
          <dt>Reach</dt>
          <dd>
            {arc.total} verse{arc.total === 1 ? "" : "s"} across
            {arc.books} book{arc.books === 1 ? "" : "s"}
          </dd>
          <dt>First</dt>
          <dd>
            <button class="arc-ref" on:click={() => handleVerseClick(first)}>
              {refKey(first)}
            </button>
          </dd>
          <dt>Last</dt>
          <dd>
            <button class="arc-ref" on:click={() => handleVerseClick(last)}>
              {refKey(last)}
            </button>
          </dd>
          {#if arc.busiest}
            <dt>Densest</dt>
            <dd>
              <span style="color:{getBookColor(arc.busiest.book)}">{arc.busiest.book}</span>
              <span class="arc-dim">({arc.busiest.count})</span>
            </dd>
          {/if}
        </dl>
        <!-- Only when a word actually reaches both. How the Septuagint uses
             a word against how the New Testament does is the comparison
             that makes a Greek word study worth doing. -->
        {#each arc.spans as span (span.testament)}
          <div class="arc-span">
            <h3>{span.label}</h3>
            <dl class="arc">
              <dt>Reach</dt>
              <dd>
                {span.total} verse{span.total === 1 ? "" : "s"} across
                {span.books} book{span.books === 1 ? "" : "s"}
              </dd>
              <dt>First</dt>
              <dd>
                <button class="arc-ref" on:click={() => handleVerseClick(span.first)}>
                  {refKey(span.first)}
                </button>
              </dd>
              <dt>Last</dt>
              <dd>
                <button class="arc-ref" on:click={() => handleVerseClick(span.last)}>
                  {refKey(span.last)}
                </button>
              </dd>
            </dl>
          </div>
        {/each}
      {:else}
        <p class="coming-soon">No occurrences found in the installed texts.</p>
      {/if}
    </div>
  {:else if activeTab === "spread"}
    <div class="usage-view">
      {#if usageLoading}
        <p class="hint show-late">Loading…</p>
      {:else if distribution.total === 0}
        <p class="coming-soon">No occurrences found in the installed texts.</p>
      {:else}
        <p class="usage-count">
          {distribution.total} verse{distribution.total === 1 ? "" : "s"}, by book
        </p>
        {#each distribution.corpora as corpus (corpus.testament)}
          <div class="spread-corpus">
            {#if distribution.corpora.length > 1}
              <h3 class="spread-corpus-name">
                {corpus.label}
                <span class="arc-dim">{corpus.total}</span>
              </h3>
            {/if}
            {#each corpus.categories as cat (cat.category)}
              <p class="spread-cat">{cat.label}</p>
              {#each cat.books as b (b.book)}
                <div class="bar-row" title="{b.book}: {b.count} verses">
                  <span class="bar-label">{b.book}</span>
                  <span class="bar-track">
                    <!-- Every bar measured against the busiest single book,
                         so one scale serves the whole chart. -->
                    <span
                      class="bar-fill"
                      style="width:{Math.max(2, (b.count / distribution.max) * 100)}%; background:{b.color}"
                    ></span>
                  </span>
                  <span class="bar-value">{b.count}</span>
                </div>
              {/each}
            {/each}
          </div>
        {/each}
      {/if}
    </div>
  {:else if activeTab === "related"}
    <div class="usage-view">
      {#if related?.sense?.length || related?.area?.length}
        <p class="usage-count">Words grouped by sense, not by spelling</p>
        {#if related.sense.length}
          <div class="rel-group">
            <h3>The same sense</h3>
            <div class="rel-words">
              {#each related.sense as w (w.id)}
                <button class="rel-word" on:click={() => onOpenEntry(w.id)}>
                  <span class="rel-lemma">{w.lemma}</span>
                  <span class="rel-gloss">{w.gloss}</span>
                </button>
              {/each}
            </div>
          </div>
        {/if}
        {#if related.area.length}
          <div class="rel-group">
            <h3>Nearby in meaning</h3>
            <div class="rel-words">
              {#each related.area as w (w.id)}
                <button class="rel-word" on:click={() => onOpenEntry(w.id)}>
                  <span class="rel-lemma">{w.lemma}</span>
                  <span class="rel-gloss">{w.gloss}</span>
                </button>
              {/each}
            </div>
          </div>
        {/if}
      {:else if rtl}
        <p class="coming-soon">Sense grouping covers Greek only.</p>
        <p class="hint">
          The tagging behind it comes from the Greek New Testament, so
          Hebrew and Aramaic entries have none yet.
        </p>
      {:else}
        <p class="coming-soon">No words share this one's sense.</p>
        <p class="hint">
          Only words tagged in the Greek New Testament can be grouped, so
          a word that never occurs there has nothing to sit beside.
        </p>
      {/if}
    </div>
  {/if}
</div>

<style>
  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .hint {
    font-size: 14px;
    color: #888;
    margin-top: 8px;
  }

  /* Mirrors the Encyclopedia/Topical tab strip. Those wrap rather than scroll
     when narrow, which keeps every tab reachable on a phone. */
  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: calc(2px * var(--bar-scale, 1));
    border-bottom: 1px solid var(--border-color, #333);
    margin-bottom: 14px;
    flex-shrink: 0;
  }

  .tab {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-muted, #999);
    padding: calc(8px * var(--bar-scale, 1)) calc(12px * var(--bar-scale, 1));
    cursor: pointer;
    font-size: calc(13px * var(--bar-scale, 1));
    font-family: inherit;
    white-space: nowrap;
  }

  .tab:hover {
    color: var(--text-color, #fff);
  }

  .tab.active {
    color: var(--color-primary, #4a90e2);
    border-bottom-color: var(--color-primary, #4a90e2);
  }

  .tab-content {
    animation: fadeIn 0.2s ease-out;
  }

  .definition-view {
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .info-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .info-section h3 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: #4caf50;
    border-bottom: 1px solid rgba(76, 175, 80, 0.2);
    padding-bottom: 8px;
  }

  .info-section dl {
    display: grid;
    grid-template-columns: 160px 1fr;
    gap: 12px 16px;
    margin: 0;
  }

  .info-section dt {
    font-weight: 500;
    color: #888;
  }

  .info-section dd {
    margin: 0;
    color: var(--text-color, #fff);
  }

  .code-raw {
    font-size: 0.8em;
    color: var(--text-muted, #888);
    margin-left: 0.3em;
    font-family: monospace;
    opacity: 0.7;
  }

  .lemma-text {
    font-size: 20px;
    font-weight: 600;
  }

  .lemma-text[dir="rtl"] {
    text-align: left;
  }

  .short-def {
    font-size: 16px;
    line-height: 1.6;
    color: var(--text-color, #fff);
    margin: 0;
    padding: 16px;
    background: rgba(76, 175, 80, 0.1);
    border-left: 4px solid #4caf50;
    border-radius: 4px;
  }

  .full-def,
  .derivation {
    font-size: 15px;
    line-height: 1.8;
    color: #ccc;
    margin: 0;
  }

  /* Scripture reference links rendered inside Strong's definitions */
  :global(.scripture-ref) {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    font-size: inherit;
    line-height: inherit;
    color: var(--color-primary, #4a90e2);
    text-decoration: underline;
    cursor: pointer;
    display: inline;
  }

  :global(.scripture-ref:hover) {
    opacity: 0.8;
  }

  /* Indented numbered items: __1. __2. */
  :global(.strongs-item) {
    display: inline-block;
    font-weight: 600;
    margin-right: 2px;
  }

  .usage-view {
    display: flex;
    flex-direction: column;
    padding: 20px;
    gap: 12px;
  }

  .usage-count {
    font-size: 13px;
    color: var(--text-muted, #888);
    margin: 0;
  }

  /* --- Source picker ------------------------------------------------------
     Which of the installed original texts the counts and lists describe. Shown
     only when more than one has this word, so a Hebrew study never grows a
     one-button row. */
  .source-picker {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 12px 20px 0;
  }

  .src {
    background: none;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 4px;
    color: var(--text-muted, #9aa0aa);
    cursor: pointer;
    font-family: inherit;
    font-size: 11.5px;
    letter-spacing: 0.03em;
    padding: 3px 9px;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }

  .src:hover {
    background: rgba(255, 255, 255, 0.06);
    color: var(--text-color, #dfe2e8);
  }

  .src.active {
    background: color-mix(in srgb, var(--color-primary, #4a90e2) 18%, transparent);
    border-color: var(--color-primary, #4a90e2);
    color: var(--color-primary, #4a90e2);
  }

  .phonetic {
    font-family: monospace;
    font-size: 0.95em;
    color: var(--text-muted, #aaa);
    letter-spacing: 0.03em;
  }

  /* --- Forms tab ----------------------------------------------------------
     A row per inflected form, opening onto the verses that use it. Was a table;
     it became rows because a table cell is a poor place to hang a verse list. */
  .forms {
    display: flex;
    flex-direction: column;
  }

  .form-group {
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  }

  .form-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    background: none;
    border: none;
    color: var(--text-color, #dfe2e8);
    cursor: pointer;
    font-family: inherit;
    padding: 7px 4px;
    text-align: left;
  }

  .form-row:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  .form-caret {
    font-size: 10px;
    color: var(--text-muted, #9aa0aa);
  }

  .form-text {
    font-family: "Gentium Plus", "SBL Greek", "SBL Hebrew", serif;
    font-size: 15px;
  }

  .form-parse {
    flex: 1;
    color: var(--text-secondary, #ccc);
    font-size: 12px;
  }

  /* Verses, not raw hits — so it agrees with the list it opens onto. */
  .form-count {
    color: var(--text-muted, #888);
    font-variant-numeric: tabular-nums;
    font-size: 12px;
    white-space: nowrap;
  }

  .form-verses {
    padding: 0 0 8px 20px;
  }

  /* --- Related by sense ---------------------------------------------------
     Grouped by Louw-Nida semantic domain, so these are words that mean
     something similar rather than words that look similar. The domain numbers
     stay internal: Louw-Nida's category names are UBS's, so each group is
     described by its own members instead. */
  .rel-group + .rel-group {
    margin-top: 4px;
  }

  .rel-group h3 {
    margin: 0 0 8px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--text-muted, #9aa0aa);
  }

  .rel-words {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }

  .rel-word {
    display: flex;
    align-items: baseline;
    gap: 6px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 5px;
    cursor: pointer;
    font-family: inherit;
    padding: 5px 9px;
    text-align: left;
  }

  .rel-word:hover {
    background: rgba(255, 255, 255, 0.09);
    border-color: color-mix(in srgb, var(--color-primary, #4a90e2) 45%, transparent);
  }

  .rel-lemma {
    font-family: "Gentium Plus", "SBL Greek", serif;
    font-size: 14.5px;
    color: var(--text-color, #dfe2e8);
  }

  .rel-gloss {
    font-size: 11.5px;
    color: var(--text-muted, #9aa0aa);
  }

  /* --- KJV renderings -----------------------------------------------------
     One comma-separated string in the source; chips here, because the point is
     to see the spread of senses the translators reached for at a glance. */
  .renderings {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }

  .rendering {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    color: var(--text-color, #dfe2e8);
    font-size: 12.5px;
    padding: 3px 8px;
  }

  .rendering.marked {
    border-style: dashed;
  }

  .rend-mark {
    color: var(--text-muted, #9aa0aa);
    font-size: 11px;
    margin-right: 3px;
  }

  .rend-legend {
    color: var(--text-muted, #9aa0aa);
    font-size: 11.5px;
    margin: 8px 0 0;
  }

  /* --- Spread tab ---------------------------------------------------------
     A bar per book, colored by the app's own book-category ramp so a bar means
     the same thing here as a verse number does in the reader.

     That ramp was built for identity cues, not for charting, and measured as a
     chart palette it has two real problems: the prophets' and Pauline purples
     sit under 3:1 against this surface, and Acts' orange against the Gospels'
     red is below the normal-vision separation floor. Neither is worth forking
     the app's colors over, because color is not carrying identity here — every
     bar is named and grouped under its category. The relief the contrast
     shortfall obliges is built in instead: each bar sits on a visible track and
     carries a 1px inner ring, so a dark purple still reads as a length, and the
     count is printed in text ink beyond the bar rather than on the fill. */
  .spread-corpus + .spread-corpus {
    margin-top: 6px;
  }

  .spread-corpus-name {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin: 0 0 8px;
    padding-top: 10px;
    border-top: 1px solid rgba(255, 255, 255, 0.07);
    font-size: 13px;
    font-weight: 600;
    color: var(--text-color, #dfe2e8);
  }

  .spread-cat {
    margin: 10px 0 5px;
    color: var(--text-muted, #9aa0aa);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .bar-row {
    display: grid;
    grid-template-columns: 8.5em 1fr 2.2em;
    align-items: center;
    gap: 8px;
    /* 2px of surface between adjacent bars. */
    padding: 2px 0;
  }

  .bar-label {
    font-size: 12.5px;
    color: var(--text-color, #dfe2e8);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* The track is what makes a low-contrast fill still legible as a length. */
  .bar-track {
    display: block;
    background: rgba(255, 255, 255, 0.06);
    border-radius: 4px;
    height: 10px;
    overflow: hidden;
  }

  .bar-fill {
    display: block;
    height: 100%;
    border-radius: 4px;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18);
  }

  /* Text ink, never the series color. */
  .bar-value {
    color: var(--text-muted, #9aa0aa);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  /* --- Arc tab ------------------------------------------------------------ */
  .hapax {
    background: color-mix(in srgb, #fde047 12%, transparent);
    border: 1px solid color-mix(in srgb, #fde047 35%, transparent);
    border-radius: 6px;
    color: #e4e7ec;
    font-size: 13px;
    line-height: 1.5;
    margin: 0;
    padding: 9px 11px;
  }

  .hapax strong {
    color: #fde047;
  }

  dl.arc {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 14px;
    margin: 0;
    align-items: baseline;
  }

  dl.arc dt {
    color: var(--text-muted, #9aa0aa);
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  dl.arc dd {
    margin: 0;
    font-size: 13.5px;
  }

  .arc-ref {
    background: none;
    border: none;
    padding: 0;
    font-family: inherit;
    font-size: 13.5px;
    color: var(--color-primary, #4a90e2);
    cursor: pointer;
    text-decoration: underline;
    text-decoration-style: dotted;
    text-underline-offset: 3px;
  }

  .arc-ref:hover {
    text-decoration-style: solid;
  }

  .arc-dim {
    color: var(--text-muted, #9aa0aa);
    font-size: 12px;
  }

  .arc-span {
    border-top: 1px solid rgba(255, 255, 255, 0.07);
    padding-top: 12px;
  }

  .arc-span h3 {
    margin: 0 0 8px;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-color, #dfe2e8);
  }

  .coming-soon {
    font-size: 18px;
    color: #888;
    margin: 0;
  }

  @media (max-width: 768px) {
    .info-section dl {
      grid-template-columns: 120px 1fr;
      gap: 8px 12px;
    }
  }
</style>
