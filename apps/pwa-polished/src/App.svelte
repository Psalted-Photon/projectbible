<script lang="ts">
  import BibleReader from "./components/BibleReader.svelte";
  import LexicalModal from "./components/LexicalModal.svelte";
  import ReadingPlanModal from "./components/ReadingPlanModal.svelte";
  import DailyGreetingModal from "./components/DailyGreetingModal.svelte";
  import ProfileModal from "./components/ProfileModal.svelte";
  import WindowContainer from "./components/WindowContainer.svelte";
  import PaneContainer from "./components/PaneContainer.svelte";
  import ProgressModal from "./components/ProgressModal.svelte";
  import { windowStore } from "./lib/stores/windowStore";
  import { currentDownload, showProgressModal } from "./lib/pack-triggers";
  import { onMount } from "svelte";
  import { syncService } from "./lib/sync";
  import { readingPlanModalStore } from "./stores/readingPlanModalStore";  import { localDateStr } from './stores/clockStore';  import { todayStore } from './stores/clockStore';  import { checkAndShowDailyGreeting } from './stores/dailyGreetingStore';  import "./adapters/SyncedReadingAdapter"; // registers reading plan/progress pull handlers
  import "./adapters/SyncedHighlightAdapter"; // registers verse/word highlight pull handlers
  import { getSettings } from "./adapters/settings";

  let appReady = false;
  let showReadingPlanModal = false;

  // ── Orientation lock ──────────────────────────────────────────────────────
  // "Scratch mark" approach: record screen.orientation.angle at lock time,
  // then counter-rotate the UI by the difference on every change.
  // Works on tablets where screen.orientation.lock() is silently ignored.
  let lockedAngle: number | null = null;
  let cssRotation: number = 0; // 0 | 90 | 180 | 270

  function updateOrientationTransform() {
    if (lockedAngle === null || typeof screen === 'undefined' || !screen.orientation) {
      cssRotation = 0;
      return;
    }
    cssRotation = (screen.orientation.angle - lockedAngle + 360) % 360;
  }

  async function reEnforceJsLock() {
    if (typeof screen === 'undefined' || !screen.orientation) return;
    const { allowRotation } = getSettings();
    if (!allowRotation) {
      try {
        await (screen.orientation as any).lock('portrait-primary');
      } catch {
        try {
          await (screen.orientation as any).lock('portrait');
        } catch { /* tablet — CSS rotation handles it */ }
      }
    }
  }

  async function applyOrientationLock() {
    if (typeof screen === 'undefined' || !screen.orientation) return;
    const { allowRotation } = getSettings();
    if (allowRotation) {
      screen.orientation.unlock();
      lockedAngle = null;
      cssRotation = 0;
    } else {
      // Scratch the mark: capture the current angle as the locked orientation
      lockedAngle = screen.orientation.angle;
      cssRotation = 0; // currently at the locked position — no transform needed
      await reEnforceJsLock();
    }
  }

  function handleOrientationChange() {
    const root = document.querySelector('.app-root') as HTMLElement | null;
    if (root) {
      root.style.transition = 'opacity 0.25s ease';
      root.style.opacity = '0';
      setTimeout(() => { root.style.opacity = '1'; }, 350);
    }
    // Recompute how far we've drifted from the scratch mark
    updateOrientationTransform();
    // Re-attempt JS lock (phones may release it on rotate)
    void reEnforceJsLock();
  }

  function handleVisibilityResume() {
    if (!document.hidden) {
      // Recompute CSS rotation — device may have rotated while backgrounded
      updateOrientationTransform();
      // Re-attempt JS lock
      void reEnforceJsLock();
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  // Initialize Eruda for mobile debugging
  onMount(() => {
    console.log("🚀 App mounted, initializing...");
    const init = async () => {
      if (typeof window !== "undefined") {
        const eruda = await import("eruda");
        eruda.default.init();
        // Make the eruda button draggable
        eruda.default.position({
          x: window.innerWidth - 60,
          y: window.innerHeight - 60,
        });
        console.log("🐛 Eruda initialized");
      }
      appReady = true;
      console.log("✅ App ready");
    };

    const handleVisibility = () => {
      if (document.hidden) return;
      // Re-sync when the user switches back to this tab so progress written
      // on another device is pulled into IndexedDB. Throttled to at most
      // once every 30 s and guarded by the forceSync mutex so it can never
      // pile up or leave the status stuck on "Syncing..."
      void syncService.forceSync(30_000);
    };

    document.addEventListener("visibilitychange", handleVisibility);

    // Re-enforce orientation lock on visibility resume (handles tablet app-switching)
    document.addEventListener("visibilitychange", handleVisibilityResume);
    
    // Apply orientation lock based on saved setting
    void applyOrientationLock();

    // Re-apply orientation lock whenever settings are saved
    window.addEventListener('settingsUpdated', applyOrientationLock);

    // Fade-in transition when orientation changes
    screen.orientation?.addEventListener('change', handleOrientationChange);

    // Initialize sync service (connects if user is already signed in)
    void syncService.init();
    void init();

    const unsubscribeReadingPlan = readingPlanModalStore.subscribe((value) => {
      if (showReadingPlanModal !== value) {
        showReadingPlanModal = value;
      }
    });

    // Global keyboard shortcuts
    const handleGlobalKeydown = (e: KeyboardEvent) => {
      // Check if user is typing in an input field
      const target = e.target as HTMLElement;
      const isInputField = target.tagName === 'INPUT' || 
                          target.tagName === 'TEXTAREA' || 
                          target.contentEditable === 'true';
      
      // J key - open journal (only if not typing)
      if (e.key === 'j' && !e.ctrlKey && !e.metaKey && !e.altKey && !isInputField) {
        e.preventDefault();
        const windowId = windowStore.createWindow('right', 50);
        if (windowId) {
          windowStore.setWindowContent(windowId, 'journal', {
            date: localDateStr(new Date())
          });
        }
      }
    };
    
    document.addEventListener('keydown', handleGlobalKeydown);

    // Silent auto-check for updates on app open
    if (getSettings().autoCheckUpdates !== false && 'serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration().then(reg => {
        if (reg) reg.update().catch(() => { /* silent */ });
      }).catch(() => { /* silent */ });
    }

    // Show daily greeting on first open of each new day
    setTimeout(() => checkAndShowDailyGreeting(), 800);

    // Also trigger when the date rolls over at midnight while the app is open
    const unsubscribeToday = todayStore.subscribe(() => checkAndShowDailyGreeting());

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      document.removeEventListener('keydown', handleGlobalKeydown);
      window.removeEventListener('settingsUpdated', applyOrientationLock);
      screen.orientation?.removeEventListener('change', handleOrientationChange);
      unsubscribeReadingPlan();
      unsubscribeToday();
    };
  });

  $: readingPlanModalStore.set(showReadingPlanModal);

  // Calculate main content area based on open panels
  $: leftPanels = $windowStore.filter((w) => w.edge === "left");
  $: rightPanels = $windowStore.filter((w) => w.edge === "right");
  $: topPanels = $windowStore.filter((w) => w.edge === "top");
  $: bottomPanels = $windowStore.filter((w) => w.edge === "bottom");

  $: leftWidth = leftPanels.reduce((sum, p) => sum + p.size, 0);
  $: rightWidth = rightPanels.reduce((sum, p) => sum + p.size, 0);
  $: topHeight = topPanels.reduce((sum, p) => sum + p.size, 0);
  $: bottomHeight = bottomPanels.reduce((sum, p) => sum + p.size, 0);

  $: mainContentStyle = `
    position: fixed;
    left: ${leftWidth}%;
    right: ${rightWidth}%;
    top: ${topHeight}%;
    bottom: ${bottomHeight}%;
  `;

  // Log main content area changes
  $: {
    console.log("📐 MAIN CONTENT AREA:", {
      leftPanels: leftPanels.length,
      rightPanels: rightPanels.length,
      topPanels: topPanels.length,
      bottomPanels: bottomPanels.length,
      margins: {
        left: `${leftWidth.toFixed(1)}%`,
        right: `${rightWidth.toFixed(1)}%`,
        top: `${topHeight.toFixed(1)}%`,
        bottom: `${bottomHeight.toFixed(1)}%`,
      },
      availableWidth: `${(100 - leftWidth - rightWidth).toFixed(1)}%`,
      availableHeight: `${(100 - topHeight - bottomHeight).toFixed(1)}%`,
    });
  }
</script>

<div class="app-root">
  {#if !appReady}
    <div
      style="display: flex; align-items: center; justify-content: center; height: 100vh; color: white; font-size: 20px;"
    >
      Loading App...
    </div>
  {:else}
    <div class="main-content themed" style={mainContentStyle}>
      <BibleReader />
    </div>
    <WindowContainer />
    <PaneContainer />
    <ProgressModal progress={$currentDownload} visible={$showProgressModal} />
    
    <!-- Shared Lexical Modal (single instance for all Bible readers) -->
    <LexicalModal />

    <!-- Shared Reading Plan Modal -->
    <ReadingPlanModal bind:isOpen={showReadingPlanModal} />

    <!-- Shared Profile Modal -->
    <ProfileModal />

    <!-- Daily Greeting & Verse of the Day -->
    <DailyGreetingModal />
  {/if}
</div>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    overflow: hidden;
  }

  :global(body.light-theme) {
    background: #f5f5f5;
  }

  :global(.emoji) {
    display: inline-block;
  }

  :global(body.sepia-theme) {
    background: #f6f0e3;
  }

  :global(body.light-theme .themed) {
    filter: invert(1) hue-rotate(180deg);
  }

  :global(body.light-theme .themed .emoji) {
    filter: invert(1) hue-rotate(180deg);
  }

  :global(body.sepia-theme .themed) {
    filter: invert(1) hue-rotate(180deg) sepia(0.5) saturate(0.85);
  }

  :global(body.sepia-theme .themed .emoji) {
    filter: invert(1) hue-rotate(180deg);
  }

  /* Red-letter (Jesus' words) — theme-aware */
  /* On light/sepia themes, the parent .themed has filter: invert(1) hue-rotate(180deg)
     which bleaches red. We apply the same filter on .red-letter itself to cancel it,
     so the CSS color renders directly. Sepia still goes through sepia(0.5) saturate(0.85)
     so a more vivid starting color is used there. */
  :global(.red-letter) { color: #CC0000; }
  :global(body.dark-theme .red-letter) { color: #FF3F3F; }
  :global(body.light-theme .red-letter) {
    filter: invert(1) hue-rotate(180deg);
    color: #CC0000;
  }
  :global(body.sepia-theme .red-letter) {
    filter: invert(1) hue-rotate(180deg);
    color: #FF2020;
  }

  /* Hide scrollbars but keep scroll functionality */
  :global(*) {
    scrollbar-width: none; /* Firefox */
    -ms-overflow-style: none; /* IE and Edge */
  }

  :global(*::-webkit-scrollbar) {
    display: none; /* Chrome, Safari, Opera */
  }

  .app-root {
    width: 100%;
    height: 100vh;
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: row;
    background: #1a1a1a;
  }

  .main-content {
    position: fixed;
    box-sizing: border-box;
    overflow: auto;
    transition:
      left 0.3s ease,
      right 0.3s ease,
      top 0.3s ease,
      bottom 0.3s ease;
    z-index: 1;
  }
</style>
