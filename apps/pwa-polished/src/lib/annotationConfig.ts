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
  'Thomas Aquinas':        { color: '#B45309', initials: 'Aq', fullName: 'Thomas Aquinas (Catena Aurea)' },
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
