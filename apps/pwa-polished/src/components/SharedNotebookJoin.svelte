<script lang="ts">
  /**
   * The two ends of a join code, in one sheet.
   *
   * In `invite` mode it shows the code for a notebook you are in, the link
   * built from it, and that same link as a QR code. In `join` mode it takes a
   * code and puts you in. They are the same sheet on purpose: it is one code,
   * read from one side or the other, and keeping them together is what stops
   * the two halves drifting into disagreeing about what a code looks like.
   *
   * Everything on the invite side is the same string — the code, the link and
   * the QR are one piece of information in three shapes, because a code is what
   * survives being read aloud, a link is what survives being pasted, and a QR
   * is what survives being held up across a room. An NFC tag later needs no
   * work at all: a tag holds a URL, so the link is already the whole of it.
   */
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import QrCode from './QrCode.svelte';
  import { sharedNotebookStore } from '../adapters/SharedNotebookStore';
  import type { SharedNotebook } from '../adapters/SharedNotebookStore';
  import {
    JOIN_CODE_LENGTH,
    buildJoinUrl,
    formatJoinCode,
    isJoinCode,
    normalizeJoinCode,
  } from '../lib/shared/joinCode';
  import { canShare, copyText, shareText } from '../lib/clipboard';
  import { errorText } from '../stores/noticeStore';

  /** Which end of the code this is. */
  export let mode: 'join' | 'invite' = 'join';
  /** Invite mode: the notebook being handed out. */
  export let notebook: SharedNotebook | null = null;
  /** Join mode: a code arriving from a link, already filled in. */
  export let prefill = '';

  const dispatch = createEventDispatcher<{ close: void; joined: SharedNotebook }>();

  // ── Joining ────────────────────────────────────────────────────────────────

  let typed = formatJoinCode(prefill);
  let busy = false;
  let problem = '';

  $: code = normalizeJoinCode(typed);
  $: canJoin = isJoinCode(code) && !busy;

  /**
   * Re-print the code as it is typed, so it reads back the way it was given
   * out. Done on input rather than on blur because the hyphen appearing at the
   * halfway mark is also what tells someone the field expects eight characters.
   */
  function handleInput(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    const clean = normalizeJoinCode(el.value).slice(0, JOIN_CODE_LENGTH);
    typed = formatJoinCode(clean);
    // Written back by hand as well as through `typed`. A character the code
    // cannot contain leaves the formatted value exactly as it was, so Svelte
    // sees nothing to update and the rejected character stays sitting in the
    // field. Assigning here is what actually takes it back out.
    if (el.value !== typed) el.value = typed;
    problem = '';
  }

  async function join() {
    if (!canJoin) return;
    busy = true;
    problem = '';
    try {
      const joined = await sharedNotebookStore.joinByCode(code);
      dispatch('joined', joined);
    } catch (err) {
      problem = errorText(err);
      busy = false;
    }
  }

  // ── Inviting ───────────────────────────────────────────────────────────────

  $: inviteCode = notebook ? formatJoinCode(notebook.joinCode) : '';
  $: inviteUrl = notebook ? buildJoinUrl(notebook.joinCode) : '';

  /**
   * What gets copied and shared: the name, the link, and the code written out.
   *
   * The code is in the message as well as the link because a link that arrives
   * broken — wrapped by an email client, or pasted without its tail — leaves
   * somebody holding nothing, and eight characters they can type is the way
   * back from that.
   */
  $: inviteText = notebook
    ? [
        `Join "${notebook.name || 'my notebook'}" in Hexapla:`,
        '',
        inviteUrl,
        '',
        `Or enter the code ${inviteCode}`,
      ].join('\n')
    : '';

  let copyState: 'idle' | 'done' | 'failed' = 'idle';
  let copyTimer: ReturnType<typeof setTimeout> | null = null;

  async function handleCopy() {
    const ok = await copyText(inviteText);
    // There is no snackbar behind this sheet, so the button says it itself.
    copyState = ok ? 'done' : 'failed';
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (copyState = 'idle'), 1500);
  }

  async function handleShare() {
    // Dismissing the OS sheet is not a failure, and leaves this one open.
    if (await shareText(inviteText)) dispatch('close');
  }

  // ── Chrome ─────────────────────────────────────────────────────────────────

  function close() {
    if (busy) return;
    dispatch('close');
  }

  function handleBackdropClick(e: MouseEvent) {
    if ((e.target as HTMLElement).classList.contains('sj-backdrop')) close();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }

  function focusOnMount(node: HTMLElement) {
    setTimeout(() => node.focus(), 50);
  }

  onMount(() => window.addEventListener('keydown', handleKeydown));
  onDestroy(() => {
    window.removeEventListener('keydown', handleKeydown);
    if (copyTimer) clearTimeout(copyTimer);
  });
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="sj-backdrop" on:click={handleBackdropClick}>
  <div
    class="sj-sheet"
    role="dialog"
    aria-modal="true"
    aria-label={mode === 'invite' ? 'Invite people' : 'Join a shared notebook'}
  >
    <div class="sj-head">
      <span class="sj-title">{mode === 'invite' ? 'Invite people' : 'Join a notebook'}</span>
      {#if mode === 'invite' && notebook}
        <span class="sj-sub">{notebook.name || 'Untitled notebook'}</span>
      {/if}
      <button class="sj-close" on:click={close} aria-label="Close">✕</button>
    </div>

    {#if mode === 'invite'}
      <p class="sj-note">
        Anyone with this can join. Point a phone camera at the square, tap the link, or type the
        code in.
      </p>

      <div class="sj-qr-wrap">
        <QrCode value={inviteUrl} size={190} label="QR code for the join link" />
      </div>

      <div class="sj-code-row">
        <span class="sj-code">{inviteCode}</span>
      </div>

      <!-- Selectable, unlike the rest of the sheet, so the link can still be
           lifted out by hand where a Copy button is not available. -->
      <p class="sj-url">{inviteUrl}</p>

      <div class="sj-actions">
        <button class="sj-btn sj-btn-copy" class:done={copyState === 'done'} on:click={handleCopy}>
          {copyState === 'done' ? 'Copied' : copyState === 'failed' ? "Couldn't copy" : 'Copy'}
        </button>
        {#if canShare}
          <button class="sj-btn sj-btn-go" on:click={handleShare}>Share</button>
        {/if}
      </div>
    {:else}
      <p class="sj-note">
        Eight characters, from whoever runs the notebook. Capitals and the dash do not matter.
      </p>

      <input
        class="sj-input"
        placeholder="ABCD-EFGH"
        inputmode="text"
        autocomplete="off"
        autocapitalize="characters"
        spellcheck="false"
        maxlength="9"
        value={typed}
        use:focusOnMount
        on:input={handleInput}
        on:keydown={(e) => {
          if (e.key === 'Enter') join();
        }}
      />

      {#if problem}
        <p class="sj-problem">{problem}</p>
      {/if}

      <div class="sj-actions">
        <button class="sj-btn sj-btn-quiet" on:click={close} disabled={busy}>Cancel</button>
        <button class="sj-btn sj-btn-go" on:click={join} disabled={!canJoin}>
          {busy ? 'Joining…' : 'Join'}
        </button>
      </div>
    {/if}
  </div>
</div>

<style>
  .sj-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    display: flex;
    align-items: flex-end;
    justify-content: center;
    z-index: 10000;
  }

  .sj-sheet {
    background: #1e1e1e;
    border: 1px solid #333;
    border-radius: 16px 16px 0 0;
    width: 100%;
    max-width: 480px;
    padding: 20px 20px calc(20px + env(safe-area-inset-bottom, 0px));
    box-shadow: 0 -4px 32px rgba(0, 0, 0, 0.6);
    max-height: 90vh;
    overflow-y: auto;
  }

  .sj-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 12px;
  }

  .sj-title {
    font-size: 1rem;
    font-weight: 600;
    color: #f0f0f0;
  }

  .sj-sub {
    font-size: 0.75rem;
    color: #888;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sj-close {
    background: none;
    border: none;
    color: #666;
    font-size: 0.875rem;
    cursor: pointer;
    padding: 2px 4px;
    line-height: 1;
    margin-left: auto;
  }
  .sj-close:hover {
    color: #ccc;
  }

  .sj-note {
    margin: 0 0 16px;
    font-size: 0.8125rem;
    line-height: 1.5;
    color: #999;
  }

  /* ── Invite ── */
  .sj-qr-wrap {
    display: flex;
    justify-content: center;
    padding: 14px;
    background: #ffffff;
    border-radius: 12px;
    margin-bottom: 16px;
  }

  .sj-code-row {
    display: flex;
    justify-content: center;
    margin-bottom: 12px;
  }

  /* Monospaced and spaced out, because this is a string somebody is going to
     read out character by character. */
  .sj-code {
    font-family: 'Courier New', monospace;
    font-size: 1.5rem;
    font-weight: 700;
    letter-spacing: 0.18em;
    color: #5eead4;
    user-select: text;
  }

  .sj-url {
    margin: 0 0 18px;
    font-size: 0.75rem;
    line-height: 1.5;
    color: #777;
    text-align: center;
    overflow-wrap: anywhere;
    user-select: text;
  }

  /* ── Join ── */
  .sj-input {
    width: 100%;
    box-sizing: border-box;
    background: #161616;
    border: 1px solid #2e2e2e;
    border-radius: 10px;
    padding: 14px 12px;
    color: #e8e8e8;
    font-family: 'Courier New', monospace;
    font-size: 1.375rem;
    font-weight: 700;
    letter-spacing: 0.16em;
    text-align: center;
    text-transform: uppercase;
  }
  .sj-input:focus {
    outline: none;
    border-color: #2dd4bf;
  }

  .sj-problem {
    margin: 12px 0 0;
    font-size: 0.8125rem;
    line-height: 1.45;
    color: #fca5a5;
    text-align: center;
  }

  /* ── Actions ── */
  .sj-actions {
    display: flex;
    gap: 10px;
    margin-top: 18px;
    justify-content: flex-end;
  }

  .sj-btn {
    padding: 9px 20px;
    border-radius: 20px;
    border: none;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
  }
  .sj-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .sj-btn-quiet,
  .sj-btn-copy {
    background: #2a2a2a;
    color: #ddd;
    border: 1px solid #3a3a3a;
  }
  .sj-btn-quiet:hover:not(:disabled),
  .sj-btn-copy:hover {
    background: #333;
  }

  .sj-btn-copy {
    min-width: 116px;
  }
  .sj-btn-copy.done {
    background: #14532d;
    border-color: #1d6b3c;
    color: #86efac;
  }

  .sj-btn-go {
    background: #0d9488;
    color: #fff;
    min-width: 110px;
  }
  .sj-btn-go:hover:not(:disabled) {
    background: #0f766e;
  }
</style>
