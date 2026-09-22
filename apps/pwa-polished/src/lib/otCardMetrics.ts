/**
 * The one measurement OtQuoteCard and BibleReader both have to agree on.
 *
 * The card caps itself at this height. The reader needs the same number before
 * the card exists, because it nudges the page down far enough for a whole card
 * to fit under the tapped verse at the moment the card opens — and at that
 * moment there is nothing to measure. Written in one place so the two cannot
 * drift apart, which would show up as a card landing clipped.
 */
export const OT_CARD_MAX_HEIGHT = 200;

/** The breathing room between the verse's last line and the top of the card. */
export const OT_CARD_GAP = 10;
