<script lang="ts" context="module">
  export type PanelIconName =
    | 'bible' | 'map' | 'commentary' | 'notes' | 'journal'
    | 'encyclopedia' | 'topical' | 'people' | 'art';

  /**
   * Line art drawn for the window picker — one entry per panel type, each a list
   * of path commands on a 24x24 grid. Same convention as the hand-drawn SVGs in
   * the library panes: no fills, stroke only, round caps and joins, so a single
   * drawing carries both the dark halo and the white line (see the markup).
   *
   * The nine have to stay legible at 20px and, more importantly, tell each other
   * apart at 20px — hence three different book silhouettes rather than three
   * books: the Bible is open and spread, the journal is closed and clasped, the
   * encyclopedia is a shelf of volumes.
   */
  const PATHS: Record<PanelIconName, string[]> = {
    // Open book, centre spine, a cross on the left page.
    bible: [
      'M12 7C10.4 5.6 8 5 5 5H3v12h2c3 0 5.4.6 7 2',
      'M12 7c1.6-1.4 4-2 7-2h2v12h-2c-3 0-5.4.6-7 2',
      'M12 7v12',
      'M7.2 9.4v4.4',
      'M5 11.6h4.4',
    ],
    // Three-panel folded map, creased, with a pin dropped on the middle panel.
    map: [
      'M3 6.4l6-2.4 6 2.4 6-2.4v13.6l-6 2.4-6-2.4-6 2.4z',
      'M9 4v13.6',
      'M15 6.4V20',
      'M12 13.4c1.5-1.9 2.4-3.1 2.4-4.2a2.4 2.4 0 10-4.8 0c0 1.1.9 2.3 2.4 4.2z',
      'M13.1 9.4a1.1 1.1 0 11-2.2 0 1.1 1.1 0 012.2 0z',
    ],
    // Scroll: rolled bars top and bottom, two rules of text between them.
    commentary: [
      'M7 4.6h10a2 2 0 010 4H7a2 2 0 010-4z',
      'M7 15.4h10a2 2 0 010 4H7a2 2 0 010-4z',
      'M7 8.6v6.8',
      'M17 8.6v6.8',
      'M9.6 10.8h4.8',
      'M9.6 13.2h3.2',
    ],
    // Page with a folded corner and three ruled lines.
    notes: [
      'M13.4 3.6H7A1.4 1.4 0 005.6 5v14A1.4 1.4 0 007 20.4h10a1.4 1.4 0 001.4-1.4V8.6z',
      'M13.4 3.6v5h5',
      'M8.6 12.6h6.8',
      'M8.6 15.4h6.8',
      'M8.6 18.2h4.2',
    ],
    // Closed book with a spine band and a clasp on the fore edge — a diary.
    journal: [
      'M5.8 3.8h11a1.6 1.6 0 011.6 1.6v13.2a1.6 1.6 0 01-1.6 1.6h-11z',
      'M8.4 3.8v16.4',
      'M18.4 11h1.4a.6.6 0 01.6.6v1.2a.6.6 0 01-.6.6h-1.4',
    ],
    // Three volumes of different heights standing on a shelf.
    encyclopedia: [
      'M5.3 8.4h4v10.8h-4z',
      'M10 6.6h4v12.6h-4z',
      'M14.7 9.6h4v9.6h-4z',
      'M3.4 19.2h17.2',
      'M10 9.4h4',
    ],
    // One node branching to three — an index, not a book.
    topical: [
      'M7.4 12a1.8 1.8 0 11-3.6 0 1.8 1.8 0 013.6 0z',
      'M19.6 6a1.6 1.6 0 11-3.2 0 1.6 1.6 0 013.2 0z',
      'M19.6 12a1.6 1.6 0 11-3.2 0 1.6 1.6 0 013.2 0z',
      'M19.6 18a1.6 1.6 0 11-3.2 0 1.6 1.6 0 013.2 0z',
      'M7.4 12h9',
      'M10.4 12V7.4A1.4 1.4 0 0111.8 6h4.6',
      'M10.4 12v4.6A1.4 1.4 0 0011.8 18h4.6',
    ],
    // A bust standing in an arched niche.
    people: [
      'M4.6 20.4V9.6a7.4 7.4 0 0114.8 0v10.8z',
      'M14.6 11.2a2.6 2.6 0 11-5.2 0 2.6 2.6 0 015.2 0z',
      'M7.6 20.4a4.4 4.4 0 018.8 0',
    ],
    // Square frame around a landscape — deliberately not the arch above.
    art: [
      'M3.8 4.8h16.4v14.4H3.8z',
      'M5.6 17.6l4-4.8 2.8 3.2 2.2-2.4 3.8 4',
      'M16.6 9.6a1.3 1.3 0 11-2.6 0 1.3 1.3 0 012.6 0z',
    ],
  };
</script>

<script lang="ts">
  export let name: PanelIconName;
  export let size = 20;

  $: paths = PATHS[name];
</script>

<!-- Drawn twice: a fat dark pass laying down the halo, then the white line on
     top of it. Same read as the nav bar's badges, which stack a bold Phosphor
     icon under a thin one — but with stroke widths instead of two font weights,
     so one set of path data serves both. -->
<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  aria-hidden="true"
  focusable="false"
>
  <g stroke="#000" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round" opacity="0.55">
    {#each paths as d}<path {d} />{/each}
  </g>
  <g stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    {#each paths as d}<path {d} />{/each}
  </g>
</svg>

<style>
  svg {
    display: block;
    flex-shrink: 0;
  }
</style>
