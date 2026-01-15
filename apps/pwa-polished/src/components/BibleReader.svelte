<script lang="ts">
  import { onMount } from "svelte";
  import NavigationBar from "./NavigationBar.svelte";
  import SelectionToast from "./SelectionToast.svelte";
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
    verses: Array<{ verse: number; text: string; heading?: string | null }>;
  }> = [];
  let loading = true;
  let error = "";
  let chronologicalData: any = null;
  let isLoadingNextChapter = false;
  let isLoadingPrevChapter = false;
  let scrollCheckInterval: number | null = null;
  let lastNavigationKey = "";
  let lastScrollTop = 0;
  let showNavBar = true;

  // Text selection state
  let showToast = false;
  let toastX = 0;
  let toastY = 0;
  let selectedText = "";
  let selectionMode: "word" | "verse" = "word";
  let selectionRange: Range | null = null;
  let longPressTimer: number | null = null;
  let highlightedElements: HTMLElement[] = [];
  let isDragging = false;
  let dragEdge: "left" | "right" | null = null;
  let hoveredWordElement: HTMLElement | null = null;
  let justOpenedToast = false;
  let touchStartPos: { x: number; y: number } | null = null;
  let hasMoved = false;
  let repeatsActive = false;
  let repeatsWord = "";

  // Use per-window state if windowId provided, otherwise use global state
  $: windowState = windowId
    ? $windowStore.find((w) => w.id === windowId)
    : null;
  $: currentBook = windowState?.contentState?.book ?? $navigationStore.book;
  $: currentChapter =
    windowState?.contentState?.chapter ?? $navigationStore.chapter;
  $: currentTranslation =
    windowState?.contentState?.translation ?? $navigationStore.translation;
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
    clearRepeats(); // Clear repeats when loading a new chapter
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
        "hebrew.sqlite",
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
      const response = await fetch("/packs/chronological-v1.json");
      if (response.ok) {
        chronologicalData = await response.json();
        console.log(
          `Loaded chronological pack: ${chronologicalData.verse_count} verses`
        );
      }
    } catch (e) {
      console.warn("Chronological pack not available:", e);
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

      console.log(
        "loadNextChapter - isChronologicalMode:",
        isChronologicalMode
      );
      console.log(
        "loadNextChapter - chronologicalData loaded:",
        !!chronologicalData
      );
      console.log(
        "loadNextChapter - current:",
        lastChapter.book,
        lastChapter.chapter
      );

      if (isChronologicalMode && chronologicalData) {
        console.log("Using chronological order...");
        // Find the LAST verse of the current chapter in chronological order
        const currentChapterVerses = chronologicalData.verses.filter(
          (v: any) =>
            v.book === lastChapter.book && v.chapter === lastChapter.chapter
        );

        console.log(
          "Found",
          currentChapterVerses.length,
          "verses for current chapter"
        );

        if (currentChapterVerses.length > 0) {
          // Get the highest chrono_index for this chapter
          const lastVerseIndex = Math.max(
            ...currentChapterVerses.map((v: any) => v.chrono_index)
          );

          console.log("Last verse index of current chapter:", lastVerseIndex);

          // Find the next chapter after this index
          const nextChapterData = chronologicalData.verses.find(
            (v: any) =>
              v.chrono_index > lastVerseIndex &&
              (v.book !== lastChapter.book || v.chapter !== lastChapter.chapter)
          );

          if (nextChapterData) {
            nextBook = nextChapterData.book;
            nextChapter = nextChapterData.chapter;
            console.log("Next chapter in chrono order:", nextBook, nextChapter);
          } else {
            // Loop back to beginning
            nextBook = chronologicalData.verses[0].book;
            nextChapter = chronologicalData.verses[0].chapter;
            console.log("Looping to start:", nextBook, nextChapter);
          }
        }
      } else {
        console.log("Using canonical order...");
        const bookInfo = BIBLE_BOOKS.find((b) => b.name === lastChapter.book);
        if (bookInfo && nextChapter > bookInfo.chapters) {
          const currentBookIndex = BIBLE_BOOKS.findIndex(
            (b) => b.name === lastChapter.book
          );
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
      if (
        chapters.some((c) => c.book === nextBook && c.chapter === nextChapter)
      ) {
        isLoadingNextChapter = false;
        return;
      }

      const nextVerses = await textStore.getChapter(
        currentTranslation,
        nextBook,
        nextChapter
      );

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
        chapters = [
          ...chapters,
          { book: nextBook, chapter: nextChapter, verses: processedVerses },
        ];
      }
    } catch (err) {
      console.error("Error loading next chapter:", err);
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
          (v: any) =>
            v.book === firstChapter.book && v.chapter === firstChapter.chapter
        );

        if (currentChapterVerses.length > 0) {
          // Get the lowest chrono_index for this chapter
          const firstVerseIndex = Math.min(
            ...currentChapterVerses.map((v: any) => v.chrono_index)
          );

          // Find previous chapter before this index
          const prevChapterData = chronologicalData.verses
            .slice()
            .reverse()
            .find(
              (v: any) =>
                v.chrono_index < firstVerseIndex &&
                (v.book !== firstChapter.book ||
                  v.chapter !== firstChapter.chapter)
            );

          if (prevChapterData) {
            prevBook = prevChapterData.book;
            prevChapter = prevChapterData.chapter;
          } else {
            // Loop to end
            const lastVerse =
              chronologicalData.verses[chronologicalData.verses.length - 1];
            prevBook = lastVerse.book;
            prevChapter = lastVerse.chapter;
          }
        }
      } else {
        if (prevChapter < 1) {
          const currentBookIndex = BIBLE_BOOKS.findIndex(
            (b) => b.name === firstChapter.book
          );
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
      if (
        chapters.some((c) => c.book === prevBook && c.chapter === prevChapter)
      ) {
        isLoadingPrevChapter = false;
        return;
      }

      const prevVerses = await textStore.getChapter(
        currentTranslation,
        prevBook,
        prevChapter
      );

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
        chapters = [
          { book: prevBook, chapter: prevChapter, verses: processedVerses },
          ...chapters,
        ];

        // Restore scroll position adjusted for new content
        requestAnimationFrame(() => {
          if (readerElement) {
            const newScrollHeight = readerElement.scrollHeight;
            readerElement.scrollTop =
              readerElement.scrollTop + (newScrollHeight - oldScrollHeight);
          }
        });
      }
    } catch (err) {
      console.error("Error loading previous chapter:", err);
    } finally {
      isLoadingPrevChapter = false;
    }
  }

  // Text selection handlers
  function handleTextInteraction(e: MouseEvent | TouchEvent) {
    const target = e.target as HTMLElement;

    // Ignore if clicking on note, navigation bar, or any button/dropdown
    if (target.closest(".inline-note")) return;
    if (target.closest(".navigation-bar")) return;
    if (target.closest("button")) return;
    if (target.closest(".nav-dropdown")) return;
    if (target.closest(".toast")) return;

    // Start long press timer for touch
    if (e.type === "touchstart") {
      // DO NOT preventDefault here - allow native scrolling
      const touch = (e as TouchEvent).touches[0];
      touchStartPos = { x: touch.clientX, y: touch.clientY };
      hasMoved = false;

      longPressTimer = window.setTimeout(() => {
        // Only trigger selection if user hasn't moved (scrolled)
        if (!hasMoved && touchStartPos) {
          handleTextSelection(touchStartPos.x, touchStartPos.y, target);
        }
      }, 500); // Reduced from 900ms to 500ms for better UX
    }
  }

  function handleTouchMove(e: TouchEvent) {
    // Track if user is scrolling
    if (touchStartPos && !hasMoved) {
      const touch = e.touches[0];
      const deltaX = Math.abs(touch.clientX - touchStartPos.x);
      const deltaY = Math.abs(touch.clientY - touchStartPos.y);

      // If moved more than 10px, consider it scrolling
      if (deltaX > 10 || deltaY > 10) {
        hasMoved = true;
        // Cancel long press timer since user is scrolling
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      }
    }
  }

  function handleTouchEnd(e: TouchEvent) {
    // Cancel long press if finger lifted before timer fires
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    touchStartPos = null;
    hasMoved = false;
  }

  function handleMouseMove(e: MouseEvent) {
    const target = e.target as HTMLElement;

    // Clear any previous hover
    if (hoveredWordElement) {
      hoveredWordElement.classList.remove("word-hover");
      hoveredWordElement = null;
    }

    // Don't hover when dragging or when toast is open
    if (isDragging || showToast) return;

    // Ignore special elements
    if (target.closest(".inline-note")) return;
    if (target.closest(".toast")) return;
    if (target.closest(".navigation-bar")) return;
    if (target.closest("button")) return;

    // Only handle if hovering over verse text
    const verseText = target.closest(".verse-text");
    if (!verseText) return;

    // Get the word at cursor position
    const range = document.caretRangeFromPoint(e.clientX, e.clientY);
    if (!range) return;

    let textNode = range.startContainer;
    if (textNode.nodeType !== Node.TEXT_NODE) {
      const walker = document.createTreeWalker(
        textNode,
        NodeFilter.SHOW_TEXT,
        null
      );
      const firstText = walker.nextNode();
      if (firstText) textNode = firstText;
      else return;
    }

    const text = textNode.textContent || "";
    const offset = range.startOffset;
    const wordBounds = getWordBounds(text, offset);

    if (wordBounds) {
      const word = text.substring(wordBounds.start, wordBounds.end).trim();
      if (word.length > 0) {
        // Create temporary highlight for hover
        try {
          const hoverRange = document.createRange();
          hoverRange.setStart(textNode, wordBounds.start);
          hoverRange.setEnd(textNode, wordBounds.end);

          // Wrap the word temporarily
          const span = document.createElement("span");
          span.className = "word-hover";
          const contents = hoverRange.extractContents();
          span.appendChild(contents);
          hoverRange.insertNode(span);
          hoveredWordElement = span;
        } catch (err) {
          // Silently fail if can't create hover
        }
      }
    }
  }

  function handleTextClick(e: MouseEvent) {
    const target = e.target as HTMLElement;

    // Ignore if clicking on note
    if (target.closest(".inline-note")) return;

    // Ignore if clicking on toast or drag handles
    if (target.closest(".toast") || target.closest(".drag-handle")) return;

    // Only handle if clicking inside verse text
    if (!target.closest(".verse-text")) return;

    // Clear hover highlight before selecting (unwrap the span)
    if (hoveredWordElement) {
      const parent = hoveredWordElement.parentNode;
      while (hoveredWordElement.firstChild) {
        parent?.insertBefore(hoveredWordElement.firstChild, hoveredWordElement);
      }
      parent?.removeChild(hoveredWordElement);
      hoveredWordElement = null;

      // Normalize the parent to merge adjacent text nodes
      parent?.normalize();
    }

    // After unwrapping, get the element at the click position
    const elementAtPoint = document.elementFromPoint(
      e.clientX,
      e.clientY
    ) as HTMLElement;

    // Handle click - mouse clicks work immediately
    handleTextSelection(e.clientX, e.clientY, elementAtPoint || target);
  }

  function handleTextSelection(x: number, y: number, target: HTMLElement) {
    // Find the verse text container
    const verseText = target.closest(".verse-text");
    if (!verseText) return;

    // Get selection from browser (works better with HTML content)
    const selection = window.getSelection();
    if (!selection) return;

    // Clear any existing selection
    selection.removeAllRanges();

    // Use document.caretRangeFromPoint to get the exact position
    const range = document.caretRangeFromPoint(x, y);
    if (!range) return;

    // Get the text node at click position
    let textNode = range.startContainer;

    // If we clicked on an element, try to get its text content
    if (textNode.nodeType !== Node.TEXT_NODE) {
      // Try to find a text node child
      const walker = document.createTreeWalker(
        textNode,
        NodeFilter.SHOW_TEXT,
        null
      );
      const firstText = walker.nextNode();
      if (firstText) {
        textNode = firstText;
      } else {
        return; // No text to select
      }
    }

    const text = textNode.textContent || "";
    if (!text.trim()) return;

    const offset = range.startOffset;
    const wordBounds = getWordBounds(text, offset);

    if (wordBounds) {
      selectedText = text.substring(wordBounds.start, wordBounds.end).trim();

      if (!selectedText) return;

      // Create selection range
      try {
        const newRange = document.createRange();
        newRange.setStart(textNode, wordBounds.start);
        newRange.setEnd(textNode, wordBounds.end);
        selectionRange = newRange;

        // Highlight the selection
        highlightSelection(newRange, selectionMode);

        // Show toast
        showToastAt(x, y);
      } catch (err) {
        console.error("Error creating selection range:", err);
        // Silently fail - just don't show selection
      }
    }
  }

  function getClickOffset(element: HTMLElement, x: number): number {
    const range = document.caretRangeFromPoint(x, 0);
    if (range && range.startContainer === element.firstChild) {
      return range.startOffset;
    }
    return 0;
  }

  function getWordBounds(
    text: string,
    offset: number
  ): { start: number; end: number } | null {
    // Find word boundaries
    let start = offset;
    let end = offset;

    // Expand left
    while (start > 0 && /\w/.test(text[start - 1])) {
      start--;
    }

    // Expand right
    while (end < text.length && /\w/.test(text[end])) {
      end++;
    }

    if (start < end) {
      return { start, end };
    }

    return null;
  }

  function highlightSelection(range: Range, mode: "word" | "verse") {
    // Clear previous highlights
    clearHighlights();

    if (mode === "word") {
      // Use browser's native selection for highlighting (non-invasive)
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range.cloneRange());
      }

      // Create floating drag handles positioned absolutely
      const rects = range.getClientRects();
      if (rects.length > 0) {
        const firstRect = rects[0];
        const lastRect = rects[rects.length - 1];

        // Get the scrollable container offset
        const readerRect = readerElement?.getBoundingClientRect();
        const scrollTop = readerElement?.scrollTop || 0;

        // Left handle at start of selection
        const leftHandle = document.createElement("div");
        leftHandle.className = "drag-handle-float left";
        leftHandle.style.position = "absolute";
        leftHandle.style.left = `${firstRect.left - (readerRect?.left || 0)}px`;
        leftHandle.style.top = `${firstRect.top - (readerRect?.top || 0) + scrollTop}px`;
        leftHandle.style.height = `${firstRect.height}px`;
        leftHandle.addEventListener("mousedown", (e) => startDrag(e, "left"));
        leftHandle.addEventListener(
          "touchstart",
          (e) => startDragTouch(e, "left"),
          { passive: false }
        );

        // Right handle at end of selection
        const rightHandle = document.createElement("div");
        rightHandle.className = "drag-handle-float right";
        rightHandle.style.position = "absolute";
        rightHandle.style.left = `${lastRect.right - (readerRect?.left || 0)}px`;
        rightHandle.style.top = `${lastRect.top - (readerRect?.top || 0) + scrollTop}px`;
        rightHandle.style.height = `${lastRect.height}px`;
        rightHandle.addEventListener("mousedown", (e) => startDrag(e, "right"));
        rightHandle.addEventListener(
          "touchstart",
          (e) => startDragTouch(e, "right"),
          { passive: false }
        );

        // Append to text container
        const textContainer = readerElement?.querySelector(".text-container");
        if (textContainer) {
          textContainer.appendChild(leftHandle);
          textContainer.appendChild(rightHandle);
          highlightedElements.push(leftHandle, rightHandle);
        }
      }
    } else {
      // Highlight the entire verse
      const verseEl = range.startContainer.parentElement?.closest(".verse");
      if (verseEl) {
        verseEl.classList.add("verse-highlighted");
        highlightedElements.push(verseEl as HTMLElement);
      }
    }
  }

  function clearHighlights() {
    // Clear browser selection
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
    }

    // Remove any DOM elements we added
    highlightedElements.forEach((el) => {
      if (el.classList.contains("verse-highlighted")) {
        el.classList.remove("verse-highlighted");
      } else if (!el.classList.contains("repeat-highlight")) {
        // Don't remove repeat highlights here - they have their own clear function
        el.remove();
      }
    });
    highlightedElements = highlightedElements.filter((el) =>
      el.classList.contains("repeat-highlight")
    );
  }

  function startDrag(e: MouseEvent, edge: "left" | "right") {
    e.preventDefault();
    e.stopPropagation();
    isDragging = true;
    dragEdge = edge;

    // Prevent toast from closing during drag
    document.addEventListener("mousemove", handleDrag, true);
    document.addEventListener("mouseup", stopDrag, true);
  }

  function handleDrag(e: MouseEvent) {
    if (!isDragging || !dragEdge || !selectionRange) return;

    // Get the position of the mouse
    const range = document.caretRangeFromPoint(e.clientX, e.clientY);
    if (!range) return;

    try {
      const newRange = selectionRange.cloneRange();

      if (dragEdge === "left") {
        // Expand/contract from the left
        if (range.startContainer.nodeType === Node.TEXT_NODE) {
          newRange.setStart(range.startContainer, range.startOffset);
        }
      } else {
        // Expand/contract from the right
        if (range.startContainer.nodeType === Node.TEXT_NODE) {
          newRange.setEnd(range.startContainer, range.startOffset);
        }
      }

      // Update selected text
      selectedText = newRange.toString().trim();

      if (selectedText) {
        // Clear and re-highlight
        selectionRange = newRange;
        highlightSelection(newRange, selectionMode);
      }
    } catch (err) {
      console.error("Error during drag:", err);
    }
  }

  function stopDrag() {
    isDragging = false;
    dragEdge = null;
    document.removeEventListener("mousemove", handleDrag, true);
    document.removeEventListener("touchmove", handleDragTouch, true);
    document.removeEventListener("mouseup", stopDrag, true);
    document.removeEventListener("touchend", stopDrag, true);
  }

  function startDragTouch(e: TouchEvent, edge: "left" | "right") {
    e.preventDefault();
    e.stopPropagation();

    // Cancel any long press
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }

    isDragging = true;
    dragEdge = edge;

    // Prevent toast from closing during drag
    document.addEventListener("touchmove", handleDragTouch, {
      passive: false,
      capture: true,
    });
    document.addEventListener("touchend", stopDrag, { capture: true });
  }

  function handleDragTouch(e: TouchEvent) {
    if (!isDragging || !dragEdge || !selectionRange) return;
    e.preventDefault();

    const touch = e.touches[0];
    if (!touch) return;

    // Get the position of the touch
    const range = document.caretRangeFromPoint(touch.clientX, touch.clientY);
    if (!range) return;

    try {
      const newRange = selectionRange.cloneRange();

      if (dragEdge === "left") {
        // Expand/contract from the left
        if (range.startContainer.nodeType === Node.TEXT_NODE) {
          newRange.setStart(range.startContainer, range.startOffset);
        }
      } else {
        // Expand/contract from the right
        if (range.startContainer.nodeType === Node.TEXT_NODE) {
          newRange.setEnd(range.startContainer, range.startOffset);
        }
      }

      // Update the selection text
      selectedText = newRange.toString().trim();

      if (selectedText) {
        selectionRange = newRange;
        highlightSelection(newRange, selectionMode);
      }
    } catch (err) {
      console.error("Error during touch drag:", err);
    }
  }

  function showToastAt(x: number, y: number) {
    // Clear any hover highlight
    if (hoveredWordElement) {
      hoveredWordElement.classList.remove("word-hover");
      hoveredWordElement = null;
    }

    // Position toast above the selection to avoid covering the word
    const toastHeight = 90; // Smaller toast now
    const toastWidth = 200;

    // Position above and centered on click
    toastX = Math.min(
      Math.max(x - toastWidth / 2, 10),
      window.innerWidth - toastWidth - 10
    );
    toastY = Math.max(y - toastHeight - 15, 10); // 15px above selection (5px higher)

    // If too close to top, position below instead
    if (toastY < 70) {
      toastY = y + 30;
    }

    showToast = true;
    justOpenedToast = true;

    // Allow clickOutside to work after a short delay
    setTimeout(() => {
      justOpenedToast = false;
    }, 100);
  }

  function toggleRepeats(word: string) {
    // Normalize the word (lowercase, remove punctuation)
    const normalizedWord = word
      .toLowerCase()
      .replace(/[^\w\s]/g, "")
      .trim();

    // If repeats is already active for this word, turn it off
    if (repeatsActive && repeatsWord === normalizedWord) {
      clearRepeats();
      return;
    }

    // Otherwise, activate repeats for this word
    clearRepeats(); // Clear any previous highlights
    repeatsActive = true;
    repeatsWord = normalizedWord;

    // Find and highlight all occurrences of this word in the current chapter
    const textContainer = readerElement?.querySelector(".text-container");
    if (!textContainer) return;

    // Get all verse text elements in the current chapter
    const verseTexts = textContainer.querySelectorAll(".verse-text");

    verseTexts.forEach((verseText) => {
      const walker = document.createTreeWalker(
        verseText,
        NodeFilter.SHOW_TEXT,
        null
      );

      const textNodes: Text[] = [];
      let node;
      while ((node = walker.nextNode())) {
        textNodes.push(node as Text);
      }

      textNodes.forEach((textNode) => {
        const text = textNode.textContent || "";
        const words = text.split(/(\s+)/); // Split but keep whitespace

        let hasMatch = false;
        words.forEach((w) => {
          const normalizedW = w
            .toLowerCase()
            .replace(/[^\w\s]/g, "")
            .trim();
          if (normalizedW === normalizedWord && normalizedW.length > 0) {
            hasMatch = true;
          }
        });

        if (hasMatch) {
          // Replace this text node with highlighted spans
          const fragment = document.createDocumentFragment();
          words.forEach((w) => {
            const normalizedW = w
              .toLowerCase()
              .replace(/[^\w\s]/g, "")
              .trim();
            if (normalizedW === normalizedWord && normalizedW.length > 0) {
              const span = document.createElement("span");
              span.className = "repeat-highlight";
              span.textContent = w;
              fragment.appendChild(span);
              highlightedElements.push(span);
            } else {
              fragment.appendChild(document.createTextNode(w));
            }
          });

          textNode.parentNode?.replaceChild(fragment, textNode);
        }
      });
    });
  }

  function clearRepeats() {
    if (!repeatsActive) return;

    repeatsActive = false;
    repeatsWord = "";

    // Remove repeat highlights
    const highlights = document.querySelectorAll(".repeat-highlight");
    highlights.forEach((highlight) => {
      const parent = highlight.parentNode;
      if (parent) {
        parent.replaceChild(
          document.createTextNode(highlight.textContent || ""),
          highlight
        );
        parent.normalize(); // Merge adjacent text nodes
      }
    });

    highlightedElements = highlightedElements.filter(
      (el) => !el.classList.contains("repeat-highlight")
    );
  }

  function handleToastAction(event: CustomEvent) {
    const { action, text } = event.detail;
    console.log(`Action: ${action} on "${text}"`);

    // TODO: Wire up actual actions
    switch (action) {
      case "dissect":
        alert(`Dissect: ${text}\n\n(Word study coming soon)`);
        break;
      case "search":
        alert(`Search for: ${text}\n\n(Search coming soon)`);
        break;
      case "map":
        alert(`Show on map: ${text}\n\n(Map integration coming soon)`);
        break;
      case "highlight":
        alert(`Highlight: ${text}\n\n(Highlights coming soon)`);
        break;
      case "save":
        alert(`Save verse: ${text}\n\n(Saved verses coming soon)`);
        break;
      case "repeats":
        toggleRepeats(text);
        break;
    }

    // Close toast after action
    showToast = false;
    clearHighlights();
  }

  function handleModeChange(event: CustomEvent) {
    selectionMode = event.detail;
    if (selectionRange) {
      highlightSelection(selectionRange, selectionMode);
    }
  }

  function handleClickOutside(e: MouseEvent) {
    const target = e.target as HTMLElement;

    // Don't close if dragging
    if (isDragging) return;

    // Don't close if toast was just opened
    if (justOpenedToast) return;

    if (!target.closest(".selection-highlight") && !target.closest(".toast")) {
      showToast = false;
      clearHighlights();
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

    // Add text selection listeners
    readerElement?.addEventListener("mousemove", handleMouseMove);
    readerElement?.addEventListener("click", handleTextClick);
    readerElement?.addEventListener("touchstart", handleTextInteraction);
    readerElement?.addEventListener("touchmove", handleTouchMove);
    readerElement?.addEventListener("touchend", handleTouchEnd);
    readerElement?.addEventListener("touchcancel", handleTouchEnd);
    document.addEventListener("click", handleClickOutside);

    return () => {
      readerElement?.removeEventListener("click", handleNoteClick, true);
      readerElement?.removeEventListener("mousemove", handleMouseMove);
      readerElement?.removeEventListener("click", handleTextClick);
      readerElement?.removeEventListener("touchstart", handleTextInteraction);
      readerElement?.removeEventListener("touchmove", handleTouchMove);
      readerElement?.removeEventListener("touchend", handleTouchEnd);
      readerElement?.removeEventListener("touchcancel", handleTouchEnd);
      document.removeEventListener("click", handleClickOutside);
      stopScrollDetection();
      if (longPressTimer) clearTimeout(longPressTimer);

      // Cleanup hover element
      if (hoveredWordElement) {
        const parent = hoveredWordElement.parentNode;
        while (hoveredWordElement.firstChild) {
          parent?.insertBefore(
            hoveredWordElement.firstChild,
            hoveredWordElement
          );
        }
        parent?.removeChild(hoveredWordElement);
        hoveredWordElement = null;
      }
    };
  });
</script>

{#if showToast}
  <SelectionToast
    x={toastX}
    y={toastY}
    {selectedText}
    isPlace={false}
    mode={selectionMode}
    on:action={handleToastAction}
    on:modeChange={handleModeChange}
  />
{/if}

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
    cursor: text;
  }

  /* Remove verse-level hover - we'll handle word-level in JS */
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

  /* Text selection highlights */
  :global(.word-hover) {
    background: rgba(102, 126, 234, 0.15);
    border-radius: 2px;
    padding: 0 2px;
    margin: 0 -2px;
    cursor: pointer;
    transition: background 0.1s ease;
  }

  :global(.selection-highlight) {
    background: rgba(102, 126, 234, 0.3);
    border-radius: 2px;
    position: relative;
    padding: 0 2px;
    margin: 0 -2px;
  }

  :global(.verse-highlighted) {
    background: rgba(102, 126, 234, 0.15);
    border-left: 3px solid #667eea;
    padding-left: 8px;
    margin-left: -8px;
    border-radius: 2px;
  }

  /* Floating drag handles for text selection */
  :global(.drag-handle-float) {
    position: absolute;
    width: 3px;
    background: #667eea;
    border-radius: 2px;
    cursor: ew-resize;
    z-index: 100;
    opacity: 0.8;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
    touch-action: none;
    pointer-events: auto;
  }

  :global(.drag-handle-float.left) {
    margin-left: -3px;
  }

  :global(.drag-handle-float.right) {
    margin-left: 0px;
  }

  :global(.drag-handle-float:hover) {
    background: #5568d3;
    opacity: 1;
    width: 4px;
  }

  :global(.drag-handle-float:active) {
    background: #4456c0;
    width: 4px;
  }

  /* Custom selection styling */
  .text-container ::selection {
    background: rgba(102, 126, 234, 0.3);
  }

  /* Repeat highlights */
  :global(.repeat-highlight) {
    background: rgba(255, 193, 7, 0.35);
    border-radius: 3px;
    padding: 2px 4px;
    margin: 0 1px;
    box-shadow: 0 0 0 1px rgba(255, 193, 7, 0.2);
    font-weight: 500;
  }
</style>
