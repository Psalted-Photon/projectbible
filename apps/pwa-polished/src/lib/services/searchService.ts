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

  async search(query: string): Promise<SearchCategory[]> {
    if (!query || query.trim().length === 0) {
      return [];
    }

    const normalizedQuery = query.toLowerCase().trim();
    const categories: SearchCategory[] = [];

    // Search verses
    const verseResults = await this.searchVerses(normalizedQuery);
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

  private async searchVerses(query: string): Promise<SearchResult[]> {
    try {
      // Use the IndexedDBSearchIndex to search
      const dbResults = await this.searchIndex.search(query);
      
      // Convert to our SearchResult format and limit to top 50 results
      return dbResults.slice(0, 50).map((result, index) => ({
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
    } catch (error) {
      console.error('Error searching verses:', error);
      return [];
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
