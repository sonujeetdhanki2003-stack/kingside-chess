// Opening names from the Lichess chess-openings dataset (CC0), looked up by position so transpositions work.
let data = null, loading = null;
export function loadOpenings() {
  if (data) return Promise.resolve(data);
  if (!loading) loading = fetch('data/openings.json').then((r) => r.json()).then((d) => (data = d)).catch(() => { loading = null; return null; });
  return loading;
}
const key = (fen) => fen.split(' ').slice(0, 3).join(' ');
// fens: positions after each move, oldest first. Returns { eco, name, ply } of the deepest named position.
export function openingFor(fens) {
  if (!data) return null;
  for (let i = Math.min(fens.length, 40) - 1; i >= 0; i--) {
    const k = data.p[key(fens[i])];
    if (k !== undefined) { const s = data.n[k]; return { eco: s.slice(0, 3), name: s.slice(4), ply: i + 1 }; }
  }
  return null;
}
export const isBook = (fen) => !!data && data.p[key(fen)] !== undefined;
export const ready = () => !!data;
