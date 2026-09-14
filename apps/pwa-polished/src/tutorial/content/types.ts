import type { Box } from '../engine/targets';
import type { WindowEdge } from '../../lib/stores/windowStore';

/** What a step can read and do while it runs. */
export interface StepContext {
  /** Scratch space shared by every step of one tour run. */
  tour: Record<string, any>;
  /** When the current step came up (ms). */
  enteredAt: number;
  /** Jump to the step with this id. */
  goTo: (id: string) => void;
}

/** An invisible strip over a screen edge that a drag can start from. */
export interface EdgeLane {
  edge: WindowEdge;
  box: Box;
}

export interface TourStep {
  id: string;
  title: string | ((ctx: StepContext) => string);
  body: string | ((ctx: StepContext) => string);

  /**
   * What to spotlight: an element, several (spotlit together), or nothing yet.
   * Leave it out for a card in the middle of the screen. While it returns
   * nothing the step waits; after a moment it shows as a plain card instead,
   * so a target that never turns up can't strand the tour.
   */
  target?: (ctx: StepContext) => Element | Element[] | null;

  /** Spotlight a screen edge and let a drag start there (the window gesture). */
  lane?: (ctx: StepContext) => EdgeLane | null;

  /** Taps inside the spotlight reach the app. Default true. */
  passThrough?: boolean;

  /**
   * Scroll the target into view when it first appears. `'center'` brings it
   * to the middle of the screen, for things in the text, where the card needs
   * room beside them.
   */
  reveal?: boolean | 'center';

  /** Room around the target inside the spotlight, in px. Default 6. */
  pad?: number;

  /**
   * How long to wait for the target before showing the card without a
   * spotlight, in ms. Longer for things that load after a tap, like badges.
   */
  waitMs?: number;

  /**
   * The start of a section. The tour bookmarks it on the way past, and an app
   * restart resumes there. Everything after it up to the next one must work
   * without anything earlier steps left in `ctx.tour`.
   */
  checkpoint?: boolean;

  /** Leave this step out, decided on arrival. */
  skipIf?: (ctx: StepContext) => boolean | Promise<boolean>;

  /** Runs on arrival, after skipIf. */
  onEnter?: (ctx: StepContext) => void | Promise<void>;

  /** Runs on the way out, however the step ended. */
  onLeave?: (ctx: StepContext) => void;

  /** Move on by itself as soon as this is true: the person did the thing. */
  doneWhen?: (ctx: StepContext) => boolean;

  /** Panes may be open while this step shows. Otherwise it waits for them to close. */
  allowPanes?: boolean;

  /**
   * The one popup this step lives in (a selector from `OVERLAYS` in
   * engine/watch). Any other popup hides the tour until it closes.
   */
  allowOverlay?: string;

  /** Label for the Next button. */
  nextLabel?: string;

  /** A second button beside Next, shown only while `when` holds. */
  alt?: { label: string; run: (ctx: StepContext) => void; when?: (ctx: StepContext) => boolean };

  /** Extra content inside the card. */
  extra?: 'colors';
}
