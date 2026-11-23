package com.irisbible.app;

import android.app.ActivityOptions;
import android.content.Context;
import android.content.ContextWrapper;
import android.content.Intent;
import android.content.res.Configuration;
import android.hardware.display.DisplayManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Log;
import android.view.Display;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebView;
import androidx.annotation.NonNull;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;
import java.util.Collections;

/**
 * The app's one screen. Besides starting the page full screen, it keeps the
 * page right on a Galaxy Flip's front screen (copied from Fork'n Dish, where
 * it was proven on a Flip 5):
 *
 * - Samsung runs the app on the Flip's front screen at the inside screen's
 *   sharpness, shrunk to fit. The web view takes its sharpness from whichever
 *   screen it thinks it is on at the moment it is made, and never looks
 *   again; made "on" the front screen it draws at the wrong size. So it is
 *   always told the screen whose sharpness matches the app's (see
 *   {@link WebViewContext}).
 * - A move between the screens can leave the window tied to the screen that
 *   just switched off, so nothing draws. Spotted once things have settled
 *   ({@link #checkScreen}) and fixed by swapping in a fresh screen with a new
 *   window ({@link #startFresh}); a plain restart keeps the stuck window.
 * - Closing the Flip puts the phone to sleep instead of carrying the app over
 *   to the front screen. {@link FrontScreen} notices the close (by the hinge)
 *   and opens a fresh copy there.
 *
 * A fresh copy reopens where you were through the page's own relaunch
 * handling (lib/resume.ts, lib/sessionRestore.ts), and is told to skip the
 * launch splash ({@link #quietStart}).
 */
public class MainActivity extends BridgeActivity {
    private static final String TAG = "IrisFrontScreen";
    /** Wait this long after a fold, unfold or return before checking the screen. */
    private static final long SETTLE_MS = 700;
    /** At most this many automatic restarts within FIX_WINDOW_MS, so a phone that never settles can't loop. */
    private static final int MAX_FIXES = 2;
    private static final long FIX_WINDOW_MS = 20_000;
    private static final long[] recentFixes = new long[MAX_FIXES];
    /** How long after the app stops with the hinge shut before asking to be opened on the front screen. */
    private static final long FOLLOW_MS = 300;

    private final Handler ui = new Handler(Looper.getMainLooper());
    private final Runnable check = this::checkScreen;
    private final Runnable followCheck = this::followCheck;
    private boolean resumed;
    /** This screen is being replaced by a fresh one, so its stopping means nothing. */
    private boolean replaced;
    private WebViewContext webViewContext;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The app's own plugins, which live in this folder rather than in npm
        // packages, so they must be named here before the bridge starts.
        registerPlugin(IrisFilesPlugin.class);
        registerPlugin(IrisScreenPlugin.class);
        registerPlugin(IrisMediaPlugin.class);
        registerPlugin(IrisAlarmsPlugin.class);
        registerPlugin(IrisFingerprintPlugin.class);
        registerPlugin(IrisAppPlugin.class);
        // Plus those only one build has: the downloaded APK's updater.
        FlavorPlugins.register(this);
        // Open the way the page last asked for, so a phone held sideways at
        // launch doesn't turn the app before the page has loaded.
        IrisScreenPlugin.applySavedOrientation(this);
        super.onCreate(savedInstanceState);
        goFullScreen();
        // Opened on the front screen after a close: shows without the lock screen too.
        FrontScreen.applyIfFollowing(this);
        quietStart();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        if (FrontScreen.ACTION.equals(intent.getAction())) FrontScreen.applyIfFollowing(this);
        super.onNewIntent(intent);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // A dialog or another app can bring the bars back; hide them again.
        if (hasFocus) hideSystemBars();
    }

    /** The bridge's layout (with the web view) is made with {@link WebViewContext}, so the web view gets the right screen. */
    @Override
    public void setContentView(int layoutResID) {
        if (layoutResID == com.getcapacitor.android.R.layout.capacitor_bridge_layout_main) {
            webViewContext = new WebViewContext(this);
            View root = getLayoutInflater().cloneInContext(webViewContext).inflate(layoutResID, null);
            super.setContentView(root);
            return;
        }
        super.setContentView(layoutResID);
    }

    /**
     * Full screen, as the installed web app is (display: fullscreen): no
     * status bar or navigation bar, the page reaching into the camera cutout
     * (it keeps clear of it with safe-area insets), and a swipe from the edge
     * showing the bars over the page for a moment.
     */
    private void goFullScreen() {
        Window window = getWindow();
        WindowCompat.setDecorFitsSystemWindows(window, false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams attrs = window.getAttributes();
            attrs.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            window.setAttributes(attrs);
        }
        WindowCompat.getInsetsController(window, window.getDecorView()).setSystemBarsBehavior(
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        );
        hideSystemBars();
    }

    private void hideSystemBars() {
        Window window = getWindow();
        WindowCompat.getInsetsController(window, window.getDecorView()).hide(WindowInsetsCompat.Type.systemBars());
    }

    // ---------- a fresh copy of where you just were ----------

    /**
     * A front-screen jump or a fresh screen ({@link #startFresh}) is the app
     * carrying on, not a new start, so the page skips its launch splash: a
     * flag set before the page's own scripts run, read by public/startup.js.
     * The page is loaded again so the flag is in place for it (the bridge's
     * own load has only just begun). A relaunch from Recents of such a copy
     * is a real start, and plays the splash.
     */
    private void quietStart() {
        Intent start = getIntent();
        if (bridge == null || start == null || !start.getBooleanExtra(FrontScreen.EXTRA_QUIET, false)) return;
        if ((start.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return;
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return;
        WebView wv = bridge.getWebView();
        String app = bridge.getAppUrl();
        if (wv == null || app == null) return;
        try {
            String origin = Uri.parse(app).buildUpon().path(null).fragment(null).clearQuery().build().toString();
            WebViewCompat.addDocumentStartJavaScript(wv, "window.__irisQuietStart = true;", Collections.singleton(origin));
            wv.loadUrl(app);
        } catch (IllegalArgumentException e) {
            Log.w(TAG, "couldn't tell the page to skip its splash: " + e.getMessage());
        }
    }

    // ---------- keeping the right screen ----------

    @Override
    public void onResume() {
        super.onResume();
        resumed = true;
        scheduleCheck();
        // Front screen jump (FrontScreen): watch the hinge while open on the
        // inside screen. Which screen we're on is told by which screen is lit,
        // not by getDisplay(): on the Flip's front screen Samsung tells the
        // app it is on the inside screen (screen 0). Opening the phone after a
        // jump keeps the app over the lock screen on the inside screen too;
        // the lock screen comes back once you leave the app or the screen
        // goes dark, like on any locked phone.
        ui.removeCallbacks(followCheck);
        FrontScreen.resumed(this);
        FrontScreen.clearNotice(this);
        FrontScreen.applyIfFollowing(this);
        if (mainScreenOn()) FrontScreen.watchHinge(this);
        else FrontScreen.stopWatching();
    }

    @Override
    public void onPause() {
        resumed = false;
        ui.removeCallbacks(check);
        super.onPause();
    }

    @Override
    public void onStop() {
        super.onStop();
        // A restart (fold, unfold, Samsung moving the app), or this screen
        // being swapped for a fresh one: not a real stop.
        if (isChangingConfigurations() || replaced) return;
        if (FrontScreen.justClosed()) {
            // Closed with the app open on the inside screen. A moment later the
            // phone is either asleep (the Flip) or carrying the app over by
            // itself (the Fold); followCheck tells which.
            ui.removeCallbacks(followCheck);
            ui.postDelayed(followCheck, FOLLOW_MS);
        } else {
            FrontScreen.stopWatching();
            FrontScreen.stopped(this, "the screen went dark or you left the app");
        }
    }

    private void followCheck() {
        FrontScreen.stopWatching();
        if (FrontScreen.jump(this)) {
            // The fresh copy that opens on the front screen takes over. This
            // one closes: Android would only bring it back on the dark inside screen.
            replaced = true;
            finish();
        }
    }

    /**
     * Swaps this screen for a fresh one. A plain restart (recreate) keeps the
     * same window, and when Samsung has left that window tied to the dark
     * inside screen, it stays blank. A fresh screen gets a new window from the
     * screen the app is really on.
     */
    private void startFresh(String why) {
        Intent again = new Intent(this, MainActivity.class)
            .setAction(Intent.ACTION_MAIN)
            .putExtra(FrontScreen.EXTRA_QUIET, true)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK | Intent.FLAG_ACTIVITY_NO_ANIMATION);
        Display cover = mainScreenOn() ? null : FrontScreen.coverDisplay(this);
        Bundle options = null;
        if (cover != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            options = ActivityOptions.makeBasic().setLaunchDisplayId(cover.getDisplayId()).toBundle();
        }
        Log.i(TAG, "starting the page fresh" + (cover != null ? " on screen " + cover.getDisplayId() : "") + ": " + why);
        replaced = true;
        startActivity(again, options);
    }

    /** Whether the main (inside) screen is lit. Asked of the phone itself, not of this screen's own view. */
    private boolean mainScreenOn() {
        DisplayManager dm = getApplicationContext().getSystemService(DisplayManager.class);
        Display main = dm != null ? dm.getDisplay(Display.DEFAULT_DISPLAY) : null;
        return main != null && main.getState() == Display.STATE_ON;
    }

    @Override
    public void onConfigurationChanged(@NonNull Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        scheduleCheck();
    }

    @Override
    public void onDestroy() {
        ui.removeCallbacks(check);
        ui.removeCallbacks(followCheck);
        // A replaced screen leaves the hinge to the fresh one that took over.
        if (isFinishing() && !replaced) FrontScreen.stopWatching();
        super.onDestroy();
    }

    private void scheduleCheck() {
        ui.removeCallbacks(check);
        ui.postDelayed(check, SETTLE_MS);
    }

    /**
     * Start fresh if the window is tied to a switched-off screen (it then
     * draws nothing), or restart if the web view's sharpness no longer matches.
     */
    private void checkScreen() {
        if (!resumed || isFinishing() || isDestroyed() || replaced) return;
        Display shown = getWindow().getDecorView().getDisplay();
        if (shown != null && shown.getState() == Display.STATE_OFF && screenIsOn() && anotherDisplayOn(shown.getDisplayId())) {
            String why = "window was tied to screen " + shown.getDisplayId() + ", which is off";
            if (allowFix(why)) startFresh(why);
            return;
        }
        Display given = webViewContext != null ? webViewContext.given : null;
        int want = getResources().getConfiguration().densityDpi;
        if (given != null && densityOf(this, given) != want) {
            String why = "web view has screen " + given.getDisplayId() + " at " + densityOf(this, given) + "dpi, app is at " + want + "dpi";
            if (allowFix(why)) {
                Log.i(TAG, "restarting the page: " + why);
                recreate();
            }
        }
    }

    private boolean screenIsOn() {
        PowerManager pm = getSystemService(PowerManager.class);
        return pm != null && pm.isInteractive();
    }

    private boolean anotherDisplayOn(int notThis) {
        DisplayManager dm = getApplicationContext().getSystemService(DisplayManager.class);
        if (dm == null) return false;
        for (Display d : dm.getDisplays()) {
            if (d.getDisplayId() != notThis && d.getState() == Display.STATE_ON) return true;
        }
        return false;
    }

    /** At most MAX_FIXES automatic restarts within FIX_WINDOW_MS, so a phone that never settles can't loop. */
    private static boolean allowFix(String why) {
        long now = SystemClock.elapsedRealtime();
        int used = 0;
        for (long t : recentFixes) if (t != 0 && now - t < FIX_WINDOW_MS) used++;
        if (used >= MAX_FIXES) {
            Log.w(TAG, "not restarting again so soon: " + why);
            return false;
        }
        int oldest = 0;
        for (int i = 1; i < recentFixes.length; i++) if (recentFixes[i] < recentFixes[oldest]) oldest = i;
        recentFixes[oldest] = now;
        return true;
    }

    /** A screen's sharpness (dpi) as the web view will see it: from that screen's own settings. */
    static int densityOf(Context c, Display d) {
        return c.getApplicationContext().createDisplayContext(d).getResources().getConfiguration().densityDpi;
    }

    /**
     * What the web view is made with: the activity itself, except for which
     * screen it says it is on. The web view reads that once, when it is made,
     * and takes its sharpness from it. It gets the phone's main screen
     * whenever that screen's sharpness matches the app's (always, on the Flip:
     * Samsung keeps the app at the inside screen's sharpness on the front
     * screen too); otherwise the screen the app is really on.
     */
    static final class WebViewContext extends ContextWrapper {
        /** The screen last handed to the web view. */
        Display given;

        WebViewContext(Context activity) {
            super(activity);
        }

        @Override
        public Display getDisplay() {
            // Only asked on Android 11 and up (older web views use the default screen anyway).
            Display own = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R ? super.getDisplay() : null;
            Display pick = own;
            DisplayManager dm = getSystemService(DisplayManager.class);
            Display main = dm != null ? dm.getDisplay(Display.DEFAULT_DISPLAY) : null;
            int want = getResources().getConfiguration().densityDpi;
            if (main != null && densityOf(this, main) == want) pick = main;
            given = pick;
            return pick;
        }
    }
}
