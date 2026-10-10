<script lang="ts">
  /**
   * The irisBible icon, spinning, shown while Read Aloud is generating audio.
   *
   * `pb-gem.png` is the bare iris, a full circle on a transparent ground (no
   * cream tile), written by scripts/build-app-icons.mjs. A circle fills its
   * square exactly, so nothing is clipped as it turns, and its cross shows the
   * turning on every theme.
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
  src="/pb-gem.png"
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
    /* 35% slower than the original 1.1s — speed × 0.65, so 1.1 / 0.65. */
    animation: brand-spin 1.69s linear infinite;
  }

  @keyframes brand-spin {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
  }
</style>
