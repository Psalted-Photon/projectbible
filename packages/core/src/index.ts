export * from './interfaces.js';
export { Reader } from './reader.js';
export * from './reading-plan.js';
export * from './search/searchConfig.js';
export * from './search/englishLexicalService.js';
export * from './search/englishLexicalPackLoader.js';

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
