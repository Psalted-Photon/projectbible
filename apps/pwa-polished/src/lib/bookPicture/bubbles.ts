/**
 * Book Bubbles (book-picture-lab.html, "All books"): the 66 books as circles
 * packed together, each sized by how much text it has, and each book split
 * into its chapters as smaller circles packed inside it.
 *
 * Sizes go by area, so a circle's radius is the square root of its length:
 * a book twice as long covers twice the space. Circles are packed in reading
 * order with the front-chain method (Wang et al. 2006; the same method
 * d3-hierarchy's packSiblings uses): the first circle sits in the middle and
 * each next one is set against the outside of the pile, as near the middle
 * as it fits. So Genesis is in the middle and Revelation near the edge, and
 * inside a book, chapter 1 is in the middle.
 *
 * Verses inside a chapter circle go from the middle out in reading order, on
 * a sunflower spiral, so every verse gets an even share of the circle.
 */

export interface Circle {
  x: number;
  y: number;
  r: number;
}

interface ChainNode {
  c: Circle;
  next: ChainNode;
  prev: ChainNode;
}

/** Set `c` against both `a` and `b`, on the left of a → b. */
function placeAgainst(b: Circle, a: Circle, c: Circle): void {
  const dx = b.x - a.x, dy = b.y - a.y;
  const d2 = dx * dx + dy * dy;
  if (!d2) {
    c.x = a.x + c.r;
    c.y = a.y;
    return;
  }
  const a2 = (a.r + c.r) ** 2, b2 = (b.r + c.r) ** 2;
  if (a2 > b2) {
    const x = (d2 + b2 - a2) / (2 * d2);
    const y = Math.sqrt(Math.max(0, b2 / d2 - x * x));
    c.x = b.x - x * dx - y * dy;
    c.y = b.y - x * dy + y * dx;
  } else {
    const x = (d2 + a2 - b2) / (2 * d2);
    const y = Math.sqrt(Math.max(0, a2 / d2 - x * x));
    c.x = a.x + x * dx - y * dy;
    c.y = a.y + x * dy + y * dx;
  }
}

function overlaps(a: Circle, b: Circle): boolean {
  const dr = a.r + b.r - 1e-6;
  const dx = b.x - a.x, dy = b.y - a.y;
  return dr > 0 && dr * dr > dx * dx + dy * dy;
}

/** How far from the middle the gap between a chain node and the next one is. */
function gapScore(n: ChainNode): number {
  const a = n.c, b = n.next.c;
  const ab = a.r + b.r;
  const x = (a.x * b.r + b.x * a.r) / ab;
  const y = (a.y * b.r + b.y * a.r) / ab;
  return x * x + y * y;
}

/**
 * Pack the circles (radii set, positions written) in the order given, around
 * the origin. Nothing overlaps; each circle touches at least one other.
 */
export function packCircles(circles: Circle[]): void {
  const n = circles.length;
  if (!n) return;
  const first = circles[0];
  first.x = 0;
  first.y = 0;
  if (n === 1) return;
  const second = circles[1];
  first.x = -second.r;
  second.x = first.r;
  second.y = 0;
  if (n === 2) return;
  placeAgainst(second, first, circles[2]);

  const node = (c: Circle): ChainNode => {
    const nd = { c } as ChainNode;
    nd.next = nd.prev = nd;
    return nd;
  };
  let a = node(first), b = node(second);
  const c3 = node(circles[2]);
  a.next = c3.prev = b;
  b.next = a.prev = c3;
  c3.next = b.prev = a;

  outer: for (let i = 3; i < n; i++) {
    const c = node(circles[i]);
    placeAgainst(a.c, b.c, c.c);
    // Look both ways along the chain for the nearest circle it overlaps.
    let j = b.next, k = a.prev;
    let sj = b.c.r, sk = a.c.r;
    do {
      if (sj <= sk) {
        if (overlaps(j.c, c.c)) {
          b = j;
          a.next = b;
          b.prev = a;
          i--;
          continue outer;
        }
        sj += j.c.r;
        j = j.next;
      } else {
        if (overlaps(k.c, c.c)) {
          a = k;
          a.next = b;
          b.prev = a;
          i--;
          continue outer;
        }
        sk += k.c.r;
        k = k.prev;
      }
    } while (j !== k.next);
    // It fits: put it on the chain between a and b.
    c.prev = a;
    c.next = b;
    a.next = b.prev = b = c;
    // The next circle goes in the chain gap nearest the middle (one lap round).
    let best = gapScore(a);
    for (let m = c.next; m !== c; m = m.next) {
      const s = gapScore(m);
      if (s < best) {
        a = m;
        best = s;
      }
    }
    b = a.next;
  }
}

/**
 * A circle around all of them, close to the smallest one: start at the middle
 * of their box and keep stepping toward whichever edge is farthest away.
 */
export function enclose(circles: Circle[]): Circle {
  if (!circles.length) return { x: 0, y: 0, r: 0 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of circles) {
    x0 = Math.min(x0, c.x - c.r);
    y0 = Math.min(y0, c.y - c.r);
    x1 = Math.max(x1, c.x + c.r);
    y1 = Math.max(y1, c.y + c.r);
  }
  let x = (x0 + x1) / 2, y = (y0 + y1) / 2;
  const farthest = () => {
    let best = circles[0], bd = -1;
    for (const c of circles) {
      const d = Math.hypot(c.x - x, c.y - y) + c.r;
      if (d > bd) {
        bd = d;
        best = c;
      }
    }
    return { c: best, d: bd };
  };
  for (let i = 1; i <= 300; i++) {
    const { c, d } = farthest();
    const cd = Math.hypot(c.x - x, c.y - y);
    if (cd < 1e-9) break;
    // Point on that circle's far edge, then a shrinking step toward it.
    const px = x + ((c.x - x) / cd) * d, py = y + ((c.y - y) / cd) * d;
    x += (px - x) / (i + 1);
    y += (py - y) / (i + 1);
  }
  return { x, y, r: farthest().d };
}

/** Move and scale packed circles so their enclosing circle becomes `into`. */
export function fitInto(circles: Circle[], into: Circle): void {
  const e = enclose(circles);
  const s = e.r > 0 ? into.r / e.r : 1;
  for (const c of circles) {
    c.x = into.x + (c.x - e.x) * s;
    c.y = into.y + (c.y - e.y) * s;
    c.r *= s;
  }
}

export interface ChapterBubble extends Circle {
  chapter: number;
  /** Number of verses in the chapter. */
  verses: number;
  words: number;
}

export interface BookBubble extends Circle {
  book: string;
  words: number;
  chapters: ChapterBubble[];
}

export interface BubbleInput {
  book: string;
  words: number;
  chapters: Array<{ chapter: number; words: number; verses: number }>;
}

export interface BubbleMap {
  /** Square world, `size` wide, with every book inside. */
  size: number;
  books: BookBubble[];
  /** The smallest chapter circle's radius, for how far in a zoom needs to go. */
  minChapterR: number;
  /** The smallest share a verse gets in any chapter (verseShare), for the same. */
  minVerseShare: number;
}

/**
 * Where the Bubbles change as you zoom, in CSS px on screen. One place for
 * the lab and the app, so both feel the same.
 */
export const BUBBLE_ZOOM = {
  /** A book splits into its chapters while its circle's radius grows across this range. */
  chaptersFrom: 140,
  chaptersTo: 260,
  /** A chapter's verses show as dots once each verse's share (verseShare) is this wide... */
  verseDots: 8,
  /** ...and as their numbers from this wide. */
  verseNumbers: 18,
  /** The furthest zoom makes the smallest chapter's circle this big. */
  maxChapterR: 220,
  /** Biggest a verse number is drawn. */
  verseNumberMax: 17,
};

/**
 * How far out and in the map may zoom, from the scale that fits it on screen:
 * out to half that, in until every chapter shows its verse numbers with room
 * to spare.
 */
export function bubbleZoomLimits(map: BubbleMap, fitK: number): [number, number] {
  const kIn = Math.max(
    fitK * 8,
    BUBBLE_ZOOM.maxChapterR / map.minChapterR,
    (BUBBLE_ZOOM.verseNumbers * 1.5) / map.minVerseShare,
  );
  return [fitK * 0.5, kIn];
}

/** How far a book has split into its chapters at zoom `k` (0 to 1). */
export function chapterMix(b: BookBubble, k: number): number {
  if (!b.chapters.length) return 0;
  const t = Math.min(1, Math.max(0, (b.r * k - BUBBLE_ZOOM.chaptersFrom) / (BUBBLE_ZOOM.chaptersTo - BUBBLE_ZOOM.chaptersFrom)));
  return t * t * (3 - 2 * t);
}

/** Chapter circles take up this much of their book's radius. */
const CHAPTER_FILL = 0.94;

/**
 * The whole map: books packed in the order given, the pile scaled into a
 * square `size` wide, then each book's chapters packed inside it.
 */
export function layoutBubbles(input: BubbleInput[], size = 1000): BubbleMap {
  const books: BookBubble[] = input.map((b) => ({
    book: b.book,
    words: b.words,
    x: 0,
    y: 0,
    r: Math.sqrt(Math.max(1, b.words)),
    chapters: [],
  }));
  packCircles(books);
  fitInto(books, { x: size / 2, y: size / 2, r: size / 2 });
  let minChapterR = Infinity;
  let minVerseShare = Infinity;
  input.forEach((b, i) => {
    const book = books[i];
    const chapters: ChapterBubble[] = b.chapters.map((c) => ({
      chapter: c.chapter,
      verses: c.verses,
      words: c.words,
      x: 0,
      y: 0,
      r: Math.sqrt(Math.max(1, c.words)),
    }));
    packCircles(chapters);
    fitInto(chapters, { x: book.x, y: book.y, r: book.r * CHAPTER_FILL });
    for (const c of chapters) {
      minChapterR = Math.min(minChapterR, c.r);
      minVerseShare = Math.min(minVerseShare, verseShare(c, c.verses));
    }
    book.chapters = chapters;
  });
  return {
    size,
    books,
    minChapterR: Number.isFinite(minChapterR) ? minChapterR : 1,
    minVerseShare: Number.isFinite(minVerseShare) ? minVerseShare : 1,
  };
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * Where verse `index` (0-based) of `count` sits in a circle: verse 1 in the
 * middle and the rest spiraling out, each with an even share of the area.
 */
export function verseSpot(circle: Circle, index: number, count: number): { x: number; y: number } {
  if (count <= 1) return { x: circle.x, y: circle.y };
  const rr = circle.r * 0.92 * Math.sqrt((index + 0.5) / count);
  const a = index * GOLDEN_ANGLE - Math.PI / 2;
  return { x: circle.x + rr * Math.cos(a), y: circle.y + rr * Math.sin(a) };
}

/** Radius of the even share each verse gets, for sizing a dot. */
export function verseShare(circle: Circle, count: number): number {
  return (circle.r * 0.92) / Math.sqrt(Math.max(1, count));
}
