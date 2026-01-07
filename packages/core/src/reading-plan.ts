/**
 * Reading Plan Generator
 * 
 * Creates personalized Bible reading plans with:
 * - Date ranges and excluded weekdays
 * - Book/chapter multipliers (read Psalms x3, etc.)
 * - Even distribution (difference <= 1 chapter per day)
 * - Multiple ordering modes (canonical, shuffled, chronological)
 */

// Bible book metadata
export interface BookInfo {
  name: string;
  testament: 'OT' | 'NT';
  chapters: number;
  chronologicalOrder?: number; // For chronological reading plans
}

// Reading plan configuration
export interface ReadingPlanConfig {
  /** Start date for the reading plan */
  startDate: Date;
  
  /** End date for the reading plan */
  endDate: Date;
  
  /** Days of week to exclude (0 = Sunday, 6 = Saturday) */
  excludedWeekdays?: number[];
  
  /** Books to include in the plan */
  books: BookSelection[];
  
  /** How to order the readings */
  ordering: 'canonical' | 'shuffled' | 'chronological';
}

export interface BookSelection {
  /** Book name */
  book: string;
  
  /** How many times to read this book (default: 1) */
  multiplier?: number;
  
  /** Specific chapters to include (if omitted, includes all) */
  chapters?: number[];
}

// Generated reading plan
export interface ReadingPlan {
  /** Configuration used to generate this plan */
  config: ReadingPlanConfig;
  
  /** Total number of reading days */
  totalDays: number;
  
  /** Total number of chapters to read */
  totalChapters: number;
  
  /** Average chapters per day */
  avgChaptersPerDay: number;
  
  /** Daily readings */
  days: DayReading[];
}

export interface DayReading {
  /** Date for this reading */
  date: Date;
  
  /** Day number in the plan (1-indexed) */
  dayNumber: number;
  
  /** Chapters to read on this day */
  chapters: ChapterRef[];
}

export interface ChapterRef {
  book: string;
  chapter: number;
}

// Complete Bible book list with chapter counts
export const BIBLE_BOOKS: BookInfo[] = [
  // Old Testament
  { name: 'Genesis', testament: 'OT', chapters: 50, chronologicalOrder: 1 },
  { name: 'Exodus', testament: 'OT', chapters: 40, chronologicalOrder: 2 },
  { name: 'Leviticus', testament: 'OT', chapters: 27, chronologicalOrder: 3 },
  { name: 'Numbers', testament: 'OT', chapters: 36, chronologicalOrder: 4 },
  { name: 'Deuteronomy', testament: 'OT', chapters: 34, chronologicalOrder: 5 },
  { name: 'Joshua', testament: 'OT', chapters: 24, chronologicalOrder: 6 },
  { name: 'Judges', testament: 'OT', chapters: 21, chronologicalOrder: 7 },
  { name: 'Ruth', testament: 'OT', chapters: 4, chronologicalOrder: 8 },
  { name: '1 Samuel', testament: 'OT', chapters: 31, chronologicalOrder: 9 },
  { name: '2 Samuel', testament: 'OT', chapters: 24, chronologicalOrder: 10 },
  { name: '1 Kings', testament: 'OT', chapters: 22, chronologicalOrder: 11 },
  { name: '2 Kings', testament: 'OT', chapters: 25, chronologicalOrder: 12 },
  { name: '1 Chronicles', testament: 'OT', chapters: 29, chronologicalOrder: 13 },
  { name: '2 Chronicles', testament: 'OT', chapters: 36, chronologicalOrder: 14 },
  { name: 'Ezra', testament: 'OT', chapters: 10, chronologicalOrder: 15 },
  { name: 'Nehemiah', testament: 'OT', chapters: 13, chronologicalOrder: 16 },
  { name: 'Esther', testament: 'OT', chapters: 10, chronologicalOrder: 17 },
  { name: 'Job', testament: 'OT', chapters: 42, chronologicalOrder: 18 },
  { name: 'Psalms', testament: 'OT', chapters: 150, chronologicalOrder: 19 },
  { name: 'Proverbs', testament: 'OT', chapters: 31, chronologicalOrder: 20 },
  { name: 'Ecclesiastes', testament: 'OT', chapters: 12, chronologicalOrder: 21 },
  { name: 'Song of Solomon', testament: 'OT', chapters: 8, chronologicalOrder: 22 },
  { name: 'Isaiah', testament: 'OT', chapters: 66, chronologicalOrder: 23 },
  { name: 'Jeremiah', testament: 'OT', chapters: 52, chronologicalOrder: 24 },
  { name: 'Lamentations', testament: 'OT', chapters: 5, chronologicalOrder: 25 },
  { name: 'Ezekiel', testament: 'OT', chapters: 48, chronologicalOrder: 26 },
  { name: 'Daniel', testament: 'OT', chapters: 12, chronologicalOrder: 27 },
  { name: 'Hosea', testament: 'OT', chapters: 14, chronologicalOrder: 28 },
  { name: 'Joel', testament: 'OT', chapters: 3, chronologicalOrder: 29 },
  { name: 'Amos', testament: 'OT', chapters: 9, chronologicalOrder: 30 },
  { name: 'Obadiah', testament: 'OT', chapters: 1, chronologicalOrder: 31 },
  { name: 'Jonah', testament: 'OT', chapters: 4, chronologicalOrder: 32 },
  { name: 'Micah', testament: 'OT', chapters: 7, chronologicalOrder: 33 },
  { name: 'Nahum', testament: 'OT', chapters: 3, chronologicalOrder: 34 },
  { name: 'Habakkuk', testament: 'OT', chapters: 3, chronologicalOrder: 35 },
  { name: 'Zephaniah', testament: 'OT', chapters: 3, chronologicalOrder: 36 },
  { name: 'Haggai', testament: 'OT', chapters: 2, chronologicalOrder: 37 },
  { name: 'Zechariah', testament: 'OT', chapters: 14, chronologicalOrder: 38 },
  { name: 'Malachi', testament: 'OT', chapters: 4, chronologicalOrder: 39 },
  
  // New Testament
  { name: 'Matthew', testament: 'NT', chapters: 28, chronologicalOrder: 40 },
  { name: 'Mark', testament: 'NT', chapters: 16, chronologicalOrder: 41 },
  { name: 'Luke', testament: 'NT', chapters: 24, chronologicalOrder: 42 },
  { name: 'John', testament: 'NT', chapters: 21, chronologicalOrder: 43 },
  { name: 'Acts', testament: 'NT', chapters: 28, chronologicalOrder: 44 },
  { name: 'Romans', testament: 'NT', chapters: 16, chronologicalOrder: 45 },
  { name: '1 Corinthians', testament: 'NT', chapters: 16, chronologicalOrder: 46 },
  { name: '2 Corinthians', testament: 'NT', chapters: 13, chronologicalOrder: 47 },
  { name: 'Galatians', testament: 'NT', chapters: 6, chronologicalOrder: 48 },
  { name: 'Ephesians', testament: 'NT', chapters: 6, chronologicalOrder: 49 },
  { name: 'Philippians', testament: 'NT', chapters: 4, chronologicalOrder: 50 },
  { name: 'Colossians', testament: 'NT', chapters: 4, chronologicalOrder: 51 },
  { name: '1 Thessalonians', testament: 'NT', chapters: 5, chronologicalOrder: 52 },
  { name: '2 Thessalonians', testament: 'NT', chapters: 3, chronologicalOrder: 53 },
  { name: '1 Timothy', testament: 'NT', chapters: 6, chronologicalOrder: 54 },
  { name: '2 Timothy', testament: 'NT', chapters: 4, chronologicalOrder: 55 },
  { name: 'Titus', testament: 'NT', chapters: 3, chronologicalOrder: 56 },
  { name: 'Philemon', testament: 'NT', chapters: 1, chronologicalOrder: 57 },
  { name: 'Hebrews', testament: 'NT', chapters: 13, chronologicalOrder: 58 },
  { name: 'James', testament: 'NT', chapters: 5, chronologicalOrder: 59 },
  { name: '1 Peter', testament: 'NT', chapters: 5, chronologicalOrder: 60 },
  { name: '2 Peter', testament: 'NT', chapters: 3, chronologicalOrder: 61 },
  { name: '1 John', testament: 'NT', chapters: 5, chronologicalOrder: 62 },
  { name: '2 John', testament: 'NT', chapters: 1, chronologicalOrder: 63 },
  { name: '3 John', testament: 'NT', chapters: 1, chronologicalOrder: 64 },
  { name: 'Jude', testament: 'NT', chapters: 1, chronologicalOrder: 65 },
  { name: 'Revelation', testament: 'NT', chapters: 22, chronologicalOrder: 66 }
];

/**
 * Generate a reading plan based on the configuration
 */
export function generateReadingPlan(config: ReadingPlanConfig): ReadingPlan {
  // Step 1: Build the complete list of chapters to read
  const chapters = buildChapterList(config);
  
  // Step 2: Get all available reading days
  const readingDays = getReadingDays(config.startDate, config.endDate, config.excludedWeekdays);
  
  if (readingDays.length === 0) {
    throw new Error('No reading days available in the specified date range');
  }
  
  if (chapters.length === 0) {
    throw new Error('No chapters selected to read');
  }
  
  // Step 3: Distribute chapters evenly across days
  const days = distributeChapters(chapters, readingDays);
  
  return {
    config,
    totalDays: days.length,
    totalChapters: chapters.length,
    avgChaptersPerDay: chapters.length / days.length,
    days
  };
}

/**
 * Build the complete list of chapters based on selections and multipliers
 */
function buildChapterList(config: ReadingPlanConfig): ChapterRef[] {
  const chapters: ChapterRef[] = [];
  
  for (const selection of config.books) {
    const bookInfo = BIBLE_BOOKS.find(b => b.name === selection.book);
    if (!bookInfo) {
      console.warn(`Book not found: ${selection.book}`);
      continue;
    }
    
    // Determine which chapters to include
    const chapterNumbers = selection.chapters || 
      Array.from({ length: bookInfo.chapters }, (_, i) => i + 1);
    
    // Apply multiplier
    const multiplier = selection.multiplier || 1;
    
    for (let i = 0; i < multiplier; i++) {
      for (const chapter of chapterNumbers) {
        chapters.push({ book: selection.book, chapter });
      }
    }
  }
  
  // Apply ordering
  return orderChapters(chapters, config.ordering);
}

/**
 * Order chapters based on the specified ordering mode
 */
function orderChapters(chapters: ChapterRef[], ordering: ReadingPlanConfig['ordering']): ChapterRef[] {
  const result = [...chapters];
  
  switch (ordering) {
    case 'canonical':
      // Already in canonical order from buildChapterList
      return result;
      
    case 'shuffled':
      // Fisher-Yates shuffle
      for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
      }
      return result;
      
    case 'chronological':
      // Sort by chronological order
      return result.sort((a, b) => {
        const bookA = BIBLE_BOOKS.find(book => book.name === a.book);
        const bookB = BIBLE_BOOKS.find(book => book.name === b.book);
        
        if (!bookA || !bookB) return 0;
        
        const orderA = bookA.chronologicalOrder || 0;
        const orderB = bookB.chronologicalOrder || 0;
        
        if (orderA !== orderB) return orderA - orderB;
        return a.chapter - b.chapter;
      });
      
    default:
      return result;
  }
}

/**
 * Get all valid reading days between start and end dates, excluding specified weekdays
 */
function getReadingDays(startDate: Date, endDate: Date, excludedWeekdays?: number[]): Date[] {
  const days: Date[] = [];
  const current = new Date(startDate);
  current.setHours(0, 0, 0, 0);
  
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);
  
  while (current <= end) {
    const dayOfWeek = current.getDay();
    
    if (!excludedWeekdays || !excludedWeekdays.includes(dayOfWeek)) {
      days.push(new Date(current));
    }
    
    current.setDate(current.getDate() + 1);
  }
  
  return days;
}

/**
 * Distribute chapters evenly across reading days
 * Goal: difference between lightest and heaviest day should be <= 1 chapter
 */
function distributeChapters(chapters: ChapterRef[], days: Date[]): DayReading[] {
  const totalChapters = chapters.length;
  const totalDays = days.length;
  
  // Calculate base chapters per day and how many days need an extra chapter
  const baseChaptersPerDay = Math.floor(totalChapters / totalDays);
  const daysWithExtra = totalChapters % totalDays;
  
  const result: DayReading[] = [];
  let chapterIndex = 0;
  
  for (let i = 0; i < totalDays; i++) {
    // First 'daysWithExtra' days get an extra chapter
    const chaptersForThisDay = baseChaptersPerDay + (i < daysWithExtra ? 1 : 0);
    
    const dayChapters = chapters.slice(chapterIndex, chapterIndex + chaptersForThisDay);
    
    result.push({
      date: days[i],
      dayNumber: i + 1,
      chapters: dayChapters
    });
    
    chapterIndex += chaptersForThisDay;
  }
  
  return result;
}

/**
 * Helper: Get book info by name
 */
export function getBookInfo(bookName: string): BookInfo | undefined {
  return BIBLE_BOOKS.find(b => b.name === bookName);
}

/**
 * Helper: Create a simple "read the whole Bible" plan
 */
export function createWholeBiblePlan(startDate: Date, endDate: Date, excludedWeekdays?: number[]): ReadingPlan {
  return generateReadingPlan({
    startDate,
    endDate,
    excludedWeekdays,
    books: BIBLE_BOOKS.map(book => ({ book: book.name })),
    ordering: 'canonical'
  });
}

/**
 * Helper: Create a "New Testament only" plan
 */
export function createNTPlan(startDate: Date, endDate: Date, excludedWeekdays?: number[]): ReadingPlan {
  return generateReadingPlan({
    startDate,
    endDate,
    excludedWeekdays,
    books: BIBLE_BOOKS
      .filter(book => book.testament === 'NT')
      .map(book => ({ book: book.name })),
    ordering: 'canonical'
  });
}

/**
 * Helper: Create a "Psalms and Proverbs" plan
 */
export function createPsalmsProverbsPlan(
  startDate: Date, 
  endDate: Date, 
  psalmsMultiplier: number = 1,
  excludedWeekdays?: number[]
): ReadingPlan {
  return generateReadingPlan({
    startDate,
    endDate,
    excludedWeekdays,
    books: [
      { book: 'Psalms', multiplier: psalmsMultiplier },
      { book: 'Proverbs' }
    ],
    ordering: 'canonical'
  });
}
