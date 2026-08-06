<script lang="ts">
  import NavesContent from "./NavesContent.svelte";
  import { navesModalStore, type NavesTab } from "../stores/navesModalStore";
  import { windowStore } from "../lib/stores/windowStore";

  // The centered card. Everything inside it — the outline, the verses — is
  // NavesContent, which also runs docked in a window; this file is only the
  // shell around it and the handover between the two.
  $: state = $navesModalStore;
  $: isOpen = state.isOpen;

  /** Hand the topic over to a docked window, exactly as it stands. Same edge
   *  convention as the encyclopedia and the journal. */
  function popOut(snap: {
    topicId: number;
    primaryName: string;
    tab: NavesTab;
    expanded: Record<string, boolean>;
    expandedBooks: string[];
    scrollTop: number;
    trail: { topicId: number; name: string }[];
  }) {
    const edge =
      globalThis.window.innerHeight > globalThis.window.innerWidth ? "bottom" : "right";
    const id = windowStore.createWindow(edge, 50);
    // At the six-window cap. Leave the modal up rather than closing onto nothing.
    if (!id) return;
    windowStore.setWindowContent(id, "naves", {
      topicId: snap.topicId,
      primaryName: snap.primaryName,
      tab: snap.tab,
      expanded: snap.expanded,
      expandedBooks: snap.expandedBooks,
      scrollTop: snap.scrollTop,
      trail: snap.trail,
    });
    navesModalStore.close();
  }

  function close() {
    navesModalStore.close();
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) close();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && isOpen) close();
  }
</script>

<svelte:window on:keydown={onKeydown} />

{#if isOpen}
  <div class="modal-backdrop" on:click={handleBackdropClick} role="presentation">
    <div class="modal-container">
      <NavesContent
        topicId={state.topicId}
        primaryName={state.primaryName}
        initialTab={state.tab ?? null}
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
  }
  /* The card's own background and text color come from NavesContent, which has
     to paint them in a docked window too. */
  .modal-container {
    border-radius: 10px;
    width: min(720px, 100%);
    max-height: min(86vh, 900px);
    display: flex;
    flex-direction: column;
    box-shadow: 0 12px 48px rgba(0, 0, 0, 0.5);
    overflow: hidden;
  }
</style>
