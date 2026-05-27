<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { get } from 'svelte/store';
  import { generateReadingPlan, BIBLE_BOOKS, type ReadingPlanConfig, type ReadingPlan, type HarmonySection, type HarmonyPassage } from '@projectbible/core';
  import { VERSE_COUNTS } from '../../../../packages/core/src/BibleMetadata';
  import { suggestCatchUp, getDaysAheadBehind, calculateStreak } from '../../../../packages/core/src/ReadingPlanEngine';
  import { navigationStore } from '../stores/navigationStore';
  import { localDateStr } from '../stores/clockStore';
  import {
    readingProgressStore,
    getLatestChapterState,
    type ReadingProgressEntry,
    type HarmonySectionProgress,
  } from '../stores/ReadingProgressStore';
  import { readingSessionStore } from '../stores/readingSessionStore';
  import { profileModalStore } from '../stores/profileModalStore';
  import { planMetadataStore } from '../stores/PlanMetadataStore';
  import { syncService, type SyncState } from '../lib/sync';
  import { syncQueue } from '../lib/sync/SyncQueueService';
  import { userProfileStore } from '../stores/userProfileStore';
  import { readingProgressVersion } from '../stores/readingProgressVersionStore';
  import CalendarView from './CalendarView.svelte';
  import harmonyData from '../data/robertson-harmony.json';
  import { BookOpenText } from 'phosphor-svelte';
  
  export let isOpen = false;
  
  let currentTab: 'create' | 'active' | 'history' = 'create';
  let currentReadingPlan: ReadingPlan | null = null;
  let currentPlanId: string | null = null;

  // Multi-plan state
  let activePlans: Array<{id: string, plan: ReadingPlan}> = [];
  let selectedPlanId: string | null = null;
  let activePlanViewTab: string = ''; // plan id or 'all'
  
  // Storage keys
  const STORAGE_ACTIVE_PLAN = 'projectbible_active_reading_plan'; // legacy key (migration source)
  const STORAGE_ACTIVE_PLANS = 'projectbible_active_reading_plans'; // new multi-plan key
  const STORAGE_PLAN_HISTORY = 'projectbible_reading_plan_history';
  
  // Create plan form state
  let planPreset = '';
  let planName = '';
  let planStartDate = localDateStr(new Date());
  let planEndDate = localDateStr(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000));
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
  let viewMode: 'calendar' | 'list' | 'catchup' = 'calendar';
  let dayProgressMap = new Map<number, ReadingProgressEntry>();
  let lastLoadedPlanId: string | null = null;
  let catchUpMode: 'spread' | 'dedicated' = 'spread';
  let maxCatchUpPerDay = 3;
  let catchUpDays: Array<{ dayNumber: number; date: Date; chapters: Array<{ book: string; chapter: number }> }> = [];
  const CATCHUP_STORAGE_PREFIX = 'projectbible_catchup_days_';
  let showCatchUpDays = true;
  let verseStats = {
    total: 0,
    read: 0,
    remaining: 0,
    todayRead: 0,
  };
  let syncStatus = 'Not synced';
  let syncError: string | null = null;
  let userName: string | null = null;
  let isSignedIn = false;

  // Congrats overlay + inline rename + two-step delete state
  let congratsPlanName: string | null = null;
  let planRenamingId: string | null = null;
  let planRenameValue = '';
  let planDeleteConfirmId: string | null = null;
  
  // Derived book lists
  const OT_BOOKS = BIBLE_BOOKS.filter(b => b.testament === 'OT').map(b => b.name);
  const NT_BOOKS = BIBLE_BOOKS.filter(b => b.testament === 'NT').map(b => b.name);
  
  onMount(() => {
    loadActivePlan();
    loadPlanHistory();
    let lastKnownSyncTime: number | null = null;
    const unsubscribeSync = syncService.subscribe(async (state: SyncState) => {
      syncError = state.error;
      if (state.status === 'syncing') syncStatus = 'Syncing...';
      else if (state.status === 'idle') {
        syncStatus = state.lastSyncedAt ? `Synced ${state.lastSyncedAt.toLocaleTimeString()}` : 'Ready';
        // Reload progress from IndexedDB whenever a sync cycle completes so that
        // data pulled from Supabase (e.g. from another device) is reflected
        // immediately in both the today's blue section and the day list.
        const syncTime = state.lastSyncedAt?.getTime() ?? null;
        if (syncTime && syncTime !== lastKnownSyncTime) {
          lastKnownSyncTime = syncTime;
          // Re-read the active plan from localStorage first — in a fresh window
          // the plan may have just been written there by applyRemoteReadingPlans
          // while currentPlanId was still null from the onMount call.
          loadActivePlan();
          await loadProgressForPlan();
        }
      }
      else if (state.status === 'error') syncStatus = 'Sync error';
      else if (state.status === 'offline') syncStatus = 'Offline';
      else syncStatus = 'Not synced';
    });
    const unsubscribeProfile = userProfileStore.subscribe((profile) => {
      userName = profile.name;
      isSignedIn = profile.isSignedIn;
    });
    return () => {
      unsubscribeSync();
      unsubscribeProfile();
    };
  });

  // Re-read localStorage every time the modal opens so that plans synced
  // in the background (after onMount ran) are picked up immediately.
  // Also trigger a sync so that the latest Supabase data is pulled —
  // this is the key step that makes a second device see up-to-date progress.
  $: if (isOpen) {
    loadActivePlan();
    // Load local progress immediately so the UI isn't blank while sync runs.
    loadProgressForPlan();
    // Then kick off a sync in the background (throttled to once per 30s).
    // This pushes any queued writes to Supabase AND pulls the latest progress
    // down, which will trigger loadProgressForPlan() again via the sync
    // subscriber once the pull completes.
    if (isSignedIn) {
      // Re-push all local plan rows so Supabase always has them (restores deleted
      // rows and propagates plans created on other devices).
      syncActivePlansToSupabase();
      syncService.forceSync(30_000);
    }
  }

  // Reload progress whenever a Realtime event or pull from Supabase writes
  // new reading_progress rows — works whether the modal is open or closed.
  $: if ($readingProgressVersion > 0) {
    loadProgressForPlan();
  }

  $: if (currentReadingPlan) {
    dayProgressMap;
    verseStats = computeVerseStats();
  }

  $: if (currentReadingPlan && currentPlanId && currentPlanId !== lastLoadedPlanId) {
    dayProgressMap = new Map(); // clear stale data immediately before async reload
    loadProgressForPlan();
    loadCatchUpDays();
  }

  function loadActivePlan() {
    try {
      // Try localStorage first (signed-in), then sessionStorage (signed-out / temporary)
      const storedNew = localStorage.getItem(STORAGE_ACTIVE_PLANS) ?? sessionStorage.getItem(STORAGE_ACTIVE_PLANS);
      if (storedNew) {
        const data: Array<{id: string, plan: ReadingPlan}> = JSON.parse(storedNew);
        activePlans = data;
        for (const entry of activePlans) {
          if (entry.plan) {
            entry.plan.config.startDate = new Date(entry.plan.config.startDate);
            entry.plan.config.endDate = new Date(entry.plan.config.endDate);
            entry.plan.days.forEach(day => { day.date = new Date(day.date); });
          }
        }
        // Restore selectedPlanId if still valid, else pick last
        if (!selectedPlanId || !activePlans.find(p => p.id === selectedPlanId)) {
          selectedPlanId = activePlans.length > 0 ? activePlans[activePlans.length - 1].id : null;
        }
      } else {
        // Migrate from legacy single-plan key
        const storedOld = localStorage.getItem(STORAGE_ACTIVE_PLAN);
        if (storedOld) {
          const data = JSON.parse(storedOld);
          activePlans = [{ id: data.id, plan: data.plan }];
          if (activePlans[0].plan) {
            activePlans[0].plan.config.startDate = new Date(activePlans[0].plan.config.startDate);
            activePlans[0].plan.config.endDate = new Date(activePlans[0].plan.config.endDate);
            activePlans[0].plan.days.forEach(day => { day.date = new Date(day.date); });
          }
          selectedPlanId = data.id;
          // Write to new key and remove legacy key
          localStorage.setItem(STORAGE_ACTIVE_PLANS, JSON.stringify(activePlans));
          localStorage.removeItem(STORAGE_ACTIVE_PLAN);
        }
      }
      // Sync currentReadingPlan / currentPlanId from selected
      const selected = activePlans.find(p => p.id === selectedPlanId);
      currentReadingPlan = selected?.plan ?? null;
      currentPlanId = selectedPlanId;
      // Default activePlanViewTab: 'all' when 2+ plans, else selected plan
      if (!activePlanViewTab || !['all', ...activePlans.map(p => p.id)].includes(activePlanViewTab)) {
        activePlanViewTab = activePlans.length >= 2 ? 'all' : (selectedPlanId ?? '');
      }
    } catch (e) {
      console.error('Error loading active plan:', e);
    }
  }
  
  function saveActivePlan() {
    // Update the activePlans entry for the current plan if it was modified in-place
    if (currentReadingPlan && currentPlanId) {
      const idx = activePlans.findIndex(p => p.id === currentPlanId);
      if (idx >= 0) {
        activePlans[idx] = { id: currentPlanId, plan: currentReadingPlan };
      }
    }
    const storage = isSignedIn ? localStorage : sessionStorage;
    if (activePlans.length > 0) {
      storage.setItem(STORAGE_ACTIVE_PLANS, JSON.stringify(activePlans));
    } else {
      storage.removeItem(STORAGE_ACTIVE_PLANS);
    }
  }
  
  function loadPlanHistory() {
    try {
      const historyStr = localStorage.getItem(STORAGE_PLAN_HISTORY);
      planHistory = historyStr ? JSON.parse(historyStr) : [];

      // Phase 3: migrate abandoned (completedAt===null) history items back to activePlans
      const abandoned = planHistory.filter(
        (h: any) => h.completedAt === null && !activePlans.some(p => p.id === h.id)
      );
      if (abandoned.length > 0) {
        for (const h of abandoned) {
          if (h.plan) {
            try {
              h.plan.config.startDate = new Date(h.plan.config.startDate);
              h.plan.config.endDate = new Date(h.plan.config.endDate);
              h.plan.days?.forEach((d: any) => { d.date = new Date(d.date); });
            } catch {/* ignore */}
          }
          activePlans = [...activePlans, { id: h.id, plan: h.plan }];
        }
        if (isSignedIn) {
          localStorage.setItem(STORAGE_ACTIVE_PLANS, JSON.stringify(activePlans));
        }
        if (!selectedPlanId) {
          selectedPlanId = activePlans[activePlans.length - 1].id;
          currentReadingPlan = activePlans[activePlans.length - 1].plan;
          currentPlanId = selectedPlanId;
        }
        if (activePlans.length >= 2) activePlanViewTab = 'all';
      }
    } catch (e) {
      console.error('Error loading plan history:', e);
      planHistory = [];
    }
  }

  function getVerseCountForChapter(bookName: string, chapter: number): number {
    return VERSE_COUNTS[bookName]?.[chapter - 1] ?? 0;
  }

  function computeVerseStats() {
    if (!currentReadingPlan) {
      return { total: 0, read: 0, remaining: 0, todayRead: 0 };
    }

    let total = 0;
    let read = 0;
    let todayRead = 0;
    const todayStr = localDateStr(new Date());

    currentReadingPlan.days.forEach((day) => {
      const progress = getDayProgress(day.dayNumber);

      day.chapters.forEach((chapter: any) => {
        const verseCount = getVerseCountForChapter(chapter.book, chapter.chapter);
        total += verseCount;

        if (!progress) return;
        const chapterProgress = progress.chaptersRead.find(
          (item) => item.book === chapter.book && item.chapter === chapter.chapter,
        );
        if (!chapterProgress || chapterProgress.actions.length === 0) return;
        const latest = chapterProgress.actions[chapterProgress.actions.length - 1];
        if (latest.type === 'checked') {
          read += verseCount;
          if (localDateStr(latest.timestamp) === todayStr) {
            todayRead += verseCount;
          }
        }
      });
    });

    return {
      total,
      read,
      remaining: Math.max(0, total - read),
      todayRead,
    };
  }

  function getOverdueDays() {
    if (!currentReadingPlan) return [];
    const todayStr = localDateStr(new Date());
    return currentReadingPlan.days.filter((day) => {
      const progress = getDayProgress(day.dayNumber);
      return localDateStr(new Date(day.date)) < todayStr && !progress?.completed;
    });
  }

  function getOverdueChapters() {
    return getOverdueDays().flatMap((day) => day.chapters);
  }

  function getEvenSpreadSuggestions() {
    if (!currentReadingPlan) return [];
    return suggestCatchUp(currentReadingPlan, getProgressEntries(), maxCatchUpPerDay);
  }

  function getDedicatedCatchUpDays() {
    const overdueChapters = getOverdueChapters();
    if (overdueChapters.length === 0) return [];

    const baseDayNumber = currentReadingPlan?.days?.[currentReadingPlan.days.length - 1]?.dayNumber ?? 0;
    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);

    const days: Array<{ dayNumber: number; date: Date; chapters: Array<{ book: string; chapter: number }> }> = [];
    let index = 0;
    let dayNumber = baseDayNumber + 1;

    while (index < overdueChapters.length) {
      const chunk = overdueChapters.slice(index, index + maxCatchUpPerDay);
      const date = new Date(startDate);
      date.setDate(date.getDate() + (dayNumber - baseDayNumber));
      days.push({
        dayNumber,
        date,
        chapters: chunk,
      });
      index += maxCatchUpPerDay;
      dayNumber += 1;
    }

    return days;
  }

  async function applyEvenSpread() {
    if (!currentPlanId) return;
    const suggestions = getEvenSpreadSuggestions();
    for (const suggestion of suggestions) {
      const existing = await readingProgressStore.getDayProgress(currentPlanId, suggestion.dayNumber);
      const entry = existing
        ? existing
        : await readingProgressStore.ensureDayProgress(
            currentPlanId,
            suggestion.dayNumber,
            currentReadingPlan?.days.find((day) => day.dayNumber === suggestion.dayNumber)?.chapters ?? [],
          );
      entry.catchUpAdjustment = {
        originalDayNumber: -1,
        addedChapters: suggestion.addedChapters,
      };
      await readingProgressStore.setCatchUpAdjustment(entry);
      dayProgressMap = new Map(dayProgressMap);
      dayProgressMap.set(entry.dayNumber, entry);
    }
    await persistCatchUpAdjustment('spread', suggestions);
    // PowerSync will automatically sync the local writes
  }

  function applyDedicatedCatchUp() {
    const days = getDedicatedCatchUpDays();
    saveCatchUpDays(days);
    if (currentPlanId) {
      void persistCatchUpAdjustment('dedicated', days);
      // PowerSync will automatically sync the local writes
    }
  }

  async function persistCatchUpAdjustment(mode: 'spread' | 'dedicated', data: any) {
    if (!currentPlanId) return;
    const existing = await planMetadataStore.getPlanMetadata(currentPlanId);
    if (!existing) return;
    await planMetadataStore.upsertPlanMetadata({
      ...existing,
      catchUpAdjustment: {
        mode,
        appliedAt: Date.now(),
        data,
      },
    });
  }

  /**
   * Re-upsert every active plan row to Supabase.
   * Called on modal open so that plans deleted from Supabase are automatically
   * restored, and plans created on the phone appear on the PC (and vice-versa).
   */
  async function syncActivePlansToSupabase(): Promise<void> {
    if (!isSignedIn || activePlans.length === 0) return;
    for (const entry of activePlans) {
      if (!entry.id || !entry.plan) continue;
      try {
        const cfg = entry.plan.config;
        // Plan IDs are "plan_<epoch-ms>" — use that as the canonical creation time.
        const createdMs = parseInt(entry.id.replace('plan_', ''), 10) || Date.now();
        await syncQueue.enqueue({
          type: 'INSERT',
          table: 'reading_plans',
          id: entry.id,
          data: {
            id: entry.id,
            name: cfg.name || `${entry.plan.totalDays}-day reading plan`,
            config: JSON.stringify({
              ...cfg,
              // Ensure Date objects are serialised as ISO strings
              startDate: cfg.startDate instanceof Date ? cfg.startDate.toISOString() : cfg.startDate,
              endDate:   cfg.endDate   instanceof Date ? cfg.endDate.toISOString()   : cfg.endDate,
            }),
            current_day_number: 1,
            status: 'active',
            activated_at: createdMs,                     // BIGINT column — epoch ms
            started_at:   createdMs,                     // BIGINT column — epoch ms
            created_at:   new Date(createdMs).toISOString(), // TIMESTAMPTZ
            updated_at:   new Date().toISOString(),          // TIMESTAMPTZ
          },
        });
      } catch (err) {
        console.warn('[ReadingPlan] Failed to queue plan re-sync:', entry.id, err);
      }
    }
  }

  async function loadProgressForPlan() {
    if (!currentPlanId) return;
    try {
      const entries = await readingProgressStore.getProgressForPlan(currentPlanId);
      const completedDays = entries.filter(e => e.completed).map(e => e.dayNumber).sort((a,b) => a-b);
      console.log(`[ReadingPlan] loadProgress: planId=${currentPlanId} total=${entries.length} completedDays=[${completedDays.join(',')}]`);
      dayProgressMap = new Map(entries.map((entry) => [entry.dayNumber, entry]));
      lastLoadedPlanId = currentPlanId;
      // Svelte doesn't track dayProgressMap through getDayProgress() calls in the
      // template (opaque function). Re-assigning currentReadingPlan forces a
      // re-render so progress-dependent expressions pick up the updated map.
      currentReadingPlan = currentReadingPlan;
    } catch (error) {
      console.error('Error loading reading progress:', error);
    }
  }

  function loadCatchUpDays() {
    if (!currentPlanId) return;
    const stored = localStorage.getItem(`${CATCHUP_STORAGE_PREFIX}${currentPlanId}`);
    if (!stored) {
      catchUpDays = [];
      return;
    }
    try {
      const parsed = JSON.parse(stored) as Array<{ dayNumber: number; date: string; chapters: Array<{ book: string; chapter: number }> }>;
      catchUpDays = parsed.map((day) => ({
        ...day,
        date: new Date(day.date),
      }));
    } catch (error) {
      console.error('Error loading catch-up days:', error);
      catchUpDays = [];
    }
  }

  function saveCatchUpDays(days: Array<{ dayNumber: number; date: Date; chapters: Array<{ book: string; chapter: number }> }>) {
    if (!currentPlanId) return;
    const serialized = days.map((day) => ({
      dayNumber: day.dayNumber,
      date: day.date.toISOString(),
      chapters: day.chapters,
    }));
    localStorage.setItem(`${CATCHUP_STORAGE_PREFIX}${currentPlanId}`, JSON.stringify(serialized));
    catchUpDays = days;
  }

  function getDayProgress(dayNumber: number): ReadingProgressEntry | undefined {
    return dayProgressMap.get(dayNumber);
  }

  function getEffectiveChapters(day: any): Array<{ book: string; chapter: number }> {
    const baseChapters = day.chapters ?? [];
    const progress = getDayProgress(day.dayNumber);
    const adjustment = progress?.catchUpAdjustment?.addedChapters ?? [];
    return [...baseChapters, ...adjustment];
  }

  function getDisplayedDays() {
    if (!currentReadingPlan) return [];
    const baseDays = currentReadingPlan.days.map((day) => ({
      ...day,
      date: new Date(day.date),
      isCatchUp: false,
    }));

    const catchUpEntries = catchUpDays.map((day) => ({
      dayNumber: day.dayNumber,
      date: new Date(day.date),
      chapters: day.chapters,
      harmonySections: undefined as HarmonySection[] | undefined,
      isCatchUp: true,
    }));

    const combined = [...baseDays, ...catchUpEntries].sort((a, b) => a.dayNumber - b.dayNumber);
    return showCatchUpDays ? combined : combined.filter((day) => !day.isCatchUp);
  }

  function getProgressEntries(): ReadingProgressEntry[] {
    return Array.from(dayProgressMap.values());
  }

  function isChapterChecked(progress: ReadingProgressEntry | undefined, book: string, chapter: number): boolean {
    const state = getLatestChapterState(progress, book, chapter);
    return state === 'checked';
  }

  function getDayProgressCounts(day: any) {
    const progress = getDayProgress(day.dayNumber);
    const effectiveChapters = getEffectiveChapters(day);
    const total = effectiveChapters.length;
    const checked = effectiveChapters.filter((chapter: any) =>
      isChapterChecked(progress, chapter.book, chapter.chapter)
    ).length;
    return { checked, total };
  }

  function getDayStatus(day: any): 'unread' | 'current' | 'completed' | 'ahead' | 'overdue' {
    const progress = getDayProgress(day.dayNumber);
    const dayStr = localDateStr(new Date(day.date));
    const todayStr = localDateStr(new Date());

    if (progress?.completed) {
      return dayStr > todayStr ? 'ahead' : 'completed';
    }
    if (day.dayNumber === firstIncompleteDayNumber) return 'current';
    if (dayStr < todayStr) return 'overdue';
    return 'unread';
  }

  async function ensureStartedReading(day: any) {
    if (!currentPlanId) return;
    const effectiveChapters = getEffectiveChapters(day);
    const progress = await readingProgressStore.ensureDayProgress(
      currentPlanId,
      day.dayNumber,
      effectiveChapters,
    );
    if (!progress.startedReadingAt) {
      const startedAt = Date.now();
      await readingProgressStore.setStartedReadingAt(currentPlanId, day.dayNumber, startedAt);
      dayProgressMap = new Map(dayProgressMap);
      dayProgressMap.set(day.dayNumber, { ...progress, startedReadingAt: startedAt });
    }
  }

  function isConsecutiveDay(chapters: Array<{ book: string; chapter: number }>): boolean {
    if (chapters.length <= 1) return true;
    for (let i = 1; i < chapters.length; i++) {
      if (chapters[i].book !== chapters[i - 1].book) return false;
      if (chapters[i].chapter !== chapters[i - 1].chapter + 1) return false;
    }
    return true;
  }

  async function handleChapterClick(day: any, chapter: any) {
    if (currentPlanId) {
      readingSessionStore.setSession({
        planId: currentPlanId,
        planType: 'standard',
        dayNumber: day.dayNumber,
      });
    }
    await ensureStartedReading(day);
    navigateToChapter(chapter.book, chapter.chapter, getEffectiveChapters(day));
  }

  // ---------------------------------------------------------------------------
  // Harmony day helpers
  // ---------------------------------------------------------------------------

  /** Build a HarmonySectionProgress[] template from day.harmonySections */
  function buildHarmonySectionTemplate(day: any): HarmonySectionProgress[] {
    const sections: HarmonySection[] = day.harmonySections ?? [];
    return sections.map(sec => ({
      sectionId: sec.section,
      title: sec.title,
      completed: false,
      passages: sec.passages.map((p: HarmonyPassage) => ({
        label: p.label,
        book: p.book,
        startChapter: p.startChapter,
        startVerse: p.startVerse,
        endChapter: p.endChapter,
        endVerse: p.endVerse,
        completed: false,
      })),
    }));
  }

  function isPassageChecked(dayNum: number, sectionId: number | string, passageLabel: string): boolean {
    const progress = getDayProgress(dayNum);
    if (!progress?.harmonySections) return false;
    const sec = progress.harmonySections.find(s => s.sectionId === sectionId);
    return sec?.passages.find(p => p.label === passageLabel)?.completed ?? false;
  }

  function getDayProgressCountsHarmony(day: any): { checked: number; total: number } {
    const sections: HarmonySection[] = day.harmonySections ?? [];
    const total = sections.reduce((n: number, s: HarmonySection) => n + s.passages.length, 0);
    const progress = getDayProgress(day.dayNumber);
    if (!progress?.harmonySections) return { checked: 0, total };
    const checked = progress.harmonySections.reduce((n, s) => n + s.passages.filter(p => p.completed).length, 0);
    return { checked, total };
  }

  async function ensureHarmonyDayStarted(day: any) {
    if (!currentPlanId) return;
    const sections: HarmonySection[] = day.harmonySections ?? [];
    const template = buildHarmonySectionTemplate(day);
    const chapterRefs = sections.flatMap(s => s.chapter_refs);
    const unique = [...new Map(chapterRefs.map(r => [r.book + r.chapter, r])).values()];
    const progress = await readingProgressStore.ensureHarmonyDayProgress(currentPlanId, day.dayNumber, template, unique);
    if (!progress.startedReadingAt) {
      const now = Date.now();
      await readingProgressStore.setStartedReadingAt(currentPlanId, day.dayNumber, now);
      dayProgressMap = new Map(dayProgressMap);
      dayProgressMap.set(day.dayNumber, { ...progress, startedReadingAt: now });
    } else {
      dayProgressMap = new Map(dayProgressMap);
      dayProgressMap.set(day.dayNumber, progress);
    }
  }

  async function handlePassageClick(day: any, passage: HarmonyPassage, passageIndex: number) {
    if (!currentPlanId) return;
    await ensureHarmonyDayStarted(day);

    readingSessionStore.setSession({
      planId: currentPlanId,
      planType: 'harmony',
      dayNumber: day.dayNumber,
      passageIndex,
    });

    const nav = get(navigationStore);
    navigationStore.setReadingPlanActiveTarget(passage.book, passage.startChapter, passage.startVerse, false);
    navigationStore.navigateTo(nav.translation, passage.book, passage.startChapter, passage.startVerse);
    isOpen = false;
  }

  async function togglePassage(day: any, sectionId: number | string, passageLabel: string) {
    if (!currentPlanId) return;
    await ensureHarmonyDayStarted(day);
    const updated = await readingProgressStore.togglePassageComplete(currentPlanId, day.dayNumber, sectionId, passageLabel);
    if (updated) {
      dayProgressMap = new Map(dayProgressMap);
      dayProgressMap.set(day.dayNumber, updated);
      await queueProgressEntry(updated);
    }
  }

  async function markHarmonyDayComplete(day: any) {
    if (!currentPlanId) return;
    await ensureHarmonyDayStarted(day);
    const updated = await readingProgressStore.markHarmonyDayComplete(currentPlanId, day.dayNumber);
    if (updated) {
      dayProgressMap = new Map(dayProgressMap);
      dayProgressMap.set(day.dayNumber, updated);
      await queueProgressEntry(updated);
    }
  }

  async function toggleChapter(day: any, chapter: any) {
    if (!currentPlanId) return;
    const effectiveChapters = getEffectiveChapters(day);
    const progress = getDayProgress(day.dayNumber);
    const currentlyChecked = isChapterChecked(progress, chapter.book, chapter.chapter);
    const updated = await readingProgressStore.setChapterAction(
      currentPlanId,
      day.dayNumber,
      effectiveChapters,
      { book: chapter.book, chapter: chapter.chapter },
      currentlyChecked ? 'unchecked' : 'checked',
    );
    dayProgressMap = new Map(dayProgressMap);
    dayProgressMap.set(day.dayNumber, updated);
    await queueProgressEntry(updated);
    if (!currentlyChecked) checkPlanCompletion(currentPlanId);
  }

  async function markDayComplete(day: any) {
    if (!currentPlanId) return;
    const effectiveChapters = getEffectiveChapters(day);
    const updated = await readingProgressStore.markDayComplete(
      currentPlanId,
      day.dayNumber,
      effectiveChapters,
    );
    dayProgressMap = new Map(dayProgressMap);
    dayProgressMap.set(day.dayNumber, updated);
    await queueProgressEntry(updated);
    checkPlanCompletion(currentPlanId);
  }

  /** Map a ReadingProgressEntry to Supabase reading_progress columns and enqueue. */
  function queueProgressEntry(entry: ReadingProgressEntry): Promise<void> {
    console.log(`[ReadingPlan] → PUSH day=${entry.dayNumber} completed=${entry.completed} chaptersRead=${entry.chaptersRead.length} id=${entry.id}`);
    // All timestamp columns (created_at, completed_at, started_reading_at, updated_at)
    // are TIMESTAMPTZ in Supabase — must send ISO 8601 strings, NOT raw epoch-ms.
    // Sending a bare number like 1777460793809 makes Postgres interpret it as a year
    // (~58000 AD) and reject with "date/time field value out of range".
    const msToIso = (ms: number | undefined | null): string | null =>
      ms != null && ms > 0 ? new Date(ms).toISOString() : null;
    return syncQueue.enqueue({
      type: 'INSERT',
      table: 'reading_progress',
      id: entry.id,
      data: {
        id: entry.id,
        plan_id: entry.planId,
        day_number: entry.dayNumber,
        completed: entry.completed ? 1 : 0,
        created_at: msToIso(entry.createdAt) ?? new Date().toISOString(),
        completed_at: msToIso(entry.completedAt),
        started_reading_at: msToIso(entry.startedReadingAt),
        chapters_read: JSON.stringify(entry.chaptersRead),
        catch_up_adjustment: entry.catchUpAdjustment
          ? JSON.stringify(entry.catchUpAdjustment)
          : null,
        updated_at: new Date().toISOString(),
      },
    });
  }

  async function syncNow() {
    if (!currentPlanId) return;
    try {
      syncStatus = 'Syncing...';
      await syncService.forceSync();
      syncStatus = `Synced ${new Date().toLocaleTimeString()}`;
    } catch (error) {
      console.error('Sync failed:', error);
      syncStatus = 'Sync failed';
    }
  }


  function getCompletionTimeline() {
    if (!currentReadingPlan) return [];
    return currentReadingPlan.days.map((day) => {
      const progress = getDayProgress(day.dayNumber);
      return {
        dayNumber: day.dayNumber,
        date: new Date(day.date).toISOString(),
        completedAt: progress?.completedAt ? new Date(progress.completedAt).toISOString() : null,
      };
    });
  }

  function exportProgressJson() {
    if (!currentReadingPlan || !currentPlanId) return;
    const payload = {
      planId: currentPlanId,
      generatedAt: new Date().toISOString(),
      totalDays: currentReadingPlan.totalDays,
      totalChapters: currentReadingPlan.totalChapters,
      verseStats,
      timeline: getCompletionTimeline(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `reading-plan-${currentPlanId}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function exportProgressMarkdown() {
    if (!currentReadingPlan || !currentPlanId) return;
    const lines: string[] = [];
    lines.push(`# Reading Plan Report`);
    lines.push('');
    lines.push(`Plan ID: ${currentPlanId}`);
    lines.push(`Generated: ${new Date().toLocaleString()}`);
    lines.push('');
    lines.push(`- Total Days: ${currentReadingPlan.totalDays}`);
    lines.push(`- Total Chapters: ${currentReadingPlan.totalChapters}`);
    lines.push(`- Verses Read: ${verseStats.read}`);
    lines.push(`- Verses Remaining: ${verseStats.remaining}`);
    lines.push(`- Percent Complete: ${verseStats.total > 0 ? Math.round((verseStats.read / verseStats.total) * 100) : 0}%`);
    lines.push('');
    lines.push('## Completion Timeline');
    lines.push('| Day | Scheduled Date | Completed At |');
    lines.push('| --- | -------------- | ------------ |');
    getCompletionTimeline().forEach((entry) => {
      lines.push(`| ${entry.dayNumber} | ${new Date(entry.date).toLocaleDateString()} | ${entry.completedAt ? new Date(entry.completedAt).toLocaleDateString() : '—'} |`);
    });
    lines.push('');

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `reading-plan-${currentPlanId}.md`;
    link.click();
    URL.revokeObjectURL(url);
  }
  
  function savePlanToHistory(plan: ReadingPlan, planId: string) {
    try {
      planHistory.unshift({
        id: planId,
        plan,
        createdAt: new Date().toISOString(),
        completedAt: null
      });
      localStorage.setItem(STORAGE_PLAN_HISTORY, JSON.stringify(planHistory));
    } catch (e) {
      console.error('Error saving plan to history:', e);
    }
  }
  
  async function deleteCurrentPlan() {
    if (!selectedPlanId) return;
    if (confirm('Are you sure you want to delete this reading plan?')) {
      const deletedId = selectedPlanId;
      activePlans = activePlans.filter(p => p.id !== deletedId);
      if (activePlans.length > 0) {
        selectedPlanId = activePlans[activePlans.length - 1].id;
        currentReadingPlan = activePlans.find(p => p.id === selectedPlanId)?.plan ?? null;
        currentPlanId = selectedPlanId;
        activePlanViewTab = selectedPlanId;
        localStorage.setItem(STORAGE_ACTIVE_PLANS, JSON.stringify(activePlans));
      } else {
        selectedPlanId = null;
        currentReadingPlan = null;
        currentPlanId = null;
        activePlanViewTab = '';
        localStorage.removeItem(STORAGE_ACTIVE_PLANS);
      }
      dayProgressMap = new Map();
      lastLoadedPlanId = null;
      if (isSignedIn) {
        await syncQueue.enqueue({ type: 'DELETE', table: 'reading_plans', id: deletedId });
      }
    }
  }
  
  async function deletePlanFromHistory(planId: string) {
    if (confirm('Are you sure you want to delete this plan from history?')) {
      planHistory = planHistory.filter(p => p.id !== planId);
      localStorage.setItem(STORAGE_PLAN_HISTORY, JSON.stringify(planHistory));
      if (isSignedIn) {
        await syncQueue.enqueue({ type: 'DELETE', table: 'reading_plans', id: planId });
      }
    }
  }

  function selectPlanTab(planId: string) {
    activePlanViewTab = planId;
    if (planId !== 'all') {
      selectedPlanId = planId;
      const entry = activePlans.find(p => p.id === planId);
      currentReadingPlan = entry?.plan ?? null;
      currentPlanId = planId;
    }
  }

  function getPlanDisplayName(config: ReadingPlanConfig): string {
    if (config.name) return config.name;
    if (config.ordering === 'harmony') return 'Gospel Harmony';
    if (config.ordering === 'chronological') return 'Chronological Plan';
    return 'Custom Plan';
  }

  function getNextChapterForPlan(plan: ReadingPlan): {book: string, chapter: number} | null {
    const todayStr = localDateStr(new Date());
    // Try today first
    const todayDay = plan.days.find(d => localDateStr(new Date(d.date)) === todayStr);
    if (todayDay?.chapters?.length) return todayDay.chapters[0];
    // Else next upcoming day
    const future = plan.days.find(d => localDateStr(new Date(d.date)) > todayStr);
    if (future?.chapters?.length) return future.chapters[0];
    return null;
  }

  function getTodayPassageProgress(dayNumber: number): { done: number; total: number } {
    const prog = getDayProgress(dayNumber);
    const sections = todayReading?.harmonySections ?? [];
    const total = sections.flatMap((s: any) => s.passages).length;
    const done = (prog?.harmonySections ?? []).flatMap((s: any) => s.passages).filter((p: any) => p.completed).length;
    return { done, total };
  }

  async function renamePlan(planId: string, newName: string) {
    const trimmed = newName.trim();
    const idx = activePlans.findIndex(p => p.id === planId);
    if (idx >= 0 && trimmed) {
      activePlans[idx].plan.config.name = trimmed;
      activePlans = [...activePlans];
      saveActivePlan();
      // Also update history entry if present
      const hIdx = planHistory.findIndex((h: any) => h.id === planId);
      if (hIdx >= 0) {
        planHistory[hIdx].plan.config.name = trimmed;
        planHistory = [...planHistory];
        localStorage.setItem(STORAGE_PLAN_HISTORY, JSON.stringify(planHistory));
      }
      if (isSignedIn) {
        const updatedConfig = activePlans[idx].plan.config;
        await syncQueue.enqueue({
          type: 'UPDATE',
          table: 'reading_plans',
          id: planId,
          data: { name: trimmed, config: JSON.stringify(updatedConfig), updated_at: new Date().toISOString() },
        });
      }
    }
    planRenamingId = null;
    planRenameValue = '';
  }

  async function archivePlan(planId: string) {
    const entry = activePlans.find(p => p.id === planId);
    if (!entry) return;
    const name = getPlanDisplayName(entry.plan.config);
    const archivedAt = Date.now();
    // Remove from active
    activePlans = activePlans.filter(p => p.id !== planId);
    if (activePlans.length > 0) {
      selectedPlanId = activePlans[activePlans.length - 1].id;
      currentReadingPlan = activePlans.find(p => p.id === selectedPlanId)?.plan ?? null;
      currentPlanId = selectedPlanId;
      activePlanViewTab = activePlans.length >= 2 ? 'all' : selectedPlanId;
    } else {
      selectedPlanId = null; currentReadingPlan = null; currentPlanId = null; activePlanViewTab = '';
    }
    saveActivePlan();
    // Set completedAt in history
    const hIdx = planHistory.findIndex((h: any) => h.id === planId);
    if (hIdx >= 0) {
      planHistory[hIdx].completedAt = new Date().toISOString();
    } else {
      planHistory.unshift({ id: planId, plan: entry.plan, createdAt: new Date().toISOString(), completedAt: new Date().toISOString() });
    }
    planHistory = [...planHistory];
    localStorage.setItem(STORAGE_PLAN_HISTORY, JSON.stringify(planHistory));
    if (isSignedIn) {
      await syncQueue.enqueue({
        type: 'UPDATE',
        table: 'reading_plans',
        id: planId,
        data: { status: 'archived', archived_at: archivedAt, completed_at: new Date(archivedAt).toISOString(), updated_at: new Date().toISOString() },
      });
    }
    congratsPlanName = name;
  }

  function focusAndSelect(node: HTMLInputElement) {
    node.focus();
    node.select();
  }

  async function deletePlanFromActive(planId: string) {
    activePlans = activePlans.filter(p => p.id !== planId);
    if (selectedPlanId === planId) {
      selectedPlanId = activePlans.length > 0 ? activePlans[activePlans.length - 1].id : null;
      currentReadingPlan = selectedPlanId ? activePlans.find(p => p.id === selectedPlanId)?.plan ?? null : null;
      currentPlanId = selectedPlanId;
    }
    if (activePlans.length >= 2) {
      activePlanViewTab = 'all';
    } else if (activePlans.length === 1) {
      activePlanViewTab = activePlans[0].id;
    } else {
      activePlanViewTab = '';
    }
    saveActivePlan();
    if (isSignedIn) {
      await syncQueue.enqueue({ type: 'DELETE', table: 'reading_plans', id: planId });
    }
  }

  function checkPlanCompletion(planId: string | null) {
    if (!planId) return;
    const entry = activePlans.find(p => p.id === planId);
    if (!entry) return;
    let total = 0;
    let checked = 0;
    for (const day of entry.plan.days) {
      for (const ch of day.chapters) {
        total++;
        const progress = dayProgressMap.get(day.dayNumber);
        const cp = progress?.chaptersRead?.find((c: any) => c.book === ch.book && c.chapter === ch.chapter);
        if (cp?.actions?.length) {
          const latest = cp.actions[cp.actions.length - 1];
          if (latest.type === 'checked') checked++;
        }
      }
    }
    if (total > 0 && checked >= total) {
      archivePlan(planId);
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
      const newPlan = generateReadingPlan(config);
      const newPlanId = `plan_${Date.now()}`;

      // Push to multi-plan array and select the new plan
      activePlans = [...activePlans, { id: newPlanId, plan: newPlan }];
      selectedPlanId = newPlanId;
      currentReadingPlan = newPlan;
      currentPlanId = newPlanId;
      activePlanViewTab = activePlans.length >= 2 ? 'all' : newPlanId;
      
      saveActivePlan();
      savePlanToHistory(newPlan, newPlanId);

      if (isSignedIn) {
        // Initialize plan in IndexedDB for sync
        planGenerationStatus = 'Initializing cloud sync...';

        // Calculate plan definition hash
        const planJson = JSON.stringify(currentReadingPlan);
        const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(planJson));
        const planHash = Array.from(new Uint8Array(hashBuffer))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');

        // Create plan metadata
        await planMetadataStore.upsertPlanMetadata({
          planId: currentPlanId,
          status: 'active',
          planDefinitionHash: planHash,
          planVersion: 1,
          activatedAt: Date.now()
        });

        // Queue reading plan to Supabase (user_id is merged automatically by SyncQueueService)
        await syncQueue.enqueue({
          type: 'INSERT',
          table: 'reading_plans',
          id: currentPlanId!,
          data: {
            id: currentPlanId!,
            name: config.name || `${currentReadingPlan.totalDays}-day reading plan`,
            config: JSON.stringify(config),
            current_day_number: 1,
            status: 'active',
            plan_definition_hash: planHash,
            plan_version: 1,
            activated_at: Date.now(),
            started_at: Date.now(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        });

        // Create day 1 progress entry and queue to Supabase
        if (currentReadingPlan.days.length > 0) {
          const day1Chapters = currentReadingPlan.days[0].chapters;
          const day1Entry = await readingProgressStore.ensureDayProgress(currentPlanId, 1, day1Chapters);
          await queueProgressEntry(day1Entry);
        }

        planGenerationStatus = `✓ Plan created! ${currentReadingPlan.totalDays} days, ${currentReadingPlan.totalChapters} chapters`;
      } else {
        planGenerationStatus = `✓ Plan created (local only — sign in to save permanently). ${currentReadingPlan.totalDays} days, ${currentReadingPlan.totalChapters} chapters`;
      }
      
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
      name: planName.trim() || undefined,
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
          name: 'Bible in 1 Year',
          startDate: today,
          endDate: oneYearLater,
          books: BIBLE_BOOKS.map(b => ({ book: b.name })),
          ordering: 'canonical',
          showOverallStats: true,
          showDailyStats: true
        };
      case 'nt-90-days':
        return {
          name: 'NT in 90 Days',
          startDate: today,
          endDate: ninetyDaysLater,
          books: BIBLE_BOOKS.filter(b => b.testament === 'NT').map(b => ({ book: b.name })),
          ordering: 'canonical',
          showOverallStats: true,
          showDailyStats: true
        };
      case 'gospels-30-days':
        return {
          name: 'Gospels in 30 Days',
          startDate: today,
          endDate: thirtyDaysLater,
          books: ['Matthew', 'Mark', 'Luke', 'John'].map(book => ({ book })),
          ordering: 'canonical',
          showOverallStats: true,
          showDailyStats: true
        };
      case 'chronological-1-year':
        return {
          name: 'Chronological 1 Year',
          startDate: today,
          endDate: oneYearLater,
          books: BIBLE_BOOKS.map(b => ({ book: b.name })),
          ordering: 'chronological',
          showOverallStats: true,
          showDailyStats: true
        };
      case 'psalms-proverbs':
        return {
          name: 'Psalms & Proverbs',
          startDate: today,
          endDate: new Date(today.getTime() + 150 * 24 * 60 * 60 * 1000),
          books: [{ book: 'Psalms' }, { book: 'Proverbs' }],
          ordering: 'canonical',
          showOverallStats: true,
          showDailyStats: true
        };
      case 'gospel-harmony-30':
        return {
          name: 'Gospel Harmony (30 Days)',
          startDate: today,
          endDate: new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000),
          books: [],
          ordering: 'harmony',
          harmonyData: harmonyData as unknown as HarmonySection[],
          showOverallStats: true,
          showDailyStats: true,
        };
      case 'gospel-harmony-60':
        return {
          name: 'Gospel Harmony (60 Days)',
          startDate: today,
          endDate: new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000),
          books: [],
          ordering: 'harmony',
          harmonyData: harmonyData as unknown as HarmonySection[],
          showOverallStats: true,
          showDailyStats: true,
        };
      case 'gospel-harmony-90':
        return {
          name: 'Gospel Harmony (90 Days)',
          startDate: today,
          endDate: new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000),
          books: [],
          ordering: 'harmony',
          harmonyData: harmonyData as unknown as HarmonySection[],
          showOverallStats: true,
          showDailyStats: true,
        };
      case 'gospel-harmony-184':
        return {
          name: 'Gospel Harmony (Full)',
          startDate: today,
          endDate: new Date(today.getTime() + 184 * 24 * 60 * 60 * 1000),
          books: [],
          ordering: 'harmony',
          harmonyData: harmonyData as unknown as HarmonySection[],
          showOverallStats: true,
          showDailyStats: true,
        };
      default:
        throw new Error('Unknown preset: ' + preset);
    }
  }
  
  function getTodayReading() {
    if (!currentReadingPlan) return null;
    const todayStr = localDateStr(new Date());
    // Show the first incomplete day that is due (past or today) — keeps user on track, never skips to future
    const firstOverdueIncomplete = currentReadingPlan.days.find(day =>
      localDateStr(new Date(day.date)) <= todayStr && !getDayProgress(day.dayNumber)?.completed
    );
    if (firstOverdueIncomplete) return firstOverdueIncomplete;
    // All past/today days are complete — show today so the user sees the green "complete" state
    return currentReadingPlan.days.find(day => localDateStr(new Date(day.date)) === todayStr) ?? null;
  }
  
  function navigateToChapter(book: string, chapter: number, chapters: Array<{ book: string; chapter: number }> = [{ book, chapter }]) {
    const consecutiveDay = isConsecutiveDay(chapters);
    navigationStore.setReadingPlanActiveTarget(book, chapter, null, consecutiveDay);
    navigationStore.setBook(book);
    navigationStore.setChapter(chapter);
    isOpen = false;
  }
  
  function close() {
    isOpen = false;
  }
  
  // Track firstIncompleteDayNumber reactively so getDayStatus() highlights the right day
  // Only consider days that are due (past or today) — never highlight a future day as current
  $: firstIncompleteDayNumber = (() => {
    void dayProgressMap; // explicit reactive dependency
    if (!currentReadingPlan) return null;
    const todayStr = localDateStr(new Date());
    return currentReadingPlan.days.find(d =>
      localDateStr(new Date(d.date)) <= todayStr && !getDayProgress(d.dayNumber)?.completed
    )?.dayNumber ?? null;
  })();

  $: todayReading = (void dayProgressMap, currentReadingPlan ? getTodayReading() : null);

  function getNextReadingDay() {
    if (!currentReadingPlan) return null;
    const todayStr = localDateStr(new Date());
    return currentReadingPlan.days.find(day => {
      return localDateStr(new Date(day.date)) > todayStr && !getDayProgress(day.dayNumber)?.completed;
    }) ?? null;
  }

  async function scrollToDayInList(dayNumber: number) {
    viewMode = 'list';
    await tick();
    const el = document.querySelector(`[data-day-number="${dayNumber}"]`) as HTMLElement | null;
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
</script>

{#if isOpen}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="modal-overlay" on:click={close}>
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="modal-content" on:click|stopPropagation>
      <div class="modal-header">
        <h2><span class="header-icon"><BookOpenText size={20} weight="bold" /><span class="icon-overlay"><BookOpenText size={20} weight="thin" /></span></span> {userName ? `${userName}'s Reading Plan` : 'Reading Plan'}</h2>
        <button class="close-btn" on:click={close}>&times;</button>
      </div>
      
      {#if isSignedIn}
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
          Completed Archive
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
                <option value="psalms-proverbs">Psalms &amp; Proverbs</option>
                <optgroup label="Robertson Gospel Harmony">
                  <option value="gospel-harmony-30">Robertson Gospel Harmony — 30 Days</option>
                  <option value="gospel-harmony-60">Robertson Gospel Harmony — 60 Days</option>
                  <option value="gospel-harmony-90">Robertson Gospel Harmony — 90 Days</option>
                  <option value="gospel-harmony-184">Robertson Gospel Harmony — 1 Section/Day (184)</option>
                </optgroup>
              </select>
            </div>

            <div class="form-group">
              <label for="planName">Plan Name <span class="optional">(optional)</span>:</label>
              <input id="planName" type="text" bind:value={planName} placeholder="e.g. Morning Devotions" maxlength="80" />
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
            
            {#if !isSignedIn}
              <div class="auth-warning">
                <span>⚠</span>
                <span>You are not signed in. This plan will be stored temporarily and <strong>lost when you close this tab</strong>. <button class="auth-warning-signin-btn" on:click={() => close()}>Sign in</button> to save permanently.</span>
              </div>
            {/if}
            <button class="generate-btn" on:click={generatePlan}>Generate Plan</button>
            {#if planGenerationStatus}
              <div class="status">{planGenerationStatus}</div>
            {/if}
          </div>
        {:else if currentTab === 'active'}
          <div class="active-plan-tab">
            {#if activePlans.length >= 2}
              <div class="plan-tab-strip">
                <button
                  class="plan-tab-btn plan-tab-all"
                  class:active={activePlanViewTab === 'all'}
                  on:click={() => selectPlanTab('all')}
                >
                  All Plans
                </button>
                {#each activePlans as entry}
                  <button
                    class="plan-tab-btn"
                    class:active={activePlanViewTab === entry.id}
                    on:click={() => selectPlanTab(entry.id)}
                  >
                    {getPlanDisplayName(entry.plan.config)}
                  </button>
                {/each}
              </div>
            {/if}

            {#if activePlanViewTab === 'all'}
              <!-- Plan Manager -->
              <div class="plan-manager">
                <h3 class="plan-manager-title">Active Reading Plans</h3>
                {#each activePlans as entry (entry.id)}
                  {@const nextCh = getNextChapterForPlan(entry.plan)}
                  <div class="plan-manager-row" class:delete-confirm={planDeleteConfirmId === entry.id}>
                    <div class="plan-manager-name">
                      {#if planRenamingId === entry.id}
                        <input
                          class="plan-rename-input"
                          type="text"
                          bind:value={planRenameValue}
                          on:keydown={(e) => { if (e.key === 'Enter') renamePlan(entry.id, planRenameValue); if (e.key === 'Escape') { planRenamingId = null; planRenameValue = ''; } }}
                          on:blur={() => renamePlan(entry.id, planRenameValue || getPlanDisplayName(entry.plan.config))}
                          use:focusAndSelect
                        />
                      {:else}
                        <span class="plan-name-text">{getPlanDisplayName(entry.plan.config)}</span>
                      {/if}
                    </div>
                    <div class="plan-manager-meta">
                      Started {new Date(entry.plan.config.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} &bull; {entry.plan.totalDays} days
                    </div>
                    <div class="plan-manager-actions">
                      {#if nextCh}
                        <button class="pm-chapter-link" on:click={() => { selectPlanTab(entry.id); navigateToChapter(nextCh.book, nextCh.chapter); }}>{nextCh.book} {nextCh.chapter} →</button>
                      {/if}
                      {#if planRenamingId !== entry.id}
                        <button class="pm-rename-btn" on:click={() => { planRenamingId = entry.id; planRenameValue = getPlanDisplayName(entry.plan.config); planDeleteConfirmId = null; }}>Rename</button>
                      {/if}
                      {#if planDeleteConfirmId === entry.id}
                        <span class="pm-delete-confirm-msg">Delete this plan?</span>
                        <button class="pm-delete-btn confirm" on:click={() => { deletePlanFromActive(entry.id); planDeleteConfirmId = null; }}>Yes, delete</button>
                        <button class="pm-cancel-btn" on:click={() => planDeleteConfirmId = null}>Cancel</button>
                      {:else}
                        <button class="pm-delete-btn" on:click={() => { planDeleteConfirmId = entry.id; planRenamingId = null; }}>Delete</button>
                      {/if}
                    </div>
                  </div>
                {/each}
              </div>
            {:else if currentReadingPlan}
              <!-- Welcome banner + today's reading — always first -->
              {@const todayDone = !!(todayReading && getDayProgress(todayReading.dayNumber)?.completed)}
              <div class="welcome-banner" class:plan-done={todayDone}>
                <div class="welcome-greeting">
                  Welcome{userName ? `, ${userName}` : ''}!
                </div>
                {#if todayReading}
                  <div class="welcome-subtitle">Here's your reading for today:</div>
                  <div class="today-reading" class:day-done={todayDone}>
                    <div class="today-reading-header">
                      <span class="today-day-label">Day {todayReading.dayNumber} &mdash; {new Date(todayReading.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                      <button class="jump-to-day-btn" on:click={() => scrollToDayInList(todayReading.dayNumber)}>Jump to day ↓</button>
                    </div>
                    <div class="chapters-list">
                      {#if todayReading.harmonySections?.length}
                        {@const pp = getTodayPassageProgress(todayReading.dayNumber)}
                        <div class="today-harmony-progress">{pp.done}/{pp.total} passages</div>
                        {#each todayReading.harmonySections as sec, sIdx}
                          <div class="banner-harmony-section">
                            <span class="banner-section-title">§{sec.section} — {sec.title}</span>
                            {#each sec.passages as passage, pi}
                              {@const pIdx = todayReading.harmonySections.slice(0, sIdx).reduce((n: number, s: any) => n + s.passages.length, 0) + pi}
                              <button
                                class="chapter-link harmony-passage-link banner-passage-link"
                                on:click={() => handlePassageClick(todayReading, passage, pIdx)}
                              >{passage.label}</button>
                            {/each}
                          </div>
                        {/each}
                      {:else}
                        {#each todayReading.chapters as chapter}
                          <label class="banner-chapter-row">
                            <input
                              type="checkbox"
                              checked={isChapterChecked(getDayProgress(todayReading.dayNumber), chapter.book, chapter.chapter)}
                              on:change={() => toggleChapter(todayReading, chapter)}
                            />
                            <button
                              class="chapter-link"
                              on:click={() => handleChapterClick(todayReading, chapter)}
                            >{chapter.book} {chapter.chapter}</button>
                          </label>
                        {/each}
                      {/if}
                    </div>
                    <div class="today-reading-actions">
                      {#if todayDone}
                        <span class="day-complete-badge">✓ Day Complete</span>
                        <button
                          class="start-reading-btn"
                          on:click={() => {
                            if (todayReading.harmonySections?.length) {
                              handlePassageClick(todayReading, todayReading.harmonySections[0].passages[0], 0);
                            } else {
                              handleChapterClick(todayReading, todayReading.chapters[0]);
                            }
                          }}
                        >
                          Read Again →
                        </button>
                      {:else}
                        <button
                          class="start-reading-btn"
                          on:click={() => {
                            if (todayReading.harmonySections?.length) {
                              handlePassageClick(todayReading, todayReading.harmonySections[0].passages[0], 0);
                            } else {
                              handleChapterClick(todayReading, todayReading.chapters[0]);
                            }
                          }}
                        >
                          Start Reading →
                        </button>
                        <button class="mark-day-btn" on:click={() => markDayComplete(todayReading)}>Mark Day Complete</button>
                      {/if}
                    </div>
                  </div>
                {:else}
                  {@const nextDay = getNextReadingDay()}
                  {#if nextDay}
                    <div class="welcome-subtitle no-reading-today">No reading scheduled for today. Next reading: <strong>Day {nextDay.dayNumber}</strong> on {new Date(nextDay.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}.</div>
                  {:else}
                    <div class="welcome-subtitle no-reading-today">No reading scheduled for today.</div>
                  {/if}
                {/if}
              </div>

              <div class="plan-overview">
                <div class="overview-header">
                  <h3><span class="emoji">📊</span> Plan Overview</h3>
                  <button class="delete-btn" on:click={deleteCurrentPlan}><span class="emoji">🗑️</span> Delete Plan</button>
                </div>
                <div class="stats-grid">
                  <div><strong>Total Days:</strong> {currentReadingPlan.totalDays}</div>
                  <div><strong>Total Chapters:</strong> {currentReadingPlan.totalChapters}</div>
                  <div><strong>Avg/Day:</strong> {currentReadingPlan.avgChaptersPerDay.toFixed(1)} chapters</div>
                  <div><strong>Start:</strong> {new Date(currentReadingPlan.config.startDate).toLocaleDateString()}</div>
                  <div><strong>End:</strong> {new Date(currentReadingPlan.config.endDate).toLocaleDateString()}</div>
                </div>
              </div>

              <div class="plan-progress">
                <div class="progress-header">
                  <h3>Progress</h3>
                  <span class="progress-percent">
                    {verseStats.total > 0 ? Math.round((verseStats.read / verseStats.total) * 100) : 0}%
                  </span>
                </div>
                <div class="progress-bar">
                  <div
                    class="progress-fill"
                    style={`width: ${verseStats.total > 0 ? (verseStats.read / verseStats.total) * 100 : 0}%`}
                  ></div>
                </div>
                <div class="progress-stats">
                  <div><strong>Verses read today:</strong> {verseStats.todayRead}</div>
                  <div><strong>Total verses read:</strong> {verseStats.read}</div>
                  <div><strong>Verses remaining:</strong> {verseStats.remaining}</div>
                  <div><strong>Days ahead/behind:</strong> {currentReadingPlan ? getDaysAheadBehind(currentReadingPlan, getProgressEntries()) : 0}</div>
                  <div><strong>Streak:</strong> {calculateStreak(getProgressEntries())} days</div>
                </div>
                {#if userName}
                  <div class="progress-message">Congrats {userName}, today you read {verseStats.todayRead} verses!</div>
                {/if}
                <div class="progress-actions">
                  <button class="export-btn" on:click={exportProgressJson}>Export JSON</button>
                  <button class="export-btn" on:click={exportProgressMarkdown}>Export Markdown</button>
                  <button class="export-btn" on:click={syncNow}>Sync Now</button>
                  <span class="sync-status">{syncStatus}</span>
                </div>
                {#if syncError}
                  <div class="sync-error">{syncError}</div>
                {/if}
              </div>
              
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
                <button
                  class:active={viewMode === 'catchup'}
                  on:click={() => viewMode = 'catchup'}
                >
                  Catch-up
                </button>
                <label class="catchup-toggle">
                  <input type="checkbox" bind:checked={showCatchUpDays} />
                  Show catch-up days
                </label>
              </div>
              
              {#if viewMode === 'calendar'}
                <CalendarView
                  plan={currentReadingPlan}
                  {dayProgressMap}
                  todayStr={localDateStr(new Date())}
                  onDayClick={(dayNumber) => scrollToDayInList(dayNumber)}
                />
              {:else if viewMode === 'list'}
                <div class="list-view">
                  {#each getDisplayedDays() as day}
                    <div
                      class="list-day"
                      data-day-number={day.dayNumber}
                      class:today={todayReading && day.dayNumber === todayReading.dayNumber}
                      class:status-unread={getDayStatus(day) === 'unread'}
                      class:status-current={getDayStatus(day) === 'current'}
                      class:status-completed={getDayStatus(day) === 'completed'}
                      class:status-ahead={getDayStatus(day) === 'ahead'}
                      class:status-overdue={getDayStatus(day) === 'overdue'}
                      class:catchup-day={day.isCatchUp}
                    >
                      <div class="list-day-header">
                        <strong>{day.isCatchUp ? 'Catch-up Day' : 'Day'} {day.dayNumber}</strong> - {new Date(day.date).toLocaleDateString()}
                        {#if day.isCatchUp}
                          <span class="catchup-badge">Catch-up</span>
                        {/if}
                        <span class="day-progress">
                          {#if day.harmonySections && day.harmonySections.length > 0}
                            {getDayProgressCountsHarmony(day).checked}/{getDayProgressCountsHarmony(day).total}
                          {:else}
                            {getDayProgressCounts(day).checked}/{getDayProgressCounts(day).total}
                          {/if}
                        </span>
                      </div>
                      {#if day.harmonySections && day.harmonySections.length > 0}
                        {@const daySections = day.harmonySections}
                        <!-- Harmony plan day: section + passage checklist -->
                        <div class="list-day-harmony">
                          {#each daySections as sec}
                            <div class="harmony-section">
                              <div class="harmony-section-title">§{sec.section} — {sec.title}</div>
                              {#each sec.passages as passage, pi}
                                {@const pIdx = daySections.slice(0, daySections.indexOf(sec)).reduce((n: number, s) => n + s.passages.length, 0) + pi}
                                <label class="harmony-passage-row">
                                  <input
                                    type="checkbox"
                                    checked={isPassageChecked(day.dayNumber, sec.section, passage.label)}
                                    on:change={() => togglePassage(day, sec.section, passage.label)}
                                  />
                                  <button
                                    class="chapter-link harmony-passage-link"
                                    on:click={() => handlePassageClick(day, passage, pIdx)}
                                  >
                                    {passage.label}
                                  </button>
                                </label>
                              {/each}
                            </div>
                          {/each}
                        </div>
                        <button class="mark-day-btn" on:click={() => markHarmonyDayComplete(day)}>
                          Mark Day Complete
                        </button>
                      {:else}
                        <!-- Standard plan day: chapter checklist -->
                        <div class="list-day-chapters">
                          {#each day.chapters as chapter, i}
                            <label class="chapter-checkbox">
                              <input
                                type="checkbox"
                                checked={isChapterChecked(getDayProgress(day.dayNumber), chapter.book, chapter.chapter)}
                                on:change={() => toggleChapter(day, chapter)}
                              />
                              <button
                                class="chapter-link"
                                on:click={() => handleChapterClick(day, chapter)}
                              >
                                {chapter.book} {chapter.chapter}
                              </button>
                            </label>
                            {#if i < day.chapters.length - 1}
                              <span class="chapter-separator">,</span>
                            {/if}
                          {/each}
                        </div>
                        <button class="mark-day-btn" on:click={() => markDayComplete(day)}>
                          Mark Day Complete
                        </button>
                      {/if}
                    </div>
                  {/each}
                </div>
              {:else}
                <div class="catchup-view">
                  <div class="catchup-summary">
                    <div><strong>Overdue days:</strong> {getOverdueDays().length}</div>
                    <div><strong>Overdue chapters:</strong> {getOverdueChapters().length}</div>
                    <div><strong>Max per day:</strong> {maxCatchUpPerDay}</div>
                  </div>

                  <div class="catchup-controls">
                    <label>
                      Catch-up Mode
                      <select bind:value={catchUpMode}>
                        <option value="spread">Even spread</option>
                        <option value="dedicated">Dedicated catch-up days</option>
                      </select>
                    </label>
                    <label>
                      Max chapters per day
                      <input type="number" min="1" max="10" bind:value={maxCatchUpPerDay} />
                    </label>
                  </div>

                  {#if catchUpMode === 'spread'}
                    <div class="catchup-preview">
                      <h4>Even spread preview</h4>
                      {#if getEvenSpreadSuggestions().length === 0}
                        <p class="muted">No catch-up needed. You are on schedule.</p>
                      {:else}
                        {#each getEvenSpreadSuggestions() as suggestion}
                          <div class="catchup-item">
                            <strong>Day {suggestion.dayNumber}:</strong>
                            {#each suggestion.addedChapters as chapter, i}
                              <span>{chapter.book} {chapter.chapter}</span>{#if i < suggestion.addedChapters.length - 1}, {/if}
                            {/each}
                          </div>
                        {/each}
                        <button class="apply-catchup" on:click={applyEvenSpread}>
                          Apply even spread
                        </button>
                      {/if}
                    </div>
                  {:else}
                    <div class="catchup-preview">
                      <h4>Dedicated catch-up days</h4>
                      {#if getDedicatedCatchUpDays().length === 0}
                        <p class="muted">No catch-up needed. You are on schedule.</p>
                      {:else}
                        {#each getDedicatedCatchUpDays() as day}
                          <div class="catchup-item">
                            <strong>Catch-up Day {day.dayNumber}:</strong>
                            {#each day.chapters as chapter, i}
                              <span>{chapter.book} {chapter.chapter}</span>{#if i < day.chapters.length - 1}, {/if}
                            {/each}
                          </div>
                        {/each}
                        <button class="apply-catchup" on:click={applyDedicatedCatchUp}>
                          Save catch-up days
                        </button>
                      {/if}
                    </div>

                    {#if catchUpDays.length > 0}
                      <div class="catchup-saved">
                        <h4>Saved catch-up days</h4>
                        {#each catchUpDays as day}
                          <div class="catchup-item">
                            <strong>Catch-up Day {day.dayNumber}:</strong>
                            {#each day.chapters as chapter, i}
                              <span>{chapter.book} {chapter.chapter}</span>{#if i < day.chapters.length - 1}, {/if}
                            {/each}
                          </div>
                        {/each}
                      </div>
                    {/if}
                  {/if}
                </div>
              {/if}
            {:else}
              <p>No active plan. Create one to get started!</p>
            {/if}
          </div>
        {:else}
          {@const completedPlans = planHistory.filter((h) => h.completedAt !== null)}
          <div class="history-tab">
            {#if completedPlans.length > 0}
              {#each completedPlans as item}
                <div class="history-item">
                  <div class="history-header">
                    <div>
                      <div class="history-title">
                        {getPlanDisplayName(item.plan.config)}
                      </div>
                      <div class="history-date">
                        Completed {new Date(item.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </div>
                    </div>
                    <div class="history-actions">
                      <button class="delete-btn" on:click={() => deletePlanFromHistory(item.id)}>Delete</button>
                    </div>
                  </div>
                  <div class="history-stats">
                    <strong>{item.plan.totalDays}</strong> days &bull; <strong>{item.plan.totalChapters}</strong> chapters
                  </div>
                  <div class="history-dates">
                    {new Date(item.plan.config.startDate).toLocaleDateString()} → {new Date(item.plan.config.endDate).toLocaleDateString()}
                  </div>
                </div>
              {/each}
            {:else}
              <p class="empty-archive">No completed plans yet. Finish a plan to see it here!</p>
            {/if}
          </div>
        {/if}
      </div>
      {:else}
        <div class="auth-wall">
          <div class="auth-wall-icon">📖</div>
          <p class="auth-wall-text">Sign in to create and sync reading plans across all your devices.</p>
          <button class="auth-wall-btn" on:click={() => { close(); profileModalStore.open(); }}>Sign In to Continue →</button>
        </div>
      {/if}
    </div>
  </div>

  {#if congratsPlanName}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="congrats-overlay" on:click={() => congratsPlanName = null}>
      <div class="congrats-card" on:click|stopPropagation>
        <div class="congrats-emoji">🎉</div>
        <h2 class="congrats-title">Plan Complete!</h2>
        <p class="congrats-body">You finished <strong>{congratsPlanName}</strong>. It has been moved to your Completed Archive.</p>
        <button class="congrats-close-btn" on:click={() => congratsPlanName = null}>Awesome!</button>
      </div>
    </div>
  {/if}
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

  .modal-header .header-icon {
    display: inline-flex;
    align-items: center;
    vertical-align: middle;
    margin-right: 6px;
    color: #431407;
    background: radial-gradient(circle, #60a5fa 0%, #60a5fa 20%, #431407 100%);
    border-radius: 6px;
    padding: 4px;
    position: relative;
  }
  .icon-overlay {
    position: absolute;
    top: 0; right: 0; bottom: 0; left: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    line-height: 0;
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
    background: linear-gradient(135deg, #ef5350 0%, #c62828 100%);
    color: #fff;
    border: 1px solid #ef5350;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    box-shadow: 0 2px 6px rgba(239, 83, 80, 0.3);
  }
  
  .delete-btn:hover {
    background: linear-gradient(135deg, #ff6f60 0%, #d32f2f 100%);
  }
  
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 12px;
    font-size: 14px;
    color: #ccc;
  }
  
  .today-reading {
    background: #0d1b2e;
    border: 1px solid #1d4ed8;
    padding: 15px;
    border-radius: 8px;
    border-left: 4px solid #3b82f6;
    margin-bottom: 20px;
  }

  .today-reading.day-done {
    background: #1a2e1a;
    border: 1px solid #2e5d2e;
    border-left: 4px solid #4caf50;
  }
  
  .chapters-list {
    margin: 5px 0 8px 0;
    font-size: 15px;
    color: #93c5fd;
  }

  .today-reading.day-done .chapters-list {
    color: #aed581;
  }

  .banner-chapter-row {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 3px 0;
    cursor: pointer;
  }

  .banner-chapter-row input[type="checkbox"] {
    accent-color: #3b82f6;
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    cursor: pointer;
  }

  .today-reading.day-done .banner-chapter-row input[type="checkbox"] {
    accent-color: #4caf50;
  }

  /* Harmony sections in today banner */
  .today-harmony-progress {
    font-size: 12px;
    color: #888;
    margin-bottom: 8px;
  }

  .banner-harmony-section {
    margin-bottom: 10px;
  }

  .banner-section-title {
    display: block;
    font-size: 11px;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 4px;
  }

  .banner-passage-link {
    display: block;
    width: 100%;
    text-align: left;
    padding: 2px 4px;
    font-size: 13px;
  }

  .chapter-link {
    background: none;
    border: none;
    color: #3b82f6;
    font-weight: 500;
    cursor: pointer;
    text-decoration: underline;
    padding: 0 2px;
  }

  .today-reading.day-done .chapter-link {
    color: #4caf50;
  }

  .chapter-link:hover {
    color: #60a5fa;
  }

  .today-reading.day-done .chapter-link:hover {
    color: #66bb6a;
  }
  
  .start-reading-btn {
    margin-top: 10px;
    padding: 8px 16px;
    background: #1d4ed8;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .start-reading-btn:hover {
    background: #2563eb;
  }

  .today-reading.day-done .start-reading-btn {
    background: #4caf50;
  }

  .today-reading.day-done .start-reading-btn:hover {
    background: #66bb6a;
  }
  
  .welcome-banner {
    background: linear-gradient(135deg, #0d1b2e 0%, #0f1d30 100%);
    border: 1px solid #1d4ed8;
    border-left: 4px solid #3b82f6;
    border-radius: 8px;
    padding: 16px 18px;
    margin-bottom: 18px;
  }

  .welcome-banner.plan-done {
    background: linear-gradient(135deg, #1a2e1a 0%, #1e2e1a 100%);
    border: 1px solid #2e5d2e;
    border-left: 4px solid #4caf50;
  }

  .welcome-greeting {
    font-size: 18px;
    font-weight: 700;
    color: #bfdbfe;
    margin-bottom: 4px;
  }

  .welcome-banner.plan-done .welcome-greeting {
    color: #c5e1a5;
  }

  .welcome-subtitle {
    font-size: 13px;
    color: #93c5fd;
    margin-bottom: 10px;
  }

  .welcome-banner.plan-done .welcome-subtitle {
    color: #9ccc65;
  }

  .welcome-subtitle.no-reading-today {
    margin-bottom: 0;
    color: #888;
  }

  .welcome-banner .today-reading {
    background: transparent;
    border: none;
    border-top: 1px solid #1d4ed8;
    border-left: none;
    border-radius: 0;
    margin-bottom: 0;
    padding: 10px 0 0 0;
  }

  .welcome-banner.plan-done .today-reading {
    border-top-color: #2e5d2e;
  }

  .today-reading-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .today-day-label {
    font-size: 13px;
    font-weight: 600;
    color: #93c5fd;
  }

  .today-reading.day-done .today-day-label {
    color: #aed581;
  }

  .jump-to-day-btn {
    background: none;
    border: 1px solid #3b82f6;
    color: #3b82f6;
    border-radius: 4px;
    padding: 3px 9px;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .jump-to-day-btn:hover {
    background: #3b82f6;
    color: #fff;
  }

  .today-reading.day-done .jump-to-day-btn {
    border-color: #4caf50;
    color: #4caf50;
  }

  .today-reading.day-done .jump-to-day-btn:hover {
    background: #4caf50;
    color: #fff;
  }

  .today-reading-actions {
    display: flex;
    gap: 8px;
    margin-top: 10px;
    flex-wrap: wrap;
    align-items: center;
  }

  .day-complete-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: #1a2e1a;
    border: 1px solid #4caf50;
    color: #66bb6a;
    padding: 5px 12px;
    border-radius: 4px;
    font-size: 13px;
    font-weight: 600;
  }

  .plan-progress {
    background: #1f1f1f;
    border: 1px solid #2a2a2a;
    border-radius: 8px;
    padding: 14px;
    margin-bottom: 20px;
  }

  .progress-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
  }

  .progress-header h3 {
    margin: 0;
    font-size: 16px;
    color: #e0e0e0;
  }

  .progress-percent {
    font-size: 14px;
    color: #8bc34a;
    font-weight: 600;
  }

  .progress-bar {
    width: 100%;
    height: 8px;
    background: #2a2a2a;
    border-radius: 999px;
    overflow: hidden;
    margin-bottom: 10px;
  }

  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #4caf50, #8bc34a);
    transition: width 0.3s ease;
  }

  .progress-stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 8px;
    font-size: 13px;
    color: #bbb;
  }

  .progress-actions {
    margin-top: 12px;
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }

  .export-btn {
    padding: 6px 12px;
    border-radius: 4px;
    border: 1px solid #3a3a3a;
    background: #1f1f1f;
    color: #e0e0e0;
    cursor: pointer;
    font-size: 12px;
  }

  .export-btn:hover {
    background: #2a2a2a;
  }

  .sync-status {
    font-size: 12px;
    color: #9ccc65;
    align-self: center;
  }

  .sync-error {
    margin-top: 6px;
    font-size: 12px;
    color: #e57373;
  }

  .progress-message {
    margin-top: 8px;
    font-size: 12px;
    color: #c8e6c9;
  }
  
  .view-toggle {
    display: flex;
    gap: 10px;
    margin-bottom: 15px;
    flex-wrap: wrap;
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

  .catchup-toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: #bbb;
    padding: 6px 10px;
    border: 1px solid #3a3a3a;
    border-radius: 4px;
    background: #1f1f1f;
  }

  .catchup-toggle input {
    accent-color: #ffc107;
  }

  .catchup-badge {
    padding: 2px 6px;
    border-radius: 999px;
    font-size: 10px;
    letter-spacing: 0.3px;
    text-transform: uppercase;
    color: #111;
    background: #ffc107;
  }

  .catchup-view {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .catchup-summary {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
    background: #1f1f1f;
    border: 1px solid #2a2a2a;
    border-radius: 8px;
    padding: 12px;
    font-size: 13px;
    color: #ccc;
  }

  .catchup-controls {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
  }

  .catchup-controls label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 13px;
    color: #ccc;
  }

  .catchup-controls select,
  .catchup-controls input {
    padding: 6px 8px;
    border-radius: 4px;
    border: 1px solid #3a3a3a;
    background: #1a1a1a;
    color: #e0e0e0;
  }

  .catchup-preview,
  .catchup-saved {
    background: #1f1f1f;
    border: 1px solid #2a2a2a;
    border-radius: 8px;
    padding: 12px;
  }

  .catchup-preview h4,
  .catchup-saved h4 {
    margin: 0 0 10px 0;
    color: #e0e0e0;
  }

  .catchup-item {
    font-size: 13px;
    color: #ccc;
    margin-bottom: 6px;
  }

  .apply-catchup {
    margin-top: 10px;
    padding: 8px 14px;
    background: #2a2a2a;
    border: 1px solid #3a3a3a;
    border-radius: 4px;
    color: #e0e0e0;
    cursor: pointer;
  }

  .apply-catchup:hover {
    background: #3a3a3a;
  }

  .muted {
    color: #888;
    margin: 0;
  }
  
  .chapter-checkbox {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .chapter-checkbox input {
    accent-color: #4caf50;
    width: 14px;
    height: 14px;
  }

  .mark-day-btn {
    margin-top: 10px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .chapter-checkbox input {
    accent-color: #4caf50;
    width: 14px;
    height: 14px;
  }

  .mark-day-btn {
    margin-top: 10px;
    padding: 6px 10px;
    border: 1px solid #3a3a3a;
    background: #1f1f1f;
    color: #ccc;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
  }

  .mark-day-btn:hover {
    background: #2a2a2a;
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

  .list-day.status-unread {
    background: #2a2a2a;
  }

  .list-day.status-current {
    background: #0d1b2e;
    border-left-color: #3b82f6;
  }

  .list-day.status-completed {
    background: #1a2a1a;
    border-left-color: #8bc34a;
  }

  .list-day.status-ahead {
    background: #2a2010;
    border-left-color: #ffc107;
  }

  .list-day.status-overdue {
    background: #2a1a1a;
    border-left-color: #d32f2f;
  }

  .list-day.catchup-day {
    border-style: dashed;
  }
  
  .list-day.today {
    border-left-color: #3b82f6;
    background: #0d1b2e;
  }

  .list-day.today.status-completed {
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

  /* Harmony plan day styles */
  .list-day-harmony {
    font-size: 14px;
  }

  .harmony-section {
    margin-bottom: 10px;
  }

  .harmony-section-title {
    font-size: 12px;
    font-weight: 600;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 4px;
  }

  .harmony-passage-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 0;
    cursor: pointer;
  }

  .harmony-passage-link {
    font-size: 13px;
  }

  .chapter-separator {
    margin: 0 6px;
    color: #555;
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

  /* Multi-plan tab strip */
  .plan-tab-strip {
    display: flex;
    gap: 6px;
    margin-bottom: 16px;
    flex-wrap: wrap;
    border-bottom: 1px solid #1e3a5f;
    padding-bottom: 8px;
  }

  .plan-tab-btn {
    padding: 6px 14px;
    background: #0d1b2e;
    color: #aaa;
    border: 1px solid #1e3a5f;
    border-radius: 20px;
    cursor: pointer;
    font-size: 13px;
    transition: all 0.15s;
  }

  .plan-tab-btn:hover {
    background: #1e3a5f;
    color: #e0e0e0;
  }

  .plan-tab-btn.active {
    background: linear-gradient(135deg, #1d4ed8 0%, #1e40af 100%);
    color: #fff;
    border-color: #3b82f6;
  }

  .plan-tab-all.active {
    background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%);
    border-color: #8b5cf6;
  }

  /* Plan name input optional label */
  .optional {
    font-size: 12px;
    color: #888;
    font-weight: normal;
  }

  /* Auth warning banner */
  .auth-warning {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    background: rgba(250, 200, 0, 0.1);
    border: 1px solid rgba(250, 200, 0, 0.4);
    border-radius: 6px;
    padding: 10px 14px;
    margin-bottom: 12px;
    font-size: 13px;
    color: #d4a800;
    line-height: 1.5;
  }
  .auth-warning-signin-btn {
    background: none;
    border: none;
    color: #f5c518;
    text-decoration: underline;
    cursor: pointer;
    padding: 0;
    font: inherit;
  }

  /* Auth wall (shown when not signed in) */
  .auth-wall {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 48px 24px;
    gap: 16px;
    text-align: center;
  }
  .auth-wall-icon {
    font-size: 48px;
  }
  .auth-wall-text {
    color: #ccc;
    font-size: 15px;
    max-width: 300px;
    line-height: 1.5;
    margin: 0;
  }
  .auth-wall-btn {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border: none;
    border-radius: 10px;
    color: #fff;
    font-size: 15px;
    font-weight: 600;
    padding: 10px 24px;
    cursor: pointer;
    transition: opacity 0.2s;
  }
  .auth-wall-btn:hover {
    opacity: 0.85;
  }

  /* Plan Manager (All Plans view) */
  .plan-manager {
    padding: 4px 0;
  }
  .plan-manager-title {
    font-size: 15px;
    font-weight: 600;
    color: #ccc;
    margin: 0 0 10px;
    padding-bottom: 8px;
    border-bottom: 1px solid #333;
  }
  .plan-manager-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-radius: 8px;
    background: #222;
    border: 1px solid #333;
    margin-bottom: 8px;
    transition: border-color 0.15s;
  }
  .plan-manager-row.delete-confirm {
    border-color: #b91c1c;
    background: rgba(185, 28, 28, 0.08);
  }
  .plan-manager-name {
    flex: 1 1 160px;
    font-weight: 600;
    font-size: 14px;
    color: #e8e8e8;
  }
  .plan-name-text {
    cursor: default;
  }
  .plan-rename-input {
    background: #1a1a1a;
    border: 1px solid #666;
    border-radius: 4px;
    color: #e8e8e8;
    font-size: 14px;
    padding: 3px 8px;
    width: 100%;
    max-width: 260px;
  }
  .plan-manager-meta {
    font-size: 12px;
    color: #888;
    flex: 1 1 auto;
  }
  .plan-manager-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }
  .pm-chapter-link {
    padding: 4px 10px;
    background: linear-gradient(135deg, #1d4ed8, #1e40af);
    color: #fff;
    border: 1px solid #3b82f6;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
    font-weight: 500;
  }
  .pm-chapter-link:hover { background: linear-gradient(135deg, #2563eb, #1d4ed8); }
  .pm-rename-btn {
    padding: 4px 10px;
    background: #2a2a2a;
    color: #aaa;
    border: 1px solid #444;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
  }
  .pm-rename-btn:hover { background: #333; color: #ddd; }
  .pm-delete-btn {
    padding: 4px 10px;
    background: transparent;
    color: #888;
    border: 1px solid #555;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
  }
  .pm-delete-btn:hover { color: #f87171; border-color: #b91c1c; }
  .pm-delete-btn.confirm {
    background: #b91c1c;
    color: #fff;
    border-color: #dc2626;
  }
  .pm-delete-btn.confirm:hover { background: #dc2626; }
  .pm-cancel-btn {
    padding: 4px 10px;
    background: #333;
    color: #aaa;
    border: 1px solid #555;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
  }
  .pm-cancel-btn:hover { color: #ddd; }
  .pm-delete-confirm-msg {
    font-size: 12px;
    color: #f87171;
    font-weight: 600;
  }

  /* Completed Archive empty state */
  .empty-archive {
    color: #888;
    font-style: italic;
    text-align: center;
    padding: 24px 0;
  }

  /* Congrats overlay */
  .congrats-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.85);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1100;
    padding: 20px;
  }
  .congrats-card {
    background: #1a1a1a;
    border: 1px solid #3f3f3f;
    border-radius: 16px;
    padding: 40px 48px;
    text-align: center;
    max-width: 420px;
    width: 100%;
    box-shadow: 0 24px 64px rgba(0,0,0,0.7);
  }
  .congrats-emoji {
    font-size: 56px;
    line-height: 1;
    margin-bottom: 16px;
  }
  .congrats-title {
    font-size: 26px;
    font-weight: 700;
    color: #f0e68c;
    margin: 0 0 12px;
  }
  .congrats-body {
    font-size: 15px;
    color: #ccc;
    margin: 0 0 24px;
    line-height: 1.6;
  }
  .congrats-close-btn {
    padding: 10px 28px;
    background: linear-gradient(135deg, #d97706, #b45309);
    color: #fff;
    border: none;
    border-radius: 8px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
  }
  .congrats-close-btn:hover { background: linear-gradient(135deg, #f59e0b, #d97706); }
</style>
