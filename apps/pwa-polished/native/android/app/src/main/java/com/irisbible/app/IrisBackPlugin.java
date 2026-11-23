package com.irisbible.app;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.HashMap;
import java.util.Map;

/**
 * The phone's Back. The page keeps a list of what Back can undo (closing
 * something, walking a crumb); this catches Back only while that list has
 * something in it, and hands each press to the page.
 *
 * The page calls this through src/lib/android/back.ts.
 *
 *  setActive  the list has something in it (on) or is empty (off). Off, Back
 *             isn't caught at all: Android does what it always did, taking the
 *             app to the background (so Read Aloud keeps playing), and on
 *             Android 16 shows its go-home preview while you swipe.
 *  answer     the page's reply to a "back" event: handled, or not (the list
 *             had emptied), in which case Android's own Back runs.
 *
 * A press the page doesn't answer within a second also gets Android's own
 * Back, so a page that is stuck or still loading can never trap you.
 */
@CapacitorPlugin(name = "IrisBack")
public class IrisBackPlugin extends Plugin {

    private static final long ANSWER_MS = 1000;

    private final Handler ui = new Handler(Looper.getMainLooper());
    /** Presses sent to the page and not yet answered, each with its timeout. */
    private final Map<Integer, Runnable> waiting = new HashMap<>();
    private OnBackPressedCallback callback;
    private boolean active;
    private int nextId;

    @Override
    public void load() {
        ui.post(() -> {
            Activity activity = getActivity();
            if (!(activity instanceof AppCompatActivity)) return;
            callback = new OnBackPressedCallback(active) {
                @Override
                public void handleOnBackPressed() {
                    onBack();
                }
            };
            AppCompatActivity app = (AppCompatActivity) activity;
            app.getOnBackPressedDispatcher().addCallback(app, callback);
        });
    }

    @PluginMethod
    public void setActive(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        ui.post(() -> {
            active = on;
            if (callback != null) callback.setEnabled(on);
        });
        call.resolve();
    }

    @PluginMethod
    public void answer(PluginCall call) {
        int id = call.getInt("id", -1);
        boolean handled = Boolean.TRUE.equals(call.getBoolean("handled", false));
        ui.post(() -> {
            Runnable late = waiting.remove(id);
            if (late == null) return; // already timed out, and Android has had it
            ui.removeCallbacks(late);
            if (!handled) leave();
        });
        call.resolve();
    }

    private void onBack() {
        int id = ++nextId;
        Runnable late = () -> {
            if (waiting.remove(id) != null) leave();
        };
        waiting.put(id, late);
        JSObject data = new JSObject();
        data.put("id", id);
        notifyListeners("back", data);
        ui.postDelayed(late, ANSWER_MS);
    }

    /** Android's own Back, as if this weren't here: out of the app, to the background. */
    private void leave() {
        Activity activity = getActivity();
        if (!(activity instanceof AppCompatActivity) || activity.isFinishing() || activity.isDestroyed()) return;
        if (callback != null) callback.setEnabled(false);
        ((AppCompatActivity) activity).getOnBackPressedDispatcher().onBackPressed();
        if (callback != null) callback.setEnabled(active);
    }

    @Override
    protected void handleOnDestroy() {
        for (Runnable late : waiting.values()) ui.removeCallbacks(late);
        waiting.clear();
    }
}
