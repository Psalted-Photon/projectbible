/**
 * Open By Heart from elsewhere in the app. With a passage, it goes straight to
 * that passage's card step, in an open By Heart window if there is one.
 */

import { get } from 'svelte/store';
import { windowStore } from '../stores/windowStore';
import { openWindowOfType } from '../windowTypes';
import type { PickedPassage } from '../shareText';

export function openByHeart(picked?: PickedPassage): void {
  const open = get(windowStore).find((w) => w.contentType === 'byheart');
  if (open) {
    if (picked) windowStore.updateContentState(open.id, { picked });
    return;
  }
  openWindowOfType('byheart', picked ? { picked } : {});
}
