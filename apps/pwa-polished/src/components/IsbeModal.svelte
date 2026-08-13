<script lang="ts">
  import { get } from "svelte/store";
  import IsbeContent from "./IsbeContent.svelte";
  import { isbeModalStore, type IsbeModalState, type IsbeTab } from "../stores/isbeModalStore";
  import { isbeReturnStore } from "../stores/isbeReturnStore";
  import { windowStore } from "../lib/stores/windowStore";

  // The centered card. Everything inside it — tabs, article, verses, map — is
  // IsbeContent, which also runs docked in a window; this file is only the
  // shell around it and the handover between the two.
  $: state = $isbeModalStore;
  $: isOpen = state.isOpen;

  // The nav bar's back arrow reopens the modal where you left it and leaves the
  // detail in isbeReturnStore for us. Consume it once per open and hand it down
  // as props: it's a one-shot breadcrumb, so reading it twice would restore a
  // stale view over a later article.
  let seenState: IsbeModalState | null = null;
  let initialExpanded: Record<string, boolean> = {};
  let initialExpandedBooks: string[] = [];
  let initialVisited: string[] = [];
  let initialScrollTop = 0;
  $: if (state !== seenState) {
    seenState = state;
    initialExpanded = {};
    initialExpandedBooks = [];
    initialVisited = [];
    initialScrollTop = 0;
    if (state.isOpen && state.tab) {
      const restore = get(isbeReturnStore);
      isbeReturnStore.set(null);
      if (restore) {
        initialExpanded = { ...restore.expandedSections };
        initialExpandedBooks = [...restore.expandedBooks];
        initialVisited = [...restore.visited];
        initialScrollTop = restore.scrollTop;
      }
    }
  }

  /** Hand the article over to a docked window, exactly as it stands. Same edge
   *  convention as the journal and power search: beside the text on a wide
   *  screen, under it on a phone. */
  function popOut(snap: {
    primaryName: string;
    tab: IsbeTab;
    expanded: Record<string, boolean>;
    expandedBooks: string[];
    visited: string[];
    scrollTop: number;
    trail: { entryId: number | null; placeId: string | null; name: string }[];
  }) {
    const edge =
      globalThis.window.innerHeight > globalThis.window.innerWidth ? "bottom" : "right";
    const id = windowStore.createWindow(edge, 50);
    // At the six-window cap. Leave the modal up rather than closing it onto nothing.
    if (!id) return;
    windowStore.setWindowContent(id, "isbe", {
      kind: state.kind,
      entryId: state.entryId,
      placeId: state.placeId,
      primaryName: snap.primaryName || state.primaryName,
      tab: snap.tab,
      expanded: snap.expanded,
      expandedBooks: snap.expandedBooks,
      visited: snap.visited,
      scrollTop: snap.scrollTop,
      trail: snap.trail,
    });
    isbeModalStore.close();
  }

  function close() {
    isbeModalStore.close();
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) close();
  }

  // Escape walks the article back out — a crumb, then the contents — and only
  // closes the card once there is nowhere left to go. Matches the header's
  // back arrow rather than fighting it.
  let content: IsbeContent;

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== "Escape" || !isOpen) return;
    if (content?.handleBack()) return;
    close();
  }
</script>

<svelte:window on:keydown={onKeydown} />

{#if isOpen}
  <div class="modal-backdrop" on:click={handleBackdropClick} role="presentation">
    <div class="modal-container">
      <IsbeContent
        bind:this={content}
        kind={state.kind}
        entryId={state.entryId}
        placeId={state.placeId}
        primaryName={state.primaryName}
        initialTab={state.tab ?? null}
        {initialExpanded}
        {initialExpandedBooks}
        {initialVisited}
        {initialScrollTop}
        onClose={close}
        onPopOut={popOut}
      />
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10001;
    padding: 16px;
    backdrop-filter: blur(3px);
    animation: fadeIn 0.2s ease-out;
  }
  /* The card's own background and text color come from IsbeContent, which has
     to paint them in a docked window too. */
  .modal-container {
    border-radius: 10px;
    width: min(720px, 100%);
    max-height: min(86vh, 900px);
    display: flex;
    flex-direction: column;
    box-shadow: 0 12px 48px rgba(0, 0, 0, 0.5);
    overflow: hidden;
    animation: slideUp 0.3s ease-out;
  }
  /* Same open motion as LexicalModal and NavesModal — the three lookup cards
     bridge to each other, so they have to arrive the same way. */
  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  @keyframes slideUp {
    from {
      transform: translateY(20px);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }
</style>
