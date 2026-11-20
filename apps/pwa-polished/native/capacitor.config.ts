import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The Android app is the same web app, built as usual into ../dist and copied
 * into the APK. The page runs at https://localhost inside the app, so that is
 * where its saved data lives: changing the host or scheme later would leave
 * every installed pack and note behind on testers' phones.
 */
const config: CapacitorConfig = {
  appId: 'com.irisbible.app',
  appName: 'irisBible',
  webDir: '../dist',
};

export default config;
