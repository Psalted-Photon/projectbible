package com.irisbible.app;

import com.getcapacitor.BridgeActivity;

/**
 * The plugins only one build has. The Play Store build has none: Play updates
 * it, so it carries no updater (see src/sideload for the one the APK has).
 */
final class FlavorPlugins {

    private FlavorPlugins() {}

    static void register(BridgeActivity activity) {}
}
