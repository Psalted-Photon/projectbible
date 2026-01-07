import { IndexedDBTextStore, IndexedDBPackManager, importPackFromSQLite } from './adapters/index.js';

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app element');

// Create adapter instances
const textStore = new IndexedDBTextStore();
const packManager = new IndexedDBPackManager();

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
      <input type="file" id="packFile" accept=".sqlite" />
      <button id="importBtn" style="margin-left: 10px; padding: 8px 16px;">Import Pack</button>
      <div id="importStatus" style="margin-top: 10px; color: #666;"></div>
    </section>
    
    <section style="margin: 30px 0; padding: 20px; background: #f5f5f5; border-radius: 8px;">
      <h2>Installed Packs</h2>
      <button id="refreshPacks" style="padding: 8px 16px;">Refresh</button>
      <div id="packsList" style="margin-top: 15px;"></div>
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
        <label style="margin-left: 10px;">Chapter: <input type="number" id="chapter" value="1" style="padding: 4px; width: 60px;" /></label>
        <label style="margin-left: 10px;">Verse: <input type="number" id="verse" value="1" style="padding: 4px; width: 60px;" /></label>
      </div>
      <button id="readVerse" style="padding: 8px 16px; margin-top: 10px;">Read Verse</button>
      <button id="readChapter" style="padding: 8px 16px; margin-left: 10px;">Read Chapter</button>
      <div id="verseText" style="margin-top: 15px; padding: 15px; background: white; border-radius: 4px; min-height: 40px;"></div>
    </section>
  </div>
`;

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
    
    // Load books for the first translation
    if (translations.length > 0) {
      await refreshBookDropdown(translations[0].id);
    }
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

// Listen for translation changes to update book dropdown
document.getElementById('translation')?.addEventListener('change', async (e) => {
  const translation = (e.target as HTMLSelectElement).value;
  if (translation) {
    await refreshBookDropdown(translation);
  }
});

document.getElementById('refreshPacks')?.addEventListener('click', refreshPacksList);

// Read verse handler
document.getElementById('readVerse')?.addEventListener('click', async () => {
  const translation = (document.getElementById('translation') as HTMLInputElement).value;
  const book = (document.getElementById('book') as HTMLInputElement).value;
  const chapter = parseInt((document.getElementById('chapter') as HTMLInputElement).value);
  const verse = parseInt((document.getElementById('verse') as HTMLInputElement).value);
  const resultDiv = document.getElementById('verseText')!;
  
  resultDiv.textContent = '⏳ Loading...';
  
  try {
    const text = await textStore.getVerse(translation, book, chapter, verse);
    
    if (text) {
      resultDiv.innerHTML = `<strong>${book} ${chapter}:${verse}</strong><br/>${text}`;
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
  const translation = (document.getElementById('translation') as HTMLInputElement).value;
  const book = (document.getElementById('book') as HTMLInputElement).value;
  const chapter = parseInt((document.getElementById('chapter') as HTMLInputElement).value);
  const resultDiv = document.getElementById('verseText')!;
  
  resultDiv.textContent = '⏳ Loading...';
  
  try {
    const verses = await textStore.getChapter(translation, book, chapter);
    
    if (verses.length > 0) {
      resultDiv.innerHTML = `
        <h3>${book} ${chapter}</h3>
        ${verses.map(v => `
          <p style="margin: 8px 0;">
            <sup style="color: #666;">${v.verse}</sup> ${v.text}
          </p>
        `).join('')}
      `;
    } else {
      resultDiv.innerHTML = `<em style="color: #999;">Chapter not found</em>`;
    }
  } catch (error) {
    resultDiv.innerHTML = `<span style="color: red;">Error: ${error instanceof Error ? error.message : 'Unknown'}</span>`;
    console.error(error);
  }
});

// Load initial state
refreshPacksList();
refreshTranslationDropdown();

