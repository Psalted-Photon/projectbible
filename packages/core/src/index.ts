export * from './interfaces.js';
export { Reader } from './reader.js';
export * from './reading-plan.js';
export * from './BibleMetadata.js';
export {
  DayStatus,
  ReadingPlanDay as EngineReadingPlanDay,
  ReadingPlan as EngineReadingPlan,
  ChapterAction,
  ChapterProgress,
  ReadingProgressEntry,
  VerseCountResult,
  CatchUpSuggestion,
  computeDayStatus,
  getDaysAheadBehind,
  calculateStreak,
  suggestCatchUp,
  calculateVerseCounts,
  mergeProgress,
} from './ReadingPlanEngine.js';
export * from './search/searchConfig.js';
export * from './search/englishLexicalService.js';
export * from './search/englishLexicalPackLoader.js';
export * from './services/PackLoader.js';

import { Reader, getReaderStyles } from './reader.js';

export function renderApp(root: HTMLElement): void {
  // Inject reader styles
  const styleId = 'reader-styles';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = getReaderStyles();
    document.head.appendChild(style);
  }

  // Initialize reader
  const reader = new Reader(root);
  reader.render();
}
