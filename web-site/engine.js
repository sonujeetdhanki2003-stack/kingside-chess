// Play-vs-computer engine: Stockfish 19 Lite (NNUE, single-threaded WASM, ~1.8 MB, cached for offline use),
// with the bundled Stockfish 10 as the fallback when SF19 cannot load or run on this phone.
// Weak levels play "humanly": the engine lists its top few moves (MultiPV) and we pick one with a
// probability that falls off with how much worse it is, plus the odd outright slip.
const SF19 = { name: 'Stockfish 19 Lite', js: 'engine/sf19/stockfish-19-lite-single.js', wasm: 'engine/sf19/stockfish-19-lite-single.wasm', nnue: true, size: 1845971 };
const SF10 = { name: 'Stockfish 10', js: 'engine/stockfish.js', wasm: 'engine/stockfish.wasm', nnue: false, size: 366900 };
export class Engine {
  constructor() {
    this.worker = null; this.ready = false; this.failed = false; this.info = null;
    this.current = null; this.queued = null; this.opt = {}; this.onReady = null; this.progress = 0;
  }
  async start() {
    if (this.worker || this.failed || this.starting) return;
    this.starting = true;
    for (const e of [SF19, SF10]) {
      try { await this.boot(e); this.info = e; this.ready = true; this.onReady && this.onReady(); this.pump(); return; }
      catch (err) { this.kill(); }
    }
    this.fail();
  }
  async boot(e) {
    if (typeof WebAssembly !== 'object') throw new Error('no wasm');
    // fetch both files here (the offline cache serves them), then hand the worker in-memory copies
    const bin = await this.download(e.wasm, e.size);
    const src = await fetch(e.js).then((r) => { if (!r.ok) throw new Error(e.js + ' ' + r.status); return r.text(); });
    if (bin.byteLength !== e.size) throw new Error('engine size mismatch ' + bin.byteLength);
    if (!WebAssembly.validate(new Uint8Array(bin))) throw new Error('wasm not supported here');
    this.progress = 1; this.onProgress && this.onProgress(1);
    const wasmUrl = URL.createObjectURL(new Blob([bin], { type: 'application/wasm' }));
    const script = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    await new Promise((resolve, reject) => {
      const w = new Worker(script + '#' + (e.nnue ? encodeURIComponent(wasmUrl) + ',' : wasmUrl));
      this.worker = w; this.opt = {};
      const timer = setTimeout(() => reject(new Error('engine start timeout')), 25000);
      w.onerror = () => { clearTimeout(timer); reject(new Error('engine worker error')); };
      w.onmessage = (m) => {
        const line = String(m.data);
        if (line === 'uciok') { w.postMessage('setoption name Hash value 16'); w.postMessage('isready'); }
        else if (line === 'readyok') {
          clearTimeout(timer);
          w.onmessage = (mm) => this.onLine(String(mm.data));
          w.onerror = () => this.fail();
          resolve();
        }
      };
      w.postMessage('uci');
    });
  }
  async download(url, size) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(url + ' ' + res.status);
    const total = +res.headers.get('content-length') || size || 0;
    if (!res.body || !total) return res.arrayBuffer();
    const reader = res.body.getReader(); const parts = []; let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value); got += value.length;
      this.progress = Math.min(0.99, got / total); this.onProgress && this.onProgress(this.progress);
    }
    const out = new Uint8Array(got); let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out.buffer;
  }
  kill() { try { this.worker && this.worker.terminate(); } catch (e) {} this.worker = null; this.ready = false; }
  fail() {
    this.failed = true; this.kill();
    const cur = this.current; this.current = null;
    if (cur) cur.resolve(null);
    if (this.queued) { this.queued.resolve(null); this.queued = null; }
    this.onReady && this.onReady();
  }
  get name() { return this.info ? this.info.name : ''; }
  send(cmd) { this.worker && this.worker.postMessage(cmd); }
  setOpt(k, v) { if (this.opt[k] !== v) { this.opt[k] = v; this.send(`setoption name ${k} value ${v}`); } }
  newGame() { if (this.ready) { this.send('ucinewgame'); this.send('isready'); } }
  // cfg: { skill, depth, movetime } | { elo, movetime } | { multipv, depth, temp, blunder }
  bestMove(fen, cfg) {
    if (this.failed) return Promise.resolve(null);
    return new Promise((resolve) => {
      if (this.queued) this.queued.resolve(null);
      this.queued = { fen, cfg: cfg || {}, resolve, lines: [] };
      if (this.current) { this.current.cancelled = true; this.current.resolve(null); this.send('stop'); }
      else this.pump();
    });
  }
  cancel() {
    if (this.queued) { this.queued.resolve(null); this.queued = null; }
    if (this.current && !this.current.cancelled) { this.current.cancelled = true; this.current.resolve(null); this.send('stop'); }
  }
  pump() {
    if (!this.ready || this.current || !this.queued) return;
    const job = this.queued; this.queued = null; this.current = job;
    const c = job.cfg;
    const nnue = this.info && this.info.nnue;
    this.setOpt('MultiPV', c.multipv || 1);
    if (c.elo && nnue) { this.setOpt('Skill Level', 20); this.setOpt('UCI_LimitStrength', 'true'); this.setOpt('UCI_Elo', Math.max(1320, Math.min(3190, c.elo))); }
    else {
      if (nnue) this.setOpt('UCI_LimitStrength', 'false');
      // Stockfish 10 has no Elo limit: map the rating to its skill level
      this.setOpt('Skill Level', c.elo ? Math.max(0, Math.min(20, Math.round((c.elo - 1100) / 75))) : (c.skill ?? 20));
    }
    this.send('position fen ' + job.fen);
    if (c.depth) this.send('go depth ' + c.depth);
    else this.send('go movetime ' + (c.movetime || 1000));
    const limit = (c.movetime || 3000) + 12000;
    job.guard = setTimeout(() => { if (this.current === job) this.send('stop'); }, limit);
  }
  onLine(line) {
    const j = this.current;
    if (line.startsWith('info ') && j && line.includes(' pv ') && line.includes(' score ')) {
      if (line.includes('lowerbound') || line.includes('upperbound')) return;
      const t = line.split(' ');
      const g = (k) => { const i = t.indexOf(k); return i >= 0 ? t[i + 1] : null; };
      const k = +(g('multipv') || 1) - 1;
      const sc = t.indexOf('score');
      const cp = t[sc + 1] === 'cp' ? +t[sc + 2] : (+t[sc + 2] > 0 ? 100000 - 100 * +t[sc + 2] : -100000 - 100 * +t[sc + 2]);
      j.lines[k] = { cp, move: t[t.indexOf('pv') + 1] };
      return;
    }
    if (line.startsWith('bestmove')) {
      const mv = line.split(/\s+/)[1];
      const cur = this.current; this.current = null;
      if (cur) {
        clearTimeout(cur.guard);
        if (!cur.cancelled) cur.resolve(mv && mv !== '(none)' ? (cur.cfg.pick ? cur.cfg.pick(cur.lines, mv) : pickHuman(cur.lines, cur.cfg, mv)) : null);
      }
      this.pump();
    }
  }
}

// choose among the engine's top moves: softmax over centipawn loss (temperature `temp`), with an occasional slip
export function pickHuman(lines, cfg, best) {
  const ls = (lines || []).filter((l) => l && l.move);
  if (!cfg.multipv || cfg.multipv < 2 || ls.length < 2) return best;
  const top = Math.max(...ls.map((l) => l.cp));
  if (cfg.blunder && Math.random() < cfg.blunder) {
    // a slip: any listed move except one that throws away a forced mate for us or hangs mate
    const ok = ls.filter((l) => l.cp > -50000);
    return (ok.length ? ok : ls)[Math.floor(Math.random() * (ok.length || ls.length))].move;
  }
  const temp = cfg.temp || 50;
  const w = ls.map((l) => Math.exp(-Math.min(3000, top - l.cp) / temp));
  let r = Math.random() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < ls.length; i++) { r -= w[i]; if (r <= 0) return ls[i].move; }
  return ls[0].move;
}

// Tiny alpha-beta used only if the WASM engine cannot load (very old phones).
const V = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
export function fallbackMove(Chess, fen, depth = 2) {
  const g = new Chess(fen);
  const evalBoard = () => {
    let s = 0;
    for (const row of g.board()) for (const p of row) if (p) {
      const centre = 3.5 - Math.abs(3.5 - (p.square.charCodeAt(0) - 97)) + 3.5 - Math.abs(3.5 - (+p.square[1] - 1));
      s += (p.color === 'w' ? 1 : -1) * (V[p.type] + (p.type === 'k' ? 0 : centre * 4));
    }
    return s;
  };
  const search = (d, a, b) => {
    if (g.isCheckmate()) return g.turn() === 'w' ? -100000 - d : 100000 + d;
    if (g.isDraw()) return 0;
    if (d === 0) return evalBoard();
    const moves = g.moves({ verbose: true });
    if (g.turn() === 'w') {
      let best = -Infinity;
      for (const m of moves) { g.move(m); best = Math.max(best, search(d - 1, a, b)); g.undo(); a = Math.max(a, best); if (a >= b) break; }
      return best;
    }
    let best = Infinity;
    for (const m of moves) { g.move(m); best = Math.min(best, search(d - 1, a, b)); g.undo(); b = Math.min(b, best); if (a >= b) break; }
    return best;
  };
  const moves = g.moves({ verbose: true }).sort(() => Math.random() - 0.5);
  if (!moves.length) return null;
  const white = g.turn() === 'w';
  let bestM = moves[0], bestS = white ? -Infinity : Infinity;
  for (const m of moves) {
    g.move(m); const s = search(depth - 1, -Infinity, Infinity); g.undo();
    if (white ? s > bestS : s < bestS) { bestS = s; bestM = m; }
  }
  return bestM.from + bestM.to + (bestM.promotion || '');
}
