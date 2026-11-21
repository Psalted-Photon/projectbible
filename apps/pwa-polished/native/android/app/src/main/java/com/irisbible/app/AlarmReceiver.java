package com.irisbible.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Where Android calls in for the phone's alarms (PhoneAlarms), with the app
 * open or not.
 *
 *  An alarm going off           shows its notification and sets the next one.
 *  Stop on a ringing alarm      silences it.
 *  The phone starting up,       sets every alarm again: Android forgets them
 *  the clock or time zone       on a restart, and a time zone change moves
 *  changing, the app updating,  the moment an alarm should ring. A newly
 *  exact timing being allowed   allowed exact timing makes them exact.
 */
public class AlarmReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (PhoneAlarms.ACTION_FIRE.equals(intent.getAction())) {
            PhoneAlarms.fired(
                context,
                intent.getStringExtra(PhoneAlarms.EXTRA_KIND),
                intent.getLongExtra(PhoneAlarms.EXTRA_AT, 0)
            );
        } else if (PhoneAlarms.ACTION_STOP.equals(intent.getAction())) {
            PhoneAlarms.stopRinging(context);
        } else {
            PhoneAlarms.scheduleAll(context);
        }
    }
}
