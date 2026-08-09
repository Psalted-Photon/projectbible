<script lang="ts">
  import { onMount } from 'svelte';
  import { profileModalStore } from '../stores/profileModalStore';
  import { userProfileStore } from '../stores/userProfileStore';
  import { supabaseAuthService } from '../services/SupabaseAuthService';
  import { readingPlanModalStore } from '../stores/readingPlanModalStore';
  import { navigationStore, availableTranslations } from '../stores/navigationStore';
  import { translationLabel } from '../lib/bibleData';
  import { readingProgressStore } from '../stores/ReadingProgressStore';
  import { getDaysAheadBehind, calculateStreak, planDayDateStr } from '@projectbible/core';
  import { VERSE_COUNTS } from '../../../../packages/core/src/BibleMetadata';
  import { applyTheme, getSettings, updateSettings } from '../adapters/settings';
  import { paneStore } from '../stores/paneStore';
  import { syncService, formatSyncLabel, isSyncRunning, SYNC_SCOPE_TOOLTIP, type SyncState } from '../lib/sync';
  import { localDateStr } from '../stores/clockStore';
  import SavedVersesPanel from './SavedVersesPanel.svelte';
  import JournalCalendar from './JournalCalendar.svelte';
  import BrandSpinner from './BrandSpinner.svelte';
  import { User } from 'phosphor-svelte';

  let isOpen = false;
  $: isOpen = $profileModalStore;

  type TabKey = 'reading' | 'notes' | 'journal' | 'settings';
  let currentTab: TabKey = 'reading';

  let authMode: 'login' | 'signup' | 'forgot' = 'login';
  let authEmail = '';
  let authPassword = '';
  let authPasswordConfirm = '';
  let authName = '';
  let authMessage = '';
  let authError = '';
  let nameUpdate = '';
  let currentPassword = '';
  let newPassword = '';
  let newPasswordConfirm = '';
  let passwordMessage = '';
  let passwordError = '';
  let nameMessage = '';
  let nameError = '';

  let profileName: string | null = null;
  let profileEmail: string | null = null;
  let userId: string | null = null;
  let isSignedIn = false;
  let passwordsMatch = false;

  let theme: 'light' | 'dark' | 'auto' | 'sepia' | 'custom' = 'dark';
  let defaultOT = '';
  let defaultNT = '';

  let syncState: SyncState = syncService.getState();
  $: syncLabel = formatSyncLabel(syncState, isSignedIn);
  $: syncing = isSyncRunning(syncState);

  const STORAGE_ACTIVE_PLAN = 'projectbible_active_reading_plan'; // legacy key
  const STORAGE_ACTIVE_PLANS = 'projectbible_active_reading_plans'; // new multi-plan key

  let currentReadingPlan: any = null;
  let currentPlanId: string | null = null;
  let todayReading: any = null;
  let verseStats = {
    total: 0,
    read: 0,
    remaining: 0,
    todayRead: 0,
  };
  let daysAheadBehind = 0;
  let streak = 0;

  let showDeleteConfirm = false;
  let showFinalDeleteConfirm = false;
  let deleteConfirmText = '';
  let deleteError = '';
  let deleteMessage = '';

  onMount(() => {
    const unsubscribeProfile = userProfileStore.subscribe((profile) => {
      profileName = profile.name;
      profileEmail = profile.email;
      userId = profile.userId;
      isSignedIn = profile.isSignedIn;
      if (profile.name && nameUpdate.trim() === '') {
        nameUpdate = profile.name;
      }
    });

    const unsubscribeSync = syncService.subscribe((state: SyncState) => {
      syncState = state;
    });

    supabaseAuthService.getSession().then((session) => {
      userProfileStore.setFromSession(session);
    });

    const authSubscription = supabaseAuthService.onAuthStateChange((event, session) => {
      userProfileStore.setFromSession(session);
      if (event === 'SIGNED_IN' && session?.user?.id) {
        // SyncService pulls settings + data on sign-in; refresh the widget.
        void loadReadingPlan();
      }
    });

    // Settings can change under us (remote pull, SettingsPane) — re-read.
    const handleSettingsUpdated = () => loadLocalSettings();
    window.addEventListener('settingsUpdated', handleSettingsUpdated);

    loadLocalSettings();
    void loadReadingPlan();

    return () => {
      unsubscribeProfile();
      unsubscribeSync();
      authSubscription?.data?.subscription?.unsubscribe();
      window.removeEventListener('settingsUpdated', handleSettingsUpdated);
    };
  });

  $: if (isOpen && currentTab === 'reading') {
    void loadReadingPlan();
  }

  $: passwordsMatch = newPassword.length > 0 && newPassword === newPasswordConfirm;

  function close() {
    profileModalStore.close();
  }

  function loadLocalSettings() {
    const settings = getSettings();
    theme = settings.theme || 'dark';
    defaultOT = settings.dailyDriverEnglishOT || '';
    defaultNT = settings.dailyDriverEnglishNT || '';
  }

  function applyThemeSelection() {
    // updateSettings fires the settings-sync hook — cloud push is automatic.
    updateSettings({ theme });
    applyTheme(theme);
  }

  function updateTranslations() {
    updateSettings({
      dailyDriverEnglishOT: defaultOT || undefined,
      dailyDriverEnglishNT: defaultNT || undefined,
    });
  }

  async function handleSignIn() {
    authMessage = '';
    authError = '';
    try {
      await supabaseAuthService.signIn(authEmail, authPassword);
      authPassword = '';
      authMode = 'login';
    } catch (error) {
      console.error(error);
      authError = 'Sign in failed.';
    }
  }

  async function handleSignUp() {
    authMessage = '';
    authError = '';
    if (!authName.trim()) {
      authError = 'Name is required.';
      return;
    }
    if (authPassword !== authPasswordConfirm) {
      authError = 'Passwords do not match.';
      return;
    }
    try {
      await supabaseAuthService.signUp(authEmail, authPassword, authName.trim());
      authMessage = 'Check your email to confirm your account.';
      authPassword = '';
      authPasswordConfirm = '';
    } catch (error) {
      console.error(error);
      authError = 'Sign up failed.';
    }
  }

  async function handleForgotPassword() {
    authMessage = '';
    authError = '';
    if (!authEmail) {
      authError = 'Enter your email first.';
      return;
    }
    try {
      await supabaseAuthService.resetPassword(authEmail);
      authMessage = 'Check your email for a reset link.';
    } catch (error) {
      console.error(error);
      authError = 'Password reset failed.';
    }
  }

  async function handleSignOut() {
    authMessage = '';
    authError = '';
    try {
      await supabaseAuthService.signOut();
    } catch (error) {
      console.error(error);
      authError = 'Sign out failed.';
    }
  }

  async function handleChangePassword() {
    passwordMessage = '';
    passwordError = '';
    if (!profileEmail) {
      passwordError = 'No email found for this account.';
      return;
    }
    if (!currentPassword) {
      passwordError = 'Enter your current password.';
      return;
    }
    if (!passwordsMatch) {
      passwordError = 'New passwords do not match.';
      return;
    }
    try {
      await supabaseAuthService.reauthenticate(profileEmail, currentPassword);
      await supabaseAuthService.updatePassword(newPassword);
      passwordMessage = 'Password updated.';
      currentPassword = '';
      newPassword = '';
      newPasswordConfirm = '';
    } catch (error) {
      console.error(error);
      passwordError = 'Password update failed.';
    }
  }

  async function handleChangeName() {
    nameMessage = '';
    nameError = '';
    if (!nameUpdate.trim()) {
      nameError = 'Enter your name.';
      return;
    }
    try {
      await supabaseAuthService.updateProfileName(nameUpdate.trim());
      const session = await supabaseAuthService.getSession();
      userProfileStore.setFromSession(session);
      nameMessage = 'Name updated.';
    } catch (error) {
      console.error(error);
      nameError = 'Name update failed.';
    }
  }

  function handleDeleteAccount() {
    // First confirmation passed (typed DELETE) — show the final warning.
    deleteError = '';
    deleteMessage = '';
    if (deleteConfirmText !== 'DELETE') {
      deleteError = 'Type DELETE to confirm.';
      return;
    }
    showFinalDeleteConfirm = true;
  }

  function cancelDeleteAccount() {
    showDeleteConfirm = false;
    showFinalDeleteConfirm = false;
    deleteConfirmText = '';
    deleteError = '';
  }

  async function handleFinalDeleteAccount() {
    deleteError = '';
    deleteMessage = '';
    try {
      await supabaseAuthService.deleteAccount();
      await supabaseAuthService.signOut();
      deleteMessage = 'Account deleted.';
      deleteConfirmText = '';
      showDeleteConfirm = false;
      showFinalDeleteConfirm = false;
    } catch (error) {
      console.error(error);
      deleteError = 'Account deletion failed.';
      showFinalDeleteConfirm = false;
    }
  }

  function openReadingPlan() {
    readingPlanModalStore.open();
    profileModalStore.close();
  }

  function getTodayReading(plan: any) {
    if (!plan) return null;
    const todayStr = localDateStr(new Date());
    return plan.days.find((day: any) => planDayDateStr(day.date) === todayStr);
  }


  async function loadReadingPlan() {
    try {
      // Try new multi-plan key first; use the last (most recently added) plan for the widget
      const storedNew = localStorage.getItem(STORAGE_ACTIVE_PLANS);
      let data: {id: string, plan: any} | null = null;
      if (storedNew) {
        const arr: Array<{id: string, plan: any}> = JSON.parse(storedNew);
        if (arr.length > 0) data = arr[arr.length - 1];
      } else {
        // Fall back to legacy key
        const storedOld = localStorage.getItem(STORAGE_ACTIVE_PLAN);
        if (storedOld) data = JSON.parse(storedOld);
      }
      if (!data) return;
      currentReadingPlan = data.plan;
      currentPlanId = data.id;
      if (currentReadingPlan) {
        currentReadingPlan.config.startDate = new Date(currentReadingPlan.config.startDate);
        currentReadingPlan.config.endDate = new Date(currentReadingPlan.config.endDate);
        currentReadingPlan.days.forEach((day: any) => {
          day.date = new Date(day.date);
        });
      }
      todayReading = getTodayReading(currentReadingPlan);
      const progressEntries = currentPlanId
        ? await readingProgressStore.getProgressForPlan(currentPlanId)
        : [];
      verseStats = computeVerseStats(currentReadingPlan, progressEntries);
      const todayStr = localDateStr(new Date());
      daysAheadBehind = currentReadingPlan
        ? getDaysAheadBehind(currentReadingPlan, progressEntries, todayStr)
        : 0;
      streak = currentReadingPlan
        ? calculateStreak(currentReadingPlan, progressEntries, todayStr, localDateStr)
        : 0;
    } catch (error) {
      console.error('Failed to load reading plan', error);
    }
  }

  function getVerseCountForChapter(bookName: string, chapter: number): number {
    return VERSE_COUNTS[bookName]?.[chapter - 1] ?? 0;
  }

  function isSameDate(timestamp: number, reference: Date): boolean {
    return localDateStr(timestamp) === localDateStr(reference);
  }

  function computeVerseStats(plan: any, progressEntries: any[]) {
    if (!plan) {
      return { total: 0, read: 0, remaining: 0, todayRead: 0 };
    }

    let total = 0;
    let read = 0;
    let todayRead = 0;
    const today = new Date();

    plan.days.forEach((day: any) => {
      const progress = progressEntries.find((entry) => entry.dayNumber === day.dayNumber);
      day.chapters.forEach((chapter: any) => {
        const verseCount = getVerseCountForChapter(chapter.book, chapter.chapter);
        total += verseCount;

        if (!progress) return;
        const chapterProgress = progress.chaptersRead.find(
          (item: any) => item.book === chapter.book && item.chapter === chapter.chapter,
        );
        if (!chapterProgress || chapterProgress.actions.length === 0) return;
        const latest = chapterProgress.actions[chapterProgress.actions.length - 1];
        if (latest.type === 'checked') {
          read += verseCount;
          if (isSameDate(latest.timestamp, today)) {
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

  function navigateToChapter(book: string, chapter: number) {
    navigationStore.setBook(book);
    navigationStore.setChapter(chapter);
    profileModalStore.close();
  }

  async function handleManualSync() {
    if (!isSignedIn) return;
    try {
      await syncService.forceSync();
    } catch (error) {
      console.error('Manual sync failed:', error);
    }
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
        <div class="profile-header">
          <div class="profile-icon" aria-hidden="true">
            {#if profileName}
              {profileName.slice(0, 1).toUpperCase()}
            {:else}
              <span class="profile-user-icon"><User size={22} weight="bold" /><span class="icon-overlay"><User size={22} weight="thin" /></span></span>
            {/if}
          </div>
          <div class="profile-details">
            <h2>{profileName ? `Hey ${profileName}` : 'Profile'}</h2>
            <div class="profile-subtitle">
              {#if profileEmail}
                {profileEmail}
              {:else}
                Sign in to sync across devices
              {/if}
            </div>
          </div>
        </div>
        <div class="profile-actions">
          <div class="sync-status" title={SYNC_SCOPE_TOOLTIP}>
            {#if syncing}
              <BrandSpinner size={13} title="Syncing…" />
            {/if}
            <span class="sync-indicator" class:sync-indicator-error={syncState.status === 'error'}>{syncLabel}</span>
            {#if isSignedIn}
              <button
                class="sync-btn"
                on:click={handleManualSync}
                disabled={syncing}
                title="Sync now"
                aria-label="Sync now"
              >
                🔄
              </button>
            {/if}
          </div>
          {#if isSignedIn}
            <button class="secondary-btn" on:click={handleSignOut}>Sign Out</button>
          {/if}
          <button class="close-btn" on:click={close}>&times;</button>
        </div>
      </div>

      <div class="tabs">
        <button class:active={currentTab === 'reading'} on:click={() => (currentTab = 'reading')}>Reading Plan</button>
        <button class:active={currentTab === 'notes'} on:click={() => (currentTab = 'notes')}>Saved Verses/Notes</button>
        <button class:active={currentTab === 'journal'} on:click={() => (currentTab = 'journal')}>Journal</button>
        <button class:active={currentTab === 'settings'} on:click={() => (currentTab = 'settings')}>Settings</button>
      </div>

      <div class="tab-content">
        {#if !isSignedIn}
          <div class="auth-panel">
            {#if authMode === 'login'}
              <h3>Log in</h3>
              <input class="auth-input" type="email" placeholder="Email" bind:value={authEmail} />
              <input class="auth-input" type="password" placeholder="Password" bind:value={authPassword} />
              <button class="primary-btn" on:click={handleSignIn}>Sign in</button>
              <button class="link-btn" on:click={() => (authMode = 'forgot')}>Forgot password?</button>
              <button class="secondary-btn" on:click={() => (authMode = 'signup')}>Create Account</button>
            {:else if authMode === 'signup'}
              <h3>Create Account</h3>
              <input class="auth-input" type="text" placeholder="Name" bind:value={authName} />
              <input class="auth-input" type="email" placeholder="Email" bind:value={authEmail} />
              <input class="auth-input" type="password" placeholder="Password" bind:value={authPassword} />
              <input class="auth-input" type="password" placeholder="Confirm Password" bind:value={authPasswordConfirm} />
              <button class="primary-btn" on:click={handleSignUp}>Create Account</button>
              <button class="link-btn" on:click={() => (authMode = 'login')}>Back to login</button>
            {:else}
              <h3>Reset Password</h3>
              <input class="auth-input" type="email" placeholder="Email" bind:value={authEmail} />
              <button class="primary-btn" on:click={handleForgotPassword}>Send reset link</button>
              <button class="link-btn" on:click={() => (authMode = 'login')}>Back to login</button>
            {/if}

            {#if authMessage}
              <div class="auth-message">{authMessage}</div>
            {/if}
            {#if authError}
              <div class="auth-error">{authError}</div>
            {/if}
          </div>
        {:else}
          {#if currentTab === 'reading'}
            <div class="reading-tab">
              {#if todayReading}
                <div class="today-card">
                  <h3>{profileName ? `Hey ${profileName}, here's today's reading` : "Today's reading"}</h3>
                  <div class="chapter-links">
                    {#each todayReading.chapters as chapter, i}
                      <button class="chapter-link" on:click={() => navigateToChapter(chapter.book, chapter.chapter)}>
                        {chapter.book} {chapter.chapter}
                      </button>{#if i < todayReading.chapters.length - 1}, {/if}
                    {/each}
                  </div>
                  <div class="chapter-count">{todayReading.chapters.length} chapters</div>
                </div>
              {:else}
                <div class="today-card empty">
                  Today is not a reading day in this plan.
                </div>
              {/if}

              <div class="stats-card">
                <div class="stat-row"><strong>Verses read today:</strong> {verseStats.todayRead}</div>
                <div class="stat-row"><strong>Total verses read:</strong> {verseStats.read}</div>
                <div class="stat-row"><strong>Verses remaining:</strong> {verseStats.remaining}</div>
                <div class="stat-row"><strong>Days ahead/behind:</strong> {daysAheadBehind}</div>
                <div class="stat-row"><strong>Streak:</strong> {streak} days</div>
                {#if profileName}
                  <div class="stat-message">Congrats {profileName}, today you read {verseStats.todayRead} verses!</div>
                {/if}
              </div>

              <button class="primary-btn" on:click={openReadingPlan}>Open Full Reading Plan</button>
            </div>
          {:else if currentTab === 'notes'}
            <SavedVersesPanel on:close={close} />
          {:else if currentTab === 'journal'}
            <JournalCalendar on:close={close} />
          {:else}
            <div class="settings-tab">
              <div class="setting-group">
                <p class="setting-label">Theme</p>
                <select bind:value={theme}>
                  <option value="auto">Auto</option>
                  <option value="sepia">Sepia</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                  <option value="custom">Custom</option>
                </select>
                {#if theme === 'custom'}
                  <!-- The typeface and color pickers live in the Settings pane;
                       duplicating them here would mean two sources of truth. -->
                  <button
                    class="link-btn theme-custom-link"
                    on:click={() => { paneStore.openPane('settings', 'right'); close(); }}
                  >Customize fonts and colors…</button>
                {/if}
              </div>
              <div class="setting-group">
                <p class="setting-label">Default OT Translation</p>
                <select bind:value={defaultOT}>
                  <option value="">Not set</option>
                  {#each $availableTranslations as translation}
                    <option value={translation}>{translationLabel(translation)}</option>
                  {/each}
                </select>
              </div>
              <div class="setting-group">
                <p class="setting-label">Default NT Translation</p>
                <select bind:value={defaultNT}>
                  <option value="">Not set</option>
                  {#each $availableTranslations as translation}
                    <option value={translation}>{translationLabel(translation)}</option>
                  {/each}
                </select>
              </div>
              <div class="setting-group">
                <button class="primary-btn" on:click={() => {
                  applyThemeSelection();
                  updateTranslations();
                }}>
                  Save Changes
                </button>
              </div>
              <div class="setting-group">
                <button class="secondary-btn warning-btn" on:click={() => paneStore.openPane('packs', 'right')}>
                  Manage Packs
                </button>
              </div>
              <div class="setting-group">
                <p class="setting-label">Change Name</p>
                <input class="auth-input" type="text" placeholder="Your name" bind:value={nameUpdate} />
                <button class="primary-btn" on:click={handleChangeName}>
                  Update Name
                </button>
                {#if nameMessage}
                  <div class="auth-message">{nameMessage}</div>
                {/if}
                {#if nameError}
                  <div class="auth-error">{nameError}</div>
                {/if}
              </div>
              <div class="setting-group">
                <p class="setting-label">Change Password</p>
                <input
                  class="auth-input"
                  type="password"
                  placeholder="Current password"
                  bind:value={currentPassword}
                />
                <input
                  class={`auth-input ${newPassword.length > 0 ? (passwordsMatch ? 'match-ok' : 'match-error') : ''}`}
                  type="password"
                  placeholder="New password"
                  bind:value={newPassword}
                />
                <input
                  class={`auth-input ${newPasswordConfirm.length > 0 ? (passwordsMatch ? 'match-ok' : 'match-error') : ''}`}
                  type="password"
                  placeholder="Confirm new password"
                  bind:value={newPasswordConfirm}
                />
                <div class={`password-match ${newPassword.length > 0 || newPasswordConfirm.length > 0 ? (passwordsMatch ? 'ok' : 'error') : ''}`}>
                  {#if newPassword.length > 0 || newPasswordConfirm.length > 0}
                    {passwordsMatch ? 'Passwords match' : 'Passwords do not match'}
                  {/if}
                </div>
                <button class="primary-btn" on:click={handleChangePassword} disabled={!passwordsMatch || !currentPassword}>
                  Change Password
                </button>
                {#if passwordMessage}
                  <div class="auth-message">{passwordMessage}</div>
                {/if}
                {#if passwordError}
                  <div class="auth-error">{passwordError}</div>
                {/if}
              </div>
              <div class="setting-group danger">
                <p class="setting-label">Delete Account</p>
                <button class="danger-btn" on:click={() => (showDeleteConfirm = !showDeleteConfirm)}>
                  Delete Account
                </button>
                {#if showDeleteConfirm && !showFinalDeleteConfirm}
                  <div class="delete-confirm">
                    <p>Type DELETE to confirm account deletion.</p>
                    <input class="auth-input" type="text" bind:value={deleteConfirmText} />
                    <button class="danger-btn" on:click={handleDeleteAccount}>Confirm Delete</button>
                    <button class="secondary-btn" on:click={cancelDeleteAccount}>Cancel</button>
                  </div>
                {/if}
                {#if showFinalDeleteConfirm}
                  <div class="delete-confirm delete-final">
                    <p class="delete-final-warning">ARE YOU SURE YOU WANT TO DELETE YOUR ACCOUNT?</p>
                    <p>This permanently erases your account and every synced note, highlight, journal entry, and reading plan. This cannot be undone.</p>
                    <button class="danger-btn" on:click={handleFinalDeleteAccount}>Yes — permanently delete my account</button>
                    <button class="secondary-btn" on:click={cancelDeleteAccount}>Cancel</button>
                  </div>
                {/if}
                {#if deleteError}
                  <div class="auth-error">{deleteError}</div>
                {/if}
                {#if deleteMessage}
                  <div class="auth-message">{deleteMessage}</div>
                {/if}
              </div>
            </div>
          {/if}
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 2000;
  }

  .modal-content {
    background: #1f1f1f;
    color: #e0e0e0;
    border: 1px solid #2a2a2a;
    border-radius: 10px;
    width: min(780px, 92vw);
    max-height: 85vh;
    overflow: auto;
    padding: 20px;
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.4);
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    margin-bottom: 16px;
  }

  .profile-header {
    display: flex;
    gap: 12px;
    align-items: center;
  }

  .profile-icon {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: #2a2a2a;
    color: inherit;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
    font-size: 18px;
  }

  .profile-icon svg {
    color: #0f766e;
    filter: drop-shadow(0 0 4px #2dd4bf);
  }

  .profile-user-icon {
    display: inline-flex;
    align-items: center;
    color: #431407;
    background: radial-gradient(circle, #d1d5db 0%, #d1d5db 20%, #431407 100%);
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
  :global(.profile-user-icon > svg) {
    filter: drop-shadow(0 0 2px #431407) drop-shadow(0 0 2px #431407);
  }

  .profile-details h2 {
    margin: 0;
    font-size: 18px;
  }

  .profile-subtitle {
    font-size: 12px;
    color: #aaa;
  }

  .profile-actions {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .sync-status {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .sync-indicator {
    font-size: 12px;
    color: #9ccc65;
  }

  .sync-indicator-error {
    color: #ef9a9a;
  }

  .sync-btn {
    padding: 4px 8px;
    background: transparent;
    border: 1px solid #667eea;
    color: #667eea;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    transition: all 0.2s;
  }

  .sync-btn:hover:not(:disabled) {
    background: #667eea;
    color: #fff;
    transform: rotate(180deg);
  }

  .sync-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .tabs {
    display: flex;
    gap: 8px;
    margin-bottom: 16px;
    flex-wrap: wrap;
  }

  .tabs button {
    padding: 8px 12px;
    background: #252525;
    border: 1px solid #3a3a3a;
    color: #ccc;
    border-radius: 6px;
    cursor: pointer;
  }

  .tabs button.active {
    background: #4caf50;
    border-color: #4caf50;
    color: #fff;
  }

  .tab-content {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .auth-panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .auth-input {
    padding: 10px 12px;
    border-radius: 6px;
    border: 1px solid #3a3a3a;
    background: #121212;
    color: inherit;
  }

  .auth-input.match-ok {
    border-color: #4caf50;
  }

  .auth-input.match-error {
    border-color: #e57373;
  }

  .primary-btn,
  .secondary-btn,
  .danger-btn,
  .link-btn {
    padding: 8px 12px;
    border-radius: 6px;
    border: 1px solid #3a3a3a;
    background: #2a2a2a;
    color: inherit;
    cursor: pointer;
  }

  .primary-btn {
    background: #4caf50;
    border-color: #4caf50;
    color: #fff;
  }

  .secondary-btn {
    background: #1f1f1f;
  }

  .secondary-btn.warning-btn {
    background: linear-gradient(135deg, #ffeb3b 0%, #f9a825 100%);
    border-color: #ffeb3b;
    color: #3b2f12;
  }

  .secondary-btn.warning-btn:hover {
    background: linear-gradient(135deg, #fff176 0%, #fbc02d 100%);
    border-color: #fff176;
    color: #3b2f12;
  }

  .danger-btn {
    background: linear-gradient(135deg, #ef5350 0%, #c62828 100%);
    border-color: #ef5350;
    color: #fff;
  }

  .link-btn {
    background: transparent;
    border: none;
    color: #9ccc65;
    text-align: left;
    padding: 0;
  }

  .theme-custom-link {
    margin-top: 8px;
    font-size: 12px;
  }

  .auth-message {
    font-size: 12px;
    color: #9ccc65;
  }

  .auth-error {
    font-size: 12px;
    color: #e57373;
  }

  .password-match {
    font-size: 12px;
    min-height: 16px;
  }

  .password-match.ok {
    color: #9ccc65;
  }

  .password-match.error {
    color: #e57373;
  }

  .reading-tab,
  .settings-tab {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .today-card,
  .stats-card {
    background: #202020;
    border: 1px solid #2a2a2a;
    border-radius: 8px;
    padding: 14px;
  }

  .today-card.empty {
    color: #aaa;
  }

  .chapter-links {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 8px;
  }

  .chapter-link {
    background: transparent;
    border: none;
    color: #9ccc65;
    cursor: pointer;
    padding: 0;
  }

  .chapter-count {
    margin-top: 8px;
    font-size: 12px;
    color: #aaa;
  }

  .stat-row {
    font-size: 13px;
    margin-bottom: 6px;
  }

  .stat-message {
    margin-top: 8px;
    font-size: 12px;
    color: #c8e6c9;
  }

  .setting-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .setting-label {
    margin: 0;
    font-size: 13px;
    color: #ccc;
  }

  .setting-group select {
    padding: 8px 10px;
    border-radius: 6px;
    border: 1px solid #3a3a3a;
    background: #121212;
    color: inherit;
  }

  .setting-group.danger {
    border-top: 1px solid #2a2a2a;
    padding-top: 12px;
  }

  .delete-confirm {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 8px;
  }

  .delete-final {
    border: 1px solid #b91c1c;
    border-radius: 8px;
    padding: 12px;
    background: rgba(185, 28, 28, 0.08);
  }

  .delete-final-warning {
    color: #f87171;
    font-weight: 700;
    letter-spacing: 0.02em;
  }

  .placeholder {
    padding: 20px;
    border: 1px dashed #3a3a3a;
    border-radius: 8px;
    color: #aaa;
  }
</style>
