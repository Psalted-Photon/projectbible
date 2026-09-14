/**
 * "Turn off tutorial", from any dot's card: open Settings, open General, and
 * put the spotlight on the switch. The tutorial never switches itself off --
 * the person unticks it, so they know where to tick it again.
 */

import { get } from 'svelte/store';
import type { TourStep } from './types';
import { find } from '../engine/targets';
import { paneOpen } from '../engine/watch';
import { paneStore } from '../../stores/paneStore';
import { tutorial } from '../state';

function generalHeader(): HTMLElement | null {
  return find('.pane-settings .sec-head', 'General');
}

export const TURN_OFF: TourStep[] = [
  {
    id: 'turn-off-general',
    onEnter: () => {
      if (!paneOpen('settings')) paneStore.openPane('settings', 'right');
    },
    target: generalHeader,
    reveal: true,
    allowPanes: true,
    waitMs: 2500,
    doneWhen: () => generalHeader()?.getAttribute('aria-expanded') === 'true',
    title: 'General',
    body: 'Tap to open this section.',
  },
  {
    id: 'turn-off-switch',
    target: () => find('.pane-settings .checkbox-label', 'Tutorial Mode'),
    reveal: 'center',
    allowPanes: true,
    doneWhen: () => !get(tutorial).on,
    title: 'Tutorial Mode',
    body: 'Untick this to turn the tutorial off. Tick it again anytime to replay the tour.',
    nextLabel: 'Keep it on',
  },
];
