// v1.7 Daily streak (home card, calendar) + daily reminders.
// Reminders: in the Android app a real daily notification scheduled by the phone (AlarmManager, works with the app closed);
// in a browser / installed web app / the Windows app, a notification while Kingside is open (browsers cannot wake a closed site).
import * as Progress from './progress.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KEY = 'kingside-remind-v1';
const hi = () => window.__i18n && window.__i18n.lang && window.__i18n.lang() === 'hi';
const locale = () => (hi() ? 'hi-IN' : 'en-IN');
export function prefs() { try { const p = JSON.parse(localStorage.getItem(KEY) || 'null'); if (p && /^\d\d:\d\d$/.test(p.time)) return p; } catch (e) {} return { on: false, time: '19:00' }; }
function savePrefs(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) {} }
const N = () => (window.KingsideNative && window.KingsideNative.setReminder ? window.KingsideNative : null);
export const platform = () => (N() ? 'android' : window.__kingsideDesktop ? 'desktop' : 'web');

/* ---------------- texts (English + Hindi, chosen here so the phone's notification is in the app's language) ---------------- */
function words(st) {
  const H = hi();
  if (st.cur > 0) return { title: H ? `🔥 ${st.cur} दिन की स्ट्रीक बचाएँ!` : `🔥 Keep your ${st.cur}-day streak!`, body: H ? 'आज एक गेम खेलें, एक पाठ पूरा करें या डेली पज़ल हल करें।' : 'Play a game, finish a lesson or solve today’s daily puzzle.' };
  return { title: H ? '♟️ आज की डेली पज़ल इंतज़ार कर रही है' : '♟️ Your daily puzzle is waiting', body: H ? 'एक गेम या पज़ल से आज नई स्ट्रीक शुरू करें 🔥' : 'Start a new streak today with one game or puzzle 🔥' };
}

/* ---------------- home card ---------------- */
export function renderCard() {
  const el = $('streak-card'); if (!el) return;
  const st = Progress.streak(); const days = new Set(Progress.load().days);
  $('sc-title').textContent = st.cur ? `${st.cur}-day streak` : 'Start a streak today';
  $('sc-sub').textContent = st.today ? `Done for today ✅ · best ${st.best}` : st.cur ? 'Play today to keep it alive!' : 'Play a game, finish a lesson or solve the daily puzzle';
  el.classList.toggle('on', st.cur > 0); el.classList.toggle('risk', !!st.atRisk);
  const today = Progress.dayKey();
  $('sc-week').innerHTML = [...Array(7)].map((_, i) => {
    const d = Progress.prevDay(today, 6 - i);
    const wd = new Date(d + 'T12:00:00Z').toLocaleDateString(locale(), { weekday: 'narrow', timeZone: 'UTC' });
    return `<i class="${days.has(d) ? 'on' : ''}${d === today ? ' today' : ''}"><b>${days.has(d) ? '🔥' : ''}</b><small>${esc(wd)}</small></i>`;
  }).join('');
  syncNative(st);
}

/* ---------------- streak screen: month calendar + reminder settings ---------------- */
let month = null; // 'YYYY-MM' shown
export function html() {
  const st = Progress.streak(); const p = Progress.load(); const days = new Set(p.days); const frz = Progress.frozen();
  const today = Progress.dayKey();
  if (!month) month = today.slice(0, 7);
  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)); const nDays = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // Monday first
  const head = [...Array(7)].map((_, i) => new Date(Date.UTC(2026, 9, 26 + i)).toLocaleDateString(locale(), { weekday: 'narrow', timeZone: 'UTC' }));
  let cells = head.map((h) => `<span class="cal-h">${esc(h)}</span>`).join('') + '<span></span>'.repeat(lead);
  let inMonth = 0;
  for (let d = 1; d <= nDays; d++) {
    const k = `${month}-${String(d).padStart(2, '0')}`; const on = days.has(k); if (on) inMonth++;
    const prevOn = days.has(Progress.prevDay(k)), nextOn = days.has(Progress.prevDay(k, -1));
    const fz = on && frz.has(k);
    cells += `<span class="cal-d${on ? ' on' : ''}${fz ? ' frz' : ''}${on && prevOn ? ' l' : ''}${on && nextOn ? ' r' : ''}${k === today ? ' today' : ''}${k > today ? ' fut' : ''}">${on ? (fz ? '❄️' : '🔥') : d}</span>`;
  }
  const label = first.toLocaleDateString(locale(), { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const r = prefs(); const plat = platform();
  const perm = plat === 'web' && 'Notification' in window ? Notification.permission : plat === 'android' && N().notifPermission ? N().notifPermission() : 'granted';
  const note = plat === 'android' ? 'Your phone sends it every day at this time, even when the app is closed. It skips days you have already played.'
    : plat === 'desktop' ? 'Shows a Windows notification at this time while Kingside Chess is open (it can be minimised).'
      : !('Notification' in window) ? 'This browser cannot show notifications. Install the Android app for daily reminders.'
        : 'Browsers can only remind you while Kingside is open in a tab or installed app. For reminders with the app closed, use the Android app.';
  return `<div class="a-card st-card st-big"><div class="st-top"><span class="st-flame${st.cur ? '' : ' off'}">🔥</span><div><b>${st.cur} day${st.cur === 1 ? '' : 's'}</b><small>${st.today ? 'Streak safe for today ✅' : st.cur ? 'Play a game, finish a lesson or solve the Daily Puzzle today to keep it' : 'Play a game, finish a lesson or solve the Daily Puzzle to start a streak'}</small></div><div class="st-best"><b>${st.best}</b><small>best</small></div></div></div>
  <div class="a-card cal-card"><div class="cal-nav"><button type="button" class="icon-btn" data-cal="-1" aria-label="Previous month">‹</button><b>${esc(label)}</b><button type="button" class="icon-btn" data-cal="1" aria-label="Next month"${month >= today.slice(0, 7) ? ' disabled' : ''}>›</button></div>
    <div class="cal-grid">${cells}</div><p class="a-small a-muted cal-sum">${inMonth} active day${inMonth === 1 ? '' : 's'} this month · ${p.days.length} in total</p></div>
  <div class="a-card rem-card"><h3>🔔 Daily reminder</h3>
    <label class="toggle"><input type="checkbox" id="rem-on"${r.on ? ' checked' : ''}><span>Remind me to keep my streak</span></label>
    <label class="rem-time"><span>Time</span><input type="time" id="rem-time" value="${r.time}" step="300"${r.on ? '' : ' disabled'}></label>
    <p class="a-small a-muted" id="rem-note">${note}</p>
    ${perm === 'denied' ? '<p class="a-small rem-warn">Notifications are blocked for Kingside. Turn them on in your phone or browser settings.</p>' : ''}
    ${r.on ? '<button type="button" class="a-link" id="rem-test">Send a test reminder now</button>' : ''}</div>`;
}
export function wireView(body, rerender) {
  body.querySelectorAll('[data-cal]').forEach((b) => (b.onclick = () => {
    const [y, m] = month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + +b.dataset.cal, 1));
    month = d.toISOString().slice(0, 7); rerender();
  }));
  const on = body.querySelector('#rem-on'), time = body.querySelector('#rem-time'), test = body.querySelector('#rem-test');
  if (on) on.onchange = async () => {
    const p = prefs(); p.on = on.checked;
    if (p.on) { const ok = await askPermission(); if (!ok) { p.on = false; on.checked = false; } }
    savePrefs(p); schedule(); rerender();
  };
  if (time) time.onchange = () => { if (!/^\d\d:\d\d$/.test(time.value)) return; const p = prefs(); p.time = time.value; savePrefs(p); schedule(); toastFn(`Reminder set for ${fmtTime(p.time)}`); };
  if (test) test.onclick = () => fire(true);
}
export function resetMonth() { month = null; }
const fmtTime = (t) => { const [h, m] = t.split(':').map(Number); return new Date(Date.UTC(2026, 0, 1, h, m)).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }); };

/* ---------------- scheduling ---------------- */
let toastFn = () => {};
async function askPermission() {
  const n = N();
  if (n) { if (n.requestNotifPermission) n.requestNotifPermission(); return true; } // Android 13+ shows its own prompt
  if (platform() === 'desktop') return true;
  if (!('Notification' in window)) { toastFn('This browser cannot show notifications'); return false; }
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') { toastFn('Notifications are blocked in this browser’s settings'); return false; }
  try { return (await Notification.requestPermission()) === 'granted'; } catch (e) { return false; }
}
function nextAt(time, from = Date.now()) {
  const [h, m] = time.split(':').map(Number);
  const d = new Date(from); d.setHours(h, m, 0, 0);
  if (d.getTime() <= from + 1000) d.setDate(d.getDate() + 1);
  return d.getTime();
}
let timer = null;
export function schedule() {
  const p = prefs(); const n = N();
  if (n) { const [h, m] = p.time.split(':').map(Number); const w = words(Progress.streak()); n.setReminder(!!p.on, h, m, w.title, w.body); syncNative(); return; }
  clearTimeout(timer); timer = null;
  if (!p.on) return;
  const wait = nextAt(p.time) - Date.now();
  timer = setTimeout(() => { fire(false); schedule(); }, Math.min(wait, 2 ** 31 - 1));
}
// the Android receiver skips the notification on days already played and uses fresh words
function syncNative(st = Progress.streak()) {
  const n = N(); if (!n || !n.setStreak) return;
  const w = words(st);
  try { n.setStreak(st.today ? st.day : '', st.cur, w.title, w.body); } catch (e) {}
}
async function fire(test) {
  const st = Progress.streak();
  if (!test && st.today) return; // already played today: no nagging
  const w = words(st);
  const n = N();
  if (n && n.testNotification) { n.testNotification(w.title, w.body); return; }
  try {
    const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
    if (reg && reg.showNotification) { await reg.showNotification(w.title, { body: w.body, icon: 'icon-192.png', badge: 'icon-192.png', tag: 'kingside-streak' }); return; }
  } catch (e) { /* fall back */ }
  try { const x = new Notification(w.title, { body: w.body, icon: 'icon-192.png', tag: 'kingside-streak' }); x.onclick = () => { window.focus(); x.close(); }; } catch (e) { toastFn(w.title); }
}
export function setup(o) {
  toastFn = o.toast || toastFn;
  window.addEventListener('kingside-progress', () => renderCard());
  schedule();
}
window.__kingsideStreak = { prefs, schedule, nextAt, words, fire, platform };
