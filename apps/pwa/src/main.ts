import { IndexedDBTextStore, IndexedDBPackManager, IndexedDBSearchIndex, IndexedDBCrossReferenceStore, importPackFromSQLite, getSettings, updateSettings, getDailyDriverFor, getPrimaryDailyDriver, type UserSettings, openDB } from './adapters/index.js';
import { clearAllData, clearPacksOnly, getDatabaseStats, removePack } from './adapters/db-manager.js';
import { generateReadingPlan, BIBLE_BOOKS as BIBLE_BOOKS_INFO, type ReadingPlanConfig, type ReadingPlan } from '@projectbible/core';
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

// State management for reading plans
let currentReadingPlan: ReadingPlan | null = null;
let currentPlanId: string | null = null;

// Storage keys for reading plans
const STORAGE_ACTIVE_PLAN = 'projectbible_active_reading_plan';
const STORAGE_PLAN_HISTORY = 'projectbible_reading_plan_history';

// Chronological ordering state
let chronologicalData: any = null;
let isChronologicalMode = false;
let currentChronoIndex = 0;

// Load chronological pack
async function loadChronologicalPack() {
  try {
    const response = await fetch('/packs/chronological-v1.json');
    if (response.ok) {
      chronologicalData = await response.json();
      console.log(`Loaded chronological pack: ${chronologicalData.verse_count} verses`);
    }
  } catch (e) {
    console.warn('Chronological pack not available:', e);
  }
}

// Load active plan from storage
function loadActivePlan() {
  try {
    const stored = localStorage.getItem(STORAGE_ACTIVE_PLAN);
    if (stored) {
      const data = JSON.parse(stored);
      currentReadingPlan = data.plan;
      currentPlanId = data.id;
      // Convert date strings back to Date objects
      if (currentReadingPlan) {
        currentReadingPlan.config.startDate = new Date(currentReadingPlan.config.startDate);
        currentReadingPlan.config.endDate = new Date(currentReadingPlan.config.endDate);
        currentReadingPlan.days.forEach(day => {
          day.date = new Date(day.date);
        });
      }
    }
  } catch (e) {
    console.error('Error loading active plan:', e);
  }
}

// Save active plan to storage
function saveActivePlan() {
  if (currentReadingPlan && currentPlanId) {
    localStorage.setItem(STORAGE_ACTIVE_PLAN, JSON.stringify({
      id: currentPlanId,
      plan: currentReadingPlan
    }));
  }
}

// Save plan to history
function savePlanToHistory(plan: ReadingPlan, planId: string) {
  try {
    const historyStr = localStorage.getItem(STORAGE_PLAN_HISTORY);
    const history = historyStr ? JSON.parse(historyStr) : [];
    history.unshift({
      id: planId,
      plan,
      createdAt: new Date().toISOString(),
      completedAt: null
    });
    // Keep only last 10 plans
    if (history.length > 10) {
      history.splice(10);
    }
    localStorage.setItem(STORAGE_PLAN_HISTORY, JSON.stringify(history));
  } catch (e) {
    console.error('Error saving plan to history:', e);
  }
}

// Get plan history
function getPlanHistory() {
  try {
    const historyStr = localStorage.getItem(STORAGE_PLAN_HISTORY);
    return historyStr ? JSON.parse(historyStr) : [];
  } catch (e) {
    console.error('Error loading plan history:', e);
    return [];
  }
}

// Delete current plan
function deleteCurrentPlan() {
  if (confirm('Are you sure you want to delete the current reading plan?')) {
    localStorage.removeItem(STORAGE_ACTIVE_PLAN);
    currentReadingPlan = null;
    currentPlanId = null;
    
    // Update UI
    const container = document.getElementById('activePlanContent')!;
    container.innerHTML = '<p style="color: #666;">No active plan. Create one to get started!</p>';
  }
}

// Delete plan from history
function deletePlanFromHistory(planId: string) {
  if (confirm('Are you sure you want to delete this plan from history?')) {
    try {
      const history = getPlanHistory();
      const updated = history.filter((p: any) => p.id !== planId);
      localStorage.setItem(STORAGE_PLAN_HISTORY, JSON.stringify(updated));
      renderPlanHistory();
    } catch (e) {
      console.error('Error deleting plan from history:', e);
    }
  }
}

// Render plan history
function renderPlanHistory() {
  const container = document.getElementById('planHistoryContent')!;
  const history = getPlanHistory();
  
  if (history.length === 0) {
    container.innerHTML = '<p style="opacity: 0.7;">No past plans yet.</p>';
    return;
  }
  
  let html = '<div style="max-height: 500px; overflow-y: auto;">';
  
  history.forEach((item: any) => {
    const plan = item.plan as ReadingPlan;
    const createdDate = new Date(item.createdAt).toLocaleDateString();
    const startDate = new Date(plan.config.startDate).toLocaleDateString();
    const endDate = new Date(plan.config.endDate).toLocaleDateString();
    
    html += `
      <div class="content-section" style="padding: 15px; margin-bottom: 15px; border-radius: 8px;">
        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 10px;">
          <div>
            <div style="font-weight: 600; margin-bottom: 5px;">
              ${plan.config.ordering.charAt(0).toUpperCase() + plan.config.ordering.slice(1)} Plan
            </div>
            <div style="font-size: 13px; opacity: 0.8;">Created ${createdDate}</div>
          </div>
          <button onclick="deletePlanFromHistory('${item.id}')" style="padding: 6px 12px; background: #d32f2f; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">Delete</button>
        </div>
        <div style="font-size: 13px; opacity: 0.8; margin-bottom: 5px;">
          <strong>${plan.totalDays}</strong> days • <strong>${plan.totalChapters}</strong> chapters
        </div>
        <div style="font-size: 13px; opacity: 0.8;">
          ${startDate} → ${endDate}
        </div>
      </div>
    `;
  });
  
  html += '</div>';
  container.innerHTML = html;
  
  // Make delete function available globally
  (window as any).deletePlanFromHistory = deletePlanFromHistory;
}

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

// Derived book lists for UI helpers
const OT_BOOKS = BIBLE_BOOKS_INFO.filter(b => b.testament === 'OT').map(b => b.name);
const NT_BOOKS = BIBLE_BOOKS_INFO.filter(b => b.testament === 'NT').map(b => b.name);

// Simple test UI
root.innerHTML = `
  <div class="main-container" style="max-width: 800px; margin: 40px auto; padding: 20px; font-family: system-ui;">
    <h1 class="main-title" style="border-bottom: 3px solid #2c5f8d; padding-bottom: 10px;">ProjectBible PWA - Adapter Test</h1>
    
    <section class="content-section" style="margin: 30px 0; padding: 20px; border-radius: 8px;">
      <h2>Read Verse</h2>
      <div style="margin: 10px 0;">
        <label>Translation: 
          <select id="translation" style="padding: 4px; min-width: 120px;">
            <option value="">Loading...</option>
          </select>
        </label>
        <label style="margin-left: 10px;">
          <input type="checkbox" id="chronologicalMode" />
          Chronological?
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
      <div id="verseText" class="verse-display" style="margin-top: 15px; padding: 15px; border-radius: 4px; min-height: 40px;"></div>
    </section>
    
    <section class="content-section" style="margin: 30px 0; padding: 20px; border-radius: 8px;">
      <h2>📖 Reading Plan</h2>
      <div id="readingPlanContainer">
        <!-- Tab navigation -->
        <div style="border-bottom: 2px solid #ccc; margin-bottom: 20px;">
          <button id="tabCreatePlan" class="plan-tab active" style="padding: 10px 20px; border: none; background: transparent; cursor: pointer; border-bottom: 3px solid #2c5f8d; font-weight: 600;">Create Plan</button>
          <button id="tabActivePlan" class="plan-tab" style="padding: 10px 20px; border: none; background: transparent; cursor: pointer; border-bottom: 3px solid transparent;">Active Plan</button>
          <button id="tabPlanHistory" class="plan-tab" style="padding: 10px 20px; border: none; background: transparent; cursor: pointer; border-bottom: 3px solid transparent;">History</button>
        </div>
        
        <!-- Create Plan Tab -->
        <div id="createPlanTab" class="plan-tab-content">
          <div style="margin-bottom: 20px;">
            <label style="display: block; margin-bottom: 10px; font-weight: 600;">Preset Plan:</label>
            <select id="planPreset" style="padding: 8px; width: 100%; max-width: 400px;">
              <option value="">Custom...</option>
              <option value="bible-1-year">Bible in 1 Year</option>
              <option value="nt-90-days">New Testament in 90 Days</option>
              <option value="gospels-30-days">Gospels in 30 Days</option>
              <option value="chronological-1-year">Chronological Bible in 1 Year</option>
              <option value="psalms-proverbs">Psalms & Proverbs</option>
            </select>
          </div>
          
          <div id="customPlanOptions" style="display: block;">
            <h3 style="font-size: 16px; margin: 20px 0 10px 0;">Date Range</h3>
            <div style="margin-bottom: 15px;">
              <label style="display: block; margin-bottom: 10px;">
                Start Date: <input type="date" id="planStartDate" style="padding: 6px; margin-left: 10px;" />
              </label>
              <label style="display: block; margin-bottom: 10px;">
                End Date: <input type="date" id="planEndDate" style="padding: 6px; margin-left: 10px;" />
              </label>
            </div>
            
            <h3 style="font-size: 16px; margin: 20px 0 10px 0;">Reading Days</h3>
            <div style="margin-bottom: 15px;">
              <label style="margin-right: 15px;"><input type="checkbox" id="daySun" checked /> Sunday</label>
              <label style="margin-right: 15px;"><input type="checkbox" id="dayMon" checked /> Monday</label>
              <label style="margin-right: 15px;"><input type="checkbox" id="dayTue" checked /> Tuesday</label>
              <label style="margin-right: 15px;"><input type="checkbox" id="dayWed" checked /> Wednesday</label>
              <label style="margin-right: 15px;"><input type="checkbox" id="dayThu" checked /> Thursday</label>
              <label style="margin-right: 15px;"><input type="checkbox" id="dayFri" checked /> Friday</label>
              <label style="margin-right: 15px;"><input type="checkbox" id="daySat" checked /> Saturday</label>
            </div>
            
            <h3 style="font-size: 16px; margin: 20px 0 10px 0;">Book Selection</h3>
            <div style="margin-bottom: 15px;">
              <button id="selectAllBooks" style="padding: 6px 12px; margin-right: 10px;">Select All</button>
              <button id="selectNone" style="padding: 6px 12px; margin-right: 10px;">Select None</button>
              <button id="selectOT" style="padding: 6px 12px; margin-right: 10px;">OT Only</button>
              <button id="selectNT" style="padding: 6px 12px;">NT Only</button>
            </div>
            <div id="bookGrid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; max-height: 300px; overflow-y: auto; padding: 10px; background: #f5f5f5; border-radius: 4px;"></div>
            
            <h3 style="font-size: 16px; margin: 20px 0 10px 0;">Reading Order</h3>
            <div style="margin-bottom: 15px;">
              <label><input type="radio" name="ordering" value="canonical" checked /> Canonical (Traditional)</label><br/>
              <label><input type="radio" name="ordering" value="chronological" /> Chronological (Historical Order)</label><br/>
              <label><input type="radio" name="ordering" value="shuffled" /> Shuffled (Random)</label>
            </div>
            
            <h3 style="font-size: 16px; margin: 20px 0 10px 0;">Advanced Options</h3>
            <div style="margin-bottom: 15px;">
              <label style="display: block; margin-bottom: 10px;">
                <input type="checkbox" id="optDailyPsalm" /> Add one Psalm per day
                <div id="psalmsRandomOpt" style="margin-left: 25px; margin-top: 5px; display: none;">
                  <label><input type="checkbox" id="optRandomizePsalms" /> Randomize Psalms?</label>
                </div>
              </label>
              <label style="display: block; margin-bottom: 10px;">
                <input type="checkbox" id="optDailyProverb" /> Add one Proverb per day
                <div id="proverbsRandomOpt" style="margin-left: 25px; margin-top: 5px; display: none;">
                  <label><input type="checkbox" id="optRandomizeProverbs" /> Randomize Proverbs?</label>
                </div>
              </label>
              <label style="display: block; margin-bottom: 10px;">
                <input type="checkbox" id="optReverseOrder" /> Reverse Order (read last day first)
              </label>
              <label style="display: block; margin-bottom: 10px;">
                <input type="checkbox" id="optShowOverallStats" checked /> Show Overall Statistics
              </label>
              <label style="display: block; margin-bottom: 10px;">
                <input type="checkbox" id="optShowDailyStats" checked /> Show Daily Statistics
              </label>
            </div>
          </div>
          
          <div style="margin-top: 20px;">
            <button id="generatePlanBtn" style="padding: 12px 24px; background: #2c5f8d; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 600;">Generate Plan</button>
            <div id="planGenerationStatus" style="margin-top: 10px; color: #666;"></div>
          </div>
        </div>
        
        <!-- Active Plan Tab -->
        <div id="activePlanTab" class="plan-tab-content" style="display: none;">
          <div id="activePlanContent">
            <p style="color: #666;">No active plan. Create one to get started!</p>
          </div>
        </div>
        
        <!-- Plan History Tab -->
        <div id="planHistoryTab" class="plan-tab-content" style="display: none;">
          <div id="planHistoryContent">
            <p style="color: #666;">No past plans yet.</p>
          </div>
        </div>
      </div>
    </section>
    
    <section class="content-section" style="margin: 30px 0; padding: 20px; border-radius: 8px;">
      <h2>🔍 Search Bible</h2>
      <div style="margin: 10px 0;">
        <input type="text" id="searchQuery" placeholder="Enter search terms..." 
               style="padding: 8px; width: 60%; font-size: 16px;" />
        <button id="searchBtn" style="padding: 8px 16px; margin-left: 10px; font-size: 16px;">Search</button>
      </div>
      <div style="margin-top: 10px;">
        <label>
          <input type="checkbox" id="canonicalOnly" />
          Canonical Only?
        </label>
      </div>
      <div id="searchStatus" class="section-description" style="margin-top: 10px;"></div>
      <div id="searchResults" style="margin-top: 15px; max-height: 500px; overflow-y: auto;"></div>
    </section>
    
    <section class="content-section" style="margin: 30px 0; padding: 20px; border-radius: 8px;">
      <h2>🗺️ Historical Maps</h2>
      <div style="margin: 10px 0;">
        <button id="loadMapsBtn" style="padding: 8px 16px;">Load Map Layers</button>
      </div>
      <div id="mapLayersList" style="margin-top: 15px;"></div>
      <div id="mapViewer" class="map-viewer" style="margin-top: 20px; display: none; padding: 15px; border-radius: 8px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
          <h3 id="mapViewerTitle" style="margin: 0;"></h3>
          <button id="closeMapBtn" style="padding: 6px 12px; border-radius: 4px; cursor: pointer;">Close</button>
        </div>
        <div id="mapDetails" class="map-details" style="margin-bottom: 15px; padding: 10px; border-radius: 4px;"></div>
        
        <!-- Pleiades Place Search -->
        <div class="map-search-panel" style="margin-bottom: 15px; padding: 12px; border-radius: 4px;">
          <div style="display: flex; gap: 10px; align-items: center;">
            <input 
              type="text" 
              id="mapPlaceSearch" 
              placeholder="Search 41,000+ ancient places (e.g., Jerusalem, Athens, Rome)..." 
              style="flex: 1; padding: 8px; border-radius: 4px; font-size: 14px;"
            />
            <button id="mapSearchPlacesBtn" class="accent-button" style="padding: 8px 16px; background: #2c5f8d; color: #f5f5f5; border-radius: 4px; cursor: pointer; font-weight: 500; transition: background 0.2s;" onmouseover="this.style.background='#3a7ab5'" onmouseout="this.style.background='#2c5f8d'">Search</button>
          </div>
          <div id="mapSearchResults" class="map-search-results" style="margin-top: 10px; max-height: 300px; overflow-y: auto; display: none; border-radius: 4px;"></div>
          <div id="mapSearchStatus" class="section-description" style="margin-top: 8px; font-size: 12px;"></div>
        </div>
        
        <div id="mapCanvas" style="width: 100%; height: 500px; border: 1px solid #ccc; background: #e9ecef; display: flex; align-items: center; justify-content: center; color: #555;">
          GeoJSON map rendering (requires Leaflet or similar library)
        </div>
      </div>
    </section>
    
    <section class="content-section" style="margin: 30px 0; padding: 20px; border-radius: 8px;">
      <h2>⚙️ Settings</h2>
      <h3 style="font-size: 16px; margin: 15px 0 10px 0;">Daily Driver Translations</h3>
      <p class="section-description" style="margin: 5px 0; font-size: 14px;">Set your preferred default translations</p>
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
      </div>
      
      <h3 style="font-size: 16px; margin: 25px 0 10px 0;">Display Settings</h3>
      <div style="margin: 15px 0;">
        <label style="display: block; margin: 10px 0;">
          Theme:
          <select id="themeSelect" style="margin-left: 10px; padding: 4px;">
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <label style="display: block; margin: 10px 0;">
          Font Size:
          <input type="range" id="fontSizeSlider" min="12" max="24" step="1" value="15" style="margin-left: 10px; width: 150px;">
          <span id="fontSizeValue" style="margin-left: 10px; font-weight: 600;">15px</span>
        </label>
        <label style="display: block; margin: 10px 0;">
          Line Spacing:
          <input type="range" id="lineSpacingSlider" min="1" max="2.5" step="0.1" value="1.5" style="margin-left: 10px; width: 150px;">
          <span id="lineSpacingValue" style="margin-left: 10px; font-weight: 600;">1.5</span>
        </label>
        <label style="display: block; margin: 10px 0;">
          Verse Layout:
          <select id="verseLayoutSelect" style="margin-left: 10px; padding: 4px;">
            <option value="one-per-line">Each verse on new line</option>
            <option value="paragraph">Paragraph (flow like book)</option>
          </select>
        </label>
      </div>
      
      <div style="margin: 15px 0;">
        <button id="saveSettings" style="padding: 8px 16px; margin-top: 10px; border-radius: 4px; cursor: pointer;">
          Save Settings
        </button>
        <span id="settingsSaved" class="success-text" style="margin-left: 10px; display: none;">✓ Saved</span>
      </div>
      
      <h3 style="font-size: 16px; margin: 25px 0 10px 0;">🎨 Polished Version</h3>
      <p class="section-description" style="margin: 10px 0;">Try the new immersive reading experience with slide-in panes</p>
      <div style="margin: 15px 0;">
        <button id="openPolishedBtn" style="padding: 12px 24px; border-radius: 6px; cursor: pointer; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; font-weight: 600; font-size: 14px; transition: transform 0.2s, box-shadow 0.2s;" onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 12px rgba(102, 126, 234, 0.4)'" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='none'">
          Open Polished Version ✨
        </button>
      </div>
    </section>
    
    <section class="content-section" style="margin: 30px 0; padding: 20px; border-radius: 8px;">
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
      <div id="importStatus" style="margin-top: 10px; color: #555;"></div>
    </section>
    
    <section class="content-section" style="margin: 30px 0; padding: 20px; border-radius: 8px;">
      <h2>Installed Packs</h2>
      <button id="refreshPacks" style="padding: 8px 16px;">Refresh</button>
      <div id="packsList" class="list-container" style="margin-top: 15px; max-height: 200px; overflow-y: auto; border-radius: 4px; padding: 10px;"></div>
    </section>
    
    <section class="content-section" style="margin: 30px 0; padding: 20px; border-radius: 8px;">
      <h2>⚠️ Database Management</h2>
      <p class="section-description" style="margin: 10px 0;">Clear old packs to free up space</p>
      <button id="clearPacksBtn" style="padding: 8px 16px; border-radius: 4px; cursor: pointer;">
        Clear All Packs (Keep User Data)
      </button>
      <button id="clearAllBtn" style="padding: 8px 16px; margin-left: 10px; border-radius: 4px; cursor: pointer;">
        Clear Everything (Nuclear)
      </button>
      <div id="dbStats" class="section-description" style="margin-top: 10px; font-size: 14px;"></div>
    </section>
  </div>
  
  <!--Cross-reference popup -->
  <div id="xrefModal" class="modal" style="display: none; position: fixed; padding: 15px; border-radius: 8px; max-width: 400px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); z-index: 1000;">
    <button id="closeXrefModal" class="modal-close" style="position: absolute; top: 8px; right: 8px; border-radius: 50%; width: 24px; height: 24px; cursor: pointer; font-size: 16px; line-height: 1;">&times;</button>
    <div id="xrefModalContent"></div>
  </div>
  
  <!-- Verse action menu popup -->
  <div id="verseActionModal" class="modal" style="display: none; position: fixed; padding: 20px; border-radius: 8px; max-width: 350px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); z-index: 1001;">
    <button id="closeVerseActionModal" class="modal-close" style="position: absolute; top: 8px; right: 8px; border-radius: 50%; width: 24px; height: 24px; cursor: pointer; font-size: 16px; line-height: 1;">&times;</button>
    <h3 style="margin: 0 0 15px 0; font-size: 16px;">Actions for Selected Verses</h3>
    <div id="verseActionContent" style="display: flex; flex-direction: column; gap: 10px;">
      <button class="action-btn" onclick="createNoteForSelected()" style="padding: 10px; border-radius: 4px; cursor: pointer; text-align: left;">
        📝 Create Note
      </button>
      <button class="action-btn" onclick="highlightSelected()" style="padding: 10px; border-radius: 4px; cursor: pointer; text-align: left;">
        🖍️ Highlight (Yellow)
      </button>
      <button class="action-btn" onclick="underlineSelected()" style="padding: 10px; border-radius: 4px; cursor: pointer; text-align: left;">
        <u>U</u> Underline
      </button>
      <button class="action-btn" onclick="italicizeSelected()" style="padding: 10px; border-radius: 4px; cursor: pointer; text-align: left;">
        <i>I</i> Italicize
      </button>
      <button class="action-btn" onclick="clearSelection()" style="padding: 10px; border-radius: 4px; cursor: pointer; text-align: left;">
        ❌ Clear Selection
      </button>
    </div>
  </div>
  
  <!-- Word study popup -->
  <div id="wordStudyModal" style="display: none; position: fixed; background: #e5e5e5; padding: 10px; border-radius: 8px; max-width: 360px; max-height: min(52vh, 420px); overflow-y: auto; box-shadow: 0 4px 16px rgba(0,0,0,0.3); z-index: 1002; border: 1px solid #ccc; font-size: 12.5px; line-height: 1.22;">
    <button id="closeWordStudyModal" style="position: absolute; top: 6px; right: 6px; background: #bbb; border: 1px solid #bbb; border-radius: 50%; width: 24px; height: 24px; cursor: pointer; font-size: 16px; line-height: 1;">&times;</button>
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
            <div style="background: #999; height: 100%; width: ${percent}%; transition: width 0.3s;"></div>
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
      packsDiv.innerHTML = '<p style="color: #555;">No packs installed</p>';
      return;
    }
    
    packsDiv.innerHTML = packs.map(pack => `
      <div style="padding: 10px; margin: 5px 0; background: #e5e5e5; border-radius: 4px; display: flex; justify-content: space-between; align-items: center;">
        <div>
          <strong>${pack.translationName || pack.id}</strong> (${pack.translationId || 'N/A'})<br/>
          <small style="color: #555;">
            Version: ${pack.version} | 
            Type: ${pack.type} | 
            Size: ${(pack.size! / 1024).toFixed(1)} KB
          </small>
        </div>
        <button class="delete-pack-btn" data-pack-id="${pack.id}" style="padding: 6px 12px; background: #8b0000; color: #f5f5f5; border: 1px solid #bbb; border-radius: 4px; cursor: pointer; font-size: 14px;">Delete</button>
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

  // Load display settings
  const themeSelect = document.getElementById('themeSelect') as HTMLSelectElement;
  const fontSizeSlider = document.getElementById('fontSizeSlider') as HTMLInputElement;
  const fontSizeValue = document.getElementById('fontSizeValue') as HTMLSpanElement;
  const lineSpacingSlider = document.getElementById('lineSpacingSlider') as HTMLInputElement;
  const lineSpacingValue = document.getElementById('lineSpacingValue') as HTMLSpanElement;
  const verseLayoutSelect = document.getElementById('verseLayoutSelect') as HTMLSelectElement;

  if (settings.theme) themeSelect.value = settings.theme;
  if (settings.fontSize) {
    fontSizeSlider.value = settings.fontSize.toString();
    fontSizeValue.textContent = `${settings.fontSize}px`;
  }
  if (settings.lineSpacing) {
    lineSpacingSlider.value = settings.lineSpacing.toString();
    lineSpacingValue.textContent = settings.lineSpacing.toFixed(1);
  }
  if (settings.verseLayout) verseLayoutSelect.value = settings.verseLayout;

  // Update slider value displays
  fontSizeSlider.addEventListener('input', () => {
    fontSizeValue.textContent = `${fontSizeSlider.value}px`;
  });
  lineSpacingSlider.addEventListener('input', () => {
    lineSpacingValue.textContent = parseFloat(lineSpacingSlider.value).toFixed(1);
  });

  // Apply current settings immediately
  applyDisplaySettings();
}

function applyDisplaySettings() {
  const settings = getSettings();
  
  // Apply theme
  const theme = settings.theme || 'light';
  if (theme === 'dark') {
    document.body.classList.add('dark-theme');
    document.body.classList.remove('light-theme');
  } else {
    document.body.classList.add('light-theme');
    document.body.classList.remove('dark-theme');
  }

  // Apply font size (base verse font size)
  const fontSize = settings.fontSize || 15;
  document.documentElement.style.setProperty('--base-font-size', `${fontSize}px`);

  // Apply line spacing
  const lineSpacing = settings.lineSpacing || 1.5;
  document.documentElement.style.setProperty('--line-spacing', lineSpacing.toString());

  // Verse layout will be applied when rendering verses
}

document.getElementById('saveSettings')?.addEventListener('click', () => {
  const ddEnglishOT = (document.getElementById('ddEnglishOT') as HTMLSelectElement).value;
  const ddEnglishNT = (document.getElementById('ddEnglishNT') as HTMLSelectElement).value;
  const ddHebrewOT = (document.getElementById('ddHebrewOT') as HTMLSelectElement).value;
  const ddHebrewNT = (document.getElementById('ddHebrewNT') as HTMLSelectElement).value;
  const ddGreekOT = (document.getElementById('ddGreekOT') as HTMLSelectElement).value;
  const ddGreekNT = (document.getElementById('ddGreekNT') as HTMLSelectElement).value;
  
  const theme = (document.getElementById('themeSelect') as HTMLSelectElement).value as 'light' | 'dark';
  const fontSize = parseInt((document.getElementById('fontSizeSlider') as HTMLInputElement).value);
  const lineSpacing = parseFloat((document.getElementById('lineSpacingSlider') as HTMLInputElement).value);
  const verseLayout = (document.getElementById('verseLayoutSelect') as HTMLSelectElement).value as 'one-per-line' | 'paragraph';
  
  updateSettings({
    dailyDriverEnglishOT: ddEnglishOT || undefined,
    dailyDriverEnglishNT: ddEnglishNT || undefined,
    dailyDriverHebrewOT: ddHebrewOT || undefined,
    dailyDriverHebrewNT: ddHebrewNT || undefined,
    dailyDriverGreekOT: ddGreekOT || undefined,
    dailyDriverGreekNT: ddGreekNT || undefined,
    theme,
    fontSize,
    lineSpacing,
    verseLayout
  });
  
  // Apply settings immediately
  applyDisplaySettings();
  
  // Show saved confirmation
  const savedSpan = document.getElementById('settingsSaved')!;
  savedSpan.style.display = 'inline';
  setTimeout(() => { savedSpan.style.display = 'none'; }, 2000);
});

// Open Polished Version button
document.getElementById('openPolishedBtn')?.addEventListener('click', () => {
  window.open('http://localhost:5174', '_blank');
});

// ===== Reading Plan Handlers =====

// Tab switching
document.getElementById('tabCreatePlan')?.addEventListener('click', () => {
  document.querySelectorAll('.plan-tab').forEach(tab => {
    tab.classList.remove('active');
    (tab as HTMLElement).style.borderBottomColor = 'transparent';
  });
  document.querySelectorAll('.plan-tab-content').forEach(content => {
    (content as HTMLElement).style.display = 'none';
  });
  
  const tab = document.getElementById('tabCreatePlan')!;
  tab.classList.add('active');
  tab.style.borderBottomColor = '#2c5f8d';
  document.getElementById('createPlanTab')!.style.display = 'block';
});

document.getElementById('tabActivePlan')?.addEventListener('click', () => {
  document.querySelectorAll('.plan-tab').forEach(tab => {
    tab.classList.remove('active');
    (tab as HTMLElement).style.borderBottomColor = 'transparent';
  });
  document.querySelectorAll('.plan-tab-content').forEach(content => {
    (content as HTMLElement).style.display = 'none';
  });
  
  const tab = document.getElementById('tabActivePlan')!;
  tab.classList.add('active');
  tab.style.borderBottomColor = '#2c5f8d';
  document.getElementById('activePlanTab')!.style.display = 'block';
});

document.getElementById('tabPlanHistory')?.addEventListener('click', () => {
  document.querySelectorAll('.plan-tab').forEach(tab => {
    tab.classList.remove('active');
    (tab as HTMLElement).style.borderBottomColor = 'transparent';
  });
  document.querySelectorAll('.plan-tab-content').forEach(content => {
    (content as HTMLElement).style.display = 'none';
  });
  
  const tab = document.getElementById('tabPlanHistory')!;
  tab.classList.add('active');
  tab.style.borderBottomColor = '#2c5f8d';
  document.getElementById('planHistoryTab')!.style.display = 'block';
  
  // Load plan history when tab is shown
  renderPlanHistory();
});

// Show/hide custom options when preset changes
document.getElementById('planPreset')?.addEventListener('change', (e) => {
  const value = (e.target as HTMLSelectElement).value;
  const customOptions = document.getElementById('customPlanOptions')!;
  customOptions.style.display = value === '' ? 'block' : 'none';
});

// Show/hide randomize options for daily Psalm/Proverb
document.getElementById('optDailyPsalm')?.addEventListener('change', (e) => {
  const checked = (e.target as HTMLInputElement).checked;
  const randomOpt = document.getElementById('psalmsRandomOpt')!;
  randomOpt.style.display = checked ? 'block' : 'none';
});

document.getElementById('optDailyProverb')?.addEventListener('change', (e) => {
  const checked = (e.target as HTMLInputElement).checked;
  const randomOpt = document.getElementById('proverbsRandomOpt')!;
  randomOpt.style.display = checked ? 'block' : 'none';
});

// Generate Plan button
document.getElementById('generatePlanBtn')?.addEventListener('click', async () => {
  const statusDiv = document.getElementById('planGenerationStatus')!;
  statusDiv.textContent = 'Generating plan...';
  statusDiv.style.color = '#666';
  
  try {
    const preset = (document.getElementById('planPreset') as HTMLSelectElement).value;
    
    // Get configuration from form
    const config: ReadingPlanConfig = preset === '' 
      ? await buildCustomPlanConfig() 
      : buildPresetPlanConfig(preset);
    
    // Generate the plan
    statusDiv.textContent = 'Calculating reading schedule...';
    currentReadingPlan = generateReadingPlan(config);
    
    // Generate a plan ID
    currentPlanId = `plan_${Date.now()}`;
    
    // Save to storage and history
    saveActivePlan();
    savePlanToHistory(currentReadingPlan, currentPlanId);
    
    statusDiv.textContent = `✓ Plan created! ${currentReadingPlan.totalDays} days, ${currentReadingPlan.totalChapters} chapters`;
    statusDiv.style.color = '#2c5f8d';
    
    // Switch to Active Plan tab to show the generated plan
    setTimeout(() => {
      document.getElementById('tabActivePlan')?.click();
      renderActivePlan();
    }, 1000);
    
  } catch (error) {
    statusDiv.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`;
    statusDiv.style.color = '#d32f2f';
  }
});

// Build custom plan configuration from form
async function buildCustomPlanConfig(): Promise<ReadingPlanConfig> {
  const startDate = new Date((document.getElementById('planStartDate') as HTMLInputElement).value);
  const endDate = new Date((document.getElementById('planEndDate') as HTMLInputElement).value);
  
  // Get excluded weekdays
  const excludedWeekdays: number[] = [];
  if (!(document.getElementById('daySun') as HTMLInputElement).checked) excludedWeekdays.push(0);
  if (!(document.getElementById('dayMon') as HTMLInputElement).checked) excludedWeekdays.push(1);
  if (!(document.getElementById('dayTue') as HTMLInputElement).checked) excludedWeekdays.push(2);
  if (!(document.getElementById('dayWed') as HTMLInputElement).checked) excludedWeekdays.push(3);
  if (!(document.getElementById('dayThu') as HTMLInputElement).checked) excludedWeekdays.push(4);
  if (!(document.getElementById('dayFri') as HTMLInputElement).checked) excludedWeekdays.push(5);
  if (!(document.getElementById('daySat') as HTMLInputElement).checked) excludedWeekdays.push(6);
  
  // Get selected books
  const bookCheckboxes = Array.from(document.querySelectorAll('#bookGrid input[type="checkbox"]:checked')) as HTMLInputElement[];
  const selectedBooks = bookCheckboxes.map(cb => ({ book: cb.value }));
  
  if (selectedBooks.length === 0) {
    throw new Error('Please select at least one book');
  }
  
  // Get ordering
  const orderingRadio = document.querySelector('input[name="ordering"]:checked') as HTMLInputElement;
  const ordering = (orderingRadio?.value || 'canonical') as 'canonical' | 'chronological' | 'shuffled';
  
  return {
    startDate,
    endDate,
    excludedWeekdays: excludedWeekdays.length > 0 ? excludedWeekdays : undefined,
    books: selectedBooks,
    ordering,
    dailyPsalm: (document.getElementById('optDailyPsalm') as HTMLInputElement).checked,
    randomizePsalms: (document.getElementById('optRandomizePsalms') as HTMLInputElement).checked,
    dailyProverb: (document.getElementById('optDailyProverb') as HTMLInputElement).checked,
    randomizeProverbs: (document.getElementById('optRandomizeProverbs') as HTMLInputElement).checked,
    reverseOrder: (document.getElementById('optReverseOrder') as HTMLInputElement).checked,
    showOverallStats: (document.getElementById('optShowOverallStats') as HTMLInputElement).checked,
    showDailyStats: (document.getElementById('optShowDailyStats') as HTMLInputElement).checked
  };
}

// Build preset plan configuration
function buildPresetPlanConfig(preset: string): ReadingPlanConfig {
  const today = new Date();
  const oneYearLater = new Date(today);
  oneYearLater.setFullYear(today.getFullYear() + 1);
  
  const ninetyDaysLater = new Date(today);
  ninetyDaysLater.setDate(today.getDate() + 90);
  
  const thirtyDaysLater = new Date(today);
  thirtyDaysLater.setDate(today.getDate() + 30);
  
  switch (preset) {
    case 'bible-1-year':
      return {
        startDate: today,
        endDate: oneYearLater,
        books: BIBLE_BOOKS_INFO.map(b => ({ book: b.name })),
        ordering: 'canonical',
        showOverallStats: true,
        showDailyStats: true
      };
      
    case 'nt-90-days':
      return {
        startDate: today,
        endDate: ninetyDaysLater,
        books: BIBLE_BOOKS_INFO.filter(b => b.testament === 'NT').map(b => ({ book: b.name })),
        ordering: 'canonical',
        showOverallStats: true,
        showDailyStats: true
      };
      
    case 'gospels-30-days':
      return {
        startDate: today,
        endDate: thirtyDaysLater,
        books: ['Matthew', 'Mark', 'Luke', 'John'].map(book => ({ book })),
        ordering: 'canonical',
        showOverallStats: true,
        showDailyStats: true
      };
      
    case 'chronological-1-year':
      return {
        startDate: today,
        endDate: oneYearLater,
        books: BIBLE_BOOKS_INFO.map(b => ({ book: b.name })),
        ordering: 'chronological',
        showOverallStats: true,
        showDailyStats: true
      };
      
    case 'psalms-proverbs':
      return {
        startDate: today,
        endDate: new Date(today.getTime() + 150 * 24 * 60 * 60 * 1000), // 150 days
        books: [{ book: 'Psalms' }, { book: 'Proverbs' }],
        ordering: 'canonical',
        showOverallStats: true,
        showDailyStats: true
      };
      
    default:
      throw new Error('Unknown preset: ' + preset);
  }
}

// Render active plan (calendar and list views)
function renderActivePlan() {
  const container = document.getElementById('activePlanContent')!;
  
  if (!currentReadingPlan) {
    container.innerHTML = '<p style="color: #666;">No active plan. Create one to get started!</p>';
    return;
  }
  
  const plan = currentReadingPlan;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  // Find today's day in the plan
  const todayIndex = plan.days.findIndex(day => {
    const dayDate = new Date(day.date);
    dayDate.setHours(0, 0, 0, 0);
    return dayDate.getTime() === today.getTime();
  });
  
  const todayDay = todayIndex >= 0 ? plan.days[todayIndex] : null;
  
  // Overall stats with delete button
  let statsHtml = '';
  if (plan.config.showOverallStats) {
    statsHtml = `
      <div class="content-section" style="padding: 15px; border-radius: 8px; margin-bottom: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
          <h3 style="margin: 0; font-size: 16px;">📊 Plan Overview</h3>
          <button id="deletePlanBtn" style="padding: 6px 12px; background: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 13px;">🗑️ Delete Plan</button>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px;">
          <div><strong>Total Days:</strong> ${plan.totalDays}</div>
          <div><strong>Total Chapters:</strong> ${plan.totalChapters}</div>
          <div><strong>Avg/Day:</strong> ${plan.avgChaptersPerDay.toFixed(1)} chapters</div>
          <div><strong>Start:</strong> ${new Date(plan.config.startDate).toLocaleDateString()}</div>
          <div><strong>End:</strong> ${new Date(plan.config.endDate).toLocaleDateString()}</div>
        </div>
      </div>
    `;
  } else {
    // If stats hidden, still show delete button
    statsHtml = `
      <div style="text-align: right; margin-bottom: 20px;">
        <button id="deletePlanBtn" style="padding: 6px 12px; background: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 13px;">🗑️ Delete Plan</button>
      </div>
    `;
  }
  
  // Today's reading
  let todayHtml = '';
  if (todayDay) {
    const chaptersLinks = todayDay.chapters.map(c => `<a href="#" onclick="navigateToChapter('${c.book}', ${c.chapter}); return false;" style="text-decoration: none; color: #4caf50; font-weight: 500; border-bottom: 1px dotted currentColor;">${c.book} ${c.chapter}</a>`).join(', ');
    todayHtml = `
      <div style="background: #d4edda; padding: 15px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #4caf50;">
        <h3 style="margin: 0 0 10px 0; font-size: 16px; color: #155724;">📖 Today's Reading (Day ${todayDay.dayNumber})</h3>
        <p style="margin: 5px 0; font-size: 15px; color: #155724;">${chaptersLinks}</p>
        <p style="margin: 5px 0; font-size: 13px; color: #155724; opacity: 0.8;">${todayDay.chapters.length} chapters</p>
        <button onclick="navigateToChapter('${todayDay.chapters[0].book}', ${todayDay.chapters[0].chapter})" style="margin-top: 10px; padding: 8px 16px; background: #4caf50; color: white; border: none; border-radius: 4px; cursor: pointer;">
          Start Reading →
        </button>
      </div>
    `;
  } else {
    todayHtml = `
      <div class="content-section" style="padding: 15px; border-radius: 8px; margin-bottom: 20px; opacity: 0.7;">
        <p style="margin: 0;">Today is not a reading day in this plan.</p>
      </div>
    `;
  }
  
  // View toggle
  const viewToggle = `
    <div style="margin-bottom: 15px;">
      <button id="viewCalendar" class="view-toggle active action-btn" style="padding: 8px 16px; margin-right: 10px; background: #2c5f8d; color: white; border-radius: 4px; cursor: pointer;">Calendar View</button>
      <button id="viewList" class="view-toggle action-btn" style="padding: 8px 16px; border-radius: 4px; cursor: pointer;">List View</button>
    </div>
  `;
  
  // Calendar view (simple list for now, calendar grid can be added later)
  const calendarView = renderCalendarView(plan);
  const listView = renderListView(plan);
  
  container.innerHTML = statsHtml + todayHtml + viewToggle + 
    `<div id="calendarViewContent">${calendarView}</div>` +
    `<div id="listViewContent" style="display: none;">${listView}</div>`;
  
  // Add view toggle handlers
  document.getElementById('viewCalendar')?.addEventListener('click', () => {
    document.querySelectorAll('.view-toggle').forEach(btn => {
      btn.classList.remove('active');
      (btn as HTMLButtonElement).style.background = '';
      (btn as HTMLButtonElement).style.color = '';
    });
    const btn = document.getElementById('viewCalendar') as HTMLButtonElement;
    btn.classList.add('active');
    btn.style.background = '#2c5f8d';
    btn.style.color = 'white';
    document.getElementById('calendarViewContent')!.style.display = 'block';
    document.getElementById('listViewContent')!.style.display = 'none';
  });
  
  document.getElementById('viewList')?.addEventListener('click', () => {
    document.querySelectorAll('.view-toggle').forEach(btn => {
      btn.classList.remove('active');
      (btn as HTMLButtonElement).style.background = '';
      (btn as HTMLButtonElement).style.color = '';
    });
    const btn = document.getElementById('viewList') as HTMLButtonElement;
    btn.classList.add('active');
    btn.style.background = '#2c5f8d';
    btn.style.color = 'white';
    document.getElementById('calendarViewContent')!.style.display = 'none';
    document.getElementById('listViewContent')!.style.display = 'block';
  });
  
  // Add delete button handler
  document.getElementById('deletePlanBtn')?.addEventListener('click', () => {
    deleteCurrentPlan();
  });
}

// Render calendar view
function renderCalendarView(plan: ReadingPlan): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  let html = '<div style="max-height: 500px; overflow-y: auto; padding: 10px;">';
  
  // Group by month
  const daysByMonth = new Map<string, typeof plan.days>();
  plan.days.forEach(day => {
    const date = new Date(day.date);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (!daysByMonth.has(monthKey)) {
      daysByMonth.set(monthKey, []);
    }
    daysByMonth.get(monthKey)!.push(day);
  });
  
  daysByMonth.forEach((days, monthKey) => {
    const [year, month] = monthKey.split('-');
    const monthName = new Date(parseInt(year), parseInt(month) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    
    html += `<h4 style="margin: 20px 0 10px 0; padding-bottom: 5px; border-bottom: 2px solid;">${monthName}</h4>`;
    html += '<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px;">';
    
    days.forEach(day => {
      const dayDate = new Date(day.date);
      dayDate.setHours(0, 0, 0, 0);
      const isToday = dayDate.getTime() === today.getTime();
      const isPast = dayDate < today;
      
      const cardClass = isToday ? 'plan-today' : (isPast ? 'plan-past' : 'plan-future');
      const borderColor = isToday ? '#4caf50' : 'var(--border-color, #ddd)';
      
      const chaptersLinks = day.chapters.map(c => `<a href="#" onclick="navigateToChapter('${c.book}', ${c.chapter}); return false;" style="text-decoration: none; color: inherit; border-bottom: 1px dotted currentColor;">${c.book} ${c.chapter}</a>`).join(', ');
      const dateStr = dayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      
      html += `
        <div class="content-section ${cardClass}" style="padding: 10px; border: 1px solid ${borderColor}; border-radius: 4px; font-size: 13px;">
          <div style="font-weight: 600; margin-bottom: 5px;">${dateStr} (Day ${day.dayNumber})</div>
          <div style="font-size: 12px; opacity: 0.9;">${chaptersLinks}</div>
        </div>
      `;
    });
    
    html += '</div>';
  });
  
  html += '</div>';
  return html;
}

// Render list view
function renderListView(plan: ReadingPlan): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  let html = '<div style="max-height: 500px; overflow-y: auto;">';
  html += '<table style="width: 100%; border-collapse: collapse;">';
  html += '<thead><tr class="list-container" style="position: sticky; top: 0;"><th style="padding: 10px; text-align: left; border: 1px solid;">Day</th><th style="padding: 10px; text-align: left; border: 1px solid;">Date</th><th style="padding: 10px; text-align: left; border: 1px solid;">Reading</th></tr></thead>';
  html += '<tbody>';
  
  plan.days.forEach(day => {
    const dayDate = new Date(day.date);
    dayDate.setHours(0, 0, 0, 0);
    const isToday = dayDate.getTime() === today.getTime();
    
    const rowClass = isToday ? 'plan-today' : '';
    const chaptersLinks = day.chapters.map(c => `<a href="#" onclick="navigateToChapter('${c.book}', ${c.chapter}); return false;" style="text-decoration: none; color: inherit; border-bottom: 1px dotted currentColor;">${c.book} ${c.chapter}</a>`).join(', ');
    const dateStr = dayDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    
    html += `
      <tr class="${rowClass}">
        <td style="padding: 10px; border: 1px solid; font-weight: ${isToday ? '600' : 'normal'};">${day.dayNumber}</td>
        <td style="padding: 10px; border: 1px solid;">${dateStr}</td>
        <td style="padding: 10px; border: 1px solid; font-size: 13px;">${chaptersLinks}</td>
      </tr>
    `;
  });
  
  html += '</tbody></table></div>';
  return html;
}

// Book selection helpers
document.getElementById('selectAllBooks')?.addEventListener('click', () => {
  document.querySelectorAll('#bookGrid input[type="checkbox"]').forEach(cb => {
    (cb as HTMLInputElement).checked = true;
  });
});

document.getElementById('selectNone')?.addEventListener('click', () => {
  document.querySelectorAll('#bookGrid input[type="checkbox"]').forEach(cb => {
    (cb as HTMLInputElement).checked = false;
  });
});

document.getElementById('selectOT')?.addEventListener('click', () => {
  document.querySelectorAll('#bookGrid input[type="checkbox"]').forEach(cb => {
    const input = cb as HTMLInputElement;
    const bookName = input.value;
    const isOT = OT_BOOKS.includes(bookName);
    input.checked = isOT;
  });
});

document.getElementById('selectNT')?.addEventListener('click', () => {
  document.querySelectorAll('#bookGrid input[type="checkbox"]').forEach(cb => {
    const input = cb as HTMLInputElement;
    const bookName = input.value;
    const isNT = NT_BOOKS.includes(bookName);
    input.checked = isNT;
  });
});

// Initialize book grid
function initializeBookGrid() {
  const bookGrid = document.getElementById('bookGrid');
  if (!bookGrid) return;
  
  const allBooks = [...OT_BOOKS, ...NT_BOOKS];
  bookGrid.innerHTML = allBooks.map(book => `
    <label class="content-section" style="display: flex; align-items: center; padding: 6px; border-radius: 4px; cursor: pointer;">
      <input type="checkbox" value="${book}" checked style="margin-right: 6px;" />
      <span style="font-size: 13px;">${book}</span>
    </label>
  `).join('');
}

// Initialize on page load
setTimeout(() => {
  initializeBookGrid();
  
  // Set default dates (today + 1 year)
  const today = new Date();
  const oneYearLater = new Date(today);
  oneYearLater.setFullYear(today.getFullYear() + 1);
  
  const startInput = document.getElementById('planStartDate') as HTMLInputElement;
  const endInput = document.getElementById('planEndDate') as HTMLInputElement;
  
  if (startInput) startInput.value = today.toISOString().split('T')[0];
  if (endInput) endInput.value = oneYearLater.toISOString().split('T')[0];
  
  // Load active reading plan from storage
  loadActivePlan();
  
  // Load chronological pack
  loadChronologicalPack();
}, 100);

// Navigate to chapter from reading plan
function navigateToChapter(book: string, chapter: number) {
  // Switch to Read Verse tab
  const tabs = document.querySelectorAll('.nav-tab');
  const contents = document.querySelectorAll('.tab-content');
  
  tabs.forEach(tab => {
    tab.classList.remove('active');
    (tab as HTMLElement).style.borderBottomColor = 'transparent';
  });
  
  contents.forEach(content => {
    (content as HTMLElement).style.display = 'none';
  });
  
  const readTab = document.querySelector('[onclick*="readVerseTab"]') as HTMLElement;
  if (readTab) {
    readTab.classList.add('active');
    readTab.style.borderBottomColor = '#2c5f8d';
  }
  
  document.getElementById('readVerseTab')!.style.display = 'block';
  
  // Set the book and chapter
  (document.getElementById('book') as HTMLSelectElement).value = book;
  (document.getElementById('chapter') as HTMLSelectElement).value = String(chapter);
  (document.getElementById('verse') as HTMLSelectElement).value = '1';
  
  // Trigger read
  document.getElementById('readVerse')?.click();
  
  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Make navigateToChapter globally available for onclick handlers
(window as any).navigateToChapter = navigateToChapter;

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
                <div style="padding: 8px; margin: 5px 0; background: #f0f0f0; border-radius: 4px; font-size: 13px;">
                  <a href="#" onclick="${viewAction} return false;" 
                     style="color: #0066cc; text-decoration: none; font-weight: 500;">${toRef}</a>
                  ${!exists ? `<span style="color: #ff6b6b; font-size: 11px; margin-left: 8px;">(view in ${dailyDriver.toUpperCase()})</span>` : ''}
                  ${ref.description ? `<div style="color: #555; font-size: 12px; margin-top: 3px;">${ref.description}</div>` : ''}
                </div>
              `;
            }).join('')}
          </div>
        `;
      }
      
      resultDiv.innerHTML = renderBackButtonHtml() + html;
      setCurrentReadingLocation({ translation, book, chapter, verse, mode: 'verse' });
    } else {
      resultDiv.innerHTML = `<em style="color: #555;">Verse not found</em>`;
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
      <button onclick="goBackToPreviousReading(); return false;" style="padding: 6px 10px; border: 1px solid #ccc; border-radius: 6px; background: #e5e5e5; cursor: pointer; font-size: 13px;">← Back</button>
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
  if (translation === 'web' || translation === 'bsb') extraClass = ' translation-font-web';
  if (translation === 'kjv' || translation === 'kjvpce') extraClass = ' translation-font-kjv';
  if (!extraClass && isGreek) extraClass = ' translation-font-greek';
  return `<span class="verse-words${extraClass}" data-translation="${escapeHtml(translation)}">${html}</span>`;
}

function getHeadingFontClass(translationId: string): string {
  const t = (translationId || '').toLowerCase();
  if (t === 'kjv' || t === 'kjvpce') return 'heading-font-kjv';
  if (t === 'web' || t === 'bsb') return 'heading-font-web';
  if (isGreekTranslationId(t)) return 'heading-font-greek';
  return '';
}

/**
 * Detect if a note string is a cross-reference (contains Bible book + chapter:verse)
 * vs a footnote (explanatory text).
 */
function isCrossReference(noteText: string): boolean {
  const trimmed = noteText.trim();
  
  // Footnote indicators - if it starts with these, it's explanatory text, not a cross-ref
  // Even if it mentions a Bible verse later (like "cited in Acts 11:16")
  const footnoteStarters = [
    /^Or\b/i,           // Textual variant: "Or For John baptized..."
    /^Lit\b/i,          // Literal translation: "Lit. seed"
    /^I\.e\./i,         // Explanation: "I.e., ..."
    /^That is/i,        // Explanation
    /^Some manuscripts/i,
    /^Other manuscripts/i,
    /^DSS/i,            // Dead Sea Scrolls
    /^LXX/i,            // Septuagint variant
    /^Heb\b/i,          // Hebrew note
    /^Gr\b/i,           // Greek note
    /^Aram\b/i,         // Aramaic note
    /^Cited/i,          // "Cited in..."
    /^See /i,           // "See also..."
    /^Compare/i,
    /^Literally/i,
  ];
  
  if (footnoteStarters.some(pattern => pattern.test(trimmed))) {
    return false; // It's a footnote, not a cross-reference
  }
  
  // Common Bible book names/abbreviations that indicate a cross-reference
  const bookPatterns = [
    /\b(Genesis|Gen|Exodus|Exod?|Leviticus|Lev|Numbers|Num|Deuteronomy|Deut?)\b/i,
    /\b(Joshua|Josh?|Judges|Judg?|Ruth|1\s*Samuel|1\s*Sam|2\s*Samuel|2\s*Sam)\b/i,
    /\b(1\s*Kings?|2\s*Kings?|1\s*Chronicles|1\s*Chron?|2\s*Chronicles|2\s*Chron?)\b/i,
    /\b(Ezra|Nehemiah|Neh|Esther|Esth?|Job|Psalms?|Ps|Proverbs?|Prov?)\b/i,
    /\b(Ecclesiastes|Eccl?|Song|Songs|Isaiah|Isa|Jeremiah|Jer|Lamentations|Lam)\b/i,
    /\b(Ezekiel|Ezek?|Daniel|Dan|Hosea|Hos|Joel|Amos|Obadiah|Obad?|Jonah)\b/i,
    /\b(Micah|Mic|Nahum|Nah|Habakkuk|Hab|Zephaniah|Zeph|Haggai|Hag|Zechariah|Zech|Malachi|Mal)\b/i,
    /\b(Matthew|Matt?|Mark|Luke|John|Jn|Acts|Romans?|Rom|1\s*Corinthians|1\s*Cor)\b/i,
    /\b(2\s*Corinthians|2\s*Cor|Galatians|Gal|Ephesians|Eph|Philippians|Phil)\b/i,
    /\b(Colossians|Col|1\s*Thessalonians|1\s*Thess?|2\s*Thessalonians|2\s*Thess?)\b/i,
    /\b(1\s*Timothy|1\s*Tim|2\s*Timothy|2\s*Tim|Titus|Tit|Philemon|Phlm?|Hebrews|Heb)\b/i,
    /\b(James|Jas|1\s*Peter|1\s*Pet|2\s*Peter|2\s*Pet|1\s*John|1\s*Jn|2\s*John|2\s*Jn)\b/i,
    /\b(3\s*John|3\s*Jn|Jude|Revelation|Rev)\b/i
  ];
  
  // A pure cross-reference should START with a Bible book name or be a list of refs
  // Not just contain one somewhere in explanatory text
  const startsWithBook = bookPatterns.some(pattern => pattern.test(trimmed.slice(0, 30)));
  const hasChapterVerse = /\d+:\d+/.test(noteText);
  
  // Also check for abbreviated refs like "cf. 12:38" or just verse refs with semicolons
  const looksLikeRefList = /^\s*[\d:;\s,–-]+\s*$/.test(noteText) || /^cf\./i.test(trimmed);
  
  return hasChapterVerse && (startsWithBook || looksLikeRefList);
}

function renderTextWithInlineNotes(text: string): { html: string; noteCount: number } {
  // Converts inline notes like "+ 53:1 John 12:38; Rom 10:16" into clickable superscripts.
  // Cross-references (Bible refs): black [N]
  // Footnotes (explanatory text): blue [N]
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
      
      // Determine if cross-reference (black) or footnote (blue)
      const isXref = isCrossReference(rawNote);
      const noteColor = isXref ? '#333' : '#0066cc';
      const noteType = isXref ? 'Cross-reference' : 'Footnote';
      const noteClass = isXref ? 'inline-note inline-xref' : 'inline-note inline-footnote';
      
      out += `<sup class="${noteClass}" data-note="${encoded}" data-note-index="${noteIndex}" ` +
        `style="color:${noteColor}; cursor:pointer; font-size:11px; margin:0 2px; user-select:none;" ` +
        `title="${noteType} ${noteIndex}: ${encodedTitle}">[${noteIndex}]</sup>`;
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
      
      const settings = getSettings();
      const verseLayout = settings.verseLayout || 'one-per-line';
      const fontSize = settings.fontSize || 15;
      const lineSpacing = settings.lineSpacing || 1.5;
      
      const headingClass = getHeadingFontClass(translation);
      const headingClasses = ['reader-title', headingClass].filter(Boolean).join(' ');
      
      if (verseLayout === 'paragraph') {
        // Paragraph layout: verses flow together, new lines only for headings
        let paragraphHtml = '';
        let currentParagraph: string[] = [];
        
        const flushParagraph = () => {
          if (currentParagraph.length > 0) {
            paragraphHtml += `<p class="verse-paragraph" style="margin: 8px 0; padding: 8px; line-height: ${lineSpacing}; font-size: ${fontSize}px;">${currentParagraph.join(' ')}</p>`;
            currentParagraph = [];
          }
        };
        
        verses.forEach((v, idx) => {
          const hasCrossRefs = verseCrossRefs[idx].length > 0;
          const verseKey = `${book}:${chapter}:${v.verse}`;
          const isSelected = selectedVerses.has(verseKey);
          const wordsHtml = renderVerseWordsHtml(v.text);
          
          // If there's a heading, flush current paragraph and add heading
          if (v.heading) {
            flushParagraph();
            paragraphHtml += `<div class="section-heading" style="font-family: 'Cinzel', serif; font-weight: 700; font-size: 1.15em; color: #2c3e50; margin: 20px 0 10px 0; padding-top: 12px; border-top: 1px solid #ddd;">${escapeHtml(v.heading)}</div>`;
          }
          
          // Add verse to current paragraph
          const verseSpan = `<span class="verse-span" data-book="${book}" data-chapter="${chapter}" data-verse="${v.verse}" style="cursor: pointer; background: ${isSelected ? '#ffffcc' : 'transparent'}; padding: 2px 4px; border-radius: 2px; transition: background 0.2s;">` +
            `<sup style="color: #555; cursor: ${hasCrossRefs ? 'pointer' : 'default'}; font-size: 11px;" ` +
            `${hasCrossRefs ? `onclick="event.stopPropagation(); showCrossReferences('${book}', ${chapter}, ${v.verse}, event)" title="View ${verseCrossRefs[idx].length} cross-reference(s)"` : ''}>` +
            `${v.verse}${hasCrossRefs ? ' 🔗' : ''}</sup> ${wordsHtml}</span>`;
          
          currentParagraph.push(verseSpan);
        });
        
        flushParagraph();
        
        resultDiv.innerHTML = `
          ${renderBackButtonHtml()}
          <h3 class="${headingClasses}">${book} ${chapter}</h3>
          ${paragraphHtml}
        `;
      } else {
        // One-per-line layout (original)
        resultDiv.innerHTML = `
          ${renderBackButtonHtml()}
          <h3 class="${headingClasses}">${book} ${chapter}</h3>
          ${verses.map((v, idx) => {
            const hasCrossRefs = verseCrossRefs[idx].length > 0;
            const verseKey = `${book}:${chapter}:${v.verse}`;
            const isSelected = selectedVerses.has(verseKey);
            const wordsHtml = renderVerseWordsHtml(v.text);
            
            // Render section heading if present - Cinzel font, bold
            const headingHtml = v.heading 
              ? `<div class="section-heading" style="font-family: 'Cinzel', serif; font-weight: 700; font-size: 1.15em; color: #2c3e50; margin: 20px 0 10px 0; padding-top: 12px; border-top: 1px solid #ddd;">${escapeHtml(v.heading)}</div>`
              : '';
            
            return `
              ${headingHtml}
              <p class="verse-text" 
                 data-book="${book}" 
                 data-chapter="${chapter}" 
                 data-verse="${v.verse}"
                 style="margin: 8px 0; padding: 8px; border-radius: 4px; cursor: pointer; background: ${isSelected ? '#ffffcc' : 'transparent'}; transition: background 0.2s; line-height: ${lineSpacing}; font-size: ${fontSize}px;">
                <sup style="color: #555; cursor: ${hasCrossRefs ? 'pointer' : 'default'};" 
                     ${hasCrossRefs ? `onclick="event.stopPropagation(); showCrossReferences('${book}', ${chapter}, ${v.verse}, event)" title="View ${verseCrossRefs[idx].length} cross-reference(s)"` : ''}>
                  ${v.verse}${hasCrossRefs ? ' 🔗' : ''}
                </sup> 
                ${wordsHtml}
              </p>
            `;
          }).join('')}
        `;
      }
      
      // Attach verse selection handlers
      attachVerseSelectionHandlers();
      setCurrentReadingLocation({ translation, book, chapter, verse: 1, mode: 'chapter' });
    } else {
      resultDiv.innerHTML = `<em style="color: #555;">Chapter not found</em>`;
    }
  } catch (error) {
    resultDiv.innerHTML = `<span style="color: red;">Error: ${error instanceof Error ? error.message : 'Unknown'}</span>`;
    console.error(error);
  }
});

// Chronological mode checkbox handler
document.getElementById('chronologicalMode')?.addEventListener('change', async (e) => {
  const checkbox = e.target as HTMLInputElement;
  isChronologicalMode = checkbox.checked;
  
  if (isChronologicalMode && !chronologicalData) {
    await loadChronologicalPack();
  }
  
  // Update UI - disable/enable book dropdown in chronological mode
  const bookDropdown = document.getElementById('book') as HTMLSelectElement;
  const chapterDropdown = document.getElementById('chapter') as HTMLSelectElement;
  
  if (isChronologicalMode) {
    // In chronological mode, we start from the beginning
    if (chronologicalData) {
      const firstVerse = chronologicalData.verses[0];
      currentChronoIndex = 0;
      
      bookDropdown.value = firstVerse.book;
      chapterDropdown.value = String(firstVerse.chapter);
      
      // Auto-load first chapter in chronological order
      document.getElementById('readChapter')?.click();
    }
  }
});

// Scroll detection for continuous reading
let scrollCheckInterval: number | null = null;
let isLoadingNextChapter = false;

function startScrollDetection() {
  if (scrollCheckInterval) return;
  
  scrollCheckInterval = window.setInterval(() => {
    if (isLoadingNextChapter) return;
    
    const scrollPosition = window.scrollY + window.innerHeight;
    const documentHeight = document.documentElement.scrollHeight;
    
    // If within 200px of bottom, load next chapter
    if (scrollPosition >= documentHeight - 200) {
      loadNextChapter();
    }
  }, 500);
}

function stopScrollDetection() {
  if (scrollCheckInterval) {
    clearInterval(scrollCheckInterval);
    scrollCheckInterval = null;
  }
}

async function loadNextChapter() {
  if (isLoadingNextChapter) return;
  isLoadingNextChapter = true;
  
  try {
    const translation = (document.getElementById('translation') as HTMLSelectElement).value;
    const currentBook = (document.getElementById('book') as HTMLSelectElement).value;
    const currentChapter = parseInt((document.getElementById('chapter') as HTMLSelectElement).value);
    
    let nextBook = currentBook;
    let nextChapter = currentChapter + 1;
    
    if (isChronologicalMode && chronologicalData) {
      // Find current position in chronological order
      const currentVerseData = chronologicalData.verses.find(
        (v: any) => v.book === currentBook && v.chapter === currentChapter
      );
      
      if (currentVerseData) {
        // Find next chapter in chronological order
        const nextChapterData = chronologicalData.verses.find(
          (v: any) => v.chrono_index > currentVerseData.chrono_index && 
                      (v.book !== currentBook || v.chapter !== currentChapter)
        );
        
        if (nextChapterData) {
          nextBook = nextChapterData.book;
          nextChapter = nextChapterData.chapter;
          currentChronoIndex = nextChapterData.chrono_index;
        } else {
          // Reached end of Bible
          isLoadingNextChapter = false;
          stopScrollDetection();
          return;
        }
      }
    } else {
      // Canonical order - check if we need to move to next book
      const bookInfo = BIBLE_BOOKS_INFO.find(b => b.name === currentBook);
      if (bookInfo && nextChapter > bookInfo.chapters) {
        // Move to next book
        const currentBookIndex = BIBLE_BOOKS_INFO.findIndex(b => b.name === currentBook);
        if (currentBookIndex < BIBLE_BOOKS_INFO.length - 1) {
          nextBook = BIBLE_BOOKS_INFO[currentBookIndex + 1].name;
          nextChapter = 1;
        } else {
          // Reached end of Bible
          isLoadingNextChapter = false;
          stopScrollDetection();
          return;
        }
      }
    }
    
    // Load and append next chapter
    const verses = await textStore.getChapter(translation, nextBook, nextChapter);
    
    if (verses.length > 0) {
      const resultDiv = document.getElementById('verseText')!;
      const settings = getSettings();
      const verseLayout = settings.verseLayout || 'one-per-line';
      const fontSize = settings.fontSize || 15;
      const lineSpacing = settings.lineSpacing || 1.5;
      
      const headingClass = getHeadingFontClass(translation);
      const headingClasses = ['reader-title', headingClass].filter(Boolean).join(' ');
      
      // Get cross-references
      const verseCrossRefs = await Promise.all(
        verses.map(v => crossRefStore.getCrossReferences({ book: nextBook, chapter: nextChapter, verse: v.verse }))
      );
      
      let nextChapterHtml = `<h3 class="${headingClasses}" style="margin-top: 40px; padding-top: 20px; border-top: 2px solid #ccc;">${nextBook} ${nextChapter}</h3>`;
      
      if (verseLayout === 'paragraph') {
        let paragraphHtml = '';
        let currentParagraph: string[] = [];
        
        const flushParagraph = () => {
          if (currentParagraph.length > 0) {
            paragraphHtml += `<p class="verse-paragraph" style="margin: 8px 0; padding: 8px; line-height: ${lineSpacing}; font-size: ${fontSize}px;">${currentParagraph.join(' ')}</p>`;
            currentParagraph = [];
          }
        };
        
        verses.forEach((v, idx) => {
          const hasCrossRefs = verseCrossRefs[idx].length > 0;
          const verseKey = `${nextBook}:${nextChapter}:${v.verse}`;
          const wordsHtml = renderVerseWordsHtml(v.text);
          
          if (v.heading) {
            flushParagraph();
            paragraphHtml += `<div class="section-heading" style="font-family: 'Cinzel', serif; font-weight: 700; font-size: 1.15em; color: #2c3e50; margin: 20px 0 10px 0; padding-top: 12px; border-top: 1px solid #ddd;">${escapeHtml(v.heading)}</div>`;
          }
          
          const verseSpan = `<span class="verse-span" data-book="${nextBook}" data-chapter="${nextChapter}" data-verse="${v.verse}" style="cursor: pointer; padding: 2px 4px; border-radius: 2px;">` +
            `<sup style="color: #555; cursor: ${hasCrossRefs ? 'pointer' : 'default'}; font-size: 11px;" ` +
            `${hasCrossRefs ? `onclick="event.stopPropagation(); showCrossReferences('${nextBook}', ${nextChapter}, ${v.verse}, event)" title="View ${verseCrossRefs[idx].length} cross-reference(s)"` : ''}>` +
            `${v.verse}${hasCrossRefs ? ' 🔗' : ''}</sup> ${wordsHtml}</span>`;
          
          currentParagraph.push(verseSpan);
        });
        
        flushParagraph();
        nextChapterHtml += paragraphHtml;
      } else {
        nextChapterHtml += verses.map((v, idx) => {
          const hasCrossRefs = verseCrossRefs[idx].length > 0;
          const verseKey = `${nextBook}:${nextChapter}:${v.verse}`;
          const wordsHtml = renderVerseWordsHtml(v.text);
          
          const headingHtml = v.heading 
            ? `<div class="section-heading" style="font-family: 'Cinzel', serif; font-weight: 700; font-size: 1.15em; color: #2c3e50; margin: 20px 0 10px 0; padding-top: 12px; border-top: 1px solid #ddd;">${escapeHtml(v.heading)}</div>`
            : '';
          
          return `
            ${headingHtml}
            <p class="verse-text" 
               data-book="${nextBook}" 
               data-chapter="${nextChapter}" 
               data-verse="${v.verse}"
               style="margin: 8px 0; padding: 8px; border-radius: 4px; cursor: pointer; transition: background 0.2s; line-height: ${lineSpacing}; font-size: ${fontSize}px;">
              <sup style="color: #555; cursor: ${hasCrossRefs ? 'pointer' : 'default'};" 
                   ${hasCrossRefs ? `onclick="event.stopPropagation(); showCrossReferences('${nextBook}', ${nextChapter}, ${v.verse}, event)" title="View ${verseCrossRefs[idx].length} cross-reference(s)"` : ''}>\n                ${v.verse}${hasCrossRefs ? ' 🔗' : ''}
              </sup> 
              ${wordsHtml}
            </p>
          `;
        }).join('');
      }
      
      // Append to existing content
      resultDiv.innerHTML += nextChapterHtml;
      
      // Update dropdown values
      (document.getElementById('book') as HTMLSelectElement).value = nextBook;
      (document.getElementById('chapter') as HTMLSelectElement).value = String(nextChapter);
      
      // Reattach verse selection handlers for new content
      attachVerseSelectionHandlers();
    }
  } catch (error) {
    console.error('Error loading next chapter:', error);
  } finally {
    isLoadingNextChapter = false;
  }
}

// Start scroll detection when reading a chapter
const originalReadChapterHandler = document.getElementById('readChapter');
if (originalReadChapterHandler) {
  originalReadChapterHandler.addEventListener('click', () => {
    // Delay to let content render first
    setTimeout(() => {
      startScrollDetection();
    }, 500);
  });
}

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
        <p style="color: #555;">No cross-references available for this verse.</p>
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
              <div style="padding: 10px; margin: 8px 0; background: #f0f0f0; border-radius: 4px;">
                <a href="#" onclick="${viewAction} return false;" 
                   style="color: #0066cc; text-decoration: none; font-weight: 500; font-size: 14px;">${toRef}</a>
                ${!exists ? `<span style="color: #ff6b6b; font-size: 11px; margin-left: 8px;">(view in ${dailyDriver.toUpperCase()})</span>` : ''}
                ${ref.description ? `<div style="color: #555; font-size: 13px; margin-top: 5px;">${ref.description}</div>` : ''}
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

// Bible book names pattern - directly match known book names followed by chapter:verse
const BIBLE_BOOK_NAMES_RE = /\b((?:[1-3]\s*)?(?:Genesis|Gen|Exodus|Exod?|Leviticus|Lev|Numbers|Num|Deuteronomy|Deut|Joshua|Josh|Judges|Judg|Ruth|Samuel|Sam|Kings|Ki|Chronicles|Chron|Ezra|Nehemiah|Neh|Esther|Esth|Job|Psalms?|Ps|Proverbs?|Prov|Ecclesiastes|Eccl|Song|Songs|Isaiah|Isa|Jeremiah|Jer|Lamentations|Lam|Ezekiel|Ezek|Daniel|Dan|Hosea|Hos|Joel|Amos|Obadiah|Obad|Jonah|Micah|Mic|Nahum|Nah|Habakkuk|Hab|Zephaniah|Zeph|Haggai|Hag|Zechariah|Zech|Malachi|Mal|Matthew|Matt|Mark|Luke|John|Jn|Acts|Romans|Rom|Corinthians|Cor|Galatians|Gal|Ephesians|Eph|Philippians|Phil|Colossians|Col|Thessalonians|Thess|Timothy|Tim|Titus|Tit|Philemon|Phlm|Hebrews|Heb|James|Jas|Peter|Pet|Jude|Revelation|Rev))\.?\s+(\d+):(\d+(?:[\-\u2013]\d+)?(?:,\s*\d+)*)\b/gi;

function parseFootnoteRefs(text: string): FootnoteRefMatch[] {
  const matches: FootnoteRefMatch[] = [];
  const s = text ?? '';
  
  // Reset regex lastIndex
  BIBLE_BOOK_NAMES_RE.lastIndex = 0;
  
  let m: RegExpExecArray | null;
  while ((m = BIBLE_BOOK_NAMES_RE.exec(s)) !== null) {
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

let currentFootnoteState: { noteText: string; expansions: Map<string, FootnoteExpansion>; lastClickedKey: string | null } | null = null;
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
  currentFootnoteState = { noteText, expansions: new Map(), lastClickedKey: null };
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

  // Only navigate if: already expanded AND this is the SAME link clicked consecutively
  if (currentFootnoteState.expansions.has(key) && currentFootnoteState.lastClickedKey === key) {
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

  // Track this click
  currentFootnoteState.lastClickedKey = key;

  // If clicking a different link than what's expanded, clear previous and show new one
  // Clear all existing expansions - we only show ONE expanded verse at a time
  currentFootnoteState.expansions.clear();

  // Expand this reference
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

// 66 canonical books (Protestant Bible)
const CANONICAL_BOOKS = new Set([
  'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy', 'Joshua', 'Judges', 'Ruth',
  '1 Samuel', '2 Samuel', '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles',
  'Ezra', 'Nehemiah', 'Esther', 'Job', 'Psalms', 'Proverbs', 'Ecclesiastes', 'Song of Solomon',
  'Isaiah', 'Jeremiah', 'Lamentations', 'Ezekiel', 'Daniel',
  'Hosea', 'Joel', 'Amos', 'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk', 'Zephaniah', 'Haggai', 'Zechariah', 'Malachi',
  'Matthew', 'Mark', 'Luke', 'John', 'Acts',
  'Romans', '1 Corinthians', '2 Corinthians', 'Galatians', 'Ephesians', 'Philippians', 'Colossians',
  '1 Thessalonians', '2 Thessalonians', '1 Timothy', '2 Timothy', 'Titus', 'Philemon',
  'Hebrews', 'James', '1 Peter', '2 Peter', '1 John', '2 John', '3 John', 'Jude', 'Revelation'
]);

async function performSearch() {
  const query = (document.getElementById('searchQuery') as HTMLInputElement).value;
  const canonicalOnly = (document.getElementById('canonicalOnly') as HTMLInputElement).checked;
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
    // Always search all translations
    const startTime = Date.now();
    let results = await searchIndex.search(query, undefined);
    
    // Filter by canonical books if requested
    if (canonicalOnly) {
      results = results.filter(r => CANONICAL_BOOKS.has(r.book));
    }
    
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
    
    // Render results with collapsible sections (like VS Code file explorer)
    resultsDiv.innerHTML = Array.from(byTranslation.entries())
      .map(([translation, verses]) => {
        const translationId = translation.replace(/\s+/g, '-');
        return `
        <div style="margin-bottom: 8px; border: 1px solid #ccc; border-radius: 4px; background: #e8e8e8;">
          <div 
            onclick="toggleTranslation('${translationId}')" 
            style="padding: 10px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; background: #ddd; border-radius: 4px;"
            onmouseover="this.style.background='#ccc'" 
            onmouseout="this.style.background='#ddd'"
          >
            <div>
              <span id="icon-${translationId}" style="font-family: monospace; margin-right: 8px;">▶</span>
              <strong style="color: #1e3a5f;">${translation}</strong>
              <span style="color: #666; margin-left: 8px; font-size: 0.9em;">(${verses.length} result${verses.length === 1 ? '' : 's'})</span>
            </div>
          </div>
          <div id="content-${translationId}" style="display: none; padding: 5px 10px 10px 10px;">
            ${verses.map(v => `
              <div style="padding: 10px; margin: 8px 0; background: #f0f0f0; border-radius: 4px; border-left: 3px solid #2c5f8d;">
                <div style="font-weight: bold; color: #1a1a1a; margin-bottom: 5px;">
                  ${v.book} ${v.chapter}:${v.verse}
                </div>
                <div style="color: #555; line-height: 1.6;">
                  ${highlightSearchTerms(v.snippet || v.text, query)}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
      }).join('');
    
  } catch (error) {
    statusDiv.textContent = `❌ Error: ${error instanceof Error ? error.message : 'Unknown'}`;
    statusDiv.style.color = 'red';
    console.error(error);
  }
}

// Toggle translation section visibility
function toggleTranslation(translationId: string) {
  const content = document.getElementById(`content-${translationId}`);
  const icon = document.getElementById(`icon-${translationId}`);
  
  if (content && icon) {
    if (content.style.display === 'none') {
      content.style.display = 'block';
      icon.textContent = '▼';
    } else {
      content.style.display = 'none';
      icon.textContent = '▶';
    }
  }
}

// Make toggleTranslation globally accessible for onclick handlers
(window as any).toggleTranslation = toggleTranslation;

// Highlight search terms in text
function highlightSearchTerms(text: string, query: string): string {
  const terms = query.toLowerCase().trim().split(/\s+/);
  let highlighted = text;
  
  // Convert ⌃ symbol (indicates plural "you") to clickable superscript
  highlighted = highlighted.replace(/⌃/g, '<sup style="color: #2c5f8d; cursor: pointer; text-decoration: underline;" onclick="showFootnote(\'plural form\')"><strong>[pl]</strong></sup>');
  
  // First, convert footnote markers to clickable superscript references
  // Pattern: + 12:29 Gr. gave. or similar footnote markers
  let footnoteCounter = 0;
  highlighted = highlighted.replace(/\+\s*\d+:\d+\s+([^.]+\.)/g, (match, note) => {
    footnoteCounter++;
    return `<sup style="color: #2c5f8d; cursor: pointer; text-decoration: underline;" onclick="showFootnote('${note.replace(/'/g, "\\'")}')"><strong>[${footnoteCounter}]</strong></sup>`;
  });
  
  // Then apply search term highlighting
  terms.forEach(term => {
    const regex = new RegExp(`(${term})`, 'gi');
    highlighted = highlighted.replace(regex, '<mark style="background: #d9ecff; color: #1a1a1a; padding: 2px; border-radius: 2px;">$1</mark>');
  });
  
  return highlighted;
}

// Show footnote in a tooltip/popup
function showFootnote(note: string) {
  alert(note);
}

// Make showFootnote globally accessible
(window as any).showFootnote = showFootnote;

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
      listDiv.innerHTML = '<div style="color: #555;">No map layers installed. Import maps.sqlite first.</div>';
      return;
    }
    
    listDiv.innerHTML = `
      <div style="color: #555; margin-bottom: 10px;">✅ ${layers.length} historical layers loaded</div>
      ${layers.map(layer => `
        <div style="padding: 12px; margin: 8px 0; background: #e5e5e5; border-radius: 4px; border-left: 3px solid #28a745;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <div style="font-weight: bold; color: #333;">${layer.displayName || layer.name}</div>
              <div style="color: #555; font-size: 13px; margin-top: 4px;">
                Period: ${layer.period} | ${layer.yearStart} to ${layer.yearEnd}
              </div>
              ${layer.description ? `<div style="color: #888; font-size: 12px; margin-top: 4px;">${layer.description}</div>` : ''}
            </div>
            <button onclick="viewMapLayer('${layer.id}')" 
                    style="padding: 8px 16px; background: #999; color: #1a1a1a; border: 1px solid #bbb; border-radius: 4px; cursor: pointer;">
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
    const map = L.map(canvasDiv).setView([31.7683, 35.2137], 5);
    currentMap = map;
    
    // Esri ArcGIS World Imagery (Satellite - High Resolution)
    const esriSatellite = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        attribution: 'Tiles © Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
        maxZoom: 19
      }
    );
    
    // Esri Labels Overlay (English place names)
    const esriLabels = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      {
        attribution: '',
        maxZoom: 19
      }
    );
    
    // Esri World Topographic Map
    const esriTopo = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
      {
        attribution: 'Tiles © Esri &mdash; Esri, DeLorme, NAVTEQ, TomTom, Intermap, iPC, USGS, FAO, NPS, NRCAN, GeoBase, Kadaster NL, Ordnance Survey, Esri Japan, METI, Esri China (Hong Kong), and the GIS User Community',
        maxZoom: 19
      }
    );
    
    // Esri World Street Map
    const esriStreets = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
      {
        attribution: 'Tiles © Esri',
        maxZoom: 19
      }
    );
    
    // Esri National Geographic World Map (Beautiful historical aesthetic)
    const esriNatGeo = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}',
      {
        attribution: 'Tiles © Esri &mdash; National Geographic, Esri, DeLorme, NAVTEQ, UNEP-WCMC, USGS, NASA, ESA, METI, NRCAN, GEBCO, NOAA, iPC',
        maxZoom: 16
      }
    );
    
    // Create layer groups for base maps
    const satelliteGroup = L.layerGroup([esriSatellite, esriLabels]);
    
    const baseMaps = {
      "🛰️ Satellite": satelliteGroup,
      "🗺️ Topographic": esriTopo,
      "🏙️ Streets": esriStreets,
      "🌍 National Geographic": esriNatGeo
    };
    
    // Add default layer (satellite with labels)
    satelliteGroup.addTo(map);
    
    // Render GeoJSON features as overlay layer (if available)
    const overlays: { [key: string]: L.LayerGroup } = {};
    
    if (layer.boundaries && layer.boundaries.features && layer.boundaries.features.length > 0) {
      const geoJsonLayer = L.geoJSON(layer.boundaries, {
        style: function (feature) {
          return {
            color: '#ff7800',
            weight: 2,
            opacity: 0.7,
            fillOpacity: 0.15,
            dashArray: '5, 5'
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
      
      overlays['📍 Ancient Boundaries'] = geoJsonLayer;
      
      // Fit map to GeoJSON bounds
      const bounds = geoJsonLayer.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [50, 50] });
      }
    }
    
    // Add layer control for base maps and overlays
    if (Object.keys(overlays).length > 0) {
      L.control.layers(baseMaps, overlays, {
        position: 'topright',
        collapsed: false
      }).addTo(map);
    } else {
      L.control.layers(baseMaps, {}, {
        position: 'topright',
        collapsed: false
      }).addTo(map);
    }
    
    viewerDiv.style.display = 'block';
    viewerDiv.scrollIntoView({ behavior: 'smooth' });
    
    // Initialize Pleiades place search
    setupPlaceSearch();
    
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

// Marker layer for place search results
let placeMarkers: L.LayerGroup | null = null;

/**
 * Setup Pleiades place search functionality
 */
function setupPlaceSearch() {
  const searchInput = document.getElementById('mapPlaceSearch') as HTMLInputElement;
  const searchResults = document.getElementById('mapSearchResults') as HTMLDivElement;
  const searchStatus = document.getElementById('mapSearchStatus') as HTMLDivElement;
  const searchBtn = document.getElementById('mapSearchPlacesBtn') as HTMLButtonElement;
  
  if (!searchInput || !searchResults || !searchStatus || !searchBtn) {
    return;
  }
  
  // Create marker layer group
  if (!placeMarkers && currentMap) {
    placeMarkers = L.layerGroup().addTo(currentMap);
  }
  
  const performSearch = async () => {
    const query = searchInput.value.trim();
    
    if (query.length < 2) {
      searchResults.style.display = 'none';
      searchStatus.textContent = 'Please enter at least 2 characters';
      return;
    }
    
    searchStatus.textContent = 'Searching biblical & ancient places...';
    searchBtn.disabled = true;
    
    try {
      const places = await searchAllPlaces(query);
      displaySearchResults(places);
      if (places.length === 0) {
        searchStatus.textContent = 'No places found. Make sure you have imported place packs.';
      } else {
        const openBibleCount = places.filter(p => p.source === 'openbible').length;
        const pleiadesCount = places.filter(p => p.source === 'pleiades').length;
        searchStatus.textContent = `Found ${openBibleCount} biblical + ${pleiadesCount} ancient places`;
      }
    } catch (error) {
      searchStatus.textContent = 'Search failed. Have you imported place packs?';
      console.error('Place search error:', error);
    } finally {
      searchBtn.disabled = false;
    }
  };
  
  // Search on button click
  searchBtn.addEventListener('click', performSearch);
  
  // Search on Enter key
  searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      performSearch();
    }
  });
}

/**
 * Search Pleiades places by name
 */
async function searchPleiadesPlaces(query: string): Promise<any[]> {
  const db = await openDB();
  
  return new Promise((resolve, reject) => {
    try {
      // Check if store exists
      if (!db.objectStoreNames.contains('pleiades_places')) {
        console.warn('pleiades_places store not found');
        resolve([]);
        return;
      }
      
      const transaction = db.transaction('pleiades_places', 'readonly');
      const store = transaction.objectStore('pleiades_places');
      const index = store.index('title');
      
      const results: any[] = [];
      const queryLower = query.toLowerCase();
      
      // Use cursor to scan index
      const request = index.openCursor();
      
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor && results.length < 50) {
          const place = cursor.value;
          if (place.title && place.title.toLowerCase().includes(queryLower)) {
            results.push({ ...place, source: 'pleiades' });
          }
          cursor.continue();
        } else {
          console.log('Pleiades search results:', results.length);
          resolve(results);
        }
      };
      
      request.onerror = () => {
        console.error('Search request error:', request.error);
        reject(request.error);
      };
      
      transaction.onerror = () => {
        console.error('Transaction error:', transaction.error);
        reject(transaction.error);
      };
    } catch (error) {
      console.error('Search error:', error);
      reject(error);
    }
  });
}

/**
 * Search for biblical places in OpenBible database by name
 */
async function searchOpenBiblePlaces(query: string): Promise<any[]> {
  const db = await openDB();
  
  return new Promise((resolve, reject) => {
    try {
      // Check if stores exist
      if (!db.objectStoreNames.contains('openbible_places') || 
          !db.objectStoreNames.contains('openbible_locations') ||
          !db.objectStoreNames.contains('openbible_identifications')) {
        console.warn('OpenBible stores not found');
        resolve([]);
        return;
      }
      
      const transaction = db.transaction(['openbible_places', 'openbible_locations', 'openbible_identifications'], 'readonly');
      const placesStore = transaction.objectStore('openbible_places');
      const locationsStore = transaction.objectStore('openbible_locations');
      const identsStore = transaction.objectStore('openbible_identifications');
      
      const results: any[] = [];
      const queryLower = query.toLowerCase();
      
      // Search in ancient places by friendly_id
      const placesIndex = placesStore.index('friendlyId');
      const placesRequest = placesIndex.openCursor();
      
      placesRequest.onsuccess = async (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor && results.length < 25) {
          const place = cursor.value;
          if (place.friendlyId && place.friendlyId.toLowerCase().includes(queryLower)) {
            results.push(place);
          }
          cursor.continue();
        } else {
          // Get coordinates for each result
          const enrichedResults = [];
          for (const place of results) {
            try {
              // Find identification
              const identIndex = identsStore.index('ancientPlaceId');
              const idents = await new Promise<any[]>((res) => {
                const identReq = identIndex.getAll(place.id);
                identReq.onsuccess = () => res(identReq.result || []);
                identReq.onerror = () => res([]);
              });
              
              // Get highest confidence identification
              const bestIdent = idents.sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0];
              
              if (bestIdent && bestIdent.modernLocationId) {
                const location = await new Promise<any>((res) => {
                  const locReq = locationsStore.get(bestIdent.modernLocationId);
                  locReq.onsuccess = () => res(locReq.result);
                  locReq.onerror = () => res(null);
                });
                
                if (location && location.latitude && location.longitude) {
                  enrichedResults.push({
                    ...place,
                    title: place.friendlyId, // For compatibility with displaySearchResults
                    latitude: location.latitude,
                    longitude: location.longitude,
                    modernName: location.friendlyId,
                    confidence: bestIdent.confidence,
                    placeType: location.type,
                    locationClass: location.class,
                    source: 'openbible'
                  });
                }
              }
            } catch (err) {
              console.error('Error enriching place:', err);
            }
          }
          
          console.log('OpenBible search results:', enrichedResults.length);
          resolve(enrichedResults);
        }
      };
      
      placesRequest.onerror = () => {
        console.error('Places search error:', placesRequest.error);
        reject(placesRequest.error);
      };
      
      transaction.onerror = () => {
        console.error('Transaction error:', transaction.error);
        reject(transaction.error);
      };
    } catch (error) {
      console.error('OpenBible search error:', error);
      reject(error);
    }
  });
}

/**
 * Search both Pleiades and OpenBible databases
 */
async function searchAllPlaces(query: string): Promise<any[]> {
  const [openBibleResults, pleiadesResults] = await Promise.all([
    searchOpenBiblePlaces(query),
    searchPleiadesPlaces(query)
  ]);
  
  // Combine with biblical (OpenBible) results first
  return [...openBibleResults, ...pleiadesResults];
}

/**
 * Display search results
 */
function displaySearchResults(places: any[]) {
  const searchResults = document.getElementById('mapSearchResults') as HTMLDivElement;
  
  console.log('displaySearchResults called with', places.length, 'places');
  console.log('searchResults element:', searchResults);
  
  if (!searchResults) {
    console.error('searchResults element not found!');
    return;
  }
  
  if (places.length === 0) {
    searchResults.style.display = 'none';
    return;
  }
  
  console.log('First place:', places[0]);
  
  const html = places.map(place => {
    const sourceLabel = place.source === 'openbible' ? '📖 Biblical' : '🏛️ Ancient';
    const confidenceLabel = place.confidence >= 500 ? '⭐ High confidence' : 
                           place.confidence >= 300 ? '✓ Medium confidence' : 
                           place.confidence > 0 ? '? Low confidence' : '';
    
    return `
    <div 
      class="search-result" 
      data-place-id="${place.id}"
      data-source="${place.source || 'pleiades'}"
      style="padding: 10px; border-bottom: 1px solid #ccc; cursor: pointer; transition: background 0.2s; background: #f5f5f5;"
      onmouseover="this.style.background='#e0e0e0'"
      onmouseout="this.style.background='#f5f5f5'"
    >
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div style="font-weight: bold; color: #2c3e50;">${escapeHtml(place.title)}</div>
        <div style="font-size: 11px; color: #7f8c8d; font-weight: 500;">${sourceLabel}</div>
      </div>
      <div style="font-size: 12px; color: #7f8c8d; margin-top: 2px;">
        ${place.placeType ? escapeHtml(place.placeType) : 'Place'} 
        ${place.yearStart && place.yearEnd ? `(${place.yearStart} - ${place.yearEnd})` : ''}
        ${confidenceLabel ? `<span style="margin-left: 8px; color: #27ae60;">${confidenceLabel}</span>` : ''}
      </div>
      ${place.modernName && place.modernName !== place.title ? `<div style="font-size: 11px; color: #95a5a6; margin-top: 2px;">Modern: ${escapeHtml(place.modernName)}</div>` : ''}
      ${place.latitude && place.longitude ? `<div style="font-size: 11px; color: #95a5a6; margin-top: 2px;">${place.latitude.toFixed(4)}, ${place.longitude.toFixed(4)}</div>` : ''}
      ${place.verseCount > 0 ? `<div style="font-size: 11px; color: #3498db; margin-top: 2px;">📖 Mentioned in ${place.verseCount} verse${place.verseCount === 1 ? '' : 's'}</div>` : ''}
    </div>
  `;
  }).join('');
  
  searchResults.innerHTML = html;
  searchResults.style.display = 'block';
  
  console.log('Search results innerHTML length:', searchResults.innerHTML.length);
  console.log('Search results display:', searchResults.style.display);
  console.log('Search results computed style:', window.getComputedStyle(searchResults).display);
  
  // Attach click handlers
  searchResults.querySelectorAll('.search-result').forEach(result => {
    result.addEventListener('click', async (e) => {
      const placeId = (e.currentTarget as HTMLElement).dataset.placeId;
      if (placeId) {
        const db = await openDB();
        const transaction = db.transaction('pleiades_places', 'readonly');
        const store = transaction.objectStore('pleiades_places');
        const request = store.get(placeId);
        
        request.onsuccess = () => {
          const place = request.result;
          if (place && place.latitude && place.longitude) {
            zoomToPlace(place);
          }
        };
      }
    });
  });
}

/**
 * Zoom map to a place and show marker with details
 */
function zoomToPlace(place: any) {
  if (!currentMap || !place.latitude || !place.longitude) return;
  
  // Clear previous markers
  if (placeMarkers) {
    placeMarkers.clearLayers();
  }
  
  // Fly to place with smooth animation
  currentMap.flyTo([place.latitude, place.longitude], 12, {
    duration: 1.5,
    easeLinearity: 0.25
  });
  
  // Determine marker color and icon based on source and confidence
  let markerColor = '#3388ff'; // Default blue
  let markerIcon = '📍';
  
  if (place.source === 'openbible') {
    // Biblical places - blue with book icon
    markerColor = '#2980b9';
    markerIcon = '📖';
    
    // Adjust opacity based on confidence
    if (place.confidence >= 500) {
      markerColor = '#27ae60'; // High confidence - green
      markerIcon = '⭐';
    } else if (place.confidence >= 300) {
      markerColor = '#2980b9'; // Medium - blue
      markerIcon = '✓';
    } else if (place.confidence > 0) {
      markerColor = '#e67e22'; // Low - orange
      markerIcon = '?';
    }
  } else {
    // Ancient places (Pleiades) - orange/brown
    markerColor = '#d35400';
    markerIcon = '🏛️';
  }
  
  // Create custom marker with DivIcon for colored markers
  const marker = L.marker([place.latitude, place.longitude], {
    icon: L.divIcon({
      className: 'custom-place-marker',
      html: `
        <div style="
          position: relative;
          width: 32px;
          height: 32px;
        ">
          <div style="
            position: absolute;
            bottom: 0;
            left: 50%;
            transform: translateX(-50%);
            width: 24px;
            height: 24px;
            background: ${markerColor};
            border: 2px solid white;
            border-radius: 50% 50% 50% 0;
            transform: translateX(-50%) rotate(-45deg);
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          "></div>
          <div style="
            position: absolute;
            top: 2px;
            left: 50%;
            transform: translateX(-50%);
            font-size: 14px;
            z-index: 1000;
            text-shadow: 0 0 2px white;
          ">${markerIcon}</div>
        </div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 32],
      popupAnchor: [0, -32]
    })
  });
  
  // Create popup with place details
  let popupContent = `<div style="min-width: 220px;">`;
  
  // Title with source badge
  const sourceBadge = place.source === 'openbible' ? '📖 Biblical' : '🏛️ Ancient';
  const placeTitle = place.title || place.friendlyId || place.name || 'Unknown Place';
  popupContent += `<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">`;
  popupContent += `<h4 style="margin: 0; color: #2c3e50; font-size: 16px;">${escapeHtml(placeTitle)}</h4>`;
  popupContent += `<span style="font-size: 11px; color: #7f8c8d; font-weight: 600; white-space: nowrap; margin-left: 8px;">${sourceBadge}</span>`;
  popupContent += `</div>`;
  
  // Confidence indicator for biblical places
  if (place.source === 'openbible' && place.confidence > 0) {
    const confidenceLabel = place.confidence >= 500 ? '⭐ High confidence' :
                           place.confidence >= 300 ? '✓ Medium confidence' :
                           '? Low confidence';
    const confidenceColor = place.confidence >= 500 ? '#27ae60' :
                            place.confidence >= 300 ? '#2980b9' : '#e67e22';
    popupContent += `<p style="margin: 4px 0; font-size: 12px; color: ${confidenceColor}; font-weight: 600;">${confidenceLabel} (${place.confidence})</p>`;
  }
  
  // Place type
  if (place.placeType || place.type) {
    popupContent += `<p style="margin: 4px 0; font-size: 13px;"><strong>Type:</strong> ${escapeHtml(place.placeType || place.type)}</p>`;
  }
  
  // Verse count for biblical places - clickable to show verses
  if (place.verseCount > 0) {
    const placeName = place.friendlyId || place.title || place.name;
    popupContent += `<p style="margin: 4px 0; font-size: 13px;"><strong>📖 Mentioned:</strong> <a href="#" onclick="event.preventDefault(); searchPlaceVerses('${escapeHtml(placeName)}'); return false;" style="color: #3498db; text-decoration: underline; cursor: pointer;">${place.verseCount} verse${place.verseCount === 1 ? '' : 's'}</a></p>`;
  }
  
  // Modern name if different
  if (place.modernName && place.modernName !== place.title) {
    popupContent += `<p style="margin: 4px 0; font-size: 13px;"><strong>Modern:</strong> ${escapeHtml(place.modernName)}</p>`;
  }
  
  // Time period for ancient places
  if (place.yearStart || place.yearEnd) {
    popupContent += `<p style="margin: 4px 0; font-size: 13px;"><strong>Period:</strong> ${place.yearStart || '?'} - ${place.yearEnd || '?'}</p>`;
  }
  
  // Description
  if (place.description) {
    const shortDesc = place.description.length > 200 
      ? place.description.substring(0, 200) + '...' 
      : place.description;
    popupContent += `<p style="margin: 8px 0 4px 0; font-size: 12px; color: #555; line-height: 1.4;">${escapeHtml(shortDesc)}</p>`;
  }
  
  // Coordinates
  popupContent += `<p style="margin: 8px 0 0 0; font-size: 11px; color: #95a5a6;">${place.latitude.toFixed(4)}, ${place.longitude.toFixed(4)}</p>`;
  
  // External link
  if (place.uri) {
    popupContent += `<p style="margin: 8px 0 0 0;"><a href="${place.uri}" target="_blank" style="font-size: 12px; color: #3498db; text-decoration: none;">View in Pleiades ↗</a></p>`;
  }
  
  popupContent += `</div>`;
  
  marker.bindPopup(popupContent, {
    maxWidth: 320,
    className: 'place-popup'
  });
  
  if (placeMarkers) {
    placeMarkers.addLayer(marker);
  }
  
  // Open popup after animation completes
  setTimeout(() => {
    marker.openPopup();
  }, 1600);
}

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
  const verseElements = document.querySelectorAll('.verse-text, .verse-span');
  
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
      const htmlSpan = span as HTMLElement;
      const translation = htmlSpan.dataset.translation || '';
      
      // Strip ALL punctuation from data attribute but keep original for display
      const cleanWord = trimmed.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '');
      const safeWord = escapeHtml(cleanWord);
      const displayWord = escapeHtml(trimmed);
      return `<span class="word-clickable" 
                    data-word="${safeWord}" 
                    data-word-position="${idx + 1}"
                    data-book="${book}"
                    data-chapter="${chapter}"
                    data-verse="${verse}"
                    data-translation="${escapeHtml(translation)}"
                    style="cursor: pointer; padding: 2px; border-radius: 2px; transition: background 0.15s;"
                    onmouseenter="this.style.background='#f0f0f0'"
                    onmouseleave="this.style.background='transparent'">${displayWord}</span>`;
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
        showWordActionMenu(element, e);
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
        showWordActionMenu(element, e);
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

// Store word context for action menu
let currentWordContext: {
  word: string;
  book: string;
  chapter: number;
  verse: number;
  wordPosition: number;
  translation: string;
  hasMorphology: boolean;
  placeData: any;
} | null = null;

/**
 * Check if translation has morphology data
 */
function translationHasMorphology(translation: string): boolean {
  const t = translation.toLowerCase();
  if (t.includes('byz') || t.includes('sblgnt') || t.includes('opengnt') || 
      t === 'tr' || t.includes('gnt') || t.includes('greek')) return true;
  if (t.includes('wlc') || t.includes('aleppo') || t.includes('morphhb') ||
      t.includes('hebrew')) return true;
  return false;
}

/**
 * Search for place data by word
 */
async function findPlaceByWord(word: string): Promise<any> {
  const db = await openDB();
  const normalizedWord = word.toLowerCase().replace(/[\p{P}\p{S}]/gu, '');
  
  console.log('[findPlaceByWord] Searching for:', normalizedWord);
  
  try {
    // Build list of available stores
    const storeNames = Array.from(db.objectStoreNames);
    const availableStores: string[] = [];
    
    if (storeNames.includes('openbible_places')) availableStores.push('openbible_places');
    if (storeNames.includes('openbible_locations')) availableStores.push('openbible_locations');
    if (storeNames.includes('openbible_identifications')) availableStores.push('openbible_identifications');
    if (storeNames.includes('pleiades_places')) availableStores.push('pleiades_places');
    if (storeNames.includes('places')) availableStores.push('places');
    if (storeNames.includes('place_name_links')) availableStores.push('place_name_links');
    
    console.log('[findPlaceByWord] Available stores:', availableStores);
    
    if (availableStores.length === 0) {
      db.close();
      return null;
    }
    
    const tx = db.transaction(availableStores, 'readonly');
    
    // Create alternate spellings (e.g., judea -> judaea, cesar -> caesar) - used by multiple searches
    const alternates = [normalizedWord];
    if (normalizedWord.includes('e') && !normalizedWord.includes('ae')) alternates.push(normalizedWord.replace(/e/g, 'ae'));
    if (normalizedWord.includes('ae')) alternates.push(normalizedWord.replace(/ae/g, 'e'));
    if (normalizedWord.endsWith('a')) alternates.push(normalizedWord.slice(0, -1) + 'ah');
    if (normalizedWord.endsWith('ah')) alternates.push(normalizedWord.slice(0, -2) + 'a');
    
    // 1. Search OpenBible places by friendlyId (word match, case-insensitive)
    if (availableStores.includes('openbible_places')) {
      const openBiblePlaces = await new Promise<any[]>((resolve) => {
        const store = tx.objectStore('openbible_places');
        const results: any[] = [];
        const request = store.openCursor();
        request.onsuccess = (e: any) => {
          const cursor = e.target.result;
          if (cursor) {
            const fid = cursor.value.friendlyId?.toLowerCase() || '';
            // Match if friendlyId starts with the word (e.g., "galilee" matches "Galilee 1", "Galilee 2")
            // or if it's an exact match
            // But NOT partial word matches (e.g., "men" should NOT match "Armenia")
            const fidWords = fid.split(/\s+/);
            const isMatch = fidWords.some(word => word === normalizedWord) || fid.startsWith(normalizedWord + ' ');
            
            if (isMatch) {
              results.push(cursor.value);
            }
            cursor.continue();
          } else {
            resolve(results);
          }
        };
        request.onerror = () => resolve([]);
      });
      
      console.log('[findPlaceByWord] OpenBible places found:', openBiblePlaces.length);
      
      if (openBiblePlaces.length > 0 && availableStores.includes('openbible_identifications') && availableStores.includes('openbible_locations')) {
        const place = openBiblePlaces[0];
        console.log('[findPlaceByWord] OpenBible place id:', place.id, 'friendlyId:', place.friendlyId);
        
        // Scan identifications for this ancientPlaceId (don't rely on index)
        const identifications = await new Promise<any[]>((resolve) => {
          const idStore = tx.objectStore('openbible_identifications');
          const results: any[] = [];
          let sampleIds: any[] = [];
          const request = idStore.openCursor();
          request.onsuccess = (e: any) => {
            const cursor = e.target.result;
            if (cursor) {
              // Collect first 5 for debug
              if (sampleIds.length < 5) {
                sampleIds.push({ ancientPlaceId: cursor.value.ancientPlaceId, modernLocationId: cursor.value.modernLocationId });
              }
              // Match ancientPlaceId exactly
              if (cursor.value.ancientPlaceId === place.id) {
                results.push(cursor.value);
              }
              cursor.continue();
            } else {
              console.log('[findPlaceByWord] Sample identifications:', sampleIds);
              console.log('[findPlaceByWord] Looking for ancientPlaceId:', place.id, 'type:', typeof place.id);
              resolve(results);
            }
          };
          request.onerror = () => resolve([]);
        });
        
        console.log('[findPlaceByWord] Identifications found:', identifications.length);
        
        if (identifications.length > 0) {
          identifications.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
          const bestIdent = identifications[0];
          console.log('[findPlaceByWord] Best identification:', bestIdent.modernLocationId, 'confidence:', bestIdent.confidence);
          
          const modernLoc = await new Promise<any>((resolve) => {
            const request = tx.objectStore('openbible_locations').get(bestIdent.modernLocationId);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => resolve(null);
          });
          
          if (modernLoc) {
            console.log('[findPlaceByWord] Found OpenBible place with location:', place.friendlyId, modernLoc.latitude, modernLoc.longitude);
            db.close();
            return {
              id: place.id, name: place.friendlyId.charAt(0).toUpperCase() + place.friendlyId.slice(1),
              friendlyId: place.friendlyId, latitude: modernLoc.latitude, longitude: modernLoc.longitude,
              verseCount: place.verseCount, confidence: bestIdent.confidence, modernName: modernLoc.friendlyId, source: 'openbible'
            };
          }
        }
        
        // FALLBACK: If no identifications, search locations directly by matching friendlyId
        console.log('[findPlaceByWord] Trying fallback: search locations directly');
        console.log('[findPlaceByWord] Searching with alternates:', alternates);
        
        const directLocation = await new Promise<any>((resolve) => {
          const locStore = tx.objectStore('openbible_locations');
          const request = locStore.openCursor();
          let sampleLocs: string[] = [];
          let judaeaRelated: string[] = [];
          request.onsuccess = (e: any) => {
            const cursor = e.target.result;
            if (cursor) {
              const locFid = cursor.value.friendlyId?.toLowerCase() || '';
              // Collect samples
              if (sampleLocs.length < 10) sampleLocs.push(cursor.value.friendlyId || 'null');
              // Check for judea/judaea related
              if (locFid.includes('jud')) judaeaRelated.push(cursor.value.friendlyId);
              // Match if location friendlyId contains any alternate as a word
              const isMatch = alternates.some(alt => 
                locFid === alt || 
                locFid.startsWith(alt + ' ') || 
                locFid.includes(' ' + alt) ||
                locFid.endsWith(' ' + alt)
              );
              if (isMatch) {
                resolve(cursor.value);
                return;
              }
              cursor.continue();
            } else {
              if (judaeaRelated.length > 0) console.log('[findPlaceByWord] Judea-related locations found:', judaeaRelated);
              resolve(null);
            }
          };
          request.onerror = () => resolve(null);
        });
        
        if (directLocation && directLocation.latitude && directLocation.longitude) {
          console.log('[findPlaceByWord] Found direct location match:', directLocation.friendlyId);
          db.close();
          return {
            id: place.id, name: place.friendlyId,
            friendlyId: place.friendlyId, latitude: directLocation.latitude, longitude: directLocation.longitude,
            verseCount: place.verseCount, modernName: directLocation.friendlyId, source: 'openbible'
          };
        }
      }
    }
    
    // 2. Search Pleiades places by title (with alternates and word matching)
    if (availableStores.includes('pleiades_places')) {
      const pleiadesPlaces = await new Promise<any[]>((resolve) => {
        const store = tx.objectStore('pleiades_places');
        const results: any[] = [];
        const request = store.openCursor();
        request.onsuccess = (e: any) => {
          const cursor = e.target.result;
          if (cursor) {
            const title = cursor.value.title?.toLowerCase() || '';
            const titleWords = title.split(/[\s,\-()\/]+/);
            
            // Match if any alternate matches the title or is a word in the title
            const isMatch = alternates.some(alt => 
              title === alt ||
              titleWords.includes(alt) ||
              title.startsWith(alt + ' ') ||
              title.endsWith(' ' + alt)
            );
            
            if (isMatch && cursor.value.latitude && cursor.value.longitude) {
              results.push(cursor.value);
            }
            cursor.continue();
          } else resolve(results);
        };
        request.onerror = () => resolve([]);
      });
      
      console.log('[findPlaceByWord] Pleiades places found:', pleiadesPlaces.length);
      if (pleiadesPlaces.length > 0) {
        console.log('[findPlaceByWord] Pleiades matches:', pleiadesPlaces.map(p => p.title));
      }
      
      if (pleiadesPlaces.length > 0) {
        const place = pleiadesPlaces[0];
        db.close();
        return { id: place.id, name: place.title, latitude: place.latitude, longitude: place.longitude, placeType: place.placeType, description: place.description, source: 'pleiades' };
      }
    }
    
    // 3. Check legacy place_name_links
    if (availableStores.includes('place_name_links') && availableStores.includes('places')) {
      const placeLinks = await new Promise<any[]>((resolve) => {
        const store = tx.objectStore('place_name_links');
        if (store.indexNames.contains('normalizedWord')) {
          const request = store.index('normalizedWord').getAll(normalizedWord);
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => resolve([]);
        } else {
          resolve([]);
        }
      });
      
      if (placeLinks.length > 0) {
        const placeData = await new Promise<any>((resolve) => {
          const request = tx.objectStore('places').get(placeLinks[0].placeId);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve(null);
        });
        if (placeData) { db.close(); return { ...placeData, source: 'legacy' }; }
      }
    }
    
    console.log('[findPlaceByWord] No place found for:', normalizedWord);
    db.close();
    return null;
  } catch (error) {
    console.error('[findPlaceByWord] Error:', error);
    db.close();
    return null;
  }
}

/**
 * Show word action menu (Morphology, Map, Note, Style)
 */
async function showWordActionMenu(wordElement: HTMLElement, event: MouseEvent | TouchEvent) {
  const modal = document.getElementById('wordStudyModal')!;
  const content = document.getElementById('wordStudyContent')!;
  
  const word = wordElement.dataset.word!;
  const book = wordElement.dataset.book!;
  const chapter = parseInt(wordElement.dataset.chapter!);
  const verse = parseInt(wordElement.dataset.verse!);
  const wordPosition = parseInt(wordElement.dataset.wordPosition!);
  const translation = wordElement.dataset.translation || '';
  
  const mouseX = ('clientX' in event && typeof event.clientX === 'number') ? event.clientX : (event.touches?.[0]?.clientX ?? lastPopupAnchorRect.left);
  const mouseY = ('clientY' in event && typeof event.clientY === 'number') ? event.clientY : (event.touches?.[0]?.clientY ?? lastPopupAnchorRect.top);

  suppressNextGlobalClickUntil = Date.now() + 800;
  content.innerHTML = '⏳ Loading...';
  modal.style.display = 'block';
  modal.style.visibility = 'hidden';

  requestAnimationFrame(() => {
    const anchorRect = new DOMRect(mouseX, mouseY, 0, 0);
    positionFixedPopupWithinViewport(modal, anchorRect, { preferBelow: 'auto' as any });
    modal.style.visibility = 'visible';
  });
  
  const hasMorphology = translationHasMorphology(translation);
  const placeData = await findPlaceByWord(word);
  
  currentWordContext = { word, book, chapter, verse, wordPosition, translation, hasMorphology, placeData };
  
  const safeWord = escapeHtml(cleanPopupText(word));
  const safeBook = escapeHtml(cleanPopupText(book));
  const morphDisabled = !hasMorphology;
  const mapDisabled = !placeData;
  
  const btnStyle = (disabled: boolean) => disabled 
    ? 'padding: 10px 16px; margin: 4px; border: none; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: not-allowed; background: #e0e0e0; color: #999;'
    : 'padding: 10px 16px; margin: 4px; border: none; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; background: #2196f3; color: white;';
  
  content.innerHTML = `
    <div style="margin: 0 0 12px 0; text-align: center;">
      <div style="font-weight: 650; font-size: 16px; color: #333;">${safeWord}</div>
      <div style="margin-top: 2px; color: #666; font-size: 12px;">${safeBook} ${chapter}:${verse}</div>
    </div>
    <div style="display: flex; flex-wrap: wrap; justify-content: center; gap: 4px;">
      <button onclick="showWordMorphology()" ${morphDisabled ? 'disabled' : ''} style="${btnStyle(morphDisabled)}" title="${morphDisabled ? 'Morphology not available for translations' : 'View morphology'}">📖 Morphology</button>
      <button onclick="showWordOnMap()" ${mapDisabled ? 'disabled' : ''} style="${btnStyle(mapDisabled)}" title="${mapDisabled ? 'Not a recognized place' : 'View on map'}">🗺️ Map</button>
      <button onclick="showWordNote()" style="${btnStyle(false)}">📝 Note</button>
      <button onclick="showWordStyle()" disabled style="${btnStyle(true)}" title="Coming soon">🎨 Style</button>
    </div>
    ${placeData ? `<div style="margin-top: 12px; padding: 8px; background: #e3f2fd; border-radius: 6px; text-align: center; font-size: 12px; color: #1976d2;">📍 Place: <strong>${escapeHtml(placeData.name)}</strong></div>` : ''}
    ${!hasMorphology ? `<div style="margin-top: 8px; padding: 6px; background: #fff3e0; border-radius: 6px; text-align: center; font-size: 11px; color: #e65100;">💡 Morphology available in Greek/Hebrew texts</div>` : ''}
  `;
}

// Global action handlers
(window as any).showWordMorphology = async function() {
  if (!currentWordContext) return;
  const { word, book, chapter, verse, wordPosition } = currentWordContext;
  const content = document.getElementById('wordStudyContent')!;
  content.innerHTML = '⏳ Loading morphology...';
  
  try {
    const db = await openDB();
    const tx = db.transaction(['morphology', 'strongs_entries'], 'readonly');
    const morphData = await new Promise<any>((resolve) => {
      const request = tx.objectStore('morphology').index('book_chapter_verse_word').get([book, chapter, verse, wordPosition]);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
    
    const normalizeStrongsId = (raw: unknown): string | null => {
      if (typeof raw !== 'string') return null;
      const match = raw.replace(/[^\w]/g, '').match(/^([GH])(\d+)$/);
      return match ? match[1] + match[2].padStart(4, '0') : null;
    };
    
    let html = `<button onclick="showWordActionMenuBack()" style="margin-bottom: 10px; padding: 4px 8px; background: #f5f5f5; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; font-size: 12px;">← Back</button>
      <div style="margin: 0 0 8px 0;"><div style="font-weight: 650; font-size: 14px; color: #333;">${escapeHtml(word)}</div><div style="color: #666; font-size: 12px;">${escapeHtml(book)} ${chapter}:${verse}</div></div>`;
    
    if (morphData) {
      let parsing: any;
      try { parsing = typeof morphData.parsing === 'string' ? JSON.parse(morphData.parsing) : morphData.parsing; } catch { parsing = { code: morphData.parsing }; }
      const normalizedStrongsId = normalizeStrongsId(morphData.strongsId);
      
      html += `<div style="margin: 0 0 6px 0;"><div style="margin: 0 0 3px 0; font-weight: 650; color: #555; font-size: 11.5px;">Morphology</div>
        <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
          <tr><td style="padding: 2px 4px; font-weight: 600;">Word</td><td>${escapeHtml(morphData.text || word)}</td></tr>
          <tr><td style="padding: 2px 4px; font-weight: 600;">Lemma</td><td>${escapeHtml(morphData.lemma || 'N/A')}</td></tr>
          ${morphData.transliteration ? `<tr><td style="padding: 2px 4px; font-weight: 600;">Translit</td><td>${escapeHtml(morphData.transliteration)}</td></tr>` : ''}
          ${morphData.gloss ? `<tr><td style="padding: 2px 4px; font-weight: 600;">Gloss</td><td>${escapeHtml(morphData.gloss)}</td></tr>` : ''}
          ${parsing?.code ? `<tr><td style="padding: 2px 4px; font-weight: 600;">Morph</td><td><code style="background: #ddd; padding: 1px 5px; border-radius: 3px;">${escapeHtml(parsing.code)}</code></td></tr>` : ''}
        </table></div>`;
      
      if (normalizedStrongsId) {
        const strongsData = await new Promise<any>((resolve) => {
          const request = tx.objectStore('strongs_entries').get(normalizedStrongsId);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve(null);
        });
        if (strongsData) {
          html += `<div style="margin: 6px 0; padding: 6px; background: #f5f5f5; border-left: 3px solid #e65100; border-radius: 4px;">
            <div style="font-weight: 650; color: #e65100; font-size: 11.5px;">Strong's ${escapeHtml(normalizedStrongsId)}</div>
            <div style="margin: 3px 0;"><strong>${escapeHtml(strongsData.lemma)}</strong>${strongsData.transliteration ? ` <span style="color:#666">(${escapeHtml(strongsData.transliteration)})</span>` : ''}</div>
            <div style="color: #555;">${escapeHtml(strongsData.shortDefinition || strongsData.definition)}</div></div>`;
        }
      }
    } else {
      html += `<div style="padding: 15px; text-align: center; color: #666;">No morphology data found.</div>`;
    }
    db.close();
    content.innerHTML = html;
  } catch (error) {
    content.innerHTML = `<p style="color: red;">Error: ${error instanceof Error ? error.message : 'Unknown'}</p>`;
  }
};

(window as any).showWordActionMenuBack = function() {
  if (!currentWordContext) return;
  const wordEl = document.querySelector(`.word-clickable[data-word="${currentWordContext.word}"][data-book="${currentWordContext.book}"][data-chapter="${currentWordContext.chapter}"][data-verse="${currentWordContext.verse}"]`) as HTMLElement;
  if (wordEl) showWordActionMenu(wordEl, new MouseEvent('click'));
};

(window as any).showWordOnMap = function() {
  if (!currentWordContext?.placeData) return;
  document.getElementById('wordStudyModal')!.style.display = 'none';
  (window as any).viewPlaceOnMap(currentWordContext.placeData.id || currentWordContext.placeData.friendlyId);
};

(window as any).showWordNote = function() {
  if (!currentWordContext) return;
  const { word, book, chapter, verse } = currentWordContext;
  const content = document.getElementById('wordStudyContent')!;
  const noteKey = `note_${book}_${chapter}_${verse}_${word}`;
  const existingNote = localStorage.getItem(noteKey) || '';
  
  content.innerHTML = `<button onclick="showWordActionMenuBack()" style="margin-bottom: 10px; padding: 4px 8px; background: #f5f5f5; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; font-size: 12px;">← Back</button>
    <div style="margin: 0 0 8px 0;"><div style="font-weight: 650; font-size: 14px; color: #333;">📝 Note: ${escapeHtml(word)}</div><div style="color: #666; font-size: 12px;">${escapeHtml(book)} ${chapter}:${verse}</div></div>
    <textarea id="wordNoteInput" style="width: 100%; height: 100px; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px; resize: vertical;" placeholder="Add your note...">${escapeHtml(existingNote)}</textarea>
    <div style="margin-top: 8px; display: flex; gap: 8px;">
      <button onclick="saveWordNote('${noteKey}')" style="flex: 1; padding: 8px; background: #4caf50; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 600;">Save</button>
      <button onclick="deleteWordNote('${noteKey}')" style="padding: 8px 12px; background: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer;">Delete</button>
    </div>`;
};

(window as any).saveWordNote = function(key: string) {
  const textarea = document.getElementById('wordNoteInput') as HTMLTextAreaElement;
  if (textarea.value.trim()) {
    localStorage.setItem(key, textarea.value);
    document.getElementById('wordStudyContent')!.innerHTML = `<div style="padding: 20px; text-align: center; color: #4caf50; font-weight: 600;">✓ Note saved!</div>`;
    setTimeout(() => { document.getElementById('wordStudyModal')!.style.display = 'none'; }, 1000);
  }
};

(window as any).deleteWordNote = function(key: string) {
  localStorage.removeItem(key);
  document.getElementById('wordStudyContent')!.innerHTML = `<div style="padding: 20px; text-align: center; color: #f44336;">Note deleted</div>`;
  setTimeout(() => { document.getElementById('wordStudyModal')!.style.display = 'none'; }, 1000);
};

(window as any).showWordStyle = function() {
  document.getElementById('wordStudyContent')!.innerHTML = `<div style="padding: 30px; text-align: center; color: #666;"><div style="font-size: 32px; margin-bottom: 10px;">🎨</div><div style="font-weight: 600;">Style Options</div><div style="margin-top: 8px; font-size: 13px;">Coming soon...</div></div>`;
};

/**
 * Show word study popup (legacy - replaced by showWordActionMenu)
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
    const tx = db.transaction(['morphology', 'strongs_entries', 'places', 'place_name_links', 'openbible_places', 'openbible_locations', 'openbible_identifications', 'pleiades_places'], 'readonly');
    
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
        <div style="margin-top: 1px; color: #555; font-size: 11.5px;">${safeRef}</div>
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
            ${safeMorphCode ? `<tr><td style="padding: 2px 4px; font-weight: 600; white-space: nowrap;">Morph</td><td style="padding: 2px 4px;"><code style="background: #bbb; padding: 1px 5px; border-radius: 3px;">${safeMorphCode}</code></td></tr>` : ''}
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
            <div id="strongs-def" style="margin: 0 0 6px 0; padding: 6px; background: #f0f0f0; border-left: 3px solid #666; border-radius: 4px; scroll-margin-top: 6px;">
              <div style="margin: 0 0 3px 0; font-weight: 650; color: #e65100; font-size: 11.5px;">Strong's ${escapeHtml(normalizedStrongsId)}</div>
              <div style="margin: 0 0 3px 0;"><strong>${safeStrongLemma}</strong>${safeStrongTranslit ? ` <span style=\"color:#666\">(${safeStrongTranslit})</span>` : ''}</div>
              <div style="margin: 0; color: #555;">${safeStrongDef}</div>
              ${safeKjvUsage ? `<div style="margin-top: 3px; font-size: 11.5px; color: #555;"><em>KJV: ${safeKjvUsage}</em></div>` : ''}
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
            <div style="margin: 0 0 6px 0; padding: 6px; background: #f0f0f0; border-left: 3px solid #666; border-radius: 4px;">
              <div style="margin: 0 0 3px 0; font-weight: 650; color: #666; font-size: 11.5px;">Place: ${safePlaceName}</div>
              ${altNames ? `<div style="margin: 0 0 3px 0; font-size: 11.5px; color: #555;">Also: ${escapeHtml(altNames)}</div>` : ''}
              ${placeData.latitude && placeData.longitude ? `<div style="margin: 0 0 3px 0; font-size: 11.5px; color: #555;">${placeData.latitude.toFixed(4)}, ${placeData.longitude.toFixed(4)}</div>` : ''}
              ${placeData.modernCity ? `<div style="margin: 0 0 3px 0; font-size: 11.5px; color: #555;">Modern: ${escapeHtml(cleanPopupText(placeData.modernCity))}${placeData.modernCountry ? ', ' + escapeHtml(cleanPopupText(placeData.modernCountry)) : ''}</div>` : ''}
              ${safeSignificance ? `<div style="margin: 0; color: #555;">${safeSignificance}</div>` : ''}
              <button onclick="viewPlaceOnMap('${escapeHtml(placeId)}')" style="margin-top: 5px; padding: 4px 8px; background: #999; color: #1a1a1a; border: 1px solid #bbb; border-radius: 4px; cursor: pointer;">
                View on Map
              </button>
            </div>
          `;
        }
      }
    } else {
      html += `
        <div style="padding: 20px; text-align: center; color: #555;">
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

/**
 * Open the map viewer and show a place with marker
 */
async function viewPlaceOnMap(placeId: string) {
  // Get place data from currentWordContext or look it up
  let place = currentWordContext?.placeData;
  
  if (!place || (place.id !== placeId && place.friendlyId !== placeId)) {
    // Look up place from database
    const db = await openDB();
    const tx = db.transaction(['openbible_places', 'openbible_locations', 'openbible_identifications', 'pleiades_places'], 'readonly');
    
    // Try OpenBible first
    const openBiblePlace = await new Promise<any>((resolve) => {
      const request = tx.objectStore('openbible_places').get(placeId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
    
    if (openBiblePlace) {
      // Get location data
      const identifications = await new Promise<any[]>((resolve) => {
        const request = tx.objectStore('openbible_identifications').index('ancientPlaceId').getAll(openBiblePlace.id);
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => resolve([]);
      });
      
      if (identifications.length > 0) {
        identifications.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
        const modernLoc = await new Promise<any>((resolve) => {
          const request = tx.objectStore('openbible_locations').get(identifications[0].modernLocationId);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve(null);
        });
        
        if (modernLoc) {
          place = {
            id: openBiblePlace.id,
            name: openBiblePlace.friendlyId.charAt(0).toUpperCase() + openBiblePlace.friendlyId.slice(1),
            friendlyId: openBiblePlace.friendlyId,
            latitude: modernLoc.latitude,
            longitude: modernLoc.longitude,
            verseCount: openBiblePlace.verseCount,
            confidence: identifications[0].confidence,
            source: 'openbible'
          };
        }
      }
    }
    
    // Try Pleiades if not found in OpenBible
    if (!place) {
      const pleiadesPlace = await new Promise<any>((resolve) => {
        const request = tx.objectStore('pleiades_places').get(placeId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      });
      
      if (pleiadesPlace) {
        place = {
          id: pleiadesPlace.id,
          name: pleiadesPlace.title,
          latitude: pleiadesPlace.latitude,
          longitude: pleiadesPlace.longitude,
          placeType: pleiadesPlace.placeType,
          description: pleiadesPlace.description,
          source: 'pleiades'
        };
      }
    }
    
    db.close();
  }
  
  if (!place || !place.latitude || !place.longitude) {
    alert(`Could not find location data for place: ${placeId}`);
    return;
  }
  
  // Show the map viewer
  const viewerDiv = document.getElementById('mapViewer')!;
  const titleDiv = document.getElementById('mapViewerTitle')!;
  const detailsDiv = document.getElementById('mapDetails')!;
  const canvasDiv = document.getElementById('mapCanvas')!;
  
  titleDiv.textContent = `📍 ${place.name || place.friendlyId || placeId}`;
  
  // Build details HTML
  let detailsHtml = '<div style="display: flex; flex-wrap: wrap; gap: 12px;">';
  if (place.source === 'openbible') {
    detailsHtml += `<div><strong>Source:</strong> <span style="color: #2980b9;">📖 Biblical Places (OpenBible)</span></div>`;
    if (place.verseCount) {
      detailsHtml += `<div><strong>Verse References:</strong> ${place.verseCount}</div>`;
    }
    if (place.confidence) {
      const confLevel = place.confidence >= 500 ? '⭐ High' : place.confidence >= 300 ? '✓ Medium' : '? Low';
      const confColor = place.confidence >= 500 ? '#27ae60' : place.confidence >= 300 ? '#2980b9' : '#e67e22';
      detailsHtml += `<div><strong>Location Confidence:</strong> <span style="color: ${confColor};">${confLevel} (${place.confidence})</span></div>`;
    }
    if (place.modernName) {
      detailsHtml += `<div><strong>Modern Location:</strong> ${place.modernName}</div>`;
    }
  } else if (place.source === 'pleiades') {
    detailsHtml += `<div><strong>Source:</strong> <span style="color: #d35400;">🏛️ Ancient Places (Pleiades)</span></div>`;
    if (place.placeType) {
      detailsHtml += `<div><strong>Type:</strong> ${place.placeType}</div>`;
    }
    if (place.description) {
      detailsHtml += `<div style="width: 100%;"><strong>Description:</strong> ${place.description}</div>`;
    }
  }
  detailsHtml += `<div><strong>Coordinates:</strong> ${place.latitude.toFixed(4)}, ${place.longitude.toFixed(4)}</div>`;
  detailsHtml += '</div>';
  detailsDiv.innerHTML = detailsHtml;
  
  viewerDiv.style.display = 'block';
  
  // Clear previous map
  if (currentMap) {
    currentMap.remove();
    currentMap = null;
  }
  
  // Setup map canvas
  canvasDiv.innerHTML = '';
  canvasDiv.style.display = 'block';
  canvasDiv.style.alignItems = '';
  canvasDiv.style.justifyContent = '';
  
  // Initialize map centered on place
  const map = L.map(canvasDiv).setView([place.latitude, place.longitude], 10);
  currentMap = map;
  
  // Esri ArcGIS World Imagery (Satellite)
  const esriSatellite = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Tiles © Esri', maxZoom: 19 }
  );
  
  // Esri Labels Overlay
  const esriLabels = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    { attribution: '', maxZoom: 19 }
  );
  
  // Esri Topographic
  const esriTopo = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Tiles © Esri', maxZoom: 19 }
  );
  
  // Default to satellite with labels
  esriSatellite.addTo(map);
  esriLabels.addTo(map);
  
  // Add layer control
  const baseMaps = {
    'Satellite': esriSatellite,
    'Topographic': esriTopo
  };
  L.control.layers(baseMaps, { 'Labels': esriLabels }).addTo(map);
  
  // Initialize place markers layer
  if (!placeMarkers) {
    placeMarkers = L.layerGroup().addTo(map);
  } else {
    placeMarkers.clearLayers();
    placeMarkers.addTo(map);
  }
  
  // Add marker using zoomToPlace function
  zoomToPlace(place);
  
  // Scroll to map viewer
  viewerDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Search for verses mentioning a place and display results
 */
async function searchPlaceVerses(placeName: string) {
  // Close map popup and scroll to search results
  const searchResults = document.getElementById('searchResults')!;
  const searchStatus = document.getElementById('searchStatus')!;
  const searchInput = document.getElementById('searchQuery') as HTMLInputElement;
  
  // Set the search input
  searchInput.value = placeName;
  
  searchStatus.innerHTML = `<span style="color: #666;">🔍 Searching for verses mentioning "${escapeHtml(placeName)}"...</span>`;
  searchResults.innerHTML = '';
  
  // Scroll to search section
  searchResults.scrollIntoView({ behavior: 'smooth', block: 'start' });
  
  try {
    const db = await openDB();
    const tx = db.transaction('verses', 'readonly');
    const store = tx.objectStore('verses');
    
    const results: any[] = [];
    const searchLower = placeName.toLowerCase();
    
    // Create regex for word boundary matching
    const searchRegex = new RegExp(`\\b${placeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    
    await new Promise<void>((resolve) => {
      const request = store.openCursor();
      request.onsuccess = (e: any) => {
        const cursor = e.target.result;
        if (cursor) {
          const verse = cursor.value;
          if (verse.text && searchRegex.test(verse.text)) {
            results.push(verse);
            searchRegex.lastIndex = 0; // Reset regex
          }
          if (results.length < 500) { // Limit results
            cursor.continue();
          } else {
            resolve();
          }
        } else {
          resolve();
        }
      };
      request.onerror = () => resolve();
    });
    
    db.close();
    
    if (results.length === 0) {
      searchStatus.innerHTML = `<span style="color: #888;">No verses found mentioning "${escapeHtml(placeName)}"</span>`;
      return;
    }
    
    searchStatus.innerHTML = `<span style="color: #27ae60;">📍 Found ${results.length} verse${results.length === 1 ? '' : 's'} mentioning "${escapeHtml(placeName)}"</span>`;
    
    // Group by book
    const bookGroups: { [book: string]: any[] } = {};
    results.forEach(verse => {
      if (!bookGroups[verse.book]) bookGroups[verse.book] = [];
      bookGroups[verse.book].push(verse);
    });
    
    // Sort books by canonical order
    const sortedBooks = Object.keys(bookGroups).sort((a, b) => {
      const indexA = BIBLE_BOOKS.indexOf(a);
      const indexB = BIBLE_BOOKS.indexOf(b);
      return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
    });
    
    // Build results HTML with highlighted place name
    let html = '';
    for (const book of sortedBooks) {
      const verses = bookGroups[book];
      html += `<details open style="margin-bottom: 12px;">
        <summary style="cursor: pointer; font-weight: 600; color: #333; padding: 8px; background: #f5f5f5; border-radius: 4px; margin-bottom: 4px;">
          ${escapeHtml(book)} (${verses.length})
        </summary>
        <div style="padding-left: 8px;">`;
      
      verses.forEach(verse => {
        // Highlight the place name in the text
        const highlightedText = verse.text.replace(
          searchRegex,
          '<mark style="background: #fff3cd; padding: 1px 2px; border-radius: 2px; font-weight: 600;">$&</mark>'
        );
        searchRegex.lastIndex = 0; // Reset regex
        
        html += `<div style="padding: 8px; margin: 4px 0; background: #fafafa; border-radius: 4px; border-left: 3px solid #3498db;">
          <div style="font-weight: 600; color: #2c3e50; margin-bottom: 4px;">
            ${escapeHtml(verse.book)} ${verse.chapter}:${verse.verse}
          </div>
          <div style="color: #444; line-height: 1.5;">${highlightedText}</div>
        </div>`;
      });
      
      html += `</div></details>`;
    }
    
    searchResults.innerHTML = html;
    
  } catch (error) {
    console.error('Error searching place verses:', error);
    searchStatus.innerHTML = `<span style="color: #e74c3c;">Error searching: ${error instanceof Error ? error.message : 'Unknown'}</span>`;
  }
}

// Make functions globally available
(window as any).createNoteForSelected = createNoteForSelected;
(window as any).highlightSelected = highlightSelected;
(window as any).underlineSelected = underlineSelected;
(window as any).italicizeSelected = italicizeSelected;
(window as any).clearSelection = clearSelection;
(window as any).viewPlaceOnMap = viewPlaceOnMap;
(window as any).showInlineNote = showInlineNote;
(window as any).searchPlaceVerses = searchPlaceVerses;

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
