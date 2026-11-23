package com.irisbible.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.Icon;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Log;
import androidx.core.content.ContextCompat;

/**
 * Read Aloud as a media player Android knows about.
 *
 * The speech itself is made and played by the page. What the page can't do
 * from inside a web view is stop Android from putting the app to sleep once
 * the screen is off: a hidden app without a foreground service is soon frozen
 * or closed, mid-chapter. This service is that foreground service. While Read
 * Aloud is going it:
 *
 *  - keeps the app running, with the ongoing "Read Aloud" notification
 *    Android requires for it,
 *  - keeps the processor awake while speech is playing or being made, so the
 *    next verses are ready when the current ones run out,
 *  - shows what is being read on the lock screen and in the notification
 *    shade, with play, pause, back, next and stop (headset and car buttons
 *    reach the same controls),
 *  - pauses when headphones are unplugged, as other players do.
 *
 * The page tells IrisMediaPlugin what is playing; the plugin passes it here
 * with update(). Buttons travel back the same way, through the listener.
 * Everything here runs on the main thread.
 */
public class ReadAloudService extends Service {

    private static final String TAG = "IrisReadAloud";
    private static final String CHANNEL = "read_aloud";
    private static final int NOTIFICATION_ID = 4101;
    /** Notification buttons arrive as start commands named with this prefix. */
    private static final String BUTTON = "readAloud.";
    /** Every update while playing renews this, so it only matters if the page goes quiet. */
    private static final long WAKE_TIMEOUT_MS = 6L * 60 * 60 * 1000;

    static final String PLAYING = "playing";
    static final String BUFFERING = "buffering";
    static final String PAUSED = "paused";
    static final String NONE = "none";

    /** What the page last said is being read. */
    static final class NowPlaying {
        String state = NONE;
        String title = "";
        String subtitle = "";
        String album = "";
        /** Seconds; 0 while unknown. */
        double duration;
        /** Seconds into the chapter (or the text being read). */
        double position;
        /** How fast the position moves while playing (the Read Aloud speed). */
        float speed = 1f;

        /** Speech is playing, or being made before it can start. */
        boolean busy() {
            return PLAYING.equals(state) || BUFFERING.equals(state);
        }
    }

    /** Where the buttons go: the plugin, which hands them to the page. */
    interface Listener {
        void onAction(String action);
    }

    static Listener listener;
    private static NowPlaying latest = new NowPlaying();
    private static ReadAloudService running;
    private static boolean starting;

    /** Read Aloud is speaking, or making speech to start. FrontScreen holds off its jump meanwhile. */
    static boolean speaking() {
        return latest.busy();
    }

    /** The page's latest word on what is playing. "none" ends it all. */
    static void update(Context context, NowPlaying now) {
        latest = now;
        if (NONE.equals(now.state)) {
            if (running != null) running.finish();
            return;
        }
        if (running != null && running.foreground) {
            running.render();
            return;
        }
        // onStartCommand shows whatever is latest by the time it runs.
        if (starting) return;
        starting = true;
        try {
            ContextCompat.startForegroundService(context, new Intent(context, ReadAloudService.class));
        } catch (RuntimeException e) {
            // Android 12 and later refuse while the app is in the background.
            // Read Aloud always starts from a tap in the app, so this would be
            // a resume from somewhere unexpected; it plays on, unguarded.
            starting = false;
            Log.w(TAG, "Read Aloud could not start its service", e);
        }
    }

    private MediaSession session;
    private PowerManager.WakeLock cpu;
    private boolean foreground;
    private boolean watchingUnplug;
    private Bitmap art;
    /** What the session's metadata was last built from; rebuilding it makes the controls flicker. */
    private String shownMetadata;

    private final BroadcastReceiver unplugged = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction())) send("pause");
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        running = this;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "Read Aloud", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("What Read Aloud is reading, with its controls");
            channel.setShowBadge(false);
            getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }

        session = new MediaSession(this, "irisBible Read Aloud");
        session.setCallback(new MediaSession.Callback() {
            @Override
            public void onPlay() {
                send("play");
            }

            @Override
            public void onPause() {
                send("pause");
            }

            @Override
            public void onSkipToNext() {
                send("next");
            }

            @Override
            public void onSkipToPrevious() {
                send("previous");
            }

            @Override
            public void onStop() {
                send("stop");
            }

            @Override
            public void onCustomAction(String action, Bundle extras) {
                if ("stop".equals(action)) send("stop");
            }
        });
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            // Android 8 and later always do this; 7 has to be asked.
            setOldSessionFlags();
        }
        PendingIntent open = openApp();
        if (open != null) session.setSessionActivity(open);
        session.setActive(true);

        cpu = getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "irisBible:ReadAloud");
        cpu.setReferenceCounted(false);
    }

    @SuppressWarnings("deprecation")
    private void setOldSessionFlags() {
        session.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS | MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (action != null && action.startsWith(BUTTON)) {
            // A button in the notification (Android 12 and older draw their own).
            send(action.substring(BUTTON.length()));
            if (!foreground) stopSelf();
            return START_NOT_STICKY;
        }

        starting = false;
        if (!foreground) {
            try {
                Notification notification = buildNotification();
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
                } else {
                    startForeground(NOTIFICATION_ID, notification);
                }
                foreground = true;
            } catch (RuntimeException e) {
                Log.w(TAG, "Read Aloud could not go to the foreground", e);
                stopSelf();
                return START_NOT_STICKY;
            }
        }
        // Reading may have stopped while Android was starting this.
        if (NONE.equals(latest.state)) finish();
        else render();
        return START_NOT_STICKY;
    }

    /** The user swiped irisBible away: the page, and its speech, are gone. */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        finish();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        letGo();
        session.release();
        if (running == this) running = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    /** A control was pressed. With no page left to hear it, there is nothing to control. */
    private void send(String action) {
        if (listener != null) listener.onAction(action);
        else finish();
    }

    /** Puts the latest state on the lock screen and in the notification. */
    private void render() {
        NowPlaying now = latest;

        long durationMs = Math.round(now.duration * 1000);
        String metadataKey = now.title + "\n" + now.subtitle + "\n" + now.album + "\n" + durationMs;
        if (!metadataKey.equals(shownMetadata)) {
            shownMetadata = metadataKey;
            MediaMetadata.Builder metadata = new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, now.title)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, now.subtitle)
                .putString(MediaMetadata.METADATA_KEY_ALBUM, now.album)
                .putBitmap(MediaMetadata.METADATA_KEY_ART, art());
            // Without a length the lock screen leaves the progress bar out.
            if (durationMs > 0) metadata.putLong(MediaMetadata.METADATA_KEY_DURATION, durationMs);
            session.setMetadata(metadata.build());
        }

        int state = PLAYING.equals(now.state)
            ? PlaybackState.STATE_PLAYING
            : BUFFERING.equals(now.state) ? PlaybackState.STATE_BUFFERING : PlaybackState.STATE_PAUSED;
        session.setPlaybackState(
            new PlaybackState.Builder()
                .setActions(
                    PlaybackState.ACTION_PLAY |
                    PlaybackState.ACTION_PAUSE |
                    PlaybackState.ACTION_PLAY_PAUSE |
                    PlaybackState.ACTION_SKIP_TO_NEXT |
                    PlaybackState.ACTION_SKIP_TO_PREVIOUS |
                    PlaybackState.ACTION_STOP
                )
                // Android moves the progress bar along by itself from here.
                .setState(state, Math.round(now.position * 1000), PLAYING.equals(now.state) ? now.speed : 0f, SystemClock.elapsedRealtime())
                // Newer Androids draw play, pause, back and next themselves but
                // only show a stop button when it is offered like this.
                .addCustomAction(new PlaybackState.CustomAction.Builder("stop", "Stop", R.drawable.ic_read_aloud_stop).build())
                .build()
        );

        getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, buildNotification());

        if (now.busy()) {
            cpu.acquire(WAKE_TIMEOUT_MS);
            if (!watchingUnplug) {
                ContextCompat.registerReceiver(
                    this,
                    unplugged,
                    new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY),
                    ContextCompat.RECEIVER_NOT_EXPORTED
                );
                watchingUnplug = true;
            }
        } else {
            letGo();
        }
    }

    private Notification buildNotification() {
        NowPlaying now = latest;
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL)
            : newOldBuilder();
        builder
            .setSmallIcon(R.drawable.ic_read_aloud)
            .setLargeIcon(art())
            .setContentTitle(now.title.isEmpty() ? "Read Aloud" : now.title)
            .setContentText(now.subtitle)
            .setCategory(Notification.CATEGORY_TRANSPORT)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setShowWhen(false)
            .setOnlyAlertOnce(true)
            .addAction(button(android.R.drawable.ic_media_previous, "Back", "previous"))
            .addAction(
                now.busy()
                    ? button(android.R.drawable.ic_media_pause, "Pause", "pause")
                    : button(android.R.drawable.ic_media_play, "Play", "play")
            )
            .addAction(button(android.R.drawable.ic_media_next, "Next", "next"))
            .addAction(button(R.drawable.ic_read_aloud_stop, "Stop", "stop"))
            .setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0, 1, 2));
        PendingIntent open = openApp();
        if (open != null) builder.setContentIntent(open);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        }
        return builder.build();
    }

    @SuppressWarnings("deprecation")
    private Notification.Builder newOldBuilder() {
        return new Notification.Builder(this);
    }

    private Notification.Action button(int icon, String label, String action) {
        Intent intent = new Intent(this, ReadAloudService.class).setAction(BUTTON + action);
        PendingIntent pending = PendingIntent.getService(
            this,
            action.hashCode(),
            intent,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );
        return new Notification.Action.Builder(Icon.createWithResource(this, icon), label, pending).build();
    }

    /** Tapping the notification brings the app back as it was. */
    private PendingIntent openApp() {
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (launch == null) return null;
        return PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /** The app's icon, for the lock screen and the notification. */
    private Bitmap art() {
        if (art == null) {
            int size = 256;
            Drawable icon = getApplicationInfo().loadIcon(getPackageManager());
            art = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
            icon.setBounds(0, 0, size, size);
            icon.draw(new Canvas(art));
        }
        return art;
    }

    /** Nothing playing: the processor may sleep and an unplug means nothing. */
    private void letGo() {
        if (cpu != null && cpu.isHeld()) cpu.release();
        if (watchingUnplug) {
            unregisterReceiver(unplugged);
            watchingUnplug = false;
        }
    }

    /** Reading is over: notification, lock-screen controls and the service all go. */
    private void finish() {
        letGo();
        if (foreground) {
            stopForeground(STOP_FOREGROUND_REMOVE);
            foreground = false;
        }
        stopSelf();
    }
}
