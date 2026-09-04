<script lang="ts">
  import { dumpPreviousInstallLog } from "./lib/install-log";
  import BibleReader from "./components/BibleReader.svelte";
  import LookupModal from "./components/LookupModal.svelte";
  import ReadingPlanModal from "./components/ReadingPlanModal.svelte";
  import DailyGreetingModal from "./components/DailyGreetingModal.svelte";
  import UpdateNotice from "./components/UpdateNotice.svelte";
  import WakeAlarmStart from "./components/WakeAlarmStart.svelte";
  import { wakeAlarmStartOpen } from "./stores/wakeAlarmStore";
  import ProfileModal from "./components/ProfileModal.svelte";
  import WindowContainer from "./components/WindowContainer.svelte";
  import PaneContainer from "./components/PaneContainer.svelte";
  import ProgressModal from "./components/ProgressModal.svelte";
  import { windowStore } from "./lib/stores/windowStore";
  import { currentDownload, showProgressModal } from "./lib/pack-triggers";
  import { onMount } from "svelte";
  import { syncService } from "./lib/sync";
  import { readingPlanModalStore } from "./stores/readingPlanModalStore";  import { localDateStr } from './stores/clockStore';  import { todayStore } from './stores/clockStore';  import { checkAndShowDailyGreeting, dailyGreetingOpen, openDailyGreeting } from './stores/dailyGreetingStore';  import { get } from 'svelte/store';  import "./adapters/SyncedReadingAdapter"; // registers reading plan/progress pull handlers
  import "./adapters/SyncedHighlightAdapter"; // registers verse/word highlight pull handlers
  import { getSettings } from "./adapters/settings";

  let appReady = false;
  let showReadingPlanModal = false;

  // ── Orientation lock ──────────────────────────────────────────────────────
  async function applyOrientationLock() {
    if (typeof screen === 'undefined' || !screen.orientation) return;
    const { allowRotation } = getSettings();
    try {
      if (allowRotation) {
        screen.orientation.unlock();
      } else {
        try {
          await (screen.orientation as any).lock('portrait-primary');
        } catch {
          await (screen.orientation as any).lock('portrait');
        }
      }
    } catch {
      // Desktop/tablet browsers may not support orientation lock — ignore
    }
  }

  function handleOrientationChange() {
    const root = document.querySelector('.app-root') as HTMLElement | null;
    if (root) {
      root.style.transition = 'opacity 0.25s ease';
      root.style.opacity = '0';
      setTimeout(() => { root.style.opacity = '1'; }, 350);
    }
    // Do NOT re-apply lock here — it fights the OS on tablet and confuses mobile
  }

  function handleVisibilityResume() {
    if (!document.hidden) {
      void applyOrientationLock();
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  // Initialize Eruda for mobile debugging
  onMount(() => {
    console.log("🚀 App mounted, initializing...");
    const init = async () => {
      // Eruda stays on in production by choice -- it is how this app gets
      // debugged on a real phone. Do not gate it behind a flag.
      if (typeof window !== "undefined") {
        const eruda = await import("eruda");
        eruda.default.init();
        // Make the eruda button draggable
        eruda.default.position({
          x: window.innerWidth - 60,
          y: window.innerHeight - 60,
        });
        console.log("🐛 Eruda initialized");
        // Only now is there a console to print into. The startup replay in
        // main.ts runs before this and is therefore invisible on the phone.
        dumpPreviousInstallLog();
      }
      appReady = true;
      console.log("✅ App ready (auto-update test build 2)");
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

    // Auto-update on open: check for a new service worker now and whenever the
    // app returns to the foreground (an installed PWA usually resumes rather
    // than relaunching, so onMount alone misses most "reopens"). When a new
    // worker takes control, reload once so the update is visible immediately;
    // UpdateNotice shows "Running Latest Version" after that reload. The
    // hadController guard skips the very first install, and the one-shot flag
    // prevents reload loops.
    let swReloaded = false;
    const hadController =
      'serviceWorker' in navigator && !!navigator.serviceWorker.controller;
    const handleControllerChange = () => {
      if (swReloaded || !hadController) return;
      if (getSettings().autoCheckUpdates === false) return;
      swReloaded = true;
      sessionStorage.setItem('pb-updated', '1');
      // Remember an open Verse of the Day so the reload doesn't swallow it.
      // Covers the case where today's greeting was already dismissed and then
      // reopened from the navbar — checkAndShowDailyGreeting won't restore that.
      if (get(dailyGreetingOpen)) sessionStorage.setItem('pb-votd-open', '1');
      window.location.reload();
    };
    const checkForSwUpdate = () => {
      if (getSettings().autoCheckUpdates === false) return;
      if (!('serviceWorker' in navigator)) return;
      navigator.serviceWorker.ready
        .then((reg) => reg.update().catch(() => { /* silent */ }))
        .catch(() => { /* silent */ });
    };
    const handleVisibilityUpdateCheck = () => {
      if (!document.hidden) checkForSwUpdate();
    };
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);
    }
    document.addEventListener('visibilitychange', handleVisibilityUpdateCheck);
    checkForSwUpdate();

    // ── Wake alarm ──────────────────────────────────────────────────────────
    // Two ways in. A cold launch arrives at ?alarm=1, the URL the service
    // worker opened. A warm launch (app already running, notification tapped)
    // gets no navigation at all, so the service worker messages us instead.
    const openWakeAlarmStart = () => wakeAlarmStartOpen.set(true);

    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('alarm') === '1') {
        openWakeAlarmStart();
        // Strip the flag so a later reload — including the auto-update reload
        // above — does not resurrect the start screen.
        params.delete('alarm');
        params.delete('test');
        const query = params.toString();
        window.history.replaceState({}, '', window.location.pathname + (query ? `?${query}` : ''));
      }
    } catch {
      // A malformed URL must not stop the app from starting.
    }

    const handleSwMessage = (event: MessageEvent) => {
      if (event.data?.type === 'wake-alarm-opened') openWakeAlarmStart();
    };
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleSwMessage);
    }

    // Show daily greeting on first open of each new day
    setTimeout(() => checkAndShowDailyGreeting(), 800);

    // Also trigger when the date rolls over at midnight while the app is open
    const unsubscribeToday = todayStore.subscribe(() => checkAndShowDailyGreeting());

    // Restore a Verse of the Day that was open when the auto-update reloaded us
    if (sessionStorage.getItem('pb-votd-open')) {
      sessionStorage.removeItem('pb-votd-open');
      openDailyGreeting();
    }

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      document.removeEventListener('visibilitychange', handleVisibilityUpdateCheck);
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
        navigator.serviceWorker.removeEventListener('message', handleSwMessage);
      }
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
    
    <!-- The one lookup card: dictionary, topical, encyclopedia and bios all
         live in it, and the tabs across its top switch between them. -->
    <LookupModal />

    <!-- Shared Reading Plan Modal -->
    <ReadingPlanModal bind:isOpen={showReadingPlanModal} />

    <!-- Shared Profile Modal -->
    <ProfileModal />

    <!-- Daily Greeting & Verse of the Day -->
    <DailyGreetingModal />

    <!-- "Running Latest Version" toast after an auto-update reload -->
    <UpdateNotice />

    <!-- Wake alarm start screen — shown when opened from an alarm notification -->
    <WakeAlarmStart />
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
  /* Custom theme applies no filter to .themed at all, so the colour renders
     directly. --reader-red is derived from the chosen background's luminance
     (see lib/themeColors.ts) and always wins over the user's text colour —
     red letter is the one thing the Custom theme does not hand over. */
  :global(body.custom-theme .red-letter) {
    color: var(--reader-red, #FF3F3F);
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
    /* `clip`, not `auto` or `hidden`. .bible-reader scrolls itself, so this box
       never needs to — and when it *can* scroll, it breaks light and sepia. The
       theme filter on .themed makes this element the containing block for the
       reader's fixed overlays, so the annotation sheet parked off-screen at
       translateY(100%) turns into ~52vh of real scrollable overflow in here. The
       sheet's scrollIntoView (it jumps to the clicked author) then scrolls every
       scrollable ancestor, including this one, dragging the reader and its sticky
       navbar up out of view. `hidden` would not be enough: it still creates a
       programmatically scrollable container that scrollIntoView can move. On a
       browser too old for `clip` the first declaration still clips, which is a
       far better fallback than dropping to the `visible` default. */
    overflow: hidden;
    overflow: clip;
    transition:
      left 0.3s ease,
      right 0.3s ease,
      top 0.3s ease,
      bottom 0.3s ease;
    z-index: 1;
  }
</style>
