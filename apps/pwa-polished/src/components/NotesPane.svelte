<script lang="ts">
  /**
   * NotesPane — the desk.
   *
   * Two things live here, both signed-in only:
   *   1. Every verse note, in the same book dropdown the search results use.
   *   2. Notebooks the user names themselves, each holding free-form pages.
   *
   * Layout is a drill-down: list → tap → full-panel editor → ‹ Back. One shape
   * at every panel width, so a 20%-wide sliver and a 50/50 split both work.
   */
  import { onMount, onDestroy, tick } from 'svelte';
  import { ArrowLeft, UsersThree, CloudArrowUp } from 'phosphor-svelte';
  import RefAwareEditor from '../lib/components/RefAwareEditor.svelte';
  import SearchResultsTree from './SearchResultsTree.svelte';
  import { groupResultsByBook } from '../lib/searchTree';
  import type { SearchTreeNode } from '../lib/searchTree';
  import type { SearchResult } from '../lib/services/searchService';
  import { syncedUserDataStore, subscribeToUserDataRemoteChanges } from '../adapters/SyncedUserDataStore';
  import { syncedNotebookStore, subscribeToNotebookRemoteChanges } from '../adapters/SyncedNotebookStore';
  import type { Notebook, NotebookPage } from '../adapters/NotebookStore';
  import NotebookList from './NotebookList.svelte';
  import type { ListNotebook, ListPill } from './NotebookList.svelte';
  import SharedPageView from './SharedPageView.svelte';
  import SharedNotebookCreate from './SharedNotebookCreate.svelte';
  import SharedNotebookJoin from './SharedNotebookJoin.svelte';
  import SharedNotebookAdmin from './SharedNotebookAdmin.svelte';
  import MemberPillPicker from './MemberPillPicker.svelte';
  import CopyPageSheet from './CopyPageSheet.svelte';
  import type { CopyDestination } from './CopyPageSheet.svelte';
  import AuthorPill from './AuthorPill.svelte';
  import SharedLiveBar from './SharedLiveBar.svelte';
  import { sharedNotebookStore, subscribeToSharedNotebookChanges } from '../adapters/SharedNotebookStore';
  import {
    sharedLive,
    liveClock,
    openSharedLive,
    closeSharedLive,
    setLivePage,
    setLiveWriting,
    pingLiveTyping,
    writerOfPage,
    isIdleWriter,
  } from '../lib/shared/sharedRealtime';
  import {
    canWriteInNotebook,
    canEditPage,
    canRemovePage,
    canSetEditMode,
    canPinPage,
    canManageNotebook,
    isReadOnlyCopy,
  } from '../lib/shared/sharedPermissions';
  import type {
    SharedNotebook,
    SharedNotebookMember,
    SharedNotebookPage,
  } from '../adapters/SharedNotebookStore';
  import { userProfileStore } from '../stores/userProfileStore';
  import { profileModalStore } from '../stores/profileModalStore';
  import { get } from 'svelte/store';
  import { navigationStore } from '../stores/navigationStore';
  import { windowStore } from '../lib/stores/windowStore';
  import { showNotice } from '../stores/noticeStore';

  export let windowId: string | undefined = undefined;
  export let contentState: any = {};
  /** Which screen edge this panel is docked to — drives the resize-grip gutter below. */
  export let edge: 'left' | 'right' | 'top' | 'bottom' = 'right';

  const QUICK_NOTES = 'Quick Notes';

  // Window.svelte's resize strip is 32px wide with 8px hanging outside the
  // panel, so 24px of it sits on top of our content along the inner edge and
  // swallows every tap. Pad that side clear, with a finger's margin beyond it.
  // A bottom-docked panel needs nothing: its grip runs along the top, where the
  // window's own header already covers it.
  $: gutterL = edge === 'right' ? '32px' : '0px';
  $: gutterR = edge === 'left' ? '32px' : '0px';
  $: gutterB = edge === 'top' ? '32px' : '0px';

  type Target =
    | { kind: 'verse'; noteId: string | null; book: string; chapter: number; verse: number }
    | { kind: 'page'; pageId: string; notebookId: string }
    | { kind: 'shared'; pageId: string; notebookId: string };

  let view: 'browse' | 'editor' | 'reader' = 'browse';
  let target: Target | null = null;

  /**
   * Which half of the pane you are looking at. Local is your own notebooks;
   * Shared is the ones you are in with other people. Same layout, different
   * accent, and a different set of things you are allowed to do.
   */
  let mode: 'local' | 'shared' = contentState?.mode === 'shared' ? 'shared' : 'local';

  const LOCAL_ACCENT = '#667eea';
  const LOCAL_PAGE_ACCENT = '#60a5fa';
  const SHARED_ACCENT = '#2dd4bf';
  const SHARED_PAGE_ACCENT = '#5eead4';

  /**
   * Namespaces the shared side's open/closed keys — see NotebookList. Named
   * here rather than written out twice, because the pane also builds one of
   * these by hand to open a notebook it has just joined.
   */
  const SHARED_KEY_PREFIX = 'snb';

  // ─── Browse data ────────────────────────────────────────────────────────────
  let verseNotes: { id: string; book: string; chapter: number; verse: number; text: string }[] = [];
  let notebooks: Notebook[] = [];
  let pagesByNotebook = new Map<string, NotebookPage[]>();
  // Verse Notes opens expanded on a fresh panel — it is the thing you came for.
  let expanded = new Set<string>(contentState?.expanded ?? ['versenotes']);
  let loading = true;

  // ─── Shared browse data ─────────────────────────────────────────────────────
  let sharedNotebooks: SharedNotebook[] = [];
  let sharedPagesByNotebook = new Map<string, SharedNotebookPage[]>();
  let sharedMembersByNotebook = new Map<string, SharedNotebookMember[]>();
  let sharedLoading = false;
  /** The page open in the reader. Held whole so its text survives a redraw. */
  let readerPage: SharedNotebookPage | null = null;
  let readerNotebook: SharedNotebook | null = null;
  /** This account's own place in that notebook — what every "may I?" asks. */
  let readerMember: SharedNotebookMember | null = null;
  /** The page's own ⋯ menu: pin, open or close, remove. */
  let sharedMenuOpen = false;
  /**
   * Why this page cannot be saved right now, in words for the person holding
   * it. Set when a save comes back refused rather than written — somebody else
   * got there first, or the page has been taken out of the notebook — and it
   * stops the autosave retrying into the same wall every two seconds.
   */
  let sharedBlocked: string | null = null;
  /**
   * The shared pages with writing that has not reached the notebook yet.
   *
   * Read from the outbox rather than worked out here, so the mark on the row,
   * the line in the reader and the pull that spares the page are all answering
   * the same question from the same place.
   */
  let pendingPages = new Set<string>();
  /**
   * The notebook this device is live in while nothing is open — the last one
   * unfolded in the list. One notebook at a time on purpose: a socket for every
   * notebook somebody is a member of would spend the realtime allowance on
   * notebooks nobody is looking at.
   */
  let browsingNotebookId: string | null = null;

  // ─── Inline row state ───────────────────────────────────────────────────────
  let creatingNotebook = false;
  let newNotebookName = '';

  // ─── Shared sheets ──────────────────────────────────────────────────────────
  // A shared notebook takes more than a name — who writes in it and who can see
  // it are both decided at the start — so it gets a sheet where a local one
  // gets an inline field. Joining and inviting are the two ends of the same
  // code and share one sheet; `inviteNotebook` is which notebook is being
  // handed out, and null means the sheet is closed.
  let joiningShared = false;
  let inviteNotebook: SharedNotebook | null = null;
  /** Which notebook's badge is being changed. Null means the picker is closed. */
  let badgeNotebook: SharedNotebook | null = null;
  /**
   * Which notebook's roster and settings are open. Null means the sheet is
   * closed. Everyone in a notebook can open it; what is on it depends on
   * whether they own the thing.
   */
  let managingNotebook: SharedNotebook | null = null;
  /**
   * The page waiting to be copied across the line between your own notebooks
   * and the shared ones, and which way it is going. Null means the sheet is
   * closed. Held whole rather than as an id because the page being sent may be
   * one that is open in the editor and not yet on the list.
   */
  let copying:
    | { mode: 'to-shared' | 'to-local'; title: string; label: string; text: string }
    | null = null;
  /**
   * What the create sheet is being opened for. A shared notebook made from the
   * + button is just itself; one made from a local notebook's ⋯ menu is about
   * to be filled with that notebook's pages; one made from the copy sheet is
   * somewhere for the page already waiting in `copying` to land. The sheet is
   * the same three questions either way — see SharedNotebookCreate — so this
   * says what happens once they have been answered rather than what is asked.
   */
  let creatingSharedFor:
    | { kind: 'plain' }
    | { kind: 'notebook'; notebook: Notebook }
    | { kind: 'page' }
    | null = null;

  // ─── Editor state ───────────────────────────────────────────────────────────
  let editorTitle = '';
  let editorText = '';
  let isDirty = false;
  let isSaving = false;
  let saveTimeout: number | null = null;
  let confirmDeleteOpen = false;
  let settling = false; // editor is loading its initial content, not being edited

  $: isSignedIn = $userProfileStore.isSignedIn;
  $: myUserId = $userProfileStore.userId;

  // What this account may do to the page that is open. Worked out here rather
  // than in the markup so the header, the menu and the save path cannot end up
  // disagreeing about it — and every one of them mirrors a rule the database
  // enforces anyway, so the worst a stale answer costs is a button that is
  // offered and then refused.
  $: canEditOpenPage = canEditPage(readerPage, readerNotebook, readerMember, myUserId);
  $: canPinOpenPage = canPinPage(readerPage, readerNotebook, myUserId);
  $: canRemoveOpenPage = canRemovePage(readerPage, readerNotebook, myUserId);
  $: canCloseOpenPage = canSetEditMode(readerPage, readerNotebook, myUserId);
  /**
   * Keeping a copy asks nothing of the notebook — it only writes to notebooks
   * of your own — so anybody who can read the page may do it, including a
   * reader of a Broadcast notebook who is offered nothing else on this menu.
   */
  $: canCopyOpenPage = !!readerPage;
  $: hasSharedMenu =
    canCopyOpenPage || canPinOpenPage || canRemoveOpenPage || canCloseOpenPage;
  /**
   * Whether the blocked bar can offer a way out. It can wherever this account
   * may add a page to the notebook, which is the same permission a brand-new
   * page needs — the copy is a new page, not an edit of the one in the way.
   */
  $: canKeepAsCopy = !!sharedBlocked && canWriteInNotebook(readerNotebook, readerMember);

  /** The page on screen belongs to a notebook this account is out of. */
  $: readerRemoved = isReadOnlyCopy(readerNotebook);

  /** The page on screen has writing in it that has not gone up yet. */
  $: readerWaiting = !!readerPage && pendingPages.has(readerPage.id);

  /** The roster of the notebook on screen, for the byline and the gutter. */
  $: readerRoster = readerNotebook
    ? sharedMembersByNotebook.get(readerNotebook.id) ?? []
    : [];

  // ─── Live ───────────────────────────────────────────────────────────────────
  // Which notebook this device follows: the one whose page is open, or — with
  // nothing open — the one last unfolded in the list, so a page somebody else
  // adds appears in it without the ↻ button. Nothing at all on the Local side.
  $: liveNotebookId =
    !isSignedIn || mode !== 'shared'
      ? null
      : view !== 'browse'
        ? readerNotebook && !isReadOnlyCopy(readerNotebook)
          ? readerNotebook.id
          : null
        : browsingNotebookId;

  // Called on every redraw; opening the notebook that is already open only
  // swaps in the newer callback, so this costs nothing when nothing has moved.
  // The roster is a dependency rather than something read inside: whether this
  // account holds a socket or polls depends on its role, and on the restore
  // path the role arrives after the notebook does.
  $: followNotebook(liveNotebookId, myUserId, sharedNotebooks, sharedMembersByNotebook);

  // What this device tells everybody else: which page it has open, and whether
  // it is in the editor on it. Both say nothing on a local note — a presence
  // entry is only ever about a shared page.
  $: setLivePage(view !== 'browse' && target?.kind === 'shared' ? target.pageId : null);
  $: setLiveWriting(view === 'editor' && target?.kind === 'shared');

  $: liveOthers = $sharedLive.people.filter((p) => p.userId !== myUserId);
  $: openSharedPageId = target?.kind === 'shared' ? target.pageId : null;
  /** Somebody else in the editor on the page this device has open. */
  $: liveWriter = writerOfPage(liveOthers, openSharedPageId);
  /** Their claim, with nothing typed under it for a minute. */
  $: liveWriterIdle = !!liveWriter && isIdleWriter(liveWriter, $liveClock);
  /**
   * The lock, and all it is: while somebody else is actively writing a page,
   * nobody else is offered the pencil. It is advisory — the revision check on
   * the server is what actually keeps a paragraph from being written over —
   * but it is the difference between two people taking turns and two people
   * finding out afterwards that one of them wasted ten minutes.
   */
  $: lockedByOther = !!liveWriter && !liveWriterIdle;
  $: readerAuthor = readerPage
    ? readerRoster.find((m) => m.userId === readerPage!.authorId) ?? null
    : null;

  // ─── Verse-note tree ────────────────────────────────────────────────────────
  // Shaped as SearchResults so SearchResultsTree renders it unchanged — the
  // book caps, counts, canonical order and reader colours all come free.
  $: verseTree = buildVerseTree(verseNotes);

  function buildVerseTree(notes: typeof verseNotes): SearchTreeNode[] {
    const results: SearchResult[] = notes
      .slice()
      .sort((a, b) => a.chapter - b.chapter || a.verse - b.verse)
      .map((n) => ({
        type: 'note' as const,
        title: `${n.book} ${n.chapter}:${n.verse}`,
        subtitle: preview(n.text),
        data: { book: n.book, chapter: n.chapter, verse: n.verse, noteId: n.id },
        score: 0,
      }));

    return [
      {
        key: 'versenotes',
        label: 'Verse Notes',
        count: results.length,
        children: groupResultsByBook('versenotes', results),
      },
    ];
  }

  // ─── List shapes ────────────────────────────────────────────────────────────
  // Both halves of the pane draw through the same list component, so each side
  // is only responsible for saying what its rows read like.

  $: localList = buildLocalList(notebooks, pagesByNotebook);
  $: sharedList = buildSharedList(
    sharedNotebooks,
    sharedPagesByNotebook,
    sharedMembersByNotebook,
    myUserId,
    pendingPages,
  );

  function buildLocalList(
    books: Notebook[],
    pages: Map<string, NotebookPage[]>,
  ): ListNotebook[] {
    return books.map((notebook) => ({
      id: notebook.id,
      name: notebook.name,
      pages: (pages.get(notebook.id) ?? []).map((page) => ({
        id: page.id,
        label: pageLabel(page),
        sub: `${preview(page.text) || 'Empty'} · ${formatDate(page.updatedAt)}`,
      })),
    }));
  }

  function buildSharedList(
    books: SharedNotebook[],
    pages: Map<string, SharedNotebookPage[]>,
    members: Map<string, SharedNotebookMember[]>,
    userId: string | null,
    waiting: Set<string>,
  ): ListNotebook[] {
    return books.map((notebook) => {
      const roster = members.get(notebook.id) ?? [];
      const memberFor = (id: string) => roster.find((m) => m.userId === id) ?? null;
      const nameFor = (id: string) => {
        const name = (memberFor(id)?.displayName ?? '').trim();
        return name || 'Someone';
      };
      const kind = notebook.kind === 'broadcast' ? 'Broadcast' : 'Group';
      const who = roster.length === 1 ? '1 person' : `${roster.length} people`;
      // Asked per notebook rather than once for the list: you can run one of
      // these and only be allowed to read the next.
      const me = roster.find((m) => m.userId === userId) ?? null;
      // A notebook this account has been put out of. Its pages are still here
      // to read and nothing in it can be touched, which is the one thing its
      // row has to say — so it says that instead of the kind and the count,
      // neither of which is true of it any more.
      const removed = isReadOnlyCopy(notebook);

      return {
        id: notebook.id,
        name: notebook.name || 'Untitled notebook',
        meta: removed ? 'You are no longer in this' : `${kind} · ${who}`,
        canAddPage: canWriteInNotebook(notebook, me),
        canInvite: !removed,
        canEditBadge: !removed,
        manageLabel: removed
          ? 'Your copy'
          : canManageNotebook(notebook, userId)
            ? 'Manage notebook'
            : 'Who is in it',
        pill: me ? pillFor(me, 'You') : undefined,
        pages: (pages.get(notebook.id) ?? []).map((page) => ({
          id: page.id,
          label: sharedPageLabel(page),
          sub: `${nameFor(page.authorId)} · ${formatDate(page.updatedAt)}`,
          pill: pillFor(memberFor(page.authorId), nameFor(page.authorId)),
          pinned: page.pinned,
          // A page only its author may rewrite. Worth showing on the row so it
          // isn't a surprise on opening it.
          closed: page.editMode === 'author',
          // Written with no signal and not up yet. Shown because the row is
          // otherwise indistinguishable from one everybody else can already
          // see, and knowing which is which is the whole point of saying so.
          waiting: waiting.has(page.id),
          canDelete: canRemovePage(page, notebook, userId),
        })),
      };
    });
  }

  // ─── Loading ────────────────────────────────────────────────────────────────

  async function loadAll() {
    if (!isSignedIn) {
      loading = false;
      return;
    }
    try {
      const [notes, books] = await Promise.all([
        syncedUserDataStore.getNotes(),
        syncedNotebookStore.getNotebooks(),
      ]);

      verseNotes = notes
        .filter((n) => stripHtml(n.text))
        .map((n) => ({
          id: n.id,
          book: n.reference.book,
          chapter: n.reference.chapter,
          verse: n.reference.verse,
          text: n.text,
        }));

      notebooks = books;

      // One read for every page, then bucket in memory — cheaper than a query
      // per notebook just to show counts.
      const allPages = await syncedNotebookStore.getAllPages();
      const buckets = new Map<string, NotebookPage[]>();
      for (const page of allPages) {
        const bucket = buckets.get(page.notebookId);
        if (bucket) bucket.push(page);
        else buckets.set(page.notebookId, [page]);
      }
      pagesByNotebook = buckets;
    } catch (err) {
      console.error('[NotesPane] load error:', err);
    } finally {
      loading = false;
    }
  }

  /**
   * Read every shared notebook this account is in.
   *
   * The pull is its own thing — see SharedNotebookStore for why it must never
   * go through the single-user sync engine. It throttles itself, so calling
   * this every time the Shared tab is shown costs nothing.
   */
  async function loadShared(opts: { force?: boolean } = {}) {
    if (!isSignedIn) {
      sharedNotebooks = [];
      return;
    }
    sharedLoading = sharedNotebooks.length === 0;
    try {
      await sharedNotebookStore.pull(opts);
      const [books, pages, members, waiting] = await Promise.all([
        sharedNotebookStore.getNotebooks(),
        sharedNotebookStore.getAllPages(),
        sharedNotebookStore.getAllMembers(),
        sharedNotebookStore.pendingPages(),
      ]);

      pendingPages = waiting;

      sharedNotebooks = books;

      const pageBuckets = new Map<string, SharedNotebookPage[]>();
      for (const page of pages) {
        const bucket = pageBuckets.get(page.notebookId);
        if (bucket) bucket.push(page);
        else pageBuckets.set(page.notebookId, [page]);
      }
      // getAllPages doesn't sort — the per-notebook order is pinned first,
      // then most recently written, the same as getPages returns.
      for (const bucket of pageBuckets.values()) {
        bucket.sort((a, b) => {
          if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
          return b.updatedAt.getTime() - a.updatedAt.getTime();
        });
      }
      sharedPagesByNotebook = pageBuckets;

      const memberBuckets = new Map<string, SharedNotebookMember[]>();
      for (const member of members) {
        const bucket = memberBuckets.get(member.notebookId);
        if (bucket) bucket.push(member);
        else memberBuckets.set(member.notebookId, [member]);
      }
      sharedMembersByNotebook = memberBuckets;

      // The page in the reader may have been rewritten or taken out by
      // somebody else while it was open.
      if (readerPage) {
        const fresh = pages.find((p) => p.id === readerPage!.id) ?? null;
        if (!fresh) {
          // Gone. Reading it, there is nothing to stay for; editing it, the
          // text on screen is still the writer's and is not thrown away for
          // them — the bar says what happened and offers to keep it.
          if (view === 'reader') backToBrowse();
          else if (view === 'editor' && target?.kind === 'shared') {
            sharedBlocked = 'This page has been taken out of the notebook.';
          }
        } else if (view !== 'editor') {
          readerPage = fresh;
        }
        // Left alone in the editor on purpose. readerPage carries the revision
        // the save will be measured against, and quietly advancing it to
        // whatever somebody else just wrote is exactly how their paragraph
        // would disappear: the save would look up to date and write over it.
      }
      if (readerNotebook) {
        readerNotebook = books.find((n) => n.id === readerNotebook!.id) ?? readerNotebook;
        readerMember =
          members.find((m) => m.notebookId === readerNotebook!.id && m.userId === myUserId) ?? null;
      }
    } catch (err) {
      console.error('[NotesPane] shared load error:', err);
    } finally {
      sharedLoading = false;
    }
  }

  /**
   * Follow a notebook's changes as they happen.
   *
   * A reader of a Broadcast notebook is given no socket — that is the whole
   * point of a Broadcast one, and it is what lets a public notebook have more
   * readers than the realtime allowance has connections. They are handed the
   * same nudge on a timer instead.
   */
  function followNotebook(
    notebookId: string | null,
    userId: string | null,
    books: SharedNotebook[],
    members: Map<string, SharedNotebookMember[]>,
  ) {
    if (!notebookId || !userId) {
      closeSharedLive();
      return;
    }
    const notebook =
      books.find((n) => n.id === notebookId) ??
      (readerNotebook?.id === notebookId ? readerNotebook : null);
    // A notebook this account has been removed from is kept on the device but
    // is nothing to do with the server any more: a channel filtered to it
    // would carry nothing, and a presence entry in it would be announcing
    // somebody who is not there.
    if (isReadOnlyCopy(notebook)) {
      closeSharedLive();
      return;
    }
    const me = (members.get(notebookId) ?? []).find((m) => m.userId === userId);
    const live = notebook?.kind !== 'broadcast' || canWriteInNotebook(notebook, me ?? null);
    openSharedLive({ notebookId, userId, live, onChange: remoteSharedChange });
  }

  /**
   * Somebody else changed something in the notebook being followed.
   *
   * Only ever a nudge to go and read: the row itself comes through the store's
   * own pull, forced past its throttle because the whole point of the channel
   * is that this arrives now rather than within ten seconds. Unsaved writing is
   * left strictly alone — loadShared will not touch a page under an open
   * editor, and while there is anything unsaved it is not called at all.
   */
  function remoteSharedChange() {
    if (isDirty) return;
    void loadShared({ force: true });
  }

  /**
   * A member as the badge the list draws.
   *
   * Undefined for somebody who is not on the roster — a page written by
   * a person who has since left the notebook. The row still names them from
   * the page's author id; it simply has no colour to draw them in, and an
   * invented one would be a different person's badge next week.
   */
  function pillFor(member: SharedNotebookMember | null, title: string): ListPill | undefined {
    if (!member) return undefined;
    return { color: member.color, initials: member.initials || '··', title };
  }

  /** Whoever wrote a page, as their display name — "Someone" until we know. */
  function authorName(notebookId: string, userId: string): string {
    const member = (sharedMembersByNotebook.get(notebookId) ?? []).find(
      (m) => m.userId === userId,
    );
    const name = (member?.displayName ?? '').trim();
    return name || 'Someone';
  }

  function sharedPageLabel(page: SharedNotebookPage): string {
    const title = (page.title ?? '').trim();
    if (title) return title;
    const body = stripHtml(page.text);
    return body ? body.slice(0, 40) : 'Untitled';
  }

  let unsubUserData: (() => void) | null = null;
  let unsubNotebooks: (() => void) | null = null;
  let unsubShared: (() => void) | null = null;

  onMount(async () => {
    await loadAll();
    await restoreFromContentState();
    if (mode === 'shared') void loadShared();

    const reload = () => {
      // Never clobber unsaved edits with a remote pull.
      if (!isDirty) void loadAll();
    };
    unsubUserData = subscribeToUserDataRemoteChanges(reload);
    unsubNotebooks = subscribeToNotebookRemoteChanges(reload);
    unsubShared = subscribeToSharedNotebookChanges(() => {
      if (!isDirty) void loadShared();
    });
  });

  onDestroy(() => {
    unsubUserData?.();
    unsubNotebooks?.();
    unsubShared?.();
    // The panel can be closed by dragging it off the edge — flush before we go.
    if (isDirty) void save();
    if (saveTimeout) clearTimeout(saveTimeout);
    // And take this device out of the room, rather than leaving a badge behind
    // on a page nobody has open.
    closeSharedLive();
  });

  /** Reopen whatever the panel was showing before a reload or an edge change. */
  async function restoreFromContentState() {
    const saved = contentState?.target as Target | undefined;
    const savedView = contentState?.view;
    if ((savedView !== 'editor' && savedView !== 'reader') || !saved) return;

    if (saved.kind === 'shared') {
      // Straight from the local copy, so it is on screen before the pull that
      // refreshes it comes back. Whether it lands in the editor or the reader
      // is openShared's decision, not this one — a page that was open for
      // editing when the panel closed may have been closed to you since.
      await openShared(saved.notebookId, saved.pageId, savedView === 'editor');
      return;
    }

    if (saved.kind === 'page') {
      const page = await syncedNotebookStore.getPage(saved.pageId);
      if (!page) return;
      editorTitle = page.title ?? '';
      editorText = page.text;
    } else {
      const note = verseNotes.find((n) => n.id === saved.noteId);
      if (!note) return;
      editorTitle = `${note.book} ${note.chapter}:${note.verse}`;
      editorText = note.text;
    }
    target = saved;
    openEditor();
  }

  function persistState() {
    if (!windowId) return;
    windowStore.updateContentState(windowId, {
      view,
      target,
      mode,
      expanded: [...expanded],
    });
  }

  // ─── Browse actions ─────────────────────────────────────────────────────────

  function toggleNode(key: string) {
    if (expanded.has(key)) expanded.delete(key);
    else {
      expanded.add(key);
      // Unfolding a shared notebook is what says which one you are looking at,
      // and so which one this device should be following while nothing is open.
      if (key.startsWith(`${SHARED_KEY_PREFIX}::`)) {
        browsingNotebookId = key.slice(SHARED_KEY_PREFIX.length + 2);
      }
    }
    expanded = expanded;
    persistState();
  }

  function openVerseNote(result: SearchResult) {
    const { book, chapter, verse, noteId } = result.data;
    const note = verseNotes.find((n) => n.id === noteId);
    editorTitle = `${book} ${chapter}:${verse}`;
    editorText = note?.text ?? '';
    target = { kind: 'verse', noteId, book, chapter, verse };
    openEditor();
  }

  async function openPage(page: NotebookPage) {
    editorTitle = page.title ?? '';
    editorText = page.text;
    target = { kind: 'page', pageId: page.id, notebookId: page.notebookId };
    openEditor();
  }

  /** Switch between your own notebooks and the ones you share. */
  function setMode(next: 'local' | 'shared') {
    if (mode === next) return;
    mode = next;
    persistState();
    if (next === 'shared') void loadShared();
  }

  /**
   * A notebook has been made. What happens next is whatever it was made for.
   *
   * Made on its own, the invite sheet follows straight on, because a shared
   * notebook with nobody in it is not yet doing anything. Made to hold
   * something, the copying comes first — the notebook is not what was asked
   * for, it is where the thing that was asked for is going.
   */
  async function sharedCreated(notebook: SharedNotebook) {
    const job = creatingSharedFor;
    creatingSharedFor = null;

    if (job?.kind === 'notebook') {
      await copyNotebookInto(job.notebook, notebook);
      return;
    }

    if (job?.kind === 'page') {
      await copyWaitingPageInto(notebook);
      return;
    }

    showNotice(`Created “${notebook.name}”`);
    await loadShared({ force: true });
    inviteNotebook = notebook;
  }

  async function sharedJoined(notebook: SharedNotebook) {
    joiningShared = false;
    showNotice(`Joined “${notebook.name || 'the notebook'}”`);
    // The row has to be on screen before the notice goes, or joining looks
    // like it did nothing.
    await loadShared({ force: true });
    // Open it, so the pages are the next thing seen rather than a closed row.
    expanded.add(`${SHARED_KEY_PREFIX}::${notebook.id}`);
    expanded = expanded;
    browsingNotebookId = notebook.id;
    persistState();
  }

  /** Hand out a notebook's code. Its own row knows which one. */
  function openInvite(notebookId: string) {
    inviteNotebook = sharedNotebooks.find((n) => n.id === notebookId) ?? null;
  }

  /** Change the two letters and the colour you are known by in one notebook. */
  function openBadgePicker(notebookId: string) {
    badgeNotebook = sharedNotebooks.find((n) => n.id === notebookId) ?? null;
  }

  /**
   * Open the roster, and — for whoever owns the notebook — everything that
   * runs it. The same entry for both, because a member wanting to know who
   * else is here and an owner wanting to remove one of them are looking for
   * the same list.
   */
  function openManage(notebookId: string) {
    managingNotebook = sharedNotebooks.find((n) => n.id === notebookId) ?? null;
  }

  /**
   * Something in that sheet changed on the server. Force past the pull's
   * throttle — a role that has just been changed has to be the one on screen,
   * and the sheet stays open on top of the redrawn list.
   */
  async function manageChanged() {
    const id = managingNotebook?.id ?? null;
    await loadShared({ force: true });
    if (id) managingNotebook = sharedNotebooks.find((n) => n.id === id) ?? null;
  }

  /**
   * The notebook is gone from this device — left, or a removed copy thrown
   * away. Anything of it that was on screen goes with it.
   */
  async function manageGone(message: string) {
    const id = managingNotebook?.id ?? null;
    managingNotebook = null;
    showNotice(message);
    if (id) {
      if (browsingNotebookId === id) browsingNotebookId = null;
      if (readerNotebook?.id === id) backToBrowse();
      expanded.delete(`${SHARED_KEY_PREFIX}::${id}`);
      expanded = expanded;
      persistState();
    }
    await loadShared({ force: true });
  }

  async function badgeSaved() {
    badgeNotebook = null;
    showNotice('Your badge has been changed');
    // Every row that draws it — the notebook, its pages, and the gutter of
    // anything open — comes from the roster, so the list has to be rebuilt.
    await loadShared({ force: true });
  }

  /**
   * Put a shared page on screen.
   *
   * One way in for all three callers — a tap in the list, a page just created,
   * and a panel reopening where it left off — because each of them needs the
   * same three things fetched before anything can be decided: the page, the
   * notebook it is in, and this account's place in that notebook.
   *
   * `wantEditor` is a request, not an instruction. A page you may only read
   * opens in the reader whatever was asked for, which is what makes it safe
   * for the restore path to ask for the editor without checking first.
   */
  async function openShared(notebookId: string, pageId: string, wantEditor = false) {
    const page = await sharedNotebookStore.getPage(pageId);
    if (!page) return false;

    readerPage = page;
    readerNotebook =
      sharedNotebooks.find((n) => n.id === notebookId) ??
      (await sharedNotebookStore.getNotebook(notebookId));
    readerMember = myUserId
      ? await sharedNotebookStore.getMyMembership(notebookId, myUserId)
      : null;
    sharedMenuOpen = false;
    sharedBlocked = null;
    target = { kind: 'shared', pageId, notebookId };

    if (wantEditor && canEditPage(page, readerNotebook, readerMember, myUserId)) {
      editorTitle = page.title ?? '';
      editorText = page.text;
      openEditor();
    } else {
      view = 'reader';
      persistState();
    }
    return true;
  }

  /**
   * A shared page opens as something to read, even when you could write in it.
   * A local note is always yours, so it opens in the editor; a shared page is
   * usually somebody else's, and landing in a live editor on somebody else's
   * work is how a stray keystroke becomes an edit everyone can see.
   */
  function editSharedPage() {
    if (!readerPage || !canEditOpenPage) return;
    // One writer at a time. The pencil is already hidden while somebody else
    // is in the page, so this is the second door — a stale list, or the Take
    // over button pressed the instant they started typing again.
    if (lockedByOther) {
      showNotice(`${authorName(readerPage.notebookId, liveWriter!.userId)} is writing this page`, 'error');
      return;
    }
    sharedMenuOpen = false;
    sharedBlocked = null;
    editorTitle = readerPage.title ?? '';
    editorText = readerPage.text;
    openEditor();
  }

  /** Start a page in a shared notebook, and go straight into writing it. */
  async function newSharedPage(notebookId: string) {
    try {
      const page = await sharedNotebookStore.createPage({ notebookId });
      expanded.add(`${SHARED_KEY_PREFIX}::${notebookId}`);
      expanded = expanded;
      await loadShared({ force: true });
      await openShared(notebookId, page.id, true);
    } catch (err) {
      console.error('[NotesPane] shared page create failed:', err);
      showNotice((err as Error)?.message || 'That page could not be added', 'error');
    }
  }

  /**
   * Change something about the page that isn't its prose — whether others may
   * edit it, whether it sits at the top.
   *
   * These go through the same save as the text does, with the same revision
   * check, so a flag flipped against a copy of the page that has since moved on
   * is refused rather than taking the stale text along with it.
   */
  async function applySharedChange(
    changes: { editMode?: 'anyone' | 'author'; pinned?: boolean },
    done: string,
  ) {
    if (!readerPage) return;
    sharedMenuOpen = false;
    try {
      const result = await sharedNotebookStore.savePage(readerPage, changes);
      if (result.status === 'saved' && result.page) {
        readerPage = result.page;
        showNotice(done);
        await loadShared({ force: true });
      } else if (result.status === 'queued' && result.page) {
        // Done as far as this device is concerned, and it will be done for
        // everybody else when there is a signal. Said plainly rather than
        // silently, because pinning something nobody else can see yet is
        // exactly the sort of thing that looks broken when it isn't.
        readerPage = result.page;
        showNotice(`${done} — it will reach the notebook when you are back online`);
        await loadShared();
      } else if (result.status === 'conflict') {
        showNotice('Somebody else changed this page just now — try again', 'error');
        await loadShared({ force: true });
      } else {
        showNotice('That page has been taken out of the notebook', 'error');
        await backToBrowse();
      }
    } catch (err) {
      console.error('[NotesPane] shared change failed:', err);
      showNotice((err as Error)?.message || 'That could not be changed', 'error');
    }
  }

  function toggleSharedEditMode() {
    if (!readerPage) return;
    const next = readerPage.editMode === 'anyone' ? 'author' : 'anyone';
    void applySharedChange(
      { editMode: next },
      next === 'anyone'
        ? 'Anyone in this notebook can edit this page'
        : 'Only you can edit this page now',
    );
  }

  function toggleSharedPinned() {
    if (!readerPage) return;
    const next = !readerPage.pinned;
    void applySharedChange({ pinned: next }, next ? 'Pinned to the top' : 'Unpinned');
  }

  /** Take a page out of the notebook from its row, without opening it first. */
  async function removeSharedPageById(pageId: string) {
    try {
      await sharedNotebookStore.removePage(pageId);
      await loadShared({ force: true });
    } catch (err) {
      console.error('[NotesPane] shared page remove failed:', err);
      showNotice((err as Error)?.message || 'That page could not be removed', 'error');
    }
  }

  /**
   * Try the outbox again now, rather than waiting to be back online.
   *
   * The flush happens on its own — on the browser's 'online' event, and at the
   * top of every pull — so this exists for the moment somebody is looking at
   * the bar and would rather press something than trust it. A signal that is
   * still not there says so and changes nothing.
   */
  async function sendPending() {
    const waitingFor = readerPage?.id ?? null;
    await sharedNotebookStore.flushOutbox();
    await loadShared({ force: true });
    if (waitingFor && pendingPages.has(waitingFor)) {
      showNotice('Still no signal. It is safe here and will go up on its own.', 'error');
    }
  }

  /**
   * Keep what is in the editor as a page of its own.
   *
   * The way out of a save that was refused, and the reason a conflict here
   * costs nobody a paragraph: yours becomes a new page beside theirs instead of
   * one of the two being chosen over the other. Phase 8 generalises this to
   * edits made with no signal at all, which arrive at the same fork much later.
   */
  async function keepAsNewPage() {
    if (!readerPage) return;
    const base = editorTitle.trim() || sharedPageLabel(readerPage);
    try {
      const page = await sharedNotebookStore.createPage({
        notebookId: readerPage.notebookId,
        title: `${base} (your version)`,
        text: editorText,
      });
      sharedBlocked = null;
      isDirty = false;
      showNotice('Kept as a page of your own');
      await loadShared({ force: true });
      await openShared(page.notebookId, page.id, true);
    } catch (err) {
      console.error('[NotesPane] keep-as-copy failed:', err);
      showNotice((err as Error)?.message || 'That could not be kept', 'error');
    }
  }

  // ─── Across ─────────────────────────────────────────────────────────────────
  // The line between your own notebooks and the shared ones is crossed by
  // copying, in both directions and never by linking. A page sent to a study
  // group goes on being yours here; a page kept from one goes on being theirs
  // there. Nothing written on either side afterwards reaches the other.

  $: copyDestinations = buildCopyDestinations(
    copying,
    notebooks,
    pagesByNotebook,
    sharedNotebooks,
    sharedMembersByNotebook,
    myUserId,
  );

  function buildCopyDestinations(
    job: typeof copying,
    localBooks: Notebook[],
    localPages: Map<string, NotebookPage[]>,
    sharedBooks: SharedNotebook[],
    members: Map<string, SharedNotebookMember[]>,
    userId: string | null,
  ): CopyDestination[] {
    if (!job) return [];

    if (job.mode === 'to-local') {
      return localBooks.map((notebook) => {
        const count = localPages.get(notebook.id)?.length ?? 0;
        return {
          id: notebook.id,
          name: notebook.name,
          meta: count === 1 ? '1 page' : `${count} pages`,
        };
      });
    }

    // Only the ones this account may actually add a page to — a notebook you
    // are only reading is not a place a copy can go, and offering it would be
    // a refusal waiting to happen.
    return sharedBooks
      .filter((notebook) => {
        const me = (members.get(notebook.id) ?? []).find((m) => m.userId === userId) ?? null;
        return canWriteInNotebook(notebook, me);
      })
      .map((notebook) => {
        const roster = members.get(notebook.id) ?? [];
        return {
          id: notebook.id,
          name: notebook.name || 'Untitled notebook',
          meta: roster.length === 1 ? '1 person' : `${roster.length} people`,
        };
      });
  }

  /** Send the page in the editor to a shared notebook as a page of its own. */
  async function sendPageToShared() {
    if (target?.kind !== 'page') return;
    // What is on screen is what gets sent, so the original had better be
    // holding the same words before it goes.
    if (isDirty) await save();
    confirmDeleteOpen = false;
    // This panel may have been on the Local side since it opened, in which
    // case there is no shared list yet to choose from.
    await loadShared();
    const title = editorTitle.trim();
    copying = {
      mode: 'to-shared',
      title,
      label: title || stripHtml(editorText).slice(0, 40) || 'Untitled',
      text: editorText,
    };
  }

  /** Keep the shared page on screen as a page in one of your own notebooks. */
  async function keepSharedPageLocally() {
    if (!readerPage) return;
    sharedMenuOpen = false;
    // Somewhere to put it. Anybody who has never made a notebook of their own
    // would otherwise be handed an empty list and no way to fill it from here.
    if (notebooks.length === 0) await ensureQuickNotes();
    copying = {
      mode: 'to-local',
      title: (readerPage.title ?? '').trim(),
      label: sharedPageLabel(readerPage),
      text: readerPage.text,
    };
  }

  /**
   * The copy landed. Say where, and rebuild the side it landed on — the other
   * side has not moved, which is the point of the whole thing.
   */
  async function pageCopied(destinationName: string) {
    const mode = copying?.mode;
    copying = null;
    if (mode === 'to-shared') {
      // Sending a copy with no signal works like any other write — it is in
      // the notebook's local copy and in the outbox — but saying "Copied to
      // Romans Group" would have somebody expecting the group to have it.
      const offline = typeof navigator !== 'undefined' && !navigator.onLine;
      showNotice(
        offline
          ? `Copied to “${destinationName}” — it reaches them when you are back online`
          : `Copied to “${destinationName}”`,
      );
      await loadShared({ force: true });
    } else {
      showNotice(`Kept in “${destinationName}”`);
      await loadAll();
    }
  }

  /**
   * Hand a whole notebook of your own to a group.
   *
   * The destination does not exist yet, so this is the create sheet and then
   * the pages: the same three questions a shared notebook always asks, with the
   * name carried over and a line saying the local one stays where it is.
   */
  async function copyNotebookToShared(notebookId: string) {
    const notebook = notebooks.find((n) => n.id === notebookId);
    if (!notebook) return;
    // The pages are needed to copy, and the Local side may have been loaded
    // before any of them were written.
    if (!pagesByNotebook.has(notebookId)) await loadAll();
    creatingSharedFor = { kind: 'notebook', notebook };
  }

  /**
   * The notebook has been made; now fill it.
   *
   * One page at a time, in the order the list shows them — each is its own row
   * and its own stamp, and there is no call that takes a batch. A failure part
   * of the way through leaves the notebook made and the pages that landed in
   * it, which is why the notice says how many went rather than claiming the
   * whole thing. An empty local notebook makes an empty shared one, which is
   * what asking for it should do.
   */
  async function copyNotebookInto(source: Notebook, destination: SharedNotebook) {
    const pages = pagesFor(source.id);
    let sent = 0;
    let problem: string | null = null;

    for (const page of pages) {
      try {
        await sharedNotebookStore.createPage({
          notebookId: destination.id,
          title: (page.title ?? '').trim(),
          text: page.text,
        });
        sent += 1;
      } catch (err) {
        console.error('[NotesPane] notebook copy failed:', err);
        problem = (err as Error)?.message || 'Some pages could not be copied';
        break;
      }
    }

    await loadShared({ force: true });

    if (problem) {
      showNotice(
        sent === 0
          ? `“${destination.name}” was made, but no pages could be copied. ${problem}`
          : `“${destination.name}” was made with ${countPages(sent)} of ${pages.length}. ${problem}`,
        'error',
      );
    } else if (pages.length === 0) {
      showNotice(`Copied “${source.name}” — it had no pages`);
    } else {
      showNotice(`Copied “${source.name}” with ${countPages(sent)}`);
    }

    // Open the roster rather than the invite sheet: the notebook has just been
    // filled, and who is in it is the next thing worth deciding — the code is
    // on that sheet anyway.
    expanded.add(`${SHARED_KEY_PREFIX}::${destination.id}`);
    expanded = expanded;
    browsingNotebookId = destination.id;
    persistState();
    openManage(destination.id);
  }

  /** The page that was waiting on the copy sheet, into the notebook just made. */
  async function copyWaitingPageInto(destination: SharedNotebook) {
    const job = copying;
    if (!job) return;
    try {
      await sharedNotebookStore.createPage({
        notebookId: destination.id,
        title: job.title,
        text: job.text,
      });
      await pageCopied(destination.name);
    } catch (err) {
      console.error('[NotesPane] page copy into new notebook failed:', err);
      copying = null;
      showNotice(
        `“${destination.name}” was made, but the page could not be copied into it`,
        'error',
      );
      await loadShared({ force: true });
    }
  }

  function countPages(n: number): string {
    return n === 1 ? '1 page' : `${n} pages`;
  }

  function openEditor() {
    isDirty = false;
    confirmDeleteOpen = false;
    // LexicalEditor's update listener fires for its own initial content load,
    // which would otherwise mark a note dirty and bump updatedAt just for being
    // opened — reshuffling the page list every time you read something.
    settling = true;
    view = 'editor';
    void tick().then(() =>
      setTimeout(() => {
        settling = false;
        isDirty = false;
      }, 200),
    );
    persistState();
  }

  async function backToBrowse() {
    // Leaving the shared editor goes back to the page, not all the way out to
    // the list: the trip was made to change the page, so the changed page is
    // the thing worth landing on.
    if (view === 'editor' && target?.kind === 'shared' && !sharedBlocked) {
      if (isDirty) await save();
      sharedMenuOpen = false;
      confirmDeleteOpen = false;
      view = 'reader';
      persistState();
      await loadShared();
      return;
    }

    const wasReading = view === 'reader';
    if (isDirty) await save();
    view = 'browse';
    target = null;
    readerPage = null;
    readerNotebook = null;
    readerMember = null;
    sharedMenuOpen = false;
    sharedBlocked = null;
    confirmDeleteOpen = false;
    // Coming back from a shared page, the local lists haven't moved — asking
    // the database for all of them again would be work for nothing.
    if (wasReading) await loadShared();
    else await loadAll();
    persistState();
  }

  /** The notebook every quick note lands in. Created the first time it's needed. */
  async function ensureQuickNotes(): Promise<Notebook> {
    const existing = notebooks.find((n) => n.name === QUICK_NOTES);
    if (existing) return existing;
    const created = await syncedNotebookStore.createNotebook(QUICK_NOTES);
    notebooks = [...notebooks, created];
    return created;
  }

  async function newQuickNote() {
    const notebook = await ensureQuickNotes();
    await newPage(notebook.id);
  }

  async function newPage(notebookId: string) {
    const page = await syncedNotebookStore.createPage({ notebookId, title: '', text: '' });
    const bucket = pagesByNotebook.get(notebookId) ?? [];
    pagesByNotebook.set(notebookId, [page, ...bucket]);
    pagesByNotebook = pagesByNotebook;
    expanded.add(`nb::${notebookId}`);
    expanded = expanded;
    await openPage(page);
  }

  async function commitNewNotebook() {
    // Enter and the blur that follows it both land here — clear the field
    // before awaiting so the second call is a no-op instead of a duplicate.
    const name = newNotebookName.trim();
    newNotebookName = '';
    creatingNotebook = false;
    if (!name) return;
    const created = await syncedNotebookStore.createNotebook(name);
    notebooks = [...notebooks, created];
    expanded.add(`nb::${created.id}`);
    expanded = expanded;
    creatingNotebook = false;
    newNotebookName = '';
    persistState();
  }

  async function renameNotebook(id: string, name: string) {
    await syncedNotebookStore.renameNotebook(id, name);
    notebooks = notebooks.map((n) => (n.id === id ? { ...n, name } : n));
  }

  async function deleteNotebook(id: string) {
    await syncedNotebookStore.deleteNotebook(id);
    notebooks = notebooks.filter((n) => n.id !== id);
    pagesByNotebook.delete(id);
    pagesByNotebook = pagesByNotebook;
  }

  /** Delete a page straight from the list, without opening it first. */
  async function deletePageById(notebookId: string, pageId: string) {
    await syncedNotebookStore.deletePage(pageId);
    const remaining = pagesFor(notebookId).filter((p) => p.id !== pageId);
    pagesByNotebook.set(notebookId, remaining);
    pagesByNotebook = pagesByNotebook;
  }

  /** The list hands back an id; the page itself is already in hand. */
  function openLocalPageById(pageId: string) {
    for (const bucket of pagesByNotebook.values()) {
      const page = bucket.find((p) => p.id === pageId);
      if (page) {
        void openPage(page);
        return;
      }
    }
  }

  // ─── Editor ─────────────────────────────────────────────────────────────────

  function handleTextChange(e: CustomEvent<string>) {
    editorText = e.detail;
    if (settling) return;
    isDirty = true;
    // Typing is what keeps the claim on a shared page alive; a writer who has
    // typed nothing for a minute is one anybody else may take over from. The
    // service itself throttles this to once every fifteen seconds.
    if (target?.kind === 'shared') pingLiveTyping();
    debouncedSave();
  }

  function handleTitleInput() {
    isDirty = true;
    debouncedSave();
  }

  function handleBlur() {
    if (isDirty) void save();
  }

  function debouncedSave() {
    if (saveTimeout) clearTimeout(saveTimeout);
    // A shared page waits longer. Every save of one bumps the page's revision
    // and the notebook's, and from phase 5 wakes everybody else looking at it,
    // so saving mid-sentence is a cost other people pay. Both still flush on
    // blur and on the way out, so nothing rides on the timer.
    const wait = target?.kind === 'shared' ? 4000 : 2000;
    saveTimeout = window.setTimeout(() => void save(), wait);
  }

  async function save() {
    if (isSaving || !target) return;
    // A save that came back refused stays refused until the writer decides
    // what to do about it. Retrying every few seconds would only pile up the
    // same answer and bury the bar that is asking them.
    if (sharedBlocked) return;
    isSaving = true;
    const wasDirty = isDirty;
    isDirty = false;
    if (saveTimeout) {
      clearTimeout(saveTimeout);
      saveTimeout = null;
    }

    try {
      if (target.kind === 'verse') {
        // Emptying a verse note deletes it, same as the floating NotePopup —
        // an anchor with nothing behind it would leave a ✎ pointing at nothing.
        if (!stripHtml(editorText)) {
          const deletedId = target.noteId;
          if (deletedId) {
            await syncedUserDataStore.deleteNote(deletedId);
            verseNotes = verseNotes.filter((n) => n.id !== deletedId);
            target = { ...target, noteId: null };
          }
        } else if (target.noteId) {
          await syncedUserDataStore.updateNote(target.noteId, editorText);
        } else {
          const saved = await syncedUserDataStore.saveNote({
            reference: { book: target.book, chapter: target.chapter, verse: target.verse },
            text: editorText,
          });
          target = { ...target, noteId: saved.id };
        }
      } else if (target.kind === 'shared') {
        // Nothing is written if somebody else has saved since this copy was
        // taken. What comes back then is a status, not an exception, because
        // neither answer is a failure — see the bar below, which is where the
        // writer chooses what happens to their version.
        if (!readerPage) {
          isDirty = wasDirty;
          return;
        }
        const result = await sharedNotebookStore.savePage(readerPage, {
          title: editorTitle.trim(),
          text: editorText,
        });
        if (result.status === 'saved' && result.page) {
          readerPage = result.page;
        } else if (result.status === 'queued' && result.page) {
          // Nothing to say and nothing to stop: the words are in the local
          // copy, the outbox has them, and the strip above the editor says so
          // for as long as that is true. Autosave carries on as normal — each
          // pass simply replaces what is queued rather than sending anything.
          readerPage = result.page;
          pendingPages = new Set(pendingPages).add(result.page.id);
        } else {
          isDirty = wasDirty;
          sharedBlocked =
            result.status === 'conflict'
              ? 'Somebody else saved this page while you were writing, so yours has not been sent.'
              : 'This page has been taken out of the notebook.';
        }
      } else {
        // Pages are never auto-deleted: a titled page the user emptied on
        // purpose should still be there tomorrow. Deleting is explicit.
        await syncedNotebookStore.updatePage(target.pageId, {
          title: editorTitle.trim(),
          text: editorText,
        });
      }
      persistState();
    } catch (err) {
      console.error('[NotesPane] save error:', err);
      isDirty = wasDirty;
      // A refusal from the database — a reader writing, or a page its author
      // has closed since this was opened — arrives here. Its own wording is
      // already a plain sentence, so it is shown rather than replaced.
      if (target?.kind === 'shared') {
        sharedBlocked = (err as Error)?.message || 'That could not be saved.';
      }
    } finally {
      isSaving = false;
    }
  }

  async function deleteCurrent() {
    if (!target) return;
    confirmDeleteOpen = false;
    isDirty = false;
    if (saveTimeout) {
      clearTimeout(saveTimeout);
      saveTimeout = null;
    }
    try {
      if (target.kind === 'verse') {
        if (target.noteId) await syncedUserDataStore.deleteNote(target.noteId);
      } else if (target.kind === 'shared') {
        await sharedNotebookStore.removePage(target.pageId);
      } else {
        await syncedNotebookStore.deletePage(target.pageId);
      }
    } catch (err) {
      console.error('[NotesPane] delete error:', err);
      showNotice((err as Error)?.message || 'That could not be removed', 'error');
    }
    const wasShared = target.kind === 'shared';
    view = 'browse';
    target = null;
    readerPage = null;
    readerNotebook = null;
    readerMember = null;
    sharedMenuOpen = false;
    sharedBlocked = null;
    if (wasShared) await loadShared({ force: true });
    else await loadAll();
    persistState();
  }

  async function jumpToVerse() {
    if (!target || target.kind !== 'verse') return;
    if (isDirty) await save();
    navigationStore.pushHistory(get(navigationStore), 'notes');
    navigationStore.navigateToVerse(
      $navigationStore.translation,
      target.book,
      target.chapter,
      target.verse,
    );
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  function stripHtml(html: string): string {
    if (!html) return '';
    const div = document.createElement('div');
    div.innerHTML = html;
    return (div.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function preview(html: string): string {
    const text = stripHtml(html);
    return text.length > 140 ? text.slice(0, 140) + '…' : text;
  }

  function pageLabel(page: NotebookPage): string {
    const title = (page.title ?? '').trim();
    if (title) return title;
    const body = stripHtml(page.text);
    return body ? body.slice(0, 40) : 'Untitled';
  }

  function formatDate(d: Date): string {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function pagesFor(id: string): NotebookPage[] {
    return pagesByNotebook.get(id) ?? [];
  }

  /**
   * Focus a field the moment it appears. Must be synchronous: mobile browsers
   * only raise the keyboard for a focus() that happens inside the tap that
   * caused it, so deferring this to a tick or a timeout gets a caret with no
   * keyboard behind it.
   */
  function focusOnMount(node: HTMLInputElement) {
    node.focus();
    node.select();
  }

  /**
   * EdgeGestureDetector watches mousedown and touchstart on the whole window to
   * spot edge swipes, and only excuses rich-text areas — a plain input loses
   * focus to it mid-tap. Every input in the app that works stops these first.
   */
  function guardPointer(e: Event) {
    e.stopPropagation();
  }
</script>

<div
  class="notes-pane"
  style="--gut-l:{gutterL}; --gut-r:{gutterR}; --gut-b:{gutterB};"
>
  {#if !isSignedIn}
    <!-- ── Signed out ──────────────────────────────────────────────────────── -->
    <div class="auth-wall">
      <div class="auth-wall-icon">📝</div>
      <p class="auth-wall-text">
        Sign in to write notes and keep them synced across all your devices.
      </p>
      <button class="auth-wall-btn" on:click={() => profileModalStore.open()}>
        Sign In to Continue →
      </button>
    </div>
  {:else if view === 'editor'}
    <!-- ── Editor ──────────────────────────────────────────────────────────── -->
    <div class="editor-header" class:shared={target?.kind === 'shared'}>
      <button class="back-btn" on:click={backToBrowse}>
        <ArrowLeft size={14} weight="duotone" />
        <span>Back</span>
      </button>

      {#if target?.kind === 'page' || target?.kind === 'shared'}
        <input
          class="title-input"
          placeholder="Untitled"
          bind:value={editorTitle}
          on:input={handleTitleInput}
          on:blur={handleBlur}
          on:mousedown={guardPointer}
          on:touchstart={guardPointer}
          on:click={guardPointer}
        />
      {:else}
        <span class="title-static">{editorTitle}</span>
      {/if}

      {#if isSaving}
        <span class="save-status">Saving…</span>
      {:else if isDirty}
        <span class="save-status dirty">●</span>
      {/if}

      {#if target?.kind === 'verse'}
        <button class="icon-btn" title="Go to this verse" on:click={jumpToVerse}>↗</button>
      {/if}

      <!-- A page of your own can be sent to a notebook you share with other
           people. A copy: this one stays here, and stays yours. -->
      {#if target?.kind === 'page'}
        <button
          class="icon-btn"
          title="Send a copy to a shared notebook"
          aria-label="Send a copy to a shared notebook"
          on:click={sendPageToShared}
        >
          <UsersThree size={16} weight="duotone" />
        </button>
      {/if}

      <!-- A shared page you may write in but not remove — somebody else's page,
           left open to the notebook — gets no ⋯ at all, rather than one that
           offers nothing. -->
      {#if target?.kind !== 'shared' || canRemoveOpenPage}
        <button
          class="icon-btn"
          title={target?.kind === 'shared' ? 'Remove from the notebook' : 'Delete'}
          on:click={() => (confirmDeleteOpen = !confirmDeleteOpen)}>⋯</button
        >
      {/if}
    </div>

    {#if target?.kind === 'shared'}
      <!-- Writing, the same strip is a warning: somebody else is in this page
           too, and whichever of you saves second will be asked to keep theirs
           beside the other. No Take over here — you already have it open. -->
      <SharedLiveBar
        people={liveOthers}
        members={readerRoster}
        pageId={openSharedPageId}
        writer={liveWriter}
        writerIdle={liveWriterIdle}
      />
    {/if}

    {#if readerWaiting}
      <!-- Not a warning and not an error — nothing has gone wrong and nothing
           needs doing. It is here so that writing on a train is never mistaken
           for writing everyone can already see. -->
      <div class="waiting-bar">
        <CloudArrowUp size={13} weight="fill" />
        <span>Saved here. It goes to the notebook when you are back online.</span>
        <button class="waiting-send" on:click={sendPending}>Try now</button>
      </div>
    {/if}

    {#if confirmDeleteOpen}
      <div class="confirm-bar">
        {#if target?.kind === 'shared'}
          <span>Take this page out of the notebook?</span>
          <button class="confirm-yes" on:click={deleteCurrent}>Remove</button>
        {:else}
          <span>Delete this {target?.kind === 'verse' ? 'note' : 'page'}?</span>
          <button class="confirm-yes" on:click={deleteCurrent}>Delete</button>
        {/if}
        <button class="confirm-no" on:click={() => (confirmDeleteOpen = false)}>Cancel</button>
      </div>
    {/if}

    {#if sharedBlocked}
      <!-- The one thing this must never do is quietly choose between the two
           versions. It says what happened, leaves the writing on screen, and
           offers to keep it beside the other rather than instead of it. -->
      <div class="blocked-bar">
        <span>{sharedBlocked}</span>
        {#if canKeepAsCopy}
          <button class="blocked-keep" on:click={keepAsNewPage}>Keep mine as a new page</button>
        {/if}
        <button class="blocked-back" on:click={() => backToBrowse()}>Leave it</button>
      </div>
    {/if}

    <div class="editor-body">
      <RefAwareEditor
        bind:isDirty
        surface="notes"
        surfaceLabel="Notes"
        value={editorText}
        placeholder="Start writing…"
        on:change={handleTextChange}
        on:blur={handleBlur}
      />
    </div>
  {:else if view === 'reader'}
    <!-- ── Reading a shared page ───────────────────────────────────────────── -->
    <div class="editor-header shared">
      <button class="back-btn" on:click={backToBrowse}>
        <ArrowLeft size={14} weight="duotone" />
        <span>Back</span>
      </button>
      <span class="title-static">{readerPage ? sharedPageLabel(readerPage) : ''}</span>

      <!-- No pencil while somebody else is in the page. The strip below says
           who, and offers to take it from them once they have gone quiet. -->
      {#if canEditOpenPage && !lockedByOther}
        <button class="icon-btn" title="Edit this page" on:click={editSharedPage}>✎</button>
      {/if}
      {#if hasSharedMenu}
        <button
          class="icon-btn"
          title="Page options"
          on:click={() => (sharedMenuOpen = !sharedMenuOpen)}>⋯</button
        >
      {/if}
    </div>

    {#if readerPage}
      <div class="reader-byline">
        {#if readerAuthor}
          <AuthorPill
            variant="round"
            size={18}
            color={readerAuthor.color}
            initials={readerAuthor.initials || '··'}
            title={authorName(readerPage.notebookId, readerPage.authorId)}
          />
        {/if}
        <span class="byline-who">{authorName(readerPage.notebookId, readerPage.authorId)}</span>
        <span class="byline-sep">·</span>
        <span>{formatDate(readerPage.updatedAt)}</span>
        {#if readerNotebook}
          <span class="byline-sep">·</span>
          <span>{readerNotebook.name || 'Untitled notebook'}</span>
        {/if}
        <span class="byline-sep">·</span>
        <!-- Said plainly rather than left to the padlock on the list row: this
             is where somebody finds out why there is no pencil. Being out of
             the notebook altogether comes first, because it is the answer that
             overrides the page's own. -->
        <span class:byline-removed={readerRemoved}>
          {#if readerRemoved}
            You are no longer in this notebook
          {:else if readerPage.editMode === 'anyone'}
            Anyone here can edit
          {:else if readerPage.authorId === myUserId}
            Only you can edit
          {:else}
            Only its author can edit
          {/if}
        </span>
      </div>
    {/if}

    <SharedLiveBar
      people={liveOthers}
      members={readerRoster}
      pageId={openSharedPageId}
      writer={liveWriter}
      writerIdle={liveWriterIdle}
      canTakeOver={canEditOpenPage}
      on:takeover={editSharedPage}
    />

    {#if readerWaiting}
      <div class="waiting-bar">
        <CloudArrowUp size={13} weight="fill" />
        <span>This is your copy. It goes to the notebook when you are back online.</span>
        <button class="waiting-send" on:click={sendPending}>Try now</button>
      </div>
    {/if}

    {#if sharedMenuOpen}
      <div class="shared-menu">
        {#if canCopyOpenPage}
          <button on:click={keepSharedPageLocally}>Keep a copy in my notebooks</button>
        {/if}
        {#if canCloseOpenPage}
          <button on:click={toggleSharedEditMode}>
            {readerPage?.editMode === 'anyone' ? 'Close to others' : 'Let others edit'}
          </button>
        {/if}
        {#if canPinOpenPage}
          <button on:click={toggleSharedPinned}>
            {readerPage?.pinned ? 'Unpin' : 'Pin to top'}
          </button>
        {/if}
        {#if canRemoveOpenPage}
          <button
            class="danger"
            on:click={() => {
              sharedMenuOpen = false;
              confirmDeleteOpen = true;
            }}>Remove page</button
          >
        {/if}
      </div>
    {/if}

    {#if confirmDeleteOpen}
      <div class="confirm-bar">
        <span>Take this page out of the notebook?</span>
        <button class="confirm-yes" on:click={deleteCurrent}>Remove</button>
        <button class="confirm-no" on:click={() => (confirmDeleteOpen = false)}>Cancel</button>
      </div>
    {/if}

    <div class="editor-body">
      <!-- The roster goes in so each paragraph's gutter can name the people
           stamped on it. Without it the pills have nobody to be. -->
      <SharedPageView html={readerPage?.text ?? ''} members={readerRoster} />
    </div>
  {:else}
    <!-- ── Browse ──────────────────────────────────────────────────────────── -->
    <div class="browse-header">
      <div class="mode-toggle" role="tablist" aria-label="Which notebooks">
        <button
          role="tab"
          aria-selected={mode === 'local'}
          class="mode-btn"
          class:active={mode === 'local'}
          on:click={() => setMode('local')}>Local</button
        >
        <button
          role="tab"
          aria-selected={mode === 'shared'}
          class="mode-btn shared"
          class:active={mode === 'shared'}
          on:click={() => setMode('shared')}>Shared</button
        >
      </div>
      {#if mode === 'local'}
        <button class="primary-btn" on:click={newQuickNote}>+ New note</button>
      {:else}
        <button class="primary-btn shared" on:click={() => (creatingSharedFor = { kind: 'plain' })}>
          + New
        </button>
      {/if}
    </div>

    <div class="browse-body">
      {#if mode === 'local'}
        {#if loading}
          <p class="muted">Loading…</p>
        {:else}
          <!-- Verse notes: the same book dropdown the search results use -->
          <section class="section">
            {#if verseNotes.length === 0}
              <div class="section-head">
                <span class="section-label">Verse Notes</span>
                <span class="section-count">(0)</span>
              </div>
              <p class="muted small">
                Select a verse while reading and choose Notes — anything you write there shows up here.
              </p>
            {:else}
              <SearchResultsTree
                nodes={verseTree}
                {expanded}
                onToggle={toggleNode}
                onSelect={openVerseNote}
              />
            {/if}
          </section>

          <!-- Notebooks -->
          <section class="section">
            <div class="section-head">
              <span class="section-label">Notebooks</span>
              <span class="section-count">({notebooks.length})</span>
            </div>

            {#if notebooks.length === 0 && !creatingNotebook}
              <p class="muted small">Create a notebook and start taking notes.</p>
            {/if}

            <NotebookList
              notebooks={localList}
              {expanded}
              keyPrefix="nb"
              accent={LOCAL_ACCENT}
              pageAccent={LOCAL_PAGE_ACCENT}
              canAddPage
              canRenameNotebook
              canDeleteNotebook
              canDeletePage
              canCopyNotebookToShared={isSignedIn}
              on:toggle={(e) => toggleNode(e.detail)}
              on:copyToShared={(e) => copyNotebookToShared(e.detail)}
              on:openPage={(e) => openLocalPageById(e.detail.pageId)}
              on:newPage={(e) => newPage(e.detail)}
              on:rename={(e) => renameNotebook(e.detail.id, e.detail.name)}
              on:deleteNotebook={(e) => deleteNotebook(e.detail)}
              on:deletePage={(e) => deletePageById(e.detail.notebookId, e.detail.pageId)}
            />

            {#if creatingNotebook}
              <input
                class="new-nb-input"
                placeholder="Notebook name…"
                bind:value={newNotebookName}
                use:focusOnMount
                on:mousedown={guardPointer}
                on:touchstart={guardPointer}
                on:click={guardPointer}
                on:blur={commitNewNotebook}
                on:keydown={(e) => {
                  if (e.key === 'Enter') commitNewNotebook();
                  if (e.key === 'Escape') {
                    creatingNotebook = false;
                    newNotebookName = '';
                  }
                }}
              />
            {:else}
              <button class="ghost-btn" on:click={() => (creatingNotebook = true)}>+ New notebook</button>
            {/if}
          </section>
        {/if}
      {:else}
        <!-- ── Shared ────────────────────────────────────────────────────── -->
        <section class="section">
          <div class="section-head">
            <span class="section-label shared">Shared Notebooks</span>
            <span class="section-count">({sharedNotebooks.length})</span>
          </div>

          {#if sharedLoading}
            <p class="muted small">Looking…</p>
          {:else if sharedNotebooks.length === 0}
            <p class="muted small">
              Notebooks you keep with other people live here. Make one and hand out its code, or
              join one you have been given the code for.
            </p>
          {:else}
            <NotebookList
              notebooks={sharedList}
              {expanded}
              keyPrefix={SHARED_KEY_PREFIX}
              accent={SHARED_ACCENT}
              pageAccent={SHARED_PAGE_ACCENT}
              emptyPagesText="Nothing written here yet."
              canInvite
              canEditBadge
              pageDeleteWord="Remove"
              on:toggle={(e) => toggleNode(e.detail)}
              on:openPage={(e) => openShared(e.detail.notebookId, e.detail.pageId)}
              on:newPage={(e) => newSharedPage(e.detail)}
              on:deletePage={(e) => removeSharedPageById(e.detail.pageId)}
              on:invite={(e) => openInvite(e.detail)}
              on:editBadge={(e) => openBadgePicker(e.detail)}
              on:manage={(e) => openManage(e.detail)}
            />
          {/if}

          <button class="ghost-btn shared" on:click={() => (joiningShared = true)}>
            + Join with a code
          </button>

          <button class="ghost-btn shared" on:click={() => loadShared({ force: true })}>
            ↻ Check for changes
          </button>
        </section>
      {/if}
    </div>
  {/if}
</div>

{#if creatingSharedFor}
  <!-- One sheet for all three: the two awkward-to-change choices have to be
       made whatever the notebook is being made for, so only the words change. -->
  <SharedNotebookCreate
    heading={creatingSharedFor.kind === 'plain' ? 'New shared notebook' : 'Copy to a shared notebook'}
    confirmLabel={creatingSharedFor.kind === 'plain' ? 'Create' : 'Copy'}
    busyLabel={creatingSharedFor.kind === 'plain' ? 'Creating…' : 'Copying…'}
    initialName={creatingSharedFor.kind === 'notebook' ? creatingSharedFor.notebook.name : ''}
    note={creatingSharedFor.kind === 'notebook'
      ? 'A copy. Your own notebook stays exactly where it is, and later changes on either side stay where they are made.'
      : creatingSharedFor.kind === 'page'
        ? 'A copy of this page goes into the notebook once it is made.'
        : ''}
    on:created={(e) => sharedCreated(e.detail)}
    on:close={() => (creatingSharedFor = null)}
  />
{/if}

{#if joiningShared}
  <SharedNotebookJoin
    mode="join"
    on:joined={(e) => sharedJoined(e.detail)}
    on:close={() => (joiningShared = false)}
  />
{/if}

{#if inviteNotebook}
  <SharedNotebookJoin
    mode="invite"
    notebook={inviteNotebook}
    on:close={() => (inviteNotebook = null)}
  />
{/if}

<!-- Out of the way, not closed, while the create sheet is up: the page it is
     holding is what that notebook is being made for. -->
{#if copying && !creatingSharedFor}
  <CopyPageSheet
    mode={copying.mode}
    title={copying.title}
    label={copying.label}
    text={copying.text}
    destinations={copyDestinations}
    on:copied={(e) => pageCopied(e.detail.name)}
    on:createNew={() => (creatingSharedFor = { kind: 'page' })}
    on:close={() => (copying = null)}
  />
{/if}

{#if managingNotebook}
  <SharedNotebookAdmin
    notebook={managingNotebook}
    members={sharedMembersByNotebook.get(managingNotebook.id) ?? []}
    pages={sharedPagesByNotebook.get(managingNotebook.id) ?? []}
    userId={myUserId}
    on:changed={manageChanged}
    on:gone={(e) => manageGone(e.detail)}
    on:close={() => (managingNotebook = null)}
  />
{/if}

{#if badgeNotebook && myUserId}
  {@const roster = sharedMembersByNotebook.get(badgeNotebook.id) ?? []}
  {@const mine = roster.find((m) => m.userId === myUserId)}
  {#if mine}
    <MemberPillPicker
      notebook={badgeNotebook}
      member={mine}
      others={roster}
      on:saved={badgeSaved}
      on:close={() => (badgeNotebook = null)}
    />
  {/if}
{/if}

<style>
  .notes-pane {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    overflow: hidden;
    background: #1a1a1a;
    color: #e0e0e0;
  }

  /* ── Signed out ─────────────────────────────────────────── */
  .auth-wall {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    padding: 32px 24px;
    text-align: center;
  }

  .auth-wall-icon {
    font-size: 44px;
  }

  .auth-wall-text {
    color: #aaa;
    font-size: 0.9rem;
    line-height: 1.5;
    max-width: 320px;
  }

  .auth-wall-btn {
    padding: 10px 20px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border: none;
    border-radius: 6px;
    color: #fff;
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
  }

  /* ── Headers ────────────────────────────────────────────── */
  /* The --gut-* values keep content clear of the window's resize strip, which
     overlaps 24px of the panel along whichever edge it is docked against. */
  .browse-header,
  .editor-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px calc(10px + var(--gut-r)) 8px calc(10px + var(--gut-l));
    border-bottom: 1px solid #333;
    flex-shrink: 0;
    min-height: 44px;
  }

  .editor-body {
    padding-left: var(--gut-l);
    padding-right: var(--gut-r);
  }


  .primary-btn {
    padding: 5px 12px;
    background: #667eea;
    border: none;
    border-radius: 5px;
    color: #fff;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }

  /* Same button, the Shared side's accent — so which half of the pane you are
     on is legible from the one control on it. */
  .primary-btn.shared {
    background: #0d9488;
  }

  .primary-btn:hover {
    background: #7c8ef0;
  }

  .icon-btn {
    background: transparent;
    border: none;
    color: #bbb;
    font-size: 1.1rem;
    line-height: 1;
    padding: 8px 10px;
    border-radius: 4px;
    cursor: pointer;
    flex-shrink: 0;
    /* Some of these are a glyph and one is an icon — centre both the same way
       rather than letting the icon sit on the text baseline. */
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .icon-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
  }

  /* Matches the app's other back affordances — icon plus the word, Milonga
     inherited from the global font. */
  .back-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    flex-shrink: 0;
    background: transparent;
    border: none;
    color: #aaa;
    font-size: 0.85rem;
    padding: 8px 8px 8px 4px;
    border-radius: 4px;
    cursor: pointer;
  }

  .back-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
  }

  .title-input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    color: #e0e0e0;
    /* 16px keeps iOS from zooming the whole panel when the field takes focus. */
    font-size: 16px;
    font-weight: 600;
    min-height: 44px;
    padding: 4px 2px;
  }

  .title-input:focus {
    outline: none;
    border-bottom: 1px solid #667eea;
  }

  .title-static {
    flex: 1;
    min-width: 0;
    font-size: 0.9rem;
    font-weight: 600;
    color: #60a5fa;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .save-status {
    font-size: 0.75rem;
    color: #888;
    flex-shrink: 0;
  }

  .save-status.dirty {
    font-size: 1rem;
    color: #667eea;
  }

  /* ── Editor ─────────────────────────────────────────────── */
  .editor-body {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  /* ── Browse ─────────────────────────────────────────────── */
  .browse-body {
    flex: 1;
    overflow-y: auto;
    padding: 8px calc(6px + var(--gut-r)) calc(24px + var(--gut-b)) calc(6px + var(--gut-l));
  }

  .section + .section {
    margin-top: 18px;
    padding-top: 14px;
    border-top: 1px solid #2c2c2c;
  }

  .section-head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 7px 10px;
    font-size: 0.9rem;
    font-weight: 600;
  }

  .section-label {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .section-count {
    flex-shrink: 0;
    margin-right: auto;
    color: #888;
    font-size: 0.8em;
    font-variant-numeric: tabular-nums;
  }

  .muted {
    color: #888;
    padding: 6px 10px;
  }

  .muted.small {
    font-size: 0.8rem;
    line-height: 1.5;
  }


  /* The new-notebook field. Its sibling rename field moved to NotebookList. */
  .new-nb-input {
    width: calc(100% - 20px);
    margin: 4px 10px;
    background: #262626;
    border: 1px solid #667eea;
    border-radius: 4px;
    color: #e0e0e0;
    /* 16px / 44px: iOS zooms below the first and mis-taps below the second. */
    font-size: 16px;
    min-height: 44px;
    padding: 5px 8px;
  }

  .new-nb-input:focus {
    outline: none;
  }

  .ghost-btn {
    display: block;
    width: calc(100% - 20px);
    margin: 6px 10px 0;
    padding: 7px 10px;
    background: transparent;
    border: 1px dashed #444;
    border-radius: 5px;
    color: #999;
    font-size: 0.8rem;
    cursor: pointer;
    text-align: left;
  }

  .ghost-btn:hover {
    border-color: #667eea;
    color: #ccc;
  }

  .ghost-btn.shared:hover {
    border-color: #2dd4bf;
  }

  /* ── Local / Shared toggle ──────────────────────────────── */
  .mode-toggle {
    display: flex;
    gap: 2px;
    padding: 2px;
    background: #222;
    border: 1px solid #333;
    border-radius: 6px;
  }

  .mode-btn {
    background: transparent;
    border: none;
    border-radius: 4px;
    color: #999;
    cursor: pointer;
    font-size: 0.78rem;
    font-weight: 600;
    padding: 5px 12px;
    min-height: 30px;
  }

  .mode-btn:hover {
    color: #ddd;
  }

  /* The accent is the whole point of the pair: which half you are in should be
     readable at a glance, not worked out from which word is brighter. */
  .mode-btn.active {
    background: rgba(102, 126, 234, 0.18);
    color: #a5b4fc;
    box-shadow: inset 0 0 0 1px rgba(102, 126, 234, 0.45);
  }

  .mode-btn.shared.active {
    background: rgba(45, 212, 191, 0.16);
    color: #5eead4;
    box-shadow: inset 0 0 0 1px rgba(45, 212, 191, 0.45);
  }

  .section-label.shared {
    color: #5eead4;
  }

  .editor-header.shared {
    border-bottom-color: rgba(45, 212, 191, 0.35);
  }

  /* ── Shared page byline ─────────────────────────────────── */
  .reader-byline {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 5px;
    padding: 6px 12px;
    border-bottom: 1px solid #2a2a2a;
    color: #888;
    font-size: 0.74rem;
  }

  .byline-who {
    color: #5eead4;
    font-weight: 600;
  }

  .byline-sep {
    color: #555;
  }

  /* ── The open page's own menu ───────────────────────────── */
  /* Same row of small buttons NotebookList uses, so the two menus in the pane
     read as one thing rather than two. */
  .shared-menu {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 6px 12px;
    border-bottom: 1px solid #2a2a2a;
  }

  .shared-menu button {
    background: #262626;
    border: 1px solid #3a3a3a;
    border-radius: 4px;
    color: #ccc;
    font-size: 0.75rem;
    padding: 5px 10px;
    cursor: pointer;
  }

  .shared-menu button:hover {
    background: #333;
  }

  .shared-menu button.danger {
    color: #f08a7a;
    border-color: #5a3230;
  }

  /* ── A save that was refused ────────────────────────────── */
  /* Amber rather than red: nothing has gone wrong and nothing is lost — there
     are simply two versions and a choice to make between keeping both and
     walking away from one. */
  .blocked-bar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    margin: 6px 10px;
    padding: 8px 10px;
    background: rgba(217, 160, 60, 0.12);
    border: 1px solid #6a5325;
    border-radius: 5px;
    color: #e8d3a8;
    font-size: 0.78rem;
    line-height: 1.45;
  }

  .blocked-bar span {
    flex: 1;
    min-width: 140px;
  }

  .blocked-keep,
  .blocked-back {
    border: none;
    border-radius: 4px;
    font-size: 0.75rem;
    padding: 5px 10px;
    cursor: pointer;
    flex-shrink: 0;
  }

  .blocked-keep {
    background: #2dd4bf;
    color: #0b3b36;
    font-weight: 600;
  }

  .blocked-back {
    background: #333;
    color: #ccc;
  }

  /* ── Waiting to go up ───────────────────────────────────────
     Quieter than the blocked bar on purpose: that one is a decision waiting to
     be made, this one is a fact about where the words are. */
  .waiting-bar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    margin: 4px 10px;
    padding: 6px 10px;
    background: rgba(224, 176, 96, 0.08);
    border: 1px solid #4a3c22;
    border-radius: 5px;
    color: #cbb489;
    font-size: 0.74rem;
    line-height: 1.4;
  }

  .waiting-bar span {
    flex: 1;
    min-width: 140px;
  }

  .waiting-send {
    flex-shrink: 0;
    border: 1px solid #5a4a2a;
    border-radius: 4px;
    background: transparent;
    color: #e0b060;
    font-size: 0.72rem;
    padding: 4px 9px;
    cursor: pointer;
  }

  /* ── Confirm bar ────────────────────────────────────────── */
  .confirm-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin: 2px 10px 6px;
    padding: 7px 10px;
    background: rgba(192, 57, 43, 0.12);
    border: 1px solid #5a3230;
    border-radius: 5px;
    font-size: 0.78rem;
    color: #e8b4ac;
  }

  .confirm-bar span {
    flex: 1;
    min-width: 120px;
  }

  .confirm-yes,
  .confirm-no {
    border: none;
    border-radius: 4px;
    font-size: 0.75rem;
    padding: 4px 10px;
    cursor: pointer;
  }

  .confirm-yes {
    background: #c0392b;
    color: #fff;
  }

  .confirm-no {
    background: #333;
    color: #ccc;
  }

  @media (max-width: 480px) {
    .browse-header,
    .editor-header {
      padding: 6px 8px;
    }

    .section-head {
      font-size: 0.8rem;
    }
  }
</style>
