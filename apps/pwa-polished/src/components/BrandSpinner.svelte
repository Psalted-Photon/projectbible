<script lang="ts">
  /**
   * The ProjectBible icon, spinning, shown while Read Aloud is generating audio.
   *
   * Uses the real app icon rather than a redrawn one — it is already precached
   * as a manifest icon, so it appears instantly and works offline.
   *
   * Deliberately spins even when the phone's reduce-motion setting is on. That
   * setting is aimed at animation that travels across the screen; a small
   * loading indicator is conventionally exempt, and the platforms' own spinners
   * behave the same way.
   */
  export let size = 20;
  export let title = 'Preparing speech…';
</script>

<img
  class="brand-spinner"
  src="/pwa-192x192.png"
  alt=""
  {title}
  role="status"
  aria-label={title}
  style="width: {size}px; height: {size}px;"
/>

<style>
  .brand-spinner {
    display: inline-block;
    flex-shrink: 0;
    vertical-align: middle;
    animation: brand-spin 1.1s linear infinite;
    /* Its own dark background against a dark bar; a touch of lift keeps the
       edges from disappearing entirely. */
    border-radius: 4px;
  }

  @keyframes brand-spin {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
  }
</style>
