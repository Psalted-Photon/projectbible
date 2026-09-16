<script lang="ts">
  /**
   * What a join code turns into.
   *
   * A code reaches this from two directions — a `?join=` link opened at launch,
   * and somebody typing one into the Shared tab — and there are three things it
   * can mean, decided by who is holding it:
   *
   *   Signed in            the join sheet, with the code filled in. Tapping a
   *                        link should not silently add you to somebody's
   *                        notebook, so there is always a confirmation.
   *   Signed out, public   the read-only reader. No account is needed and none
   *                        is asked for.
   *   Signed out, private  nothing, and deliberately not much of an
   *                        explanation — see below.
   *
   * It draws nothing at all until a code arrives, so the common launch, where
   * there is no code, costs one subscription and no markup.
   */
  import SharedNotebookJoin from './SharedNotebookJoin.svelte';
  import PublicNotebookReader from './PublicNotebookReader.svelte';
  import { pendingJoinCode, clearJoin } from '../stores/sharedJoinStore';
  import { sharedNotebookStore } from '../adapters/SharedNotebookStore';
  import type { PublicSharedNotebook, SharedNotebook } from '../adapters/SharedNotebookStore';
  import { supabaseAuthService } from '../services/SupabaseAuthService';
  import { profileModalStore } from '../stores/profileModalStore';
  import { windowStore } from '../lib/stores/windowStore';
  import { showNotice } from '../stores/noticeStore';
  import { formatJoinCode } from '../lib/shared/joinCode';

  type Stage =
    | { at: 'idle' }
    | { at: 'looking'; code: string }
    | { at: 'join'; code: string }
    | { at: 'public'; code: string; data: PublicSharedNotebook }
    | { at: 'refused'; code: string };

  let stage: Stage = { at: 'idle' };

  // A code arriving is the only thing that starts any of this, and it is
  // cleared the moment it is taken up so re-entering here cannot re-trigger it.
  $: if ($pendingJoinCode) void take($pendingJoinCode);

  /**
   * Asked of Supabase rather than read off userProfileStore.
   *
   * A code from a `?join=` link is parked before anything has mounted, and the
   * store is filled in later, from ProfileModal's own onMount — so at the
   * moment this runs a signed-in reader still looks signed out, and would be
   * sent down the public path and told their own notebook does not exist.
   * getSession() waits for the stored session to be restored and is therefore
   * the only answer worth acting on here.
   */
  async function take(code: string) {
    clearJoin();
    stage = { at: 'looking', code };

    const session = await supabaseAuthService.getSession().catch(() => null);
    if (session?.user) {
      stage = { at: 'join', code };
      return;
    }
    await lookUpPublicly(code);
  }

  async function lookUpPublicly(code: string) {
    try {
      const data = await sharedNotebookStore.readPublic(code);
      stage = { at: 'public', code, data };
    } catch {
      // Not distinguished, and that is the point: the function answers the same
      // way for a private notebook and for a code that was never issued, so a
      // stranger working through codes learns nothing from the difference.
      // The wording below therefore has to cover both without guessing.
      stage = { at: 'refused', code };
    }
  }

  function dismiss() {
    stage = { at: 'idle' };
  }

  /**
   * Joined — say which one, and put it on screen.
   *
   * Opening a panel is a real change to somebody's layout, so it is only done
   * where there is room for one; at the window limit the notice carries it
   * instead, and Notes → Shared is a tap away.
   */
  function joined(notebook: SharedNotebook) {
    stage = { at: 'idle' };
    showNotice(`Joined “${notebook.name || 'the notebook'}”`);

    const id = windowStore.createWindow('right');
    if (id) windowStore.setWindowContent(id, 'notes', { mode: 'shared' });
  }

  function signIn() {
    stage = { at: 'idle' };
    profileModalStore.open();
  }
</script>

{#if stage.at === 'join'}
  <SharedNotebookJoin
    mode="join"
    prefill={stage.code}
    on:joined={(e) => joined(e.detail)}
    on:close={dismiss}
  />
{:else if stage.at === 'public'}
  <PublicNotebookReader code={stage.code} data={stage.data} on:close={dismiss} />
{:else if stage.at === 'looking'}
  <div class="sjl-card" role="status">
    <p class="sjl-text">Opening {formatJoinCode(stage.code)}…</p>
  </div>
{:else if stage.at === 'refused'}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="sjl-backdrop" on:click={dismiss}>
    <!-- tabindex because this one stops clicks reaching the backdrop, which
         makes it interactive as far as the a11y rules are concerned. -->
    <div class="sjl-card" role="dialog" aria-modal="true" tabindex="-1" on:click|stopPropagation>
      <p class="sjl-title">{formatJoinCode(stage.code)}</p>
      <p class="sjl-text">
        Nothing is being shared publicly with that code. If it is a private notebook, sign in and
        open the link again — a private one needs an account even to read.
      </p>
      <div class="sjl-actions">
        <button class="sjl-btn sjl-btn-quiet" on:click={dismiss}>Close</button>
        <button class="sjl-btn sjl-btn-go" on:click={signIn}>Sign in</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .sjl-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    padding: 20px;
  }

  .sjl-card {
    background: #1e1e1e;
    border: 1px solid #333;
    border-radius: 14px;
    padding: 20px;
    width: 100%;
    max-width: 380px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
  }

  /* The "Opening…" card stands on its own, with no backdrop behind it — it is
     there for a second at most and should not black out the app to say so. */
  .sjl-card[role='status'] {
    position: fixed;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    z-index: 10000;
    width: auto;
  }

  .sjl-title {
    margin: 0 0 8px;
    font-family: 'Courier New', monospace;
    font-size: 1.125rem;
    font-weight: 700;
    letter-spacing: 0.16em;
    color: #5eead4;
  }

  .sjl-text {
    margin: 0;
    font-size: 0.8125rem;
    line-height: 1.55;
    color: #aaa;
  }

  .sjl-actions {
    display: flex;
    gap: 10px;
    margin-top: 18px;
    justify-content: flex-end;
  }

  .sjl-btn {
    padding: 8px 18px;
    border-radius: 18px;
    border: none;
    font-size: 0.8125rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
  }

  .sjl-btn-quiet {
    background: #2a2a2a;
    color: #ddd;
    border: 1px solid #3a3a3a;
  }
  .sjl-btn-quiet:hover {
    background: #333;
  }

  .sjl-btn-go {
    background: #0d9488;
    color: #fff;
  }
  .sjl-btn-go:hover {
    background: #0f766e;
  }
</style>
