/**
 * The verse a new account is welcomed with. One fixed verse, not a rotation,
 * and written out here rather than looked up: a brand-new user has downloaded
 * no packs, and may be offline, so anything that reads from IndexedDB would
 * show them an empty card on the one occasion it matters.
 *
 * Text taken verbatim from the NET in the app's own starter.sqlite.
 *
 * NET permits free quotation in a non-commercial app provided the quotation is
 * followed by "(NET)", and where there is internet access those letters must
 * link to netbible.org. That link is a deliberate exception to the house rule
 * that media opens in-app — it is a licence condition, not navigation.
 */
export const WELCOME_VERSE = {
  reference: 'Hebrews 4:12',
  book: 'Hebrews',
  chapter: 4,
  verse: 12,
  text:
    'For the word of God is living and active and sharper than any double-edged sword, ' +
    'piercing even to the point of dividing soul from spirit, and joints from marrow; ' +
    'it is able to judge the desires and thoughts of the heart.',
} as const;

/** The full acknowledgment, as the licence words it. Used in the email footer. */
export const NET_ATTRIBUTION =
  'Scripture quoted by permission. Quotations designated (NET) are from the NET Bible® ' +
  'copyright ©1996, 2019 by Biblical Studies Press, L.L.C. All rights reserved.';
