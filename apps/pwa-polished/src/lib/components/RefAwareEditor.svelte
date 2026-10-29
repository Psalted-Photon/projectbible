<script lang="ts">
  /**
   * LexicalEditor plus the Bible-reference popover and a recording pill's menu.
   *
   * Everywhere the app offers free writing — notes, notebook pages, the journal
   * — wants the same behavior when a reference or a recording's pill is
   * clicked, so it lives here once rather than in each of them. Drop-in
   * replacement for LexicalEditor: same props, same events, same exported
   * methods.
   */
  import { onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import LexicalEditor from './LexicalEditor.svelte';
  import BibleRefPopover from '../../components/BibleRefPopover.svelte';
  import RecordingChipMenu from '../../components/RecordingChipMenu.svelte';
  import { navigationStore } from '../../stores/navigationStore';
  import { IndexedDBTextStore } from '../../adapters/TextStore';
  import type { EditorSurface } from '../../adapters/settings';
  import type { TranscriptBlock, TranscriptTail } from '../voice/transcriptSink';

  export let value: string = '';
  export let placeholder: string = 'Start writing…';
  export let isDirty: boolean = false;
  /** Which writing surface this is — see LexicalEditor. */
  export let surface: EditorSurface | null = null;
  export let surfaceLabel: string = '';
  /** Put the caret in as soon as the editor is ready — see LexicalEditor. */
  export let autofocus: boolean = false;

  const textStore = new IndexedDBTextStore();

  let editorRef: any;

  type RefHit = {
    key: string;
    ref: string;
    book: string;
    chapter: number;
    verse: number;
    expanded: boolean;
    x: number;
    y: number;
  };

  let hit: RefHit | null = null;
  let busy = false;
  /** Set when the verse text couldn't be fetched, so the menu can say so. */
  let unavailable = false;

  export function focus() {
    editorRef?.focus();
  }

  export function setContent(html: string) {
    hit = null;
    editorRef?.setContent(html);
  }

  /** Drops a recording's pill at the caret — see LexicalEditor. */
  export function placeRecording(recId: string): boolean {
    return editorRef?.placeRecording(recId) ?? false;
  }

  /** A transcript's next piece, in front of its pill — see LexicalEditor. */
  export function writeTranscript(recId: string | null, blocks: TranscriptBlock[], tail: TranscriptTail | null): TranscriptTail | null | undefined {
    return editorRef?.writeTranscript(recId, blocks, tail);
  }

  /** Takes a recording's pill out — see LexicalEditor. */
  export function removeRecording(recId: string): boolean | undefined {
    return editorRef?.removeRecording(recId);
  }

  /** The recording pill whose menu is open. */
  let chip: { recId: string; x: number; y: number } | null = null;

  function handleRecClick(e: CustomEvent<{ recId: string; x: number; y: number }>) {
    hit = null;
    chip = e.detail.recId ? e.detail : null;
  }

  function handleRefClick(e: CustomEvent<RefHit>) {
    hit = e.detail;
    busy = false;
    unavailable = false;
  }

  function close() {
    hit = null;
    unavailable = false;
  }

  function goTo() {
    if (!hit) return;
    const current = get(navigationStore);
    // Record where we are first, so the nav bar's Back arrow returns here —
    // same two-step the lexicon modal uses.
    navigationStore.pushHistory(current, 'notes');
    navigationStore.navigateToVerse(current.translation, hit.book, hit.chapter, hit.verse);
    close();
  }

  async function expand() {
    if (!hit || busy) return;
    // The reference this expand is for. Another one tapped while the verse is
    // fetched replaces `hit`, and its key used to get this verse's text.
    const target = hit;
    busy = true;
    unavailable = false;
    try {
      // Whatever the reader is on — expanding copies what you're looking at,
      // and the text is frozen into the note once inserted.
      const translation = get(navigationStore).translation;
      const text = await textStore.getVerse(translation, target.book, target.chapter, target.verse);
      if (hit !== target) return;
      if (text) {
        editorRef?.expandRef(target.key, text);
        close();
      } else {
        // Pack not installed for this book, or no such verse in it. Say so and
        // leave the menu open so Go to is still available.
        console.warn('[RefAwareEditor] No verse text for', target.ref, 'in', translation);
        unavailable = true;
      }
    } catch (err) {
      if (hit !== target) return;
      console.error('[RefAwareEditor] Expand failed:', err);
      unavailable = true;
    } finally {
      if (hit === target) busy = false;
    }
  }

  function collapse() {
    if (!hit) return;
    editorRef?.collapseRef(hit.key);
    close();
  }

  /** Any click that isn't on the popover or another reference dismisses it; the same for a pill's menu. */
  function handleWindowPointer(e: PointerEvent) {
    const t = e.target as HTMLElement | null;
    if (chip && !t?.closest?.('.rec-menu') && !t?.closest?.('.rec-chip')) chip = null;
    if (!hit) return;
    if (t?.closest?.('.ref-popover') || t?.closest?.('.bible-ref')) return;
    close();
  }

  onDestroy(() => {
    hit = null;
    chip = null;
  });
</script>

<svelte:window on:pointerdown={handleWindowPointer} />

<LexicalEditor
  bind:this={editorRef}
  bind:isDirty
  {value}
  {placeholder}
  {surface}
  {surfaceLabel}
  {autofocus}
  on:change
  on:blur
  on:refClick={handleRefClick}
  on:recClick={handleRecClick}
/>

{#if hit}
  <BibleRefPopover
    x={hit.x}
    y={hit.y}
    refLabel={hit.ref}
    book={hit.book}
    expanded={hit.expanded}
    {busy}
    {unavailable}
    on:goto={goTo}
    on:expand={expand}
    on:collapse={collapse}
    on:close={close}
  />
{/if}

{#if chip}
  <RecordingChipMenu
    recId={chip.recId}
    x={chip.x}
    y={chip.y}
    on:remove={() => chip && editorRef?.removeRecording(chip.recId)}
    on:close={() => (chip = null)}
  />
{/if}
