import { IndexedDBTextStore, IndexedDBPackManager, IndexedDBSearchIndex, IndexedDBCrossReferenceStore, importPackFromSQLite, getSettings, updateSettings, getDailyDriverFor, getPrimaryDailyDriver, type UserSettings, openDB } from './adapters/index.js';
import { clearAllData, clearPacksOnly, getDatabaseStats, removePack } from './adapters/db-manager.js';
import L from 'leaflet';

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
const LONG_PRESS_DURATION = 900; // 0.9 seconds

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
          English (OT):
          <select id="ddEnglishOT" style="margin-left: 10px; padding: 4px;">
            <option value="">Not set</option>
          </select>
        </label>
        <label style="display: block; margin: 10px 0;">
          English (NT):
          <select id="ddEnglishNT" style="margin-left: 10px; padding: 4px;">
            <option value="">Not set</option>
          </select>
        </label>
        <label style="display: block; margin: 10px 0;">
          Hebrew (OT):
          <select id="ddHebrewOT" style="margin-left: 10px; padding: 4px;">
            <option value="">Not set</option>
          </select>
        </label>
        <label style="display: block; margin: 10px 0;">
          Hebrew (NT):
          <select id="ddHebrewNT" style="margin-left: 10px; padding: 4px;">
            <option value="">Not set</option>
          </select>
        </label>
        <label style="display: block; margin: 10px 0;">
          Greek (OT):
          <select id="ddGreekOT" style="margin-left: 10px; padding: 4px;">
            <option value="">Not set</option>
          </select>
        </label>
        <label style="display: block; margin: 10px 0;">
          Greek (NT):
          <select id="ddGreekNT" style="margin-left: 10px; padding: 4px;">
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
  <div id="wordStudyModal" style="display: none; position: fixed; background: white; padding: 10px; border-radius: 8px; max-width: 360px; max-height: min(52vh, 420px); overflow-y: auto; box-shadow: 0 4px 16px rgba(0,0,0,0.3); z-index: 1002; border: 1px solid #ddd; font-size: 12.5px; line-height: 1.22;">
    <button id="closeWordStudyModal" style="position: absolute; top: 6px; right: 6px; background: #f0f0f0; border: none; border-radius: 50%; width: 24px; height: 24px; cursor: pointer; font-size: 16px; line-height: 1;">&times;</button>
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
  
  statusDiv.innerHTML = `⏳ Downloading from ${url}...<br><div id="downloadProgress" style="margin-top: 5px;"></div>`;
  statusDiv.style.color = '#666';
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const contentLength = response.headers.get('content-length');
    const total = contentLength ? parseInt(contentLength, 10) : 0;
    
    // Download with progress tracking
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }
    
    const chunks: Uint8Array[] = [];
    let receivedLength = 0;
    const progressDiv = document.getElementById('downloadProgress');
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      chunks.push(value);
      receivedLength += value.length;
      
      // Update progress
      if (progressDiv) {
        const percent = total > 0 ? Math.round((receivedLength / total) * 100) : 0;
        const mb = (receivedLength / 1024 / 1024).toFixed(2);
        const totalMb = total > 0 ? (total / 1024 / 1024).toFixed(2) : '?';
        
        progressDiv.innerHTML = `
          <div style="background: #e0e0e0; height: 20px; border-radius: 4px; overflow: hidden;">
            <div style="background: #4caf50; height: 100%; width: ${percent}%; transition: width 0.3s;"></div>
          </div>
          <div style="margin-top: 5px; font-size: 12px;">${mb} MB / ${totalMb} MB (${percent}%)</div>
        `;
      }
    }
    
    // Combine chunks into blob
    const blob = new Blob(chunks);
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

// Keep popups inside the viewport, regardless of where they are opened.
installViewportClampedPopup('wordStudyModal', { preferBelow: 'auto' as any });
installViewportClampedPopup('xrefModal', { preferBelow: 'auto' as any });
installViewportClampedPopup('verseActionModal', { preferBelow: 'auto' as any });

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
      <div style="padding: 10px; margin: 5px 0; background: white; border-radius: 4px; display: flex; justify-content: space-between; align-items: center;">
        <div>
          <strong>${pack.translationName || pack.id}</strong> (${pack.translationId || 'N/A'})<br/>
          <small style="color: #666;">
            Version: ${pack.version} | 
            Type: ${pack.type} | 
            Size: ${(pack.size! / 1024).toFixed(1)} KB
          </small>
        </div>
        <button class="delete-pack-btn" data-pack-id="${pack.id}" style="padding: 6px 12px; background: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">Delete</button>
      </div>
    `).join('');
    
    // Add event listeners to delete buttons
    const deleteButtons = packsDiv.querySelectorAll('.delete-pack-btn');
    deleteButtons.forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const packId = (e.target as HTMLElement).getAttribute('data-pack-id')!;
        const packName = packs.find(p => p.id === packId)?.translationName || packId;
        
        if (confirm(`Are you sure you want to delete "${packName}"? This will remove all its data.`)) {
          try {
            await removePack(packId);
            await refreshPacksList();
            await updateDatabaseStats();
          } catch (error) {
            alert(`Error deleting pack: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }
      });
    });
    
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

    translationNameById.clear();
    for (const t of translations) translationNameById.set((t.id || '').toLowerCase(), t.name || '');
    
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

const translationNameById = new Map<string, string>();

function isGreekTranslationId(translationId: string): boolean {
  const id = (translationId || '').toLowerCase();
  const name = (translationNameById.get(id) || '').toLowerCase();

  const looksEnglish = name.includes('english') || name.includes('brenton') || id.includes('english');

  // Strong signals for Greek source texts
  if (id === 'byz' || id === 'tr') return true;
  if (id.includes('opengnt') || id.includes('gnt') || id.includes('sblgnt')) return true;
  if (id.includes('greek')) return true;
  if (name.includes('greek') || name.includes('gnt')) return true;

  // LXX / Septuagint: Greek by default, but keep clearly-English versions in English.
  const isLxxLike = id.includes('lxx') || name.includes('lxx') || name.includes('septuagint');
  if (isLxxLike) return !looksEnglish;

  return false;
}

// Daily driver settings handlers
function populateDailyDriverDropdowns(translations: Array<{id: string, name: string}>) {
  const settings = getSettings();
  
  const ddEnglishOT = document.getElementById('ddEnglishOT') as HTMLSelectElement;
  const ddEnglishNT = document.getElementById('ddEnglishNT') as HTMLSelectElement;
  const ddHebrewOT = document.getElementById('ddHebrewOT') as HTMLSelectElement;
  const ddHebrewNT = document.getElementById('ddHebrewNT') as HTMLSelectElement;
  const ddGreekOT = document.getElementById('ddGreekOT') as HTMLSelectElement;
  const ddGreekNT = document.getElementById('ddGreekNT') as HTMLSelectElement;
  
  // Categorize translations
  const isGreek = (t: { id: string; name: string }) => {
    const id = (t.id || '').toLowerCase();
    const name = (t.name || '').toLowerCase();

    const looksEnglish = name.includes('english') || name.includes('brenton') || id.includes('english');

    // Strong signals for Greek source texts
    if (id === 'byz' || id === 'tr') return true;
    if (id.includes('opengnt') || id.includes('gnt') || id.includes('sblgnt')) return true;
    if (id.includes('greek')) return true;
    if (name.includes('greek') || name.includes('gnt')) return true;

    // LXX / Septuagint:
    // - Treat as Greek by default (source text)
    // - BUT if it's clearly an English translation (e.g., "LXX 2012 (Brenton English)"), keep it in English.
    const isLxxLike = id.includes('lxx') || name.includes('lxx') || name.includes('septuagint');
    if (isLxxLike) {
      if (looksEnglish) return false;
      return true;
    }

    return false;
  };
  const isHebrew = (t: { id: string; name: string }) => {
    const id = (t.id || '').toLowerCase();
    const name = (t.name || '').toLowerCase();
    return id === 'wlc' || id.includes('hebrew') || name.includes('hebrew') || name.includes('wlc') || name.includes('leningrad');
  };
  const isEnglish = (t: { id: string; name: string }) => !isGreek(t) && !isHebrew(t);

  const englishTranslations = translations.filter(isEnglish);
  const hebrewTranslations = translations.filter(isHebrew);
  const greekTranslations = translations.filter(isGreek);

  const optionHtml = (items: Array<{id: string, name: string}>) =>
    '<option value="">Not set</option>' + items.map(t => `<option value="${t.id}">${t.name}</option>`).join('');

  // Populate English OT/NT
  ddEnglishOT.innerHTML = optionHtml(englishTranslations);
  ddEnglishNT.innerHTML = optionHtml(englishTranslations);
  if (settings.dailyDriverEnglishOT) ddEnglishOT.value = settings.dailyDriverEnglishOT;
  if (settings.dailyDriverEnglishNT) ddEnglishNT.value = settings.dailyDriverEnglishNT;

  // Populate Hebrew OT/NT
  ddHebrewOT.innerHTML = optionHtml(hebrewTranslations);
  ddHebrewNT.innerHTML = optionHtml(hebrewTranslations);
  if (settings.dailyDriverHebrewOT) ddHebrewOT.value = settings.dailyDriverHebrewOT;
  if (settings.dailyDriverHebrewNT) ddHebrewNT.value = settings.dailyDriverHebrewNT;

  // Populate Greek OT/NT
  ddGreekOT.innerHTML = optionHtml(greekTranslations);
  ddGreekNT.innerHTML = optionHtml(greekTranslations);
  if (settings.dailyDriverGreekOT) ddGreekOT.value = settings.dailyDriverGreekOT;
  if (settings.dailyDriverGreekNT) ddGreekNT.value = settings.dailyDriverGreekNT;
}

document.getElementById('saveSettings')?.addEventListener('click', () => {
  const ddEnglishOT = (document.getElementById('ddEnglishOT') as HTMLSelectElement).value;
  const ddEnglishNT = (document.getElementById('ddEnglishNT') as HTMLSelectElement).value;
  const ddHebrewOT = (document.getElementById('ddHebrewOT') as HTMLSelectElement).value;
  const ddHebrewNT = (document.getElementById('ddHebrewNT') as HTMLSelectElement).value;
  const ddGreekOT = (document.getElementById('ddGreekOT') as HTMLSelectElement).value;
  const ddGreekNT = (document.getElementById('ddGreekNT') as HTMLSelectElement).value;
  
  updateSettings({
    dailyDriverEnglishOT: ddEnglishOT || undefined,
    dailyDriverEnglishNT: ddEnglishNT || undefined,
    dailyDriverHebrewOT: ddHebrewOT || undefined,
    dailyDriverHebrewNT: ddHebrewNT || undefined,
    dailyDriverGreekOT: ddGreekOT || undefined,
    dailyDriverGreekNT: ddGreekNT || undefined
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
      
      const headingClass = getHeadingFontClass(translation);
      const headingClasses = ['reader-title', headingClass].filter(Boolean).join(' ');
      let html = `<strong class="${headingClasses}">${book} ${chapter}:${verse}</strong><br/>${renderVerseWordsHtml(text)}`;
      
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
      
      resultDiv.innerHTML = renderBackButtonHtml() + html;
      setCurrentReadingLocation({ translation, book, chapter, verse, mode: 'verse' });
    } else {
      resultDiv.innerHTML = `<em style="color: #999;">Verse not found</em>`;
    }
  } catch (error) {
    resultDiv.innerHTML = `<span style="color: red;">Error: ${error instanceof Error ? error.message : 'Unknown'}</span>`;
    console.error(error);
  }
});

type ReadingMode = 'verse' | 'chapter';
type ReadingLocation = {
  translation: string;
  book: string;
  chapter: number;
  verse: number;
  mode: ReadingMode;
};

let currentReadingLocation: ReadingLocation | null = null;
const readingBackStack: ReadingLocation[] = [];

function setCurrentReadingLocation(loc: ReadingLocation) {
  currentReadingLocation = loc;
}

function renderBackButtonHtml(): string {
  if (readingBackStack.length === 0) return '';
  return `
    <div style="margin: 0 0 10px 0;">
      <button onclick="goBackToPreviousReading(); return false;" style="padding: 6px 10px; border: 1px solid #ddd; border-radius: 6px; background: white; cursor: pointer; font-size: 13px;">← Back</button>
    </div>
  `;
}

async function navigateToLocation(loc: ReadingLocation) {
  const translationSelect = document.getElementById('translation') as HTMLSelectElement;
  const bookSelect = document.getElementById('book') as HTMLSelectElement;
  const chapterSelect = document.getElementById('chapter') as HTMLSelectElement;
  const verseSelect = document.getElementById('verse') as HTMLSelectElement;

  translationSelect.value = loc.translation;
  await refreshBookDropdown(loc.translation);
  bookSelect.value = loc.book;
  await refreshChapterDropdown(loc.translation, loc.book);
  chapterSelect.value = String(loc.chapter);
  await refreshVerseDropdown(loc.translation, loc.book, loc.chapter);
  verseSelect.value = String(loc.verse);

  if (loc.mode === 'chapter') {
    (document.getElementById('readChapter') as HTMLButtonElement).click();
  } else {
    (document.getElementById('readVerse') as HTMLButtonElement).click();
  }
}

function goBackToPreviousReading() {
  const prev = readingBackStack.pop();
  if (!prev) return;
  void navigateToLocation(prev);
}

// Needed because renderBackButtonHtml uses inline onclick.
(window as any).goBackToPreviousReading = goBackToPreviousReading;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cleanPopupText(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  let s = String(raw);
  // Remove control chars / stray BOM / embedded NULs.
  s = s.replace(/[\u0000\uFEFF]/g, '');
  // Some glosses appear with leading tortoise-shell brackets like "〔Tamar".
  s = s.replace(/^[\s\u3014\u3010\[\]]+/g, '');
  return s.trim();
}

function stripHtmlTags(text: string): string {
  // Some packs include inline markup like <b>...</b>. For popup verse previews,
  // we prefer plain text.
  return (text ?? '').replace(/<[^>]*>/g, '');
}

function positionFixedPopupWithinViewport(
  modal: HTMLElement,
  anchorRect: DOMRect,
  opts?: { padding?: number; gap?: number; preferBelow?: boolean | 'auto' }
) {
  const padding = opts?.padding ?? 8;
  const gap = opts?.gap ?? 6;
  const preferBelow = opts?.preferBelow === 'auto'
    ? (anchorRect.top < window.innerHeight / 2)
    : (opts?.preferBelow ?? true);

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const modalRect = modal.getBoundingClientRect();

  const spaceAbove = anchorRect.top - padding;
  const spaceBelow = vh - anchorRect.bottom - padding;

  // Decide vertical placement (below/above) and then clamp.
  const belowTop = anchorRect.bottom + gap;
  const aboveTop = anchorRect.top - modalRect.height - gap;

  let idealTop: number;
  if (preferBelow) {
    if (spaceBelow >= modalRect.height + gap) idealTop = belowTop;
    else if (spaceAbove >= modalRect.height + gap) idealTop = aboveTop;
    else idealTop = spaceBelow >= spaceAbove ? belowTop : aboveTop;
  } else {
    if (spaceAbove >= modalRect.height + gap) idealTop = aboveTop;
    else if (spaceBelow >= modalRect.height + gap) idealTop = belowTop;
    else idealTop = spaceAbove >= spaceBelow ? aboveTop : belowTop;
  }

  // Horizontal placement: try align left edge to anchor, but keep inside viewport.
  const idealLeft = anchorRect.left;

  const maxLeft = Math.max(padding, vw - modalRect.width - padding);
  const maxTop = Math.max(padding, vh - modalRect.height - padding);

  const left = Math.min(Math.max(padding, idealLeft), maxLeft);
  const top = Math.min(Math.max(padding, idealTop), maxTop);

  modal.style.left = `${left}px`;
  modal.style.top = `${top}px`;
}

let lastPopupAnchorRect: DOMRect = new DOMRect(Math.round(window.innerWidth / 2), Math.round(window.innerHeight / 2), 0, 0);

// Long-press on touch/mouse often produces a synthetic click on release.
// Suppress it to prevent immediately closing newly opened popups.
let suppressNextGlobalClickUntil = 0;

function recordLastPopupAnchorFromEvent(e: Event) {
  const anyEvt = e as any;
  const x = typeof anyEvt.clientX === 'number' ? anyEvt.clientX : (anyEvt.touches?.[0]?.clientX ?? lastPopupAnchorRect.left);
  const y = typeof anyEvt.clientY === 'number' ? anyEvt.clientY : (anyEvt.touches?.[0]?.clientY ?? lastPopupAnchorRect.top);

  // Prefer the actual interaction point (especially important for long-press on a whole verse line).
  if (Number.isFinite(x) && Number.isFinite(y)) {
    lastPopupAnchorRect = new DOMRect(x, y, 0, 0);
    return;
  }

  // Fallback: element bounds.
  const target = (e.target as HTMLElement | null);
  if (target && typeof target.getBoundingClientRect === 'function') {
    lastPopupAnchorRect = target.getBoundingClientRect();
  }
}

// Track where the user last interacted so popups can self-correct even if
// another code path positions them off-screen.
document.addEventListener('pointerdown', recordLastPopupAnchorFromEvent, true);
document.addEventListener('mousedown', recordLastPopupAnchorFromEvent, true);
document.addEventListener('touchstart', recordLastPopupAnchorFromEvent, { capture: true, passive: true });

// Capture-phase suppression so it runs before any click-to-close handlers.
document.addEventListener('click', (e) => {
  if (suppressNextGlobalClickUntil && Date.now() < suppressNextGlobalClickUntil) {
    suppressNextGlobalClickUntil = 0;
    e.preventDefault();
    e.stopPropagation();
    (e as any).stopImmediatePropagation?.();
  }
}, true);

function installViewportClampedPopup(modalId: string, opts?: { preferBelow?: boolean }) {
  const modal = document.getElementById(modalId);
  if (!modal) return;

  let scheduled = false;
  let isRepositioning = false;

  const schedule = () => {
    if (scheduled || isRepositioning) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      if (isRepositioning) return;
      const display = window.getComputedStyle(modal).display;
      if (display === 'none') return;

      isRepositioning = true;
      const prevVis = (modal as HTMLElement).style.visibility;
      (modal as HTMLElement).style.visibility = 'hidden';
      positionFixedPopupWithinViewport(modal as HTMLElement, lastPopupAnchorRect, { preferBelow: (opts?.preferBelow ?? 'auto') as any });
      (modal as HTMLElement).style.visibility = prevVis || 'visible';
      queueMicrotask(() => {
        isRepositioning = false;
      });
    });
  };

  // Re-clamp whenever someone shows/moves the popup.
  const obs = new MutationObserver(schedule);
  obs.observe(modal, { attributes: true, attributeFilter: ['style', 'class'] });

  // Also clamp on viewport changes.
  window.addEventListener('resize', schedule);
  window.addEventListener('scroll', schedule, { passive: true });
}

function applyCinzelToItIsWrittenQuote(html: string, quoteClass: 'ot-quote' | 'ot-quote-greek' = 'ot-quote'): string {
  // Lightweight heuristic: in NT text, OT quotations are often introduced with
  // "as it is written" / "for it is written" / "it is written".
  // We apply Cinzel only to the quoted portion (everything after the intro).
  if (!html) return html;
  if (html.includes('class="ot-quote"') || html.includes('class="ot-quote-greek"')) return html;

  const lower = html.toLowerCase();
  const patterns = ['as it is written', 'for it is written', 'it is written'];
  let idx = -1;
  let len = 0;
  for (const p of patterns) {
    const at = lower.indexOf(p);
    if (at !== -1 && (idx === -1 || at < idx)) {
      idx = at;
      len = p.length;
    }
  }
  if (idx === -1) return html;

  let start = idx + len;
  while (start < html.length && /[\s,;:\)\]\u2014\u2013-]/.test(html[start])) start++;
  if (start >= html.length) return html;

  return html.slice(0, start) + `<span class="${quoteClass}">` + html.slice(start) + `</span>`;
}

function renderVerseWordsHtml(text: string): string {
  const cleaned = stripHtmlTags(text);
  const { html: baseHtml } = renderTextWithInlineNotes(cleaned);
  const translationSelect = document.getElementById('translation') as HTMLSelectElement | null;
  const translation = (translationSelect?.value || '').toLowerCase();

  const isGreek = isGreekTranslationId(translation);
  const html = applyCinzelToItIsWrittenQuote(baseHtml, isGreek ? 'ot-quote-greek' : 'ot-quote');

  let extraClass = '';
  if (translation === 'web') extraClass = ' translation-font-web';
  if (translation === 'kjv' || translation === 'kjvpce') extraClass = ' translation-font-kjv';
  if (!extraClass && isGreek) extraClass = ' translation-font-greek';
  return `<span class="verse-words${extraClass}" data-translation="${escapeHtml(translation)}">${html}</span>`;
}

function getHeadingFontClass(translationId: string): string {
  const t = (translationId || '').toLowerCase();
  if (t === 'kjv' || t === 'kjvpce') return 'heading-font-kjv';
  if (t === 'web') return 'heading-font-web';
  if (isGreekTranslationId(t)) return 'heading-font-greek';
  return '';
}

function renderTextWithInlineNotes(text: string): { html: string; noteCount: number } {
  // Converts inline notes like "+ 53:1 John 12:38; Rom 10:16" into clickable superscripts.
  // Heuristics:
  // - Notes that end with ". " followed by lowercase are treated as footnotes.
  // - Notes that contain at least one ref token like "12:38" end before the next lowercase word.
  const source = text ?? '';
  let out = '';
  let i = 0;
  let noteIndex = 0;

  const isPlusStart = (idx: number) => {
    const ch = source[idx];
    if (ch !== '+') return false;
    const prev = idx > 0 ? source[idx - 1] : ' ';
    return prev === ' ' || prev === '\n' || prev === '\t';
  };

  while (i < source.length) {
    const plusPos = source.indexOf('+', i);
    if (plusPos === -1) {
      out += escapeHtml(source.slice(i));
      break;
    }

    if (!isPlusStart(plusPos)) {
      out += escapeHtml(source.slice(i, plusPos + 1));
      i = plusPos + 1;
      continue;
    }

    // Emit text before note
    out += escapeHtml(source.slice(i, plusPos));

    // Parse note
    let j = plusPos + 1;
    while (j < source.length && /\s/.test(source[j])) j++;

    // Optional leading chapter:verse marker (e.g. 53:1)
    const markerMatch = source.slice(j).match(/^(\d+):(\d+)\s*/);
    if (markerMatch) {
      j += markerMatch[0].length;
    }

    const noteStart = j;
    let hasRefToken = false;
    let noteEnd = source.length;

    for (let k = j; k < source.length; k++) {
      // Track if we see a likely bible ref token like 12:38
      if (!hasRefToken && /\b\d+:\d+\b/.test(source.slice(j, k + 1))) {
        hasRefToken = true;
      }

      // Footnote-like: end at period if next starts a lowercase continuation
      if (source[k] === '.' && k + 2 < source.length && source[k + 1] === ' ' && /[a-z]/.test(source[k + 2])) {
        // Avoid treating common abbreviations (e.g. "Gr.") as footnote terminators
        const tokenStart = Math.max(
          source.lastIndexOf(' ', k - 1) + 1,
          source.lastIndexOf('\n', k - 1) + 1,
          source.lastIndexOf('\t', k - 1) + 1
        );
        const token = source.slice(tokenStart, k).trim();
        const abbrev = token.replace(/[^A-Za-z]/g, '');
        const nonTerminalAbbrevs = new Set(['Gr', 'Gk', 'Heb', 'Aram', 'Lat', 'Syr', 'LXX', 'Vg']);
        if (nonTerminalAbbrevs.has(abbrev)) {
          continue;
        }

        noteEnd = k + 1; // include '.'
        break;
      }

      // Cross-ref-like: end before next lowercase word if we've already seen ref tokens
      if (hasRefToken && source[k] === ' ' && k + 1 < source.length && /[a-z]/.test(source[k + 1])) {
        noteEnd = k;
        break;
      }

      // Stop if another inline note begins
      if (k > j && source[k] === '+' && (source[k - 1] === ' ' || source[k - 1] === '\n' || source[k - 1] === '\t')) {
        noteEnd = k;
        break;
      }
    }

    const rawNote = source.slice(noteStart, noteEnd).trim();
    if (rawNote.length > 0) {
      noteIndex++;
      const encoded = encodeURIComponent(rawNote);
      const title = rawNote.length > 80 ? rawNote.slice(0, 77) + '…' : rawNote;
      const encodedTitle = escapeHtml(title);
      out += `<sup class="inline-note" data-note="${encoded}" data-note-index="${noteIndex}" ` +
        `style="color:#0066cc; cursor:pointer; font-size:11px; margin:0 2px; user-select:none;" ` +
        `title="Footnote ${noteIndex}: ${encodedTitle}">[${noteIndex}]</sup>`;
    } else {
      out += escapeHtml(source.slice(plusPos, noteEnd));
    }

    i = noteEnd;
  }

  return { html: out, noteCount: noteIndex };
}

// Handle inline footnote clicks (works across mouse/touch and avoids relying on inline onclick)
document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement | null;
  if (!target) return;

  const noteEl = target.closest('.inline-note') as HTMLElement | null;
  if (!noteEl) return;

  e.preventDefault();
  e.stopPropagation();
  (e as any).stopImmediatePropagation?.();

  const encodedNote = noteEl.getAttribute('data-note') || '';
  const noteIndex = noteEl.getAttribute('data-note-index') || '';
  showInlineNote(encodedNote, noteIndex, e as MouseEvent, noteEl);
}, true);

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
      
      const headingClass = getHeadingFontClass(translation);
      const headingClasses = ['reader-title', headingClass].filter(Boolean).join(' ');
      resultDiv.innerHTML = `
        ${renderBackButtonHtml()}
        <h3 class="${headingClasses}">${book} ${chapter}</h3>
        ${verses.map((v, idx) => {
          const hasCrossRefs = verseCrossRefs[idx].length > 0;
          const verseKey = `${book}:${chapter}:${v.verse}`;
          const isSelected = selectedVerses.has(verseKey);
          const wordsHtml = renderVerseWordsHtml(v.text);
          
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
              ${wordsHtml}
            </p>
          `;
        }).join('')}
      `;
      
      // Attach verse selection handlers
      attachVerseSelectionHandlers();
      setCurrentReadingLocation({ translation, book, chapter, verse: 1, mode: 'chapter' });
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
      const targetEl = (event.target as HTMLElement | null);
      const anchorRect = targetEl?.getBoundingClientRect
        ? targetEl.getBoundingClientRect()
        : new DOMRect(event.clientX, event.clientY, 0, 0);

      // Prefer showing above the clicked verse number, but always stay on-screen.
      positionFixedPopupWithinViewport(modal, anchorRect, { preferBelow: false });
      modal.style.visibility = 'visible';
    });
  } catch (error) {
    content.innerHTML = `<p style="color: red;">Error loading cross-references: ${error instanceof Error ? error.message : 'Unknown'}</p>`;
  }
}

type FootnoteRefMatch = {
  start: number;
  end: number;
  bookRaw: string;
  chapter: number;
  versesRaw: string;
  display: string;
};

function parseFootnoteRefs(text: string): FootnoteRefMatch[] {
  const matches: FootnoteRefMatch[] = [];
  const s = text ?? '';
  // Examples: "John 12:38", "Rom 10:16", "1 Pet. 2:22", "Acts 8:32,33"
  const re = /\b((?:[1-3]\s*)?[A-Za-z][A-Za-z.]+(?:\s+[A-Za-z][A-Za-z.]*)*)\s+(\d+):(\d+(?:[\-\u2013]\d+)?(?:,\d+)*)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const bookRaw = m[1].trim();
    const chapter = parseInt(m[2], 10);
    const versesRaw = m[3].trim();
    matches.push({
      start: m.index,
      end: m.index + m[0].length,
      bookRaw,
      chapter,
      versesRaw,
      display: m[0]
    });
  }
  return matches;
}

function normalizeBookKey(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9]/g, '');
}

const bookNameCache = new Map<string, Map<string, string>>();

async function resolveBookNameFromAbbrev(raw: string, translation: string): Promise<string | null> {
  const key = normalizeBookKey(raw);
  if (!key) return null;

  let map = bookNameCache.get(translation);
  if (!map) {
    const books = await textStore.getBooks(translation);
    map = new Map<string, string>();
    for (const b of books) {
      map.set(normalizeBookKey(b), b);
    }
    bookNameCache.set(translation, map);
  }

  if (map.has(key)) return map.get(key)!;

  let best: { book: string; score: number } | null = null;
  for (const [norm, book] of map.entries()) {
    if (norm.startsWith(key) || key.startsWith(norm)) {
      const score = Math.abs(norm.length - key.length);
      if (!best || score < best.score) best = { book, score };
    }
  }
  return best?.book || null;
}

function parseVerseNumbers(versesRaw: string): number[] {
  const cleaned = (versesRaw || '').replace(/[^0-9,\-\u2013]/g, '');
  if (!cleaned) return [];
  if (cleaned.includes('-') || cleaned.includes('\u2013')) {
    const parts = cleaned.split(/[-\u2013]/).map(x => parseInt(x, 10)).filter(Boolean);
    if (parts.length >= 2) {
      const start = parts[0];
      const end = parts[1];
      const out: number[] = [];
      for (let v = start; v <= end && out.length < 20; v++) out.push(v);
      return out;
    }
  }
  return cleaned.split(',').map(x => parseInt(x, 10)).filter(Boolean).slice(0, 20);
}

type FootnoteExpansion = {
  key: string;
  displayRef: string;
  translation: string;
  book: string;
  chapter: number;
  versesRaw: string;
  verses: number[];
  verseHtml: string;
};

let currentFootnoteState: { noteText: string; expansions: Map<string, FootnoteExpansion> } | null = null;
let footnoteSessionId = 0;

function renderFootnoteModalHtml(): string {
  if (!currentFootnoteState) return '';
  const { noteText, expansions } = currentFootnoteState;
  const refs = parseFootnoteRefs(noteText);
  const expandedKeys = new Set(expansions.keys());

  let body = '';
  let cursor = 0;
  for (const r of refs) {
    if (r.start < cursor) continue;
    body += escapeHtml(noteText.slice(cursor, r.start));
    const key = `${normalizeBookKey(r.bookRaw)}|${r.chapter}|${r.versesRaw}`;
    const isExpanded = expandedKeys.has(key);
    const style = isExpanded
      ? 'color:#0066cc; font-weight:600; text-decoration: underline;'
      : 'color:#0066cc; text-decoration: underline;';
    body += `<a href="#" class="footnote-ref" data-book="${encodeURIComponent(r.bookRaw)}" data-chapter="${r.chapter}" data-verses="${encodeURIComponent(r.versesRaw)}" style="${style}">${escapeHtml(r.display)}</a>`;
    cursor = r.end;
  }
  body += escapeHtml(noteText.slice(cursor));

  let expansionsHtml = '';
  for (const exp of expansions.values()) {
    const previewFontClass = isGreekTranslationId(exp.translation) ? ' popup-verse-text-greek' : '';
    expansionsHtml += `
      <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #eee;">
        <div style="font-weight: 650; font-size: 13px; color: #333; margin-bottom: 4px;">${escapeHtml(exp.displayRef)}</div>
        <div class="popup-verse-text${previewFontClass}" style="color: #555; font-size: 13px; line-height: 1.35;">${exp.verseHtml}</div>
      </div>
    `;
  }

  return `<div style="margin: 0 22px 0 0; color: #555; font-size: 13px; line-height: 1.35;">${body}</div>${expansionsHtml}`;
}

function showInlineNote(encodedNote: string, noteIndex: string, event: MouseEvent, anchorEl?: HTMLElement) {
  const modal = document.getElementById('xrefModal')!;
  const content = document.getElementById('xrefModalContent')!;
  const noteText = decodeURIComponent(encodedNote || '');

  const target = (anchorEl || (event.target as HTMLElement)) as HTMLElement;

  footnoteSessionId++;
  currentFootnoteState = { noteText, expansions: new Map() };
  content.innerHTML = renderFootnoteModalHtml();

  // Position near the clicked marker (robust on touch where clientX/Y can be unreliable)
  const rect = target.getBoundingClientRect();
  modal.style.display = 'block';
  modal.style.visibility = 'hidden';

  requestAnimationFrame(() => {
    positionFixedPopupWithinViewport(modal, rect, { preferBelow: true });
    modal.style.visibility = 'visible';
  });
}

// Handle verse-reference clicks inside footnotes:
// 1st click expands popup with verse text
// 2nd click navigates to that verse (with Back button)
document.addEventListener('click', async (e) => {
  const target = e.target as HTMLElement | null;
  if (!target) return;
  const link = target.closest('.footnote-ref') as HTMLElement | null;
  if (!link) return;

  e.preventDefault();
  e.stopPropagation();
  (e as any).stopImmediatePropagation?.();

  if (!currentFootnoteState) return;
  const session = footnoteSessionId;

  const bookRaw = decodeURIComponent(link.getAttribute('data-book') || '');
  const chapter = parseInt(link.getAttribute('data-chapter') || '0', 10);
  const versesRaw = decodeURIComponent(link.getAttribute('data-verses') || '');
  const verses = parseVerseNumbers(versesRaw);
  if (!bookRaw || !chapter || verses.length === 0) return;

  const key = `${normalizeBookKey(bookRaw)}|${chapter}|${versesRaw}`;

  // If already expanded: navigate
  if (currentFootnoteState.expansions.has(key)) {
    const exp = currentFootnoteState.expansions.get(key)!;
    const translationSel = document.getElementById('translation') as HTMLSelectElement;
    const bookSel = document.getElementById('book') as HTMLSelectElement;
    const chapterSel = document.getElementById('chapter') as HTMLSelectElement;
    const verseSel = document.getElementById('verse') as HTMLSelectElement;
    const fallbackLoc: ReadingLocation = {
      translation: translationSel.value,
      book: bookSel.value,
      chapter: parseInt(chapterSel.value, 10),
      verse: parseInt(verseSel.value, 10),
      mode: 'verse'
    };
    readingBackStack.push(currentReadingLocation || fallbackLoc);

    closeXrefModal();
    await navigateToLocation({ translation: exp.translation, book: exp.book, chapter: exp.chapter, verse: exp.verses[0], mode: 'verse' });
    return;
  }

  // Otherwise: expand
  const translationSel = document.getElementById('translation') as HTMLSelectElement;
  const currentTranslation = translationSel.value;
  const primary = getPrimaryDailyDriver() || currentTranslation || 'kjv';
  const resolvedBook = await resolveBookNameFromAbbrev(bookRaw, primary) || await resolveBookNameFromAbbrev(bookRaw, currentTranslation);
  if (!resolvedBook) return;

  const ddTranslation = getDailyDriverFor(resolvedBook) || currentTranslation || 'kjv';

  const verseTexts: string[] = [];
  for (const v of verses) {
    const t = await textStore.getVerse(ddTranslation, resolvedBook, chapter, v);
    if (t) verseTexts.push(t);
  }

  const verseHtml = verseTexts.length > 0
    ? verseTexts.map(t => `<span>${escapeHtml(stripHtmlTags(t))}</span>`).join(' ')
    : `<span style="color:#999;">Verse not found in ${escapeHtml(ddTranslation.toUpperCase())}</span>`;

  if (session !== footnoteSessionId || !currentFootnoteState) return;

  const displayRef = `${resolvedBook} ${chapter}:${versesRaw}`;
  currentFootnoteState.expansions.set(key, {
    key,
    displayRef,
    translation: ddTranslation,
    book: resolvedBook,
    chapter,
    versesRaw,
    verses,
    verseHtml
  });

  const content = document.getElementById('xrefModalContent')!;
  content.innerHTML = renderFootnoteModalHtml();
}, true);

function closeXrefModal() {
  const modal = document.getElementById('xrefModal')!;
  modal.style.display = 'none';
  currentFootnoteState = null;
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
  if (currentMap) {
    currentMap.remove();
    currentMap = null;
  }
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
let currentMap: L.Map | null = null;

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
    
    // Clear previous map
    if (currentMap) {
      currentMap.remove();
      currentMap = null;
    }
    
    // Create map canvas
    canvasDiv.innerHTML = '';
    canvasDiv.style.display = 'block';
    canvasDiv.style.alignItems = '';
    canvasDiv.style.justifyContent = '';
    
    // Initialize Leaflet map with historical map center (Jerusalem area)
    const map = L.map(canvasDiv).setView([31.7683, 35.2137], 8);
    currentMap = map;
    
    // Add OpenStreetMap base layer (for reference)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19
    }).addTo(map);
    
    // Render GeoJSON features if available
    if (layer.boundaries && layer.boundaries.features && layer.boundaries.features.length > 0) {
      const geoJsonLayer = L.geoJSON(layer.boundaries, {
        style: function (feature) {
          return {
            color: '#3388ff',
            weight: 2,
            opacity: 0.8,
            fillOpacity: 0.2
          };
        },
        onEachFeature: function (feature, layer) {
          if (feature.properties) {
            const props = feature.properties;
            let popupContent = '';
            
            if (props.name) {
              popupContent += `<strong>${props.name}</strong><br/>`;
            }
            if (props.description) {
              popupContent += `${props.description}<br/>`;
            }
            if (props.type) {
              popupContent += `<em>Type: ${props.type}</em>`;
            }
            
            if (popupContent) {
              layer.bindPopup(popupContent);
            }
          }
        }
      }).addTo(map);
      
      // Fit map to GeoJSON bounds
      const bounds = geoJsonLayer.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [50, 50] });
      }
    } else {
      canvasDiv.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #999;">No boundary data available for this layer</div>';
    }
    
    viewerDiv.style.display = 'block';
    viewerDiv.scrollIntoView({ behavior: 'smooth' });
    
    // Give map a moment to render then invalidate size
    setTimeout(() => {
      if (currentMap) {
        currentMap.invalidateSize();
      }
    }, 100);
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
    }, { passive: true });
    
    element.addEventListener('touchend', () => {
      // Only clear timer if menu hasn't been shown yet
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    }, { passive: true });
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
    // Preserve any inline footnote markers (sup.inline-note) so they remain clickable.
    const inlineNotes = Array.from(span.querySelectorAll('sup.inline-note')) as HTMLElement[];
    if (inlineNotes.length > 0) {
      inlineNotes.forEach((noteEl, noteIdx) => {
        const placeholder = `__PB_NOTE_${noteIdx}__`;
        // Ensure placeholders are surrounded by spaces so splitting works.
        noteEl.replaceWith(document.createTextNode(` ${placeholder} `));
      });
    }

    const text = span.textContent || '';
    const words = text.split(/\s+/);
    
    const wordElements = words.map((word, idx) => {
      const trimmed = word.trim();
      if (!trimmed) return '';

      const noteMatch = trimmed.match(/^__PB_NOTE_(\d+)__$/);
      if (noteMatch) {
        const noteIdx = parseInt(noteMatch[1], 10);
        const noteEl = inlineNotes[noteIdx];
        return noteEl ? noteEl.outerHTML : '';
      }
      
      const verseEl = span.closest('.verse-text') as HTMLElement;
      const book = verseEl?.dataset.book;
      const chapter = verseEl?.dataset.chapter;
      const verse = verseEl?.dataset.verse;
      
      const safeWord = escapeHtml(trimmed);
      return `<span class="word-clickable" 
                    data-word="${safeWord}" 
                    data-word-position="${idx + 1}"
                    data-book="${book}"
                    data-chapter="${chapter}"
                    data-verse="${verse}"
                    style="cursor: pointer; padding: 2px; border-radius: 2px; transition: background 0.15s;"
                    onmouseenter="this.style.background='#f0f0f0'"
                    onmouseleave="this.style.background='transparent'">${safeWord}</span>`;
    }).join(' ');
    
    span.innerHTML = wordElements;
  });
  
  // Attach click and long-press handlers to words
  document.querySelectorAll('.word-clickable').forEach(wordEl => {
    const element = wordEl as HTMLElement;
    let pressStartTime = 0;
    let didLongPress = false;
    
    element.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      pressStartTime = Date.now();
      longPressTimer = window.setTimeout(() => {
        didLongPress = true;
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
        didLongPress = true;
        showWordStudy(element, e);
      }, LONG_PRESS_DURATION);
    }, { passive: true });
    
    element.addEventListener('touchend', (e) => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }

      // If a long-press triggered the popup, prevent the synthetic click on release
      // (which can immediately close the popup or toggle verse selection).
      if (didLongPress) {
        didLongPress = false;
        suppressNextGlobalClickUntil = Date.now() + 800;
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // If it was a quick tap, toggle highlight
      if (Date.now() - pressStartTime < LONG_PRESS_DURATION) {
        e.preventDefault();
        toggleWordHighlight(element);
      }
    }, { passive: false });
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
  
  // Avoid relying on delayed event objects; prefer the globally recorded anchor.
  const mouseX = ('clientX' in event && typeof event.clientX === 'number')
    ? event.clientX
    : (event.touches?.[0]?.clientX ?? lastPopupAnchorRect.left);
  const mouseY = ('clientY' in event && typeof event.clientY === 'number')
    ? event.clientY
    : (event.touches?.[0]?.clientY ?? lastPopupAnchorRect.top);

  // Suppress the release-click that often follows long-press.
  suppressNextGlobalClickUntil = Date.now() + 800;
  
  content.innerHTML = '⏳ Loading word study...';
  modal.style.display = 'block';
  modal.style.visibility = 'hidden';

  // Position immediately using the viewport clamping helper (don’t wait for observer).
  requestAnimationFrame(() => {
    const anchorRect = new DOMRect(mouseX, mouseY, 0, 0);
    positionFixedPopupWithinViewport(modal, anchorRect, { preferBelow: 'auto' as any });
    modal.style.visibility = 'visible';
  });
  
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
    
    const normalizeStrongsId = (raw: unknown): string | null => {
      if (typeof raw !== 'string') return null;
      const cleanId = raw.replace(/[^\w]/g, '');
      const match = cleanId.match(/^([GH])(\d+)$/);
      if (!match) return null;
      return match[1] + match[2].padStart(4, '0');
    };

    const safeWord = escapeHtml(cleanPopupText(word));
    const safeBook = escapeHtml(cleanPopupText(book));
    const safeRef = `${safeBook} ${chapter}:${verse} &nbsp;&middot;&nbsp; #${wordPosition}`;

    let html = `
      <div style="margin: 0 22px 6px 0;">
        <div style="font-weight: 650; font-size: 14px; line-height: 1.15; color: #333;">${safeWord}</div>
        <div style="margin-top: 1px; color: #666; font-size: 11.5px;">${safeRef}</div>
      </div>
    `;
    
    if (morphData) {
      // Parse morphology data - handle both JSON and plain string codes
      let parsing: any;
      if (typeof morphData.parsing === 'string') {
        try {
          parsing = JSON.parse(morphData.parsing);
        } catch {
          // Not JSON - it's a morph code like "N-NSM-P"
          parsing = { code: morphData.parsing };
        }
      } else {
        parsing = morphData.parsing;
      }

      const normalizedStrongsId = normalizeStrongsId(morphData.strongsId);
      
      const safeMorphWord = escapeHtml(cleanPopupText(morphData.text || word));
      const safeLemma = escapeHtml(cleanPopupText(morphData.lemma || 'N/A'));
      const safeTranslit = morphData.transliteration ? escapeHtml(cleanPopupText(morphData.transliteration)) : '';
      const safeGloss = morphData.gloss ? escapeHtml(cleanPopupText(morphData.gloss)) : '';
      const safeMorphCode = parsing?.code ? escapeHtml(cleanPopupText(parsing.code)) : '';

      html += `
        <div style="margin: 0 0 6px 0;">
          <div style="margin: 0 0 3px 0; font-weight: 650; color: #555; font-size: 11.5px;">Morphology</div>
          <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
            <tr><td style="padding: 2px 4px; font-weight: 600; white-space: nowrap;">Word</td><td style="padding: 2px 4px;">${safeMorphWord}</td></tr>
            <tr><td style="padding: 2px 4px; font-weight: 600; white-space: nowrap;">Lemma</td><td style="padding: 2px 4px;">${safeLemma}</td></tr>
            ${safeTranslit ? `<tr><td style="padding: 2px 4px; font-weight: 600; white-space: nowrap;">Translit</td><td style="padding: 2px 4px;">${safeTranslit}</td></tr>` : ''}
            ${safeGloss ? `<tr><td style="padding: 2px 4px; font-weight: 600; white-space: nowrap;">Gloss</td><td style="padding: 2px 4px;">${safeGloss}</td></tr>` : ''}
            ${safeMorphCode ? `<tr><td style="padding: 2px 4px; font-weight: 600; white-space: nowrap;">Morph</td><td style="padding: 2px 4px;"><code style="background: #f0f0f0; padding: 1px 5px; border-radius: 3px;">${safeMorphCode}</code></td></tr>` : ''}
          </table>
        </div>
      `;
      
      // Show parsing details if available
      if (parsing && Object.keys(parsing).length > 1) {
        const rows = Object.entries(parsing)
          .filter(([key]) => key !== 'code')
          .map(([key, value]) => {
            const k = escapeHtml(cleanPopupText(key));
            const v = escapeHtml(cleanPopupText(value));
            return `<tr><td style="padding: 2px 4px; font-weight: 600; white-space: nowrap;">${k}</td><td style="padding: 2px 4px;">${v}</td></tr>`;
          })
          .join('');

        if (rows) {
          html += `
            <div style="margin: 0 0 6px 0;">
              <div style="margin: 0 0 3px 0; font-weight: 650; color: #555; font-size: 11.5px;">Parsing</div>
              <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                ${rows}
              </table>
            </div>
          `;
        }
      }
      
      // Get Strong's definition if available
      if (normalizedStrongsId) {
        const strongsData = await new Promise<any>((resolve) => {
          const request = tx.objectStore('strongs_entries').get(normalizedStrongsId);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve(null);
        });

        if (strongsData) {
          const safeStrongLemma = escapeHtml(cleanPopupText(strongsData.lemma));
          const safeStrongTranslit = strongsData.transliteration ? escapeHtml(cleanPopupText(strongsData.transliteration)) : '';
          const safeStrongDef = escapeHtml(cleanPopupText(strongsData.shortDefinition || strongsData.definition));
          const safeKjvUsage = strongsData.kjvUsage ? escapeHtml(cleanPopupText(strongsData.kjvUsage)) : '';

          html += `
            <div id="strongs-def" style="margin: 0 0 6px 0; padding: 6px; background: #fff3e0; border-left: 3px solid #ff9800; border-radius: 4px; scroll-margin-top: 6px;">
              <div style="margin: 0 0 3px 0; font-weight: 650; color: #e65100; font-size: 11.5px;">Strong's ${escapeHtml(normalizedStrongsId)}</div>
              <div style="margin: 0 0 3px 0;"><strong>${safeStrongLemma}</strong>${safeStrongTranslit ? ` <span style=\"color:#666\">(${safeStrongTranslit})</span>` : ''}</div>
              <div style="margin: 0; color: #555;">${safeStrongDef}</div>
              ${safeKjvUsage ? `<div style="margin-top: 3px; font-size: 11.5px; color: #666;"><em>KJV: ${safeKjvUsage}</em></div>` : ''}
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
          const safePlaceName = escapeHtml(cleanPopupText(placeData.name));
          const safeSignificance = placeData.significance ? escapeHtml(cleanPopupText(placeData.significance)) : '';
          const altNames = placeData.altNames ? (() => {
            try {
              const parsed = JSON.parse(placeData.altNames);
              if (!Array.isArray(parsed)) return '';
              return parsed.map((x: any) => cleanPopupText(x)).filter(Boolean).join(', ');
            } catch {
              return '';
            }
          })() : '';

          html += `
            <div style="margin: 0 0 6px 0; padding: 6px; background: #e8f5e9; border-left: 3px solid #4caf50; border-radius: 4px;">
              <div style="margin: 0 0 3px 0; font-weight: 650; color: #2e7d32; font-size: 11.5px;">Place: ${safePlaceName}</div>
              ${altNames ? `<div style="margin: 0 0 3px 0; font-size: 11.5px; color: #666;">Also: ${escapeHtml(altNames)}</div>` : ''}
              ${placeData.latitude && placeData.longitude ? `<div style="margin: 0 0 3px 0; font-size: 11.5px; color: #666;">${placeData.latitude.toFixed(4)}, ${placeData.longitude.toFixed(4)}</div>` : ''}
              ${placeData.modernCity ? `<div style="margin: 0 0 3px 0; font-size: 11.5px; color: #666;">Modern: ${escapeHtml(cleanPopupText(placeData.modernCity))}${placeData.modernCountry ? ', ' + escapeHtml(cleanPopupText(placeData.modernCountry)) : ''}</div>` : ''}
              ${safeSignificance ? `<div style="margin: 0; color: #555;">${safeSignificance}</div>` : ''}
              <button onclick="viewPlaceOnMap('${escapeHtml(placeId)}')" style="margin-top: 5px; padding: 4px 8px; background: #4caf50; color: white; border: none; border-radius: 4px; cursor: pointer;">
                View on Map
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
    
    // Auto-scroll to Strong's definition if it exists
    if (normalizeStrongsId(morphData?.strongsId)) {
      setTimeout(() => {
        const strongsDef = document.getElementById('strongs-def');
        if (strongsDef) {
          strongsDef.scrollIntoView({ behavior: 'smooth', block: 'start' });
          strongsDef.style.setProperty('animation', 'highlight 1s ease');
          setTimeout(() => strongsDef.style.removeProperty('animation'), 1000);
        }
      }, 100);
    }
    
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
  selectedVerses.forEach(verseKey => {
    const [book, chapter, verse] = verseKey.split(':');
    const verseEl = document.querySelector(`[data-book="${book}"][data-chapter="${chapter}"][data-verse="${verse}"]`);
    if (verseEl) {
      const wordsSpan = verseEl.querySelector('.verse-words') as HTMLElement;
      if (wordsSpan) {
        const isHighlighted = wordsSpan.dataset.pbHighlight === '1';
        if (isHighlighted) {
          delete wordsSpan.dataset.pbHighlight;
          wordsSpan.style.background = 'transparent';
        } else {
          wordsSpan.dataset.pbHighlight = '1';
          wordsSpan.style.background = '#fff9c4';
        }
      }
    }
  });
  closeVerseActionModal();
}

function underlineSelected() {
  selectedVerses.forEach(verseKey => {
    const [book, chapter, verse] = verseKey.split(':');
    const verseEl = document.querySelector(`[data-book="${book}"][data-chapter="${chapter}"][data-verse="${verse}"]`);
    if (verseEl) {
      const wordsSpan = verseEl.querySelector('.verse-words') as HTMLElement;
      if (wordsSpan) {
        const isUnderlined = wordsSpan.dataset.pbUnderline === '1';
        if (isUnderlined) {
          delete wordsSpan.dataset.pbUnderline;
          wordsSpan.style.textDecoration = 'none';
        } else {
          wordsSpan.dataset.pbUnderline = '1';
          wordsSpan.style.textDecoration = 'underline';
        }
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
        const isItalic = wordsSpan.dataset.pbItalic === '1';
        if (isItalic) {
          delete wordsSpan.dataset.pbItalic;
          wordsSpan.style.fontStyle = 'normal';
        } else {
          wordsSpan.dataset.pbItalic = '1';
          wordsSpan.style.fontStyle = 'italic';
        }
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
(window as any).showInlineNote = showInlineNote;

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
  if (wordStudyModal.style.display === 'block' && !wordStudyModal.contains(target) && !target.closest('.word-clickable')) {
    closeWordStudyModal();
  }
});

// Removed scroll/wheel auto-close - user prefers manual close with X button
