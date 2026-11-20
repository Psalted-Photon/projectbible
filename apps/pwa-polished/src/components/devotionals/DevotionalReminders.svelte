<script lang="ts">
  /**
   * Setup → Reminders. A morning and an evening time, each with its own switch.
   * Signed in only: the server sends them, the same way it sends the wake alarm.
   * In the Android app the phone sets them itself, so no sign-in is needed.
   * Morning only / Evening only hides the reminder that doesn't apply.
   */
  import { onDestroy, onMount } from 'svelte';
  import { Bell } from 'phosphor-svelte';
  import { userProfileStore } from '../../stores/userProfileStore';
  import { profileModalStore } from '../../stores/profileModalStore';
  import { readingPlanModalStore } from '../../stores/readingPlanModalStore';
  import { devotionalSettings } from '../../stores/devotionalStore';
  import { saveReminders } from '../../lib/devotionals/reminderSync';
  import { pushSupport, notificationPermission } from '../../lib/alarm/pushSubscription';
  import { IS_ANDROID_APP } from '../../lib/platform';
  import { openPhoneSettings, phoneAlarmStatus, type PhoneAlarmStatus } from '../../lib/android/alarms';

  let status = '';
  let statusKind: '' | 'ok' | 'warn' | 'error' = '';
  let saving = false;
  let permission: NotificationPermission | 'unavailable' = 'default';
  let supportMessage = '';

  // The Android app: the phone's notification and exact-timing permissions.
  let phone: PhoneAlarmStatus | null = null;

  async function refreshPhone() {
    try {
      phone = await phoneAlarmStatus();
    } catch {
      phone = null;
    }
  }

  // Back from the phone's settings, either permission may have changed.
  function handlePhoneReturn() {
    if (!document.hidden) void refreshPhone();
  }

  onMount(() => {
    if (IS_ANDROID_APP) {
      void refreshPhone();
      document.addEventListener('visibilitychange', handlePhoneReturn);
      return;
    }
    const support = pushSupport();
    if (!support.supported) supportMessage = support.message.replace(/alarms/g, 'reminders');
    permission = notificationPermission();
  });

  onDestroy(() => {
    if (IS_ANDROID_APP) document.removeEventListener('visibilitychange', handlePhoneReturn);
  });

  $: r = $devotionalSettings.reminders;
  $: showMorning = $devotionalSettings.slotMode !== 'evening';
  $: showEvening = $devotionalSettings.slotMode !== 'morning';
  $: anyOn = (r.morningEnabled && showMorning) || (r.eveningEnabled && showEvening);

  async function change(update: Partial<typeof r>) {
    devotionalSettings.update({ reminders: update });
    saving = true;
    status = '';
    statusKind = '';
    const { result, warning, phone: answer } = await saveReminders($devotionalSettings);
    saving = false;
    if (IS_ANDROID_APP) {
      if (answer) phone = answer;
    } else {
      permission = notificationPermission();
    }
    const anyOn = ($devotionalSettings.reminders.morningEnabled && showMorning) || ($devotionalSettings.reminders.eveningEnabled && showEvening);
    if (warning) {
      statusKind = 'warn';
      status = warning;
    } else if (result.ok) {
      statusKind = 'ok';
      status = anyOn ? 'Reminder set.' : 'Reminders off.';
    } else {
      statusKind = result.reason === 'error' ? 'error' : 'warn';
      status = result.message;
    }
  }

  function signIn() {
    readingPlanModalStore.close();
    profileModalStore.open();
  }
</script>

<div class="dt-setting">
  <span class="dt-setting-label"><Bell size={13} weight="bold" /> Reminders</span>

  {#if !IS_ANDROID_APP && !$userProfileStore.isSignedIn}
    <span class="dt-setting-hint">
      <button class="dr-link" on:click={signIn}>Sign in</button> to get reminders. They come from your account, like the Auto-Read Alarm.
    </span>
  {:else if !IS_ANDROID_APP && supportMessage}
    <span class="dt-setting-hint">{supportMessage}</span>
  {:else}
    {#if showMorning}
      <div class="dr-row">
        <label class="dr-toggle">
          <input
            type="checkbox"
            checked={r.morningEnabled}
            disabled={saving}
            on:change={(e) => change({ morningEnabled: e.currentTarget.checked })}
          />
          Morning
        </label>
        <input
          type="time"
          value={r.morningTime}
          disabled={saving}
          on:change={(e) => e.currentTarget.value && change({ morningTime: e.currentTarget.value })}
        />
      </div>
    {/if}
    {#if showEvening}
      <div class="dr-row">
        <label class="dr-toggle">
          <input
            type="checkbox"
            checked={r.eveningEnabled}
            disabled={saving}
            on:change={(e) => change({ eveningEnabled: e.currentTarget.checked })}
          />
          Evening
        </label>
        <input
          type="time"
          value={r.eveningTime}
          disabled={saving}
          on:change={(e) => e.currentTarget.value && change({ eveningTime: e.currentTarget.value })}
        />
      </div>
    {/if}

    {#if IS_ANDROID_APP}
      <!-- Shown whenever they are off with a reminder on: after a "no",
           Android may stop asking without saying so. -->
      {#if phone && phone.notifications !== 'granted' && (anyOn || phone.notifications === 'denied')}
        <span class="dr-status warn">
          Notifications are off for irisBible.
          <button class="dr-link" on:click={() => openPhoneSettings('notifications')}>Open settings</button>
        </span>
      {:else if status}
        <span class="dr-status {statusKind}">{status}</span>
      {/if}
      {#if phone && !phone.exact && anyOn}
        <span class="dt-setting-hint">
          Android may bring reminders a little late until “Alarms &amp; reminders” is allowed.
          <button class="dr-link" on:click={() => openPhoneSettings('exact')}>Allow</button>
        </span>
      {/if}
      <span class="dt-setting-hint">Tapping the reminder opens that reading.</span>
    {:else}
      {#if permission === 'denied'}
        <span class="dr-status warn">Notifications are blocked for irisBible. Turn them back on in your phone or browser settings.</span>
      {:else if status}
        <span class="dr-status {statusKind}">{status}</span>
      {/if}
      <span class="dt-setting-hint">Tapping the reminder opens that reading. Needs a connection at the time it's due.</span>
    {/if}
  {/if}
</div>

<style>
  .dt-setting-label {
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .dr-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 6px 0;
  }
  .dr-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.9rem;
    color: rgba(255, 255, 255, 0.85);
    cursor: pointer;
  }
  .dr-toggle input {
    width: 18px;
    height: 18px;
    accent-color: #e6b84a;
  }
  .dr-row input[type='time'] {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 6px;
    color: rgba(255, 255, 255, 0.9);
    padding: 5px 8px;
    color-scheme: dark;
  }
  .dr-status {
    font-size: 0.78rem;
  }
  .dr-status.ok {
    color: #4caf50;
  }
  .dr-status.warn {
    color: #e6b84a;
  }
  .dr-status.error {
    color: #ef5350;
  }
  .dr-link {
    background: none;
    border: none;
    padding: 0;
    color: #e6b84a;
    font: inherit;
    font-weight: 600;
    text-decoration: underline;
    cursor: pointer;
  }
</style>
