/**
 * sharedRealtime — who else is in the notebook you have open, and who is
 * writing in it.
 *
 * One channel, named after the notebook, carrying two different things:
 *
 *   1. Postgres changes on the three shared tables, filtered to that notebook,
 *      so a page somebody else saves appears here within a second instead of
 *      on the next pull. What arrives is only ever a nudge — the row itself is
 *      fetched by SharedNotebookStore.pull(), which is the one place allowed to
 *      write into IndexedDB, so a payload that arrived out of order or with
 *      half a row in it cannot become the copy this device keeps.
 *
 *   2. Presence, which is new to this app: each device says which page it has
 *      open and whether it is writing in it, and every other device is told.
 *      That is the whole of the lock. It is deliberately not a row in a table
 *      anybody has to remember to clear — presence disappears by itself when
 *      the app closes or the signal goes, so a lock can never get stuck with
 *      nobody holding it.
 *
 * The channel is kept out of RealtimeService for the same reason the store is
 * kept out of the sync engine: that channel is filtered to one account's own
 * rows, and everything hanging off it assumes every row it sees belongs to the
 * person holding the device.
 *
 * One notebook at a time. A device is only ever looking at one, and a socket
 * per notebook somebody happens to be a member of would spend the realtime
 * allowance on notebooks nobody is reading.
 *
 * A reader of a Broadcast notebook holds no socket at all — that is what makes
 * a public notebook with a thousand readers possible. They poll instead, which
 * is `mode: 'poll'` below: the same nudge, arriving every 45 seconds rather
 * than immediately, and no presence because there is no channel to carry it.
 */

import { writable } from 'svelte/store';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../supabase/client';

/** One device, as everybody else sees it. */
export interface LivePerson {
  userId: string;
  /** The page they have open, or null for somebody browsing the list. */
  pageId: string | null;
  writing: boolean;
  /** When the claim to write began. The earliest claim wins a race for a page. */
  since: number;
  /** The last sign of life from a writer — opening the editor, then typing. */
  at: number;
}

export interface SharedLiveState {
  notebookId: string | null;
  /** 'live' holds a socket; 'poll' is a Broadcast reader checking now and then. */
  mode: 'off' | 'live' | 'poll';
  connected: boolean;
  /** Everybody in this notebook right now, this device included. */
  people: LivePerson[];
}

/** How long a writer can go quiet before anyone else may take the page over. */
export const WRITER_IDLE_MS = 60_000;

/** Typing re-announces the claim at most this often — it is a keystroke handler. */
const TYPING_PING_MS = 15_000;
const POLL_MS = 45_000;
/** Only wakes the "has the writer gone quiet?" question. Nothing is fetched. */
const CLOCK_MS = 10_000;
/** A burst of row changes — a save touches the page and the notebook — is one nudge. */
const CHANGE_DEBOUNCE_MS = 250;
const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 30_000;

export const sharedLive = writable<SharedLiveState>({
  notebookId: null,
  mode: 'off',
  connected: false,
  people: [],
});

/**
 * A slow tick, so "they stopped writing a minute ago" can become true on its
 * own. Presence only arrives when somebody's state changes, and a writer going
 * quiet is precisely the case where nothing arrives.
 */
export const liveClock = writable(Date.now());

interface LiveRequest {
  notebookId: string;
  userId: string;
  /** False for a Broadcast reader, who polls instead of holding a socket. */
  live: boolean;
  onChange: () => void;
}

class SharedLiveService {
  private channel: RealtimeChannel | null = null;
  private want: LiveRequest | null = null;
  /** What this device is telling everybody else. */
  private me: LivePerson | null = null;

  private changeTimer: ReturnType<typeof setTimeout> | null = null;
  private clockTimer: ReturnType<typeof setInterval> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelayMs = RECONNECT_BASE_MS;

  /**
   * Follow a notebook. Safe to call on every redraw: asking for the one that
   * is already open only swaps in the newer callback, so the caller can drive
   * this from a reactive statement without tearing the socket down each time
   * something unrelated changes.
   */
  open(request: LiveRequest): void {
    if (
      this.want &&
      this.want.notebookId === request.notebookId &&
      this.want.userId === request.userId &&
      this.want.live === request.live
    ) {
      this.want.onChange = request.onChange;
      return;
    }

    this.close();
    this.want = { ...request };
    this.me = {
      userId: request.userId,
      pageId: null,
      writing: false,
      since: 0,
      at: Date.now(),
    };
    sharedLive.set({
      notebookId: request.notebookId,
      mode: request.live ? 'live' : 'poll',
      connected: false,
      people: [],
    });

    if (!request.live) {
      this.pollTimer = setInterval(() => this.nudge(), POLL_MS);
      return;
    }

    this.clockTimer = setInterval(() => liveClock.set(Date.now()), CLOCK_MS);
    this.join();
  }

  /** Stop following. Everybody else's copy of this device disappears with it. */
  close(): void {
    for (const timer of [this.changeTimer, this.reconnectTimer]) {
      if (timer) clearTimeout(timer);
    }
    for (const timer of [this.clockTimer, this.pollTimer]) {
      if (timer) clearInterval(timer);
    }
    this.changeTimer = null;
    this.reconnectTimer = null;
    this.clockTimer = null;
    this.pollTimer = null;
    this.reconnectDelayMs = RECONNECT_BASE_MS;
    this.want = null;
    this.me = null;

    if (this.channel) {
      const channel = this.channel;
      this.channel = null;
      // untrack is implied by leaving, and awaiting it here would only delay
      // a teardown that is usually a panel closing.
      void supabase.removeChannel(channel);
    }
    sharedLive.set({ notebookId: null, mode: 'off', connected: false, people: [] });
  }

  /** Which page this device has open. Null while browsing the list. */
  setPage(pageId: string | null): void {
    if (!this.me || this.me.pageId === pageId) return;
    this.me.pageId = pageId;
    // Leaving a page gives up any claim on it, whatever order the two calls
    // arrive in — a claim left behind on a page nobody has open is exactly the
    // stuck lock this design is meant not to have.
    if (pageId === null) {
      this.me.writing = false;
      this.me.since = 0;
    }
    this.me.at = Date.now();
    void this.track();
  }

  /** Whether this device is in the editor on that page. */
  setWriting(writing: boolean): void {
    if (!this.me || this.me.writing === writing) return;
    this.me.writing = writing;
    this.me.since = writing ? Date.now() : 0;
    this.me.at = Date.now();
    void this.track();
  }

  /**
   * A keystroke. Re-announces the claim, at most every 15 seconds, so somebody
   * writing steadily is never shown as having gone quiet — and somebody who
   * genuinely has stopped is, a minute later.
   */
  ping(): void {
    if (!this.me?.writing) return;
    if (Date.now() - this.me.at < TYPING_PING_MS) return;
    this.me.at = Date.now();
    void this.track();
  }

  // ── The channel ──────────────────────────────────────────────────────────

  private join(): void {
    const want = this.want;
    if (!want) return;

    const filter = `notebook_id=eq.${want.notebookId}`;
    const channel = supabase.channel(`shared_nb_${want.notebookId}`, {
      // Keyed by account, so the same person on a phone and a laptop is one
      // entry rather than two of them apparently racing each other for a page.
      config: { presence: { key: want.userId } },
    });

    channel
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'shared_notebook_pages', filter },
        (payload) => {
          // This device's own save came back here as well, and it has already
          // stored the authoritative row the function handed it. Fetching the
          // notebook again to learn what it just wrote is a round trip for
          // nothing, and it would land mid-sentence in its own editor.
          const row = (payload.new ?? {}) as { updated_by?: string };
          if (row.updated_by && row.updated_by === want.userId) return;
          this.nudge();
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'shared_notebook_members', filter },
        () => this.nudge(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'shared_notebooks', filter: `id=eq.${want.notebookId}` },
        () => this.nudge(),
      )
      .on('presence', { event: 'sync' }, () => this.readPresence())
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          this.reconnectDelayMs = RECONNECT_BASE_MS;
          sharedLive.update((s) => ({ ...s, connected: true }));
          void this.track();
          // A reconnect means this device was away; whatever happened while it
          // was gone arrived on nobody's socket.
          this.nudge();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          sharedLive.update((s) => ({ ...s, connected: false, people: [] }));
          this.scheduleRejoin();
        }
      });

    this.channel = channel;
  }

  private scheduleRejoin(): void {
    if (this.reconnectTimer || !this.want) return;
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, RECONNECT_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.want) return;
      if (this.channel) {
        const stale = this.channel;
        this.channel = null;
        try {
          void supabase.removeChannel(stale);
        } catch {
          /* already gone */
        }
      }
      this.join();
    }, delay);
  }

  /** Tell everybody else what this device is doing. */
  private async track(): Promise<void> {
    if (!this.channel || !this.me) return;
    if (this.channel.state !== 'joined') return;
    try {
      await this.channel.track({ ...this.me });
    } catch (err) {
      console.warn('[SharedLive] Could not announce presence:', err);
    }
  }

  private readPresence(): void {
    if (!this.channel) return;
    const raw = this.channel.presenceState() as Record<string, unknown[]>;
    const people: LivePerson[] = [];

    for (const entries of Object.values(raw)) {
      // One account, possibly two devices: the newest entry is the one to
      // believe, since the older one is a tab left open somewhere.
      const last = entries[entries.length - 1] as Partial<LivePerson> | undefined;
      if (!last || typeof last.userId !== 'string') continue;
      people.push({
        userId: last.userId,
        pageId: typeof last.pageId === 'string' ? last.pageId : null,
        writing: last.writing === true,
        since: Number(last.since) || 0,
        at: Number(last.at) || 0,
      });
    }

    people.sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
    sharedLive.update((s) => ({ ...s, people }));
  }

  /** Something changed over there — ask the caller to go and read it. */
  private nudge(): void {
    if (this.changeTimer) clearTimeout(this.changeTimer);
    this.changeTimer = setTimeout(() => {
      this.changeTimer = null;
      this.want?.onChange();
    }, CHANGE_DEBOUNCE_MS);
  }
}

const service = new SharedLiveService();

export const openSharedLive = (request: LiveRequest): void => service.open(request);
export const closeSharedLive = (): void => service.close();
export const setLivePage = (pageId: string | null): void => service.setPage(pageId);
export const setLiveWriting = (writing: boolean): void => service.setWriting(writing);
export const pingLiveTyping = (): void => service.ping();

// ─── Reading the room ────────────────────────────────────────────────────────

/**
 * Who holds the page.
 *
 * Earliest claim first, and the lower user id where two claims landed in the
 * same instant — every device sorts the same list the same way, so they all
 * reach the same answer without asking the server which of them was first.
 */
export function writerOfPage(people: LivePerson[], pageId: string | null): LivePerson | null {
  if (!pageId) return null;
  const claims = people.filter((p) => p.writing && p.pageId === pageId);
  if (claims.length === 0) return null;
  claims.sort((a, b) => a.since - b.since || (a.userId < b.userId ? -1 : 1));
  return claims[0];
}

/**
 * Has the writer gone quiet? After this, anybody else who may edit the page is
 * offered Take over — the claim is still there, but nothing is happening under
 * it, and waiting on a phone somebody put in their pocket is not a feature.
 */
export function isIdleWriter(person: LivePerson, now: number): boolean {
  return now - person.at > WRITER_IDLE_MS;
}
