/**
 * Past and other verb forms the ending rules can't make, by base form.
 *
 * Shared by Word Links' gloss matching (base → forms, to find "brought" in a
 * verse that means "bring") and the dictionary (form → base, so "brought"
 * shows bring's definitions). Kept here, with no imports, because the gloss
 * matcher already imports the dictionary lookup and can't be imported back.
 */
export const IRREGULAR: Record<string, string[]> = {
  arise: ['arose', 'arisen'],
  beget: ['begat', 'begot', 'begotten'],
  begin: ['began', 'begun'],
  bear: ['bare', 'bore', 'born', 'borne'],
  bring: ['brought'],
  build: ['built'],
  buy: ['bought'],
  catch: ['caught'],
  choose: ['chose', 'chosen'],
  come: ['came'],
  die: ['died', 'dying'],
  drink: ['drank', 'drunk'],
  eat: ['ate', 'eaten'],
  fall: ['fell', 'fallen'],
  find: ['found'],
  flee: ['fled'],
  forgive: ['forgave', 'forgiven'],
  forsake: ['forsook', 'forsaken'],
  give: ['gave', 'given'],
  go: ['went', 'gone', 'goeth'],
  have: ['had', 'hath', 'hast'],
  hear: ['heard'],
  hold: ['held'],
  keep: ['kept'],
  know: ['knew', 'known'],
  lay: ['laid'],
  lead: ['led'],
  leave: ['left'],
  lie: ['lay', 'lain', 'lying'],
  lose: ['lost'],
  make: ['made'],
  rise: ['rose', 'risen'],
  run: ['ran'],
  say: ['said', 'saith', 'saidst'],
  see: ['saw', 'seen'],
  seek: ['sought'],
  sell: ['sold'],
  send: ['sent'],
  sit: ['sat'],
  slay: ['slew', 'slain'],
  speak: ['spake', 'spoke', 'spoken'],
  stand: ['stood'],
  take: ['took', 'taken'],
  teach: ['taught'],
  tell: ['told'],
  think: ['thought'],
  understand: ['understood'],
  write: ['wrote', 'written'],
};

const BASES = new Map<string, string[]>();
for (const [base, forms] of Object.entries(IRREGULAR)) {
  for (const form of forms) BASES.set(form, [...(BASES.get(form) ?? []), base]);
}

/** The base forms an irregular form comes from ("brought" → bring), or none. */
export function irregularBases(form: string): string[] {
  return BASES.get(form) ?? [];
}
