package com.irisbible.app;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import java.util.Calendar;
import java.util.TimeZone;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The Auto-Read Alarm and the devotional reminders, set on the phone itself.
 *
 * On the web a server sends these as pushes, because a web page cannot wake a
 * sleeping phone. The app can: Android's own alarm clock rings it at the
 * minute, with no server, no internet and no sign-in, and a battery saver
 * cannot hold it back the way it holds back a push.
 *
 * The page sends the whole schedule (IrisAlarmsPlugin.setSchedule), including
 * the words each notification shows and the link a tap opens, so every string
 * lives in the page. It is kept here so the next alarm can be set again after
 * each one rings, after a restart, and after the clock or time zone changes
 * (AlarmReceiver), all without the app being open.
 *
 * Kinds: "alarm" (the Auto-Read Alarm, on chosen days), "morning" and
 * "evening" (the devotional reminders, every day) and "test" (a one-off from
 * the alarm's test buttons).
 */
final class PhoneAlarms {

    static final String ALARM = "alarm";
    static final String MORNING = "morning";
    static final String EVENING = "evening";
    static final String TEST = "test";

    static final String ACTION_FIRE = "com.irisbible.app.ALARM_FIRE";
    /** The ringing alarm's Stop button (AlarmReceiver). */
    static final String ACTION_STOP = "com.irisbible.app.ALARM_STOP";
    static final String EXTRA_KIND = "kind";
    static final String EXTRA_AT = "at";
    /** The page link a notification tap opens, read by IrisAlarmsPlugin. */
    static final String EXTRA_OPEN = "irisOpen";

    private static final String PREFS = "irisAlarms";
    private static final String SCHEDULE = "schedule";
    private static final String NEXT = "next_";

    private static final String CHANNEL_ALARM = "alarm";
    private static final String CHANNEL_REMINDERS = "reminders";
    private static final int NOTIFY_ALARM = 101;
    private static final int NOTIFY_DEVOTIONAL = 102;

    /**
     * A ring this late is not shown. Exact alarms are never late; this only
     * catches an inexact one (no exact-timing permission) or a clock that
     * jumped, so a 6:00 alarm can't turn up at lunch.
     */
    private static final long TOO_LATE_MS = 2 * 60 * 60 * 1000L;

    private static final long[] ALARM_BUZZ = { 0, 400, 200, 400, 200, 400 };
    private static final long[] REMINDER_BUZZ = { 0, 200 };

    /**
     * An alarm nobody answers goes quiet after this, as a phone's own clock
     * does, so a phone left at home doesn't ring all day.
     */
    private static final long RING_FOR_MS = 10 * 60 * 1000L;

    private PhoneAlarms() {}

    // ── The saved schedule ──────────────────────────────────────────────────

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static void save(Context context, JSONObject schedule) {
        prefs(context).edit().putString(SCHEDULE, schedule.toString()).apply();
    }

    private static JSONObject load(Context context) {
        try {
            return new JSONObject(prefs(context).getString(SCHEDULE, "{}"));
        } catch (JSONException e) {
            return new JSONObject();
        }
    }

    /** The time zone the times are in: the app's setting, or the phone's own when that is unset. */
    private static TimeZone zone(JSONObject schedule) {
        String id = schedule.optString("timezone", "");
        return id.isEmpty() ? TimeZone.getDefault() : TimeZone.getTimeZone(id);
    }

    /** When the next one of this kind rings, or 0 when none is set. */
    static long next(Context context, String kind) {
        return prefs(context).getLong(NEXT + kind, 0);
    }

    // ── Time math ───────────────────────────────────────────────────────────

    /**
     * The next moment after `after` that the wall clock in `tz` reads `time`
     * ("HH:MM") on one of `days` (0 = Sunday; none listed means every day),
     * or -1 when the time can't be read.
     */
    static long nextAt(String time, JSONArray days, TimeZone tz, long after) {
        String[] parts = time == null ? new String[0] : time.trim().split(":");
        if (parts.length != 2) return -1;
        int hour;
        int minute;
        try {
            hour = Integer.parseInt(parts[0]);
            minute = Integer.parseInt(parts[1]);
        } catch (NumberFormatException e) {
            return -1;
        }
        if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return -1;

        boolean[] on = new boolean[7];
        boolean anyDay = false;
        if (days != null) {
            for (int i = 0; i < days.length(); i++) {
                int day = days.optInt(i, -1);
                if (day >= 0 && day <= 6) {
                    on[day] = true;
                    anyDay = true;
                }
            }
        }

        // Today first, then each of the next seven days, so a weekly alarm
        // that already rang today moves to next week.
        for (int offset = 0; offset <= 7; offset++) {
            Calendar c = Calendar.getInstance(tz);
            c.setTimeInMillis(after);
            c.add(Calendar.DAY_OF_YEAR, offset);
            c.set(Calendar.HOUR_OF_DAY, hour);
            c.set(Calendar.MINUTE, minute);
            c.set(Calendar.SECOND, 0);
            c.set(Calendar.MILLISECOND, 0);
            if (anyDay && !on[c.get(Calendar.DAY_OF_WEEK) - 1]) continue;
            if (c.getTimeInMillis() > after) return c.getTimeInMillis();
        }
        return -1;
    }

    /** When this kind should next ring by the saved schedule, or -1 for not at all. */
    private static long dueAfter(JSONObject schedule, String kind, long after) {
        JSONObject item = schedule.optJSONObject(kind);
        if (item == null || !item.optBoolean("enabled", false)) return -1;
        JSONArray days = ALARM.equals(kind) ? item.optJSONArray("days") : null;
        return nextAt(item.optString("time", ""), days, zone(schedule), after);
    }

    // ── Setting the phone's alarms ──────────────────────────────────────────

    /** Whether Android lets the app ring on the exact minute ("Alarms & reminders"). */
    static boolean canExact(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        AlarmManager alarms = context.getSystemService(AlarmManager.class);
        return alarms != null && alarms.canScheduleExactAlarms();
    }

    /** Sets every kind again from the saved schedule. */
    static void scheduleAll(Context context) {
        JSONObject schedule = load(context);
        long now = System.currentTimeMillis();
        for (String kind : new String[] { ALARM, MORNING, EVENING }) {
            set(context, kind, dueAfter(schedule, kind, now));
        }
        // A test that was waiting is set again too, so a permission change
        // in between moves it to exact timing.
        long test = next(context, TEST);
        if (test > now) set(context, TEST, test);
    }

    private static int requestCode(String kind) {
        switch (kind) {
            case ALARM: return 1;
            case MORNING: return 2;
            case EVENING: return 3;
            default: return 4;
        }
    }

    private static PendingIntent fireIntent(Context context, String kind, long at, int flags) {
        Intent intent = new Intent(context, AlarmReceiver.class)
            .setAction(ACTION_FIRE)
            .putExtra(EXTRA_KIND, kind)
            .putExtra(EXTRA_AT, at);
        return PendingIntent.getBroadcast(context, requestCode(kind), intent, flags | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Sets one kind to ring at `at`, or clears it when `at` is -1. */
    static void set(Context context, String kind, long at) {
        AlarmManager alarms = context.getSystemService(AlarmManager.class);
        if (alarms == null) return;

        if (at <= 0) {
            PendingIntent waiting = fireIntent(context, kind, 0, PendingIntent.FLAG_NO_CREATE);
            if (waiting != null) {
                alarms.cancel(waiting);
                waiting.cancel();
            }
            prefs(context).edit().remove(NEXT + kind).apply();
            return;
        }

        PendingIntent fire = fireIntent(context, kind, at, PendingIntent.FLAG_UPDATE_CURRENT);
        boolean isAlarm = ALARM.equals(kind) || TEST.equals(kind);
        try {
            if (!canExact(context)) {
                // Without the permission Android picks the moment itself and
                // may ring late. The page says so and offers the switch.
                alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, fire);
            } else if (isAlarm) {
                // A real alarm clock: rings through Doze and battery savers,
                // and Android shows it as the phone's next alarm.
                alarms.setAlarmClock(new AlarmManager.AlarmClockInfo(at, openAppIntent(context)), fire);
            } else {
                alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, fire);
            }
        } catch (SecurityException e) {
            // The permission was taken back between the check and the call.
            alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, fire);
        }
        prefs(context).edit().putLong(NEXT + kind, at).apply();
    }

    /** What tapping the next alarm in Android's own clock opens: the app. */
    private static PendingIntent openAppIntent(Context context) {
        Intent intent = new Intent(context, MainActivity.class).setAction(Intent.ACTION_MAIN);
        return PendingIntent.getActivity(context, 10, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    // ── Ringing ─────────────────────────────────────────────────────────────

    /** An alarm went off (AlarmReceiver): show it, then set the next one of its kind. */
    static void fired(Context context, String kind, long at) {
        if (kind == null) return;
        long now = System.currentTimeMillis();
        JSONObject schedule = load(context);

        if (TEST.equals(kind)) {
            prefs(context).edit().remove(NEXT + TEST).apply();
            show(context, TEST);
            return;
        }

        JSONObject item = schedule.optJSONObject(kind);
        boolean stillOn = item != null && item.optBoolean("enabled", false);
        if (stillOn && (at <= 0 || now - at < TOO_LATE_MS)) show(context, kind);

        // From the moment it was due, so a ring a second early or late can't
        // set the same minute again.
        set(context, kind, dueAfter(schedule, kind, Math.max(now, at)));
    }

    /** Whether the app may show notifications at all. */
    static boolean notificationsOn(Context context) {
        return NotificationManagerCompat.from(context).areNotificationsEnabled();
    }

    /** Shows the notification for a kind now, in the words the page sent. */
    static void show(Context context, String kind) {
        if (!notificationsOn(context)) return;
        makeChannels(context);

        JSONObject item = load(context).optJSONObject(kind);
        if (item == null) item = new JSONObject();
        boolean isAlarm = ALARM.equals(kind) || TEST.equals(kind);

        String title = item.optString("title", "irisBible");
        String body = item.optString("body", isAlarm ? "Time to read." : "Your devotional is ready.");
        String open = item.optString("open", isAlarm ? "/?alarm=1" : "/?devo=today");

        Intent tap = new Intent(context, MainActivity.class)
            // One action per kind, so each notification's tap keeps its own link.
            .setAction("com.irisbible.app.OPEN_" + kind)
            .putExtra(EXTRA_OPEN, open)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent onTap = PendingIntent.getActivity(
            context, requestCode(kind), tap, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, isAlarm ? CHANNEL_ALARM : CHANNEL_REMINDERS)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setContentIntent(onTap)
            .setAutoCancel(true)
            .setShowWhen(true)
            .setWhen(System.currentTimeMillis())
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(isAlarm ? NotificationCompat.CATEGORY_ALARM : NotificationCompat.CATEGORY_REMINDER)
            // Android 7 has no channels; these stand in for them there.
            .setPriority(isAlarm ? NotificationCompat.PRIORITY_HIGH : NotificationCompat.PRIORITY_DEFAULT)
            .setVibrate(isAlarm ? ALARM_BUZZ : REMINDER_BUZZ);
        if (isAlarm) {
            builder.setSound(Settings.System.DEFAULT_ALARM_ALERT_URI, AudioManager.STREAM_ALARM)
                .addAction(0, "Stop", stopIntent(context))
                .setTimeoutAfter(RING_FOR_MS);
        } else {
            builder.setDefaults(Notification.DEFAULT_SOUND);
        }

        Notification notification = builder.build();
        if (isAlarm) {
            // Rings and buzzes over and over, like a real alarm clock, until
            // it is tapped (which opens the reading), stopped, swiped away or
            // the notification shade is pulled down, or RING_FOR_MS passes.
            notification.flags |= Notification.FLAG_INSISTENT;
        }

        try {
            // The same id each time, so a missed alarm is replaced rather than
            // piling up, as the web's notification tag does.
            NotificationManagerCompat.from(context).notify(isAlarm ? NOTIFY_ALARM : NOTIFY_DEVOTIONAL, notification);
        } catch (SecurityException e) {
            // Notifications were switched off a moment ago.
        }
    }

    /** The alarm's Stop button: silences it without opening the app. */
    private static PendingIntent stopIntent(Context context) {
        Intent intent = new Intent(context, AlarmReceiver.class).setAction(ACTION_STOP);
        return PendingIntent.getBroadcast(context, 20, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /** Stop was tapped: the ringing alarm goes away, and with it the sound. */
    static void stopRinging(Context context) {
        NotificationManagerCompat.from(context).cancel(NOTIFY_ALARM);
    }

    /**
     * The two notification channels. The alarm uses the phone's alarm sound at
     * alarm volume, which on the web had to be set by hand; reminders use the
     * normal notification sound and buzz once. Each can be changed in the
     * phone's settings, and Android keeps those changes, so this never
     * overrides them.
     */
    private static void makeChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;

        NotificationChannel alarm = new NotificationChannel(CHANNEL_ALARM, "Auto-Read Alarm", NotificationManager.IMPORTANCE_HIGH);
        alarm.setDescription("The alarm that opens your reading");
        Uri alarmSound = Settings.System.DEFAULT_ALARM_ALERT_URI;
        alarm.setSound(alarmSound, new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build());
        alarm.enableVibration(true);
        alarm.setVibrationPattern(ALARM_BUZZ);
        alarm.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        manager.createNotificationChannel(alarm);

        NotificationChannel reminders = new NotificationChannel(CHANNEL_REMINDERS, "Devotional reminders", NotificationManager.IMPORTANCE_DEFAULT);
        reminders.setDescription("Morning and evening devotional reminders");
        reminders.enableVibration(true);
        reminders.setVibrationPattern(REMINDER_BUZZ);
        reminders.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        manager.createNotificationChannel(reminders);
    }

    // ── Taps ────────────────────────────────────────────────────────────────

    /**
     * The link a notification tap carries, taken off the intent so it is
     * handled once. A launch from the recent-apps list re-sends the intent the
     * app was first opened with, so that one is ignored.
     */
    static String takeOpen(Intent intent) {
        if (intent == null || !intent.hasExtra(EXTRA_OPEN)) return null;
        String open = intent.getStringExtra(EXTRA_OPEN);
        intent.removeExtra(EXTRA_OPEN);
        if ((intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return null;
        return open == null || open.isEmpty() ? null : open;
    }
}
