// Glicko-2 (Mark Glickman, 2012) as Lichess uses it: one game = one rating period,
// RD grows with time away (Lichess's 0.21436 rating periods per day), rating 1500 / RD 350 to start.
export const G2 = { r0: 1500, rd0: 350, vol0: 0.09, tau: 0.75, rdMin: 45, rdMax: 350, provisional: 110, periodsPerDay: 0.21436, floor: 400 };
const SCALE = 173.7178;
const g = (phi) => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
const E = (mu, muj, phij) => 1 / (1 + Math.exp(-g(phij) * (mu - muj)));

// RD after `days` without a game (capped at rdMax)
export function inflateRd(rd, vol, days) {
  if (!(days > 0)) return Math.min(G2.rdMax, rd);
  const phi = rd / SCALE;
  const p = Math.sqrt(phi * phi + vol * vol * days * G2.periodsPerDay);
  return Math.min(G2.rdMax, p * SCALE);
}

// player { r, rd, vol }, results [{ r, rd, s }] (s = 1 win, 0.5 draw, 0 loss) -> new { r, rd, vol }
export function update(player, results) {
  const mu = (player.r - 1500) / SCALE, phi = player.rd / SCALE, sigma = player.vol;
  if (!results.length) { const p = Math.sqrt(phi * phi + sigma * sigma); return { r: player.r, rd: Math.min(G2.rdMax, p * SCALE), vol: sigma }; }
  let vInv = 0, dSum = 0;
  for (const o of results) {
    const muj = (o.r - 1500) / SCALE, phij = o.rd / SCALE, e = E(mu, muj, phij), gj = g(phij);
    vInv += gj * gj * e * (1 - e); dSum += gj * (o.s - e);
  }
  const v = 1 / vInv, delta = v * dSum;
  // new volatility: Illinois algorithm (step 5 of Glickman's paper)
  const a = Math.log(sigma * sigma), tau = G2.tau, eps = 1e-6;
  const f = (x) => { const ex = Math.exp(x), d2 = phi * phi + v + ex; return (ex * (delta * delta - phi * phi - v - ex)) / (2 * d2 * d2) - (x - a) / (tau * tau); };
  let A = a, B;
  if (delta * delta > phi * phi + v) B = Math.log(delta * delta - phi * phi - v);
  else { let k = 1; while (f(a - k * tau) < 0 && k < 100) k++; B = a - k * tau; }
  let fA = f(A), fB = f(B), it = 0;
  while (Math.abs(B - A) > eps && it++ < 100) {
    const C = A + ((A - B) * fA) / (fB - fA), fC = f(C);
    if (fC * fB <= 0) { A = B; fA = fB; } else fA /= 2;
    B = C; fB = fC;
  }
  const sigma1 = Math.exp(A / 2);
  const phiStar = Math.sqrt(phi * phi + sigma1 * sigma1);
  const phi1 = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const mu1 = mu + phi1 * phi1 * dSum;
  return { r: Math.max(G2.floor, mu1 * SCALE + 1500), rd: Math.max(G2.rdMin, Math.min(G2.rdMax, phi1 * SCALE)), vol: Math.min(0.1, sigma1) };
}

// one rated game between a and b ({ r, rd, vol, last }); s = score for a; returns new a, new b
export function game(a, b, s, now = Date.now()) {
  const day = 864e5;
  const A = { ...a, rd: inflateRd(a.rd, a.vol, a.last ? (now - a.last) / day : 0) };
  const B = { ...b, rd: inflateRd(b.rd, b.vol, b.last ? (now - b.last) / day : 0) };
  return [update(A, [{ r: B.r, rd: B.rd, s }]), update(B, [{ r: A.r, rd: A.rd, s: 1 - s }])];
}
// provisional ("1500?"): RD above 110 (Lichess's rule) and, since v1.9, fewer than 10 rated games in the pool —
// whichever comes first settles the rating, so a small player base still sees ranks after a handful of games
export const PROV_GAMES = 10;
export const isProv = (rd, n = 0) => rd > G2.provisional && !(n >= PROV_GAMES);
export const PROV_SQL = (rd = 'rd', n = 'n') => `(${rd} > ${G2.provisional} AND ${n} < ${PROV_GAMES})`;
// time control -> rating pool (Lichess's estimated duration: minutes*60 + 40*increment; < 8 min blitz, else rapid)
export function poolOf(tc) {
  const m = /^(\d+)\+(\d+)$/.exec(String(tc || ''));
  if (!m) return null; // untimed games are casual
  const est = +m[1] * 60 + 40 * +m[2];
  return est < 180 ? 'bullet' : est < 480 ? 'blitz' : 'rapid';
}
// v1.9: Bullet (1+0, 2+1) has its own pool; it was already mapped here but had no time control to play it
export const POOLS = ['bullet', 'blitz', 'rapid'];
