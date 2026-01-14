<script lang="ts">
  import { onMount } from "svelte";
  import NavigationBar from "./NavigationBar.svelte";
  import {
    navigationStore,
    availableTranslations,
  } from "../stores/navigationStore";
  import { windowStore } from "../lib/stores/windowStore";
  import { IndexedDBTextStore } from "../lib/adapters";
  import { renderVerseHtml, extractHeading } from "../lib/verseRendering";
  import { BIBLE_BOOKS } from "../lib/bibleData";

  export let windowId: string | undefined = undefined;

  let readerElement: HTMLDivElement;
  let textStore: IndexedDBTextStore;
  let chapters: Array<{ 
    book: string; 
    chapter: number; 
    verses: Array<{ verse: number; text: string; heading?: string | null }>
  }> = [];
  let loading = true;
  let error = "";
  let chronologicalData: any = null;
  let isLoadingNextChapter = false;
  let isLoadingPrevChapter = false;
  let scrollCheckInterval: number | null = null;
  let lastNavigationKey = '';
  let lastScrollTop = 0;
  let showNavBar = true;

  // Use per-window state if windowId provided, otherwise use global state
  $: windowState = windowId ? $windowStore.find(w => w.id === windowId) : null;
  $: currentBook = windowState?.contentState?.book ?? $navigationStore.book;
  $: currentChapter = windowState?.contentState?.chapter ?? $navigationStore.chapter;
  $: currentTranslation = windowState?.contentState?.translation ?? $navigationStore.translation;
  $: isChronologicalMode = $navigationStore.isChronologicalMode ?? false;

  // Load verses when navigation changes externally (not from our scroll loading)
  $: {
    const navKey = `${currentTranslation}-${currentBook}-${currentChapter}-${isChronologicalMode}`;
    if (textStore && navKey !== lastNavigationKey) {
      lastNavigationKey = navKey;
      loadChapter(currentTranslation, currentBook, currentChapter, true);
    }
  }

  // Start/stop scroll detection
  $: if (currentBook) {
    startScrollDetection();
  }

  async function loadChapter(
    translation: string,
    book: string,
    chapter: number,
    resetScroll = false
  ) {
    loading = true;
    error = "";
    try {
      const chapterVerses = await textStore.getChapter(
        translation,
        book,
        chapter
      );

      const processedVerses = chapterVerses.map((v) => {
        const { heading, textWithoutHeading } = extractHeading(v.text);
        return {
          verse: v.verse,
          text: textWithoutHeading,
          heading: heading || v.heading,
        };
      });

      // Reset chapters array and scroll to top
      chapters = [{ book, chapter, verses: processedVerses }];
      
      if (resetScroll && readerElement) {
        readerElement.scrollTo({ top: 0, behavior: "auto" });
      }
    } catch (err: unknown) {
      console.error("Error loading chapter:", err);
      error = `Failed to load ${book} ${chapter}. Make sure you have packs installed.`;
      chapters = [];
    } finally {
      loading = false;
    }
  }

  async function loadAvailableTranslations() {
    try {
      const translations = await textStore.getTranslations();

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
        } else if (match.id !== currentTranslation) {
          // Update to the exact case from database
          navigationStore.setTranslation(match.id);
        }
        
        // Verify the selected translation has verses
        const testVerse = await textStore.getVerse(
          translations[0].id,
          "Genesis",
          1,
          1
        );
        
        if (!testVerse) {
          console.warn("Translation has no verses, reimporting...");
          await autoLoadFromPublic(true);
        }
      } else {
        // No translations found - try loading from public directory
        await autoLoadFromPublic(false);
      }
    } catch (err: unknown) {
      console.error("Error loading translations:", err);
    }
  }

  async function autoLoadFromPublic(clearFirst: boolean) {
    try {
      if (clearFirst) {
        const db = await import("../adapters/db").then((m) => m.openDB());
        const tx = db.transaction(["packs", "verses"], "readwrite");
        await tx.objectStore("packs").clear();
        await tx.objectStore("verses").clear();
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      }
      
      const { importPackFromUrl } = await import("../adapters/pack-import");
      
      // Load all available packs from public directory
      const packsToLoad = [
        "bsb.sqlite",
        "kjv.sqlite", 
        "web.sqlite",
        "greek.sqlite",
        "hebrew.sqlite"
      ];
      
      for (const packFile of packsToLoad) {
        try {
          console.log(`Loading ${packFile}...`);
          await importPackFromUrl(`/${packFile}`);
        } catch (err) {
          console.warn(`Failed to load ${packFile}:`, err);
        }
      }
      
      // Reload translations after import
      const translations = await textStore.getTranslations();
      if (translations.length > 0) {
        availableTranslations.set(translations.map((t) => t.id));
        navigationStore.setTranslation(translations[0].id);
        await loadChapter(translations[0].id, currentBook, currentChapter);
      }
    } catch (err) {
      console.error("Failed to auto-load packs:", err);
      error = `Failed to load Bible data: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  async function loadChronologicalPack() {
    try {
      const response = await fetch('/packs/chronological-v1.json');
      if (response.ok) {
        chronologicalData = await response.json();
        console.log(`Loaded chronological pack: ${chronologicalData.verse_count} verses`);
      }
    } catch (e) {
      console.warn('Chronological pack not available:', e);
    }
  }

  function startScrollDetection() {
    if (scrollCheckInterval) return;
    
    scrollCheckInterval = window.setInterval(() => {
      if (!readerElement) return;
      
      const scrollTop = readerElement.scrollTop;
      const scrollPosition = scrollTop + readerElement.clientHeight;
      const scrollHeight = readerElement.scrollHeight;
      
      // Show/hide navbar based on scroll direction
      if (scrollTop < lastScrollTop || scrollTop < 50) {
        // Scrolling up or near top - show navbar
        showNavBar = true;
      } else if (scrollTop > lastScrollTop && scrollTop > 100) {
        // Scrolling down and past threshold - hide navbar
        showNavBar = false;
      }
      lastScrollTop = scrollTop;
      
      // If within 200px of bottom, load next chapter
      if (scrollPosition >= scrollHeight - 200 && !isLoadingNextChapter) {
        loadNextChapter();
      }
      
      // If within 200px of top, load previous chapter
      if (scrollTop <= 200 && !isLoadingPrevChapter) {
        loadPreviousChapter();
      }
    }, 300);
  }

  function stopScrollDetection() {
    if (scrollCheckInterval) {
      clearInterval(scrollCheckInterval);
      scrollCheckInterval = null;
    }
  }

  async function loadNextChapter() {
    if (isLoadingNextChapter || chapters.length === 0) return;
    isLoadingNextChapter = true;

    try {
      const lastChapter = chapters[chapters.length - 1];
      let nextBook = lastChapter.book;
      let nextChapter = lastChapter.chapter + 1;

      console.log('loadNextChapter - isChronologicalMode:', isChronologicalMode);
      console.log('loadNextChapter - chronologicalData loaded:', !!chronologicalData);
      console.log('loadNextChapter - current:', lastChapter.book, lastChapter.chapter);

      if (isChronologicalMode && chronologicalData) {
        console.log('Using chronological order...');
        // Find the LAST verse of the current chapter in chronological order
        const currentChapterVerses = chronologicalData.verses.filter(
          (v: any) => v.book === lastChapter.book && v.chapter === lastChapter.chapter
        );

        console.log('Found', currentChapterVerses.length, 'verses for current chapter');

        if (currentChapterVerses.length > 0) {
          // Get the highest chrono_index for this chapter
          const lastVerseIndex = Math.max(...currentChapterVerses.map((v: any) => v.chrono_index));
          
          console.log('Last verse index of current chapter:', lastVerseIndex);
          
          // Find the next chapter after this index
          const nextChapterData = chronologicalData.verses.find(
            (v: any) => v.chrono_index > lastVerseIndex &&
                        (v.book !== lastChapter.book || v.chapter !== lastChapter.chapter)
          );

          if (nextChapterData) {
            nextBook = nextChapterData.book;
            nextChapter = nextChapterData.chapter;
            console.log('Next chapter in chrono order:', nextBook, nextChapter);
          } else {
            // Loop back to beginning
            nextBook = chronologicalData.verses[0].book;
            nextChapter = chronologicalData.verses[0].chapter;
            console.log('Looping to start:', nextBook, nextChapter);
          }
        }
      } else {
        console.log('Using canonical order...');
        const bookInfo = BIBLE_BOOKS.find(b => b.name === lastChapter.book);
        if (bookInfo && nextChapter > bookInfo.chapters) {
          const currentBookIndex = BIBLE_BOOKS.findIndex(b => b.name === lastChapter.book);
          if (currentBookIndex < BIBLE_BOOKS.length - 1) {
            nextBook = BIBLE_BOOKS[currentBookIndex + 1].name;
            nextChapter = 1;
          } else {
            // Loop back to Genesis 1
            nextBook = BIBLE_BOOKS[0].name;
            nextChapter = 1;
          }
        }
      }

      // Check if already loaded
      if (chapters.some(c => c.book === nextBook && c.chapter === nextChapter)) {
        isLoadingNextChapter = false;
        return;
      }

      const nextVerses = await textStore.getChapter(currentTranslation, nextBook, nextChapter);
      
      if (nextVerses.length > 0) {
        const processedVerses = nextVerses.map((v) => {
          const { heading, textWithoutHeading } = extractHeading(v.text);
          return {
            verse: v.verse,
            text: textWithoutHeading,
            heading: heading || v.heading,
          };
        });

        // Append without triggering navigation update
        chapters = [...chapters, { book: nextBook, chapter: nextChapter, verses: processedVerses }];
      }
    } catch (err) {
      console.error('Error loading next chapter:', err);
    } finally {
      isLoadingNextChapter = false;
    }
  }

  async function loadPreviousChapter() {
    if (isLoadingPrevChapter || chapters.length === 0) return;
    isLoadingPrevChapter = true;

    try {
      const firstChapter = chapters[0];
      let prevBook = firstChapter.book;
      let prevChapter = firstChapter.chapter - 1;

      if (isChronologicalMode && chronologicalData) {
        // Find the FIRST verse of the current chapter in chronological order
        const currentChapterVerses = chronologicalData.verses.filter(
          (v: any) => v.book === firstChapter.book && v.chapter === firstChapter.chapter
        );

        if (currentChapterVerses.length > 0) {
          // Get the lowest chrono_index for this chapter
          const firstVerseIndex = Math.min(...currentChapterVerses.map((v: any) => v.chrono_index));
          
          // Find previous chapter before this index
          const prevChapterData = chronologicalData.verses.slice().reverse().find(
            (v: any) => v.chrono_index < firstVerseIndex &&
                        (v.book !== firstChapter.book || v.chapter !== firstChapter.chapter)
          );

          if (prevChapterData) {
            prevBook = prevChapterData.book;
            prevChapter = prevChapterData.chapter;
          } else {
            // Loop to end
            const lastVerse = chronologicalData.verses[chronologicalData.verses.length - 1];
            prevBook = lastVerse.book;
            prevChapter = lastVerse.chapter;
          }
        }
      } else {
        if (prevChapter < 1) {
          const currentBookIndex = BIBLE_BOOKS.findIndex(b => b.name === firstChapter.book);
          if (currentBookIndex > 0) {
            const prevBookInfo = BIBLE_BOOKS[currentBookIndex - 1];
            prevBook = prevBookInfo.name;
            prevChapter = prevBookInfo.chapters;
          } else {
            // Loop to Revelation 22
            const lastBook = BIBLE_BOOKS[BIBLE_BOOKS.length - 1];
            prevBook = lastBook.name;
            prevChapter = lastBook.chapters;
          }
        }
      }

      // Check if already loaded
      if (chapters.some(c => c.book === prevBook && c.chapter === prevChapter)) {
        isLoadingPrevChapter = false;
        return;
      }

      const prevVerses = await textStore.getChapter(currentTranslation, prevBook, prevChapter);
      
      if (prevVerses.length > 0) {
        const processedVerses = prevVerses.map((v) => {
          const { heading, textWithoutHeading } = extractHeading(v.text);
          return {
            verse: v.verse,
            text: textWithoutHeading,
            heading: heading || v.heading,
          };
        });

        // Remember scroll position
        const oldScrollHeight = readerElement.scrollHeight;

        // Prepend without triggering navigation update
        chapters = [{ book: prevBook, chapter: prevChapter, verses: processedVerses }, ...chapters];

        // Restore scroll position adjusted for new content
        requestAnimationFrame(() => {
          if (readerElement) {
            const newScrollHeight = readerElement.scrollHeight;
            readerElement.scrollTop = readerElement.scrollTop + (newScrollHeight - oldScrollHeight);
          }
        });
      }
    } catch (err) {
      console.error('Error loading previous chapter:', err);
    } finally {
      isLoadingPrevChapter = false;
    }
  }

  onMount(() => {
    textStore = new IndexedDBTextStore();

    (async () => {
      await loadAvailableTranslations();
      await loadChapter(currentTranslation, currentBook, currentChapter);
      await loadChronologicalPack();
    })();

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
      stopScrollDetection();
    };
  });
</script>

<div class="bible-reader" bind:this={readerElement}>
  <NavigationBar {windowId} visible={showNavBar} />

  <div class="text-container">
    {#if loading && chapters.length === 0}
      <div class="loading">Loading...</div>
    {:else if error}
      <div class="error">{error}</div>
      <p class="error-hint">
        To load Bible text, import a pack using the classic version at
        <a href="/apps/pwa/" target="_blank">localhost:5173</a>
      </p>
    {:else if chapters.length === 0}
      <div class="no-content">No verses found for this chapter.</div>
    {:else}
      {#each chapters as chapterData}
        <div class="chapter-section">
          <div class="chapter-header">
            <h1>{chapterData.book} {chapterData.chapter}</h1>
          </div>
          <div class="verses">
            {#each chapterData.verses as { verse, text, heading }}
              {#if heading}
                <div class="section-heading">{heading}</div>
              {/if}
              <div class="verse">
                <span class="verse-number">{verse}</span>
                <span class="verse-text">{@html renderVerseHtml(text)}</span>
              </div>
            {/each}
          </div>
        </div>
      {/each}
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
    max-width: 100%;
    width: 100%;
    margin: 0 auto;
    padding: 40px 20px 100px;
    flex: 1;
    box-sizing: border-box;
  }

  .chapter-section {
    margin-bottom: 3rem;
  }

  .chapter-section:first-child .chapter-header {
    margin-top: 0;
  }

  .chapter-header {
    margin: 3rem 0 2rem 0;
    padding-top: 2rem;
    border-top: 2px solid #444;
    text-align: center;
  }

  .chapter-section:first-child .chapter-header {
    border-top: none;
    padding-top: 0;
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
