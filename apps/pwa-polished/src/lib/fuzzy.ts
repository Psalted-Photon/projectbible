/**
 * Close spellings, shared by Voice Control (a misheard name or book) and the
 * search bar (a mistyped one). Nothing here touches the page, so both workers
 * can use it.
 */

/** How many letters must change, go in or come out to turn a into b. */
export function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * editDistance for typing: two neighboring letters swapped ("recieve",
 * "jhon") count as one slip, the way they were made, not as two changes.
 */
export function typoDistance(a: string, b: string): number {
  let before = Array.from({ length: b.length + 1 }, () => 0);
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], before[j - 2] + 1);
    }
    before = prev;
    prev = cur;
  }
  return prev[b.length];
}

/** How a name sounds, roughly: "mephibosheth" and "mefa boshes" both come out "mfps(t)". */
export function soundKey(s: string): string {
  const k = s.replace(/[^a-z]/g, '')
    .replace(/ph/g, 'f').replace(/sh/g, 's').replace(/th/g, 't').replace(/ch/g, 'k').replace(/gh/g, 'g')
    .replace(/c(?=[eiy])/g, 's').replace(/[cq]/g, 'k').replace(/x/g, 'ks')
    .replace(/d/g, 't').replace(/g/g, 'k').replace(/b/g, 'p').replace(/v/g, 'f').replace(/z/g, 's');
  if (!k) return '';
  return (k[0] + k.slice(1).replace(/[aeiouhwy]/g, '')).replace(/(.)\1+/g, '$1');
}
