// node --test test/learn.test.mjs : every Learn lesson is loadable and every scripted move is legal (chess.js),
// every "stars" step can be finished, every lesson has 2–4-sentence text in English and Hindi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from '../web-site/vendor/chess.js';
import { CHAPTERS } from '../web-site/learn-data.js';
const F = 'abcdefgh';
function reach(p, sq) { const f = F.indexOf(sq[0]), r = +sq[1] - 1, o = []; const add = (x, y) => { if (x >= 0 && x < 8 && y >= 0 && y < 8) o.push(F[x] + (y + 1)); };
  const ray = (a, b) => { for (let k = 1; k < 8; k++) add(f + a * k, r + b * k); };
  if ('RQ'.includes(p)) [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([a, b]) => ray(a, b));
  if ('BQ'.includes(p)) [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([a, b]) => ray(a, b));
  if (p === 'N') [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]].forEach(([a, b]) => add(f + a, r + b));
  if (p === 'K') [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([a, b]) => add(f + a, r + b));
  return o; }
const lessons = CHAPTERS.flatMap((c) => c.lessons.map((l) => ({ ...l, ch: c.id })));
test('lesson count and chapters', () => {
  assert.equal(new Set(lessons.map((l) => l.id)).size, lessons.length);
  assert.ok(lessons.length >= 25 && lessons.length <= 40, 'lessons: ' + lessons.length);
  for (const c of CHAPTERS) assert.ok(c.title[1] && c.sub[1], c.id + ' Hindi title');
});
for (const L of lessons) test(`lesson ${L.ch}/${L.id}`, () => {
  assert.ok(L.title[0] && L.title[1]);
  let cur = null;
  L.steps.forEach((s, i) => {
    const tag = `${L.id} step ${i + 1}`;
    assert.ok(s.t && s.t[0] && s.t[1] && /[\u0900-\u097F]/.test(s.t[1]), tag + ': English + Hindi text');
    const n = s.t[0].split(/(?<=[.!?])\s+/).filter(Boolean).length; assert.ok(n >= 1 && n <= 5, tag + ': ' + n + ' sentences');
    if (s.stars) {
      for (const st of s.stars) { const seen = new Set([s.start]); const q = [s.start]; while (q.length) { const x = q.shift(); for (const y of reach(s.piece, x)) if (!seen.has(y)) { seen.add(y); q.push(y); } } assert.ok(seen.has(st), tag + ' star ' + st + ' unreachable'); }
      cur = null; return;
    }
    let c;
    if (s.fen) c = new Chess(s.fen);
    else if (s.from) { c = new Chess(); for (const m of s.from.split(' ')) c.move(m); }
    else { assert.ok(cur, tag + ': continues from nothing'); c = new Chess(cur.fen()); }
    for (const m of s.pre || []) c.move(m);
    if (s.need === 'check') assert.ok(c.moves().some((m) => m.includes('+')), tag + ': no check available');
    if (s.goal) { assert.ok(['mate', 'promote', 'catch'].includes(s.goal)); assert.ok(s.g && s.g[1], tag + ' goal text'); cur = c; return; }
    const lines = s.lines || (s.line && s.line.length ? [s.line] : []);
    let end = c;
    lines.forEach((line, li) => { const b = new Chess(c.fen()); for (const m of line) { const r = b.move(m); assert.ok(r, `${tag} line ${li + 1}: ${m} illegal`); if (m.endsWith('#')) assert.ok(b.isCheckmate(), tag + ' ' + m + ' is not mate'); } if (li === 0) end = b; });
    cur = end;
  });
});
