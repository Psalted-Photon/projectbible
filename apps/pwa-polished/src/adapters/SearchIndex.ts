import type { SearchIndex, SearchResult } from '@projectbible/core';
import { BIBLE_BOOKS } from '../lib/bibleData.js';
import type { DBVerse } from './db.js';
import { cleanVersePreviewText } from '../lib/verseRendering';
import { wordMatcher, type TextMatcher } from '../lib/searchWords';

export class IndexedDBSearchIndex implements SearchIndex {
  /**
   * Search for verses holding each word of the query, in its own forms
   * (lib/searchWords).
   * @param query Search term(s)
   * @param translations Optional list of translation IDs to search within
   */
  async search(query: string, translations?: string[]): Promise<SearchResult[]> {
    if (!query.trim()) {
      return [];
    }
    return this.scan(wordMatcher(query, 'all'), translations);
  }

  /**
   * Every verse the matcher accepts, in canonical order. The matcher decides
   * what counts — the bar's word forms or Advanced Search's pattern.
   */
  async scan(match: TextMatcher, translations?: string[]): Promise<SearchResult[]> {
    try {
      const db = await import('./db.js').then(m => m.openDB());
      
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('verses', 'readonly');
        const store = transaction.objectStore('verses');
        
        const results: SearchResult[] = [];
        const request = store.openCursor();
        
        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest).result as IDBCursorWithValue | null;
          
          if (cursor) {
            const verse = cursor.value as DBVerse;
            
            // Filter by translation if specified
            if (translations && !translations.includes(verse.translationId)) {
              cursor.continue();
              return;
            }
            
            // Match against the text as it reads, not as it is stored. Stored
            // text carries poetry and paragraph sentinels and inline footnote
            // runs, so a phrase crossing a poetic line break never matched and
            // a snippet could be cut through a control character.
            const searchable = cleanVersePreviewText(verse.text);

            if (match.test(searchable)) {
              const snippet = this.createSnippet(searchable, match.indexIn(searchable));

              results.push({
                translation: verse.translationId,
                book: verse.book,
                chapter: verse.chapter,
                verse: verse.verse,
                text: verse.text,
                snippet
              });
            }
            
            cursor.continue();
          } else {
            // Sort results by canonical book order, then chapter/verse
            const bookOrderMap = new Map(BIBLE_BOOKS.map((b, i) => [b.name, i]));
            results.sort((a, b) => {
              const orderA = bookOrderMap.get(a.book) ?? 999;
              const orderB = bookOrderMap.get(b.book) ?? 999;
              if (orderA !== orderB) return orderA - orderB;
              if (a.chapter !== b.chapter) return a.chapter - b.chapter;
              return a.verse - b.verse;
            });
            
            resolve(results);
          }
        };
        
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Error searching:', error);
      return [];
    }
  }

  /**
   * Search for verses containing a Strong's number
   * Note: This requires morphology data which may not be in all packs
   */
  async searchStrong(_strongId: string): Promise<SearchResult[]> {
    // TODO: Implement when morphology packs are available
    // For now, return empty array
    console.warn('Strong\'s search not yet implemented - requires morphology data');
    return [];
  }

  /**
   * Create a snippet of the verse with context around the first match
   * @param text The full verse text
   * @param firstMatch Where the first match starts, or -1
   */
  private createSnippet(text: string, firstMatch: number): string {
    const maxLength = 150;
    
    // If text is short enough, return it all
    if (text.length <= maxLength) {
      return text;
    }
    
    if (firstMatch === -1) {
      // No match found (shouldn't happen), return start of text
      return text.substring(0, maxLength) + '...';
    }
    
    // Calculate snippet bounds
    const halfLength = Math.floor(maxLength / 2);
    let start = Math.max(0, firstMatch - halfLength);
    let end = Math.min(text.length, start + maxLength);
    
    // Adjust start if we're at the end
    if (end === text.length && text.length > maxLength) {
      start = text.length - maxLength;
    }
    
    // Try to break at word boundaries
    if (start > 0) {
      const spaceAfter = text.indexOf(' ', start);
      if (spaceAfter !== -1 && spaceAfter < start + 20) {
        start = spaceAfter + 1;
      }
    }
    
    if (end < text.length) {
      const spaceBefore = text.lastIndexOf(' ', end);
      if (spaceBefore !== -1 && spaceBefore > end - 20) {
        end = spaceBefore;
      }
    }
    
    let snippet = text.substring(start, end);
    
    if (start > 0) snippet = '...' + snippet;
    if (end < text.length) snippet = snippet + '...';
    
    return snippet;
  }
}
