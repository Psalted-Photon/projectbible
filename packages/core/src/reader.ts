/**
 * Reader component - displays Bible verses in a clean, readable format
 */

interface Verse {
  verse: number;
  text: string;
}

interface Chapter {
  book: string;
  chapter: number;
  translation: string;
  verses: Verse[];
}

interface ReaderSettings {
  fontSize: number; // 14-24px
  lineSpacing: number; // 1.4-2.2
  nightMode: boolean;
}

const DEFAULT_SETTINGS: ReaderSettings = {
  fontSize: 18,
  lineSpacing: 1.8,
  nightMode: false
};

// Mock data for development
const MOCK_CHAPTERS: Record<string, Chapter> = {
  'john-3': {
    book: 'John',
    chapter: 3,
    translation: 'WEB',
    verses: [
      { verse: 16, text: 'For God so loved the world, that he gave his only born Son, that whoever believes in him should not perish, but have eternal life.' },
      { verse: 17, text: 'For God didn\'t send his Son into the world to judge the world, but that the world should be saved through him.' },
      { verse: 18, text: 'He who believes in him is not judged. He who doesn\'t believe has been judged already, because he has not believed in the name of the only born Son of God.' },
      { verse: 19, text: 'This is the judgment, that the light has come into the world, and men loved the darkness rather than the light, for their works were evil.' },
      { verse: 20, text: 'For everyone who does evil hates the light and doesn\'t come to the light, lest his works would be exposed.' },
      { verse: 21, text: 'But he who does the truth comes to the light, that his works may be revealed, that they have been done in God.' }
    ]
  },
  'genesis-1': {
    book: 'Genesis',
    chapter: 1,
    translation: 'WEB',
    verses: [
      { verse: 1, text: 'In the beginning, God created the heavens and the earth.' },
      { verse: 2, text: 'The earth was formless and empty. Darkness was on the surface of the deep and God\'s Spirit was hovering over the surface of the waters.' },
      { verse: 3, text: 'God said, "Let there be light," and there was light.' },
      { verse: 4, text: 'God saw the light, and saw that it was good. God divided the light from the darkness.' },
      { verse: 5, text: 'God called the light "day", and the darkness he called "night". There was evening and there was morning, the first day.' }
    ]
  },
  'psalm-23': {
    book: 'Psalms',
    chapter: 23,
    translation: 'WEB',
    verses: [
      { verse: 1, text: 'Yahweh is my shepherd; I shall lack nothing.' },
      { verse: 2, text: 'He makes me lie down in green pastures. He leads me beside still waters.' },
      { verse: 3, text: 'He restores my soul. He guides me in the paths of righteousness for his name\'s sake.' },
      { verse: 4, text: 'Even though I walk through the valley of the shadow of death, I will fear no evil, for you are with me. Your rod and your staff, they comfort me.' },
      { verse: 5, text: 'You prepare a table before me in the presence of my enemies. You anoint my head with oil. My cup runs over.' },
      { verse: 6, text: 'Surely goodness and loving kindness shall follow me all the days of my life, and I will dwell in Yahweh\'s house forever.' }
    ]
  }
};

const CHAPTER_ORDER = ['genesis-1', 'psalm-23', 'john-3'];

export class Reader {
  private currentChapterIndex = 0;
  private container: HTMLElement;
  private settings: ReaderSettings;
  private settingsOpen = false;

  constructor(container: HTMLElement) {
    this.container = container;
    this.settings = this.loadSettings();
  }

  private loadSettings(): ReaderSettings {
    try {
      const saved = localStorage.getItem('reader-settings');
      return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  }

  private saveSettings(): void {
    try {
      localStorage.setItem('reader-settings', JSON.stringify(this.settings));
    } catch {
      // LocalStorage not available
    }
  }

  render(): void {
    const chapterKey = CHAPTER_ORDER[this.currentChapterIndex];
    const chapter = MOCK_CHAPTERS[chapterKey];

    const theme = this.settings.nightMode ? 'night' : 'day';

    this.container.innerHTML = `
      <div class="reader" data-theme="${theme}">
        ${this.renderHeader(chapter)}
        ${this.renderSettings()}
        ${this.renderVerses(chapter)}
        ${this.renderNavigation()}
      </div>
    `;

    this.attachEventListeners();
  }

  private renderHeader(chapter: Chapter): string {
    return `
      <header class="reader-header">
        <div class="header-top">
          <h1 class="chapter-title">${chapter.book} ${chapter.chapter}</h1>
          <button class="settings-btn" data-action="toggle-settings" aria-label="Settings">
            ⚙️
          </button>
        </div>
        <p class="translation-badge">${chapter.translation}</p>
      </header>
    `;
  }

  private renderSettings(): string {
    return `
      <div class="settings-panel" data-open="${this.settingsOpen}">
        <h3 class="settings-title">Reading Settings</h3>
        
        <div class="setting-group">
          <label class="setting-label">Font Size</label>
          <div class="setting-controls">
            <button class="setting-btn" data-action="font-smaller">A-</button>
            <span class="setting-value">${this.settings.fontSize}px</span>
            <button class="setting-btn" data-action="font-larger">A+</button>
          </div>
        </div>

        <div class="setting-group">
          <label class="setting-label">Line Spacing</label>
          <div class="setting-controls">
            <button class="setting-btn" data-action="spacing-smaller">−</button>
            <span class="setting-value">${this.settings.lineSpacing.toFixed(1)}</span>
            <button class="setting-btn" data-action="spacing-larger">+</button>
          </div>
        </div>

        <div class="setting-group">
          <label class="setting-label">Night Mode</label>
          <div class="setting-controls">
            <button 
              class="toggle-btn" 
              data-action="toggle-night"
              data-active="${this.settings.nightMode}"
            >
              ${this.settings.nightMode ? '🌙 On' : '☀️ Off'}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private renderVerses(chapter: Chapter): string {
    const versesHtml = chapter.verses
      .map(v => `
        <div class="verse" data-verse="${v.verse}">
          <sup class="verse-number">${v.verse}</sup>
          <span class="verse-text">${v.text}</span>
        </div>
      `)
      .join('');

    return `
      <div 
        class="verses-container" 
        style="font-size: ${this.settings.fontSize}px; line-height: ${this.settings.lineSpacing};"
      >
        ${versesHtml}
      </div>
    `;
  }

  private renderNavigation(): string {
    const hasPrev = this.currentChapterIndex > 0;
    const hasNext = this.currentChapterIndex < CHAPTER_ORDER.length - 1;

    return `
      <nav class="reader-nav">
        <button 
          class="nav-btn prev-btn" 
          data-action="prev"
          ${!hasPrev ? 'disabled' : ''}
        >
          ← Previous
        </button>
        <span class="nav-indicator">
          ${this.currentChapterIndex + 1} / ${CHAPTER_ORDER.length}
        </span>
        <button 
          class="nav-btn next-btn" 
          data-action="next"
          ${!hasNext ? 'disabled' : ''}
        >
          Next →
        </button>
      </nav>
    `;
  }

  private attachEventListeners(): void {
    const prevBtn = this.container.querySelector('[data-action="prev"]');
    const nextBtn = this.container.querySelector('[data-action="next"]');
    const settingsBtn = this.container.querySelector('[data-action="toggle-settings"]');
    
    const fontSmallerBtn = this.container.querySelector('[data-action="font-smaller"]');
    const fontLargerBtn = this.container.querySelector('[data-action="font-larger"]');
    const spacingSmallerBtn = this.container.querySelector('[data-action="spacing-smaller"]');
    const spacingLargerBtn = this.container.querySelector('[data-action="spacing-larger"]');
    const toggleNightBtn = this.container.querySelector('[data-action="toggle-night"]');

    prevBtn?.addEventListener('click', () => this.navigatePrev());
    nextBtn?.addEventListener('click', () => this.navigateNext());
    settingsBtn?.addEventListener('click', () => this.toggleSettings());
    
    fontSmallerBtn?.addEventListener('click', () => this.adjustFontSize(-1));
    fontLargerBtn?.addEventListener('click', () => this.adjustFontSize(1));
    spacingSmallerBtn?.addEventListener('click', () => this.adjustLineSpacing(-0.1));
    spacingLargerBtn?.addEventListener('click', () => this.adjustLineSpacing(0.1));
    toggleNightBtn?.addEventListener('click', () => this.toggleNightMode());
  }

  private toggleSettings(): void {
    this.settingsOpen = !this.settingsOpen;
    this.render();
  }

  private adjustFontSize(delta: number): void {
    this.settings.fontSize = Math.max(14, Math.min(24, this.settings.fontSize + delta));
    this.saveSettings();
    this.render();
  }

  private adjustLineSpacing(delta: number): void {
    this.settings.lineSpacing = Math.max(1.4, Math.min(2.2, this.settings.lineSpacing + delta));
    this.saveSettings();
    this.render();
  }

  private toggleNightMode(): void {
    this.settings.nightMode = !this.settings.nightMode;
    this.saveSettings();
    this.render();
  }

  private navigatePrev(): void {
    if (this.currentChapterIndex > 0) {
      this.currentChapterIndex--;
      this.render();
      this.container.querySelector('.reader')?.scrollIntoView({ behavior: 'smooth' });
    }
  }

  private navigateNext(): void {
    if (this.currentChapterIndex < CHAPTER_ORDER.length - 1) {
      this.currentChapterIndex++;
      this.render();
      this.container.querySelector('.reader')?.scrollIntoView({ behavior: 'smooth' });
    }
  }
}

export function getReaderStyles(): string {
  return `
    .reader {
      max-width: 700px;
      margin: 0 auto;
      padding: 16px;
      font-family: Georgia, 'Times New Roman', serif;
      background: #fafafa;
      min-height: 100vh;
      transition: background 0.3s, color 0.3s;
    }

    .reader[data-theme="night"] {
      background: #1a1a1a;
      color: #e0e0e0;
    }

    .reader-header {
      text-align: center;
      margin-bottom: 16px;
      padding-bottom: 16px;
      border-bottom: 2px solid #ddd;
    }

    .reader[data-theme="night"] .reader-header {
      border-bottom-color: #444;
    }

    .header-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
    }

    .chapter-title {
      margin: 0;
      font-size: 28px;
      color: #222;
      font-weight: 600;
      flex: 1;
    }

    .reader[data-theme="night"] .chapter-title {
      color: #e0e0e0;
    }

    .settings-btn {
      background: none;
      border: none;
      font-size: 24px;
      cursor: pointer;
      padding: 4px;
      opacity: 0.7;
      transition: opacity 0.2s;
    }

    .settings-btn:hover {
      opacity: 1;
    }

    .translation-badge {
      margin: 8px 0 0;
      font-size: 14px;
      color: #666;
      font-family: system-ui, -apple-system, sans-serif;
      text-transform: uppercase;
      letter-spacing: 1px;
    }

    .reader[data-theme="night"] .translation-badge {
      color: #999;
    }

    .settings-panel {
      background: white;
      border: 2px solid #ddd;
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 16px;
      max-height: 0;
      overflow: hidden;
      opacity: 0;
      transition: all 0.3s;
    }

    .reader[data-theme="night"] .settings-panel {
      background: #2a2a2a;
      border-color: #444;
    }

    .settings-panel[data-open="true"] {
      max-height: 400px;
      opacity: 1;
    }

    .settings-title {
      margin: 0 0 16px;
      font-size: 18px;
      font-family: system-ui, -apple-system, sans-serif;
      color: #333;
    }

    .reader[data-theme="night"] .settings-title {
      color: #e0e0e0;
    }

    .setting-group {
      margin-bottom: 16px;
      padding-bottom: 16px;
      border-bottom: 1px solid #eee;
    }

    .reader[data-theme="night"] .setting-group {
      border-bottom-color: #444;
    }

    .setting-group:last-child {
      border-bottom: none;
      margin-bottom: 0;
      padding-bottom: 0;
    }

    .setting-label {
      display: block;
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 8px;
      font-family: system-ui, -apple-system, sans-serif;
      color: #555;
    }

    .reader[data-theme="night"] .setting-label {
      color: #aaa;
    }

    .setting-controls {
      display: flex;
      align-items: center;
      gap: 12px;
      justify-content: center;
    }

    .setting-btn, .toggle-btn {
      padding: 8px 16px;
      font-size: 16px;
      font-weight: 600;
      border: 2px solid #333;
      background: white;
      color: #333;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s;
      font-family: system-ui, -apple-system, sans-serif;
      min-width: 50px;
    }

    .reader[data-theme="night"] .setting-btn,
    .reader[data-theme="night"] .toggle-btn {
      background: #333;
      color: #e0e0e0;
      border-color: #555;
    }

    .setting-btn:active, .toggle-btn:active {
      transform: scale(0.95);
    }

    .toggle-btn {
      min-width: 80px;
    }

    .toggle-btn[data-active="true"] {
      background: #333;
      color: white;
    }

    .reader[data-theme="night"] .toggle-btn[data-active="true"] {
      background: #555;
    }

    .setting-value {
      font-family: 'Courier New', monospace;
      font-size: 16px;
      font-weight: bold;
      min-width: 60px;
      text-align: center;
      color: #333;
    }

    .reader[data-theme="night"] .setting-value {
      color: #e0e0e0;
    }

    .verses-container {
      margin-bottom: 32px;
    }

    .verse {
      margin-bottom: 12px;
      color: #222;
    }

    .reader[data-theme="night"] .verse {
      color: #e0e0e0;
    }

    .verse-number {
      color: #888;
      font-size: 14px;
      font-weight: bold;
      margin-right: 8px;
      user-select: none;
    }

    .reader[data-theme="night"] .verse-number {
      color: #999;
    }

    .verse-text {
      color: #222;
    }

    .reader[data-theme="night"] .verse-text {
      color: #e0e0e0;
    }

    .reader-nav {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      padding: 16px 0;
      border-top: 2px solid #ddd;
      position: sticky;
      bottom: 0;
      background: #fafafa;
    }

    .reader[data-theme="night"] .reader-nav {
      background: #1a1a1a;
      border-top-color: #444;
    }

    .nav-btn {
      flex: 1;
      padding: 12px 20px;
      font-size: 16px;
      font-weight: 500;
      border: 2px solid #333;
      background: white;
      color: #333;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s;
      font-family: system-ui, -apple-system, sans-serif;
    }

    .reader[data-theme="night"] .nav-btn {
      background: #2a2a2a;
      color: #e0e0e0;
      border-color: #555;
    }

    .nav-btn:hover:not(:disabled) {
      background: #333;
      color: white;
    }

    .reader[data-theme="night"] .nav-btn:hover:not(:disabled) {
      background: #444;
    }

    .nav-btn:active:not(:disabled) {
      transform: scale(0.98);
    }

    .nav-btn:disabled {
      opacity: 0.3;
      cursor: not-allowed;
      border-color: #999;
      color: #999;
    }

    .nav-indicator {
      font-size: 14px;
      color: #666;
      font-family: system-ui, -apple-system, sans-serif;
      white-space: nowrap;
    }

    .reader[data-theme="night"] .nav-indicator {
      color: #999;
    }

    @media (max-width: 600px) {
      .reader {
        padding: 12px;
      }

      .chapter-title {
        font-size: 24px;
      }

      .nav-btn {
        padding: 10px 16px;
        font-size: 15px;
      }

      .setting-btn, .toggle-btn {
        padding: 6px 12px;
        font-size: 14px;
      }
    }
  `;
}
