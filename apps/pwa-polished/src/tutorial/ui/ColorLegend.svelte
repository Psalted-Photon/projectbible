<script lang="ts">
  /**
   * The ten book families and their colors, read from the app's own palette so
   * the legend can never disagree with what the book picker shows.
   */
  import { CATEGORY_COLORS, CATEGORY_LABELS } from "../../lib/bibleData";

  const families = (Object.keys(CATEGORY_COLORS) as Array<keyof typeof CATEGORY_COLORS>).map(
    (key) => ({ key, color: CATEGORY_COLORS[key], label: CATEGORY_LABELS[key] })
  );
</script>

<ul class="legend" aria-label="Book families">
  {#each families as f (f.key)}
    <li>
      <span class="swatch" style="--swatch:{f.color}"></span>
      <span class="label">{f.label}</span>
    </li>
  {/each}
</ul>

<style>
  .legend {
    list-style: none;
    margin: 0.7rem 0 0;
    padding: 0;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.35rem 0.8rem;
  }

  li {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    min-width: 0;
  }

  .swatch {
    flex-shrink: 0;
    width: 0.8rem;
    height: 0.8rem;
    border-radius: 3px;
    background: var(--swatch);
    box-shadow: 0 0 8px color-mix(in srgb, var(--swatch) 55%, transparent);
  }

  .label {
    font-size: 0.78rem;
    color: var(--tut-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
