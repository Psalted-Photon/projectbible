<script lang="ts">
  /**
   * The map's furniture: its navbar, its panels, its timeline and the panel for
   * whatever you tapped. The drawing itself lives in lib/atlas/map.js, which
   * knows nothing about any of this and talks back through callbacks.
   *
   * Split that way because the two halves have different problems. The drawing
   * has to be fast and correct; this has to survive being dragged to 380 pixels
   * wide inside a docked window, which is a thing the lab page never had to do.
   */
  import { onMount, onDestroy, tick } from 'svelte';
  import { get } from 'svelte/store';
  import 'leaflet/dist/leaflet.css';
  import ArtViewer from './ArtViewer.svelte';
  import { dragScroll } from '../lib/dragScroll';
  import { windowStore, type MapTarget } from '../lib/stores/windowStore';
  import { navigationStore } from '../stores/navigationStore';
  import { IndexedDBTextStore } from '../adapters/TextStore';
  import { renderVersePreviewHtml } from '../lib/verseRendering';
  import { createAtlasMap, TILE_BASEMAPS } from '../lib/atlas/map.js';
  import { createResizeFit } from '../lib/atlas/fit';
  import { loadAtlasIndex, getAtlasJson, atlasInstalled, releaseAtlas } from '../lib/atlas/data';
  import { searchPlaces, placesInBounds, releasePlaceIndex } from '../lib/atlas/place-index';
  import { ScriptureSearch } from '../lib/atlas/search.js';
  import { groupByBook, bookName } from '../lib/atlas/places.js';
  import { getBookColor } from '../lib/bibleData';

  export let windowId: string | undefined = undefined;

  let root: HTMLDivElement;
  let mapEl: HTMLDivElement;
  let atlas: any = null;
  let resizeObserver: ResizeObserver | null = null;
  const fitter = createResizeFit(() => atlas?.resize());

  let loading = true;
  let missing = false;
  let error: string | null = null;

  let statusText = 'starting…';
  let statusBusy = true;

  let basemapKind = 'parchment';
  let mapOpacity = 100;
  let layerOpacity = 100;
  /** Lettering fades separately from the geography it sits on. */
  let textOpacity = 100;
  let ageing = true;
  let playTimer: ReturnType<typeof setInterval> | null = null;
  let timelineOn = false;
  let eras: any[] = [];
  let eraIndex = 0;
  let era: any = null;
  let firstSurveyed = -1;
  let overlays: any[] = [];
  let showBiblical = true;
  let showLabels = true;
  let showEveryPlace = false;

  let openPanel: 'basemap' | 'layers' | 'credit' | null = null;
  let searchOpen = false;
  let searchText = '';
  let searchFocused = false;
  let scriptureHits: any[] = [];
  let modernHits: any[] = [];
  let resultsOpen = false;
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let scripture: any = null;

  /** What the reader tapped. Null when the panel is closed. */
  let info: any = null;
  let openBooks: Record<string, boolean> = {};
  /** The verse behind each reference, by OSIS id, in the reader's translation. */
  let versePreviews: Record<string, string> = {};
  const verseTextStore = new IndexedDBTextStore();

  /** The photograph being viewed full-screen, if any. */
  let viewing: any = null;

  /** The last handoff acted on, so a store write for pan/zoom doesn't re-fly. */
  let appliedTargetSeq = -1;

  $: windowState = windowId ? $windowStore.find((w) => w.id === windowId) : undefined;
  $: target = windowState?.contentState?.target as MapTarget | undefined;

  // The window says when it is being dragged. While it is, the map holds still
  // rather than redrawing the world under the pointer — see lib/atlas/fit.
  $: fitter.hold(Boolean(windowState?.isResizing));

  // A handoff can arrive long after mount, because the reader reuses an open map
  // window rather than stacking a second one. Watching the seat here is what
  // makes the second and third handoff work as well as the first.
  $: if (atlas && target && target.seq !== appliedTargetSeq) applyTarget(target);

  $: approximate = timelineOn && era && era.confidence !== 'attested';
  $: sources = atlas?.sources ?? [];

  onMount(async () => {
    try {
      if (!(await atlasInstalled())) {
        missing = true;
        loading = false;
        return;
      }

      const index = await loadAtlasIndex();
      const saved = windowState?.contentState;

      atlas = createAtlasMap(mapEl, {
        getJson: getAtlasJson,
        index,
        placesInBounds,
        center: saved?.center ?? [31.8, 35.2],
        zoom: saved?.zoom ?? 5,
        onStatus: (text: string, busy: boolean) => { statusText = text; statusBusy = busy; },
        onBasemap: (kind: string) => { basemapKind = kind; },
        onEra: (next: any) => {
          era = next;
          eraIndex = atlas?.timeline?.index ?? 0;
        },
        onLayers: () => {
          overlays = atlas?.overlays ?? [];
          timelineOn = Boolean(atlas?.timeline?.enabled);
          era = atlas?.timeline?.era ?? null;
          eraIndex = atlas?.timeline?.index ?? 0;
        },
        onPlace: (payload: any) => {
          info = payload;
          openBooks = {};
          versePreviews = {};
          // The first book opens by itself, so its verses are wanted straight
          // away; the rest wait until their group is opened.
          const first = versesByBook(payload.verses ?? [])[0];
          if (first) loadBookText(first);
        },
        onPoint: (payload: any) => { info = payload; },
        onView: persistView,
      });

      await atlas.start();

      eras = atlas.eras;
      firstSurveyed = atlas.firstSurveyedIndex;
      overlays = atlas.overlays;

      // Search over Scripture's own places, so "Capernaum" and "Golgotha" find
      // something. The ancient names are fetched here rather than left to the
      // timeline's lazy load — 120 KB, and search should know Phrygia whether
      // or not anybody has switched the timeline on yet.
      const [places, ancient] = await Promise.all([
        getAtlasJson(index.biblicalPlaces.file),
        getAtlasJson(index.ancientNames.file),
      ]);
      scripture = new ScriptureSearch(places, ancient);

      // Leaflet never watches its own container, and docked that container
      // resizes every time the window's handle is dragged.
      resizeObserver = new ResizeObserver(() => fitter.request());
      resizeObserver.observe(mapEl);

      loading = false;
      if (target) applyTarget(target);
    } catch (err) {
      console.error('[atlas] failed to open', err);
      error = err instanceof Error ? err.message : String(err);
      loading = false;
    }
  });

  onDestroy(() => {
    if (playTimer) clearInterval(playTimer);
    playTimer = null;
    if (searchTimer) clearTimeout(searchTimer);
    resizeObserver?.disconnect();
    resizeObserver = null;
    fitter.stop();
    atlas?.destroy();
    atlas = null;
    // A reader who opens the map once should not carry its geometry and its
    // half-million places for the rest of the session.
    releaseAtlas();
    releasePlaceIndex();
  });

  /** Remember where the reader left the map, so a reload returns to it. */
  function persistView(centre: any, zoom: number) {
    if (!windowId) return;
    windowStore.updateContentState(windowId, { center: [centre.lat, centre.lng], zoom });
  }

  /**
   * Act on a handoff from the reader: drop the markers it sent and move to them.
   *
   * One marker is a place and gets the close-in treatment. Several is a person
   * — their places are scattered, so the useful view is all of them at once.
   */
  function applyTarget(next: MapTarget) {
    appliedTargetSeq = next.seq;
    const markers = next.markers ?? [];
    if (!markers.length || !atlas) return;

    if (markers.length === 1) {
      const m = markers[0];
      atlas.markPlace(m.latitude, m.longitude, m.name);
    } else {
      atlas.map.flyToBounds(
        markers.map((m) => [m.latitude, m.longitude]),
        { padding: [60, 60], maxZoom: 9, duration: 1 }
      );
    }
  }

  // ---------------------------------------------------------------- navbar

  function togglePanel(which: typeof openPanel) {
    openPanel = openPanel === which ? null : which;
  }

  /**
   * A tap anywhere but the controls closes whatever is open.
   *
   * The panels are siblings of the navbar rather than children — they have to
   * be, or the navbar's own sideways scrolling would clip them — so the test
   * has to name them too. Checking only for `.nav` closed the layers panel on
   * the first switch you touched.
   */
  function onRootPointerDown(event: PointerEvent) {
    const el = event.target as HTMLElement | null;
    if (!el?.closest('.nav, .panel, .results')) {
      openPanel = null;
      resultsOpen = false;
    }
  }

  async function chooseBasemap(kind: string) {
    await atlas?.setBasemap(kind);
    // The picker is one choice out of several, so it closes on choosing. The
    // layers list does not: several switches usually get changed in one visit.
    openPanel = null;
  }

  function onMapOpacity(event: Event) {
    mapOpacity = Number((event.currentTarget as HTMLInputElement).value);
    atlas?.setBasemapOpacity(mapOpacity / 100);
  }

  function onLayerOpacity(event: Event) {
    layerOpacity = Number((event.currentTarget as HTMLInputElement).value);
    atlas?.setLayerOpacity(layerOpacity / 100);
  }

  function onTextOpacity(event: Event) {
    textOpacity = Number((event.currentTarget as HTMLInputElement).value);
    atlas?.setBasemapTextOpacity(textOpacity / 100);
  }

  function onOverlayText(ov: any, event: Event) {
    const value = Number((event.currentTarget as HTMLInputElement).value);
    atlas?.host?.setTextOpacity(ov.id, value / 100);
    overlays = atlas?.overlays ?? [];
  }

  async function toggleOverlay(ov: any) {
    statusText = 'drawing…';
    statusBusy = true;
    await atlas?.setOverlayEnabled(ov.id, !ov.enabled);
    statusText = 'ready';
    statusBusy = false;
    overlays = atlas?.overlays ?? [];
    timelineOn = Boolean(atlas?.timeline?.enabled);
    era = atlas?.timeline?.era ?? null;
    eraIndex = atlas?.timeline?.index ?? 0;
  }

  async function toggleAgeing() {
    if (!atlas?.timeline) return;
    atlas.timeline.showAgeing = !atlas.timeline.showAgeing;
    ageing = atlas.timeline.showAgeing;
    await atlas.timeline.draw();
  }

  async function toggleTimeline() {
    await atlas?.setOverlayEnabled('timeline', !timelineOn);
    timelineOn = Boolean(atlas?.timeline?.enabled);
    era = atlas?.timeline?.era ?? null;
    eraIndex = atlas?.timeline?.index ?? 0;
  }

  // ---------------------------------------------------------------- search

  async function openSearch() {
    searchOpen = !searchOpen;
    if (searchOpen) {
      await tick();
      root?.querySelector<HTMLInputElement>('.search-inner input')?.focus();
    } else {
      resultsOpen = false;
    }
  }

  function onSearchInput() {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 180);
  }

  async function runSearch() {
    const raw = searchText.trim();
    if (raw.length < 2) { resultsOpen = false; return; }

    scriptureHits = scripture?.search(raw, 12) ?? [];
    try {
      modernHits = await searchPlaces(raw, 40);
    } catch {
      modernHits = [];
    }
    resultsOpen = true;
  }

  function clearSearch() {
    searchText = '';
    scriptureHits = [];
    modernHits = [];
    resultsOpen = false;
  }

  function pickScripture(entry: any) {
    atlas?.goToScripture(entry);
    resultsOpen = false;
  }

  function pickModern(place: any) {
    atlas?.goToPlace(place);
    resultsOpen = false;
  }

  function eraNote(from: number | null, to: number | null): string {
    if (from == null && to == null) return '';
    const year = (y: number) => (y < 0 ? `${Math.abs(y)} BC` : `AD ${y}`);
    if (from != null && to != null) return `${year(from)} – ${year(to)}`;
    return year((from ?? to) as number);
  }

  // -------------------------------------------------------------- timeline

  function eraYear(y: number): string {
    return y < 0 ? `${Math.abs(y)} BC` : `AD ${y}`;
  }

  async function setEra(i: number) {
    eraIndex = Math.max(0, Math.min(eras.length - 1, i));
    await atlas?.setEra(eraIndex);
    era = atlas?.timeline?.era ?? era;
  }

  /** The era nearest a point on the rail. The rail is eased, so this is not
   *  a matter of slicing it into equal parts. */
  function nearestEra(track: HTMLElement, clientX: number): number {
    const rect = track.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    let best = 0;
    let bestGap = Infinity;
    for (let i = 0; i < eras.length; i++) {
      const gap = Math.abs((atlas?.eraPosition(eras[i]) ?? i / eras.length) - frac);
      if (gap < bestGap) { bestGap = gap; best = i; }
    }
    return best;
  }

  let scrubbing = false;

  function onTrackDown(event: PointerEvent) {
    const track = event.currentTarget as HTMLElement;
    scrubbing = true;
    track.setPointerCapture(event.pointerId);
    setEra(nearestEra(track, event.clientX));
  }

  function onTrackMove(event: PointerEvent) {
    if (!scrubbing) return;
    setEra(nearestEra(event.currentTarget as HTMLElement, event.clientX));
  }

  function onTrackUp() {
    scrubbing = false;
  }

  function onTrackKey(event: KeyboardEvent) {
    if (event.key === 'ArrowLeft') { event.preventDefault(); setEra(eraIndex - 1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); setEra(eraIndex + 1); }
  }

  /** Run the sweep from here to the present, a beat under two seconds an era. */
  function togglePlay() {
    if (playTimer) {
      clearInterval(playTimer);
      playTimer = null;
      return;
    }
    if (eraIndex >= eras.length - 1) setEra(0);
    playTimer = setInterval(() => {
      if (eraIndex >= eras.length - 1) {
        if (playTimer) clearInterval(playTimer);
        playTimer = null;
        return;
      }
      setEra(eraIndex + 1);
    }, 1700);
  }

  // ------------------------------------------------------ the tapped panel

  function versesByBook(verses: [string, string][]) {
    return groupByBook(verses);
  }

  /** `defaultOpen` is the first group, which starts open without being recorded. */
  function toggleBook(group: any, defaultOpen = false) {
    const current = openBooks[group.book] ?? defaultOpen;
    const next = !current;
    openBooks = { ...openBooks, [group.book]: next };
    if (next) loadBookText(group);
  }

  /**
   * The verse behind every reference in one book, in whatever translation the
   * reader is on.
   *
   * A book at a time, as each group is opened: Jerusalem is named in 955 verses,
   * and fetching all of them to draw a panel nobody has scrolled yet would cost
   * far more than the panel is worth.
   */
  async function loadBookText(group: any) {
    const translation = get(navigationStore).translation;
    const loaded = await Promise.all(
      (group.refs ?? []).map(async (ref: any) => {
        if (versePreviews[ref.osis] !== undefined) {
          return [ref.osis, versePreviews[ref.osis]] as const;
        }
        const [book, chapter, verse] = ref.osis.split('.');
        const text =
          (await verseTextStore.getVerse(
            translation,
            bookName(book),
            Number(chapter),
            Number(verse) || 1,
          )) ?? '';
        return [ref.osis, text] as const;
      }),
    );
    versePreviews = { ...versePreviews, ...Object.fromEntries(loaded) };
  }

  /**
   * The place's own name, marked wherever it appears in the verse.
   *
   * Same rule the encyclopedia uses: a separator in the name matches any
   * separator or none, so Beth-shemesh, Beth Shemesh and Bethshemesh are one
   * name across translations that punctuate it differently.
   */
  $: highlightRe = (() => {
    const raw = info?.kind === 'place' ? String(info.place?.n ?? '') : '';
    const bare = raw.replace(/\([^)]*\)/g, '').trim();
    if (bare.length < 2) return null;
    const pattern = bare
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/[\s\-‐-―']+/g, "[\\s\\-‐-―']*");
    return new RegExp(`(${pattern})`, 'gi');
  })();

  /** Stored verse text carries markup a preview row must not show raw. */
  function versePreview(osis: string): string {
    const text = versePreviews[osis];
    if (!text) return '';
    return renderVersePreviewHtml(text, { highlight: highlightRe, maxLength: 150 });
  }

  /**
   * Take the reader to this verse.
   *
   * The map is a docked window, so it stays open beside the passage — that is
   * the point of reading with it. The crumb is what makes the trip returnable:
   * the navbar's back arrow puts the reader back where it was standing, with
   * the map still open on the same place.
   */
  function goToVerse(book: string, osis: string) {
    const [, chapterText, verseText] = osis.split('.');
    const chapter = Number(chapterText);
    if (!chapter) return;
    const verse = Number(verseText) || 1;

    const current = get(navigationStore);
    navigationStore.pushHistory(current, 'map');
    navigationStore.navigateToVerse(current.translation, bookName(book), chapter, verse);
  }

  function openPhoto(photo: any, title: string) {
    // Never a jump out to Wikimedia: the picture opens in the app's own viewer
    // and the credit is a link in the caption, to be tapped on purpose.
    viewing = { ...photo, title };
  }
</script>

<svelte:window on:pointerdown={onRootPointerDown} />

<div class="atlas" bind:this={root}>
  {#if missing}
    <div class="gate">
      <div class="gate-card">
        <div class="gate-title">The Historical Map isn’t installed yet</div>
        <p>
          The drawn map, the sixteen eras and every place Scripture names live in
          a pack. Install it from Packs and this window fills in.
        </p>
        <p class="gate-note">About 34 MB. Works with no connection once it’s there.</p>
      </div>
    </div>
  {:else if error}
    <div class="gate">
      <div class="gate-card">
        <div class="gate-title">The map failed to open</div>
        <p>{error}</p>
      </div>
    </div>
  {/if}

  <div class="nav" use:dragScroll>
    <div class="nav-group">
      <button
        class="btn"
        class:on={openPanel === 'basemap'}
        aria-haspopup="true"
        aria-expanded={openPanel === 'basemap'}
        on:click={() => togglePanel('basemap')}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="1 6 8 3 16 6 23 3 23 18 16 21 8 18 1 21"/><line x1="8" y1="3" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="21"/></svg>
        <span class="btn-label">{basemapKind === 'parchment' ? 'Parchment' : TILE_BASEMAPS[basemapKind]?.label}</span>
      </button>
    </div>

    <!-- Opacity earns a permanent place: it's the control you reach for while
         comparing the modern world against a historical overlay, so burying it
         in a panel makes the comparison a chore. -->
    <div class="nav-fade">
      <label for="atlas-map-opacity">Map</label>
      <input
        id="atlas-map-opacity"
        type="range"
        min="0"
        max="100"
        value={mapOpacity}
        aria-label="Basemap opacity"
        on:input={onMapOpacity}
      />
      <span class="val">{mapOpacity}%</span>
    </div>

    <div class="nav-sep"></div>

    <div class="nav-group search-area">
      <button class="btn btn-icon" class:on={searchOpen} aria-label="Search places" on:click={openSearch}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      </button>
      <div class="search-expander" class:open={searchOpen}>
        <div class="search-inner" class:focused={searchFocused}>
          <input
            type="text"
            placeholder="Search a place…"
            autocomplete="off"
            spellcheck="false"
            bind:value={searchText}
            on:input={onSearchInput}
            on:focus={() => (searchFocused = true)}
            on:blur={() => (searchFocused = false)}
          />
          <button class="search-clear" aria-label="Clear" on:click={clearSearch}>✕</button>
        </div>
      </div>
    </div>

    <div class="nav-spacer"></div>

    <div class="nav-group">
      <button
        class="btn"
        class:on={openPanel === 'layers'}
        aria-haspopup="true"
        aria-expanded={openPanel === 'layers'}
        on:click={() => togglePanel('layers')}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="2 12 12 17 22 12"/><polyline points="2 17 12 22 22 17"/><polygon points="12 2 2 7 12 12 22 7"/></svg>
        <span class="btn-label">Layers</span>
      </button>

      <button class="btn" class:on={timelineOn} title="Show the historical timeline" on:click={toggleTimeline}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>
        <span class="btn-label">Timeline</span>
      </button>

      <!-- The overlay's fade lives with the control that turns it on, so the
           thing you just enabled and the dial that tunes it sit together. -->
      {#if timelineOn}
        <div class="nav-fade">
          <label for="atlas-layer-opacity">Layer</label>
          <input
            id="atlas-layer-opacity"
            type="range"
            min="0"
            max="100"
            value={layerOpacity}
            aria-label="Overlay opacity"
            on:input={onLayerOpacity}
          />
          <span class="val">{layerOpacity}%</span>
        </div>
      {/if}

      <button class="btn" title="Zoom out to the whole world" on:click={() => atlas?.wholeWorld()}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 3 2.5 15 0 18M12 3c-2.5 3-2.5 15 0 18"/></svg>
        <span class="btn-label">Whole world</span>
      </button>

      <button
        class="btn btn-icon"
        class:on={openPanel === 'credit'}
        aria-label="Map sources"
        title="Map sources"
        aria-haspopup="true"
        aria-expanded={openPanel === 'credit'}
        on:click={() => togglePanel('credit')}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16.5"/><circle cx="12" cy="7.8" r=".9" fill="currentColor"/></svg>
      </button>
    </div>
  </div>

  {#if openPanel === 'basemap'}
    <div class="panel panel-left">
      <h4>Basemap</h4>
      <!-- A tick, not a switch. Picking a basemap is one choice out of several;
           a switch would say each style could be on or off independently. -->
      <button class="opt" class:on={basemapKind === 'parchment'} on:click={() => chooseBasemap('parchment')}>
        <span class="swatch" style="background:#ece1c8"></span>Parchment
        <span class="tickmark">✓</span>
      </button>
      {#each Object.entries(TILE_BASEMAPS) as [key, style]}
        <button class="opt" class:on={basemapKind === key} on:click={() => chooseBasemap(key)}>
          <span class="swatch" style="background:#4a5560"></span>{style.label}
          <span class="offline-note">needs internet</span>
          <span class="tickmark">✓</span>
        </button>
      {/each}
      <!-- Worth knowing before someone concludes the map is broken up close. -->
      <div class="panel-note">
        Parchment is drawn from world-scale data and thins out below about 5&nbsp;km.
        For local streets, lakes and creeks, use Topographic or Satellite.
      </div>

      <!-- The basemap's own fade lives in the navbar; what's left to tune here
           is how loud its lettering is over whatever sits on top. -->
      <h4>Place names</h4>
      <div class="row">
        <label for="atlas-text-opacity">Text</label>
        <input
          id="atlas-text-opacity"
          type="range"
          min="0"
          max="100"
          value={textOpacity}
          on:input={onTextOpacity}
        />
        <span class="val">{textOpacity}%</span>
      </div>
    </div>
  {/if}

  {#if openPanel === 'layers'}
    <div class="panel panel-right">
      <h4>Map</h4>
      <button
        class="opt"
        class:on={showLabels}
        aria-pressed={showLabels}
        on:click={() => { showLabels = !showLabels; atlas?.setShowLabels(showLabels); }}
      >
        <span class="swatch" style="background:#8a7a5c"></span>Place names<span class="switch"></span>
      </button>
      <button
        class="opt"
        class:on={showBiblical}
        aria-pressed={showBiblical}
        on:click={() => { showBiblical = !showBiblical; atlas?.setShowBiblical(showBiblical); }}
      >
        <span class="swatch" style="background:#8c4a3f"></span>Biblical places<span class="switch"></span>
      </button>
      <button
        class="opt"
        class:on={showEveryPlace}
        aria-pressed={showEveryPlace}
        on:click={() => { showEveryPlace = !showEveryPlace; atlas?.setShowEveryPlace(showEveryPlace); }}
      >
        <span class="swatch" style="background:#6b5a3e"></span>Show every place<span class="switch"></span>
      </button>

      <h4>Overlays</h4>
      {#each overlays as ov}
        <button
          class="opt"
          class:on={ov.enabled}
          aria-pressed={ov.enabled}
          on:click={() => toggleOverlay(ov)}
        >
          <span class="swatch" style="background:{ov.colour}"></span>{ov.title}<span class="switch"></span>
        </button>
        {#if ov.enabled}
          <div class="row">
            <label for="atlas-text-{ov.id}">Text</label>
            <input
              id="atlas-text-{ov.id}"
              type="range"
              min="0"
              max="100"
              value={Math.round((ov.textOpacity ?? 1) * 100)}
              on:input={(e) => onOverlayText(ov, e)}
            />
            <span class="val">{Math.round((ov.textOpacity ?? 1) * 100)}%</span>
          </div>
        {/if}
      {/each}

      {#if timelineOn && atlas?.timeline}
        <button
          class="opt"
          class:on={ageing}
          aria-pressed={ageing}
          on:click={toggleAgeing}
        >
          <span class="swatch" style="background:#6b4f2a"></span>Age the map<span class="switch"></span>
        </button>
      {/if}
    </div>
  {/if}

  {#if openPanel === 'credit'}
    <div class="panel panel-right credit-panel">
      {#each sources as s}
        <div class="credit-item">
          <div class="credit-src">
            {#if s.url}<a href={s.url} target="_blank" rel="noopener">{s.name}</a>{:else}{s.name}{/if}
          </div>
          <div class="credit-terms" class:credit-free={s.free}>{s.terms}</div>
        </div>
      {/each}
    </div>
  {/if}

  {#if resultsOpen}
    <div class="results">
      {#if !scriptureHits.length && !modernHits.length}
        <div class="res-empty">Nothing found for “{searchText.trim()}”.</div>
      {:else}
        {#if scriptureHits.length}
          <div class="res-head">In Scripture</div>
          {#each scriptureHits as e}
            <button class="res" on:click={() => pickScripture(e)}>
              <div class="n">
                {e.name}{#if e.kind === 'ancient'}<span class="kindtag">ancient name</span>{/if}
              </div>
              <div class="m">
                {#if e.kind === 'biblical'}
                  {[e.verses ? `${e.verses} verse${e.verses === 1 ? '' : 's'}` : null, e.modern ? `now ${e.modern}` : null].filter(Boolean).join(' · ')}
                {:else}
                  {[e.type, eraNote(e.from, e.to)].filter(Boolean).join(' · ')}
                {/if}
              </div>
            </button>
          {/each}
        {/if}
        {#if modernHits.length}
          {#if scriptureHits.length}<div class="res-head">On the modern map</div>{/if}
          {#each modernHits as p}
            <button class="res" on:click={() => pickModern(p)}>
              <div class="n">{p.name}</div>
              <div class="m">
                {[p.admin1, p.country, p.population ? `${p.population.toLocaleString()} people` : null].filter(Boolean).join(' · ')}
              </div>
            </button>
          {/each}
        {/if}
      {/if}
    </div>
  {/if}

  <div class="map-area">
    <div class="map" bind:this={mapEl}></div>

    <!-- Only while an era is showing lands rather than borders. Quiet on
         purpose: findable if you wonder what the soft shapes are, invisible if
         you don't. -->
    {#if approximate}
      <div
        class="approx-key"
        title="These centuries show the lands their books name. No borders are drawn, because none are known."
      >
        <span class="key-band"></span>Approximate locations
      </div>
    {/if}

    <div class="status" class:idle={!statusBusy}>
      <span class="dot"></span><span>{loading ? 'opening the map…' : statusText}</span>
    </div>

    {#if info}
      <aside class="info" aria-live="polite">
        <button class="info-close" aria-label="Close" on:click={() => (info = null)}>✕</button>
        <div class="info-body">
          {#if info.kind === 'place'}
            <div class="info-name">{info.place.n}</div>
            <div class="info-sub">
              {info.verses.length} reference{info.verses.length === 1 ? '' : 's'} in Scripture
            </div>
            {#if info.place.m || info.place.t}
              <div class="info-where">
                {#if info.place.m}Modern: <b>{info.place.m}</b><br />{/if}
                {info.place.t ?? ''}
              </div>
            {/if}

            {#if info.photo}
              <button
                class="info-photo"
                style="background:{(info.photo.p ?? '').split(',')[0] || '#cfc4a8'}"
                title="Open the photograph"
                on:click={() => openPhoto(info.photo, info.place.n)}
              >
                <img src={info.photo.t} alt={info.place.n} loading="lazy" />
                <span class="shot-credit">{[info.photo.a, info.photo.l].filter(Boolean).join(' · ')}</span>
              </button>
            {/if}

            {#if info.verses.length}
              <div class="info-h">Where it appears</div>
              {#each versesByBook(info.verses) as group, i}
                <!-- The first book opens, so the panel never lands as a wall of
                     closed rows. -->
                {@const colour = getBookColor(bookName(group.book))}
                {@const open = openBooks[group.book] ?? i === 0}
                <div class="vb-group" class:open>
                  <button class="vb-header" on:click={() => toggleBook(group, i === 0)}>
                    <span class="vb-caret" style="color:{colour}">{open ? '▼' : '►'}</span>
                    <span class="vb-name" style="color:{colour}">{bookName(group.book)}</span>
                    <span class="vb-count">({group.refs.length})</span>
                  </button>
                  <div class="vb-refs">
                    {#each group.refs as ref}
                      <button
                        class="vb-ref"
                        style="border-left-color:{colour}"
                        title="Read {ref.readable}"
                        on:click={() => goToVerse(group.book, ref.osis)}
                      >
                        <span class="vb-ref-label" style="color:{colour}">{ref.readable}</span>
                        {#if versePreviews[ref.osis]}
                          <span class="vb-ref-text">{@html versePreview(ref.osis)}</span>
                        {/if}
                      </button>
                    {/each}
                  </div>
                </div>
              {/each}
            {/if}
          {:else}
            <div class="info-name">{info.name}</div>
            <div class="info-sub">{info.subtitle}</div>
            {#if info.lines?.length}
              <div class="info-where">
                {#each info.lines as line}
                  <div>{line.label}: <b>{line.value}</b></div>
                {/each}
              </div>
            {/if}
            {#if info.nearest}
              <div class="info-h">Nearby</div>
              <button class="vb-ref" style="border-left-color:#8c4a3f" on:click={() => atlas?.openPlace(info.nearest.place)}>
                <span class="vb-ref-label" style="color:#c98b7a">{info.nearest.place.n}</span>
                <span class="vb-ref-text">
                  {info.nearest.place.v.length} reference{info.nearest.place.v.length === 1 ? '' : 's'} in Scripture
                </span>
              </button>
            {/if}
          {/if}
        </div>
      </aside>
    {/if}
  </div>

  {#if timelineOn && era}
    <div class="timeline-bar">
      <div
        class="tl-caption"
        role="button"
        tabindex="0"
        title="Frame this era"
        on:click={() => atlas?.frameEra()}
        on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); atlas?.frameEra(); } }}
      >
        <div class="tl-title">{era.title}</div>
        <div class="tl-years">
          <span class="tl-dot {era.confidence}"></span>{eraYear(era.year_start)} – {eraYear(era.year_end)}
        </div>
        <div class="tl-more">
          {#if era.subtitle}<div class="tl-title">{era.subtitle}</div>{/if}
          <div class="tl-blurb">{era.blurb ?? ''}</div>
          {#if era.dating_note}<div class="tl-note">{era.dating_note}</div>{/if}
          <span class="tl-tag {era.confidence}">
            {era.confidence === 'attested' ? 'Surveyed borders' : 'Approximate · lands named in Scripture'}
          </span>
          {#if eraIndex === firstSurveyed}
            <div class="tl-seam">
              From here the borders are known. Everything earlier shows the lands
              its books name, drawn as approximate — nobody knows where Assyria’s
              frontier ran.
            </div>
          {/if}
          <div class="tl-hint">Click to frame this era on the map</div>
        </div>
      </div>

      <div class="tl-controls">
        <button class="tl-play" aria-label="Play through the eras" on:click={togglePlay}>
          {#if playTimer}❙❙{:else}▶{/if}
        </button>
        <div
          class="tl-track"
          role="slider"
          tabindex="0"
          aria-label="Era"
          aria-valuemin="0"
          aria-valuemax={eras.length - 1}
          aria-valuenow={eraIndex}
          aria-valuetext={era.title}
          on:pointerdown={onTrackDown}
          on:pointermove={onTrackMove}
          on:pointerup={onTrackUp}
          on:pointercancel={onTrackUp}
          on:keydown={onTrackKey}
        >
          <div
            class="tl-rail"
            style="--split:{firstSurveyed > 0 ? (atlas?.eraPosition(eras[firstSurveyed]) ?? 0.5) * 100 : 50}%"
          ></div>
          {#each eras as e, i}
            <div class="tl-tick" class:on={i === eraIndex} style="left:{(atlas?.eraPosition(e) ?? 0) * 100}%"></div>
            <div class="tl-lab" class:on={i === eraIndex} style="left:{(atlas?.eraPosition(e) ?? 0) * 100}%">
              {eraYear(e.year_start)}
            </div>
          {/each}
          <div class="tl-knob" style="left:{(atlas?.eraPosition(era) ?? 0) * 100}%"></div>
        </div>
      </div>
    </div>
  {/if}
</div>

{#if viewing}
  <ArtViewer
    src={viewing.f}
    title={viewing.title}
    artist={viewing.a}
    license={viewing.l}
    sourceUrl={viewing.u}
    on:close={() => (viewing = null)}
  />
{/if}

<style>
  /* Chrome borrows the reader's palette so the map stops looking like a guest
     in its own app: same greys, same borders, same rose focus ring. */
  .atlas {
    --chrome: #1a1a1a;
    --chrome-2: #212121;
    --sunken: #141414;
    --line: #333;
    --line-2: #3a3a3a;
    --text: #e0e0e0;
    --dim: #8a8a8a;
    --faint: #5a5a5a;
    --focus: #fb7185;
    --parchment: #ece1c8;
    --ground: #e6d9bd;
    --nav-h: 46px;
    /* The app's display face. Body text stays on the system stack — Milonga is
       a display face and a paragraph of it is unreadable — so this is chrome
       only: the navbar, panel headings, captions and names. */
    --display: 'Milonga', cursive;

    position: relative;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--chrome);
    color: var(--text);
    font: 14px/1.5 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    /* The breakpoints below measure this box, not the viewport: docked, the map
       can be 380px wide inside a 1600px screen. */
    container-type: inline-size;
    overflow: hidden;
  }

  /* ---------------- the map's own navbar ---------------- */
  .nav {
    flex: none;
    height: var(--nav-h);
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 8px;
    background: var(--chrome);
    border-bottom: 1px solid var(--line);
    position: relative;
    z-index: 1200;
    font-family: var(--display);
    /* Narrow is answered by sliding, not by wrapping: a wrapped navbar changes
       its own height, and the map is measured from what's left. */
    overflow-x: auto;
    scrollbar-width: none;
    flex-wrap: nowrap;
  }
  .nav::-webkit-scrollbar { display: none; }
  .nav.drag-scrolling { cursor: grabbing; user-select: none; }

  .nav-group { display: flex; align-items: center; gap: 4px; flex: none; }
  .nav-sep { width: 1px; height: 22px; background: var(--line); margin: 0 3px; flex: none; }
  .nav-spacer { flex: 1; min-width: 4px; }

  .btn {
    height: 30px; min-width: 30px; padding: 0 9px; border-radius: 6px; cursor: pointer;
    background: var(--chrome-2); border: 1px solid var(--line); color: var(--text);
    font: inherit; font-size: 12.5px; display: inline-flex; align-items: center; gap: 6px;
    white-space: nowrap; flex: none;
    transition: background .12s, border-color .12s, color .12s;
  }
  .btn:hover { background: #292929; border-color: var(--line-2); }
  .btn.on { background: #2f2a2b; border-color: var(--focus); color: #fff; }
  .btn:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
  .btn :global(svg) { width: 15px; height: 15px; flex: none; }
  .btn-icon { padding: 0; justify-content: center; }

  /* Search: the reader's expander, same slide and same sunken input. */
  .search-area { display: flex; align-items: center; flex: none; }
  .search-expander {
    width: 0; overflow: hidden; flex: none;
    transition: width .25s cubic-bezier(.4, 0, .2, 1);
  }
  .search-expander.open { width: 238px; }
  .search-inner {
    display: flex; align-items: center; height: 30px; width: 230px; margin-left: 6px;
    background: var(--sunken); border: 1px solid var(--line-2); border-radius: 6px;
    transition: border-color .15s;
  }
  .search-inner.focused { border-color: var(--focus); }
  .search-inner input {
    flex: 1; min-width: 0; background: transparent; border: 0; outline: none;
    color: var(--text); font: inherit; font-size: 13px; padding: 0 9px;
  }
  .search-inner input::placeholder { color: #555; }
  .search-clear {
    background: none; border: 0; color: #666; cursor: pointer; padding: 0 8px;
    height: 100%; display: flex; align-items: center;
  }
  .search-clear:hover { color: #ccc; }

  .nav-fade { display: flex; align-items: center; gap: 7px; flex: none; }
  .nav-fade label {
    font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--faint);
  }
  .nav-fade input[type='range'] { width: 88px; accent-color: var(--focus); }
  .nav-fade .val {
    font-size: 11px; color: var(--dim); width: 32px; font-variant-numeric: tabular-nums;
  }

  /* Narrow, in the window's own width rather than the screen's. The bar keeps
     scrolling at every size; these only stop it having more to scroll than it
     needs to. */
  @container (max-width: 820px) {
    .nav-fade .val { display: none; }
  }
  @container (max-width: 700px) {
    .nav-fade label { display: none; }
    .nav-fade input[type='range'] { width: 62px; }
  }
  @container (max-width: 560px) {
    .btn-label { display: none; }
    .btn { padding: 0; min-width: 30px; justify-content: center; }
  }
  @container (max-width: 460px) {
    .nav-fade { display: none; }
    .search-expander.open { width: 180px; }
    .search-inner { width: 172px; }
  }

  /* ---------------- dropdown panels ---------------- */
  .panel {
    position: absolute; top: calc(var(--nav-h) - 4px); background: var(--chrome-2);
    border: 1px solid var(--line-2); border-radius: 9px; padding: 8px;
    box-shadow: 0 12px 30px rgba(0, 0, 0, .5); z-index: 1300; min-width: 210px;
    max-height: 70%; overflow-y: auto;
    font-family: var(--display);
  }
  .panel-left { left: 8px; }
  .panel-right { right: 8px; }
  .credit-panel { width: 300px; }
  .panel h4 {
    margin: 6px 4px; font-size: 11px; letter-spacing: .1em; text-transform: uppercase;
    color: var(--faint); font-weight: 400;
  }
  .opt {
    display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 8px;
    background: none; border: 0; border-radius: 6px; color: var(--text);
    font: inherit; font-size: 13px; cursor: pointer; text-align: left;
  }
  .opt:hover { background: #2b2b2b; }
  .opt.on { background: #322c2e; color: #fff; }
  /* The basemap picker keeps a tick: it is one choice out of several, not a set
     of independent switches. */
  .opt .tickmark { margin-left: auto; color: var(--focus); opacity: 0; }
  .opt.on .tickmark { opacity: 1; }

  /* A switch rather than a tick. A tick reads as "this happened"; a switch
     reads as "this is on, and you may turn it off", which is what a layer list
     is for. */
  .opt .switch {
    margin-left: auto; flex: none; position: relative;
    width: 30px; height: 17px; border-radius: 999px;
    background: #3a3a3a; border: 1px solid #4a4a4a;
    transition: background .16s ease, border-color .16s ease;
  }
  .opt .switch::after {
    content: ''; position: absolute; top: 2px; left: 2px;
    width: 11px; height: 11px; border-radius: 50%;
    background: #8a8a8a; transition: transform .16s ease, background .16s ease;
  }
  .opt.on .switch { background: #4a2f38; border-color: var(--focus); }
  .opt.on .switch::after { background: var(--focus); transform: translateX(13px); }
  .opt .offline-note { margin-left: auto; font-size: 10px; color: var(--faint); }

  .row {
    display: flex; align-items: center; gap: 9px; padding: 6px 8px; font-size: 12.5px;
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  }
  .row label { color: var(--dim); flex: none; width: 62px; }
  .row input[type='range'] { flex: 1; accent-color: var(--focus); }
  .row .val { width: 34px; text-align: right; color: var(--dim); font-variant-numeric: tabular-nums; }

  .swatch { width: 10px; height: 10px; border-radius: 3px; flex: none; }
  .panel-note {
    padding: 8px; margin-top: 4px; font-size: 11px; line-height: 1.45;
    color: var(--faint); border-top: 1px solid var(--line);
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  }

  .credit-item { padding: 7px 8px; font-size: 12px; line-height: 1.45; }
  .credit-item + .credit-item { border-top: 1px solid var(--line); }
  .credit-src { color: var(--text); }
  .credit-terms { color: var(--dim); font-size: 11px; margin-top: 2px; }
  .credit-free { color: #8fc296; }
  .credit-item a { color: var(--focus); }

  /* ---------------- search results ---------------- */
  .results {
    position: absolute; top: calc(var(--nav-h) - 4px); left: 8px; z-index: 1300;
    width: 320px; max-width: calc(100% - 16px); max-height: 60%; overflow-y: auto;
    background: var(--chrome-2); border: 1px solid var(--line-2); border-radius: 9px;
    padding: 6px; box-shadow: 0 12px 30px rgba(0, 0, 0, .5);
  }
  .res {
    display: block; width: 100%; text-align: left; padding: 8px 9px; border: 0;
    background: none; border-radius: 6px; color: var(--text); font: inherit; cursor: pointer;
  }
  .res:hover { background: #2b2b2b; }
  .res .n { font-size: 13px; }
  .res .m {
    font-size: 11.5px; color: var(--dim); margin-top: 1px;
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  }
  /* What kind of thing this is — a bay reads differently from a town. */
  .kindtag {
    margin-left: 7px; font-size: 10px; color: var(--faint);
    letter-spacing: .06em; text-transform: uppercase;
  }
  /* Splits the list into Scripture's places and the modern map, so a reader can
     see which world an answer came from without reading the detail. */
  .res-head {
    padding: 7px 12px 4px; font-size: 11px; font-weight: 400;
    letter-spacing: .1em; text-transform: uppercase; color: #9c8760;
    font-family: var(--display);
  }
  .res-empty { padding: 10px; color: var(--dim); font-size: 12.5px; }

  /* ---------------- the map ---------------- */
  /* The ground behind everything. Fade both the basemap and the overlay out and
     this is what remains, so it is parchment rather than a void. */
  .map-area { position: relative; flex: 1; min-height: 0; display: flex; }
  .map { flex: 1; min-height: 0; background: var(--ground); }
  .map-area :global(.leaflet-container) {
    background: var(--ground);
    font-family: inherit;
    outline: none;
  }
  /* Nothing floats on the map — the navbar owns every control. */
  .map-area :global(.leaflet-control-container .leaflet-top),
  .map-area :global(.leaflet-control-container .leaflet-bottom) { display: none; }
  /* The lettering on the map — and the drawn mountains, which are the one thing
     in the label pane that can be clicked — are styled by the engine's own
     stylesheet, not here. Leaflet builds those elements itself, so a scoped rule
     in this file never reaches them, and the encyclopedia's bare map needs the
     same styling without going through this component at all. */

  .map-area :global(.atlas-grain) {
    background-image:
      radial-gradient(ellipse at 50% 50%, rgba(0, 0, 0, 0) 55%, rgba(88, 62, 26, .28) 100%),
      url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/><feColorMatrix type='saturate' values='0'/></filter><rect width='140' height='140' filter='url(%23n)' opacity='0.5'/></svg>");
    background-blend-mode: multiply;
    mix-blend-mode: multiply;
  }

  /* ---------------- the key, the status chip ---------------- */
  .approx-key {
    position: absolute; left: 10px; bottom: 42px; z-index: 900;
    display: flex; align-items: center; gap: 7px;
    font-family: var(--display); font-size: 11px; color: #b3a68a;
    background: rgba(26, 26, 26, .86); border: 1px solid var(--line);
    border-radius: 7px; padding: 5px 9px; backdrop-filter: blur(6px);
    cursor: help;
  }
  /* Four of the lands' own colours side by side, because every land now has one. */
  .approx-key .key-band {
    width: 20px; height: 9px; border-radius: 2px; flex: none; opacity: .9;
    background: linear-gradient(90deg,
      #7f7b33 0 25%, #c8702c 25% 50%, #7a9cc2 50% 75%, #8e5588 75% 100%);
  }

  .status {
    position: absolute; left: 10px; bottom: 10px; z-index: 900; display: flex; gap: 8px;
    pointer-events: none; max-width: calc(100% - 20px);
    align-items: center; font-size: 11px; color: var(--dim);
    background: rgba(26, 26, 26, .86); border: 1px solid var(--line);
    border-radius: 7px; padding: 5px 9px; backdrop-filter: blur(6px);
  }
  .status .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--focus); flex: none; }
  .status.idle .dot { background: #4a7c50; }

  /* ---------------- what you tapped ---------------- */
  .info {
    position: absolute; top: 10px; right: 10px; bottom: 10px; width: 330px;
    max-width: calc(100% - 20px); z-index: 950;
    background: rgba(26, 26, 26, .95); border: 1px solid var(--line-2); border-radius: 11px;
    box-shadow: 0 16px 40px rgba(0, 0, 0, .5); backdrop-filter: blur(8px);
    display: flex; flex-direction: column; overflow: hidden;
    font-family: var(--display);
  }
  .info-close {
    position: absolute; top: 8px; right: 8px; width: 26px; height: 26px; z-index: 2;
    border-radius: 7px; border: 1px solid var(--line); background: var(--chrome-2);
    color: var(--dim); cursor: pointer; font-size: 12px;
  }
  .info-close:hover { color: var(--text); }
  .info-body { overflow-y: auto; padding: 14px 15px; }

  /* Milonga ships one weight, so anything here asking for bold gets a
     synthesised smear instead. Emphasis comes from size and colour. */
  .info-name { font-size: 18px; font-weight: 400; padding-right: 26px; }
  .info-sub {
    font-size: 11.5px; color: var(--dim); margin-top: 3px;
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  }
  .info-where {
    margin-top: 10px; font-size: 12px; color: var(--dim); line-height: 1.5;
    border-left: 2px solid var(--line-2); padding-left: 9px;
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  }
  .info-where b { color: var(--text); font-weight: 400; }
  .info-h {
    margin: 15px 0 7px; font-size: 11px; letter-spacing: .1em; text-transform: uppercase;
    color: var(--faint); font-weight: 400;
  }

  /* The thumbnail on the place panel. Sized so the panel still leads with the
     name and the verses; the picture is an invitation, not the subject. It
     opens full screen in the app's own viewer — never a jump out to Wikimedia.
     The credit there is a caption link, to be tapped on purpose or ignored. */
  .info-photo {
    position: relative; display: block; width: 100%; padding: 0;
    margin: 8px 0 10px; border-radius: 6px; overflow: hidden;
    cursor: zoom-in; background: #cfc4a8; line-height: 0;
    border: 1px solid rgba(0, 0, 0, .12);
  }
  .info-photo img { width: 100%; height: 132px; object-fit: cover; display: block; }
  .info-photo .shot-credit {
    position: absolute; left: 0; right: 0; bottom: 0; padding: 4px 7px;
    font-size: 10.5px; line-height: 1.3; color: #efe9db; text-align: left;
    background: linear-gradient(to top, rgba(0, 0, 0, .7), rgba(0, 0, 0, 0));
  }

  /* Verse list — the same shape as the word study, the encyclopedia and Nave's:
     a caret and a coloured book name, then full-width rows with the book's
     colour down the left edge. Deliberately not chips. */
  .vb-group { border-top: 1px solid rgba(255, 255, 255, .07); }
  .vb-header {
    display: flex; align-items: center; gap: 8px; width: 100%;
    background: none; border: none; color: var(--text);
    font-family: inherit; font-size: 13.5px; text-align: left;
    padding: 7px 4px; cursor: pointer;
  }
  .vb-header:hover { background: rgba(255, 255, 255, .04); }
  .vb-caret { font-size: 10px; }
  .vb-name { flex: 1; font-weight: 400; }
  .vb-count { color: var(--dim); font-size: 12px; }

  .vb-refs { display: none; flex-direction: column; gap: 4px; padding: 4px 4px 10px 24px; }
  .vb-group.open .vb-refs { display: flex; }

  .vb-ref {
    display: block; width: 100%; text-align: left;
    background: rgba(255, 255, 255, .04);
    border: 1px solid rgba(255, 255, 255, .08);
    border-left: 3px solid;
    border-radius: 5px; padding: 6px 9px; cursor: pointer;
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  }
  .vb-ref:hover { background: rgba(255, 255, 255, .08); }
  .vb-ref-label { font-size: 12px; font-weight: 600; }
  .vb-ref-text {
    display: block; color: #c2c6cd; font-size: 12.5px; margin-top: 3px; line-height: 1.45;
  }
  /* The place's own name inside the verse, in the same amber the encyclopedia
     marks it with — the two lists are the same list, so they read the same. */
  .vb-ref-text :global(mark) {
    background: rgba(249, 115, 22, 0.35);
    color: #fdba74;
    border-radius: 2px;
    padding: 0 1px;
  }

  /* ---------------- timeline ---------------- */
  /* One compact row: the era on the left, the slider filling the rest. The
     detail lives in a hover card so the bar doesn't eat the map. */
  .timeline-bar {
    flex: none; background: #151515; border-top: 1px solid var(--line);
    padding: 6px 14px calc(6px + env(safe-area-inset-bottom));
    display: flex; gap: 14px; align-items: center;
    font-family: var(--display);
  }
  .tl-caption {
    flex: none; width: 230px; cursor: pointer; border-radius: 7px;
    padding: 4px 8px; position: relative;
  }
  @container (max-width: 560px) { .tl-caption { width: 140px; } }
  .tl-caption:hover { background: #1f1f1f; }
  .tl-caption:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
  .tl-title {
    font-size: 13px; font-weight: 600; white-space: nowrap;
    overflow: hidden; text-overflow: ellipsis;
  }
  .tl-years {
    font-size: 10.5px; letter-spacing: .07em; text-transform: uppercase;
    color: #c98b3a; margin-top: 1px; display: flex; align-items: center; gap: 6px;
  }
  .tl-years .tl-dot { width: 6px; height: 6px; border-radius: 50%; flex: none; }
  .tl-dot.attested { background: #8fc296; }
  .tl-dot.approximate { background: #c98b3a; }

  /* Detail on hover, so the bar stays one row tall. */
  .tl-more {
    position: absolute; left: 0; bottom: calc(100% + 8px); width: 320px;
    background: var(--chrome-2); border: 1px solid var(--line-2); border-radius: 9px;
    padding: 11px 13px; box-shadow: 0 12px 30px rgba(0, 0, 0, .55);
    opacity: 0; visibility: hidden; transition: opacity .13s; pointer-events: none;
  }
  .tl-caption:hover .tl-more, .tl-caption:focus-visible .tl-more { opacity: 1; visibility: visible; }
  .tl-blurb {
    font-size: 12px; color: var(--dim); line-height: 1.45;
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  }
  .tl-note {
    font-size: 11px; color: var(--faint); margin-top: 7px; line-height: 1.4;
    border-left: 2px solid var(--line-2); padding-left: 7px;
  }
  /* Shown on the one era where the map stops approximating shapes and starts
     drawing surveyed ones. Warm rather than warning: it marks a change in what
     the map is claiming, not a problem. */
  .tl-seam {
    font-size: 11px; color: #c2a878; margin-top: 8px; line-height: 1.45;
    border-left: 2px solid #7a5c34; padding-left: 7px;
  }
  .tl-tag {
    display: inline-block; margin-top: 8px; padding: 2px 8px; border-radius: 999px;
    font-size: 10px; letter-spacing: .07em; text-transform: uppercase;
  }
  .tl-tag.attested { background: rgba(90, 140, 95, .16); color: #8fc296; border: 1px solid rgba(143, 194, 150, .3); }
  .tl-tag.approximate { background: rgba(201, 139, 58, .14); color: #c98b3a; border: 1px solid rgba(201, 139, 58, .32); }
  .tl-hint { font-size: 10px; color: var(--faint); margin-top: 9px; }

  .tl-controls { flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px; }
  .tl-play {
    width: 30px; height: 30px; flex: none; border-radius: 50%; cursor: pointer; padding: 0;
    border: 1px solid var(--line-2); background: var(--chrome-2); color: var(--text);
    display: grid; place-items: center; font-size: 11px;
  }
  .tl-play:hover { border-color: var(--focus); color: var(--focus); }
  .tl-play:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }

  .tl-lab {
    position: absolute; top: 20px; font-size: 9.5px; color: var(--faint);
    transform: translateX(-50%); white-space: nowrap; pointer-events: none;
    font-variant-numeric: tabular-nums;
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  }
  .tl-lab.on { color: var(--text); }

  /* The rail changes colour where the evidence changes character: amber while
     the map shows lands named in Scripture, green once borders are surveyed. */
  .tl-track {
    position: relative; flex: 1; min-width: 0; height: 34px;
    touch-action: none; cursor: pointer;
  }
  .tl-track:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; border-radius: 6px; }
  .tl-rail {
    position: absolute; left: 0; right: 0; top: 9px; height: 4px; border-radius: 2px;
    background: linear-gradient(to right,
      rgba(201, 139, 58, .5) 0%, rgba(201, 139, 58, .5) var(--split, 50%),
      rgba(143, 194, 150, .45) var(--split, 50%), rgba(143, 194, 150, .45) 100%);
  }
  .tl-tick {
    position: absolute; top: 5px; width: 2px; height: 12px; margin-left: -1px;
    background: #4a4a46; border-radius: 1px;
  }
  .tl-tick.on { background: var(--text); height: 18px; top: 2px; }
  .tl-knob {
    position: absolute; top: 2px; width: 17px; height: 17px; margin-left: -8.5px;
    border-radius: 50%; background: var(--text); border: 4px solid #151515;
    box-shadow: 0 0 0 1px var(--line-2); pointer-events: none;
  }
  @media (prefers-reduced-motion: no-preference) { .tl-knob { transition: left .2s ease; } }

  /* ---------------- not installed ---------------- */
  .gate {
    position: absolute; inset: 0; z-index: 2000; display: grid; place-items: center;
    padding: 24px; background: var(--chrome);
  }
  .gate-card { max-width: 380px; text-align: center; color: var(--dim); font-size: 13px; line-height: 1.6; }
  .gate-title { font-family: var(--display); font-size: 17px; color: var(--text); margin-bottom: 10px; }
  .gate-note { color: var(--faint); font-size: 12px; }
</style>
