/**
 * Annotation display configuration
 * Colors and 2-letter initials for all commentary authors + TSK references
 */

export interface AuthorConfig {
  color: string;
  initials: string;
  fullName: string;
}

export const COMMENTARY_AUTHORS: Record<string, AuthorConfig> = {
  'NET Bible Translators': { color: '#3B82F6', initials: 'NT', fullName: 'NET Bible Notes' },
  'Adam Clarke':           { color: '#16A34A', initials: 'Cl', fullName: 'Adam Clarke' },
  'John Wesley':           { color: '#9333EA', initials: 'We', fullName: 'John Wesley' },
  'John Calvin':           { color: '#DC2626', initials: 'Ca', fullName: 'John Calvin' },
  'KingComments':          { color: '#0891B2', initials: 'KC', fullName: 'KingComments' },
  'A.T. Robertson':        { color: '#EA580C', initials: 'Ro', fullName: 'A.T. Robertson' },
  'Albert Barnes':         { color: '#DB2777', initials: 'Ba', fullName: 'Albert Barnes' },
  'E.W. Bullinger':        { color: '#4F46E5', initials: 'Bu', fullName: 'E.W. Bullinger' },
  'Family Bible Notes':    { color: '#65A30D', initials: 'Fb', fullName: 'Family Bible Notes' },
  'Abbott':                { color: '#475569', initials: 'Ab', fullName: 'Abbott' },
  // Keyed on the author string the pack actually stores. It reads "Thomas
  // Aquinas (Catena Aurea)", so the shorter key never matched and Aquinas fell
  // through to the grey fallback.
  'Thomas Aquinas (Catena Aurea)': { color: '#B45309', initials: 'Aq', fullName: 'Thomas Aquinas (Catena Aurea)' },
  'John Lightfoot':        { color: '#0369A1', initials: 'Li', fullName: 'John Lightfoot' },
  'Martin Luther':         { color: '#A21CAF', initials: 'Lu', fullName: 'Martin Luther' },
  // Where a verse quotes, or is quoted by, another. Its own colour so the badge
  // reads as "there is a quotation here" rather than as one more commentator.
  'Quoting Passages':      { color: '#14B8A6', initials: 'Qp', fullName: 'Quotations & Allusions' },
  // Matches TSK_COLOR below — same body of cross-references, same cue.
  'Treasury of Scripture Knowledge': { color: '#D97706', initials: 'Ts', fullName: 'Treasury of Scripture Knowledge' },
  'Matthew Henry':         { color: '#7C3AED', initials: 'Mh', fullName: 'Matthew Henry' },
  'Jamieson-Fausset-Brown':{ color: '#0F766E', initials: 'Jf', fullName: 'Jamieson-Fausset-Brown' },
  'Charles Spurgeon':      { color: '#92400E', initials: 'Sp', fullName: 'Charles Spurgeon' },
};

/** Gold color used for all TSK cross-reference diamonds */
export const TSK_COLOR = '#D97706';

export function getAuthorConfig(author: string): AuthorConfig | null {
  return COMMENTARY_AUTHORS[author] ?? null;
}

export function getAuthorColor(author: string): string {
  return COMMENTARY_AUTHORS[author]?.color ?? '#888888';
}

export function getAuthorInitials(author: string): string {
  return COMMENTARY_AUTHORS[author]?.initials ?? author.slice(0, 2).toUpperCase();
}
