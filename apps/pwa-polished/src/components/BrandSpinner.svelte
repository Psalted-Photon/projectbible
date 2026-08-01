<script lang="ts">
  /**
   * The ProjectBible gem, spinning, shown while Read Aloud is generating audio.
   *
   * `pb-gem.png` is the app icon's own artwork with the black tile behind it
   * removed and cropped to the gem — in the original, the tile fills 182 of 192
   * pixels and the gem only 90, so the icon as shipped spins mostly as a black
   * square. Its internal seams are kept, not cleared, or the cross falls apart
   * on the light and sepia themes. The image is padded to a square wide enough
   * for the gem's diagonal, so nothing is clipped as it turns.
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
    animation: brand-spin 1.1s linear infinite;
  }

  @keyframes brand-spin {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
  }
</style>
