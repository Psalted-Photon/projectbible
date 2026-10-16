<script lang="ts">
  import { CaretRight } from "phosphor-svelte";
  import { get } from "svelte/store";
  import StrongsVerseList from "../StrongsVerseList.svelte";
  import EnglishChip from "../EnglishChip.svelte";
  import {
    loadStrongsUsage,
    buildVerseUses,
    buildFormGroups,
    sourcesByTestament,
    buildDistribution,
    refKey,
    type StrongsUsage,
    type VerseUse,
  } from "../../lib/strongsUsage";
  import { navigationStore } from "../../stores/navigationStore";
  import { isOriginalLanguage, greekPartnerFor } from "../../lib/translationKind";
  import { parseOsisRef } from "../../lib/parseRefString";
  import { expandRmacCode, expandOshbCode, expandStepBiblePOS } from "../../lib/morphologyExpander";
  import {
    languageColor,
    isRtl,
    displayId,
    loadMeanings,
    parseKjvUsage,
    type StrongsEntryData,
    type EntryTab,
    type Meaning,
  } from "../../lib/strongs/entry";
  import { reveal } from "../../lib/motion";
  import { showOriginalWordAt } from "../OriginalWordPopup.svelte";

  /**
   * One Strong's entry: the definition, and how the word is used across the
   * installed original texts. Lived inside the Dictionary card until Strong's
   * became its own work; the frame around it (tabs, header, pin, close) is
   * StrongsContent's.
   */
  export let entry: StrongsEntryData;
  export let activeTab: EntryTab = "definition";
  /** A verse followed out of the entry — the frame decides what happens to the card. */
  export let onVerse: (target: { book: string; chapter: number; verse: number; fromTranslation?: string }) => void;
  /** Another entry asked for from this one: a related word, a number named
   *  in the text, or another of a split number's meanings. */
  export let onOpenEntry: (id: string) => void;
  /** Reports a tab change, so a window can keep it. */
  export let onTab: ((tab: EntryTab) => void) | null = null;
  /** The translation a verse tap lands in, which picks the English under each preview. */
  export let readerTranslation: string | null = null;

  function selectTab(tab: EntryTab) {
    activeTab = tab;
    onTab?.(tab);
  }

  // --- Usage: the Forms, Occurrences and Spread tabs -----------------
  // All three answer questions about the same set of tagged words, so they
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
  $: distribution = buildDistribution(verseUses);
  /** The picker only earns its row when there is a choice to make. A Hebrew
   *  entry only ever appears in one text. */
  $: showSourcePicker = (usage?.sources.length ?? 0) > 1;
  $: rtl = isRtl(entry.language);

  /** Words sharing this one's sense, grouped in two tiers. Greek only: the
   *  domain tagging comes from the Greek NT, so a Hebrew entry has none. */
  $: related = entry.related;

  // --- Meanings ----------------------------------------------------------
  // STEPBible splits some numbers where Strong's gave one number to two words
  // (H1254 is "to create" and "to fatten"). The number and each of its
  // meanings are listed, so either can be studied on its own.
  let meanings: Meaning[] = [];
  let meaningsFor = "";
  $: if (entry.id !== meaningsFor) {
    meaningsFor = entry.id;
    meanings = [];
    const id = entry.id;
    loadMeanings(id).then((found) => {
      if (meaningsFor === id) meanings = found;
    });
  }

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
   * All three tabs read from the result, and the source picker filters it in
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
    activeTab === "forms" || activeTab === "occurrences" || activeTab === "spread";
  $: if (needsUsage && usageEntry) loadUsage(usageEntry);

  /** Open on the text you are already reading when that is one of the originals,
   *  so the study agrees with the passage beside it. Reading in English, open on
   *  the Greek that translation was made from (NET → SBLGNT). */
  function defaultSource(sources: string[]): string | null {
    if (sources.length < 2) return null;
    const reading = (readerTranslation ?? get(navigationStore).translation)?.toLowerCase();
    const want = isOriginalLanguage(reading) ? reading : greekPartnerFor(reading);
    const match = sources.find((s) => s.toLowerCase() === want);
    return match ?? null;
  }

  function handleVerseClick(use: VerseUse) {
    visitedRefs = new Set(visitedRefs).add(refKey(use));
    // The verse is numbered the way its text numbers it; the jump converts.
    onVerse({ book: use.book, chapter: use.chapter, verse: use.verse, fromTranslation: use.sources[0] });
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
      .replace(/<(?!\/?(strong|em|br|button|span)[^>]*>)[^>]+>/gi, "")
      .split(/(<[^>]+>)/)
      .map((part) => (part.startsWith("<") ? part : linkNumbers(part)))
      .join("");
  }

  /**
   * Strong's numbers named in the text — "from G0025", "plural of H0433" —
   * become links to their entries. Only the text between tags is touched, so a
   * verse reference's own markup is never rewritten.
   */
  function linkNumbers(text: string): string {
    return text.replace(/\b([GH])0*(\d{1,4})([A-Z]?)\b/g, (_m, prefix: string, digits: string, split: string) => {
      const id = `${prefix}${digits.padStart(4, "0")}${split}`;
      return `<button class="strongs-ref" data-strongs="${id}">${prefix}${digits}${split}</button>`;
    });
  }

  $: kjvRenderings = entry.kjvUsage ? parseKjvUsage(entry.kjvUsage) : [];
  $: kjvHasMarkers = kjvRenderings.some((r) => r.marker);

  /** Handle clicks on rendered Strong's markup — verse references and
   *  Strong's numbers. */
  function handleDefinitionClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    const number = target.closest<HTMLElement>(".strongs-ref")?.dataset.strongs;
    if (number) {
      onOpenEntry(number);
      return;
    }
    if (!target.classList.contains("scripture-ref")) {
      // A Greek or Hebrew word in the definition or derivation: its meaning
      // beside it, and its number opens here like the linked numbers do.
      if (target.closest(".full-def, .derivation") && !target.closest("a, button")) showOriginalWordAt(e, onOpenEntry);
      return;
    }
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
        <h3>Entry information</h3>
        <dl>
          <dt>Strong's ID:</dt>
          <dd style="color: {languageColor(entry.language)}">
            {displayId(entry.id)}
          </dd>

          <dt>Lemma:</dt>
          <dd class="lemma-text" dir={rtl ? "rtl" : "ltr"}>{entry.lemma}</dd>

          {#if entry.transliteration}
            <dt>Transliteration:</dt>
            <dd class="xlit">{entry.transliteration}</dd>
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
            <dt>Part of speech:</dt>
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
          <h3>Short definition</h3>
          <p class="short-def">{entry.shortDefinition}</p>
        </div>
      {/if}

      {#if meanings.length}
        <div class="info-section">
          <h3>Meanings</h3>
          <div class="meanings">
            {#each meanings as m (m.id)}
              <button
                class="meaning"
                class:here={m.id === entry.id}
                disabled={m.id === entry.id}
                on:click={() => onOpenEntry(m.id)}
              >
                <span class="meaning-id" style="color: {languageColor(entry.language)}">{displayId(m.id)}</span>
                <span class="meaning-lemma" dir={rtl ? "rtl" : "ltr"}>{m.lemma}</span>
                <span class="meaning-gloss">{m.all ? "every meaning" : m.gloss}</span>
              </button>
            {/each}
          </div>
        </div>
      {/if}

      <div class="info-section">
        <h3>Full definition</h3>
        <p class="full-def">{@html renderStrongsMarkup(entry.definition)}</p>
      </div>

      {#if kjvRenderings.length}
        <div class="info-section">
          <h3>KJV renderings</h3>
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
        <div class="usage-head">
          <p class="usage-count">
            {formGroups.length} form{formGroups.length === 1 ? "" : "s"}
          </p>
          <EnglishChip />
        </div>
        <div class="forms">
          {#each formGroups as f (f.key)}
            <div class="form-group">
              <button class="form-row" on:click={() => toggleForm(f.key)}>
                <span class="form-caret motion-caret" class:open={openForm === f.key}><CaretRight size="1em" weight="bold" /></span>
                <span class="form-text" dir={rtl ? "rtl" : "ltr"}>{f.form}</span>
                {#if f.transliteration}<span class="form-translit">{f.transliteration}</span>{/if}
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
                    {readerTranslation}
                    strongsId={entry.id}
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
        <div class="usage-head">
          <p class="usage-count">
            {verseUses.length} verse{verseUses.length === 1 ? "" : "s"}
          </p>
          <EnglishChip />
        </div>
        <StrongsVerseList
          uses={verseUses}
          {rtl}
          variantBaseline={activeBaseline}
          visited={visitedRefs}
          {readerTranslation}
          strongsId={entry.id}
          onNavigate={handleVerseClick}
        />
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
                <span class="spread-dim">{corpus.total}</span>
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
    font-family: "Gentium Plus", "SBL Greek", "SBL Hebrew", serif;
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

  /* Strong's numbers named in a definition or derivation, as links in their
     language's color. */
  :global(.strongs-ref) {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    line-height: inherit;
    cursor: pointer;
    display: inline;
    text-decoration: underline;
    text-decoration-style: dotted;
    text-underline-offset: 3px;
  }
  :global(.strongs-ref[data-strongs^="G"]) {
    color: #4caf50;
  }
  :global(.strongs-ref[data-strongs^="H"]) {
    color: #2196f3;
  }
  :global(.strongs-ref:hover) {
    text-decoration-style: solid;
  }

  /* --- Meanings -----------------------------------------------------------
     A split number's meanings, one row each, the one on screen marked. */
  .meanings {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .meaning {
    display: flex;
    align-items: baseline;
    gap: 10px;
    width: 100%;
    background: none;
    border: none;
    border-radius: 4px;
    color: var(--text-color, #dfe2e8);
    cursor: pointer;
    font-family: inherit;
    padding: 6px 8px;
    text-align: left;
  }
  .meaning:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.05);
  }
  .meaning.here {
    background: rgba(74, 144, 226, 0.1);
    box-shadow: inset 3px 0 0 var(--color-primary, #4a90e2);
    cursor: default;
  }
  .meaning-id {
    min-width: 4.2em;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .meaning-lemma {
    font-family: "Gentium Plus", "SBL Greek", "SBL Hebrew", serif;
    font-size: 15px;
  }
  .meaning-gloss {
    color: var(--text-muted, #9aa0aa);
    font-size: 13px;
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

  .usage-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
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

  /* Transliteration and pronunciation share Gentium with the Greek above. */
  .xlit {
    font-family: "Gentium Plus", serif;
  }

  .phonetic {
    font-family: "Gentium Plus", serif;
    color: var(--text-muted, #aaa);
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

  .form-translit {
    color: var(--text-muted, #9aa0aa);
    font-size: 12px;
    font-style: italic;
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
    font-family: "Gentium Plus", "SBL Greek", "SBL Hebrew", serif;
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

  .spread-dim {
    color: var(--text-muted, #9aa0aa);
    font-size: 12px;
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
