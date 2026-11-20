package com.irisbible.app;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;

/**
 * Sharing and saving files, which the web view inside the app cannot do by
 * itself: it has no share sheet (navigator.share) and ignores downloads.
 *
 * The page calls this through src/lib/android/files.ts. File contents arrive
 * as base64 text, the only way the bridge carries bytes.
 *
 *  share  opens Android's share sheet with some text or one file.
 *  save   puts a picture straight into Pictures/irisBible (where the gallery
 *         finds it), and asks where anything else should go with Android's
 *         own "Save to" screen, which also offers Drive.
 */
@CapacitorPlugin(name = "IrisFiles")
public class IrisFilesPlugin extends Plugin {

    /** Sent back by the share sheet when the person picks an app. */
    private static final String PICKED = "com.irisbible.app.SHARE_PICKED";

    private BroadcastReceiver pickedReceiver;
    private boolean picked = false;
    private boolean stopped = false;
    private boolean presenting = false;

    @Override
    public void load() {
        pickedReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                picked = true;
            }
        };
        ContextCompat.registerReceiver(getContext(), pickedReceiver, new IntentFilter(PICKED), ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    @Override
    protected void handleOnDestroy() {
        if (pickedReceiver != null) {
            try {
                getContext().unregisterReceiver(pickedReceiver);
            } catch (IllegalArgumentException ignored) {
                // Already gone.
            }
            pickedReceiver = null;
        }
    }

    @Override
    protected void handleOnStop() {
        super.handleOnStop();
        // The app the person picked has opened over this one.
        stopped = true;
    }

    // ── Share ────────────────────────────────────────────────────────────────

    @PluginMethod
    public void share(PluginCall call) {
        if (presenting) {
            call.reject("The share sheet is already open.");
            return;
        }
        String text = call.getString("text");
        String data = call.getString("data");
        Intent send = new Intent(Intent.ACTION_SEND);

        if (data != null) {
            String name = safeName(call.getString("name"));
            String mime = call.getString("mimeType", "application/octet-stream");
            File file;
            try {
                file = writeShareFile(name, Base64.decode(data, Base64.DEFAULT));
            } catch (IOException | IllegalArgumentException e) {
                call.reject("Couldn't get the file ready to share: " + e.getMessage());
                return;
            }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            send.setType(mime);
            send.putExtra(Intent.EXTRA_STREAM, uri);
            // The clip lets the share sheet show a preview and passes the read permission on.
            send.setClipData(ClipData.newRawUri(name, uri));
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } else if (text != null) {
            send.setType("text/plain");
            send.putExtra(Intent.EXTRA_TEXT, text);
        } else {
            call.reject("There was nothing to share.");
            return;
        }

        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // The share sheet writes the picked app into it, so it must stay changeable.
            flags |= PendingIntent.FLAG_MUTABLE;
        }
        Intent pickedIntent = new Intent(PICKED).setPackage(getContext().getPackageName());
        PendingIntent onPicked = PendingIntent.getBroadcast(getContext(), 0, pickedIntent, flags);
        Intent chooser = Intent.createChooser(send, null, onPicked.getIntentSender());

        picked = false;
        stopped = false;
        presenting = true;
        startActivityForResult(call, chooser, "shareDone");
    }

    @ActivityCallback
    private void shareDone(PluginCall call, ActivityResult result) {
        presenting = false;
        if (call == null) return; // the app was closed while the sheet was open
        // The sheet itself reports "cancelled" even after a pick, so a pick
        // counts when it was reported or when the picked app covered this one.
        JSObject answer = new JSObject();
        answer.put("shared", picked || stopped || result.getResultCode() == Activity.RESULT_OK);
        call.resolve(answer);
    }

    /** Only the newest shared file is kept, in the app's own cache. */
    private File writeShareFile(String name, byte[] bytes) throws IOException {
        File dir = new File(getContext().getCacheDir(), "shared");
        File[] old = dir.listFiles();
        if (old != null) {
            for (File f : old) {
                //noinspection ResultOfMethodCallIgnored
                f.delete();
            }
        }
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("no room in the app's cache");
        File file = new File(dir, name);
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(bytes);
        }
        return file;
    }

    // ── Save ─────────────────────────────────────────────────────────────────

    @PluginMethod
    public void save(PluginCall call) {
        String data = call.getString("data");
        if (data == null) {
            call.reject("There was nothing to save.");
            return;
        }
        String name = safeName(call.getString("name"));
        String mime = call.getString("mimeType", "application/octet-stream");

        // Pictures on Android 10 and up go straight to the gallery, with no
        // permission needed. Older phones get the "Save to" screen instead.
        if (mime.startsWith("image/") && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            getBridge().execute(() -> {
                try {
                    saveToPictures(name, mime, Base64.decode(data, Base64.DEFAULT));
                    JSObject answer = new JSObject();
                    answer.put("saved", true);
                    answer.put("where", "pictures");
                    call.resolve(answer);
                } catch (IOException | IllegalArgumentException e) {
                    call.reject("Couldn't save the picture: " + e.getMessage());
                }
            });
            return;
        }

        Intent pick = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        pick.addCategory(Intent.CATEGORY_OPENABLE);
        pick.setType(mime);
        pick.putExtra(Intent.EXTRA_TITLE, name);
        startActivityForResult(call, pick, "saveDone");
    }

    @ActivityCallback
    private void saveDone(PluginCall call, ActivityResult result) {
        if (call == null) return; // the app was closed while "Save to" was open
        Intent back = result.getData();
        Uri uri = back != null ? back.getData() : null;
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            JSObject answer = new JSObject();
            answer.put("saved", false);
            call.resolve(answer);
            return;
        }
        String data = call.getString("data");
        getBridge().execute(() -> {
            try (OutputStream out = getContext().getContentResolver().openOutputStream(uri)) {
                if (out == null) throw new IOException("the place picked can't be written to");
                out.write(Base64.decode(data, Base64.DEFAULT));
                JSObject answer = new JSObject();
                answer.put("saved", true);
                answer.put("where", "file");
                call.resolve(answer);
            } catch (IOException | IllegalArgumentException | SecurityException e) {
                call.reject("Couldn't save the file: " + e.getMessage());
            }
        });
    }

    private void saveToPictures(String name, String mime, byte[] bytes) throws IOException {
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
        values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/irisBible");
        // Hidden from the gallery until it is fully written.
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);
        Uri uri = resolver.insert(MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), values);
        if (uri == null) throw new IOException("the phone wouldn't make the picture file");
        try (OutputStream out = resolver.openOutputStream(uri)) {
            if (out == null) throw new IOException("the picture file can't be written to");
            out.write(bytes);
        } catch (IOException e) {
            resolver.delete(uri, null, null);
            throw e;
        }
        values.clear();
        values.put(MediaStore.MediaColumns.IS_PENDING, 0);
        resolver.update(uri, values, null, null);
    }

    /** A file name every app and folder will take. */
    private static String safeName(String name) {
        String clean = name == null ? "" : name.replaceAll("[\\\\/:*?\"<>|\\x00-\\x1f]+", "-").trim();
        return clean.isEmpty() ? "irisBible" : clean;
    }
}
