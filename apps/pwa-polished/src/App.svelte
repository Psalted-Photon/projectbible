<script lang="ts">
  import BibleReader from "./components/BibleReader.svelte";
  import LexicalModal from "./components/LexicalModal.svelte";
  import WindowContainer from "./components/WindowContainer.svelte";
  import PaneContainer from "./components/PaneContainer.svelte";
  import ProgressModal from "./components/ProgressModal.svelte";
  import { windowStore } from "./lib/stores/windowStore";
  import { currentDownload, showProgressModal } from "./lib/pack-triggers";
  import { onMount } from "svelte";
  import { syncOrchestrator } from "./services/SyncOrchestrator";

  let appReady = false;
  let lastHiddenAt: number | null = null;

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
      if (document.hidden) {
        lastHiddenAt = Date.now();
        return;
      }
      if (!lastHiddenAt) return;
      const elapsed = Date.now() - lastHiddenAt;
      if (elapsed > 5 * 60 * 1000) {
        void syncOrchestrator.processQueue();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    void init();

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  });

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
    <div class="main-content" style={mainContentStyle}>
      <BibleReader />
    </div>
    <WindowContainer />
    <PaneContainer />
    <ProgressModal progress={$currentDownload} visible={$showProgressModal} />
    
    <!-- Shared Lexical Modal (single instance for all Bible readers) -->
    <LexicalModal />
  {/if}
</div>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    overflow: hidden;
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
