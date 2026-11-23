package com.irisbible.app;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.view.WindowManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Which way the screen may turn, and keeping it on. The web view inside the
 * app cannot lock the screen's direction (screen.orientation.lock) or hold a
 * screen wake lock (navigator.wakeLock), so the page asks for both here.
 *
 * The page calls this through src/lib/android/screen.ts.
 *
 *  setOrientation  "portrait" keeps the phone upright, "free" lets it turn
 *                  with the phone (as the installed web app does). With
 *                  remember, it is also saved so the next launch opens the
 *                  same way before the page has loaded.
 *  keepAwake       keeps the screen from timing out while the app is on
 *                  screen. Android lets go by itself whenever the app is
 *                  hidden and takes it back when the app returns.
 *  setFrontScreenJump  the "Jump to the front screen" setting (FrontScreen),
 *                  kept here too because the phone acts on it at the close.
 *  foldable        whether the phone has a hinge, so the setting only shows
 *                  on phones that fold.
 */
@CapacitorPlugin(name = "IrisScreen")
public class IrisScreenPlugin extends Plugin {

    private static final String PREFS = "irisScreen";
    private static final String ORIENTATION = "orientation";
    private static final String FREE = "free";

    /** The direction for a mode. Anything but "free" keeps the phone upright. */
    private static int orientationFor(String mode) {
        return FREE.equals(mode) ? ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR : ActivityInfo.SCREEN_ORIENTATION_PORTRAIT;
    }

    /** Called by MainActivity at launch. Upright until the page has said otherwise. */
    static void applySavedOrientation(Activity activity) {
        SharedPreferences prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        activity.setRequestedOrientation(orientationFor(prefs.getString(ORIENTATION, "portrait")));
    }

    @PluginMethod
    public void setOrientation(PluginCall call) {
        String mode = call.getString("mode", "portrait");
        boolean remember = Boolean.TRUE.equals(call.getBoolean("remember", false));
        if (remember) {
            getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(ORIENTATION, mode).apply();
        }
        getBridge().executeOnMainThread(() -> {
            getActivity().setRequestedOrientation(orientationFor(mode));
            call.resolve();
        });
    }

    /**
     * Settings → General → "Jump to the front screen" (FrontScreen). The phone
     * keeps its own copy, because it acts on it when you close the phone.
     */
    @PluginMethod
    public void setFrontScreenJump(PluginCall call) {
        boolean on = !Boolean.FALSE.equals(call.getBoolean("on", true));
        FrontScreen.setOn(getContext(), on);
        getBridge().executeOnMainThread(() -> {
            if (on) FrontScreen.watchHinge(getActivity());
            else FrontScreen.stopWatching();
            call.resolve();
        });
    }

    /** Whether the phone folds, so the front screen switch only shows where it means something. */
    @PluginMethod
    public void foldable(PluginCall call) {
        JSObject result = new JSObject();
        result.put("foldable", FrontScreen.foldable(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void keepAwake(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        getBridge().executeOnMainThread(() -> {
            if (on) {
                getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            } else {
                getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            }
            call.resolve();
        });
    }
}
