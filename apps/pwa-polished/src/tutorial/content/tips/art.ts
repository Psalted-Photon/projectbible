/**
 * Dots in the Art window and the full-screen viewer.
 */

import type { Tip } from '../types';

const area = 'Art';

export const ART_TIPS: Tip[] = [
  {
    id: 'art-size',
    area,
    target: '.art-pane .size-control',
    title: 'Preview size',
    body: 'Slide for bigger or smaller previews.',
  },
  {
    id: 'art-scene',
    area,
    target: '.art-pane .tile-btn, .art-pane .scene-btn',
    title: 'A scene',
    body: 'Tap to see every painting of it.',
  },
  {
    id: 'art-painting',
    area,
    target: '.art-pane .img-btn',
    title: 'A painting',
    body: 'Tap to see it full screen.',
  },
  {
    id: 'art-all-scenes',
    area,
    target: '.art-pane .back',
    title: 'All scenes',
    body: 'Back to the list of scenes.',
  },
  {
    id: 'art-zoom',
    area,
    target: '.art-viewer .stage',
    corner: 'center',
    title: 'Zoom in',
    body: 'Pinch or double-tap to zoom in, then drag to look around.',
  },
];
