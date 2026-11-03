import com.sonujeet.kingside.ReminderTime;
import java.util.TimeZone;
public class ReminderTimeTest {
  static int fails = 0;
  static void eq(Object a, Object b, String what) { boolean ok = a.equals(b); System.out.println((ok ? "PASS " : "FAIL ") + what + " -> " + a); if (!ok) fails++; }
  public static void main(String[] x) throws Exception {
    TimeZone ist = TimeZone.getTimeZone("Asia/Calcutta"), utc = TimeZone.getTimeZone("UTC");
    long t = java.time.Instant.parse("2026-10-27T09:00:00Z").toEpochMilli(); // 14:30 IST
    eq(java.time.Instant.ofEpochMilli(ReminderTime.next(t, 19, 0, ist)).toString(), "2026-10-27T13:30:00Z", "IST 14:30 -> today 19:00 IST");
    long t2 = java.time.Instant.parse("2026-10-27T14:00:00Z").toEpochMilli(); // 19:30 IST, past 19:00
    eq(java.time.Instant.ofEpochMilli(ReminderTime.next(t2, 19, 0, ist)).toString(), "2026-10-28T13:30:00Z", "IST 19:30 -> tomorrow 19:00 IST");
    eq(java.time.Instant.ofEpochMilli(ReminderTime.next(t, 19, 0, utc)).toString(), "2026-10-27T19:00:00Z", "UTC 09:00 -> today 19:00 UTC");
    eq(java.time.Instant.ofEpochMilli(ReminderTime.next(java.time.Instant.parse("2026-10-27T13:30:00Z").toEpochMilli(), 19, 0, ist)).toString(), "2026-10-28T13:30:00Z", "exactly at the time -> next day");
    long late = java.time.Instant.parse("2026-10-27T18:45:00Z").toEpochMilli(); // 00:15 IST on the 28th
    eq(ReminderTime.day(late, ist), "2026-10-28", "day key IST after midnight");
    eq(ReminderTime.day(late, utc), "2026-10-27", "day key UTC same instant");
    eq(ReminderTime.shouldNotify(true, "2026-10-27", t, ist), false, "streak done today -> no notification");
    eq(ReminderTime.shouldNotify(true, "2026-10-26", t, ist), true, "done yesterday only -> notify");
    eq(ReminderTime.shouldNotify(false, "", t, ist), false, "reminder off -> no notification");
    System.out.println(fails == 0 ? "ALL PASS" : fails + " FAILED");
    System.exit(fails == 0 ? 0 : 1);
  }
}
