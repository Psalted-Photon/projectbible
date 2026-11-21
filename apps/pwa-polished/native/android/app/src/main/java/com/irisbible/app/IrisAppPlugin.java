package com.irisbible.app;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Which app this is: its version, and which build.
 *
 * The page calls this through src/lib/android/appUpdate.ts.
 *
 *  info  versionCode and versionName (set by build-android.mjs, see
 *        app/build.gradle), channel "sideload" (the APK from irisbible.com,
 *        which updates itself through IrisUpdatePlugin) or "play" (updated by
 *        the Play Store), and test, true for a debug build put on a phone from
 *        the PC, which never offers updates: its key is not the release key,
 *        so Android would refuse to install one over it.
 */
@CapacitorPlugin(name = "IrisApp")
public class IrisAppPlugin extends Plugin {

    @PluginMethod
    public void info(PluginCall call) {
        Context context = getContext();
        try {
            PackageInfo pkg = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            long code = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? pkg.getLongVersionCode() : pkg.versionCode;
            JSObject result = new JSObject();
            result.put("versionCode", code);
            result.put("versionName", pkg.versionName);
            result.put("channel", context.getString(R.string.iris_channel));
            result.put("test", (context.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Couldn't read the app's version.");
        }
    }
}
