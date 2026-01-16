import { IndexedDBSearchIndex } from '../../adapters/SearchIndex';

export interface SearchResult {
  type: 'verse' | 'place' | 'strongs' | 'morphology' | 'cross-reference';
  title: string;
  subtitle?: string;
  reference?: string;
  data: any;
  score: number; // relevance score
}

export interface SearchCategory {
  name: string;
  count: number;
  results: SearchResult[];
}

export class UnifiedSearchService {
  private static instance: UnifiedSearchService;
  private searchIndex: IndexedDBSearchIndex;

  private constructor() {
    this.searchIndex = new IndexedDBSearchIndex();
  }

  static getInstance(): UnifiedSearchService {
    if (!UnifiedSearchService.instance) {
      UnifiedSearchService.instance = new UnifiedSearchService();
    }
    return UnifiedSearchService.instance;
  }

  async search(query: string, limit?: number): Promise<SearchCategory[]> {
    if (!query || query.trim().length === 0) {
      return [];
    }

    const normalizedQuery = query.toLowerCase().trim();
    const categories: SearchCategory[] = [];

    // Search verses
    const verseResults = await this.searchVerses(normalizedQuery, limit);
    if (verseResults.length > 0) {
      categories.push({
        name: 'Verses',
        count: verseResults.length,
        results: verseResults,
      });
    }

    // TODO: Add more search categories
    // - Places/Geography
    // - Strong's numbers
    // - Morphology
    // - Cross-references

    return categories;
  }

  private async searchVerses(query: string, limit: number = 250): Promise<SearchResult[]> {
    try {
      console.time(`searchVerses: "${query}"`);
      // Use the IndexedDBSearchIndex to search
      const dbResults = await this.searchIndex.search(query);
      console.timeEnd(`searchVerses: "${query}"`);
      
      // Limit results (default 250, or all if limit is -1)
      const resultLimit = limit === -1 ? dbResults.length : limit;
      
      console.log(`Formatting ${resultLimit.toLocaleString()} results...`);
      console.time(`Formatting ${resultLimit} results`);
      
      // Convert to our SearchResult format
      const results = dbResults.slice(0, resultLimit).map((result, index) => ({
        type: 'verse' as const,
        title: `${result.book} ${result.chapter}:${result.verse}`,
        subtitle: result.snippet || result.text,
        reference: `${result.book} ${result.chapter}:${result.verse}`,
        data: { 
          book: result.book, 
          chapter: result.chapter, 
          verse: result.verse,
          translation: result.translation
        },
        score: 1.0 - (index / 100), // Simple relevance scoring
      }));
      
      console.timeEnd(`Formatting ${resultLimit} results`);
      console.log(`✓ Formatted ${results.length.toLocaleString()} results`);
      
      return results;
    } catch (error) {
      console.error('Error searching verses:', error);
      return [];
    }
  }
  
  async getTotalCount(query: string): Promise<number> {
    try {
      console.time(`getTotalCount: "${query}"`);
      const dbResults = await this.searchIndex.search(query);
      console.timeEnd(`getTotalCount: "${query}"`);
      console.log(`Total results for "${query}":`, dbResults.length);
      return dbResults.length;
    } catch (error) {
      console.error('Error getting total count:', error);
      return 0;
    }
  }

  private async searchPlaces(_query: string): Promise<SearchResult[]> {
    // TODO: Implement place search
    return [];
  }

  private async searchStrongs(_query: string): Promise<SearchResult[]> {
    // TODO: Implement Strong's search
    return [];
  }

  private async searchMorphology(_query: string): Promise<SearchResult[]> {
    // TODO: Implement morphology search
    return [];
  }
}

export const searchService = UnifiedSearchService.getInstance();
