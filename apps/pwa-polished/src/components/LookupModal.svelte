<script lang="ts">
  import { tick } from "svelte";
  import { get } from "svelte/store";
  import IsbeContent from "./IsbeContent.svelte";
  import NavesContent from "./NavesContent.svelte";
  import PersonContent from "./PersonContent.svelte";
  import LexicalContent from "./LexicalContent.svelte";
  import { lookupStore } from "../stores/lookupStore";
  import { isbeModalStore, type IsbeModalState, type IsbeTab } from "../stores/isbeModalStore";
  import { navesModalStore, type NavesTab } from "../stores/navesModalStore";
  import { personModalStore } from "../stores/personModalStore";
  import { lexicalModalStore } from "../stores/lexicalModalStore";
  import { isbeReturnStore } from "../stores/isbeReturnStore";
  import { pendingRestore } from "../stores/navigationStore";
  import { windowStore } from "../lib/stores/windowStore";
  import { clearCarriedWorks } from "../lib/openWork";

  /**
   * The one lookup card.
   *
   * There used to be four of these, one per work, and switching tabs meant
   * closing one and opening another — you watched the card shut and a new one
   * slide up. Now the card is the constant and the work inside it changes,
   * which is what makes the tabs read as tabs. Each work still keeps its own
   * state in its own store, so the one you left is still there when you return.
   */
  $: work = $lookupStore;
  $: isbe = $isbeModalStore;
  $: naves = $navesModalStore;
  $: person = $personModalStore;
  $: lexical = $lexicalModalStore;

  // The nav bar's back arrow reopens the encyclopedia where you left it and
  // leaves the detail in isbeReturnStore for us. Consumed once per open and
  // handed down as props: a one-shot breadcrumb, so reading it twice would
  // restore a stale view over a later article.
  let seenIsbe: IsbeModalState | null = null;
  let initialExpanded: Record<string, boolean> = {};
  let initialExpandedBooks: string[] = [];
  let initialVisited: string[] = [];
  let initialScrollTop = 0;
  $: if (isbe !== seenIsbe) {
    seenIsbe = isbe;
    initialExpanded = {};
    initialExpandedBooks = [];
    initialVisited = [];
    initialScrollTop = 0;
    if (isbe.isOpen && isbe.tab) {
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

  /**
   * Where each work was when you last left it — the sub-tab, what was open, how
   * far down. Each content reports this on its way out, so coming back to a tab
   * lands where you were rather than at the top, the way browser tabs behave.
   * Dropped when the card closes, so reopening later starts clean.
   */
  let saved: Record<string, any> = {};

  /**
   * Closing tears the content down, and tearing it down is exactly when it
   * reports where it was — which would refill this the moment after it was
   * emptied, and a later open would restore a place belonging to a different
   * subject. So while closing, the reports are ignored.
   */
  let closing = false;

  function remember(work: string, snap: any) {
    if (!closing) saved[work] = snap;
  }

  /**
   * Reopen a work when a breadcrumb walks back to it.
   *
   * The crumb carries the snapshot the content captured on its way out, which
   * is the same shape `saved` holds for tab-switch memory — so it is seeded
   * straight into there and the existing `initial*` props do the rest. Without
   * this the back step landed you on the passage with the card simply gone.
   */
  $: {
    const pending = $pendingRestore as { surface?: string; snapshot?: any } | null;
    if (pending?.surface === 'naves' && pending.snapshot) {
      pendingRestore.set(null);
      const snap = pending.snapshot;
      saved = { ...saved, topical: snap };
      navesModalStore.open({ topicId: snap.topicId, primaryName: snap.primaryName, tab: snap.tab ?? null });
    } else if (pending?.surface === 'person' && pending.snapshot) {
      pendingRestore.set(null);
      const snap = pending.snapshot;
      saved = { ...saved, people: snap };
      personModalStore.open({ personId: snap.personId, primaryName: snap.primaryName });
    } else if (pending?.surface === 'lexical' && pending.snapshot) {
      pendingRestore.set(null);
      const snap = pending.snapshot;
      saved = { ...saved, dictionary: { tab: snap.tab, scrollTop: snap.scrollTop } };
      lexicalModalStore.open(snap.payload);
    }
  }

  function close() {
    closing = true;
    saved = {};
    // The subject the tabs were carrying goes with them.
    clearCarriedWorks();
    // Take the card down and drop every work's state with it, so reopening
    // later starts clean rather than on whatever was last on screen.
    isbeModalStore.close();
    navesModalStore.close();
    personModalStore.close();
    lexicalModalStore.close();
    lookupStore.close();
    // The teardown lands in the flush after this returns; take the guard off
    // once it has been and gone.
    tick().then(() => {
      closing = false;
    });
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) close();
  }

  /** Move what's on screen into a docked window, exactly as it stands. Same
   *  edge convention throughout: beside the text on a wide screen, under it on
   *  a phone. */
  function newWindow(): string | null {
    const edge = globalThis.window.innerHeight > globalThis.window.innerWidth ? "bottom" : "right";
    // Null at the six-window cap. The caller leaves the card up rather than
    // closing it onto nothing.
    return windowStore.createWindow(edge, 50);
  }

  function popOutIsbe(snap: {
    primaryName: string;
    tab: IsbeTab;
    expanded: Record<string, boolean>;
    expandedBooks: string[];
    visited: string[];
    scrollTop: number;
    trail: { entryId: number | null; placeId: string | null; name: string }[];
  }) {
    const id = newWindow();
    if (!id) return;
    windowStore.setWindowContent(id, "isbe", {
      kind: isbe.kind,
      entryId: isbe.entryId,
      placeId: isbe.placeId,
      primaryName: snap.primaryName || isbe.primaryName,
      tab: snap.tab,
      expanded: snap.expanded,
      expandedBooks: snap.expandedBooks,
      visited: snap.visited,
      scrollTop: snap.scrollTop,
      trail: snap.trail,
    });
    close();
  }

  function popOutNaves(snap: {
    topicId: number;
    primaryName: string;
    tab: NavesTab;
    expanded: Record<string, boolean>;
    expandedBooks: string[];
    scrollTop: number;
    trail: { topicId: number; name: string }[];
  }) {
    const id = newWindow();
    if (!id) return;
    windowStore.setWindowContent(id, "naves", { ...snap });
    close();
  }

  function popOutPerson(snap: { personId: string; primaryName: string }) {
    const id = newWindow();
    if (!id) return;
    windowStore.setWindowContent(id, "person", { ...snap });
    close();
  }

  // Escape walks the work back out — a crumb, then its contents — and only
  // takes the card down once there is nowhere left to go. The dictionary has no
  // back trail, so it closes on the first press.
  let content: { handleBack?: () => boolean } | null = null;

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== "Escape" || !work) return;
    if (content?.handleBack?.()) return;
    close();
  }
</script>

<svelte:window on:keydown={onKeydown} />

{#if work}
  <div class="modal-backdrop" on:click={handleBackdropClick} role="presentation">
    <div class="modal-container">
      {#if work === "encyclopedia"}
        <IsbeContent
          bind:this={content}
          initialScrollTop={saved.encyclopedia?.scrollTop ?? initialScrollTop}
          onSnapshot={(snap) => remember("encyclopedia", snap)}
          kind={isbe.kind}
          entryId={isbe.entryId}
          placeId={isbe.placeId}
          primaryName={isbe.primaryName}
          initialTab={saved.encyclopedia?.tab ?? isbe.tab ?? null}
          initialExpanded={saved.encyclopedia?.expanded ?? initialExpanded}
          initialExpandedBooks={saved.encyclopedia?.expandedBooks ?? initialExpandedBooks}
          initialVisited={saved.encyclopedia?.visited ?? initialVisited}
          initialTrail={saved.encyclopedia?.trail ?? []}
          onClose={close}
          onPopOut={popOutIsbe}
        />
      {:else if work === "topical"}
        <NavesContent
          bind:this={content}
          topicId={naves.topicId}
          primaryName={naves.primaryName}
          initialTab={saved.topical?.tab ?? naves.tab ?? null}
          initialExpanded={saved.topical?.expanded ?? {}}
          initialExpandedBooks={saved.topical?.expandedBooks ?? []}
          initialScrollTop={saved.topical?.scrollTop ?? 0}
          initialTrail={saved.topical?.trail ?? []}
          onSnapshot={(snap) => remember("topical", snap)}
          onClose={close}
          onPopOut={popOutNaves}
        />
      {:else if work === "people"}
        <PersonContent
          bind:this={content}
          lookup={person.lookup}
          personId={person.personId}
          clickedWord={person.clickedWord}
          initialTrail={saved.people?.trail ?? []}
          initialScrollTop={saved.people?.scrollTop ?? 0}
          initialScrollFor={saved.people?.personId ?? null}
          onSnapshot={(snap) => remember("people", snap)}
          onClose={close}
          onPopOut={popOutPerson}
        />
      {:else if work === "dictionary"}
        <LexicalContent
          selectedText={lexical.selectedText}
          strongsId={lexical.strongsId}
          morphologyData={lexical.morphologyData}
          lexicalEntries={lexical.lexicalEntries}
          characterData={lexical.characterData ?? null}
          initialTab={saved.dictionary?.tab ?? null}
          initialScrollTop={saved.dictionary?.scrollTop ?? 0}
          onSnapshot={(snap) => remember("dictionary", snap)}
          onClose={close}
        />
      {/if}
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
  /* The card's own background and text colour come from whichever work is
     inside it, because each of them has to paint its own in a docked window
     too. */
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
  /* Only on the way in. Switching tabs changes what is inside the card, not the
     card, so the motion must not replay — that replay is exactly what made the
     tabs look like they were closing and reopening the whole thing. */
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
