import type { SearchIndex, SearchResult } from '@projectbible/core';
import type { DBVerse } from './db.js';

export class IndexedDBSearchIndex implements SearchIndex {
  /**
   * Search for verses containing the query string
   * @param query Search term(s)
   * @param translations Optional list of translation IDs to search within
   */
  async search(query: string, translations?: string[]): Promise<SearchResult[]> {
    if (!query.trim()) {
      return [];
    }

    const searchTerms = query.toLowerCase().trim().split(/\s+/);
    
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
            
            // Check if all search terms are in the verse text
            const lowerText = verse.text.toLowerCase();
            const matches = searchTerms.every(term => lowerText.includes(term));
            
            if (matches) {
              // Create snippet with highlighted terms
              const snippet = this.createSnippet(verse.text, searchTerms);
              
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
            // Sort results by book/chapter/verse
            results.sort((a, b) => {
              if (a.book !== b.book) return a.book.localeCompare(b.book);
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
  async searchStrong(strongId: string): Promise<SearchResult[]> {
    // TODO: Implement when morphology packs are available
    // For now, return empty array
    console.warn('Strong\'s search not yet implemented - requires morphology data');
    return [];
  }

  /**
   * Create a snippet of the verse with context around matching terms
   * @param text The full verse text
   * @param searchTerms The search terms to highlight
   */
  private createSnippet(text: string, searchTerms: string[]): string {
    const maxLength = 150;
    
    // If text is short enough, return it all
    if (text.length <= maxLength) {
      return text;
    }
    
    // Find the first occurrence of any search term
    const lowerText = text.toLowerCase();
    let firstMatch = -1;
    
    for (const term of searchTerms) {
      const pos = lowerText.indexOf(term);
      if (pos !== -1 && (firstMatch === -1 || pos < firstMatch)) {
        firstMatch = pos;
      }
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
