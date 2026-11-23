package com.irisbible.app;

import android.app.Activity;
import android.app.ActivityOptions;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.hardware.display.DisplayManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Log;
import android.view.Display;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import java.lang.ref.WeakReference;

/**
 * "Jump to the front screen": close a Galaxy Flip while irisBible is open and
 * it carries on on the front screen, the way the Fold does by itself.
 *
 * The Flip can't do that on its own: closing it always puts the phone to
 * sleep, whatever app is open. So the app notices the close itself and asks
 * for a fresh copy of itself on the front screen. It gets there the way an
 * alarm does: a full-screen notification, which Android turns into opening
 * the app straight away while the phone is asleep. The copy that was open
 * closes (Android would only bring it back on the dark inside screen). The
 * new copy opens where you were, through the page's own relaunch handling
 * (lib/resume.ts keeps the line, lib/sessionRestore.ts the panels), with no
 * splash (MainActivity tells public/startup.js).
 *
 * The phone locked itself when it was closed, so the app shows over the lock
 * screen, on the front screen and on the inside screen if you open the phone,
 * until you leave the app or the screen goes dark. A fresh copy starts with
 * the Journal locked, so that never shows journal entries.
 *
 * A close is told apart from pressing the power button by the hinge: the app
 * watches the hinge angle while it is open on the inside screen, and only a
 * screen-off that comes with the hinge shut counts. Phones that carry apps
 * over by themselves (the Fold) never get here, because they stay awake when
 * closed.
 *
 * No jump while Read Aloud is speaking: a fresh copy would cut the reading
 * off. Closing the phone then works as before: the screen goes dark and the
 * reading carries on.
 *
 * On by default; Settings → General → "Jump to the front screen" turns it off
 * (the page tells IrisScreenPlugin). Copied from the same feature in Fork'n
 * Dish, where it was proven on a Flip 5.
 */
final class FrontScreen {
    private static final String TAG = "IrisFrontScreen";
    private static final String PREFS = "irisScreen";
    private static final String KEY_ON = "frontScreenJump";
    private static final String CHANNEL = "front_screen";
    private static final int NOTICE_ID = 4301;
    /** The intent action of a jump launch. */
    static final String ACTION = "com.irisbible.app.FRONT_SCREEN";
    /** On a launch intent: a fresh copy of where you just were, so the page skips its splash. */
    static final String EXTRA_QUIET = "irisQuietStart";

    /** The hinge counts as shut at or below this many degrees. */
    private static final float SHUT_DEGREES = 30f;
    /** A shut hinge older than this doesn't count (the screen went off for another reason). */
    private static final long SHUT_RECENT_MS = 5_000L;
    /** Stops within this long of the close don't end the follow (see stop). */
    private static final long SETTLING_MS = 4_000L;
    /** How long after a stop a fresh copy has to come up for it to count as Samsung moving the app. */
    private static final long LEFT_CHECK_MS = 1_500L;

    /** True from the close until you leave the app or the screen goes dark. */
    private static volatile boolean following;
    private static long startedAt;
    private static long lastResumeAt;
    private static WeakReference<Activity> current;
    private static final Handler main = new Handler(Looper.getMainLooper());

    private static float lastAngle = 180f;
    private static long shutAt;
    private static SensorManager sensors;

    private static final SensorEventListener hinge = new SensorEventListener() {
        @Override
        public void onSensorChanged(SensorEvent e) {
            if (e.values == null || e.values.length == 0) return;
            lastAngle = e.values[0];
            if (lastAngle <= SHUT_DEGREES) shutAt = SystemClock.elapsedRealtime();
        }

        @Override
        public void onAccuracyChanged(Sensor sensor, int accuracy) {}
    };

    private FrontScreen() {}

    static boolean isOn(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_ON, true);
    }

    static void setOn(Context c, boolean on) {
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_ON, on).apply();
    }

    /** Whether this phone folds (has a hinge sensor), so Settings only shows the switch where it means something. */
    static boolean foldable(Context c) {
        return hingeSensor(c) != null;
    }

    private static Sensor hingeSensor(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return null;
        SensorManager sm = c.getSystemService(SensorManager.class);
        if (sm == null) return null;
        Sensor wake = sm.getDefaultSensor(Sensor.TYPE_HINGE_ANGLE, true);
        return wake != null ? wake : sm.getDefaultSensor(Sensor.TYPE_HINGE_ANGLE);
    }

    /** Starts watching the hinge (while the app is open on the inside screen). */
    static void watchHinge(Context c) {
        if (sensors != null || !isOn(c)) return;
        Sensor sensor = hingeSensor(c);
        if (sensor == null) return;
        SensorManager sm = c.getSystemService(SensorManager.class);
        if (sm == null) return;
        lastAngle = 180f;
        shutAt = 0L;
        if (sm.registerListener(hinge, sensor, SensorManager.SENSOR_DELAY_NORMAL)) sensors = sm;
    }

    static void stopWatching() {
        if (sensors != null) sensors.unregisterListener(hinge);
        sensors = null;
    }

    /** The hinge was shut just now: the screen went off because the phone was closed. */
    static boolean justClosed() {
        return sensors != null && lastAngle <= SHUT_DEGREES
            && SystemClock.elapsedRealtime() - shutAt < SHUT_RECENT_MS;
    }

    /**
     * Called a moment after the app stopped on the inside screen with the
     * hinge just shut. If the phone went to sleep (the Flip), asks for a fresh
     * copy of the app on the front screen and returns true: the caller then
     * closes itself. (Bringing back the copy that is open doesn't work:
     * Android puts it back on the dark inside screen.)
     */
    static boolean jump(Activity a) {
        if (!isOn(a) || a.isFinishing() || a.isDestroyed()) return false;
        if (ReadAloudService.speaking()) {
            Log.i(TAG, "closed while Read Aloud is speaking: no jump, the reading carries on");
            return false;
        }
        PowerManager pm = a.getSystemService(PowerManager.class);
        if (pm != null && pm.isInteractive()) {
            Log.i(TAG, "closed, and the phone stayed awake: it carries the app over itself");
            return false;
        }
        NotificationManagerCompat nm = NotificationManagerCompat.from(a);
        if (!nm.areNotificationsEnabled()) {
            Log.w(TAG, "closed, but notifications are off, so the app can't open itself on the front screen");
            return false;
        }
        following = true;
        startedAt = SystemClock.elapsedRealtime();

        Display cover = coverDisplay(a);
        Intent open = new Intent(a, MainActivity.class)
            .setAction(ACTION)
            .putExtra(EXTRA_QUIET, true)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_USER_ACTION);
        Bundle options = null;
        if (cover != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            options = ActivityOptions.makeBasic().setLaunchDisplayId(cover.getDisplayId()).toBundle();
        }
        PendingIntent screen = PendingIntent.getActivity(
            a, NOTICE_ID, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE,
            options
        );
        channel(a);
        NotificationCompat.Builder n = new NotificationCompat.Builder(a, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("irisBible")
            .setContentText("Opening on the front screen")
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setSilent(true)
            .setAutoCancel(true)
            .setTimeoutAfter(8_000)
            .setFullScreenIntent(screen, true)
            .setContentIntent(screen);
        try {
            nm.notify(NOTICE_ID, n.build());
            Log.i(TAG, "closed with the app open: opening it on the front screen (screen "
                + (cover != null ? cover.getDisplayId() + " " + cover.getName() : "?") + ")");
            return true;
        } catch (SecurityException e) {
            following = false;
            Log.w(TAG, "couldn't open on the front screen: " + e.getMessage());
            return false;
        }
    }

    /** The app is up again (anywhere): the notice that brought it has done its job. */
    static void clearNotice(Context c) {
        NotificationManagerCompat.from(c).cancel(NOTICE_ID);
    }

    /** A new or restarted screen while following keeps showing without the lock screen. */
    static void applyIfFollowing(Activity a) {
        if (following) lockFlags(a, true);
    }

    /** The app's screen came up (anywhere). */
    static void resumed(Activity a) {
        lastResumeAt = SystemClock.elapsedRealtime();
        current = new WeakReference<>(a);
    }

    /**
     * The app's screen stopped while following. Samsung moving the app between
     * the two screens stops it too, but then a fresh copy comes up straight
     * away; if none does within a moment, you left the app or the screen went
     * dark, and the lock screen comes back.
     */
    static void stopped(Activity a, String why) {
        if (!following) return;
        long at = SystemClock.elapsedRealtime();
        main.postDelayed(() -> {
            if (lastResumeAt >= at) return;
            Activity now = current != null ? current.get() : null;
            stop(now != null ? now : a, why);
        }, LEFT_CHECK_MS);
    }

    /** Back to normal: the lock screen covers the app again. */
    static void stop(Activity a, String why) {
        if (!following) return;
        // The first moments on the front screen can stop and start the app
        // once or twice (the lock screen stepping aside); that isn't you leaving.
        if (SystemClock.elapsedRealtime() - startedAt < SETTLING_MS) {
            Log.i(TAG, "front screen follow kept (still settling): " + why);
            return;
        }
        following = false;
        lockFlags(a, false);
        Log.i(TAG, "front screen follow ended: " + why);
    }

    private static void lockFlags(Activity a, boolean on) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            a.setShowWhenLocked(on);
            a.setTurnScreenOn(on);
        }
    }

    /** The front screen: another built-in screen than the main one (on the Flip it is screen 1). */
    static Display coverDisplay(Context c) {
        DisplayManager dm = c.getApplicationContext().getSystemService(DisplayManager.class);
        if (dm == null) return null;
        Display pick = null;
        for (Display d : dm.getDisplays()) {
            if (d.getDisplayId() == Display.DEFAULT_DISPLAY || (d.getFlags() & Display.FLAG_PRIVATE) != 0) continue;
            if (pick == null || d.getDisplayId() < pick.getDisplayId()) pick = d;
        }
        return pick;
    }

    private static void channel(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL, "Front screen", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Opens irisBible on the front screen when you close the phone with it open");
        ch.setSound(null, null);
        ch.enableVibration(false);
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);
    }
}
