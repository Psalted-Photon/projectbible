package com.irisbible.app;

import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.database.Cursor;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Build;
import android.os.StatFs;
import android.provider.Settings;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;

/**
 * Updating the APK downloaded from irisbible.com, from inside the app. Only
 * this build has it (src/sideload); the Play Store updates its own build.
 *
 * The page reads irisbible.com/android/version.json, and when a newer version
 * is out it calls this through src/lib/android/appUpdate.ts:
 *
 *  network       online, and whether the connection is metered (mobile data),
 *                so the page can ask before a big download on a data plan.
 *  start         downloads the new APK with Android's own downloader, which
 *                carries on with the app closed, shows its progress in the
 *                notification shade and picks up after a dropped connection.
 *                It goes into the app's own folder, so no storage permission.
 *  status        how that download is doing: none, running, paused (waiting
 *                for Wi-Fi or a connection), ready, or failed and why (its
 *                space is freed at once; the reason stays until cancel or a
 *                new start). A download the app has since been updated past
 *                is cleaned up.
 *  install       hands the finished APK to Android's installer, which asks
 *                the person to confirm. Android checks it carries the same
 *                signing key as this app before it will install it over it.
 *                Says needsPermission instead when irisBible may not install
 *                apps yet ("Install unknown apps").
 *  allowInstalls opens that switch for irisBible in the phone's settings.
 *  cancel        stops the download and deletes what it saved.
 */
@CapacitorPlugin(name = "IrisUpdate")
public class IrisUpdatePlugin extends Plugin {

    static final String PREFS = "irisUpdate";
    static final String ID = "id";
    static final String CODE = "code";
    static final String NAME = "name";
    static final String BYTES = "bytes";
    static final String FILE = "file";
    static final String FAILED = "failed";
    private static final String FOLDER = "updates";
    private static final String APK_TYPE = "application/vnd.android.package-archive";

    /** Room left over after the download and the installer's own copy of it. */
    private static final long SPARE_BYTES = 300L * 1024 * 1024;

    /** True while the app is on screen, when the page shows "ready" itself. */
    static volatile boolean onScreen = false;

    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    @Override
    protected void handleOnResume() {
        onScreen = true;
        UpdateReceiver.clearReady(getContext());
    }

    @Override
    protected void handleOnPause() {
        onScreen = false;
    }

    @PluginMethod
    public void network(PluginCall call) {
        ConnectivityManager connectivity = getContext().getSystemService(ConnectivityManager.class);
        boolean online = false;
        boolean metered = false;
        if (connectivity != null) {
            NetworkCapabilities caps = connectivity.getNetworkCapabilities(connectivity.getActiveNetwork());
            online = caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
            metered = connectivity.isActiveNetworkMetered();
        }
        JSObject result = new JSObject();
        result.put("online", online);
        result.put("metered", metered);
        call.resolve(result);
    }

    @PluginMethod
    public void start(PluginCall call) {
        String url = call.getString("url");
        String name = call.getString("versionName", "");
        // optLong: the bridge hands small numbers over as Integer, which
        // PluginCall.getLong turns down.
        long code = call.getData().optLong("versionCode", 0);
        long bytes = call.getData().optLong("bytes", 0);
        boolean allowMetered = Boolean.TRUE.equals(call.getBoolean("allowMetered", true));
        if (url == null || !url.startsWith("https://") || code <= 0) {
            call.reject("That update link isn't right.", "bad-link");
            return;
        }

        Context context = getContext();
        File folder = context.getExternalFilesDir(FOLDER);
        if (folder == null) {
            call.reject("The phone's storage isn't available right now.", "file");
            return;
        }
        // One update at a time: drop any earlier download and its file.
        forget(context);

        // The download, then the installer's copy of it, then some room to work.
        long free = new StatFs(folder.getPath()).getAvailableBytes();
        long needed = bytes * 2 + SPARE_BYTES;
        if (bytes > 0 && free < needed) {
            JSObject data = new JSObject();
            data.put("needed", needed);
            data.put("free", free);
            call.reject("Not enough space on this phone.", "space", data);
            return;
        }

        String fileName = "irisBible-" + name.replaceAll("[^0-9A-Za-z.\\-]", "") + ".apk";
        File target = new File(folder, fileName);
        if (target.exists()) target.delete();

        DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url))
            .setTitle("irisBible update")
            .setDescription("Version " + name)
            .setMimeType(APK_TYPE)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
            .setDestinationInExternalFilesDir(context, FOLDER, fileName)
            .setAllowedOverMetered(allowMetered)
            .setAllowedOverRoaming(false);

        DownloadManager downloads = context.getSystemService(DownloadManager.class);
        if (downloads == null) {
            call.reject("This phone's downloader isn't available.", "file");
            return;
        }
        long id;
        try {
            id = downloads.enqueue(request);
        } catch (Exception error) {
            call.reject("The download couldn't start.", "file");
            return;
        }
        prefs(context).edit()
            .putLong(ID, id)
            .putLong(CODE, code)
            .putString(NAME, name)
            .putLong(BYTES, bytes)
            .putString(FILE, target.getAbsolutePath())
            .apply();
        call.resolve();
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(statusOf(getContext()));
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        forget(getContext());
        call.resolve();
    }

    @PluginMethod
    public void install(PluginCall call) {
        Context context = getContext();
        JSObject status = statusOf(context);
        if (!"ready".equals(status.getString("state"))) {
            call.reject("The update isn't ready yet.", "not-ready");
            return;
        }
        JSObject result = new JSObject();
        if (!installsAllowed(context)) {
            result.put("needsPermission", true);
            call.resolve(result);
            return;
        }
        File apk = new File(prefs(context).getString(FILE, ""));
        Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", apk);
        Intent intent = new Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, APK_TYPE)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getActivity().startActivity(intent);
        } catch (Exception error) {
            call.reject("Android's installer didn't open.", "installer");
            return;
        }
        result.put("started", true);
        call.resolve(result);
    }

    @PluginMethod
    public void allowInstalls(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            call.resolve();
            return;
        }
        Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception error) {
            call.reject("The setting didn't open.", "settings");
        }
    }

    // ── Helpers, shared with UpdateReceiver ─────────────────────────────────

    /** Android 8 and later ask once whether the app may install apps. */
    static boolean installsAllowed(Context context) {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context.getPackageManager().canRequestPackageInstalls();
    }

    static long installedCode(Context context) {
        try {
            PackageInfo pkg = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? pkg.getLongVersionCode() : pkg.versionCode;
        } catch (Exception error) {
            return 0;
        }
    }

    /** The saved download, as the page reads it. */
    static JSObject statusOf(Context context) {
        SharedPreferences prefs = prefs(context);
        JSObject result = new JSObject();
        result.put("installAllowed", installsAllowed(context));
        long id = prefs.getLong(ID, -1);
        long code = prefs.getLong(CODE, 0);
        if (code <= 0) {
            result.put("state", "none");
            return result;
        }
        // The app has been updated to this version or past it: tidy up.
        if (code <= installedCode(context)) {
            forget(context);
            result.put("state", "none");
            return result;
        }
        result.put("versionCode", code);
        result.put("versionName", prefs.getString(NAME, ""));
        long expected = prefs.getLong(BYTES, 0);

        // A failed download's space is given back at once (failed() below);
        // why it failed is kept until the page clears it or tries again.
        String failedBecause = prefs.getString(FAILED, null);
        if (failedBecause != null || id < 0) {
            result.put("state", "failed");
            result.put("reason", failedBecause != null ? failedBecause : "network");
            return result;
        }

        DownloadManager downloads = context.getSystemService(DownloadManager.class);
        Cursor cursor = downloads == null ? null : downloads.query(new DownloadManager.Query().setFilterById(id));
        if (cursor == null || !cursor.moveToFirst()) {
            if (cursor != null) cursor.close();
            // Cleared from the phone's downloads list.
            failed(context, "network");
            result.put("state", "failed");
            result.put("reason", "network");
            return result;
        }
        int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
        int reason = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON));
        long done = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
        long total = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
        cursor.close();
        result.put("downloaded", done);
        result.put("total", total > 0 ? total : expected);

        switch (status) {
            case DownloadManager.STATUS_SUCCESSFUL: {
                File apk = new File(prefs.getString(FILE, ""));
                if (!apk.exists() || (expected > 0 && apk.length() != expected)) {
                    failed(context, "damaged");
                    result.put("state", "failed");
                    result.put("reason", "damaged");
                } else {
                    result.put("state", "ready");
                }
                break;
            }
            case DownloadManager.STATUS_FAILED: {
                String why = failure(reason);
                failed(context, why);
                result.put("state", "failed");
                result.put("reason", why);
                break;
            }
            case DownloadManager.STATUS_PAUSED:
                result.put("state", "paused");
                result.put("reason", reason == DownloadManager.PAUSED_QUEUED_FOR_WIFI
                    ? "wifi"
                    : reason == DownloadManager.PAUSED_WAITING_FOR_NETWORK ? "network" : "retrying");
                break;
            default:
                result.put("state", "running");
        }
        return result;
    }

    private static String failure(int reason) {
        if (reason == DownloadManager.ERROR_INSUFFICIENT_SPACE) return "space";
        if (reason == 404 || reason == 410) return "missing";
        if (reason == DownloadManager.ERROR_FILE_ERROR || reason == DownloadManager.ERROR_DEVICE_NOT_FOUND) return "file";
        return "network";
    }

    /** Drops the saved download: stops it, deletes its file, clears the note of it. */
    static void forget(Context context) {
        removeDownload(context);
        prefs(context).edit().clear().apply();
        NotificationManagerCompat.from(context).cancel(UpdateReceiver.NOTIFY_READY);
    }

    /** A download that won't finish: its space back now, the reason kept. */
    private static void failed(Context context, String why) {
        removeDownload(context);
        prefs(context).edit().putLong(ID, -1).putString(FAILED, why).apply();
    }

    private static void removeDownload(Context context) {
        long id = prefs(context).getLong(ID, -1);
        DownloadManager downloads = context.getSystemService(DownloadManager.class);
        if (id >= 0 && downloads != null) {
            try {
                downloads.remove(id);
            } catch (Exception ignored) {
                // Already gone.
            }
        }
        // Anything else left in the folder, such as a download cut off by a crash.
        File folder = context.getExternalFilesDir(FOLDER);
        File[] leftovers = folder == null ? null : folder.listFiles();
        if (leftovers != null) {
            for (File file : leftovers) file.delete();
        }
    }
}
