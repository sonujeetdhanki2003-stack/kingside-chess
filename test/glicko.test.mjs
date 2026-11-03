
import { update, game, G2, poolOf, inflateRd } from '../server/glicko2.js';
import test from 'node:test'; import assert from 'node:assert/strict';
test('Glickman paper example', () => {
  const r = update({ r: 1500, rd: 200, vol: 0.06 }, [{ r: 1400, rd: 30, s: 1 }, { r: 1550, rd: 100, s: 0 }, { r: 1700, rd: 300, s: 0 }]);
  // paper (tau 0.5): r'=1464.06, RD'=151.52, vol'=0.05999; with tau 0.75 volatility barely moves
  assert.ok(Math.abs(r.r - 1464.06) < 0.1, 'rating ' + r.r);
  assert.ok(Math.abs(r.rd - 151.52) < 0.1, 'rd ' + r.rd);
  assert.ok(Math.abs(r.vol - 0.06) < 0.0005, 'vol ' + r.vol);
});
test('new players: winner up, loser down by the same amount, RD shrinks', () => {
  const p = { r: 1500, rd: 350, vol: 0.09 };
  const [a, b] = game(p, p, 1, 0);
  assert.ok(a.r > 1600 && a.r < 1700, 'a ' + a.r);
  assert.ok(Math.abs((a.r - 1500) + (b.r - 1500)) < 0.01);
  assert.ok(a.rd < 350 && b.rd < 350);
  const [c, d] = game(p, p, 0.5, 0);
  assert.ok(Math.abs(c.r - 1500) < 0.01 && Math.abs(d.r - 1500) < 0.01);
});
test('established player beating a much weaker one gains little', () => {
  const [a] = game({ r: 2000, rd: 60, vol: 0.06 }, { r: 1500, rd: 60, vol: 0.06 }, 1, 0);
  assert.ok(a.r - 2000 > 0 && a.r - 2000 < 3, String(a.r));
  const [u] = game({ r: 1500, rd: 60, vol: 0.06 }, { r: 2000, rd: 60, vol: 0.06 }, 1, 0);
  assert.ok(u.r - 1500 > 8, String(u.r));
});
test('provisional after a few games, established after many', () => {
  let a = { r: 1500, rd: 350, vol: 0.09 }; const o = { r: 1500, rd: 80, vol: 0.06 };
  for (let i = 0; i < 3; i++) a = update(a, [{ ...o, s: i % 2 }]);
  assert.ok(a.rd > G2.provisional);
  for (let i = 0; i < 40; i++) a = update(a, [{ ...o, s: i % 2 }]);
  assert.ok(a.rd < G2.provisional, 'rd ' + a.rd);
});
test('RD grows with time away, capped', () => {
  assert.ok(inflateRd(60, 0.06, 365) > 60);
  assert.equal(inflateRd(340, 0.09, 10000), G2.rdMax);
});
test('pools', () => {
  assert.equal(poolOf('3+2'), 'blitz'); assert.equal(poolOf('5+0'), 'blitz');
  assert.equal(poolOf('10+0'), 'rapid'); assert.equal(poolOf('15+10'), 'rapid'); assert.equal(poolOf('none'), null);
});

test('v1.9 provisional: RD > 110 and fewer than 10 games', async () => {
  const { isProv } = await import('../server/glicko2.js');
  assert.equal(isProv(300, 9), true); assert.equal(isProv(300, 10), false); assert.equal(isProv(100, 0), false); assert.equal(isProv(111), true);
});
