package com.sonujeet.kingside;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import java.util.TimeZone;

/** v1.7: the daily streak reminder. AlarmManager wakes ReminderReceiver at the chosen time; it posts a notification
 *  unless today's streak is already done, then sets the next day's alarm. Rescheduled on boot and after app updates. */
public final class Reminders {
    static final String PREFS = "kingside-reminders";
    static final String CHANNEL = "streak";
    static final String ACTION = "com.sonujeet.kingside.REMIND";
    private Reminders() {}

    static SharedPreferences p(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }
    static void save(Context c, boolean on, int h, int m, String title, String body) {
        p(c).edit().putBoolean("on", on).putInt("h", Math.max(0, Math.min(23, h))).putInt("m", Math.max(0, Math.min(59, m)))
            .putString("title", title).putString("body", body).apply();
    }
    static void setStreak(Context c, String doneDay, int count, String title, String body) {
        p(c).edit().putString("done", doneDay == null ? "" : doneDay).putInt("count", count).putString("title", title).putString("body", body).apply();
    }
    private static PendingIntent pi(Context c) {
        Intent i = new Intent(c, ReminderReceiver.class).setAction(ACTION);
        return PendingIntent.getBroadcast(c, 7001, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    static long schedule(Context c) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return -1;
        am.cancel(pi(c));
        SharedPreferences s = p(c);
        if (!s.getBoolean("on", false)) return -1;
        long at = ReminderTime.next(System.currentTimeMillis(), s.getInt("h", 19), s.getInt("m", 0), TimeZone.getDefault());
        // inexact but allowed in Doze, no special permission (Android may shift it by a few minutes)
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi(c));
        s.edit().putLong("next", at).apply();
        return at;
    }
    static boolean due(Context c) {
        SharedPreferences s = p(c);
        return ReminderTime.shouldNotify(s.getBoolean("on", false), s.getString("done", ""), System.currentTimeMillis(), TimeZone.getDefault());
    }
    static String permission(Context c) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 33 && c.checkSelfPermission("android.permission.POST_NOTIFICATIONS") != android.content.pm.PackageManager.PERMISSION_GRANTED)
            return p(c).getBoolean("asked", false) ? "denied" : "default";
        return nm != null && !nm.areNotificationsEnabled() ? "denied" : "granted";
    }
    static void post(Context c, String title, String body) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Daily streak reminder", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("A daily nudge to keep your Kingside Chess streak");
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent tap = PendingIntent.getActivity(c, 7002, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, CHANNEL) : new Notification.Builder(c);
        b.setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title == null || title.isEmpty() ? "🔥 Keep your streak!" : title)
            .setContentText(body == null || body.isEmpty() ? "Play a game, finish a lesson or solve today’s daily puzzle." : body)
            .setStyle(new Notification.BigTextStyle().bigText(body))
            .setColor(0xFF81B64C)
            .setAutoCancel(true)
            .setContentIntent(tap);
        try { nm.notify(7003, b.build()); } catch (SecurityException e) { /* notifications not allowed */ }
    }
}
