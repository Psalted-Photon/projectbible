/**
 * Who may do what in a shared notebook.
 *
 * Every rule here mirrors one in migration 012 — the policies on
 * shared_notebook_pages, the shared_page_guard trigger, and the two functions
 * that write. The server is the authority and always refuses on its own; these
 * exist so the app never offers a button the database is going to turn down,
 * which is a far worse way to find out you are a reader than simply not being
 * shown a pencil.
 *
 * Each takes what it needs and nothing more, so they can be asked about a
 * notebook that isn't open and a page that isn't loaded. A missing membership
 * is a "no" rather than a crash: not being in a notebook is the ordinary
 * answer for most notebooks most of the time.
 */

import type {
  SharedNotebook,
  SharedNotebookMember,
  SharedNotebookPage,
} from '../../adapters/SharedNotebookStore';

/**
 * Is this a notebook this account has been put out of?
 *
 * The pull keeps such a notebook rather than deleting it, so its pages are
 * still there to read — and its member rows are still there too, this
 * account's own among them. That stale row would answer "writer" to every
 * question below, which is why this is asked first in all of them: what the
 * server would now refuse, the app must not offer.
 */
export function isReadOnlyCopy(notebook: SharedNotebook | null): boolean {
  return !!notebook?.removedAt;
}

/**
 * May this account run the notebook — the roster, the code, what kind of
 * notebook it is?
 *
 * The owner, and nobody else. Migration 012 draws the same line: the UPDATE
 * policy on shared_notebooks is `owner_id = auth.uid()`, the members table
 * lets the owner write anybody's row, and `reset_shared_notebook_code()`
 * refuses everyone else outright. An admin may write in the notebook; running
 * it is a different thing.
 */
export function canManageNotebook(
  notebook: SharedNotebook | null,
  userId: string | null,
): boolean {
  if (!notebook || !userId || isReadOnlyCopy(notebook)) return false;
  return notebook.ownerId === userId;
}

/**
 * May this account walk out of the notebook?
 *
 * Anybody but its owner. Every rule that runs a notebook is written as "the
 * owner", so an owner who walked out would leave a notebook whose roster,
 * code and settings nobody at all could change — and the policies in 012
 * would go on refusing everyone for as long as it existed.
 */
export function canLeaveNotebook(
  notebook: SharedNotebook | null,
  me: SharedNotebookMember | null,
  userId: string | null,
): boolean {
  if (!notebook || !me || !userId || isReadOnlyCopy(notebook)) return false;
  return notebook.ownerId !== userId;
}

/**
 * May this account add a page here, or edit an open one?
 *
 * The same answer `can_write_shared_notebook()` gives: an admin always may, a
 * writer may in a Group notebook, and nobody else ever does. A writer in a
 * Broadcast notebook is deliberately shut out — switching a notebook to
 * Broadcast is how an owner quietens it without removing anybody.
 */
export function canWriteInNotebook(
  notebook: SharedNotebook | null,
  me: SharedNotebookMember | null,
): boolean {
  if (!notebook || !me || isReadOnlyCopy(notebook)) return false;
  if (me.role === 'admin') return true;
  return me.role === 'writer' && notebook.kind === 'group';
}

/**
 * May this account rewrite this particular page?
 *
 * The page's author always may, whatever else is true — it is their page, and
 * an owner who switched the notebook to Broadcast still cannot stop them
 * tidying their own work. Anyone else needs two things at once: the author
 * left the page open, and the notebook lets them write at all.
 */
export function canEditPage(
  page: SharedNotebookPage | null,
  notebook: SharedNotebook | null,
  me: SharedNotebookMember | null,
  userId: string | null,
): boolean {
  if (!page || !userId || isReadOnlyCopy(notebook)) return false;
  if (page.authorId === userId) return true;
  return page.editMode === 'anyone' && canWriteInNotebook(notebook, me);
}

/**
 * May this account take the page out of the notebook?
 *
 * Removing is moderation, so the notebook's owner may do it to anybody's page.
 * Rewriting is not, which is why `canEditPage` above is narrower and why the
 * two are separate questions rather than one "may I manage this".
 */
export function canRemovePage(
  page: SharedNotebookPage | null,
  notebook: SharedNotebook | null,
  userId: string | null,
): boolean {
  if (!page || !userId || isReadOnlyCopy(notebook)) return false;
  return page.authorId === userId || notebook?.ownerId === userId;
}

/**
 * May this account open or close the page to other people?
 *
 * The author, and only the author. Closed means closed, so the switch that
 * closes it cannot belong to anyone who could then be talked into opening it.
 */
export function canSetEditMode(
  page: SharedNotebookPage | null,
  notebook: SharedNotebook | null,
  userId: string | null,
): boolean {
  if (isReadOnlyCopy(notebook)) return false;
  return !!page && !!userId && page.authorId === userId;
}

/**
 * May this account pin the page to the top?
 *
 * Both at once: you own the notebook, and you wrote the page. Owning it is
 * what makes the top of the list yours to arrange; writing it is what stops
 * that from being a way to move somebody else's work about. The guard trigger
 * refuses the other combinations, so this is the app agreeing with it rather
 * than deciding anything.
 */
export function canPinPage(
  page: SharedNotebookPage | null,
  notebook: SharedNotebook | null,
  userId: string | null,
): boolean {
  if (!page || !notebook || !userId || isReadOnlyCopy(notebook)) return false;
  return notebook.ownerId === userId && page.authorId === userId;
}
