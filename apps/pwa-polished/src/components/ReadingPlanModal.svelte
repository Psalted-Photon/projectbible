<script lang="ts">
  import { onMount } from 'svelte';
  import { generateReadingPlan, BIBLE_BOOKS, type ReadingPlanConfig, type ReadingPlan } from '@projectbible/core';
  import { navigationStore } from '../stores/navigationStore';
  
  export let isOpen = false;
  
  let currentTab: 'create' | 'active' | 'history' = 'create';
  let currentReadingPlan: ReadingPlan | null = null;
  let currentPlanId: string | null = null;
  
  // Storage keys
  const STORAGE_ACTIVE_PLAN = 'projectbible_active_reading_plan';
  const STORAGE_PLAN_HISTORY = 'projectbible_reading_plan_history';
  
  // Create plan form state
  let planPreset = '';
  let planStartDate = new Date().toISOString().split('T')[0];
  let planEndDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  let dayChecks = [true, true, true, true, true, true, true]; // Sun-Sat
  let selectedBooks = new Set(BIBLE_BOOKS.map(b => b.name));
  let ordering: 'canonical' | 'chronological' | 'shuffled' = 'canonical';
  let optDailyPsalm = false;
  let optRandomizePsalms = false;
  let optDailyProverb = false;
  let optRandomizeProverbs = false;
  let optReverseOrder = false;
  let optShowOverallStats = true;
  let optShowDailyStats = true;
  let planGenerationStatus = '';
  let planHistory: any[] = [];
  let viewMode: 'calendar' | 'list' = 'calendar';
  
  // Derived book lists
  const OT_BOOKS = BIBLE_BOOKS.filter(b => b.testament === 'OT').map(b => b.name);
  const NT_BOOKS = BIBLE_BOOKS.filter(b => b.testament === 'NT').map(b => b.name);
  
  onMount(() => {
    loadActivePlan();
    loadPlanHistory();
  });
  
  function loadActivePlan() {
    try {
      const stored = localStorage.getItem(STORAGE_ACTIVE_PLAN);
      if (stored) {
        const data = JSON.parse(stored);
        currentReadingPlan = data.plan;
        currentPlanId = data.id;
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
  
  function saveActivePlan() {
    if (currentReadingPlan && currentPlanId) {
      localStorage.setItem(STORAGE_ACTIVE_PLAN, JSON.stringify({
        id: currentPlanId,
        plan: currentReadingPlan
      }));
    }
  }
  
  function loadPlanHistory() {
    try {
      const historyStr = localStorage.getItem(STORAGE_PLAN_HISTORY);
      planHistory = historyStr ? JSON.parse(historyStr) : [];
    } catch (e) {
      console.error('Error loading plan history:', e);
      planHistory = [];
    }
  }
  
  function savePlanToHistory(plan: ReadingPlan, planId: string) {
    try {
      planHistory.unshift({
        id: planId,
        plan,
        createdAt: new Date().toISOString(),
        completedAt: null
      });
      if (planHistory.length > 10) {
        planHistory = planHistory.slice(0, 10);
      }
      localStorage.setItem(STORAGE_PLAN_HISTORY, JSON.stringify(planHistory));
    } catch (e) {
      console.error('Error saving plan to history:', e);
    }
  }
  
  function deleteCurrentPlan() {
    if (confirm('Are you sure you want to delete the current reading plan?')) {
      localStorage.removeItem(STORAGE_ACTIVE_PLAN);
      currentReadingPlan = null;
      currentPlanId = null;
    }
  }
  
  function deletePlanFromHistory(planId: string) {
    if (confirm('Are you sure you want to delete this plan from history?')) {
      planHistory = planHistory.filter(p => p.id !== planId);
      localStorage.setItem(STORAGE_PLAN_HISTORY, JSON.stringify(planHistory));
    }
  }
  
  function selectAllBooks() {
    selectedBooks = new Set(BIBLE_BOOKS.map(b => b.name));
  }
  
  function selectNone() {
    selectedBooks = new Set();
  }
  
  function selectOT() {
    selectedBooks = new Set(OT_BOOKS);
  }
  
  function selectNT() {
    selectedBooks = new Set(NT_BOOKS);
  }
  
  function toggleBook(bookName: string) {
    if (selectedBooks.has(bookName)) {
      selectedBooks.delete(bookName);
    } else {
      selectedBooks.add(bookName);
    }
    selectedBooks = selectedBooks;
  }
  
  async function generatePlan() {
    planGenerationStatus = 'Generating plan...';
    
    try {
      const config: ReadingPlanConfig = planPreset === '' 
        ? buildCustomPlanConfig() 
        : buildPresetPlanConfig(planPreset);
      
      planGenerationStatus = 'Calculating reading schedule...';
      currentReadingPlan = generateReadingPlan(config);
      currentPlanId = `plan_${Date.now()}`;
      
      saveActivePlan();
      savePlanToHistory(currentReadingPlan, currentPlanId);
      
      planGenerationStatus = `✓ Plan created! ${currentReadingPlan.totalDays} days, ${currentReadingPlan.totalChapters} chapters`;
      
      setTimeout(() => {
        currentTab = 'active';
      }, 1000);
      
    } catch (error) {
      planGenerationStatus = `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  
  function buildCustomPlanConfig(): ReadingPlanConfig {
    const startDate = new Date(planStartDate);
    const endDate = new Date(planEndDate);
    
    const excludedWeekdays: number[] = [];
    dayChecks.forEach((checked, i) => {
      if (!checked) excludedWeekdays.push(i);
    });
    
    const books = Array.from(selectedBooks).map(book => ({ book }));
    
    if (books.length === 0) {
      throw new Error('Please select at least one book');
    }
    
    return {
      startDate,
      endDate,
      excludedWeekdays: excludedWeekdays.length > 0 ? excludedWeekdays : undefined,
      books,
      ordering,
      dailyPsalm: optDailyPsalm,
      randomizePsalms: optRandomizePsalms,
      dailyProverb: optDailyProverb,
      randomizeProverbs: optRandomizeProverbs,
      reverseOrder: optReverseOrder,
      showOverallStats: optShowOverallStats,
      showDailyStats: optShowDailyStats
    };
  }
  
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
          books: BIBLE_BOOKS.map(b => ({ book: b.name })),
          ordering: 'canonical',
          showOverallStats: true,
          showDailyStats: true
        };
      case 'nt-90-days':
        return {
          startDate: today,
          endDate: ninetyDaysLater,
          books: BIBLE_BOOKS.filter(b => b.testament === 'NT').map(b => ({ book: b.name })),
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
          books: BIBLE_BOOKS.map(b => ({ book: b.name })),
          ordering: 'chronological',
          showOverallStats: true,
          showDailyStats: true
        };
      case 'psalms-proverbs':
        return {
          startDate: today,
          endDate: new Date(today.getTime() + 150 * 24 * 60 * 60 * 1000),
          books: [{ book: 'Psalms' }, { book: 'Proverbs' }],
          ordering: 'canonical',
          showOverallStats: true,
          showDailyStats: true
        };
      default:
        throw new Error('Unknown preset: ' + preset);
    }
  }
  
  function getTodayReading() {
    if (!currentReadingPlan) return null;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    return currentReadingPlan.days.find(day => {
      const dayDate = new Date(day.date);
      dayDate.setHours(0, 0, 0, 0);
      return dayDate.getTime() === today.getTime();
    });
  }
  
  function navigateToChapter(book: string, chapter: number) {
    navigationStore.setBook(book);
    navigationStore.setChapter(chapter);
    isOpen = false;
  }
  
  function close() {
    isOpen = false;
  }
  
  $: todayReading = getTodayReading();
</script>

{#if isOpen}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="modal-overlay" on:click={close}>
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="modal-content" on:click|stopPropagation>
      <div class="modal-header">
        <h2>📖 Reading Plan</h2>
        <button class="close-btn" on:click={close}>&times;</button>
      </div>
      
      <div class="tabs">
        <button 
          class="tab" 
          class:active={currentTab === 'create'}
          on:click={() => currentTab = 'create'}
        >
          Create Plan
        </button>
        <button 
          class="tab" 
          class:active={currentTab === 'active'}
          on:click={() => currentTab = 'active'}
        >
          Active Plan
        </button>
        <button 
          class="tab" 
          class:active={currentTab === 'history'}
          on:click={() => { currentTab = 'history'; loadPlanHistory(); }}
        >
          History
        </button>
      </div>
      
      <div class="tab-content">
        {#if currentTab === 'create'}
          <div class="create-plan-tab">
            <div class="form-group">
              <label for="preset">Preset Plan:</label>
              <select id="preset" bind:value={planPreset}>
                <option value="">Custom...</option>
                <option value="bible-1-year">Bible in 1 Year</option>
                <option value="nt-90-days">New Testament in 90 Days</option>
                <option value="gospels-30-days">Gospels in 30 Days</option>
                <option value="chronological-1-year">Chronological Bible in 1 Year</option>
                <option value="psalms-proverbs">Psalms & Proverbs</option>
              </select>
            </div>
            
            {#if planPreset === ''}
              <div class="custom-options">
                <h3>Date Range</h3>
                <div class="form-group">
                  <label for="startDate">Start Date:</label>
                  <input type="date" id="startDate" bind:value={planStartDate} />
                </div>
                <div class="form-group">
                  <label for="endDate">End Date:</label>
                  <input type="date" id="endDate" bind:value={planEndDate} />
                </div>
                
                <h3>Reading Days</h3>
                <div class="days-grid">
                  <label><input type="checkbox" bind:checked={dayChecks[0]} /> Sunday</label>
                  <label><input type="checkbox" bind:checked={dayChecks[1]} /> Monday</label>
                  <label><input type="checkbox" bind:checked={dayChecks[2]} /> Tuesday</label>
                  <label><input type="checkbox" bind:checked={dayChecks[3]} /> Wednesday</label>
                  <label><input type="checkbox" bind:checked={dayChecks[4]} /> Thursday</label>
                  <label><input type="checkbox" bind:checked={dayChecks[5]} /> Friday</label>
                  <label><input type="checkbox" bind:checked={dayChecks[6]} /> Saturday</label>
                </div>
                
                <h3>Book Selection</h3>
                <div class="book-buttons">
                  <button on:click={selectAllBooks}>Select All</button>
                  <button on:click={selectNone}>Select None</button>
                  <button on:click={selectOT}>OT Only</button>
                  <button on:click={selectNT}>NT Only</button>
                </div>
                <div class="book-grid">
                  {#each BIBLE_BOOKS as book}
                    <label>
                      <input 
                        type="checkbox" 
                        checked={selectedBooks.has(book.name)}
                        on:change={() => toggleBook(book.name)}
                      />
                      {book.name}
                    </label>
                  {/each}
                </div>
                
                <h3>Reading Order</h3>
                <div class="radio-group">
                  <label><input type="radio" bind:group={ordering} value="canonical" /> Canonical (Traditional)</label>
                  <label><input type="radio" bind:group={ordering} value="chronological" /> Chronological (Historical Order)</label>
                  <label><input type="radio" bind:group={ordering} value="shuffled" /> Shuffled (Random)</label>
                </div>
                
                <h3>Advanced Options</h3>
                <div class="options-group">
                  <label>
                    <input type="checkbox" bind:checked={optDailyPsalm} />
                    Add one Psalm per day
                    {#if optDailyPsalm}
                      <div class="sub-option">
                        <label><input type="checkbox" bind:checked={optRandomizePsalms} /> Randomize Psalms?</label>
                      </div>
                    {/if}
                  </label>
                  <label>
                    <input type="checkbox" bind:checked={optDailyProverb} />
                    Add one Proverb per day
                    {#if optDailyProverb}
                      <div class="sub-option">
                        <label><input type="checkbox" bind:checked={optRandomizeProverbs} /> Randomize Proverbs?</label>
                      </div>
                    {/if}
                  </label>
                  <label><input type="checkbox" bind:checked={optReverseOrder} /> Reverse Order</label>
                  <label><input type="checkbox" bind:checked={optShowOverallStats} /> Show Overall Statistics</label>
                  <label><input type="checkbox" bind:checked={optShowDailyStats} /> Show Daily Statistics</label>
                </div>
              </div>
            {/if}
            
            <button class="generate-btn" on:click={generatePlan}>Generate Plan</button>
            {#if planGenerationStatus}
              <div class="status">{planGenerationStatus}</div>
            {/if}
          </div>
        {:else if currentTab === 'active'}
          <div class="active-plan-tab">
            {#if currentReadingPlan}
              <div class="plan-overview">
                <div class="overview-header">
                  <h3>📊 Plan Overview</h3>
                  <button class="delete-btn" on:click={deleteCurrentPlan}>🗑️ Delete Plan</button>
                </div>
                <div class="stats-grid">
                  <div><strong>Total Days:</strong> {currentReadingPlan.totalDays}</div>
                  <div><strong>Total Chapters:</strong> {currentReadingPlan.totalChapters}</div>
                  <div><strong>Avg/Day:</strong> {currentReadingPlan.avgChaptersPerDay.toFixed(1)} chapters</div>
                  <div><strong>Start:</strong> {new Date(currentReadingPlan.config.startDate).toLocaleDateString()}</div>
                  <div><strong>End:</strong> {new Date(currentReadingPlan.config.endDate).toLocaleDateString()}</div>
                </div>
              </div>
              
              {#if todayReading}
                <div class="today-reading">
                  <h3>📖 Today's Reading (Day {todayReading.dayNumber})</h3>
                  <p class="chapters-list">
                    {#each todayReading.chapters as chapter, i}
                      <button 
                        class="chapter-link" 
                        on:click={() => navigateToChapter(chapter.book, chapter.chapter)}
                      >
                        {chapter.book} {chapter.chapter}
                      </button>{#if i < todayReading.chapters.length - 1}, {/if}
                    {/each}
                  </p>
                  <p class="chapter-count">{todayReading.chapters.length} chapters</p>
                  <button 
                    class="start-reading-btn" 
                    on:click={() => navigateToChapter(todayReading.chapters[0].book, todayReading.chapters[0].chapter)}
                  >
                    Start Reading →
                  </button>
                </div>
              {:else}
                <div class="no-reading">
                  <p>Today is not a reading day in this plan.</p>
                </div>
              {/if}
              
              <div class="view-toggle">
                <button 
                  class:active={viewMode === 'calendar'}
                  on:click={() => viewMode = 'calendar'}
                >
                  Calendar View
                </button>
                <button 
                  class:active={viewMode === 'list'}
                  on:click={() => viewMode = 'list'}
                >
                  List View
                </button>
              </div>
              
              {#if viewMode === 'calendar'}
                <div class="calendar-view">
                  {#each currentReadingPlan.days.slice(0, 30) as day}
                    <div class="day-card" class:today={todayReading && day.dayNumber === todayReading.dayNumber}>
                      <div class="day-header">
                        <strong>Day {day.dayNumber}</strong>
                        <span class="day-date">{new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                      </div>
                      <div class="day-chapters">
                        {#each day.chapters as chapter}
                          <div class="chapter-item">{chapter.book} {chapter.chapter}</div>
                        {/each}
                      </div>
                    </div>
                  {/each}
                </div>
              {:else}
                <div class="list-view">
                  {#each currentReadingPlan.days as day}
                    <div class="list-day" class:today={todayReading && day.dayNumber === todayReading.dayNumber}>
                      <div class="list-day-header">
                        <strong>Day {day.dayNumber}</strong> - {new Date(day.date).toLocaleDateString()}
                      </div>
                      <div class="list-day-chapters">
                        {#each day.chapters as chapter, i}
                          {chapter.book} {chapter.chapter}{#if i < day.chapters.length - 1}, {/if}
                        {/each}
                      </div>
                    </div>
                  {/each}
                </div>
              {/if}
            {:else}
              <p>No active plan. Create one to get started!</p>
            {/if}
          </div>
        {:else}
          <div class="history-tab">
            {#if planHistory.length > 0}
              {#each planHistory as item}
                <div class="history-item">
                  <div class="history-header">
                    <div>
                      <div class="history-title">
                        {item.plan.config.ordering.charAt(0).toUpperCase() + item.plan.config.ordering.slice(1)} Plan
                      </div>
                      <div class="history-date">Created {new Date(item.createdAt).toLocaleDateString()}</div>
                    </div>
                    <button class="delete-btn" on:click={() => deletePlanFromHistory(item.id)}>Delete</button>
                  </div>
                  <div class="history-stats">
                    <strong>{item.plan.totalDays}</strong> days • <strong>{item.plan.totalChapters}</strong> chapters
                  </div>
                  <div class="history-dates">
                    {new Date(item.plan.config.startDate).toLocaleDateString()} → {new Date(item.plan.config.endDate).toLocaleDateString()}
                  </div>
                </div>
              {/each}
            {:else}
              <p>No past plans yet.</p>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 20px;
  }
  
  .modal-content {
    background: #1a1a1a;
    border: 1px solid #3a3a3a;
    border-radius: 12px;
    max-width: 800px;
    width: 100%;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  }
  
  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px;
    border-bottom: 2px solid #3a3a3a;
  }
  
  .modal-header h2 {
    margin: 0;
    font-size: 24px;
    color: #e0e0e0;
  }
  
  .close-btn {
    background: none;
    border: none;
    font-size: 28px;
    cursor: pointer;
    color: #888;
    padding: 0;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
  }
  
  .close-btn:hover {
    background: #2a2a2a;
    color: #e0e0e0;
  }
  
  .tabs {
    display: flex;
    border-bottom: 2px solid #3a3a3a;
    padding: 0 20px;
    background: #0f0f0f;
  }
  
  .tab {
    padding: 12px 20px;
    background: none;
    border: none;
    border-bottom: 3px solid transparent;
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
    color: #888;
    transition: all 0.2s;
  }
  
  .tab:hover {
    color: #aaa;
    background: #1a1a1a;
  }
  
  .tab.active {
    color: #4caf50;
    border-bottom-color: #4caf50;
    background: #1a1a1a;
  }
  
  .tab-content {
    padding: 20px;
    overflow-y: auto;
    flex: 1;
  }
  
  .form-group {
    margin-bottom: 15px;
  }
  
  .form-group label {
    display: block;
    margin-bottom: 5px;
    font-weight: 600;
    color: #e0e0e0;
  }
  
  .form-group input,
  .form-group select {
    width: 100%;
    padding: 8px;
    border: 1px solid #3a3a3a;
    border-radius: 4px;
    font-size: 14px;
    background: #0f0f0f;
    color: #e0e0e0;
  }
  
  .form-group input:focus,
  .form-group select:focus {
    outline: none;
    border-color: #4caf50;
  }
  
  h3 {
    font-size: 16px;
    margin: 20px 0 10px 0;
    color: #e0e0e0;
  }
  
  .days-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 10px;
    margin-bottom: 15px;
  }
  
  .days-grid label {
    display: flex;
    align-items: center;
    gap: 5px;
    color: #ccc;
  }
  
  .book-buttons {
    display: flex;
    gap: 10px;
    margin-bottom: 15px;
  }
  
  .book-buttons button {
    padding: 6px 12px;
    border: 1px solid #3a3a3a;
    border-radius: 4px;
    background: #2a2a2a;
    color: #e0e0e0;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .book-buttons button:hover {
    background: #3a3a3a;
    border-color: #4a4a4a;
  }
  
  .book-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 8px;
    max-height: 300px;
    overflow-y: auto;
    padding: 10px;
    background: #0f0f0f;
    border: 1px solid #3a3a3a;
    border-radius: 4px;
    margin-bottom: 15px;
  }
  
  .book-grid label {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 13px;
    color: #ccc;
  }
  
  .book-grid input[type="checkbox"] {
    width: auto;
  }
  
  .radio-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 15px;
  }
  
  .radio-group label {
    display: flex;
    align-items: center;
    gap: 5px;
    color: #ccc;
  }
  
  .options-group {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  
  .options-group label {
    display: flex;
    flex-direction: column;
    gap: 5px;
    color: #ccc;
  }
  
  .sub-option {
    margin-left: 25px;
    margin-top: 5px;
  }
  
  .generate-btn {
    padding: 12px 24px;
    background: linear-gradient(135deg, #4caf50 0%, #2e7d32 100%);
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 600;
    margin-top: 20px;
    transition: all 0.2s;
    box-shadow: 0 2px 8px rgba(76, 175, 80, 0.3);
  }
  
  .generate-btn:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(76, 175, 80, 0.4);
  }
  
  .status {
    margin-top: 10px;
    padding: 10px;
    border-radius: 4px;
    background: #2a2a2a;
    color: #e0e0e0;
    border: 1px solid #3a3a3a;
  }
  
  .plan-overview {
    background: #2a2a2a;
    border: 1px solid #3a3a3a;
    padding: 15px;
    border-radius: 8px;
    margin-bottom: 20px;
  }
  
  .overview-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
  }
  
  .overview-header h3 {
    margin: 0;
  }
  
  .delete-btn {
    padding: 6px 12px;
    background: #f44336;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
  }
  
  .delete-btn:hover {
    background: #d32f2f;
  }
  
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 12px;
    font-size: 14px;
    color: #ccc;
  }
  
  .today-reading {
    background: #1a2e1a;
    border: 1px solid #2e5d2e;
    padding: 15px;
    border-radius: 8px;
    border-left: 4px solid #4caf50;
    margin-bottom: 20px;
  }
  
  .today-reading h3 {
    margin: 0 0 10px 0;
    color: #8bc34a;
  }
  
  .chapters-list {
    margin: 5px 0;
    font-size: 15px;
    color: #aed581;
  }
  
  .chapter-link {
    background: none;
    border: none;
    color: #4caf50;
    font-weight: 500;
    cursor: pointer;
    text-decoration: underline;
    padding: 0;
  }
  
  .chapter-link:hover {
    color: #66bb6a;
  }
  
  .chapter-count {
    margin: 5px 0;
    font-size: 13px;
    color: #9ccc65;
  }
  
  .start-reading-btn {
    margin-top: 10px;
    padding: 8px 16px;
    background: #4caf50;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .start-reading-btn:hover {
    background: #66bb6a;
  }
  
  .no-reading {
    padding: 15px;
    background: #2a2a2a;
    border: 1px solid #3a3a3a;
    border-radius: 8px;
    margin-bottom: 20px;
    color: #888;
  }
  
  .view-toggle {
    display: flex;
    gap: 10px;
    margin-bottom: 15px;
  }
  
  .view-toggle button {
    padding: 8px 16px;
    border: 1px solid #3a3a3a;
    border-radius: 4px;
    background: #2a2a2a;
    color: #ccc;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .view-toggle button:hover {
    background: #3a3a3a;
  }
  
  .view-toggle button.active {
    background: #4caf50;
    color: white;
    border-color: #4caf50;
  }
  
  .calendar-view {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 15px;
  }
  
  .day-card {
    background: #2a2a2a;
    border: 1px solid #3a3a3a;
    border-radius: 8px;
    padding: 12px;
    transition: all 0.2s;
  }
  
  .day-card:hover {
    border-color: #4a4a4a;
  }
  
  .day-card.today {
    border-color: #4caf50;
    background: #1a2e1a;
  }
  
  .day-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
    padding-bottom: 8px;
    border-bottom: 1px solid #3a3a3a;
    color: #e0e0e0;
  }
  
  .day-date {
    font-size: 12px;
    color: #888;
  }
  
  .day-chapters {
    font-size: 13px;
    color: #ccc;
  }
  
  .chapter-item {
    margin: 3px 0;
  }
  
  .list-view {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  
  .list-day {
    background: #2a2a2a;
    border: 1px solid #3a3a3a;
    padding: 12px;
    border-radius: 8px;
    border-left: 3px solid transparent;
  }
  
  .list-day.today {
    border-left-color: #4caf50;
    background: #1a2e1a;
  }
  
  .list-day-header {
    font-weight: 600;
    margin-bottom: 5px;
    color: #e0e0e0;
  }
  
  .list-day-chapters {
    font-size: 14px;
    color: #aaa;
  }
  
  .history-item {
    background: #2a2a2a;
    border: 1px solid #3a3a3a;
    padding: 15px;
    border-radius: 8px;
    margin-bottom: 15px;
    transition: all 0.2s;
  }
  
  .history-item:hover {
    border-color: #4a4a4a;
  }
  
  .history-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 10px;
  }
  
  .history-title {
    font-weight: 600;
    margin-bottom: 5px;
    color: #e0e0e0;
  }
  
  .history-date {
    font-size: 13px;
    color: #888;
  }
  
  .history-stats {
    font-size: 13px;
    margin-bottom: 5px;
    color: #ccc;
  }
  
  .history-dates {
    font-size: 13px;
    color: #888;
  }
</style>
