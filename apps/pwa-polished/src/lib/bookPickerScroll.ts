/**
 * Scrolling a book row to the top of the reference picker.
 *
 * The picker's scroll container has sticky chrome pinned along its top edge —
 * the OT/NT column title, and in the Bible picker a category header stuck just
 * below it. Parking a book row at y=0 of the scrollport therefore buries the
 * book name underneath that chrome, and the chapter grid below it becomes the
 * first thing you see. Both heights are measured rather than hardcoded: the
 * category header's own `top` offset already assumes the title's height, so a
 * constant here would have to be kept in step with the CSS by hand.
 */

/** A little air so the book name doesn't sit flush against the header above it. */
const BREATHING_ROOM = 4;

function stickyHeaderHeight(bookItem: HTMLElement): number {
  const column = bookItem.closest('.book-column');
  const title = column?.querySelector('.book-column-title') as HTMLElement | null;

  // The category header that will be the one pinned once this book reaches the
  // top is the nearest one above it — its own group's.
  let sibling = bookItem.previousElementSibling;
  while (sibling && !sibling.classList.contains('category-header')) {
    sibling = sibling.previousElementSibling;
  }

  return (title?.offsetHeight ?? 0) + ((sibling as HTMLElement | null)?.offsetHeight ?? 0);
}

export function scrollBookItemToTop(dropdown: HTMLElement, bookItem: HTMLElement): void {
  const dropdownRect = dropdown.getBoundingClientRect();
  const bookRect = bookItem.getBoundingClientRect();
  const offset = bookRect.top - dropdownRect.top + dropdown.scrollTop;
  dropdown.scrollTop = Math.max(0, offset - stickyHeaderHeight(bookItem) - BREATHING_ROOM);
}
