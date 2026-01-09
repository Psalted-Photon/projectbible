import { IndexedDBTextStore, IndexedDBPackManager, IndexedDBSearchIndex, IndexedDBCrossReferenceStore, importPackFromSQLite, getSettings, updateSettings, getDailyDriverFor, getPrimaryDailyDriver, type UserSettings, openDB } from './adapters/index.js';
import { clearAllData, clearPacksOnly, getDatabaseStats } from './adapters/db-manager.js';

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app element');

// Create adapter instances
const textStore = new IndexedDBTextStore();
const packManager = new IndexedDBPackManager();
const searchIndex = new IndexedDBSearchIndex();
const crossRefStore = new IndexedDBCrossReferenceStore();

// State management for verse selection
const selectedVerses = new Set<string>(); // Store as "book:chapter:verse"
const selectedWords = new Set<string>(); // Store as "book:chapter:verse:position"
let longPressTimer: number | null = null;
const LONG_PRESS_DURATION = 800; // 0.8 seconds

// Bible books list
const BIBLE_BOOKS = [
  'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy', 'Joshua', 'Judges', 'Ruth',
  '1 Samuel', '2 Samuel', '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles', 
  'Ezra', 'Nehemiah', 'Esther', 'Job', 'Psalms', 'Proverbs', 'Ecclesiastes', 'Song of Solomon',
  'Isaiah', 'Jeremiah', 'Lamentations', 'Ezekiel', 'Daniel',
  'Hosea', 'Joel', 'Amos', 'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk', 'Zephaniah', 'Haggai', 'Zechariah', 'Malachi',
  'Matthew', 'Mark', 'Luke', 'John', 'Acts',
  'Romans', '1 Corinthians', '2 Corinthians', 'Galatians', 'Ephesians', 'Philippians', 'Colossians',
  '1 Thessalonians', '2 Thessalonians', '1 Timothy', '2 Timothy', 'Titus', 'Philemon',
  'Hebrews', 'James', '1 Peter', '2 Peter', '1 John', '2 John', '3 John', 'Jude', 'Revelation'
];

// Simple test UI
root.innerHTML = `
  <div style="max-width: 800px; margin: 40px auto; padding: 20px; font-family: system-ui;">
    <h1>ProjectBible PWA - Adapter Test</h1>
    
    <section style="margin: 30px 0; padding: 20px; background: #f5f5f5; border-radius: 8px;">
      <h2>Import Pack</h2>
      <div style="margin-bottom: 15px;">
        <h3 style="font-size: 14px; margin: 10px 0;">📱 Download from URL (mobile-friendly)</h3>
        <input type="text" id="packUrl" placeholder="https://example.com/greek.sqlite" 
               style="width: 70%; padding: 8px; margin-right: 10px;" />
        <button id="downloadBtn" style="padding: 8px 16px;">Download & Import</button>
      </div>
      <div style="margin-bottom: 15px;">
        <h3 style="font-size: 14px; margin: 10px 0;">💾 Upload from device</h3>
        <input type="file" id="packFile" accept=".sqlite" />
        <button id="importBtn" style="margin-left: 10px; padding: 8px 16px;">Import Pack</button>
      </div>
      <div id="importStatus" style="margin-top: 10px; color: #666;"></div>
    </section>
    
    <section style="margin: 30px 0; padding: 20px; background: #e8f5e8; border-radius: 8px;">
      <h2>⚙️ Settings</h2>
      <h3 style="font-size: 16px; margin: 15px 0 10px 0;">Daily Driver Translations</h3>
      <p style="margin: 5px 0; color: #666; font-size: 14px;">Set your preferred default translations</p>
      <div style="margin: 15px 0;">
        <label style="display: block; margin: 10px 0;">
          English:
          <select id="ddEnglish" style="margin-left: 10px; padding: 4px;">
            <option value="">Not set</option>
          </select>
        </label>
        <label style="display: block; margin: 10px 0;">
          Hebrew:
          <select id="ddHebrew" style="margin-left: 10px; padding: 4px;">
            <option value="">Not set</option>
          </select>
        </label>
        <label style="display: block; margin: 10px 0;">
          Greek:
          <select id="ddGreek" style="margin-left: 10px; padding: 4px;">
            <option value="">Not set</option>
          </select>
        </label>
        <button id="saveSettings" style="padding: 8px 16px; margin-top: 10px; background: #2e7d32; color: white; border: none; border-radius: 4px; cursor: pointer;">
          Save Settings
        </button>
        <span id="settingsSaved" style="margin-left: 10px; color: #2e7d32; display: none;">✓ Saved</span>
      </div>
    </section>
    
    <section style="margin: 30px 0; padding: 20px; background: #ffe8e8; border-radius: 8px;">
      <h2>⚠️ Database Management</h2>
      <p style="margin: 10px 0; color: #666;">Clear old packs to free up space</p>
      <button id="clearPacksBtn" style="padding: 8px 16px; background: #ff6b6b; color: white; border: none; border-radius: 4px; cursor: pointer;">
        Clear All Packs (Keep User Data)
      </button>
      <button id="clearAllBtn" style="padding: 8px 16px; margin-left: 10px; background: #c92a2a; color: white; border: none; border-radius: 4px; cursor: pointer;">
        Clear Everything (Nuclear)
      </button>
      <div id="dbStats" style="margin-top: 10px; font-size: 14px; color: #666;"></div>
    </section>
    
    <section style="margin: 30px 0; padding: 20px; background: #f5f5f5; border-radius: 8px;">
      <h2>Installed Packs</h2>
      <button id="refreshPacks" style="padding: 8px 16px;">Refresh</button>
      <div id="packsList" style="margin-top: 15px;"></div>
    </section>
    
    <section style="margin: 30px 0; padding: 20px; background: #e8f4f8; border-radius: 8px;">
      <h2>🔍 Search Bible</h2>
      <div style="margin: 10px 0;">
        <input type="text" id="searchQuery" placeholder="Enter search terms..." 
               style="padding: 8px; width: 60%; font-size: 16px;" />
        <button id="searchBtn" style="padding: 8px 16px; margin-left: 10px; font-size: 16px;">Search</button>
      </div>
      <div style="margin-top: 10px;">
        <label>
          <input type="checkbox" id="searchAllTranslations" checked />
          Search all translations
        </label>
      </div>
      <div id="searchStatus" style="margin-top: 10px; color: #666;"></div>
      <div id="searchResults" style="margin-top: 15px; max-height: 500px; overflow-y: auto;"></div>
    </section>
    
    <section style="margin: 30px 0; padding: 20px; background: #e8f8e8; border-radius: 8px;">
      <h2>🗺️ Historical Maps</h2>
      <div style="margin: 10px 0;">
        <button id="loadMapsBtn" style="padding: 8px 16px;">Load Map Layers</button>
      </div>
      <div id="mapLayersList" style="margin-top: 15px;"></div>
      <div id="mapViewer" style="margin-top: 20px; display: none; background: white; padding: 15px; border-radius: 8px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
          <h3 id="mapViewerTitle" style="margin: 0;"></h3>
          <button id="closeMapBtn" style="padding: 6px 12px; background: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer;">Close</button>
        </div>
        <div id="mapDetails" style="margin-bottom: 15px; padding: 10px; background: #f8f9fa; border-radius: 4px;"></div>
        <div id="mapCanvas" style="width: 100%; height: 500px; border: 1px solid #ddd; background: #e9ecef; display: flex; align-items: center; justify-content: center; color: #666;">
          GeoJSON map rendering (requires Leaflet or similar library)
        </div>
      </div>
    </section>
    
    <section style="margin: 30px 0; padding: 20px; background: #f5f5f5; border-radius: 8px;">
      <h2>Read Verse</h2>
      <div style="margin: 10px 0;">
        <label>Translation: 
          <select id="translation" style="padding: 4px; min-width: 120px;">
            <option value="">Loading...</option>
          </select>
        </label>
        <label style="margin-left: 10px;">Book: 
          <select id="book" style="padding: 4px; min-width: 150px;">
            <option value="">Select translation first</option>
          </select>
        </label>
        <label style="margin-left: 10px;">Chapter:
          <select id="chapter" style="padding: 4px; min-width: 80px;">
            <option value="1">1</option>
          </select>
        </label>
        <label style="margin-left: 10px;">Verse:
          <select id="verse" style="padding: 4px; min-width: 80px;">
            <option value="1">1</option>
          </select>
        </label>
      </div>
      <button id="readVerse" style="padding: 8px 16px; margin-top: 10px;">Read Verse</button>
      <button id="readChapter" style="padding: 8px 16px; margin-left: 10px;">Read Chapter</button>
      <div id="verseText" style="margin-top: 15px; padding: 15px; background: white; border-radius: 4px; min-height: 40px;"></div>
    </section>
  </div>
  
  <!-- Cross-reference popup -->
  <div id="xrefModal" style="display: none; position: fixed; background: white; padding: 15px; border-radius: 8px; max-width: 400px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); z-index: 1000; border: 1px solid #ddd;">
    <button id="closeXrefModal" style="position: absolute; top: 8px; right: 8px; background: #f0f0f0; border: none; border-radius: 50%; width: 24px; height: 24px; cursor: pointer; font-size: 16px; line-height: 1;">&times;</button>
    <div id="xrefModalContent"></div>
  </div>
  
  <!-- Verse action menu popup -->
  <div id="verseActionModal" style="display: none; position: fixed; background: white; padding: 20px; border-radius: 8px; max-width: 350px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); z-index: 1001; border: 1px solid #ddd;">
    <button id="closeVerseActionModal" style="position: absolute; top: 8px; right: 8px; background: #f0f0f0; border: none; border-radius: 50%; width: 24px; height: 24px; cursor: pointer; font-size: 16px; line-height: 1;">&times;</button>
    <h3 style="margin: 0 0 15px 0; font-size: 16px;">Actions for Selected Verses</h3>
    <div id="verseActionContent" style="display: flex; flex-direction: column; gap: 10px;">
      <button class="action-btn" onclick="createNoteForSelected()" style="padding: 10px; border: 1px solid #ddd; border-radius: 4px; background: white; cursor: pointer; text-align: left;">
        📝 Create Note
      </button>
      <button class="action-btn" onclick="highlightSelected()" style="padding: 10px; border: 1px solid #ddd; border-radius: 4px; background: #fff9c4; cursor: pointer; text-align: left;">
        🖍️ Highlight (Yellow)
      </button>
      <button class="action-btn" onclick="underlineSelected()" style="padding: 10px; border: 1px solid #ddd; border-radius: 4px; background: white; cursor: pointer; text-align: left;">
        <u>U</u> Underline
      </button>
      <button class="action-btn" onclick="italicizeSelected()" style="padding: 10px; border: 1px solid #ddd; border-radius: 4px; background: white; cursor: pointer; text-align: left;">
        <i>I</i> Italicize
      </button>
      <button class="action-btn" onclick="clearSelection()" style="padding: 10px; border: 1px solid #ddd; border-radius: 4px; background: #ffebee; cursor: pointer; text-align: left;">
        ❌ Clear Selection
      </button>
    </div>
  </div>
  
  <!-- Word study popup -->
  <div id="wordStudyModal" style="display: none; position: fixed; background: white; padding: 20px; border-radius: 8px; max-width: 500px; max-height: 80vh; overflow-y: auto; box-shadow: 0 4px 16px rgba(0,0,0,0.3); z-index: 1002; border: 1px solid #ddd;">
    <button id="closeWordStudyModal" style="position: absolute; top: 8px; right: 8px; background: #f0f0f0; border: none; border-radius: 50%; width: 28px; height: 28px; cursor: pointer; font-size: 18px; line-height: 1;">&times;</button>
    <div id="wordStudyContent"></div>
  </div>
`;

// Download pack from URL handler (mobile-friendly)
document.getElementById('downloadBtn')?.addEventListener('click', async () => {
  const urlInput = document.getElementById('packUrl') as HTMLInputElement;
  const statusDiv = document.getElementById('importStatus')!;
  
  const url = urlInput.value.trim();
  if (!url) {
    statusDiv.textContent = '❌ Please enter a URL';
    statusDiv.style.color = 'red';
    return;
  }
  
  statusDiv.textContent = `⏳ Downloading from ${url}...`;
  statusDiv.style.color = '#666';
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const blob = await response.blob();
    const file = new File([blob], url.split('/').pop() || 'pack.sqlite', { type: 'application/x-sqlite3' });
    
    statusDiv.textContent = `⏳ Importing ${file.name}...`;
    
    await importPackFromSQLite(file);
    statusDiv.textContent = `✅ Successfully imported ${file.name}`;
    statusDiv.style.color = 'green';
    
    // Refresh packs list
    await refreshPacksList();
    await populateDailyDriverDropdowns();
    await populateTranslationDropdown();
    
  } catch (error) {
    statusDiv.textContent = `❌ Error: ${error instanceof Error ? error.message : 'Unknown'}`;
    statusDiv.style.color = 'red';
    console.error(error);
  }
});

// Import pack handler
document.getElementById('importBtn')?.addEventListener('click', async () => {
  const fileInput = document.getElementById('packFile') as HTMLInputElement;
  const statusDiv = document.getElementById('importStatus')!;
  
  if (!fileInput.files || !fileInput.files[0]) {
    statusDiv.textContent = '❌ Please select a file';
    return;
  }
  
  const file = fileInput.files[0];
  statusDiv.textContent = `⏳ Importing ${file.name}...`;
  
  try {
    await importPackFromSQLite(file);
    statusDiv.textContent = `✅ Successfully imported ${file.name}`;
    statusDiv.style.color = 'green';
    
    // Refresh packs list
    await refreshPacksList();
  } catch (error) {
    statusDiv.textContent = `❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
    statusDiv.style.color = 'red';
    console.error(error);
  }
});

// Database management handlers
document.getElementById('clearPacksBtn')?.addEventListener('click', async () => {
  if (!confirm('This will remove all installed packs but keep your notes, highlights, and bookmarks. Continue?')) {
    return;
  }
  
  const statsDiv = document.getElementById('dbStats')!;
  statsDiv.textContent = '⏳ Clearing packs...';
  
  try {
    await clearPacksOnly();
    statsDiv.textContent = '✅ All packs cleared! Refresh the page to start fresh.';
    statsDiv.style.color = 'green';
    
    // Refresh UI
    await refreshPacksList();
    await updateDatabaseStats();
  } catch (error) {
    statsDiv.textContent = `❌ Error: ${error instanceof Error ? error.message : 'Unknown'}`;
    statsDiv.style.color = 'red';
  }
});

document.getElementById('clearAllBtn')?.addEventListener('click', async () => {
  if (!confirm('⚠️ THIS WILL DELETE EVERYTHING including your notes, highlights, and bookmarks! Are you absolutely sure?')) {
    return;
  }
  
  const statsDiv = document.getElementById('dbStats')!;
  statsDiv.textContent = '⏳ Clearing all data...';
  
  try {
    await clearAllData();
    statsDiv.textContent = '✅ Database cleared! Refresh the page.';
    statsDiv.style.color = 'green';
    
    // Recommend page reload
    setTimeout(() => {
      window.location.reload();
    }, 2000);
  } catch (error) {
    statsDiv.textContent = `❌ Error: ${error instanceof Error ? error.message : 'Unknown'}`;
    statsDiv.style.color = 'red';
  }
});

async function updateDatabaseStats() {
  const statsDiv = document.getElementById('dbStats')!;
  
  try {
    const stats = await getDatabaseStats();
    statsDiv.innerHTML = `
      <strong>Current Data:</strong> 
      ${stats.packs} packs, 
      ${stats.verses.toLocaleString()} verses, 
      ${stats.notes} notes, 
      ${stats.highlights} highlights, 
      ${stats.bookmarks} bookmarks, 
      ${stats.places} places
      <br/>
      <strong>Storage:</strong> ${stats.totalSizeEstimate}
    `;
    statsDiv.style.color = '#666';
  } catch (error) {
    statsDiv.textContent = 'Could not load stats';
    console.error(error);
  }
}

// Refresh packs list
async function refreshPacksList() {
  const packsDiv = document.getElementById('packsList')!;
  
  try {
    const packs = await packManager.listInstalled();
    
    if (packs.length === 0) {
      packsDiv.innerHTML = '<p style="color: #999;">No packs installed</p>';
      return;
    }
    
    packsDiv.innerHTML = packs.map(pack => `
      <div style="padding: 10px; margin: 5px 0; background: white; border-radius: 4px;">
        <strong>${pack.translationName || pack.id}</strong> (${pack.translationId || 'N/A'})<br/>
        <small style="color: #666;">
          Version: ${pack.version} | 
          Type: ${pack.type} | 
          Size: ${(pack.size! / 1024).toFixed(1)} KB
        </small>
      </div>
    `).join('');
    
    // Update translation dropdown
    await refreshTranslationDropdown();
  } catch (error) {
    packsDiv.innerHTML = `<p style="color: red;">Error: ${error instanceof Error ? error.message : 'Unknown'}</p>`;
    console.error(error);
  }
}

// Refresh translation dropdown
async function refreshTranslationDropdown() {
  const translationSelect = document.getElementById('translation') as HTMLSelectElement;
  
  try {
    const translations = await textStore.getTranslations();
    
    if (translations.length === 0) {
      translationSelect.innerHTML = '<option value="">No packs installed</option>';
      return;
    }
    
    translationSelect.innerHTML = translations.map(t => 
      `<option value="${t.id}">${t.name}</option>`
    ).join('');
    
    // Populate daily driver dropdowns
    populateDailyDriverDropdowns(translations);
    
    // Load daily driver or first translation
    const dailyDriver = getPrimaryDailyDriver();
    const defaultTranslation = dailyDriver && translations.find(t => t.id === dailyDriver) 
      ? dailyDriver 
      : translations[0].id;
    
    translationSelect.value = defaultTranslation;
    await refreshBookDropdown(defaultTranslation);
    
    // Initialize with Genesis 1:1
    const bookSelect = document.getElementById('book') as HTMLSelectElement;
    const firstBook = bookSelect.value || 'Genesis';
    await refreshChapterDropdown(defaultTranslation, firstBook);
    await refreshVerseDropdown(defaultTranslation, firstBook, 1);
  } catch (error) {
    translationSelect.innerHTML = '<option value="">Error loading translations</option>';
    console.error(error);
  }
}

// Refresh book dropdown based on selected translation
async function refreshBookDropdown(translation: string) {
  const bookSelect = document.getElementById('book') as HTMLSelectElement;
  
  try {
    const books = await textStore.getBooks(translation);
    
    if (books.length === 0) {
      bookSelect.innerHTML = '<option value="">No books available</option>';
      return;
    }
    
    bookSelect.innerHTML = books.map(book => 
      `<option value="${book}">${book}</option>`
    ).join('');
  } catch (error) {
    bookSelect.innerHTML = '<option value="">Error loading books</option>';
    console.error(error);
  }
}

// Refresh chapter dropdown based on selected translation and book
async function refreshChapterDropdown(translation: string, book: string) {
  const chapterSelect = document.getElementById('chapter') as HTMLSelectElement;
  
  try {
    const chapters = await textStore.getChapters(translation, book);
    
    if (chapters.length === 0) {
      chapterSelect.innerHTML = '<option value="1">1</option>';
      return;
    }
    
    chapterSelect.innerHTML = chapters.map(ch => 
      `<option value="${ch}">${ch}</option>`
    ).join('');
  } catch (error) {
    chapterSelect.innerHTML = '<option value="1">1</option>';
    console.error(error);
  }
}

// Refresh verse dropdown based on selected translation, book, and chapter
async function refreshVerseDropdown(translation: string, book: string, chapter: number) {
  const verseSelect = document.getElementById('verse') as HTMLSelectElement;
  
  try {
    const verses = await textStore.getVerses(translation, book, chapter);
    
    if (verses.length === 0) {
      verseSelect.innerHTML = '<option value="1">1</option>';
      return;
    }
    
    verseSelect.innerHTML = verses.map(v => 
      `<option value="${v}">${v}</option>`
    ).join('');
  } catch (error) {
    verseSelect.innerHTML = '<option value="1">1</option>';
    console.error(error);
  }
}

// Listen for translation changes to keep current location
document.getElementById('translation')?.addEventListener('change', async (e) => {
  const translation = (e.target as HTMLSelectElement).value;
  if (translation) {
    const bookSelect = document.getElementById('book') as HTMLSelectElement;
    const chapterSelect = document.getElementById('chapter') as HTMLSelectElement;
    const verseSelect = document.getElementById('verse') as HTMLSelectElement;
    
    // Save current location
    const currentBook = bookSelect.value;
    const currentChapter = parseInt(chapterSelect.value);
    const currentVerse = parseInt(verseSelect.value);
    
    // Refresh books for new translation
    await refreshBookDropdown(translation);
    
    // Try to restore previous location
    const books = await textStore.getBooks(translation);
    if (books.includes(currentBook)) {
      bookSelect.value = currentBook;
      await refreshChapterDropdown(translation, currentBook);
      
      // Try to restore chapter
      const chapters = await textStore.getChapters(translation, currentBook);
      if (chapters.includes(currentChapter)) {
        chapterSelect.value = currentChapter.toString();
        await refreshVerseDropdown(translation, currentBook, currentChapter);
        
        // Try to restore verse
        const verses = await textStore.getVerses(translation, currentBook, currentChapter);
        if (verses.includes(currentVerse)) {
          verseSelect.value = currentVerse.toString();
        } else {
          verseSelect.value = '1'; // Default to verse 1 if not available
        }
      } else {
        chapterSelect.value = '1'; // Default to chapter 1
        verseSelect.value = '1';
        await refreshVerseDropdown(translation, currentBook, 1);
      }
    } else {
      // Book not available, default to first book, Genesis 1:1
      if (books.length > 0) {
        bookSelect.value = books[0];
        await refreshChapterDropdown(translation, books[0]);
        await refreshVerseDropdown(translation, books[0], 1);
      }
    }
  }
});

// Listen for book changes to update chapter dropdown
document.getElementById('book')?.addEventListener('change', async (e) => {
  const bookSelect = e.target as HTMLSelectElement;
  const translationSelect = document.getElementById('translation') as HTMLSelectElement;
  const chapterSelect = document.getElementById('chapter') as HTMLSelectElement;
  const verseSelect = document.getElementById('verse') as HTMLSelectElement;
  
  const translation = translationSelect.value;
  const book = bookSelect.value;
  
  if (translation && book) {
    // Reset to chapter 1, verse 1 when book changes
    await refreshChapterDropdown(translation, book);
    chapterSelect.value = '1';
    await refreshVerseDropdown(translation, book, 1);
    verseSelect.value = '1';
  }
});

// Listen for chapter changes to update verse dropdown
document.getElementById('chapter')?.addEventListener('change', async (e) => {
  const chapterSelect = e.target as HTMLSelectElement;
  const translationSelect = document.getElementById('translation') as HTMLSelectElement;
  const bookSelect = document.getElementById('book') as HTMLSelectElement;
  const verseSelect = document.getElementById('verse') as HTMLSelectElement;
  
  const translation = translationSelect.value;
  const book = bookSelect.value;
  const chapter = parseInt(chapterSelect.value);
  
  if (translation && book && chapter) {
    // Reset to verse 1 when chapter changes
    await refreshVerseDropdown(translation, book, chapter);
    verseSelect.value = '1';
  }
});

document.getElementById('refreshPacks')?.addEventListener('click', refreshPacksList);

// Daily driver settings handlers
function populateDailyDriverDropdowns(translations: Array<{id: string, name: string}>) {
  const settings = getSettings();
  
  const ddEnglish = document.getElementById('ddEnglish') as HTMLSelectElement;
  const ddHebrew = document.getElementById('ddHebrew') as HTMLSelectElement;
  const ddGreek = document.getElementById('ddGreek') as HTMLSelectElement;
  
  // Categorize translations
  const greekIds = ['lxx', 'byz', 'tr', 'opengnt'];
  const hebrewIds = ['wlc'];
  
  // English = not Hebrew or Greek
  const englishTranslations = translations.filter(t => 
    !greekIds.includes(t.id.toLowerCase()) && !hebrewIds.includes(t.id.toLowerCase())
  );
  
  const hebrewTranslations = translations.filter(t => 
    hebrewIds.includes(t.id.toLowerCase())
  );
  
  const greekTranslations = translations.filter(t => 
    greekIds.includes(t.id.toLowerCase())
  );
  
  // Populate English (KJV, WEB, etc.)
  ddEnglish.innerHTML = '<option value="">Not set</option>' + 
    englishTranslations.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
  if (settings.dailyDriverEnglish) ddEnglish.value = settings.dailyDriverEnglish;
  
  // Populate Hebrew (WLC)
  ddHebrew.innerHTML = '<option value="">Not set</option>' + 
    hebrewTranslations.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
  if (settings.dailyDriverHebrew) ddHebrew.value = settings.dailyDriverHebrew;
  
  // Populate Greek (LXX, Byzantine, TR, OpenGNT)
  ddGreek.innerHTML = '<option value="">Not set</option>' + 
    greekTranslations.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
  if (settings.dailyDriverGreek) ddGreek.value = settings.dailyDriverGreek;
}

document.getElementById('saveSettings')?.addEventListener('click', () => {
  const ddEnglish = (document.getElementById('ddEnglish') as HTMLSelectElement).value;
  const ddHebrew = (document.getElementById('ddHebrew') as HTMLSelectElement).value;
  const ddGreek = (document.getElementById('ddGreek') as HTMLSelectElement).value;
  
  updateSettings({
    dailyDriverEnglish: ddEnglish || undefined,
    dailyDriverHebrew: ddHebrew || undefined,
    dailyDriverGreek: ddGreek || undefined
  });
  
  // Show saved confirmation
  const savedSpan = document.getElementById('settingsSaved')!;
  savedSpan.style.display = 'inline';
  setTimeout(() => { savedSpan.style.display = 'none'; }, 2000);
});

// Read verse handler
document.getElementById('readVerse')?.addEventListener('click', async () => {
  const translation = (document.getElementById('translation') as HTMLSelectElement).value;
  const book = (document.getElementById('book') as HTMLSelectElement).value;
  const chapter = parseInt((document.getElementById('chapter') as HTMLSelectElement).value);
  const verse = parseInt((document.getElementById('verse') as HTMLSelectElement).value);
  const resultDiv = document.getElementById('verseText')!;
  
  resultDiv.textContent = '⏳ Loading...';
  
  try {
    const text = await textStore.getVerse(translation, book, chapter, verse);
    
    if (text) {
      // Get cross-references for this verse
      const crossRefs = await crossRefStore.getCrossReferences({ book, chapter, verse });
      
      let html = `<strong>${book} ${chapter}:${verse}</strong><br/>${text}`;
      
      if (crossRefs.length > 0) {
        // Check which cross-references exist in current translation
        const crossRefChecks = await Promise.all(
          crossRefs.map(async ref => {
            const exists = await textStore.getVerse(translation, ref.to.book, ref.to.chapter, ref.to.verseStart);
            return { ref, exists: !!exists };
          })
        );
        
        html += `
          <div style="margin-top: 20px; padding-top: 15px; border-top: 2px solid #e0e0e0;">
            <h4 style="margin: 0 0 10px 0; color: #0066cc; font-size: 14px;">📖 Cross-References (${crossRefs.length})</h4>
            ${crossRefChecks.map(({ ref, exists }) => {
              const toRef = ref.to.verseEnd && ref.to.verseEnd !== ref.to.verseStart 
                ? `${ref.to.book} ${ref.to.chapter}:${ref.to.verseStart}-${ref.to.verseEnd}`
                : `${ref.to.book} ${ref.to.chapter}:${ref.to.verseStart}`;
              
              const dailyDriver = getDailyDriverFor(ref.to.book) || 'kjv';
              const viewAction = exists
                ? `document.getElementById('book').value='${ref.to.book}'; document.getElementById('chapter').value=${ref.to.chapter}; document.getElementById('verse').value=${ref.to.verseStart}; document.getElementById('readVerse').click();`
                : `document.getElementById('translation').value='${dailyDriver}'; document.getElementById('book').value='${ref.to.book}'; document.getElementById('chapter').value=${ref.to.chapter}; document.getElementById('verse').value=${ref.to.verseStart}; document.getElementById('readVerse').click();`;
              
              return `
                <div style="padding: 8px; margin: 5px 0; background: #f8f9fa; border-radius: 4px; font-size: 13px;">
                  <a href="#" onclick="${viewAction} return false;" 
                     style="color: #0066cc; text-decoration: none; font-weight: 500;">${toRef}</a>
                  ${!exists ? `<span style="color: #ff6b6b; font-size: 11px; margin-left: 8px;">(view in ${dailyDriver.toUpperCase()})</span>` : ''}
                  ${ref.description ? `<div style="color: #666; font-size: 12px; margin-top: 3px;">${ref.description}</div>` : ''}
                </div>
              `;
            }).join('')}
          </div>
        `;
      }
      
      resultDiv.innerHTML = html;
    } else {
      resultDiv.innerHTML = `<em style="color: #999;">Verse not found</em>`;
    }
  } catch (error) {
    resultDiv.innerHTML = `<span style="color: red;">Error: ${error instanceof Error ? error.message : 'Unknown'}</span>`;
    console.error(error);
  }
});

// Read chapter handler
document.getElementById('readChapter')?.addEventListener('click', async () => {
  const translation = (document.getElementById('translation') as HTMLSelectElement).value;
  const book = (document.getElementById('book') as HTMLSelectElement).value;
  const chapter = parseInt((document.getElementById('chapter') as HTMLSelectElement).value);
  const resultDiv = document.getElementById('verseText')!;
  
  resultDiv.textContent = '⏳ Loading...';
  
  try {
    const verses = await textStore.getChapter(translation, book, chapter);
    
    if (verses.length > 0) {
      // Get cross-references for all verses in this chapter
      const verseCrossRefs = await Promise.all(
        verses.map(v => crossRefStore.getCrossReferences({ book, chapter, verse: v.verse }))
      );
      
      resultDiv.innerHTML = `
        <h3>${book} ${chapter}</h3>
        ${verses.map((v, idx) => {
          const hasCrossRefs = verseCrossRefs[idx].length > 0;
          const verseKey = `${book}:${chapter}:${v.verse}`;
          const isSelected = selectedVerses.has(verseKey);
          
          return `
            <p class="verse-text" 
               data-book="${book}" 
               data-chapter="${chapter}" 
               data-verse="${v.verse}"
               style="margin: 8px 0; padding: 8px; border-radius: 4px; cursor: pointer; background: ${isSelected ? '#ffffcc' : 'transparent'}; transition: background 0.2s;">
              <sup style="color: #666; cursor: ${hasCrossRefs ? 'pointer' : 'default'};" 
                   ${hasCrossRefs ? `onclick="event.stopPropagation(); showCrossReferences('${book}', ${chapter}, ${v.verse}, event)" title="View ${verseCrossRefs[idx].length} cross-reference(s)"` : ''}>
                ${v.verse}${hasCrossRefs ? ' 🔗' : ''}
              </sup> 
              <span class="verse-words">${v.text}</span>
            </p>
          `;
        }).join('')}
      `;
      
      // Attach verse selection handlers
      attachVerseSelectionHandlers();
    } else {
      resultDiv.innerHTML = `<em style="color: #999;">Chapter not found</em>`;
    }
  } catch (error) {
    resultDiv.innerHTML = `<span style="color: red;">Error: ${error instanceof Error ? error.message : 'Unknown'}</span>`;
    console.error(error);
  }
});

// Cross-reference popup functions
async function showCrossReferences(book: string, chapter: number, verse: number, event: MouseEvent) {
  const modal = document.getElementById('xrefModal')!;
  const content = document.getElementById('xrefModalContent')!;
  const translation = (document.getElementById('translation') as HTMLInputElement).value;
  
  // Store mouse position first
  const mouseX = event.clientX;
  const mouseY = event.clientY;
  
  modal.style.display = 'none'; // Hide completely while loading
  
  try {
    const crossRefs = await crossRefStore.getCrossReferences({ book, chapter, verse });
    
    if (crossRefs.length === 0) {
      content.innerHTML = `
        <h3>${book} ${chapter}:${verse}</h3>
        <p style="color: #999;">No cross-references available for this verse.</p>
      `;
    } else {
      // Check which cross-references exist in current translation
      const crossRefChecks = await Promise.all(
        crossRefs.map(async ref => {
          const exists = await textStore.getVerse(translation, ref.to.book, ref.to.chapter, ref.to.verseStart);
          return { ref, exists: !!exists };
        })
      );
      
      content.innerHTML = `
        <h4 style="margin: 0 0 10px 0; padding-right: 20px; font-size: 14px;">${book} ${chapter}:${verse}</h4>
        <div style="max-height: 300px; overflow-y: auto;">
          ${crossRefChecks.map(({ ref, exists }) => {
            const toRef = ref.to.verseEnd && ref.to.verseEnd !== ref.to.verseStart 
              ? `${ref.to.book} ${ref.to.chapter}:${ref.to.verseStart}-${ref.to.verseEnd}`
              : `${ref.to.book} ${ref.to.chapter}:${ref.to.verseStart}`;
            
            const dailyDriver = getDailyDriverFor(ref.to.book) || 'kjv';
            const viewAction = exists
              ? `closeXrefModal(); document.getElementById('book').value='${ref.to.book}'; document.getElementById('chapter').value=${ref.to.chapter}; document.getElementById('verse').value=${ref.to.verseStart}; document.getElementById('readVerse').click();`
              : `closeXrefModal(); document.getElementById('translation').value='${dailyDriver}'; document.getElementById('book').value='${ref.to.book}'; document.getElementById('chapter').value=${ref.to.chapter}; document.getElementById('verse').value=${ref.to.verseStart}; document.getElementById('readVerse').click();`;
            
            return `
              <div style="padding: 10px; margin: 8px 0; background: #f8f9fa; border-radius: 4px;">
                <a href="#" onclick="${viewAction} return false;" 
                   style="color: #0066cc; text-decoration: none; font-weight: 500; font-size: 14px;">${toRef}</a>
                ${!exists ? `<span style="color: #ff6b6b; font-size: 11px; margin-left: 8px;">(view in ${dailyDriver.toUpperCase()})</span>` : ''}
                ${ref.description ? `<div style="color: #666; font-size: 13px; margin-top: 5px;">${ref.description}</div>` : ''}
              </div>
            `;
          }).join('')}
        </div>
      `;
    }
    
    // NOW position AFTER content is fully loaded
    modal.style.display = 'block';
    modal.style.visibility = 'hidden';
    
    requestAnimationFrame(() => {
      const modalRect = modal.getBoundingClientRect();
      
      console.log('FINAL modal height:', modalRect.height, 'mouseY:', mouseY);
      
      // Center horizontally, bottom edge 5px above cursor
      const left = mouseX - (modalRect.width / 2);
      const top = mouseY - modalRect.height - 5;
      
      console.log('FINAL position - left:', left, 'top:', top);
      
      modal.style.left = `${left}px`;
      modal.style.top = `${top}px`;
      modal.style.visibility = 'visible';
    });
  } catch (error) {
    content.innerHTML = `<p style="color: red;">Error loading cross-references: ${error instanceof Error ? error.message : 'Unknown'}</p>`;
  }
}

function closeXrefModal() {
  const modal = document.getElementById('xrefModal')!;
  modal.style.display = 'none';
}

// Make functions globally available for onclick handlers
(window as any).showCrossReferences = showCrossReferences;
(window as any).closeXrefModal = closeXrefModal;

// Close modal when clicking outside
document.addEventListener('click', (e) => {
  const modal = document.getElementById('xrefModal')!;
  const target = e.target as HTMLElement;
  if (modal.style.display === 'block' && !modal.contains(target) && !target.closest('sup')) {
    closeXrefModal();
  }
});

document.getElementById('closeXrefModal')?.addEventListener('click', closeXrefModal);

// Search handler
document.getElementById('searchBtn')?.addEventListener('click', performSearch);

// Allow Enter key to trigger search
document.getElementById('searchQuery')?.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    performSearch();
  }
});

async function performSearch() {
  const query = (document.getElementById('searchQuery') as HTMLInputElement).value;
  const searchAll = (document.getElementById('searchAllTranslations') as HTMLInputElement).checked;
  const statusDiv = document.getElementById('searchStatus')!;
  const resultsDiv = document.getElementById('searchResults')!;
  
  if (!query.trim()) {
    statusDiv.textContent = '❌ Please enter a search term';
    statusDiv.style.color = 'red';
    return;
  }
  
  statusDiv.textContent = '🔍 Searching...';
  statusDiv.style.color = '#666';
  resultsDiv.innerHTML = '';
  
  try {
    // Get translations to search
    let translations: string[] | undefined;
    if (!searchAll) {
      const selectedTranslation = (document.getElementById('translation') as HTMLSelectElement).value;
      if (selectedTranslation) {
        translations = [selectedTranslation];
      }
    }
    
    const startTime = Date.now();
    const results = await searchIndex.search(query, translations);
    const elapsed = Date.now() - startTime;
    
    if (results.length === 0) {
      statusDiv.textContent = `No results found for "${query}"`;
      statusDiv.style.color = '#999';
      return;
    }
    
    statusDiv.textContent = `Found ${results.length} result${results.length === 1 ? '' : 's'} in ${elapsed}ms`;
    statusDiv.style.color = 'green';
    
    // Group results by translation
    const byTranslation = new Map<string, typeof results>();
    results.forEach(r => {
      if (!byTranslation.has(r.translation)) {
        byTranslation.set(r.translation, []);
      }
      byTranslation.get(r.translation)!.push(r);
    });
    
    // Render results
    resultsDiv.innerHTML = Array.from(byTranslation.entries())
      .map(([translation, verses]) => `
        <div style="margin-bottom: 20px;">
          <h3 style="color: #0066cc; margin-bottom: 10px;">${translation}</h3>
          ${verses.map(v => `
            <div style="padding: 10px; margin: 8px 0; background: white; border-radius: 4px; border-left: 3px solid #0066cc;">
              <div style="font-weight: bold; color: #333; margin-bottom: 5px;">
                ${v.book} ${v.chapter}:${v.verse}
              </div>
              <div style="color: #666; line-height: 1.6;">
                ${highlightSearchTerms(v.snippet || v.text, query)}
              </div>
            </div>
          `).join('')}
        </div>
      `).join('');
    
  } catch (error) {
    statusDiv.textContent = `❌ Error: ${error instanceof Error ? error.message : 'Unknown'}`;
    statusDiv.style.color = 'red';
    console.error(error);
  }
}

// Highlight search terms in text
function highlightSearchTerms(text: string, query: string): string {
  const terms = query.toLowerCase().trim().split(/\s+/);
  let highlighted = text;
  
  terms.forEach(term => {
    const regex = new RegExp(`(${term})`, 'gi');
    highlighted = highlighted.replace(regex, '<mark style="background: #ffeb3b; padding: 2px;">$1</mark>');
  });
  
  return highlighted;
}

// Map layers handlers
document.getElementById('loadMapsBtn')?.addEventListener('click', loadMapLayers);
document.getElementById('closeMapBtn')?.addEventListener('click', () => {
  document.getElementById('mapViewer')!.style.display = 'none';
});

async function loadMapLayers() {
  const listDiv = document.getElementById('mapLayersList')!;
  listDiv.innerHTML = '<div>Loading...</div>';
  
  try {
    const db = await openDB();
    const tx = db.transaction('historical_layers', 'readonly');
    const store = tx.objectStore('historical_layers');
    const layers = await new Promise<any[]>((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    
    if (layers.length === 0) {
      listDiv.innerHTML = '<div style="color: #999;">No map layers installed. Import maps.sqlite first.</div>';
      return;
    }
    
    listDiv.innerHTML = `
      <div style="color: #666; margin-bottom: 10px;">✅ ${layers.length} historical layers loaded</div>
      ${layers.map(layer => `
        <div style="padding: 12px; margin: 8px 0; background: white; border-radius: 4px; border-left: 3px solid #28a745;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <div style="font-weight: bold; color: #333;">${layer.displayName || layer.name}</div>
              <div style="color: #666; font-size: 13px; margin-top: 4px;">
                Period: ${layer.period} | ${layer.yearStart} to ${layer.yearEnd}
              </div>
              ${layer.description ? `<div style="color: #888; font-size: 12px; margin-top: 4px;">${layer.description}</div>` : ''}
            </div>
            <button onclick="viewMapLayer('${layer.id}')" 
                    style="padding: 8px 16px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">
              View Map
            </button>
          </div>
        </div>
      `).join('')}
    `;
  } catch (error) {
    listDiv.innerHTML = `<div style="color: red;">❌ Error loading map layers: ${error instanceof Error ? error.message : 'Unknown'}</div>`;
    console.error(error);
  }
}

// Make viewMapLayer available globally
(window as any).viewMapLayer = async function(layerId: string) {
  try {
    const db = await openDB();
    const tx = db.transaction('historical_layers', 'readonly');
    const store = tx.objectStore('historical_layers');
    const layer = await new Promise<any>((resolve, reject) => {
      const request = store.get(layerId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    
    if (!layer) {
      alert('Layer not found');
      return;
    }
    
    const viewerDiv = document.getElementById('mapViewer')!;
    const titleDiv = document.getElementById('mapViewerTitle')!;
    const detailsDiv = document.getElementById('mapDetails')!;
    const canvasDiv = document.getElementById('mapCanvas')!;
    
    titleDiv.textContent = layer.displayName || layer.name;
    detailsDiv.innerHTML = `
      <div><strong>Period:</strong> ${layer.period}</div>
      <div><strong>Time Range:</strong> ${layer.yearStart} to ${layer.yearEnd}</div>
      <div><strong>Type:</strong> ${layer.type}</div>
      ${layer.description ? `<div><strong>Description:</strong> ${layer.description}</div>` : ''}
      ${layer.boundaries ? `<div style="margin-top: 8px;"><strong>Features:</strong> ${layer.boundaries.features?.length || 0} boundaries loaded</div>` : ''}
    `;
    
    // Simple GeoJSON feature list
    if (layer.boundaries && layer.boundaries.features) {
      canvasDiv.innerHTML = `
        <div style="width: 100%; text-align: left;">
          <div style="font-weight: bold; margin-bottom: 10px;">Map Features (${layer.boundaries.features.length}):</div>
          <div style="max-height: 400px; overflow-y: auto;">
            ${layer.boundaries.features.map((feature: any, idx: number) => `
              <div style="padding: 8px; margin: 4px 0; background: #f8f9fa; border-radius: 4px;">
                <div style="font-weight: bold;">${feature.properties?.name || `Feature ${idx + 1}`}</div>
                ${feature.properties?.description ? `<div style="font-size: 12px; color: #666;">${feature.properties.description}</div>` : ''}
                <div style="font-size: 11px; color: #999; margin-top: 4px;">
                  Type: ${feature.geometry?.type || 'Unknown'}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    } else {
      canvasDiv.textContent = 'No boundary data available for this layer';
    }
    
    viewerDiv.style.display = 'block';
    viewerDiv.scrollIntoView({ behavior: 'smooth' });
  } catch (error) {
    alert(`Error loading map: ${error instanceof Error ? error.message : 'Unknown'}`);
    console.error(error);
  }
};

// Initialize UI
refreshPacksList();
updateDatabaseStats();
document.getElementById('refreshPacks')?.addEventListener('click', () => {
  refreshPacksList();
  updateDatabaseStats();
});

// ========================================
// VERSE SELECTION AND WORD STUDY FEATURES
// ========================================

/**
 * Attach click and long-press handlers to verses
 */
function attachVerseSelectionHandlers() {
  const verseElements = document.querySelectorAll('.verse-text');
  
  verseElements.forEach(verseEl => {
    const element = verseEl as HTMLElement;
    let menuShown = false;
    
    // Click to toggle selection
    element.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      // Don't toggle if clicking on cross-ref link
      if (target.tagName === 'SUP' || target.closest('sup')) {
        return;
      }
      
      // Don't toggle if we just showed the menu
      if (menuShown) {
        menuShown = false;
        return;
      }
      
      toggleVerseSelection(element);
    });
    
    // Long press for verse actions menu
    element.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).tagName === 'SUP') return;
      
      menuShown = false;
      longPressTimer = window.setTimeout(() => {
        if (selectedVerses.size > 0) {
          showVerseActionMenu(e);
          menuShown = true;
        }
        longPressTimer = null;
      }, LONG_PRESS_DURATION);
    });
    
    element.addEventListener('mouseup', () => {
      // Only clear timer if menu hasn't been shown yet
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    });
    
    element.addEventListener('mouseleave', () => {
      // Only clear timer if menu hasn't been shown yet
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    });
    
    // Touch support
    element.addEventListener('touchstart', (e) => {
      if ((e.target as HTMLElement).tagName === 'SUP') return;
      
      menuShown = false;
      longPressTimer = window.setTimeout(() => {
        if (selectedVerses.size > 0) {
          showVerseActionMenu(e);
          menuShown = true;
        }
        longPressTimer = null;
      }, LONG_PRESS_DURATION);
    });
    
    element.addEventListener('touchend', () => {
      // Only clear timer if menu hasn't been shown yet
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    });
  });
  
  // Attach word click handlers
  attachWordClickHandlers();
}

/**
 * Make individual words clickable for word study
 */
function attachWordClickHandlers() {
  const verseWordSpans = document.querySelectorAll('.verse-words');
  
  verseWordSpans.forEach(span => {
    const text = span.textContent || '';
    const words = text.split(/\s+/);
    
    const wordElements = words.map((word, idx) => {
      if (!word.trim()) return '';
      
      const verseEl = span.closest('.verse-text') as HTMLElement;
      const book = verseEl?.dataset.book;
      const chapter = verseEl?.dataset.chapter;
      const verse = verseEl?.dataset.verse;
      
      return `<span class="word-clickable" 
                    data-word="${word}" 
                    data-word-position="${idx + 1}"
                    data-book="${book}"
                    data-chapter="${chapter}"
                    data-verse="${verse}"
                    style="cursor: pointer; padding: 2px; border-radius: 2px; transition: background 0.15s;"
                    onmouseenter="this.style.background='#f0f0f0'"
                    onmouseleave="this.style.background='transparent'">${word}</span>`;
    }).join(' ');
    
    span.innerHTML = wordElements;
  });
  
  // Attach click and long-press handlers to words
  document.querySelectorAll('.word-clickable').forEach(wordEl => {
    const element = wordEl as HTMLElement;
    let pressStartTime = 0;
    
    // Click to highlight word
    element.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleWordHighlight(element);
    });
    
    element.addEventListener('mousedown', (e) => {
      pressStartTime = Date.now();
      longPressTimer = window.setTimeout(() => {
        showWordStudy(element, e);
      }, LONG_PRESS_DURATION);
    });
    
    element.addEventListener('mouseup', () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    });
    
    element.addEventListener('mouseleave', () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    });
    
    // Touch support
    element.addEventListener('touchstart', (e) => {
      pressStartTime = Date.now();
      longPressTimer = window.setTimeout(() => {
        showWordStudy(element, e);
      }, LONG_PRESS_DURATION);
    });
    
    element.addEventListener('touchend', (e) => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      // If it was a quick tap, toggle highlight
      if (Date.now() - pressStartTime < LONG_PRESS_DURATION) {
        e.preventDefault();
        toggleWordHighlight(element);
      }
    });
  });
}

/**
 * Toggle verse selection
 */
function toggleVerseSelection(verseElement: HTMLElement) {
  const book = verseElement.dataset.book!;
  const chapter = verseElement.dataset.chapter!;
  const verse = verseElement.dataset.verse!;
  const verseKey = `${book}:${chapter}:${verse}`;
  
  if (selectedVerses.has(verseKey)) {
    selectedVerses.delete(verseKey);
    verseElement.style.background = 'transparent';
  } else {
    selectedVerses.add(verseKey);
    verseElement.style.background = '#ffffcc';
  }
}

/**
 * Toggle word highlight
 */
function toggleWordHighlight(wordElement: HTMLElement) {
  const book = wordElement.dataset.book!;
  const chapter = wordElement.dataset.chapter!;
  const verse = wordElement.dataset.verse!;
  const position = wordElement.dataset.wordPosition!;
  const wordKey = `${book}:${chapter}:${verse}:${position}`;
  
  if (selectedWords.has(wordKey)) {
    selectedWords.delete(wordKey);
    wordElement.style.background = 'transparent';
  } else {
    selectedWords.add(wordKey);
    wordElement.style.background = '#b3e5fc';
  }
}

/**
 * Show verse action menu
 */
function showVerseActionMenu(event: MouseEvent | TouchEvent) {
  const modal = document.getElementById('verseActionModal')!;
  const mouseX = 'clientX' in event ? event.clientX : event.touches[0].clientX;
  const mouseY = 'clientY' in event ? event.clientY : event.touches[0].clientY;
  
  modal.style.display = 'block';
  modal.style.left = `${mouseX}px`;
  modal.style.top = `${mouseY}px`;
  modal.style.visibility = 'visible';
  
  // Prevent immediate close from click handler
  event.stopPropagation();
  event.preventDefault();
}

/**
 * Show word study popup
 */
async function showWordStudy(wordElement: HTMLElement, event: MouseEvent | TouchEvent) {
  const modal = document.getElementById('wordStudyModal')!;
  const content = document.getElementById('wordStudyContent')!;
  
  const word = wordElement.dataset.word!;
  const book = wordElement.dataset.book!;
  const chapter = parseInt(wordElement.dataset.chapter!);
  const verse = parseInt(wordElement.dataset.verse!);
  const wordPosition = parseInt(wordElement.dataset.wordPosition!);
  
  const mouseX = 'clientX' in event ? event.clientX : event.touches[0].clientX;
  const mouseY = 'clientY' in event ? event.clientY : event.touches[0].clientY;
  
  content.innerHTML = '⏳ Loading word study...';
  modal.style.display = 'block';
  modal.style.left = `${mouseX - 100}px`;
  modal.style.top = `${mouseY + 10}px`;
  
  try {
    // Query morphology data from IndexedDB
    const db = await openDB();
    const tx = db.transaction(['morphology', 'strongs_entries', 'places', 'place_name_links'], 'readonly');
    
    // Get morphology for this specific word
    const morphIndex = tx.objectStore('morphology').index('book_chapter_verse_word');
    const morphData = await new Promise<any>((resolve) => {
      const request = morphIndex.get([book, chapter, verse, wordPosition]);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
    
    let html = `
      <h3 style="margin: 0 0 15px 0; color: #333;">Word Study: ${word}</h3>
      <div style="margin-bottom: 15px; padding: 10px; background: #f5f5f5; border-radius: 4px;">
        <strong>${book} ${chapter}:${verse}</strong>, word #${wordPosition}
      </div>
    `;
    
    if (morphData) {
      // Parse morphology data
      const parsing = typeof morphData.parsing === 'string' ? JSON.parse(morphData.parsing) : morphData.parsing;
      
      html += `
        <div style="margin: 15px 0;">
          <h4 style="margin: 10px 0 5px 0; color: #555;">Morphology</h4>
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr><td style="padding: 5px; font-weight: 500;">Lemma:</td><td style="padding: 5px;">${morphData.lemma || 'N/A'}</td></tr>
            ${morphData.strongsId ? `<tr><td style="padding: 5px; font-weight: 500;">Strong's:</td><td style="padding: 5px;">${morphData.strongsId}</td></tr>` : ''}
            <tr><td style="padding: 5px; font-weight: 500;">Language:</td><td style="padding: 5px;">${morphData.language}</td></tr>
            ${morphData.gloss ? `<tr><td style="padding: 5px; font-weight: 500;">Gloss:</td><td style="padding: 5px;">${morphData.gloss}</td></tr>` : ''}
          </table>
        </div>
      `;
      
      // Show parsing details if available
      if (parsing && Object.keys(parsing).length > 0) {
        html += `
          <div style="margin: 15px 0;">
            <h4 style="margin: 10px 0 5px 0; color: #555;">Parsing</h4>
            <div style="display: flex; flex-wrap: wrap; gap: 8px;">
              ${Object.entries(parsing).map(([key, value]) => `
                <span style="background: #e3f2fd; padding: 4px 8px; border-radius: 4px; font-size: 13px;">
                  <strong>${key}:</strong> ${value}
                </span>
              `).join('')}
            </div>
          </div>
        `;
      }
      
      // Get Strong's definition if available
      if (morphData.strongsId) {
        const strongsData = await new Promise<any>((resolve) => {
          const request = tx.objectStore('strongs_entries').get(morphData.strongsId);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve(null);
        });
        
        if (strongsData) {
          html += `
            <div style="margin: 15px 0; padding: 12px; background: #fff3e0; border-left: 3px solid #ff9800; border-radius: 4px;">
              <h4 style="margin: 0 0 8px 0; color: #e65100;">Strong's Definition</h4>
              <p style="margin: 5px 0;"><strong>${strongsData.lemma}</strong> ${strongsData.transliteration ? `(${strongsData.transliteration})` : ''}</p>
              <p style="margin: 5px 0; color: #555;">${strongsData.shortDefinition || strongsData.definition}</p>
              ${strongsData.kjvUsage ? `<p style="margin: 5px 0; font-size: 13px; color: #666;"><em>KJV: ${strongsData.kjvUsage}</em></p>` : ''}
            </div>
          `;
        }
      }
      
      // Check if this word is a place name
      const placeLinks = await new Promise<any[]>((resolve) => {
        const normalizedWord = word.toLowerCase().replace(/[.,;:!?'"]/g, '');
        const request = tx.objectStore('place_name_links').index('normalizedWord').getAll(normalizedWord);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve([]);
      });
      
      if (placeLinks.length > 0) {
        const placeId = placeLinks[0].placeId;
        const placeData = await new Promise<any>((resolve) => {
          const request = tx.objectStore('places').get(placeId);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve(null);
        });
        
        if (placeData) {
          html += `
            <div style="margin: 15px 0; padding: 12px; background: #e8f5e9; border-left: 3px solid #4caf50; border-radius: 4px;">
              <h4 style="margin: 0 0 8px 0; color: #2e7d32;">📍 Place: ${placeData.name}</h4>
              ${placeData.altNames ? `<p style="margin: 5px 0; font-size: 13px; color: #666;">Also known as: ${JSON.parse(placeData.altNames).join(', ')}</p>` : ''}
              ${placeData.latitude && placeData.longitude ? `<p style="margin: 5px 0; font-size: 13px;">📌 ${placeData.latitude.toFixed(4)}, ${placeData.longitude.toFixed(4)}</p>` : ''}
              ${placeData.modernCity ? `<p style="margin: 5px 0; font-size: 13px;">Modern: ${placeData.modernCity}${placeData.modernCountry ? ', ' + placeData.modernCountry : ''}</p>` : ''}
              ${placeData.significance ? `<p style="margin: 8px 0; color: #555;">${placeData.significance}</p>` : ''}
              <button onclick="viewPlaceOnMap('${placeId}')" style="margin-top: 8px; padding: 6px 12px; background: #4caf50; color: white; border: none; border-radius: 4px; cursor: pointer;">
                🗺️ View on Map
              </button>
            </div>
          `;
        }
      }
    } else {
      html += `
        <div style="padding: 20px; text-align: center; color: #999;">
          <p>No morphology data available for this word.</p>
          <p style="font-size: 13px; margin-top: 10px;">Morphology data may not be available for translations or specific texts.</p>
        </div>
      `;
    }
    
    db.close();
    content.innerHTML = html;
    
  } catch (error) {
    content.innerHTML = `<p style="color: red;">Error loading word study: ${error instanceof Error ? error.message : 'Unknown'}</p>`;
    console.error(error);
  }
}

/**
 * Verse action handlers
 */
function createNoteForSelected() {
  const verses = Array.from(selectedVerses);
  alert(`Creating note for ${verses.length} verse(s):\n${verses.join('\n')}\n\n(Note creation UI to be implemented)`);
  closeVerseActionModal();
}

function highlightSelected() {
  alert(`Highlighting ${selectedVerses.size} verse(s) in yellow\n\n(Highlight persistence to be implemented)`);
  closeVerseActionModal();
}

function underlineSelected() {
  selectedVerses.forEach(verseKey => {
    const [book, chapter, verse] = verseKey.split(':');
    const verseEl = document.querySelector(`[data-book="${book}"][data-chapter="${chapter}"][data-verse="${verse}"]`);
    if (verseEl) {
      const wordsSpan = verseEl.querySelector('.verse-words') as HTMLElement;
      if (wordsSpan) {
        wordsSpan.style.textDecoration = 'underline';
      }
    }
  });
  closeVerseActionModal();
}

function italicizeSelected() {
  selectedVerses.forEach(verseKey => {
    const [book, chapter, verse] = verseKey.split(':');
    const verseEl = document.querySelector(`[data-book="${book}"][data-chapter="${chapter}"][data-verse="${verse}"]`);
    if (verseEl) {
      const wordsSpan = verseEl.querySelector('.verse-words') as HTMLElement;
      if (wordsSpan) {
        wordsSpan.style.fontStyle = 'italic';
      }
    }
  });
  closeVerseActionModal();
}

function clearSelection() {
  selectedVerses.forEach(verseKey => {
    const [book, chapter, verse] = verseKey.split(':');
    const verseEl = document.querySelector(`[data-book="${book}"][data-chapter="${chapter}"][data-verse="${verse}"]`);
    if (verseEl) {
      (verseEl as HTMLElement).style.background = 'transparent';
    }
  });
  selectedVerses.clear();
  closeVerseActionModal();
}

function closeVerseActionModal() {
  const modal = document.getElementById('verseActionModal')!;
  modal.style.display = 'none';
}

function closeWordStudyModal() {
  const modal = document.getElementById('wordStudyModal')!;
  modal.style.display = 'none';
}

function viewPlaceOnMap(placeId: string) {
  alert(`Opening map view for place: ${placeId}\n\n(Map viewer to be implemented)`);
}

// Make functions globally available
(window as any).createNoteForSelected = createNoteForSelected;
(window as any).highlightSelected = highlightSelected;
(window as any).underlineSelected = underlineSelected;
(window as any).italicizeSelected = italicizeSelected;
(window as any).clearSelection = clearSelection;
(window as any).viewPlaceOnMap = viewPlaceOnMap;

// Close modals on click
document.getElementById('closeVerseActionModal')?.addEventListener('click', closeVerseActionModal);
document.getElementById('closeWordStudyModal')?.addEventListener('click', closeWordStudyModal);

// Close modals when clicking outside
document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  
  const verseActionModal = document.getElementById('verseActionModal')!;
  if (verseActionModal.style.display === 'block' && !verseActionModal.contains(target) && !target.classList.contains('verse-text') && !target.closest('.verse-text')) {
    closeVerseActionModal();
  }
  
  const wordStudyModal = document.getElementById('wordStudyModal')!;
  if (wordStudyModal.style.display === 'block' && !wordStudyModal.contains(target) && !target.classList.contains('word-clickable')) {
    closeWordStudyModal();
  }
});
