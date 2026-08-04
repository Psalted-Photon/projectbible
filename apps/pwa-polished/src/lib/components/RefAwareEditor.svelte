<script lang="ts">
  /**
   * LexicalEditor plus the Bible-reference popover.
   *
   * Everywhere the app offers free writing — notes, notebook pages, the journal
   * — wants the same behaviour when a reference is clicked, so it lives here
   * once rather than in each of them. Drop-in replacement for LexicalEditor:
   * same props, same events, same exported methods.
   */
  import { onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import LexicalEditor from './LexicalEditor.svelte';
  import BibleRefPopover from '../../components/BibleRefPopover.svelte';
  import { navigationStore } from '../../stores/navigationStore';
  import { IndexedDBTextStore } from '../../adapters/TextStore';

  export let value: string = '';
  export let placeholder: string = 'Start writing…';
  export let isDirty: boolean = false;

  const textStore = new IndexedDBTextStore();

  let editorRef: any;

  type RefHit = {
    key: string;
    ref: string;
    book: string;
    chapter: number;
    verse: number;
    expanded: boolean;
    chapterOnly: boolean;
    x: number;
    y: number;
  };

  let hit: RefHit | null = null;
  let busy = false;

  export function focus() {
    editorRef?.focus();
  }

  export function setContent(html: string) {
    hit = null;
    editorRef?.setContent(html);
  }

  function handleRefClick(e: CustomEvent<RefHit>) {
    hit = e.detail;
    busy = false;
  }

  function close() {
    hit = null;
  }

  function goTo() {
    if (!hit) return;
    const translation = get(navigationStore).translation;
    navigationStore.navigateToVerse(translation, hit.book, hit.chapter, hit.verse);
    close();
  }

  async function expand() {
    if (!hit || busy) return;
    busy = true;
    try {
      const translation = get(navigationStore).translation;
      const text = await textStore.getVerse(translation, hit.book, hit.chapter, hit.verse);
      if (text) editorRef?.expandRef(hit.key, text);
      else console.warn('[RefAwareEditor] No verse text for', hit.ref, 'in', translation);
    } catch (err) {
      console.error('[RefAwareEditor] Expand failed:', err);
    } finally {
      busy = false;
      close();
    }
  }

  function collapse() {
    if (!hit) return;
    editorRef?.collapseRef(hit.key);
    close();
  }

  /** Any click that isn't on the popover or another reference dismisses it. */
  function handleWindowPointer(e: PointerEvent) {
    if (!hit) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest?.('.ref-popover') || t?.closest?.('.bible-ref')) return;
    close();
  }

  onDestroy(() => (hit = null));
</script>

<svelte:window on:pointerdown={handleWindowPointer} />

<LexicalEditor
  bind:this={editorRef}
  bind:isDirty
  {value}
  {placeholder}
  on:change
  on:blur
  on:refClick={handleRefClick}
/>

{#if hit}
  <BibleRefPopover
    x={hit.x}
    y={hit.y}
    refLabel={hit.ref}
    book={hit.book}
    expanded={hit.expanded}
    chapterOnly={hit.chapterOnly}
    {busy}
    on:goto={goTo}
    on:expand={expand}
    on:collapse={collapse}
    on:close={close}
  />
{/if}
