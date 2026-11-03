
globalThis.window={};
const { BOTS } = await import('./web-site/bots.js');
const { Chess } = await import('./web-site/vendor/chess.js');
import { readFileSync } from 'node:fs';
const book = JSON.parse(readFileSync('./web-site/data/openings.json'));
const key = (fen) => fen.split(' ').slice(0, 3).join(' ');
for (const b of BOTS) if (b.rep) for (const c of ['w','b']) for (const l of b.rep[c]) {
  const g = new Chess(); const names=[];
  for (const s of l.split(' ')) { g.move(s); const k = book.p[key(g.fen())]; names.push(k===undefined?'-':book.n[k].slice(0,40)); }
  if (names[names.length-1]==='-') console.log(b.id, c, l, '|', names.join(' / '));
}
