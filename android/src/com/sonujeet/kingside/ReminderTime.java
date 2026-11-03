package com.sonujeet.kingside;

import java.util.Calendar;
import java.util.TimeZone;

/** v1.7: when the next daily reminder is due (pure Java, unit-tested on a desktop JVM). */
public final class ReminderTime {
    private ReminderTime() {}
    /** next time strictly after `now` at hour:minute in zone tz */
    public static long next(long now, int hour, int minute, TimeZone tz) {
        Calendar c = Calendar.getInstance(tz);
        c.setTimeInMillis(now);
        c.set(Calendar.HOUR_OF_DAY, hour); c.set(Calendar.MINUTE, minute); c.set(Calendar.SECOND, 0); c.set(Calendar.MILLISECOND, 0);
        if (c.getTimeInMillis() <= now + 1000) c.add(Calendar.DAY_OF_MONTH, 1);
        return c.getTimeInMillis();
    }
    /** YYYY-MM-DD of `now` in zone tz (the same key the page uses for streak days) */
    public static String day(long now, TimeZone tz) {
        Calendar c = Calendar.getInstance(tz);
        c.setTimeInMillis(now);
        return String.format(java.util.Locale.US, "%04d-%02d-%02d", c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH));
    }
    /** should the reminder show? not when today's streak is already done */
    public static boolean shouldNotify(boolean on, String doneDay, long now, TimeZone tz) {
        return on && !day(now, tz).equals(doneDay);
    }
}
