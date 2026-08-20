import type { SearchConfig } from './searchConfig';

export interface SearchPreset {
  id: string;
  name: string;
  description: string;
  icon: string;
  config: SearchConfig;
}

export const defaultPresets: SearchPreset[] = [
  {
    id: 'faith-works',
    name: 'Faith and Works',
    description: 'Verses discussing both faith and works together',
    icon: '⚖️',
    config: {
      text: 'faith',
      matchType: 'wholeWord',
      caseInsensitive: true,
      exactPhrase: false,
      includePlurals: false,
      mustContain: ['works'],
      mustNotContain: [],
      proximityRules: [],
      matchCapitalizedNames: false,
      matchQuotedSpeech: false,
      strongsNumbers: [],
      showPronunciation: false,
      testament: 'both',
    }
  },
  {
    id: 'love-neighbor',
    name: 'Love Your Neighbor',
    description: 'Verses about loving your neighbor',
    icon: '❤️',
    config: {
      text: '',
      matchType: 'contains',
      caseInsensitive: true,
      exactPhrase: false,
      includePlurals: false,
      mustContain: [],
      mustNotContain: [],
      proximityRules: [{
        word1: 'love',
        word2: 'neighbor',
        maxDistance: 10
      }],
      matchCapitalizedNames: false,
      matchQuotedSpeech: false,
      strongsNumbers: [],
      showPronunciation: false,
      testament: 'both',
    }
  },
  {
    id: 'grace-not-works',
    name: 'Grace Not Works',
    description: 'Salvation by grace, not by works',
    icon: '🎁',
    config: {
      text: 'grace',
      matchType: 'wholeWord',
      caseInsensitive: true,
      exactPhrase: false,
      includePlurals: false,
      mustContain: ['saved', 'salvation'],
      mustNotContain: ['works'],
      proximityRules: [],
      matchCapitalizedNames: false,
      matchQuotedSpeech: false,
      strongsNumbers: [],
      showPronunciation: false,
      testament: 'NT',
    }
  },
  {
    id: 'beginning',
    name: 'In the Beginning',
    description: 'Creation and beginning references',
    icon: '🌅',
    config: {
      text: 'beginning',
      matchType: 'wordStartsWith',
      caseInsensitive: true,
      exactPhrase: false,
      includePlurals: false,
      mustContain: [],
      mustNotContain: [],
      proximityRules: [],
      matchCapitalizedNames: false,
      matchQuotedSpeech: false,
      strongsNumbers: [],
      showPronunciation: false,
      testament: 'both',
    }
  },
  {
    id: 'resurrection',
    name: 'Resurrection',
    description: 'Verses about resurrection and rising',
    icon: '🌟',
    config: {
      text: 'rise',
      matchType: 'wordStartsWith',
      caseInsensitive: true,
      exactPhrase: false,
      includePlurals: true,
      mustContain: [],
      mustNotContain: [],
      proximityRules: [],
      matchCapitalizedNames: false,
      matchQuotedSpeech: false,
      strongsNumbers: [],
      showPronunciation: false,
      books: ['Matthew', 'Mark', 'Luke', 'John'],
    }
  },
  {
    id: 'fear-not',
    name: 'Fear Not',
    description: 'Encouragement to not fear',
    icon: '💪',
    config: {
      text: '',
      matchType: 'contains',
      caseInsensitive: true,
      exactPhrase: false,
      includePlurals: false,
      mustContain: [],
      mustNotContain: [],
      proximityRules: [{
        word1: 'fear',
        word2: 'not',
        maxDistance: 3
      }],
      matchCapitalizedNames: false,
      matchQuotedSpeech: false,
      strongsNumbers: [],
      showPronunciation: false,
      testament: 'both',
    }
  }
];
