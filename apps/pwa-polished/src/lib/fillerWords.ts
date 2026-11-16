/**
 * Words that carry no study value however often they appear: the Repeats
 * "Show verses" list refuses them (repeatVerses.ts), and the book word clouds
 * leave them out (bookPicture/cloud.ts). Lower case, as normalizeRepeatWord
 * gives them.
 */
export const FILLER_WORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'the', 'and', 'or', 'nor', 'but', 'yet', 'so', 'if', 'as', 'than',
  'of', 'to', 'in', 'on', 'at', 'by', 'for', 'from', 'with', 'into', 'unto',
  'upon', 'out', 'up', 'off', 'over', 'about',
  'it', 'its', 'i', 'me', 'my', 'mine', 'we', 'us', 'our', 'you', 'your', 'ye',
  'thee', 'thou', 'thy', 'thine', 'he', 'him', 'his', 'she', 'her', 'hers',
  'they', 'them', 'their', 'this', 'that', 'these', 'those', 'which', 'who',
  'whom', 'what', 'there', 'then',
  'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
  'hath', 'do', 'did', 'does', 'shall', 'will', 'not', 'no',
]);
