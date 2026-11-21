package com.irisbible.app;

import android.app.DownloadManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

/**
 * Hears Android's downloader about the update IrisUpdatePlugin started.
 *
 *  Finished   with the app off screen, shows "Update ready", which opens the
 *             app; the page then offers Install. On screen, the page shows it.
 *  Tapped     the download's own progress notification opens the app.
 *
 * Both broadcasts can only come from Android itself (they are protected), so
 * the receiver has to be exported for the downloader to reach it.
 */
public class UpdateReceiver extends BroadcastReceiver {

    static final int NOTIFY_READY = 3001;
    private static final String CHANNEL = "updates";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
        long ours = IrisUpdatePlugin.prefs(context).getLong(IrisUpdatePlugin.ID, -2);

        if (DownloadManager.ACTION_NOTIFICATION_CLICKED.equals(action)) {
            try {
                context.startActivity(openApp(context));
            } catch (Exception ignored) {
                // Android may refuse to open an app from the background.
            }
            return;
        }
        if (!DownloadManager.ACTION_DOWNLOAD_COMPLETE.equals(action) || id != ours) return;
        if (IrisUpdatePlugin.onScreen) return;
        if (!"ready".equals(IrisUpdatePlugin.statusOf(context).getString("state"))) return;
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return;

        makeChannel(context);
        String name = IrisUpdatePlugin.prefs(context).getString(IrisUpdatePlugin.NAME, "");
        PendingIntent onTap = PendingIntent.getActivity(
            context, 30, openApp(context), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("irisBible update ready")
            .setContentText("Tap to install version " + name + ".")
            .setContentIntent(onTap)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_LOW);
        try {
            NotificationManagerCompat.from(context).notify(NOTIFY_READY, builder.build());
        } catch (SecurityException ignored) {
            // Notifications were switched off a moment ago.
        }
    }

    /** Opening the app takes the "ready" notification away; the page has it now. */
    static void clearReady(Context context) {
        NotificationManagerCompat.from(context).cancel(NOTIFY_READY);
    }

    private static Intent openApp(Context context) {
        return new Intent(context, MainActivity.class)
            .setAction(Intent.ACTION_MAIN)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    }

    /** Quiet: a finished update can wait until the person looks. */
    private static void makeChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        manager.createNotificationChannel(new NotificationChannel(CHANNEL, "App updates", NotificationManager.IMPORTANCE_LOW));
    }
}
