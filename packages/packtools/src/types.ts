export interface SourceManifest {
  id: string;
  version: string;
  type: 'text' | 'lexicon' | 'places' | 'map';
  translationId?: string;
  translationName?: string;
  license: string;
  attribution?: string;
  sourceUrl?: string;
  sourceHash?: string;
  sourceData?: VerseData[];
}

export interface VerseData {
  book: string;
  chapter: number;
  verse: number;
  text: string;
}
