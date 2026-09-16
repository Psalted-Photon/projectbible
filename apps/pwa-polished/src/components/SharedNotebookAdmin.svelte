<script lang="ts">
  /**
   * Running a shared notebook: who is in it, and how it behaves.
   *
   * One sheet for two quite different readers. Anybody in the notebook opens
   * it to see who else is here and to leave if they want to; its owner opens
   * the same sheet and finds the roster has controls on it and the notebook's
   * own settings underneath. They are together rather than apart because every
   * one of those decisions is about the same thing — who may do what here —
   * and a person who has just realised somebody should not be writing in their
   * notebook should not have to guess which of two screens to look on.
   *
   * Nothing here decides anything the database does not decide again. The
   * owner-only half is the owner-only half of migration 012: the UPDATE policy
   * on shared_notebooks, the members policy that lets the owner write anybody's
   * row, and reset_shared_notebook_code(). What this adds is that a member who
   * may not do a thing is not shown it in the first place.
   *
   * The third state is the sad one: a notebook this account has been removed
   * from. Its rows are kept rather than deleted, so the evening somebody spent
   * writing in it is still on their phone to read. All this sheet can offer
   * them is the plain sentence and a way to clear it away.
   */
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import AuthorPill from './AuthorPill.svelte';
  import { sharedNotebookStore } from '../adapters/SharedNotebookStore';
  import type {
    SharedNotebook,
    SharedNotebookMember,
    SharedNotebookPage,
  } from '../adapters/SharedNotebookStore';
  import { canLeaveNotebook, canManageNotebook, isReadOnlyCopy } from '../lib/shared/sharedPermissions';
  import { formatJoinCode } from '../lib/shared/joinCode';
  import { errorText } from '../stores/noticeStore';

  export let notebook: SharedNotebook;
  /** The roster, in the order people joined. */
  export let members: SharedNotebookMember[] = [];
  /** The notebook's pages, only so a member's row can say how many are theirs. */
  export let pages: SharedNotebookPage[] = [];
  export let userId: string | null = null;

  const dispatch = createEventDispatcher<{
    close: void;
    /** Something on the server moved — the pane reloads and redraws. */
    changed: void;
    /** This account is out of the notebook, or has thrown its copy away. */
    gone: string;
  }>();

  let busy = false;
  let problem = '';
  /** Which member's Remove is waiting to be confirmed, and with what. */
  let confirmMemberId: string | null = null;
  let alsoRemovePages = false;
  let confirmCode = false;
  let confirmLeave = false;
  let confirmForget = false;

  $: readOnly = isReadOnlyCopy(notebook);
  $: me = members.find((m) => m.userId === userId) ?? null;
  $: iRunIt = canManageNotebook(notebook, userId);
  $: iCanLeave = canLeaveNotebook(notebook, me, userId);
  $: code = formatJoinCode(notebook.joinCode);

  /** How many pages each person has written, for their row. */
  $: pageCounts = pages.reduce((counts, page) => {
    counts.set(page.authorId, (counts.get(page.authorId) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());

  /**
   * What a role is called in words.
   *
   * "Writer" in a Broadcast notebook is deliberately not called one: the role
   * is stored, and comes back if the notebook is switched to a Group, but
   * while it is a Broadcast the only person writing is whoever runs it, and a
   * row saying "Writes" beside somebody who cannot would be a lie.
   */
  function roleWord(member: SharedNotebookMember): string {
    if (notebook.ownerId === member.userId) return 'Owner';
    if (member.role === 'admin') return 'Runs it';
    if (member.role === 'reader') return 'Reads';
    return notebook.kind === 'broadcast' ? 'Reads' : 'Writes';
  }

  function nameOf(member: SharedNotebookMember): string {
    return (member.displayName || '').trim() || 'Someone';
  }

  async function run(work: () => Promise<void>) {
    if (busy) return;
    busy = true;
    problem = '';
    try {
      await work();
    } catch (err) {
      problem = errorText(err);
    } finally {
      busy = false;
    }
  }

  function setKind(kind: 'group' | 'broadcast') {
    if (kind === notebook.kind) return;
    void run(async () => {
      notebook = await sharedNotebookStore.updateNotebook(notebook.id, { kind });
      dispatch('changed');
    });
  }

  function setVisibility(visibility: 'private' | 'public') {
    if (visibility === notebook.visibility) return;
    void run(async () => {
      notebook = await sharedNotebookStore.updateNotebook(notebook.id, { visibility });
      dispatch('changed');
    });
  }

  function setJoinOpen(joinOpen: boolean) {
    if (joinOpen === notebook.joinOpen) return;
    void run(async () => {
      notebook = await sharedNotebookStore.updateNotebook(notebook.id, { joinOpen });
      dispatch('changed');
    });
  }

  function newCode() {
    confirmCode = false;
    void run(async () => {
      const next = await sharedNotebookStore.resetJoinCode(notebook.id);
      notebook = { ...notebook, joinCode: next };
      dispatch('changed');
    });
  }

  function setRole(member: SharedNotebookMember, role: 'admin' | 'writer' | 'reader') {
    if (member.role === role) return;
    void run(async () => {
      await sharedNotebookStore.setMemberRole(member.id, role);
      dispatch('changed');
    });
  }

  function startRemove(member: SharedNotebookMember) {
    confirmMemberId = member.id;
    alsoRemovePages = false;
  }

  function removeMember(member: SharedNotebookMember) {
    const take = alsoRemovePages;
    confirmMemberId = null;
    void run(async () => {
      await sharedNotebookStore.removeMember(member, { alsoRemovePages: take });
      dispatch('changed');
    });
  }

  function leave() {
    confirmLeave = false;
    if (!userId) return;
    void run(async () => {
      await sharedNotebookStore.leaveNotebook(notebook.id, userId!);
      dispatch('gone', `You have left “${notebook.name || 'the notebook'}”`);
    });
  }

  function forget() {
    confirmForget = false;
    void run(async () => {
      await sharedNotebookStore.forgetNotebook(notebook.id);
      dispatch('gone', `“${notebook.name || 'The notebook'}” has been taken off this device`);
    });
  }

  function close() {
    if (busy) return;
    dispatch('close');
  }

  function handleBackdropClick(e: MouseEvent) {
    if ((e.target as HTMLElement).classList.contains('sa-backdrop')) close();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }

  onMount(() => window.addEventListener('keydown', handleKeydown));
  onDestroy(() => window.removeEventListener('keydown', handleKeydown));
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="sa-backdrop" on:click={handleBackdropClick}>
  <div class="sa-sheet" role="dialog" aria-modal="true" aria-label="Who is in this notebook">
    <div class="sa-head">
      <span class="sa-title">{iRunIt ? 'Manage notebook' : 'Who is in it'}</span>
      <span class="sa-sub">{notebook.name || 'Untitled notebook'}</span>
      <button class="sa-close" on:click={close} aria-label="Close">✕</button>
    </div>

    {#if readOnly}
      <!-- Said plainly and only once. The pages are still here to read; there
           is nothing else this sheet can offer. -->
      <p class="sa-warn">
        You are no longer in this notebook. What is here is your own copy, and nothing in it can be
        changed.
      </p>
    {/if}

    <!-- ── The roster ──────────────────────────────────────────────────────── -->
    <div class="sa-field">
      <span class="sa-label">
        {members.length === 1 ? '1 person' : `${members.length} people`}
      </span>

      <div class="sa-people">
        {#each members as member (member.id)}
          {@const isMe = member.userId === userId}
          {@const count = pageCounts.get(member.userId) ?? 0}
          <div class="sa-person">
            <div class="sa-person-row">
              <AuthorPill
                variant="round"
                size={28}
                color={member.color}
                initials={member.initials}
                title={nameOf(member)}
              />
              <span class="sa-person-text">
                <span class="sa-person-name">
                  {nameOf(member)}{#if isMe}<span class="sa-you">you</span>{/if}
                </span>
                <span class="sa-person-meta">
                  {roleWord(member)}{count ? ` · ${count} page${count === 1 ? '' : 's'}` : ''}
                </span>
              </span>

              {#if iRunIt && !isMe}
                <button
                  class="sa-person-remove"
                  title="Remove from the notebook"
                  disabled={busy}
                  on:click={() => startRemove(member)}>Remove</button
                >
              {/if}
            </div>

            {#if iRunIt && !isMe}
              <!-- Three words rather than three role names. What somebody may
                   do is the question being asked; admin, writer and reader are
                   what the database calls the answers. -->
              <div class="sa-roles">
                <button
                  class="sa-role"
                  class:active={member.role === 'reader'}
                  disabled={busy}
                  on:click={() => setRole(member, 'reader')}>Reads</button
                >
                <button
                  class="sa-role"
                  class:active={member.role === 'writer'}
                  disabled={busy}
                  on:click={() => setRole(member, 'writer')}>Writes</button
                >
                <button
                  class="sa-role"
                  class:active={member.role === 'admin'}
                  disabled={busy}
                  on:click={() => setRole(member, 'admin')}>Runs it</button
                >
              </div>
            {/if}

            {#if confirmMemberId === member.id}
              <div class="sa-confirm">
                <p class="sa-confirm-text">
                  Take {nameOf(member)} out of this notebook? They keep nothing but what they have
                  already read.
                </p>
                {#if count}
                  <!-- Asked rather than assumed. A group usually wants to keep
                       the notes and lose the access; sometimes it is the other
                       way round, and neither is this sheet's to decide. -->
                  <label class="sa-check">
                    <input type="checkbox" bind:checked={alsoRemovePages} />
                    <span>
                      Take their {count} page{count === 1 ? '' : 's'} out of the notebook as well
                    </span>
                  </label>
                {/if}
                <div class="sa-confirm-actions">
                  <button class="sa-btn sa-btn-quiet" on:click={() => (confirmMemberId = null)}>
                    Cancel
                  </button>
                  <button class="sa-btn sa-btn-danger" on:click={() => removeMember(member)}>
                    Remove
                  </button>
                </div>
              </div>
            {/if}
          </div>
        {/each}
      </div>

      {#if notebook.kind === 'broadcast'}
        <p class="sa-hint">
          Anybody reading this without an account is not on the list — there is no account to put
          there.
        </p>
      {/if}
    </div>

    {#if iRunIt}
      <!-- ── Joining ───────────────────────────────────────────────────────── -->
      <div class="sa-field">
        <span class="sa-label">Joining</span>

        <div class="sa-choices">
          <button
            class="sa-choice"
            class:active={notebook.joinOpen}
            disabled={busy}
            on:click={() => setJoinOpen(true)}
          >
            <span class="sa-choice-name">The code lets people in</span>
            <span class="sa-choice-note">Anyone holding the code or the link can join.</span>
          </button>
          <button
            class="sa-choice"
            class:active={!notebook.joinOpen}
            disabled={busy}
            on:click={() => setJoinOpen(false)}
          >
            <span class="sa-choice-name">Closed</span>
            <span class="sa-choice-note">
              The code stops working. Everyone already in stays in.
            </span>
          </button>
        </div>

        <div class="sa-code-row">
          <span class="sa-code" class:dim={!notebook.joinOpen}>{code}</span>
          <button class="sa-btn sa-btn-quiet" disabled={busy} on:click={() => (confirmCode = true)}>
            New code
          </button>
        </div>

        {#if confirmCode}
          <div class="sa-confirm">
            <p class="sa-confirm-text">
              Give this notebook a new code? Every link, QR code and written-down code stops working
              straight away. Everyone already in stays in.
            </p>
            <div class="sa-confirm-actions">
              <button class="sa-btn sa-btn-quiet" on:click={() => (confirmCode = false)}>
                Cancel
              </button>
              <button class="sa-btn sa-btn-danger" on:click={newCode}>New code</button>
            </div>
          </div>
        {/if}
      </div>

      <!-- ── Who writes in it ──────────────────────────────────────────────── -->
      <div class="sa-field">
        <span class="sa-label">Who writes in it</span>
        <div class="sa-choices">
          <button
            class="sa-choice"
            class:active={notebook.kind === 'group'}
            disabled={busy}
            on:click={() => setKind('group')}
          >
            <span class="sa-choice-name">Everyone writes</span>
            <span class="sa-choice-note">A study group. Everyone who joins can add pages.</span>
          </button>
          <button
            class="sa-choice"
            class:active={notebook.kind === 'broadcast'}
            disabled={busy}
            on:click={() => setKind('broadcast')}
          >
            <span class="sa-choice-name">Only you write</span>
            <span class="sa-choice-note">
              Everyone else reads. Nothing already written is touched.
            </span>
          </button>
        </div>
        {#if notebook.kind === 'broadcast'}
          <p class="sa-hint">
            Anybody you want writing in this as well has to be given “Runs it” above.
          </p>
        {/if}
      </div>

      <!-- ── Who can see it ────────────────────────────────────────────────── -->
      <div class="sa-field">
        <span class="sa-label">Who can see it</span>
        <div class="sa-choices">
          <button
            class="sa-choice"
            class:active={notebook.visibility === 'private'}
            disabled={busy}
            on:click={() => setVisibility('private')}
          >
            <span class="sa-choice-name">Private</span>
            <span class="sa-choice-note">You have to be signed in and have joined to read it.</span>
          </button>
          <button
            class="sa-choice"
            class:active={notebook.visibility === 'public'}
            disabled={busy}
            on:click={() => setVisibility('public')}
          >
            <span class="sa-choice-name">Public</span>
            <span class="sa-choice-note">Anyone with the link can read it without an account.</span>
          </button>
        </div>
        {#if notebook.visibility === 'public'}
          <p class="sa-warn">
            Anybody you send the link to can read every page, and can pass the link on. Writing
            still needs an account.
          </p>
        {/if}
      </div>
    {/if}

    {#if problem}
      <p class="sa-problem">{problem}</p>
    {/if}

    <!-- ── The way out ───────────────────────────────────────────────────────
         Leaving, for a member; clearing away the copy, for somebody already
         removed. An owner gets neither: leaving would take the notebook's only
         possible administrator with it. -->
    {#if readOnly}
      {#if confirmForget}
        <div class="sa-confirm">
          <p class="sa-confirm-text">
            Take this copy off this device? What is in it is not anywhere else — it was removed from
            the notebook's own copy when you were.
          </p>
          <div class="sa-confirm-actions">
            <button class="sa-btn sa-btn-quiet" on:click={() => (confirmForget = false)}>
              Keep it
            </button>
            <button class="sa-btn sa-btn-danger" on:click={forget}>Remove</button>
          </div>
        </div>
      {:else}
        <button class="sa-leave" disabled={busy} on:click={() => (confirmForget = true)}>
          Remove this copy from my device
        </button>
      {/if}
    {:else if iCanLeave}
      {#if confirmLeave}
        <div class="sa-confirm">
          <p class="sa-confirm-text">
            Leave “{notebook.name || 'this notebook'}”? Pages you have written stay in it. You would
            need the code again to come back.
          </p>
          <div class="sa-confirm-actions">
            <button class="sa-btn sa-btn-quiet" on:click={() => (confirmLeave = false)}>
              Stay
            </button>
            <button class="sa-btn sa-btn-danger" on:click={leave}>Leave</button>
          </div>
        </div>
      {:else}
        <button class="sa-leave" disabled={busy} on:click={() => (confirmLeave = true)}>
          Leave this notebook
        </button>
      {/if}
    {/if}

    <div class="sa-actions">
      <button class="sa-btn sa-btn-go" on:click={close} disabled={busy}>
        {busy ? 'Working…' : 'Done'}
      </button>
    </div>
  </div>
</div>

<style>
  .sa-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    display: flex;
    align-items: flex-end;
    justify-content: center;
    z-index: 10000;
  }

  .sa-sheet {
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

  .sa-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 14px;
  }

  .sa-title {
    font-size: 1rem;
    font-weight: 600;
    color: #f0f0f0;
  }

  .sa-sub {
    font-size: 0.75rem;
    color: #888;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sa-close {
    background: none;
    border: none;
    color: #666;
    font-size: 0.875rem;
    cursor: pointer;
    padding: 2px 4px;
    line-height: 1;
    margin-left: auto;
  }
  .sa-close:hover {
    color: #ccc;
  }

  .sa-field {
    display: block;
    margin-bottom: 18px;
  }

  .sa-label {
    display: block;
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #777;
    margin-bottom: 8px;
  }

  /* ── People ── */
  .sa-people {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .sa-person {
    background: #161616;
    border: 1px solid #2a2a2a;
    border-radius: 10px;
    padding: 9px 11px;
  }

  .sa-person-row {
    display: flex;
    align-items: center;
    gap: 9px;
  }

  .sa-person-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    flex: 1;
  }

  .sa-person-name {
    font-size: 0.875rem;
    color: #ddd;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Quiet, because it is a reminder rather than a label — the row is about
     somebody else most of the time. */
  .sa-you {
    margin-left: 6px;
    font-size: 0.6875rem;
    color: #5eead4;
    background: #12302c;
    border-radius: 4px;
    padding: 1px 5px;
  }

  .sa-person-meta {
    font-size: 0.75rem;
    color: #808080;
  }

  .sa-person-remove {
    background: none;
    border: 1px solid #3a3a3a;
    border-radius: 14px;
    color: #999;
    font-family: inherit;
    font-size: 0.75rem;
    padding: 4px 11px;
    cursor: pointer;
    flex-shrink: 0;
  }
  .sa-person-remove:hover:not(:disabled) {
    border-color: #7f1d1d;
    color: #fca5a5;
  }
  .sa-person-remove:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .sa-roles {
    display: flex;
    gap: 5px;
    margin-top: 8px;
  }

  .sa-role {
    flex: 1;
    background: #1c1c1c;
    border: 1px solid #2e2e2e;
    border-radius: 8px;
    color: #999;
    font-family: inherit;
    font-size: 0.75rem;
    padding: 5px 4px;
    cursor: pointer;
  }
  .sa-role:hover:not(:disabled) {
    background: #232323;
  }
  .sa-role.active {
    border-color: #2dd4bf;
    background: #12302c;
    color: #5eead4;
  }
  .sa-role:disabled {
    opacity: 0.6;
    cursor: default;
  }

  /* ── Choices, the same shape the create sheet uses ── */
  .sa-choices {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .sa-choice {
    display: flex;
    flex-direction: column;
    gap: 3px;
    text-align: left;
    background: #161616;
    border: 1px solid #2e2e2e;
    border-radius: 10px;
    padding: 10px 12px;
    cursor: pointer;
    font-family: inherit;
    transition: border-color 0.15s, background 0.15s;
  }
  .sa-choice:hover:not(:disabled) {
    background: #1c1c1c;
  }
  .sa-choice.active {
    border-color: #2dd4bf;
    background: #12302c;
  }
  .sa-choice:disabled {
    cursor: default;
  }

  .sa-choice-name {
    font-size: 0.875rem;
    font-weight: 600;
    color: #ddd;
  }
  .sa-choice.active .sa-choice-name {
    color: #5eead4;
  }

  .sa-choice-note {
    font-size: 0.75rem;
    color: #888;
    line-height: 1.4;
  }

  /* ── The code ── */
  .sa-code-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 10px;
  }

  .sa-code {
    font-family: 'Courier New', monospace;
    font-size: 1.125rem;
    font-weight: 700;
    letter-spacing: 0.16em;
    color: #5eead4;
    user-select: text;
    flex: 1;
  }
  /* A code that lets nobody in still has to be readable — it is what the
     switch above is about — but it should not look live. */
  .sa-code.dim {
    color: #5a6b68;
    text-decoration: line-through;
  }

  /* ── Confirms ── */
  .sa-confirm {
    margin-top: 10px;
    background: #211414;
    border: 1px solid #4a2020;
    border-radius: 10px;
    padding: 11px 12px;
  }

  .sa-confirm-text {
    margin: 0 0 10px;
    font-size: 0.8125rem;
    line-height: 1.5;
    color: #e8b4b4;
  }

  .sa-check {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-bottom: 10px;
    font-size: 0.8125rem;
    line-height: 1.4;
    color: #ddd;
    cursor: pointer;
  }
  .sa-check input {
    margin: 2px 0 0;
    accent-color: #dc2626;
  }

  .sa-confirm-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }

  .sa-hint {
    margin: 9px 0 0;
    font-size: 0.75rem;
    line-height: 1.45;
    color: #777;
  }

  .sa-warn {
    margin: 0 0 16px;
    font-size: 0.75rem;
    line-height: 1.5;
    color: #fbbf24;
    background: #2a2010;
    border: 1px solid #4a3a14;
    border-radius: 8px;
    padding: 9px 11px;
  }

  .sa-problem {
    margin: 0 0 14px;
    font-size: 0.8125rem;
    line-height: 1.45;
    color: #fca5a5;
  }

  .sa-leave {
    display: block;
    width: 100%;
    background: none;
    border: 1px solid #3a2020;
    border-radius: 10px;
    color: #c98a8a;
    font-family: inherit;
    font-size: 0.8125rem;
    padding: 9px 12px;
    cursor: pointer;
    margin-bottom: 14px;
  }
  .sa-leave:hover:not(:disabled) {
    background: #211414;
    color: #fca5a5;
  }
  .sa-leave:disabled {
    opacity: 0.5;
    cursor: default;
  }

  /* ── Buttons ── */
  .sa-actions {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
  }

  .sa-btn {
    padding: 8px 18px;
    border-radius: 20px;
    border: none;
    font-size: 0.8125rem;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
  }
  .sa-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .sa-btn-quiet {
    background: #2a2a2a;
    color: #ddd;
    border: 1px solid #3a3a3a;
  }
  .sa-btn-quiet:hover:not(:disabled) {
    background: #333;
  }

  .sa-btn-danger {
    background: #7f1d1d;
    color: #fee2e2;
  }
  .sa-btn-danger:hover:not(:disabled) {
    background: #991b1b;
  }

  .sa-btn-go {
    background: #0d9488;
    color: #fff;
    min-width: 100px;
  }
  .sa-btn-go:hover:not(:disabled) {
    background: #0f766e;
  }
</style>
