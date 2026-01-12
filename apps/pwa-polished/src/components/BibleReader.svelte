<script lang="ts">
  import { onMount } from "svelte";
  import NavigationBar from "./NavigationBar.svelte";
  import {
    navigationStore,
    availableTranslations,
  } from "../stores/navigationStore";
  import { IndexedDBTextStore } from "../lib/adapters";
  import { renderVerseHtml, extractHeading } from "../lib/verseRendering";

  let readerElement: HTMLDivElement;
  let textStore: IndexedDBTextStore;
  let verses: Array<{ verse: number; text: string; heading?: string | null }> =
    [];
  let loading = true;
  let error = "";
  let debugInfo = "";

  $: currentBook = $navigationStore.book;
  $: currentChapter = $navigationStore.chapter;
  $: currentTranslation = $navigationStore.translation;

  // Load verses when navigation changes
  $: if (textStore && currentTranslation && currentBook && currentChapter) {
    loadChapter(currentTranslation, currentBook, currentChapter);
  }

  // Scroll to top when chapter changes
  $: if (currentBook || currentChapter) {
    readerElement?.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function loadChapter(
    translation: string,
    book: string,
    chapter: number
  ) {
    loading = true;
    error = "";
    try {
      const chapterVerses = await textStore.getChapter(
        translation,
        book,
        chapter
      );

      verses = chapterVerses.map((v) => {
        const { heading, textWithoutHeading } = extractHeading(v.text);
        return {
          verse: v.verse,
          text: textWithoutHeading,
          heading: heading || v.heading,
        };
      });

      // Debug problematic verses
      const v1 = verses.find((v) => v.verse === 1);
      const v6 = verses.find((v) => v.verse === 6);
      if (v1) debugInfo = `V1 heading: ${v1.heading || "none"}`;
      if (v6) debugInfo += ` | V6 heading: ${v6.heading || "none"}`;

      console.log(
        "Sample verse with heading:",
        verses.find((v) => v.heading)
      );
    } catch (err) {
      console.error("Error loading chapter:", err);
      error = `Failed to load ${book} ${chapter}. Make sure you have packs installed.`;
      verses = [];
    } finally {
      loading = false;
    }
  }

  async function loadAvailableTranslations() {
    try {
      debugInfo = "Loading translations...";
      const translations = await textStore.getTranslations();

      debugInfo = `Found ${translations.length} translations: ${JSON.stringify(translations)}`;

      if (translations.length > 0) {
        const translationIds = translations.map((t) => t.id);
        availableTranslations.set(translationIds);

        // If current translation not available, switch to first one
        const currentTransUpper = currentTranslation.toUpperCase();
        const match = translations.find(
          (t) => t.id.toUpperCase() === currentTransUpper
        );

        if (!match) {
          navigationStore.setTranslation(translations[0].id);
          debugInfo += ` | Switched to ${translations[0].id}`;
        } else if (match.id !== currentTranslation) {
          // Update to the exact case from database
          navigationStore.setTranslation(match.id);
          debugInfo += ` | Updated case to ${match.id}`;
        }
      } else {
        debugInfo = "No translations found in database!";
      }
    } catch (err) {
      debugInfo = `Error: ${err.message}`;
      console.error("Error loading translations:", err);
    }
  }

  onMount(async () => {
    textStore = new IndexedDBTextStore();

    await loadAvailableTranslations();
    await loadChapter(currentTranslation, currentBook, currentChapter);

    // Handle footnote/cross-ref clicks
    const handleNoteClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      const noteEl = target.closest(".inline-note") as HTMLElement | null;
      if (!noteEl) return;

      e.preventDefault();
      e.stopPropagation();

      const encodedNote = noteEl.getAttribute("data-note") || "";
      const noteIndex = noteEl.getAttribute("data-note-index") || "";
      const noteText = decodeURIComponent(encodedNote);
      const isXref = noteEl.classList.contains("inline-xref");

      alert(
        `${isXref ? "Cross-reference" : "Footnote"} ${noteIndex}:\n\n${noteText}`
      );
    };

    readerElement?.addEventListener("click", handleNoteClick, true);

    return () => {
      readerElement?.removeEventListener("click", handleNoteClick, true);
    };
  });
</script>

<div class="bible-reader" bind:this={readerElement}>
  <NavigationBar />

  <div class="text-container">
    <div class="chapter-header">
      <h1>{currentBook} {currentChapter}</h1>
    </div>

    {#if debugInfo}
      <div
        class="debug-info"
        style="background: #ffffcc; color: #000; padding: 10px; margin: 10px 0; border-radius: 4px; font-size: 12px; word-wrap: break-word;"
      >
        DEBUG: {debugInfo}
      </div>
    {/if}

    {#if loading}
      <div class="loading">Loading...</div>
    {:else if error}
      <div class="error">{error}</div>
      <p class="error-hint">
        To load Bible text, import a pack using the classic version at
        <a href="/apps/pwa/" target="_blank">localhost:5173</a>
      </p>
    {:else if verses.length === 0}
      <div class="no-content">No verses found for this chapter.</div>
    {:else}
      <div class="verses">
        {#each verses as { verse, text, heading }}
          {#if heading}
            <div class="section-heading">{heading}</div>
          {/if}
          <div class="verse">
            <span class="verse-number">{verse}</span>
            <span class="verse-text">{@html renderVerseHtml(text)}</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .bible-reader {
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

  .text-container {
    max-width: 700px;
    margin: 0 auto;
    padding: 40px 20px 100px;
    flex: 1;
  }

  .chapter-header {
    margin-bottom: 2rem;
    text-align: center;
  }

  .chapter-header h1 {
    font-size: 1.5rem;
    font-weight: 600;
    color: #f0f0f0;
  }

  .verses {
    line-height: 1.8;
  }

  .verse {
    margin-bottom: 0.5rem;
  }

  .verse-number {
    display: inline-block;
    min-width: 2rem;
    font-size: 0.75rem;
    color: #888;
    vertical-align: super;
    margin-right: 0.25rem;
  }

  .verse-text {
    font-size: 1.125rem;
    line-height: 1.8;
  }

  .section-heading {
    font-weight: 600;
    font-size: 1.1rem;
    color: #d0d0d0;
    margin: 24px 0 12px 0;
    padding-top: 12px;
    border-top: 1px solid #444;
  }

  .section-heading:first-child {
    margin-top: 0;
    border-top: none;
  }

  :global(.inline-note) {
    color: #6699ff;
    cursor: pointer;
    font-size: 0.7em;
    margin: 0 2px;
  }

  :global(.inline-xref) {
    color: #ccc;
  }

  .loading,
  .error,
  .no-content {
    text-align: center;
    padding: 40px 20px;
    color: #888;
    font-size: 1rem;
  }

  .error {
    color: #ff6b6b;
  }

  .error-hint {
    text-align: center;
    color: #888;
    font-size: 0.9rem;
    margin-top: 10px;
  }

  .error-hint a {
    color: #667eea;
    text-decoration: none;
  }

  .error-hint a:hover {
    text-decoration: underline;
  }

  /* Smooth scrolling */
  .bible-reader {
    scroll-behavior: smooth;
    -webkit-overflow-scrolling: touch;
  }
</style>
