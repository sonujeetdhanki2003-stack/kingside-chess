// v1.7 streak logic across day boundaries, in India time (Asia/Calcutta, UTC+5:30) and UTC.
import test from 'node:test'; import assert from 'node:assert/strict';
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.window = { dispatchEvent() {} }; globalThis.CustomEvent = class { constructor(n) { this.type = n; } };
globalThis.document = { getElementById: () => null, createElement: () => ({ classList: { add() {}, remove() {} }, setAttribute() {} }), body: { appendChild() {} } };
globalThis.setTimeout = ((st) => (f, ms) => (ms > 100 ? 0 : st(f, ms)))(setTimeout);
const P = await import('../web-site/progress.js');
let T = 0; const at = (iso) => { T = Date.parse(iso); };
const play = () => P.record('game', { plies: 10, mode: 'ai', level: 1, win: false });
const reset = (tz) => { mem.clear(); P.setup({ now: () => T, tz }); };

test('dayKey: the same instant is a different day in India and in UTC', () => {
  const t = Date.parse('2026-10-27T18:45:00Z'); // 00:15 on the 28th in India
  assert.equal(P.dayKey(t, 'Asia/Calcutta'), '2026-10-28');
  assert.equal(P.dayKey(t, 'UTC'), '2026-10-27');
  assert.equal(P.dayKey(Date.parse('2026-10-27T18:29:59Z'), 'Asia/Calcutta'), '2026-10-27'); // 23:59:59 IST
  assert.equal(P.dayKey(Date.parse('2026-10-27T18:30:00Z'), 'Asia/Calcutta'), '2026-10-28'); // midnight IST
});
for (const tz of ['Asia/Calcutta', 'UTC']) {
  const off = tz === 'UTC' ? 0 : 5.5 * 3600e3; // local wall-clock -> UTC instant
  const local = (s) => new Date(Date.parse(s + 'Z') - off).toISOString();
  test(`${tz}: games on consecutive local days build a streak; late-night games count for that day`, () => {
    reset(tz);
    at(local('2026-10-25T23:50:00')); play();           // just before local midnight
    assert.deepEqual(P.streak(undefined, T, tz).cur, 1);
    at(local('2026-10-26T00:05:00')); play();           // 15 minutes later = the next local day
    assert.equal(P.streak(undefined, T, tz).cur, 2);
    at(local('2026-10-26T21:00:00')); play();           // same day again: no double count
    assert.equal(P.streak(undefined, T, tz).cur, 2);
    at(local('2026-10-27T09:00:00'));                   // next morning, nothing played yet: still alive, at risk
    let s = P.streak(undefined, T, tz); assert.equal(s.cur, 2); assert.equal(s.today, false); assert.equal(s.atRisk, true);
    P.record('lesson', { id: 'x' });                    // a finished lesson keeps it
    s = P.streak(undefined, T, tz); assert.equal(s.cur, 3); assert.equal(s.today, true);
    at(local('2026-10-29T08:00:00'));                   // skipped the 28th: broken
    s = P.streak(undefined, T, tz); assert.equal(s.cur, 0); assert.equal(s.best, 3);
    P.record('daily', { ok: true });                    // the daily puzzle starts a new one
    s = P.streak(undefined, T, tz); assert.equal(s.cur, 1); assert.equal(s.best, 3);
  });
  test(`${tz}: a game with fewer than 2 plies or a failed puzzle does not count`, () => {
    reset(tz); at(local('2026-10-27T12:00:00'));
    P.record('game', { plies: 1 }); P.record('daily', { ok: false }); P.record('rush', { score: 3 });
    assert.equal(P.streak(undefined, T, tz).cur, 0);
  });
}
test('the same moment, two zones: an India phone and a UTC phone see different streak days', () => {
  reset('Asia/Calcutta'); at('2026-10-27T19:00:00Z'); play(); // 00:30 IST on the 28th
  assert.deepEqual(P.load().days, ['2026-10-28']);
  reset('UTC'); at('2026-10-27T19:00:00Z'); play();
  assert.deepEqual(P.load().days, ['2026-10-27']);
});
test('merge keeps the union of days from two phones', () => {
  const m = P.merge({ days: ['2026-10-25', '2026-10-26'] }, { days: ['2026-10-26', '2026-10-27'] });
  assert.deepEqual(m.days, ['2026-10-25', '2026-10-26', '2026-10-27']);
  assert.equal(P.streak(m, Date.parse('2026-10-27T10:00:00Z'), 'UTC').cur, 3);
});
