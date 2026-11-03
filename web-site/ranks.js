// v1.9 rank titles from a Glicko-2 rating: Bronze → Grandmaster. A provisional rating ("1500?") has no rank yet
// ("Placement"): the rank appears once the rating settles (RD ≤ 110, like Lichess's provisional rule).
export const RANKS = [
  { id: 'bronze', name: 'Bronze', min: 0, c: '#c98a55', d: '#7a4a24' },
  { id: 'silver', name: 'Silver', min: 1000, c: '#cfd6de', d: '#6c7783' },
  { id: 'gold', name: 'Gold', min: 1200, c: '#f3c64d', d: '#9a6a0c' },
  { id: 'platinum', name: 'Platinum', min: 1400, c: '#6fdcc8', d: '#1f7a6c' },
  { id: 'diamond', name: 'Diamond', min: 1600, c: '#7cb8ff', d: '#2a5fae' },
  { id: 'master', name: 'Master', min: 1800, c: '#c493ff', d: '#6a35b0' },
  { id: 'grandmaster', name: 'Grandmaster', min: 2000, c: '#ff7a6b', d: '#a8261c' },
];
export const rankIndex = (r) => { let i = 0; for (let k = 0; k < RANKS.length; k++) if (r >= RANKS[k].min) i = k; return i; };
// x = { r, p } (a rating as the server sends it); null when provisional or unknown
export const rankOf = (x) => (x && x.r != null && !x.p ? RANKS[rankIndex(x.r)] : null);
export const nextRank = (x) => { const k = x && x.r != null ? rankIndex(x.r) : -1; return k >= 0 && k < RANKS.length - 1 ? RANKS[k + 1] : null; };

// the shield icon (no gradients, so many copies on one page never clash)
export function rankIcon(rk, size = 18) {
  if (!rk) return `<svg class="rk-ic rk-ic-p" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 4 5v6.2c0 5 3.4 9 8 10.8 4.6-1.8 8-5.8 8-10.8V5z" fill="#4a4743" stroke="#6d6964" stroke-width="1.2"/><text x="12" y="16.2" text-anchor="middle" font-size="11" font-weight="800" fill="#cfcac4" font-family="system-ui,sans-serif">?</text></svg>`;
  const k = RANKS.indexOf(rk);
  const chev = (y) => `<path d="M7.6 ${y + 2.6} 12 ${y} 16.4 ${y + 2.6}v2L12 ${y + 2}l-4.4 2.6z" fill="${rk.d}"/>`;
  const emblem = k === 6 ? `<path d="M7.2 15.2 6.4 9.2l3.2 2.5L12 7.6l2.4 4.1 3.2-2.5-.8 6z" fill="${rk.d}"/>` // grandmaster: a crown
    : k === 5 ? `<path d="M12 6.6l1.6 3.3 3.6.5-2.6 2.5.6 3.6-3.2-1.7-3.2 1.7.6-3.6-2.6-2.5 3.6-.5z" fill="${rk.d}"/>` // master: a star
    : k === 4 ? `<path d="M12 6.6 16.6 11.2 12 16.8 7.4 11.2z" fill="${rk.d}"/><path d="M12 6.6 16.6 11.2H7.4z" fill="#fff" opacity=".35"/>` // diamond
    : k === 3 ? `<path d="M12 6.8 16 9.1v4.6L12 16l-4-2.3V9.1z" fill="${rk.d}"/><path d="M12 6.8 16 9.1 12 11.4 8 9.1z" fill="#fff" opacity=".3"/>` // platinum: a gem
    : [[10.2], [8.4, 11.8], [6.8, 10.2, 13.6]][k].map(chev).join(''); // bronze 1, silver 2, gold 3 chevrons
  return `<svg class="rk-ic rk-${rk.id}" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 4 5v6.2c0 5 3.4 9 8 10.8 4.6-1.8 8-5.8 8-10.8V5z" fill="${rk.c}" stroke="${rk.d}" stroke-width="1.2"/><path d="M12 3.3 5.3 5.8v5.4c0 1.7.4 3.3 1.2 4.7L12 3.3z" fill="#fff" opacity=".22"/>${emblem}</svg>`;
}
// a pill: icon + name ("Gold"); provisional shows "Placement" (or nothing when quiet)
export function rankBadge(x, opts = {}) {
  const rk = rankOf(x);
  if (!rk && (opts.quiet || !x)) return '';
  const name = rk ? rk.name : 'Placement';
  return `<span class="rk-badge ${rk ? 'rkb-' + rk.id : 'rkb-prov'}${opts.cls ? ' ' + opts.cls : ''}" title="${rk ? name + ' rank' : 'Placement: play rated games until your rating settles'}">${rankIcon(rk, opts.size || 16)}<span>${name}</span></span>`;
}
// just the icon (leaderboard rows, player bars); nothing while provisional
export const rankMini = (x, size = 15) => { const rk = rankOf(x); return rk ? `<span class="rk-mini" title="${rk.name}">${rankIcon(rk, size)}</span>` : ''; };
