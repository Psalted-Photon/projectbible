package com.irisbible.app;

import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * The Auto-Read Alarm and devotional reminders, set on the phone
 * (PhoneAlarms). The page calls this through src/lib/android/alarms.ts.
 *
 *  setSchedule       the alarm and reminder times, with the words and links
 *                    their notifications use; every alarm is set again.
 *  status            whether notifications are allowed ("granted", "denied"
 *                    or "prompt": not asked yet), whether exact timing is
 *                    allowed, and when the alarm next rings.
 *  askNotifications  Android's notification prompt (Android 13 and later),
 *                    unless it was already answered no for good.
 *  openSettings      the phone's notification settings for the app, or
 *                    with which "exact", its "Alarms & reminders" switch.
 *  preview           shows the alarm's notification now.
 *  test              rings the alarm once, `seconds` from now, the real way.
 *  takeLaunch        the link of the notification that opened the app, once.
 *  opened            an event: a notification was tapped with the app
 *                    already running, with its link.
 */
@CapacitorPlugin(
    name = "IrisAlarms",
    permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) }
)
public class IrisAlarmsPlugin extends Plugin {

    private String launchOpen;

    @Override
    public void load() {
        launchOpen = PhoneAlarms.takeOpen(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        String open = PhoneAlarms.takeOpen(intent);
        if (open == null) return;
        JSObject data = new JSObject();
        data.put("url", open);
        // Kept until the page is listening, in case it is still starting.
        notifyListeners("opened", data, true);
    }

    @PluginMethod
    public void takeLaunch(PluginCall call) {
        JSObject result = new JSObject();
        if (launchOpen != null) result.put("url", launchOpen);
        launchOpen = null;
        call.resolve(result);
    }

    @PluginMethod
    public void setSchedule(PluginCall call) {
        JSObject schedule = call.getObject("schedule");
        if (schedule == null) {
            call.reject("No schedule was sent.");
            return;
        }
        PhoneAlarms.save(getContext(), schedule);
        PhoneAlarms.scheduleAll(getContext());
        call.resolve(status());
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(status());
    }

    @PluginMethod
    public void askNotifications(PluginCall call) {
        if (
            Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            PhoneAlarms.notificationsOn(getContext()) ||
            getPermissionState("notifications") == PermissionState.DENIED
        ) {
            call.resolve(status());
            return;
        }
        requestPermissionForAlias("notifications", call, "notificationsAnswered");
    }

    @PermissionCallback
    private void notificationsAnswered(PluginCall call) {
        call.resolve(status());
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        String pkg = getContext().getPackageName();
        Intent intent;
        if ("exact".equals(call.getString("which")) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            intent = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + pkg));
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, pkg);
        } else {
            intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + pkg));
        }
        try {
            getActivity().startActivity(intent);
        } catch (ActivityNotFoundException e) {
            // Some phones lack the specific screen; the app's own page has both.
            getActivity().startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + pkg)));
        }
        call.resolve();
    }

    @PluginMethod
    public void preview(PluginCall call) {
        PhoneAlarms.show(getContext(), PhoneAlarms.TEST);
        call.resolve(status());
    }

    @PluginMethod
    public void test(PluginCall call) {
        int seconds = call.getInt("seconds", 60);
        long at = System.currentTimeMillis() + Math.max(5, seconds) * 1000L;
        PhoneAlarms.set(getContext(), PhoneAlarms.TEST, at);
        JSObject result = status();
        result.put("at", at);
        call.resolve(result);
    }

    private JSObject status() {
        String notifications;
        if (PhoneAlarms.notificationsOn(getContext())) {
            notifications = "granted";
        } else if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            getPermissionState("notifications") != PermissionState.DENIED
        ) {
            notifications = "prompt";
        } else {
            // Switched off in settings (or answered no for good): only the
            // phone's settings can turn them back on.
            notifications = "denied";
        }
        JSObject result = new JSObject();
        result.put("notifications", notifications);
        result.put("exact", PhoneAlarms.canExact(getContext()));
        result.put("nextAlarm", PhoneAlarms.next(getContext(), PhoneAlarms.ALARM));
        return result;
    }
}
