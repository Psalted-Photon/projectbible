/**
 * Dots in the Timeline window.
 *
 * The bar's buttons are told apart only by their labels.
 */

import type { Tip } from '../types';

const area = 'Timeline';

function button(label: string, body: string): Tip {
  return {
    id: `timeline-${label.toLowerCase()}`,
    area,
    target: '.timeline .nav .btn',
    text: label,
    exact: true,
    title: label,
    body,
  };
}

export const TIMELINE_TIPS: Tip[] = [
  button('Find', 'Find an event, king, prophet or book, and go to it on the timeline.'),
  button('Moment', 'Shows everything going on in one year. Drag the timeline to move to another year.'),
  button('Lanes', 'Add kings, prophets, world powers, lives and books beside the events.'),
  {
    id: 'timeline-more',
    area,
    target: '.timeline .nav .btn-icon[aria-label="More"]',
    title: 'More',
    body: 'Run the timeline across or down, make every year the same size with True years, follow what you’re reading, and zoom.',
  },
];
