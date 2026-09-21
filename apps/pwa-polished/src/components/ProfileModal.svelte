<script lang="ts">
  import { onMount } from 'svelte';
  import { profileModalStore } from '../stores/profileModalStore';
  import { userProfileStore } from '../stores/userProfileStore';
  import { supabaseAuthService } from '../services/SupabaseAuthService';
  import { passwordRecovery, authLinkError, finishPasswordRecovery } from '../stores/passwordRecoveryStore';
  import { readingPlanModalStore } from '../stores/readingPlanModalStore';
  import { navigationStore, availableTranslations } from '../stores/navigationStore';
  import { translationLabel } from '../lib/bibleData';
  import { readingProgressStore, getChapterKey } from '../stores/ReadingProgressStore';
  import { readingProgressVersion } from '../stores/readingProgressVersionStore';
  import { getDaysAheadBehind, calculateStreak, planDayDateStr } from '@projectbible/core';
  import { VERSE_COUNTS } from '../../../../packages/core/src/BibleMetadata';
  import { applyTheme, getSettings, updateSettings } from '../adapters/settings';
  import { paneStore } from '../stores/paneStore';
  import { syncService, formatSyncLabel, isSyncRunning, SYNC_SCOPE_TOOLTIP, type SyncState } from '../lib/sync';
  import { pendingWork, type PendingWork } from '../lib/sync/clearPersonalData';
  import { localDateStr, todayStore } from '../stores/clockStore';
  import SavedVersesPanel from './SavedVersesPanel.svelte';
  import JournalCalendar from './JournalCalendar.svelte';
  import YourDataPanel from './YourDataPanel.svelte';
  import BrandSpinner from './BrandSpinner.svelte';
  import PlayTodayButton from './PlayTodayButton.svelte';
  import { User } from 'phosphor-svelte';

  let isOpen = false;
  $: isOpen = $profileModalStore;

  type TabKey = 'reading' | 'notes' | 'journal' | 'settings';
  let currentTab: TabKey = 'reading';

  let authMode: 'login' | 'signup' | 'forgot' | 'sent' = 'login';
  let authEmail = '';
  let authPassword = '';
  let authPasswordConfirm = '';
  let authName = '';
  let authMessage = '';
  let authError = '';
  let authBusy = false;
  /** The address the confirmation went to — shown back on the "check your email" screen. */
  let sentToEmail = '';
  /** Seconds left before "Send it again" is allowed. Supabase refuses a second
      message to the same address inside 60s, so the button says so instead of
      failing. */
  let resendCooldown = 0;
  let resendTimer: ReturnType<typeof setInterval> | null = null;
  let nameUpdate = '';
  let currentPassword = '';
  let newPassword = '';
  let newPasswordConfirm = '';
  let passwordMessage = '';
  let passwordError = '';
  let nameMessage = '';
  let nameError = '';
  let recoveryPassword = '';
  let recoveryPasswordConfirm = '';
  let recoveryError = '';
  let recoveryDone = false;
  let recoverySaving = false;

  let profileName: string | null = null;
  let profileEmail: string | null = null;
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
  /** Set when sign-out found unsent work and is waiting to be told to go on. */
  let signOutPending: PendingWork | null = null;
  let signingOut = false;
  let deleteConfirmText = '';
  let deleteError = '';
  let deleteMessage = '';

  onMount(() => {
    const unsubscribeProfile = userProfileStore.subscribe((profile) => {
      profileName = profile.name;
      profileEmail = profile.email;
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
        // A first look, not the answer. This handler and SyncService's are two
        // subscribers to the same Supabase emitter, so they run together rather
        // than in order: the pull that writes the plan into localStorage has
        // usually not finished when this fires, and reading it here found
        // nothing and said there was no reading today. The reactive block below
        // is what settles it once the plan actually lands. This call stays for
        // the case where the plan was already on the device and no pull is
        // coming — a sign-in on a device that never signed out.
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
      if (resendTimer) clearInterval(resendTimer);
    };
  });

  $: if (isOpen && currentTab === 'reading') {
    void loadReadingPlan();
  }

  // Re-read when a remote pull lands a plan or its progress. ReadingPlanModal
  // has watched this for the same reason; the profile screen's today-card read
  // localStorage once and then waited, which is why the plan only appeared
  // after a manual refresh. Guarded on > 0 so the initial store value does not
  // count as a change and duplicate the load in onMount.
  $: if ($readingProgressVersion > 0) {
    void loadReadingPlan();
  }

  $: passwordsMatch = newPassword.length > 0 && newPassword === newPasswordConfirm;
  $: signUpMatch = authPassword.length > 0 && authPassword === authPasswordConfirm;
  /** Three plain bands rather than a score — the only hard rule is Supabase's six. */
  $: signUpStrength =
    authPassword.length === 0
      ? ''
      : authPassword.length < 6
        ? 'Too short — at least 6 characters'
        : authPassword.length < 10
          ? 'Fine — longer is stronger'
          : 'Strong';
  $: signUpStrengthClass =
    authPassword.length === 0 ? '' : authPassword.length < 6 ? 'error' : authPassword.length < 10 ? 'fair' : 'ok';
  $: recoveryMatch = recoveryPassword.length > 0 && recoveryPassword === recoveryPasswordConfirm;

  // Signing out should not drop them back on the "check your email" screen for
  // whatever address signed up last. The panel is hidden while signed in, so
  // this only shows up on the way back out.
  $: if (isSignedIn && authMode === 'sent') {
    authMode = 'login';
    sentToEmail = '';
  }

  // An expired reset link: show why on the sign-in panel, once.
  $: if ($authLinkError) {
    authMode = 'login';
    authMessage = '';
    authError = $authLinkError;
    authLinkError.set('');
  }

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

  /**
   * Supabase's own wording is sometimes the useful part — "at least 6
   * characters" tells someone what to do — and sometimes it is jargon, or
   * worse, a lie by omission ("Invalid login credentials" for a typo'd
   * password). So the cases worth naming are named, and anything unrecognised
   * falls through to Supabase's sentence rather than a blank shrug.
   */
  function authErrorText(error: unknown, fallback: string): string {
    const raw = error instanceof Error && error.message ? error.message : '';
    const m = raw.toLowerCase();
    if (!m) return fallback;
    if (m.includes('invalid login credentials')) {
      return 'That email and password do not match an account. Check the password, or create an account below.';
    }
    if (m.includes('email not confirmed')) {
      return 'This account still needs confirming — open the link in the email we sent you.';
    }
    if (m.includes('already registered') || m.includes('already been registered') || m.includes('user already')) {
      return 'That email already has an account — try signing in.';
    }
    if (m.includes('at least') && m.includes('characters')) {
      return `Password ${raw.slice(raw.toLowerCase().indexOf('at least'))}`;
    }
    if (m.includes('password') && (m.includes('short') || m.includes('weak'))) {
      return 'That password is too short — use at least 6 characters.';
    }
    if (m.includes('invalid email') || m.includes('email address') && m.includes('invalid')) {
      return 'That does not look like an email address.';
    }
    if (m.includes('unable to validate email')) {
      return 'That does not look like an email address.';
    }
    if (m.includes('rate limit') || m.includes('too many') || m.includes('security purposes')) {
      return 'Too many tries just now — wait a minute and try again.';
    }
    if (m.includes('not authorized')) {
      return 'Email to that address was refused. If this keeps happening, tell Marlowe.';
    }
    if (m.includes('failed to fetch') || m.includes('network')) {
      return 'No connection — check your internet and try again.';
    }
    return raw;
  }

  async function handleSignIn() {
    authMessage = '';
    authError = '';
    if (!authEmail.trim()) {
      authError = 'Enter your email.';
      return;
    }
    if (!authPassword) {
      authError = 'Enter your password.';
      return;
    }
    authBusy = true;
    try {
      await supabaseAuthService.signIn(authEmail.trim(), authPassword);
      authPassword = '';
      authMode = 'login';
    } catch (error) {
      console.error(error);
      authError = authErrorText(error, 'Sign in failed.');
    } finally {
      authBusy = false;
    }
  }

  async function handleSignUp() {
    authMessage = '';
    authError = '';
    if (!authName.trim()) {
      authError = 'Name is required.';
      return;
    }
    if (!authEmail.trim()) {
      authError = 'Enter your email.';
      return;
    }
    if (authPassword.length < 6) {
      authError = 'Password must be at least 6 characters.';
      return;
    }
    if (authPassword !== authPasswordConfirm) {
      authError = 'Passwords do not match.';
      return;
    }
    authBusy = true;
    try {
      const { alreadyRegistered } = await supabaseAuthService.signUp(
        authEmail.trim(),
        authPassword,
        authName.trim(),
      );
      if (alreadyRegistered) {
        // Supabase sends nothing and reports no error here; saying "check your
        // email" would leave them waiting for a message that is not coming.
        authError = 'That email already has an account — try signing in.';
        return;
      }
      sentToEmail = authEmail.trim();
      authPassword = '';
      authPasswordConfirm = '';
      authMode = 'sent';
      startResendCooldown();
    } catch (error) {
      console.error(error);
      authError = authErrorText(error, 'Sign up failed.');
    } finally {
      authBusy = false;
    }
  }

  function startResendCooldown() {
    if (resendTimer) clearInterval(resendTimer);
    resendCooldown = 60;
    resendTimer = setInterval(() => {
      resendCooldown -= 1;
      if (resendCooldown <= 0 && resendTimer) {
        clearInterval(resendTimer);
        resendTimer = null;
        resendCooldown = 0;
      }
    }, 1000);
  }

  async function handleResendConfirmation() {
    if (resendCooldown > 0 || authBusy) return;
    authMessage = '';
    authError = '';
    authBusy = true;
    try {
      await supabaseAuthService.resendSignUpEmail(sentToEmail);
      authMessage = 'Sent again.';
      startResendCooldown();
    } catch (error) {
      console.error(error);
      authError = authErrorText(error, 'Could not send it again.');
    } finally {
      authBusy = false;
    }
  }

  /** "Wrong address?" — back to the form with the address ready to correct. */
  function backToSignUp() {
    authMessage = '';
    authError = '';
    authMode = 'signup';
  }

  async function handleForgotPassword() {
    authMessage = '';
    authError = '';
    if (!authEmail.trim()) {
      authError = 'Enter your email first.';
      return;
    }
    authBusy = true;
    try {
      await supabaseAuthService.resetPassword(authEmail.trim());
      authMessage = 'Check your email for a reset link.';
    } catch (error) {
      console.error(error);
      authError = authErrorText(error, 'Password reset failed.');
    } finally {
      authBusy = false;
    }
  }

  /**
   * Signing out now empties this account's work off the device, so that the
   * next person to sign in here does not find the previous one's notes.
   * Anything that has reached the server comes back on the next sign-in;
   * anything that has not is gone. So this tries to send it first, and only
   * asks a second time about what would not go.
   */
  async function handleSignOut() {
    authMessage = '';
    authError = '';
    signOutPending = null;
    signingOut = true;
    try {
      // Best effort: offline, or with the server refusing, this changes
      // nothing and the count below reports what is still waiting.
      if (navigator.onLine) {
        await syncService.forceSync().catch(() => {});
      }

      const pending = await pendingWork();
      if (pending.total > 0) {
        // Stop and put the number in front of them rather than wiping and
        // reporting it afterwards.
        signOutPending = pending;
        return;
      }

      await supabaseAuthService.signOut();
    } catch (error) {
      console.error(error);
      authError = 'Sign out failed.';
    } finally {
      signingOut = false;
    }
  }

  /** They have seen the count and still want to sign out. */
  async function confirmSignOutAnyway() {
    authError = '';
    signingOut = true;
    try {
      await supabaseAuthService.signOut();
      signOutPending = null;
    } catch (error) {
      console.error(error);
      authError = 'Sign out failed.';
    } finally {
      signingOut = false;
    }
  }

  function cancelSignOut() {
    signOutPending = null;
  }

  /** "3 notes and 1 shared page", or whichever halves are non-zero. */
  function describePending(pending: PendingWork): string {
    const parts: string[] = [];
    if (pending.queued > 0) {
      parts.push(`${pending.queued} ${pending.queued === 1 ? 'change' : 'changes'}`);
    }
    if (pending.outbox > 0) {
      parts.push(`${pending.outbox} shared ${pending.outbox === 1 ? 'page' : 'pages'}`);
    }
    return parts.join(' and ');
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

  // The reset link already signed them in, so no current password is asked for.
  async function handleSetRecoveryPassword() {
    recoveryError = '';
    if (!recoveryMatch) {
      recoveryError = 'Passwords do not match.';
      return;
    }
    recoverySaving = true;
    try {
      await supabaseAuthService.updatePassword(recoveryPassword);
      finishPasswordRecovery();
      recoveryDone = true;
      recoveryPassword = '';
      recoveryPasswordConfirm = '';
    } catch (error) {
      console.error(error);
      // Supabase's own wording is the useful part here ("at least 6 characters",
      // "should be different from the old password").
      recoveryError = error instanceof Error && error.message ? error.message : 'Password update failed.';
    } finally {
      recoverySaving = false;
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

  /**
   * The day this card shows — the same rule the Reading Plan modal uses.
   *
   * The first day that is due and not finished, so a plan that is behind shows
   * the overdue reading rather than going blank. Once everything due is done it
   * falls back to today's own day.
   */
  function getTodayReading(plan: any, completed: Map<number, boolean> = new Map()) {
    if (!plan) return null;
    const todayStr = localDateStr(new Date());
    const firstDue = plan.days.find(
      (day: any) => planDayDateStr(day.date) <= todayStr && !completed.get(day.dayNumber)
    );
    if (firstDue) return firstDue;
    return plan.days.find((day: any) => planDayDateStr(day.date) === todayStr) ?? null;
  }


  /** Whether the day on the card is actually today, or an overdue one. */
  $: todayReadingIsToday = !!todayReading && planDayDateStr(todayReading.date) === $todayStore;

  async function loadReadingPlan() {
    try {
      // Try new multi-plan key first; use the last (most recently added) plan for the widget
      // Signed out, the plan is saved to sessionStorage — same fallback the
      // Reading Plan modal reads, or this card sees no plan at all.
      const storedNew = localStorage.getItem(STORAGE_ACTIVE_PLANS) ?? sessionStorage.getItem(STORAGE_ACTIVE_PLANS);
      let data: {id: string, plan: any} | null = null;
      if (storedNew) {
        const arr: Array<{id: string, plan: any}> = JSON.parse(storedNew);
        if (arr.length > 0) data = arr[arr.length - 1];
      } else {
        // Fall back to legacy key
        const storedOld = localStorage.getItem(STORAGE_ACTIVE_PLAN) ?? sessionStorage.getItem(STORAGE_ACTIVE_PLAN);
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
      const progressEntries = currentPlanId
        ? await readingProgressStore.getProgressForPlan(currentPlanId)
        : [];
      todayReading = getTodayReading(
        currentReadingPlan,
        new Map<number, boolean>(progressEntries.map((e: any) => [e.dayNumber, !!e.completed]))
      );
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
        const key = getChapterKey(chapter.book, chapter.chapter);
        const chapterProgress = progress.chaptersRead.find(
          (item: any) => getChapterKey(item.book, item.chapter) === key,
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
    // setBook/setChapter moved the reader without ever marking where to start.
    // Going through navigateTo makes history behave like every other link, and
    // the mark goes on verse 1 without a scroll target so the chapter title
    // stays in view.
    navigationStore.pushHistory($navigationStore, 'history');
    navigationStore.navigateTo($navigationStore.translation, book, chapter);
    navigationStore.setLinkHighlight(book, chapter, 1);
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
            <button class="secondary-btn" on:click={handleSignOut} disabled={signingOut}>
              {signingOut ? 'Signing out…' : 'Sign Out'}
            </button>
          {/if}
          <button class="close-btn" on:click={close}>&times;</button>
        </div>
      </div>

      {#if signOutPending}
        <div class="signout-confirm">
          <p class="signout-warning">
            {describePending(signOutPending)}
            {signOutPending.total === 1 ? 'has' : 'have'} not reached the server yet.
          </p>
          <p>
            Signing out takes your work off this device, so the next person to sign in
            here doesn't find it. Anything already saved to your account comes back when
            you sign in again — but {signOutPending.total === 1 ? 'this one' : 'these'}
            never got there, and will be lost.
          </p>
          <button class="danger-btn" on:click={confirmSignOutAnyway} disabled={signingOut}>
            Sign out anyway
          </button>
          <button class="secondary-btn" on:click={cancelSignOut} disabled={signingOut}>
            Stay signed in
          </button>
        </div>
      {/if}

      <div class="tabs">
        <button class:active={currentTab === 'reading'} on:click={() => (currentTab = 'reading')}>Reading Plan</button>
        <button class:active={currentTab === 'notes'} on:click={() => (currentTab = 'notes')}>Saved Verses/Notes</button>
        <button class:active={currentTab === 'journal'} on:click={() => (currentTab = 'journal')}>Journal</button>
        <button class:active={currentTab === 'settings'} on:click={() => (currentTab = 'settings')}>Settings</button>
      </div>

      <div class="tab-content">
        {#if isSignedIn && ($passwordRecovery || recoveryDone)}
          <div class="auth-panel">
            {#if recoveryDone}
              <h3>Password saved</h3>
              <div class="auth-message">Your new password is set, and you're signed in.</div>
              <button class="primary-btn" on:click={() => (recoveryDone = false)}>Continue</button>
            {:else}
              <h3>Choose a new password</h3>
              <input
                class={`auth-input ${recoveryPassword.length > 0 ? (recoveryMatch ? 'match-ok' : 'match-error') : ''}`}
                type="password"
                placeholder="New password"
                autocomplete="new-password"
                bind:value={recoveryPassword}
              />
              <input
                class={`auth-input ${recoveryPasswordConfirm.length > 0 ? (recoveryMatch ? 'match-ok' : 'match-error') : ''}`}
                type="password"
                placeholder="Confirm new password"
                autocomplete="new-password"
                bind:value={recoveryPasswordConfirm}
              />
              <div class={`password-match ${recoveryPassword.length > 0 || recoveryPasswordConfirm.length > 0 ? (recoveryMatch ? 'ok' : 'error') : ''}`}>
                {#if recoveryPassword.length > 0 || recoveryPasswordConfirm.length > 0}
                  {recoveryMatch ? 'Passwords match' : 'Passwords do not match'}
                {/if}
              </div>
              <button class="primary-btn" on:click={handleSetRecoveryPassword} disabled={!recoveryMatch || recoverySaving}>
                {recoverySaving ? 'Saving…' : 'Save new password'}
              </button>
              {#if recoveryError}
                <div class="auth-error">{recoveryError}</div>
              {/if}
            {/if}
          </div>
        {:else if !isSignedIn}
          <div class="auth-panel">
            {#if authMode === 'login'}
              <h3>Sign in</h3>
              <input
                class="auth-input"
                type="email"
                placeholder="Email"
                autocomplete="email"
                bind:value={authEmail}
                on:keydown={(e) => e.key === 'Enter' && handleSignIn()}
              />
              <input
                class="auth-input"
                type="password"
                placeholder="Password"
                autocomplete="current-password"
                bind:value={authPassword}
                on:keydown={(e) => e.key === 'Enter' && handleSignIn()}
              />
              <button class="primary-btn" on:click={handleSignIn} disabled={authBusy}>
                {authBusy ? 'Signing in…' : 'Sign in'}
              </button>
              <button class="link-btn" on:click={() => (authMode = 'forgot')}>Forgot password?</button>
              <button class="secondary-btn" on:click={() => { authError = ''; authMessage = ''; authMode = 'signup'; }}>
                Create account
              </button>
            {:else if authMode === 'signup'}
              <h3>Create account</h3>
              <input class="auth-input" type="text" placeholder="Name" autocomplete="name" bind:value={authName} />
              <input class="auth-input" type="email" placeholder="Email" autocomplete="email" bind:value={authEmail} />
              <input
                class={`auth-input ${authPassword.length > 0 ? (authPassword.length < 6 ? 'match-error' : 'match-ok') : ''}`}
                type="password"
                placeholder="Password"
                autocomplete="new-password"
                bind:value={authPassword}
              />
              <div class={`password-match ${signUpStrengthClass}`}>{signUpStrength}</div>
              <input
                class={`auth-input ${authPasswordConfirm.length > 0 ? (signUpMatch ? 'match-ok' : 'match-error') : ''}`}
                type="password"
                placeholder="Confirm password"
                autocomplete="new-password"
                bind:value={authPasswordConfirm}
              />
              <div class={`password-match ${authPasswordConfirm.length > 0 ? (signUpMatch ? 'ok' : 'error') : ''}`}>
                {#if authPasswordConfirm.length > 0}
                  {signUpMatch ? 'Passwords match' : 'Passwords do not match'}
                {/if}
              </div>
              <button class="primary-btn" on:click={handleSignUp} disabled={authBusy}>
                {authBusy ? 'Creating account…' : 'Create account'}
              </button>
              <button class="link-btn" on:click={() => { authError = ''; authMessage = ''; authMode = 'login'; }}>
                Back to sign in
              </button>
            {:else if authMode === 'sent'}
              <!-- The screen whose absence caused "not sure if it worked". -->
              <h3>Check your email</h3>
              <div class="auth-sent">
                <p class="auth-sent-lead">We sent a confirmation link to</p>
                <p class="auth-sent-email">{sentToEmail}</p>
                <p class="auth-sent-note">
                  Open it and you'll land back here, signed in. It can take a minute, and it
                  sometimes lands in spam.
                </p>
              </div>
              <button
                class="secondary-btn"
                on:click={handleResendConfirmation}
                disabled={authBusy || resendCooldown > 0}
              >
                {resendCooldown > 0 ? `Send it again in ${resendCooldown}s` : 'Send it again'}
              </button>
              <button class="link-btn" on:click={backToSignUp}>Wrong address?</button>
              <button class="link-btn" on:click={() => { authError = ''; authMessage = ''; authMode = 'login'; }}>
                Back to sign in
              </button>
            {:else}
              <h3>Reset password</h3>
              <input
                class="auth-input"
                type="email"
                placeholder="Email"
                autocomplete="email"
                bind:value={authEmail}
                on:keydown={(e) => e.key === 'Enter' && handleForgotPassword()}
              />
              <button class="primary-btn" on:click={handleForgotPassword} disabled={authBusy}>
                {authBusy ? 'Sending…' : 'Send reset link'}
              </button>
              <button class="link-btn" on:click={() => { authError = ''; authMessage = ''; authMode = 'login'; }}>
                Back to sign in
              </button>
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
                  <h3>
                    {#if todayReadingIsToday}
                      {profileName ? `Hey ${profileName}, here's today's reading` : "Today's reading"}
                    {:else}
                      {profileName ? `Hey ${profileName}, here's your next reading` : 'Your next reading'}
                      <span class="today-card-day">Day {todayReading.dayNumber}</span>
                    {/if}
                  </h3>
                  {#if todayReading.harmonySections?.length}
                    <!-- A gospel-harmony day lists verse ranges, not whole
                         chapters. Without this branch the card would show
                         nothing and the play button would read passages it had
                         never listed. -->
                    {@const harmonyPassages = todayReading.harmonySections.flatMap((s: any) => s.passages)}
                    <div class="chapter-links">
                      {#each harmonyPassages as passage, i}
                        <button
                          class="chapter-link"
                          on:click={() => navigateToChapter(passage.book, passage.startChapter)}
                        >
                          {passage.label}
                        </button>{#if i < harmonyPassages.length - 1}, {/if}
                      {/each}
                    </div>
                    <div class="chapter-count">{harmonyPassages.length} passages</div>
                  {:else}
                    <div class="chapter-links">
                      {#each todayReading.chapters as chapter, i}
                        <button class="chapter-link" on:click={() => navigateToChapter(chapter.book, chapter.chapter)}>
                          {chapter.book} {chapter.chapter}
                        </button>{#if i < todayReading.chapters.length - 1}, {/if}
                      {/each}
                    </div>
                    <div class="chapter-count">{todayReading.chapters.length} chapters</div>
                  {/if}
                  <div class="today-card-actions">
                    <PlayTodayButton onStarted={() => profileModalStore.close()} planId={currentPlanId} day={todayReading} />
                  </div>
                </div>
              {:else}
                <div class="today-card empty">
                  Nothing due in this plan right now.
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
              <YourDataPanel />
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

  .auth-panel h3 {
    margin: 0 0 2px;
    font-size: 1rem;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.92);
  }

  .auth-input {
    padding: 11px 13px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: #121212;
    color: inherit;
    transition: border-color 0.15s;
  }

  .auth-input:focus {
    outline: none;
    border-color: rgba(230, 184, 74, 0.6);
  }

  .auth-input.match-ok {
    border-color: rgba(230, 184, 74, 0.55);
  }

  .auth-input.match-error {
    border-color: #e57373;
  }

  /* "Check your email" — the tinted block borrowed from the daily card. */
  .auth-sent {
    background: rgba(230, 184, 74, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.07);
    border-radius: 12px;
    padding: 16px 16px 14px;
  }

  .auth-sent-lead {
    margin: 0;
    font-size: 0.82rem;
    color: rgba(255, 255, 255, 0.55);
  }

  .auth-sent-email {
    margin: 4px 0 10px;
    font-size: 0.95rem;
    font-weight: 700;
    color: #e6b84a;
    word-break: break-all;
  }

  .auth-sent-note {
    margin: 0;
    font-size: 0.8rem;
    line-height: 1.55;
    color: rgba(255, 255, 255, 0.5);
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
    background: #e6b84a;
    border-color: #e6b84a;
    color: #111;
    border-radius: 8px;
    padding: 10px 14px;
    font-weight: 600;
    transition: background 0.15s, opacity 0.15s;
  }

  .primary-btn:hover:not(:disabled) {
    background: #f0c96a;
  }

  .primary-btn:disabled,
  .secondary-btn:disabled {
    opacity: 0.55;
    cursor: default;
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
    color: #e6b84a;
    text-align: left;
    padding: 0;
  }

  .theme-custom-link {
    margin-top: 8px;
    font-size: 12px;
  }

  .auth-message {
    font-size: 12px;
    color: #e6b84a;
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
    color: #e6b84a;
  }

  .password-match.fair {
    color: rgba(255, 255, 255, 0.45);
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

  .today-card-day {
    margin-left: 6px;
    font-size: 0.78rem;
    font-weight: 600;
    color: #9a90b5;
  }

  .today-card-actions {
    margin-top: 12px;
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
  /* Sits between the header and the tabs, so it is the first thing read. */
  .signout-confirm {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 12px 16px 0;
    padding: 12px;
    border: 1px solid #b91c1c;
    border-radius: 8px;
    background: rgba(185, 28, 28, 0.08);
  }
  .signout-confirm p {
    margin: 0;
    font-size: 0.9rem;
    line-height: 1.45;
  }
  .signout-warning {
    color: #f87171;
    font-weight: 700;
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
