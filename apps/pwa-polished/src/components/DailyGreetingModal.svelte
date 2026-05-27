<script lang="ts">
  import { dailyGreetingOpen } from '../stores/dailyGreetingStore';
  import { getDailyGreeting } from '../lib/dailyGreeting';
  import { localDateStr } from '../stores/clockStore';
  import { navigationStore } from '../stores/navigationStore';
  import { IndexedDBTextStore } from '../lib/adapters';
  import { get } from 'svelte/store';
  import verseOfDay from '../data/verse-of-the-day.json';
  import { Sun, X, ArrowRight } from 'phosphor-svelte';

  const textStore = new IndexedDBTextStore();

  // Parse "Book Ch:V" or "Book Ch:V1-V2" → structured object
  function parseRef(ref: string) {
    const m = ref.match(/^(.+?)\s+(\d+):(\d+)(?:-(\d+))?$/);
    if (!m) return null;
    return {
      book: m[1],
      chapter: parseInt(m[2], 10),
      startVerse: parseInt(m[3], 10),
      endVerse: m[4] ? parseInt(m[4], 10) : parseInt(m[3], 10),
    };
  }

  // State (re-evaluated each time modal opens)
  let todayStr = '';
  let greeting = '';
  let verseRef = '';
  let parsed: ReturnType<typeof parseRef> = null;
  let verseText = '';
  let textLoading = false;

  // Reload content whenever the modal opens
  $: if ($dailyGreetingOpen) {
    todayStr = localDateStr(new Date());
    const mmdd = todayStr.slice(5); // "MM-DD"
    greeting = getDailyGreeting(todayStr);
    verseRef = (verseOfDay as Record<string, string>)[mmdd] ?? '';
    parsed = parseRef(verseRef);
    verseText = '';
    textLoading = true;
    loadVerseText();
  }

  async function loadVerseText() {
    if (!parsed) { textLoading = false; return; }
    const translation = get(navigationStore).translation;
    const parts: string[] = [];
    for (let v = parsed.startVerse; v <= parsed.endVerse; v++) {
      const t = await textStore.getVerse(translation, parsed.book, parsed.chapter, v);
      if (t) parts.push(t);
    }
    verseText = parts.join(' ');
    textLoading = false;
  }

  function close() {
    dailyGreetingOpen.set(false);
  }

  function goToVerse() {
    if (!parsed) { close(); return; }
    const current = get(navigationStore);
    // Push current location so the navbar back arrow can return here
    navigationStore.pushHistory(current);
    navigationStore.navigateTo(current.translation, parsed.book, parsed.chapter, parsed.startVerse);
    close();
  }
</script>

{#if $dailyGreetingOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="dg-overlay" on:click={close}>
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div class="dg-card" on:click|stopPropagation role="dialog" aria-modal="true" aria-label="Daily greeting">
      <!-- Header -->
      <div class="dg-header">
        <span class="dg-icon"><Sun size={18} weight="bold" /><span class="icon-overlay"><Sun size={18} weight="thin" /></span></span>
        <div class="dg-header-text">
          <span class="dg-title">Verse of the Day</span>
          <span class="dg-date-label">
            {#if todayStr}
              {new Date(todayStr + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
            {/if}
          </span>
        </div>
        <button class="dg-close" on:click={close} aria-label="Close">
          <X size={16} weight="bold" />
        </button>
      </div>

      <!-- Greeting -->
      <div class="dg-greeting">
        <p>{greeting}</p>
      </div>

      <!-- Verse -->
      <div class="dg-verse-block">
        <div class="dg-verse-ref">{verseRef}</div>
        {#if textLoading}
          <p class="dg-verse-text dg-loading">Loading…</p>
        {:else if verseText}
          <p class="dg-verse-text">{verseText}</p>
        {:else if verseRef}
          <p class="dg-verse-text dg-unavailable">Install a Bible translation to read the text here.</p>
        {/if}
      </div>

      <!-- Actions -->
      <div class="dg-actions">
        {#if parsed}
          <button class="dg-btn-primary" on:click={goToVerse}>
            Read in context <ArrowRight size={14} weight="bold" />
          </button>
        {/if}
        <button class="dg-btn-secondary" on:click={close}>Dismiss</button>
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

  /* ── Header ──────────────────────────────────────────────── */
  .dg-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 16px 20px 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  }

  .dg-icon {
    color: white;
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
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #431407;
    line-height: 0;
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

  .dg-close {
    background: none;
    border: none;
    cursor: pointer;
    color: rgba(255, 255, 255, 0.35);
    display: flex;
    align-items: center;
    padding: 4px;
    border-radius: 6px;
    transition: color 0.15s, background 0.15s;
    flex-shrink: 0;
  }
  .dg-close:hover {
    color: rgba(255, 255, 255, 0.75);
    background: rgba(255, 255, 255, 0.08);
  }

  /* ── Greeting ────────────────────────────────────────────── */
  .dg-greeting {
    padding: 20px 20px 16px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .dg-greeting p {
    margin: 0;
    font-size: 1.05rem;
    line-height: 1.55;
    color: rgba(255, 255, 255, 0.9);
    font-weight: 400;
  }

  /* ── Verse block ─────────────────────────────────────────── */
  .dg-verse-block {
    padding: 18px 20px;
    background: rgba(230, 184, 74, 0.05);
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
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

  .dg-loading {
    color: rgba(255, 255, 255, 0.35);
    font-style: normal;
    font-size: 0.85rem;
  }

  .dg-unavailable {
    color: rgba(255, 255, 255, 0.3);
    font-style: normal;
    font-size: 0.82rem;
  }

  /* ── Actions ─────────────────────────────────────────────── */
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

  /* ── Mobile ──────────────────────────────────────────────── */
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
