package com.irisbible.app;

import android.os.Build;
import android.os.Bundle;
import android.view.Window;
import android.view.WindowManager;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The app's own plugins, which live in this folder rather than in npm
        // packages, so they must be named here before the bridge starts.
        registerPlugin(IrisFilesPlugin.class);
        registerPlugin(IrisScreenPlugin.class);
        // Open the way the page last asked for, so a phone held sideways at
        // launch doesn't turn the app before the page has loaded.
        IrisScreenPlugin.applySavedOrientation(this);
        super.onCreate(savedInstanceState);
        goFullScreen();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // A dialog or another app can bring the bars back; hide them again.
        if (hasFocus) hideSystemBars();
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
}
