package com.sonujeet.kingside;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

/** v1.7: fires at the reminder time (and on boot / app update to set the alarm again). */
public class ReminderReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent intent) {
        String a = intent == null ? null : intent.getAction();
        if (Reminders.ACTION.equals(a) && Reminders.due(c)) {
            SharedPreferences s = Reminders.p(c);
            Reminders.post(c, s.getString("title", null), s.getString("body", null));
        }
        if (Reminders.ACTION.equals(a) || Intent.ACTION_BOOT_COMPLETED.equals(a) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(a)
                || Intent.ACTION_TIMEZONE_CHANGED.equals(a) || Intent.ACTION_TIME_CHANGED.equals(a)) {
            Reminders.schedule(c);
        }
    }
}
