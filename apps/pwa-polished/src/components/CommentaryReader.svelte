<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import CommentaryNavigationBar from "./CommentaryNavigationBar.svelte";
  import { navigationStore } from "../stores/navigationStore";
  import { windowStore } from "../lib/stores/windowStore";
  import { IndexedDBCommentaryStore, type CommentaryEntry } from "../adapters/CommentaryStore";
  import { linkifyCommentaryRefs } from "../lib/linkifyCommentaryRefs";
  import { parseRefString } from "../lib/parseRefString";
  import { loadEnoch, isEnochAuthor, type EnochBook, type EnochChapter } from "../lib/enochBooks";

  export let windowId: string | undefined = undefined;

  let readerElement: HTMLDivElement;
  let commentaryStore: IndexedDBCommentaryStore;
  let entries: CommentaryEntry[] = [];
  let loading = true;
  let error = "";
  let lastNavigationKey = "";
  let lastScrolledVerseKey = ''; // guard: skip scrollToVerse if same checkpoint

  // Book of Enoch reading state (bundled text, bypasses the commentary store)
  let enochBook: EnochBook | null = null;
  let enochChapter: EnochChapter | null = null;
  let enochLoading = false;
  let enochLoadKey = "";

  // Use per-window state if windowId provided, otherwise use global state
  $: windowState = windowId
    ? $windowStore.find((w) => w.id === windowId)
    : null;
  $: currentBook = windowState?.contentState?.book ?? $navigationStore.book;
  $: currentChapter =
    windowState?.contentState?.chapter ?? $navigationStore.chapter;
  $: currentAuthor = windowState?.contentState?.author;
  $: isEnoch = isEnochAuthor(currentAuthor);
  $: highlightVerse =
    windowState?.contentState?.highlightedVerse ??
    $navigationStore.highlightedVerse ??
    null;

  // Load commentary when navigation changes (skipped entirely in Enoch mode)
  $: {
    const navKey = `${currentBook}-${currentChapter}-${currentAuthor ?? 'all'}`;
    if (!isEnoch && commentaryStore && navKey !== lastNavigationKey) {
      lastNavigationKey = navKey;
      loadCommentary(currentBook, currentChapter, currentAuthor);
    }
  }

  // Load the Book of Enoch chapter when an Enoch edition is active
  $: if (isEnoch) {
    const key = `${currentAuthor}-${currentChapter}`;
    if (key !== enochLoadKey) {
      enochLoadKey = key;
      loadEnochChapter(currentAuthor, currentChapter);
    }
  }

  // Prev/next chapter within the active Enoch edition
  $: enochIndex =
    enochBook && enochChapter
      ? enochBook.chapters.findIndex((c) => c.chapter === enochChapter!.chapter)
      : -1;
  $: hasPrevEnoch = enochIndex > 0;
  $: hasNextEnoch = !!enochBook && enochIndex >= 0 && enochIndex < enochBook.chapters.length - 1;

  function goEnoch(delta: number) {
    if (!enochBook || enochIndex < 0 || !windowId) return;
    const target = enochBook.chapters[enochIndex + delta];
    if (target) {
      windowStore.updateContentState(windowId, {
        chapter: target.chapter,
        highlightedVerse: undefined,
      });
    }
  }

  async function loadEnochChapter(author: string | undefined, chapterNum: number) {
    enochLoading = true;
    try {
      const book = await loadEnoch(author);
      enochBook = book;
      enochChapter =
        book?.chapters.find((c) => c.chapter === chapterNum) ?? book?.chapters[0] ?? null;
      if (readerElement) readerElement.scrollTo({ top: 0, behavior: "auto" });
    } catch (err) {
      console.error("Error loading Book of Enoch:", err);
      enochBook = null;
      enochChapter = null;
    } finally {
      enochLoading = false;
    }
  }

  // Auto-scroll to highlighted verse
  $: if (highlightVerse !== null && entries.length > 0 && readerElement) {
    scrollToVerse(highlightVerse);
  }

  // Emit checkpoint verse numbers to BibleReader via contentState for amber highlights
  $: if (windowId) {
    const checkpoints = isEnoch
      ? []
      : [...new Set(entries.filter(e => e.verseStart > 0).map(e => e.verseStart))];
    windowStore.updateContentState(windowId, { checkpoints });
  }

  // Cross-reference links: linkifyCommentaryRefs wraps detected Bible references
  // in <span class="commentary-ref" data-ref="..."> elements. Handle taps via
  // event delegation on the body and navigate to the referenced verse.
  function handleCommentaryBodyClick(e: MouseEvent | KeyboardEvent) {
    const target = e.target as HTMLElement;
    if (!target.classList.contains("commentary-ref")) return;
    if (e instanceof KeyboardEvent && e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    const ref = target.dataset.ref;
    if (ref) handleRefClick(ref);
  }

  function handleRefClick(ref: string) {
    const t = parseRefString(ref, currentBook, currentChapter);
    if (!t) return;
    navigationStore.navigateToVerse(
      $navigationStore.translation,
      t.book,
      t.chapter,
      t.verse,
    );
  }

  async function loadCommentary(book: string, chapter: number, author?: string) {
    loading = true;
    error = "";
    lastScrolledVerseKey = ''; // reset so new chapter allows fresh scroll-to-verse
    // Clear stale highlightedVerse so old verse doesn't drive scrollToVerse in new chapter
    if (windowId) windowStore.updateContentState(windowId, { highlightedVerse: undefined });
    try {
      console.log(`📜 Loading commentary for ${book} ${chapter}, author: ${author || 'all'}`);
      
      // Get all verse-level commentary entries for the chapter
      entries = await commentaryStore.getAllChapterContent(book, chapter, author);
      
      console.log(`   Loaded ${entries.length} commentary entries`);

      if (readerElement) {
        readerElement.scrollTo({ top: 0, behavior: "auto" });
      }
    } catch (err: unknown) {
      console.error("Error loading commentary:", err);
      error = `Failed to load commentary for ${book} ${chapter}.`;
      entries = [];
    } finally {
      loading = false;
    }
  }

  /** Pending un-mark timer, so a second jump cannot clear the first one's mark. */
  let markTimer: number | null = null;
  onDestroy(() => { if (markTimer !== null) clearTimeout(markTimer); });

  function scrollToVerse(verseNum: number) {
    if (!readerElement) return;

    // Find nearest preceding checkpoint: largest verseStart ≤ verseNum
    const candidates = entries.filter(e => e.verseStart > 0 && e.verseStart <= verseNum);
    if (candidates.length === 0) return;
    const maxVerseStart = Math.max(...candidates.map(e => e.verseStart));
    const targetEntry = entries.find(e => e.verseStart === maxVerseStart);
    if (!targetEntry) return;

    // Guard: skip if we already scrolled to this checkpoint
    const key = String(targetEntry.verseStart);
    if (key === lastScrolledVerseKey) return;
    lastScrolledVerseKey = key;

    // Scroll to the entry element
    const entryEl = readerElement.querySelector(
      `.commentary-entry[data-verse-start="${targetEntry.verseStart}"][data-author="${targetEntry.author}"]`
    ) as HTMLElement | null;

    if (entryEl) {
      // Renamed off `search-verse-highlighted`: BibleReader has a global class by
      // that name with an entirely different look, so the two were only ever
      // kept apart by this component's scoping.
      entryEl.classList.add('commentary-entry-marked');
      entryEl.scrollIntoView({ behavior: 'smooth', block: 'start' });

      // One timer, cancelled if another jump lands first. Left uncancelled it
      // could strip the mark off a later entry, or fire after teardown.
      if (markTimer !== null) clearTimeout(markTimer);
      markTimer = window.setTimeout(() => {
        markTimer = null;
        entryEl.classList.remove('commentary-entry-marked');
      }, 3000);
    }
  }

  onMount(async () => {
    commentaryStore = new IndexedDBCommentaryStore();

    // Load initial commentary (Enoch mode is driven by its own reactive)
    if (!isEnoch && currentBook && currentChapter) {
      await loadCommentary(currentBook, currentChapter, currentAuthor);
    }
  });
</script>

<div class="commentary-reader" bind:this={readerElement}>
  <CommentaryNavigationBar {windowId} />

  {#if isEnoch}
    <div class="commentary-container enoch-container">
      {#if enochLoading && !enochChapter}
        <div class="loading">Loading the Book of Enoch…</div>
      {:else if enochChapter}
        <article class="enoch-reading">
          {#if enochBook && enochChapter.chapter === enochBook.chapters[0].chapter}
            <div class="enoch-masthead">
              {enochBook.title}
              <span class="enoch-attrib">translated by {enochBook.translator}, {enochBook.year}</span>
            </div>
          {/if}
          {#each enochChapter.headings as h}
            <h2 class="enoch-section">{h}</h2>
          {/each}
          <h3 class="enoch-chapter-title">{enochChapter.label}</h3>
          <p class="enoch-verses">{#each enochChapter.verses as v}<span class="enoch-verse"><sup class="enoch-vn">{v.n}</sup>{v.text} </span>{/each}</p>
          <nav class="enoch-nav">
            <button class="enoch-nav-btn" disabled={!hasPrevEnoch} on:click={() => goEnoch(-1)}>‹ Prev</button>
            <span class="enoch-nav-label">{enochChapter.label}</span>
            <button class="enoch-nav-btn" disabled={!hasNextEnoch} on:click={() => goEnoch(1)}>Next ›</button>
          </nav>
        </article>
      {:else}
        <div class="no-content">
          <h3>Book of Enoch</h3>
          <p>Could not load this chapter.</p>
        </div>
      {/if}
    </div>
  {:else}
  <div class="commentary-container">
    {#if loading && entries.length === 0}
      <div class="loading">Loading commentary...</div>
    {:else if error}
      <div class="error">{error}</div>
      <p class="error-hint">
        Make sure you have commentary packs installed via Manage Packs.
      </p>
    {:else if entries.length === 0}
      <div class="no-content">
        <h3>No commentary available</h3>
        <p>No commentary found for {currentBook} {currentChapter}.</p>
        <p class="hint">Import more commentary packs via Manage Packs to see additional content.</p>
      </div>
    {:else}
      <div class="entries">
        {#each entries as entry (`${entry.book}-${entry.chapter}-${entry.verseStart}-${entry.author}`)}
          <div 
            class="commentary-entry"
            class:chapter-intro={entry.verseStart === 0}
            data-verse-start={entry.verseStart}
            data-author={entry.author}
          >
            {#if entry.verseStart === 0}
              <!-- Chapter-level commentary with sticky badge -->
              <div class="chapter-badge">
                <span class="badge-icon">📘</span>
                <span class="badge-text">Chapter Commentary</span>
              </div>
            {:else}
              <!-- Verse-level commentary with verse number -->
              <div class="verse-header">
                <span class="verse-number" data-verse={entry.verseStart}>
                  {entry.verseStart}{#if entry.verseEnd && entry.verseEnd !== entry.verseStart}–{entry.verseEnd}{/if}
                </span>
              </div>
            {/if}

            <div class="entry-content">
              <h3 class="author-name">{entry.author}</h3>
              {#if entry.title}
                <h4 class="entry-title">{entry.title}</h4>
              {/if}
              <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
              <div
                class="entry-text"
                on:click={handleCommentaryBodyClick}
                on:keydown={handleCommentaryBodyClick}
              >{@html linkifyCommentaryRefs(entry.text, currentBook, currentChapter, entry.author)}</div>
            </div>
          </div>

          {#if entry.verseStart === 0}
            <!-- Section divider after chapter commentary -->
            <div class="section-divider">
              <span class="divider-text">Verse Commentary</span>
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  </div>
  {/if}
</div>

<style>
  .commentary-reader {
    width: 100%;
    height: 100%;
    position: relative;
    overflow-y: auto;
    overflow-x: hidden;
    background: #1a1a1a;
    color: #e0e0e0;
    display: flex;
    flex-direction: column;
  }

  .commentary-container {
    max-width: 100%;
    width: 100%;
    margin: 0 auto;
    padding: 80px 20px 100px;
    flex: 1;
    box-sizing: border-box;
    position: relative;
    z-index: 1;
  }

  .loading,
  .error,
  .no-content {
    text-align: center;
    padding: 40px 20px;
    color: #888;
  }

  .error {
    color: #ff6b6b;
  }

  .error-hint,
  .hint {
    font-size: 0.9rem;
    color: #666;
    margin-top: 10px;
  }

  .no-content h3 {
    color: #e0e0e0;
    margin-bottom: 12px;
  }

  .no-content p {
    margin: 8px 0;
  }

  .entries {
    max-width: 900px;
    margin: 0 auto;
  }

  .commentary-entry {
    margin-bottom: 30px;
    padding: 20px;
    background: #222;
    border-radius: 8px;
    border-left: 3px solid #667eea;
    transition: background 0.3s;
  }

  .commentary-entry.chapter-intro {
    background: #2a2a3a;
    border-left-color: #9c27b0;
    position: sticky;
    top: 68px;
    z-index: 100;
    margin-bottom: 0;
  }

  .commentary-entry:global(.commentary-entry-marked) {
    background: rgba(102, 126, 234, 0.2);
    border-left-color: #667eea;
    box-shadow: 0 0 20px rgba(102, 126, 234, 0.3);
  }

  .chapter-badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    background: rgba(156, 39, 176, 0.2);
    border: 1px solid rgba(156, 39, 176, 0.4);
    border-radius: 16px;
    font-size: 0.85rem;
    color: #ce93d8;
    font-weight: 500;
    margin-bottom: 12px;
  }

  .badge-icon {
    font-size: 1rem;
  }

  .verse-header {
    margin-bottom: 12px;
  }

  .verse-number {
    display: inline-block;
    padding: 4px 10px;
    background: rgba(102, 126, 234, 0.2);
    border: 1px solid rgba(102, 126, 234, 0.4);
    border-radius: 12px;
    font-size: 0.85rem;
    color: #b8b8ff;
    font-weight: 500;
  }

  .entry-content {
    margin-top: 0;
  }

  .author-name {
    color: #667eea;
    font-size: 1.1rem;
    font-weight: 600;
    margin-bottom: 8px;
  }

  .entry-title {
    color: #999;
    font-size: 0.95rem;
    font-weight: normal;
    font-style: italic;
    margin-bottom: 12px;
  }

  .entry-text {
    line-height: 1.7;
    color: #e0e0e0;
    font-size: 1rem;
    white-space: pre-wrap;
    font-family: 'Merriweather', Georgia, serif;
  }

  .section-divider {
    margin: 30px 0;
    text-align: center;
    position: relative;
  }

  .section-divider::before,
  .section-divider::after {
    content: '';
    position: absolute;
    top: 50%;
    width: 45%;
    height: 1px;
    background: linear-gradient(to right, transparent, #444, transparent);
  }

  .section-divider::before {
    left: 0;
  }

  .section-divider::after {
    right: 0;
  }

  .divider-text {
    display: inline-block;
    padding: 0 20px;
    background: #1a1a1a;
    color: #666;
    font-size: 0.85rem;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  /* Mobile optimization */
  @media (max-width: 768px) {
    .commentary-container {
      padding: 80px 15px 80px;
    }

    .commentary-entry {
      padding: 16px;
      font-size: 0.95rem;
    }

    .entry-text {
      font-size: 0.95rem;
    }
  }

  /* ---------- Book of Enoch reading view ---------- */
  .enoch-reading {
    max-width: 720px;
    margin: 0 auto;
  }

  .enoch-masthead {
    display: flex;
    flex-direction: column;
    gap: 6px;
    text-align: center;
    font-family: 'Merriweather', Georgia, serif;
    font-size: 1.5rem;
    color: #e8e4ff;
    margin: 4px 0 30px;
  }

  .enoch-attrib {
    font-size: 0.85rem;
    color: #9a90c0;
    font-style: italic;
  }

  .enoch-section {
    text-transform: uppercase;
    letter-spacing: 1px;
    font-size: 0.8rem;
    font-weight: 600;
    color: #b39ddb;
    text-align: center;
    margin: 22px 0 4px;
  }

  .enoch-chapter-title {
    font-family: 'Merriweather', Georgia, serif;
    font-size: 1.4rem;
    font-weight: 600;
    color: #cbb8ff;
    text-align: center;
    margin: 8px 0 22px;
  }

  .enoch-verses {
    line-height: 1.95;
    color: #e6e6e6;
    font-size: 1.06rem;
    font-family: 'Merriweather', Georgia, serif;
    text-align: left;
    margin: 0;
  }

  .enoch-vn {
    color: #7d7a95;
    font-size: 0.62em;
    vertical-align: super;
    margin-left: 1px;
    margin-right: 3px;
    user-select: none;
    font-family: system-ui, -apple-system, sans-serif;
  }

  .enoch-nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin: 40px 0 8px;
    padding-top: 16px;
    border-top: 1px solid #333;
  }

  .enoch-nav-btn {
    background: #262636;
    border: 1px solid #3a3a4a;
    color: #cbb8ff;
    border-radius: 6px;
    padding: 8px 16px;
    cursor: pointer;
    font-size: 0.95rem;
    transition: background 0.15s;
    touch-action: manipulation;
  }
  .enoch-nav-btn:hover:not(:disabled) {
    background: #33334a;
  }
  .enoch-nav-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .enoch-nav-label {
    color: #999;
    font-size: 0.9rem;
  }

  @media (max-width: 768px) {
    .enoch-verses {
      font-size: 1rem;
    }
    .enoch-masthead {
      font-size: 1.3rem;
    }
  }

  /* Clickable Bible cross-references injected by linkifyCommentaryRefs */
  :global(.commentary-ref) {
    color: var(--ref-color, #8ab4f8);
    text-decoration: underline;
    text-decoration-style: dotted;
    text-underline-offset: 2px;
    cursor: pointer;
    border-radius: 2px;
    padding: 0 1px;
  }
  :global(.commentary-ref:hover) {
    color: color-mix(in srgb, var(--ref-color, #8ab4f8) 70%, white);
    text-decoration-style: solid;
    background: color-mix(in srgb, var(--ref-color, #8ab4f8) 12%, transparent);
  }
</style>
