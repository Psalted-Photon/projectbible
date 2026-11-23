/**
 * Walking a reader's crumbs: what tapping a crumb on the nav bar does, and
 * what the phone's Back does, which is the same as tapping the nearest one.
 */

import { get } from 'svelte/store';
import { MAIN_READER, trailFor } from '../../stores/navigationStore';
import { isbeReturnStore } from '../../stores/isbeReturnStore';
import { isbeModalStore } from '../../stores/isbeModalStore';
import { getSettings } from '../../adapters/settings';

/**
 * Walk back to a step in a reader's trail. Depth is 1-based, so crumb 1 is
 * the first hop away from home: going to it puts you all the way back.
 * `clearAfter` drops the crumbs after it rather than leaving them ahead of you.
 *
 * Walking back over the step the encyclopedia card jumped from reopens the
 * card where it was (isbeReturnStore). That return belongs to the main
 * reader's trail only.
 */
export function goToCrumb(readerId: string | null | undefined, depth: number, clearAfter = false): void {
  const trail = trailFor(readerId);
  const ret = readerId && readerId !== MAIN_READER ? null : get(isbeReturnStore);
  // Checked before the pop: a crumb at position N undoes the step that was
  // recorded at depth N. Reading the depth afterwards would always be one
  // short and never match.
  const undoingTheJump = !!ret && depth === ret.depth;
  trail.goToDepth(depth, clearAfter);
  if (undoingTheJump) isbeModalStore.open(ret!.modal);
  else if (ret && get(trail.historyDepth) < ret.depth) isbeReturnStore.set(null);
}

/**
 * One crumb back, as the phone's Back does it: exactly a tap on the nearest
 * crumb, under the same Crumb tap setting (Auto drops the spot you leave,
 * Manual keeps it ahead of you, faded). Returns whether the reader moved.
 */
export function stepBackCrumb(readerId: string): boolean {
  const trail = trailFor(readerId);
  const depth = get(trail.historyDepth);
  if (depth < 1) return false;
  goToCrumb(readerId, depth, getSettings().crumbTap !== 'manual');
  return get(trail.historyDepth) < depth;
}
