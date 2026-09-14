/**
 * Dots in the Map window (the Historical Map).
 */

import type { Tip } from '../types';

const area = 'Map';

export const MAP_TIPS: Tip[] = [
  {
    id: 'map-tap-a-place',
    area,
    target: '.atlas .map',
    corner: 'top-left',
    title: 'Tap a place',
    body: 'Tap any place for the verses that name it, its encyclopedia article and a photograph.',
  },
  {
    id: 'map-style',
    area,
    target: '.atlas .nav > .nav-group:first-child > .btn',
    title: 'Map style',
    body: 'Parchment works with no connection. The online styles add close-up detail, like terrain and satellite photos.',
  },
  {
    id: 'map-fade',
    area,
    target: '.atlas .nav > .nav-fade',
    title: 'Fade the map',
    body: 'Fade the base map so the historical layers stand out over it.',
  },
  {
    id: 'map-search',
    area,
    target: '.atlas .btn-icon[aria-label="Search places"]',
    title: 'Search places',
    body: 'Find any place the Bible names, or any of 562,000 modern ones.',
  },
  {
    id: 'map-layers',
    area,
    target: '.atlas .nav .btn',
    text: 'Layers',
    exact: true,
    title: 'Layers',
    body: 'Place names, biblical places, every place, the historical overlays, and a switch to age the map.',
  },
  {
    id: 'map-timeline',
    area,
    target: '.atlas .nav .btn',
    text: 'Timeline',
    exact: true,
    title: 'Timeline',
    body: 'Sixteen eras, from Abraham leaving Ur to the later Roman empire, drawn over the map.',
  },
  {
    id: 'map-whole-world',
    area,
    target: '.atlas .nav .btn',
    text: 'Whole world',
    exact: true,
    title: 'Whole world',
    body: 'Zoom right back out.',
  },
  {
    id: 'map-sources',
    area,
    target: '.atlas .btn-icon[aria-label="Map sources"]',
    title: 'Sources',
    body: 'Where the map’s data comes from, and its licenses.',
  },
  {
    id: 'map-play-eras',
    area,
    target: '.atlas .tl-play',
    title: 'Play the eras',
    body: 'Watch the map change from one era to the next.',
  },
  {
    id: 'map-era-track',
    area,
    target: '.atlas .tl-track',
    title: 'Pick an era',
    body: 'Drag along the timeline to move through history.',
  },
  {
    id: 'map-era-caption',
    area,
    target: '.atlas .tl-caption',
    title: 'This era',
    body: 'Tap to fit the map to this era.',
  },
  {
    id: 'map-photo',
    area,
    target: '.atlas .info-photo',
    title: 'Photograph',
    body: 'Tap to see the photograph full screen.',
  },
];
