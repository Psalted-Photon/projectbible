<script lang="ts">
  /** A saved verse's translation in brackets. NET links to netbible.org wherever it is quoted. */
  import { translationLabel } from '../../lib/bibleData';

  export let translation: string;

  $: label = translationLabel(translation);
  $: isNet = translation.toLowerCase() === 'net';
</script>

{#if isNet}
  <a class="tr" href="http://netbible.org" target="_blank" rel="noopener noreferrer" on:click|stopPropagation>({label})</a>
{:else}
  <span class="tr">({label})</span>
{/if}

<style>
  .tr {
    font-weight: 400;
    opacity: 0.7;
    color: inherit;
  }
</style>
