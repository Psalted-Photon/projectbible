<script lang="ts">
  import PersonContent from "./PersonContent.svelte";
  import { personModalStore } from "../stores/personModalStore";
  import { windowStore } from "../lib/stores/windowStore";

  // The centered card. Everything inside it is PersonContent, which also runs
  // docked in a window and inside the word-study card; this file is only the
  // shell around it and the handover between the two. Mirrors NavesModal.
  $: state = $personModalStore;
  $: isOpen = state.isOpen;

  /** Hand the bio over to a docked window. Same edge convention as the
   *  encyclopedia and topical cards. */
  function popOut(snap: { personId: string; primaryName: string }) {
    const edge =
      globalThis.window.innerHeight > globalThis.window.innerWidth ? "bottom" : "right";
    const id = windowStore.createWindow(edge, 50);
    // At the six-window cap. Leave the modal up rather than closing onto nothing.
    if (!id) return;
    windowStore.setWindowContent(id, "person", {
      personId: snap.personId,
      primaryName: snap.primaryName,
    });
    personModalStore.close();
  }

  function close() {
    personModalStore.close();
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) close();
  }

  // Escape walks the bio back out — a crumb, then the index — and only closes
  // the card once there is nowhere left to go. Matches IsbeModal and NavesModal.
  let content: PersonContent;

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
      <PersonContent
        bind:this={content}
        lookup={state.lookup}
        personId={state.personId}
        clickedWord={state.clickedWord}
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
  /* The card's own background and text color come from PersonContent, which has
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
  /* Same open motion as the other three lookup cards — they bridge to each
     other, so they have to arrive the same way. */
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
