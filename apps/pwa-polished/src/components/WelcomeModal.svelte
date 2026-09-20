<script lang="ts">
  import { get } from 'svelte/store';
  import { welcomePending, dismissWelcome } from '../stores/welcomeStore';
  import { userProfileStore } from '../stores/userProfileStore';
  import { navigationStore } from '../stores/navigationStore';
  import { WELCOME_VERSE } from '../data/welcome-verse';
  import { HandHeart, ArrowRight } from 'phosphor-svelte';

  $: name = $userProfileStore.name?.trim() ?? '';
  // The welcome is owed to a signed-in account; the confirmation link signs
  // them in, but the session lands a moment after the flag does.
  $: open = $welcomePending && $userProfileStore.isSignedIn;

  function close() {
    dismissWelcome();
  }

  function goToVerse() {
    const current = get(navigationStore);
    navigationStore.pushHistory(current);
    navigationStore.navigateToVerse(
      current.translation,
      WELCOME_VERSE.book,
      WELCOME_VERSE.chapter,
      WELCOME_VERSE.verse,
    );
    close();
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="dg-overlay" on:click={close}>
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div class="dg-card" on:click|stopPropagation role="dialog" aria-modal="true" aria-label="Welcome">
      <div class="dg-header">
        <span class="dg-icon">
          <HandHeart size={18} weight="bold" />
          <span class="icon-overlay"><HandHeart size={18} weight="thin" /></span>
        </span>
        <div class="dg-header-text">
          <span class="dg-title">{name ? `Welcome, ${name}` : 'Welcome'}</span>
          <span class="dg-date-label">Your account is confirmed</span>
        </div>
      </div>

      <div class="wm-thanks">
        <p>
          Thank you for joining. Everything you mark, note or write is now yours across every
          device you sign in on.
        </p>
      </div>

      <div class="dg-verse-block">
        <div class="dg-verse-ref">{WELCOME_VERSE.reference}</div>
        <p class="dg-verse-text">{WELCOME_VERSE.text}</p>
        <div class="wm-credit">
          <a href="https://netbible.org" target="_blank" rel="noopener noreferrer">NET</a>
        </div>
      </div>

      <div class="dg-actions">
        <button class="dg-btn-primary" on:click={goToVerse}>
          Start reading <ArrowRight size={14} weight="bold" />
        </button>
        <button class="dg-btn-secondary" on:click={close}>Close</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .dg-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.72);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    padding: 20px;
    backdrop-filter: blur(4px);
  }

  .dg-card {
    background: #1c1c1e;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 16px;
    max-width: 480px;
    width: 100%;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .dg-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 16px 20px 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  }

  .dg-icon {
    color: #431407;
    background: radial-gradient(circle, #fde047 0%, #fde047 20%, #431407 100%);
    border-radius: 6px;
    padding: 4px;
    display: flex;
    align-items: center;
    flex-shrink: 0;
    position: relative;
  }
  .icon-overlay {
    position: absolute;
    top: 0; right: 0; bottom: 0; left: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    line-height: 0;
  }
  :global(.dg-icon > svg) {
    filter: drop-shadow(0 0 2px #431407) drop-shadow(0 0 2px #431407);
  }

  .dg-header-text {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .dg-title {
    font-size: 0.95rem;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.92);
    letter-spacing: 0.01em;
  }

  .dg-date-label {
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.4);
  }

  .wm-thanks {
    padding: 16px 20px 4px;
  }

  .wm-thanks p {
    margin: 0;
    font-size: 0.88rem;
    line-height: 1.6;
    color: rgba(255, 255, 255, 0.62);
  }

  .dg-verse-block {
    margin: 14px 20px 0;
    padding: 18px 18px 14px;
    background: rgba(230, 184, 74, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 12px;
  }

  .dg-verse-ref {
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #e6b84a;
    margin-bottom: 10px;
  }

  .dg-verse-text {
    margin: 0;
    font-size: var(--base-font-size, 18px);
    line-height: var(--line-spacing, 1.8);
    color: rgba(255, 255, 255, 0.85);
    font-style: italic;
  }

  /* The licence asks for "(NET)" after the quotation, with the letters
     linking out to netbible.org wherever there is a connection. */
  .wm-credit {
    margin-top: 10px;
    font-size: 0.72rem;
    color: rgba(255, 255, 255, 0.35);
  }

  .wm-credit a {
    color: rgba(230, 184, 74, 0.75);
    text-decoration: none;
  }

  .wm-credit a:hover {
    text-decoration: underline;
  }

  .dg-actions {
    display: flex;
    gap: 10px;
    padding: 16px 20px;
    justify-content: flex-end;
  }

  .dg-btn-primary {
    display: flex;
    align-items: center;
    gap: 6px;
    background: #e6b84a;
    color: #111;
    border: none;
    border-radius: 8px;
    padding: 9px 16px;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, opacity 0.15s;
  }
  .dg-btn-primary:hover {
    background: #f0c96a;
  }

  .dg-btn-secondary {
    background: rgba(255, 255, 255, 0.07);
    color: rgba(255, 255, 255, 0.55);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    padding: 9px 16px;
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }
  .dg-btn-secondary:hover {
    background: rgba(255, 255, 255, 0.12);
    color: rgba(255, 255, 255, 0.75);
  }

  @media (max-width: 520px) {
    .dg-card {
      max-width: 100%;
      border-radius: 12px;
    }
    .dg-actions {
      flex-direction: column-reverse;
    }
    .dg-btn-primary,
    .dg-btn-secondary {
      width: 100%;
      justify-content: center;
    }
  }
</style>
