// Where each tribe's card finds its reading: a few paragraphs of the ISBE
// (1915, public domain) and the verses Nave's gathers under the tribe.
//
// Hand-kept because neither work files the tribes the same way twice. ISBE
// sometimes has a "2. The Tribe" section (Judah, Dan, Gad…), sometimes only
// the patriarch (Levi, whose tribe is left to PRIESTS AND LEVITES, a debate
// about sources rather than a history). Nave's usually has a "2. Tribe of"
// heading inside the son's topic, but Reuben's and Levi's are separate topics
// of their own. Ids match the encyclotopical pack's entries and topics.
//
// Joseph's tribe is two, Ephraim and Manasseh, so it carries a part for each.

export interface TribePart {
  /** Shown above the part when a tribe has more than one. */
  label?: string;
  isbe: {
    entryId: number;
    name: string;
    /** Which of the article's paragraphs (its <p> elements, from 0) to show. */
    paras: number[];
  };
  naves: {
    topicId: number;
    /** True: only the topic's "Tribe of" section. False: the whole topic. */
    section: boolean;
  };
}

export const TRIBE_READING: Record<string, TribePart[]> = {
  Reuben: [{ isbe: { entryId: 7338, name: 'Reuben', paras: [5] }, naves: { topicId: 4142, section: false } }],
  Simeon: [{ isbe: { entryId: 8106, name: 'Simeon', paras: [16] }, naves: { topicId: 4581, section: true } }],
  Levi: [{ isbe: { entryId: 5456, name: 'Levi', paras: [1] }, naves: { topicId: 3047, section: false } }],
  Judah: [{ isbe: { entryId: 5149, name: 'Judah', paras: [4] }, naves: { topicId: 2871, section: true } }],
  Dan: [{ isbe: { entryId: 2509, name: 'Dan', paras: [4] }, naves: { topicId: 1326, section: true } }],
  Naphtali: [{ isbe: { entryId: 6227, name: 'Naphtali', paras: [22] }, naves: { topicId: 3509, section: true } }],
  Gad: [{ isbe: { entryId: 3605, name: 'Gad', paras: [4] }, naves: { topicId: 1919, section: true } }],
  Asher: [{ isbe: { entryId: 821, name: 'Asher', paras: [2] }, naves: { topicId: 437, section: true } }],
  Issachar: [{ isbe: { entryId: 4685, name: 'Issachar', paras: [5] }, naves: { topicId: 2584, section: true } }],
  Zebulun: [{ isbe: { entryId: 9268, name: 'Zebulun', paras: [2] }, naves: { topicId: 5232, section: true } }],
  Joseph: [
    { label: 'Ephraim', isbe: { entryId: 3136, name: 'Ephraim', paras: [4] }, naves: { topicId: 1676, section: true } },
    { label: 'Manasseh', isbe: { entryId: 5720, name: 'Manasseh', paras: [3] }, naves: { topicId: 3190, section: true } },
  ],
  Benjamin: [{ isbe: { entryId: 1338, name: 'Benjamin', paras: [4] }, naves: { topicId: 694, section: true } }],
};

/** Nave's numbers a topic's senses "1. Son of Jacob", "2. Tribe of"… */
const NUMBERED = /^\d+\.\s/;
const TRIBE_HEAD = /^\d+\.\s*(a |the )?tribe/i;

/**
 * The run of points under a topic's "Tribe of" heading, heading included,
 * up to the next numbered sense. Points inside the run can sit at depth 0
 * ("Census of" under Dan), so the end is found by the numbering, not depth.
 */
export function tribeSection<T extends { depth: number; text: string }>(points: T[]): T[] {
  const start = points.findIndex((p) => p.depth === 0 && TRIBE_HEAD.test(p.text));
  if (start < 0) return [];
  let end = start + 1;
  while (end < points.length && !(points[end].depth === 0 && NUMBERED.test(points[end].text))) end++;
  return points.slice(start, end);
}
