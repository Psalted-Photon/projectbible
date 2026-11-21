package com.irisbible.app;

import com.getcapacitor.BridgeActivity;

/**
 * The plugins only one build has. The APK downloaded from irisbible.com
 * updates itself, through IrisUpdatePlugin. (src/play has the Play Store
 * build's version of this file, which adds nothing.)
 */
final class FlavorPlugins {

    private FlavorPlugins() {}

    static void register(BridgeActivity activity) {
        activity.registerPlugin(IrisUpdatePlugin.class);
    }
}
