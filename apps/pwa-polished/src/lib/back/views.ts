/**
 * The screens the phone's Back knows about, watched through the stores they
 * already have, so their components need no Back code of their own.
 *
 * - Crumbs: every reader's crumbs (the main reader and each Bible window)
 *   are steps. Back taps the nearest one (lib/back/crumbs.ts).
 * - Tap-away screens: Back closes them with the same call their backdrop
 *   makes. The lookup card and the shared-notebook join card keep their
 *   close inside the component, so they report from there.
 * - × -only views put up a wall (see backList.ts). Those whose open state
 *   lives inside a component (picture viewer, devotional reading, word popup,
 *   note popup, Connections and Timeline full screen, the tutorial) put it up
 *   from there.
 *
 * Side windows are never closed by Back and are not walls: Back walks their
 * crumbs and the reader's alike.
 *
 * Started once, from App.svelte.
 */

import { derived } from 'svelte/store';
import { MAIN_READER, watchReaders } from '../../stores/navigationStore';
import { backDepth, backStep, RANK_OLD_MAIN, RANK_OLD_WINDOW, trackKeyed, trackOpen, trackWall, type BackHandle } from './backList';
import { stepBackCrumb } from './crumbs';
import { readingPlanModalStore } from '../../stores/readingPlanModalStore';
import { profileModalStore } from '../../stores/profileModalStore';
import { dailyGreetingOpen, dismissDailyGreeting } from '../../stores/dailyGreetingStore';
import { welcomePending, dismissWelcome } from '../../stores/welcomeStore';
import { userProfileStore } from '../../stores/userProfileStore';
import { paneStore } from '../../stores/paneStore';
import { confirms, answerConfirm } from '../../stores/confirmStore';
import { familyTreeStore } from '../../stores/familyTreeStore';
import { parallelStore } from '../../stores/parallelStore';
import { bubbleView, wordCloudView } from '../../stores/bubbleViewStore';
import { byHeartGame } from '../byHeart/game';
import { currentDownload, showProgressModal } from '../pack-triggers';
import { recorder } from '../recorder/recorder';
import { voiceCard } from '../voice/holdToTalk';
import { stoppedRecording, afterStop } from '../voice/transcribe';

let started = false;

export function startBackViews(): void {
  if (started) return;
  started = true;

  // ── Crumbs ──
  watchReaders((readerId, trail) => {
    // A harmony pane never keeps a trail.
    if (readerId.startsWith('harmony-')) return () => {};
    const steps = backDepth(() => stepBackCrumb(readerId), {
      reader: true,
      // Crumbs saved from before the app was closed: the main reader's are the
      // last thing Back walks before it leaves, a Bible window's just before.
      oldRank: readerId === MAIN_READER ? RANK_OLD_MAIN : RANK_OLD_WINDOW,
    });
    const unsubscribe = trail.historyDepth.subscribe((depth) => steps.set(depth));
    return () => {
      unsubscribe();
      steps.dispose();
    };
  });

  // ── Tap-away screens ──
  trackOpen(readingPlanModalStore, () => readingPlanModalStore.close());
  trackOpen(profileModalStore, () => profileModalStore.close());
  trackOpen(dailyGreetingOpen, dismissDailyGreeting);
  // As WelcomeModal decides it is open: owed, and signed in.
  trackOpen(
    derived([welcomePending, userProfileStore], ([$pending, $user]) => $pending && $user.isSignedIn),
    dismissWelcome,
  );

  // Side panes (Settings, Packs, Auto-Read Alarm…): each closes by its backdrop.
  const panes = new Map<string, BackHandle>();
  paneStore.subscribe((list) => {
    for (const pane of list) {
      let step = panes.get(pane.id);
      if (!step) {
        step = backStep(() => paneStore.closePane(pane.id));
        panes.set(pane.id, step);
      }
      step.set(pane.isOpen);
    }
    for (const [id, step] of panes) {
      if (!list.some((p) => p.id === id)) {
        step.dispose();
        panes.delete(id);
      }
    }
  });

  // The confirm box: Back answers "No", as a tap outside it does. Only the
  // first question is on screen; the next gets its own step as it shows.
  trackKeyed(
    derived(confirms, ($c) => $c[0]?.id ?? null),
    (id) => answerConfirm(id, false),
  );

  // Voice Control's cards: the mic/download card closes, and the card after a
  // recording stops keeps the recording only, as a tap outside each does.
  trackOpen(voiceCard, () => voiceCard.set(null));
  trackOpen(stoppedRecording, () => afterStop('keep'));

  // ── × -only views ──
  trackWall(derived(familyTreeStore, ($t) => $t.isOpen));
  trackWall(derived(parallelStore, ($p) => $p.active));
  trackWall(derived(bubbleView, ($b) => $b.open));
  trackWall(wordCloudView);
  // As App.svelte shows a game: one is set, and you're signed in.
  trackWall(derived([byHeartGame, userProfileStore], ([$g, $user]) => !!$g && $user.isSignedIn));

  // ── Back does nothing ──
  // The pack progress box and the pocket recording screen.
  trackWall(derived([showProgressModal, currentDownload], ([$show, $dl]) => $show && !!$dl));
  trackWall(derived(recorder, ($r) => $r.pocket && $r.phase !== 'idle'));
}
