// v1.7: every bot is complete (EN+HI text, avatar file, engine settings) and every repertoire line is legal and ends in a
// position the Lichess opening book (data/openings.json) names.
import test from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
globalThis.window = globalThis.window || {};
const { BOTS, bookMove } = await import('../web-site/bots.js');
const { Chess } = await import('../web-site/vendor/chess.js');
const book = JSON.parse(readFileSync(new URL('../web-site/data/openings.json', import.meta.url)));
const key = (fen) => fen.split(' ').slice(0, 3).join(' ');
test('6-8 bots, each complete', () => {
  assert.ok(BOTS.length >= 6 && BOTS.length <= 8);
  for (const b of BOTS) {
    assert.ok(b.bio.en && b.bio.hi && b.tag.en && b.tag.hi, b.id);
    for (const k of ['start', 'win', 'lose', 'draw']) assert.ok(b.say[k].en.length && b.say[k].hi.length, b.id + ' ' + k);
    assert.ok(existsSync(new URL(`../web-site/bots/${b.id}.svg`, import.meta.url)), 'avatar ' + b.id);
    assert.ok(b.cfg && (b.cfg.multipv || b.cfg.elo || b.cfg.skill !== undefined), 'engine cfg ' + b.id);
    assert.ok(b.lvl >= 1 && b.lvl <= 10);
  }
  const elos = BOTS.map((b) => b.elo); assert.deepEqual(elos, [...elos].sort((a, b) => a - b), 'sorted by strength');
});
test('repertoires: legal, named by the opening book', () => {
  for (const b of BOTS) if (b.rep) for (const c of ['w', 'b']) for (const l of b.rep[c]) {
    const g = new Chess(); let last = null;
    for (const s of l.split(' ')) { const m = g.move(s); assert.ok(m, `${b.id} ${l}: ${s}`); const k = book.p[key(g.fen())]; if (k !== undefined) last = book.n[k]; }
    assert.ok(book.p[key(g.fen())] !== undefined, `${b.id} line "${l}" ends in an unnamed position (last name: ${last})`);
    console.log(`${b.id.padEnd(8)} ${c} ${l.padEnd(44)} -> ${book.n[book.p[key(g.fen())]]}`);
  }
});
test('bookMove follows the line for the right colour and stops after it', () => {
  const b = BOTS.find((x) => x.id === 'vikram');
  assert.equal(bookMove(b, ['e4'], 'b'), 'c5');
  assert.equal(bookMove(b, ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3'], 'b'), 'a6');
  assert.equal(bookMove(b, ['h4'], 'b'), null);
  const black = BOTS.every((x) => !x.rep || ['e4', 'd4', 'c4', 'Nf3'].every((m) => bookMove(x, [m], 'b')));
  assert.ok(black, 'every bot has an answer to 1.e4, 1.d4, 1.c4 and 1.Nf3');
});
