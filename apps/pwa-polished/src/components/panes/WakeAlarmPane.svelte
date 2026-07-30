<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { Alarm } from "phosphor-svelte";
  import { BIBLE_BOOKS } from "../../lib/bibleData";
  import {
    getWakeAlarmSettings,
    updateWakeAlarmSettings,
    getEffectiveTimezone,
    type WakeAlarmSettings,
  } from "../../adapters/settings";
  import { pushAlarm, sendTestAlarm } from "../../lib/alarm/alarmSync";
  import {
    ensurePushSubscription,
    pushSupport,
    notificationPermission,
    showTestNotification,
  } from "../../lib/alarm/pushSubscription";
  import {
    minutesUntilAlarm,
    formatCountdown,
    formatDays,
    formatTime12h,
    DAY_SHORT,
  } from "../../lib/alarm/alarmSchedule";
  import { userProfileStore } from "../../stores/userProfileStore";

  let enabled = false;
  let time = "06:00";
  let days: number[] = [];
  let source: WakeAlarmSettings["source"] = "continue";
  let book = "Genesis";
  let chapter = 1;

  let saving = false;
  let statusMessage = "";
  let statusKind: "ok" | "warn" | "error" | "" = "";

  // Whether this browser can receive an alarm at all, and whether it has been
  // allowed to. Both are surfaced before the user saves rather than after.
  let blockedReason = "";
  let permissionState: NotificationPermission | "unavailable" = "default";

  const timezone = getEffectiveTimezone();

  // Recomputed every minute so the countdown does not go stale while the pane
  // sits open.
  let tick = Date.now();
  let tickTimer: ReturnType<typeof setInterval> | null = null;

  onMount(() => {
    const alarm = getWakeAlarmSettings();
    enabled = alarm.enabled;
    time = alarm.time;
    // Stored empty means "every day"; show that as all seven lit so tapping a
    // day removes it instead of narrowing the alarm to only that day.
    days = alarm.days.length === 0 ? [0, 1, 2, 3, 4, 5, 6] : [...alarm.days];
    source = alarm.source;
    book = alarm.book ?? "Genesis";
    chapter = alarm.chapter ?? 1;

    const support = pushSupport();
    blockedReason = support.supported ? "" : support.message;
    permissionState = notificationPermission();

    tickTimer = setInterval(() => (tick = Date.now()), 60_000);
  });

  onDestroy(() => {
    if (tickTimer) clearInterval(tickTimer);
  });

  $: chapterCount = BIBLE_BOOKS.find((b) => b.name === book)?.chapters ?? 1;
  // Switching to a shorter book must not leave an out-of-range chapter behind.
  $: if (chapter > chapterCount) chapter = chapterCount;

  $: countdown = (() => {
    tick; // re-run each minute
    if (!enabled) return null;
    const minutes = minutesUntilAlarm(time, days, timezone);
    return minutes === null ? null : formatCountdown(minutes);
  })();

  function toggleDay(day: number) {
    days = days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort((a, b) => a - b);
  }

  function setPreset(preset: "everyday" | "weekdays" | "weekends") {
    if (preset === "everyday") days = [0, 1, 2, 3, 4, 5, 6];
    else if (preset === "weekdays") days = [1, 2, 3, 4, 5];
    else days = [0, 6];
  }

  // An armed alarm with no days would never fire — block the save rather than
  // letting it look armed.
  $: daysValid = days.length > 0;

  let testing = false;
  let testingReal = false;

  async function runTestNotification() {
    testing = true;
    statusMessage = "";
    statusKind = "";
    const result = await showTestNotification();
    permissionState = notificationPermission();
    testing = false;

    if (result.ok) {
      statusKind = "ok";
      statusMessage = "Sent. Check your notification shade — that's the look.";
    } else {
      statusKind = result.reason === "error" ? "error" : "warn";
      statusMessage = result.message;
    }
  }

  /**
   * The real test: the server pushes to this account's devices. Lock the phone
   * first — that is the behaviour worth proving.
   */
  async function runRealTestAlarm() {
    testingReal = true;
    statusMessage = "";
    statusKind = "";
    const result = await sendTestAlarm();
    testingReal = false;

    if (result.ok) {
      statusKind = "ok";
      statusMessage = "Sent from the server. It should arrive within a few seconds, even with the app closed.";
    } else {
      statusKind = result.reason === "error" ? "error" : "warn";
      statusMessage = result.message;
    }
  }

  async function save() {
    if (enabled && !daysValid) return;
    saving = true;
    statusMessage = "";
    statusKind = "";

    const alarm: WakeAlarmSettings = {
      enabled,
      time,
      days,
      source,
      book: source === "chapter" ? book : undefined,
      chapter: source === "chapter" ? chapter : undefined,
    };
    updateWakeAlarmSettings(alarm);

    // Let the Settings pane (which can be open beside this one) refresh its summary.
    window.dispatchEvent(new CustomEvent("settingsUpdated"));

    // Arming needs this device registered to receive notifications. If that
    // fails we still mirror the schedule — it becomes deliverable the moment
    // any device subscribes — but say plainly that nothing will ring yet.
    let pushProblem = "";
    if (enabled) {
      const push = await ensurePushSubscription();
      permissionState = notificationPermission();
      if (!push.ok) pushProblem = push.message;
    }

    const result = await pushAlarm(alarm);
    saving = false;

    if (pushProblem) {
      statusKind = "warn";
      statusMessage = pushProblem;
    } else if (result.ok) {
      statusKind = "ok";
      statusMessage = enabled ? "Alarm armed on this device." : "Alarm saved and turned off.";
    } else {
      statusKind = result.reason === "error" ? "error" : "warn";
      statusMessage = result.message;
    }
  }
</script>

<div class="alarm-pane">
  <h2>
    <span class="header-icon">
      <Alarm size={20} weight="bold" />
      <span class="icon-overlay"><Alarm size={20} weight="thin" /></span>
    </span>
    Wake Alarm
  </h2>

  <p class="section-description">
    At the time you set, your phone gets a ProjectBible notification. Tap it and
    the app opens with a start button — reading never begins on its own.
  </p>

  <div class="requirement-box">
    <p><strong>What this needs:</strong></p>
    <ul>
      <li>
        You must be signed in — the reminder is sent from your account.
        {#if !$userProfileStore.isSignedIn}
          <span class="requirement-bad">You are signed out right now.</span>
        {/if}
      </li>
      <li>
        Permission to send you notifications. Saving an armed alarm asks for it.
        {#if permissionState === "denied"}
          <span class="requirement-bad">
            Notifications are blocked — turn them back on in your browser or phone
            settings, then save again.
          </span>
        {:else if permissionState === "granted"}
          <span class="requirement-good">Allowed.</span>
        {/if}
      </li>
      <li>Your phone needs internet at the set time. No connection, no alarm.</li>
    </ul>
    {#if blockedReason}
      <p class="requirement-bad blocked-note">{blockedReason}</p>
    {/if}
  </div>

  <div class="setting-group">
    <label class="checkbox-label">
      <input type="checkbox" bind:checked={enabled} />
      <span class="label-text">Alarm on</span>
    </label>
  </div>

  <div class="setting-group">
    <label>
      <span class="label-text">Time</span>
      <input class="time-input" type="time" bind:value={time} />
    </label>
  </div>

  <div class="setting-group">
    <span class="label-text">Days</span>
    <div class="day-row">
      {#each DAY_SHORT as label, day}
        <button
          type="button"
          class="day-btn"
          class:day-on={days.includes(day)}
          on:click={() => toggleDay(day)}
          aria-pressed={days.includes(day)}
        >{label.charAt(0)}</button>
      {/each}
    </div>
    {#if !daysValid}
      <p class="hint hint-bad">Pick at least one day.</p>
    {/if}
    <div class="preset-row">
      <button type="button" class="preset-btn" on:click={() => setPreset("everyday")}>Every day</button>
      <button type="button" class="preset-btn" on:click={() => setPreset("weekdays")}>Weekdays</button>
      <button type="button" class="preset-btn" on:click={() => setPreset("weekends")}>Weekends</button>
    </div>
  </div>

  <div class="setting-group">
    <label>
      <span class="label-text">What to read</span>
      <select bind:value={source}>
        <option value="continue">Continue where I left off</option>
        <option value="chapter">A specific chapter</option>
        <option value="plan">My reading plan's next reading</option>
      </select>
    </label>

    {#if source === "chapter"}
      <div class="chapter-row">
        <select bind:value={book} aria-label="Book">
          {#each BIBLE_BOOKS as b}
            <option value={b.name}>{b.name}</option>
          {/each}
        </select>
        <select bind:value={chapter} aria-label="Chapter">
          {#each Array(chapterCount) as _, i}
            <option value={i + 1}>Chapter {i + 1}</option>
          {/each}
        </select>
      </div>
    {:else if source === "plan"}
      <p class="hint">If no plan is active, this falls back to where you left off.</p>
    {/if}
  </div>

  {#if enabled}
    <div class="summary">
      <strong>{formatTime12h(time)}</strong> · {formatDays(days)}
      {#if countdown}<span class="summary-countdown">— rings {countdown}</span>{/if}
      <div class="summary-tz">Timezone: {timezone}</div>
    </div>
  {/if}

  <div class="button-group">
    <button class="save-button" on:click={save} disabled={saving || (enabled && !daysValid)}>
      {saving ? "Saving…" : "Save Alarm"}
    </button>
    {#if statusMessage}
      <span class="status status-{statusKind}">{statusMessage}</span>
    {/if}
  </div>

  <div class="test-section">
    <h3>Test it</h3>
    <div class="test-row">
      <button class="test-button" on:click={runTestNotification} disabled={testing}>
        {testing ? "Sending…" : "Preview the look"}
      </button>
      <span class="test-desc">
        Shows the notification instantly, from the app itself. Proves permission,
        the icon and the name — nothing more.
      </span>
    </div>
    <div class="test-row">
      <button class="test-button test-button-real" on:click={runRealTestAlarm} disabled={testingReal}>
        {testingReal ? "Asking the server…" : "Send a real test alarm"}
      </button>
      <span class="test-desc">
        The whole path, from the server. <strong>Lock your phone and close the app
        first</strong> — that's the behaviour worth proving. Arrives within a few
        seconds.
      </span>
    </div>
  </div>

  <div class="loud-box">
    <h3>If it doesn't wake you</h3>
    <p>
      A notification uses your phone's normal notification sound, which we can't
      make louder from here. Fix it once, by hand:
    </p>
    <ul>
      <li><strong>Android:</strong> long-press a ProjectBible notification → its settings → set the sound to an alarm tone and raise the importance.</li>
      <li><strong>iPhone:</strong> Settings → Focus → Sleep → allow notifications from ProjectBible.</li>
    </ul>
  </div>
</div>

<style>
  .alarm-pane {
    padding: 20px;
    color: #e0e0e0;
  }

  h2 {
    font-size: 1.5rem;
    margin-bottom: 1rem;
    color: #f0f0f0;
    font-weight: 600;
  }

  .header-icon {
    display: inline-flex;
    align-items: center;
    vertical-align: middle;
    margin-right: 6px;
    color: #431407;
    background: radial-gradient(circle, #7dd3fc 0%, #7dd3fc 20%, #431407 100%);
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

  .section-description {
    font-size: 0.9rem;
    color: #999;
    line-height: 1.5;
    margin-bottom: 1.25rem;
  }

  .requirement-box {
    background: rgba(102, 126, 234, 0.08);
    border: 1px solid rgba(102, 126, 234, 0.3);
    border-radius: 8px;
    padding: 12px 14px;
    margin-bottom: 1.75rem;
    font-size: 0.85rem;
    color: #bbb;
    line-height: 1.5;
  }
  .requirement-box p { margin: 0 0 0.5rem; color: #ddd; }
  .requirement-box ul { margin: 0; padding-left: 1.1rem; }
  .requirement-box li { margin-bottom: 0.35rem; }
  .requirement-bad {
    display: block;
    color: #f0a0a0;
    font-weight: 600;
  }
  .requirement-good {
    display: block;
    color: #7ddc9a;
    font-weight: 600;
  }
  .blocked-note {
    margin: 0.75rem 0 0 !important;
    padding-top: 0.6rem;
    border-top: 1px solid rgba(240, 160, 160, 0.25);
  }

  .setting-group {
    margin-bottom: 1.75rem;
  }

  .setting-group label {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .checkbox-label {
    flex-direction: row !important;
    align-items: center;
    gap: 0.75rem !important;
    cursor: pointer;
  }

  .checkbox-label input[type="checkbox"] {
    width: 20px;
    height: 20px;
    cursor: pointer;
    accent-color: #667eea;
  }

  .label-text {
    font-size: 0.95rem;
    color: #ccc;
    font-weight: 500;
  }

  select,
  .time-input {
    width: 100%;
    padding: 0.75rem;
    background: #1a1a1a;
    border: 1px solid #444;
    border-radius: 6px;
    color: #e0e0e0;
    font-size: 0.95rem;
    cursor: pointer;
    transition: border-color 0.2s;
  }

  select:hover,
  .time-input:hover {
    border-color: #667eea;
  }

  select:focus,
  .time-input:focus {
    outline: none;
    border-color: #667eea;
    box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
  }

  .time-input {
    font-size: 1.35rem;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.02em;
  }

  .day-row {
    display: flex;
    gap: 6px;
    margin-top: 0.75rem;
  }

  .day-btn {
    flex: 1;
    aspect-ratio: 1;
    min-width: 0;
    background: #1a1a1a;
    border: 1px solid #444;
    border-radius: 50%;
    color: #888;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }
  .day-btn:hover { border-color: #667eea; }
  .day-on {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border-color: transparent;
    color: white;
  }

  .preset-row {
    display: flex;
    gap: 8px;
    margin-top: 0.75rem;
  }
  .preset-btn {
    padding: 6px 12px;
    background: #222;
    border: 1px solid #444;
    border-radius: 999px;
    color: #bbb;
    font-size: 0.8rem;
    cursor: pointer;
    transition: all 0.15s;
  }
  .preset-btn:hover {
    border-color: #667eea;
    color: #e0e0e0;
  }

  .chapter-row {
    display: flex;
    gap: 8px;
    margin-top: 0.75rem;
  }

  .hint {
    font-size: 0.8rem;
    color: #888;
    margin: 0.6rem 0 0;
  }
  .hint-bad { color: #e8c47a; }

  .summary {
    background: #191919;
    border: 1px solid #333;
    border-left: 3px solid #667eea;
    border-radius: 6px;
    padding: 12px 14px;
    font-size: 1rem;
    color: #ddd;
  }
  .summary strong { color: #fff; font-size: 1.15rem; }
  .summary-countdown { color: #999; font-size: 0.9rem; }
  .summary-tz {
    margin-top: 4px;
    font-size: 0.75rem;
    color: #777;
  }

  .button-group {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
    margin-top: 1.5rem;
    margin-bottom: 2rem;
  }

  .save-button {
    padding: 12px 24px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border: none;
    border-radius: 6px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
  }
  .save-button:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
  }
  .save-button:disabled { opacity: 0.6; cursor: default; }

  .test-button {
    padding: 10px 16px;
    background: #222;
    border: 1px solid #444;
    border-radius: 6px;
    color: #bbb;
    font-size: 0.85rem;
    cursor: pointer;
    transition: all 0.15s;
  }
  .test-button:hover:not(:disabled) {
    border-color: #667eea;
    color: #e0e0e0;
  }
  .test-button:disabled { opacity: 0.6; cursor: default; }

  .test-section {
    border-top: 1px solid #333;
    padding-top: 1.25rem;
    margin-bottom: 2rem;
  }
  .test-section h3 {
    font-size: 0.95rem;
    color: #ccc;
    margin: 0 0 0.9rem;
    font-weight: 600;
  }

  .test-row {
    display: flex;
    align-items: flex-start;
    gap: 0.85rem;
    margin-bottom: 1rem;
  }
  .test-row .test-button {
    flex: 0 0 auto;
    white-space: nowrap;
  }
  .test-desc {
    font-size: 0.78rem;
    color: #888;
    line-height: 1.5;
  }
  .test-desc strong { color: #bbb; }

  .test-button-real {
    border-color: #667eea;
    color: #cdd4f7;
  }

  @media (max-width: 420px) {
    .test-row {
      flex-direction: column;
      gap: 0.5rem;
    }
  }

  .status { font-size: 0.85rem; line-height: 1.4; }
  .status-ok { color: #7ddc9a; }
  .status-warn { color: #e8c47a; }
  .status-error { color: #f0a0a0; }

  .loud-box {
    border-top: 1px solid #333;
    padding-top: 1.25rem;
    font-size: 0.83rem;
    color: #999;
    line-height: 1.55;
  }
  .loud-box h3 {
    font-size: 0.95rem;
    color: #ccc;
    margin: 0 0 0.5rem;
    font-weight: 600;
  }
  .loud-box p { margin: 0 0 0.6rem; }
  .loud-box ul { margin: 0; padding-left: 1.1rem; }
  .loud-box li { margin-bottom: 0.4rem; }
</style>
