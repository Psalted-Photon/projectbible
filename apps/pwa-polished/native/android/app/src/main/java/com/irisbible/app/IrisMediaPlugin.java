package com.irisbible.app;

import android.os.Build;
import android.webkit.WebView;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Read Aloud's link to Android's media controls (ReadAloudService).
 *
 * The page calls this through src/lib/android/media.ts.
 *
 *  update   what is being read and whether it is playing. "playing",
 *           "buffering" (speech being made before it can start) or "paused"
 *           keep the service running; "none" ends it.
 *  action   an event sent to the page when a control is pressed on the lock
 *           screen, in the notification, or on a headset: play, pause, next,
 *           previous or stop.
 */
@CapacitorPlugin(name = "IrisMedia")
public class IrisMediaPlugin extends Plugin {

    @Override
    public void load() {
        ReadAloudService.listener = (action) -> {
            JSObject data = new JSObject();
            data.put("action", action);
            notifyListeners("action", data);
        };
        // The page's speech is made in the web view's own process. Keep that
        // process as important as the app's, hidden or not, so the service
        // keeping the app awake keeps the speech going with it.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getBridge().executeOnMainThread(() ->
                getBridge().getWebView().setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false)
            );
        }
    }

    @PluginMethod
    public void update(PluginCall call) {
        ReadAloudService.NowPlaying now = new ReadAloudService.NowPlaying();
        now.state = call.getString("state", ReadAloudService.NONE);
        now.title = call.getString("title", "");
        now.subtitle = call.getString("subtitle", "");
        now.album = call.getString("album", "");
        now.duration = call.getDouble("duration", 0.0);
        now.position = call.getDouble("position", 0.0);
        now.speed = call.getFloat("speed", 1f);
        getBridge().executeOnMainThread(() -> {
            ReadAloudService.update(getContext(), now);
            call.resolve();
        });
    }

    /** The app is closing, and its page with it. */
    @Override
    protected void handleOnDestroy() {
        ReadAloudService.listener = null;
        ReadAloudService.update(getContext(), new ReadAloudService.NowPlaying());
        super.handleOnDestroy();
    }
}
