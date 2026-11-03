// Analysis engine: Stockfish 19 Lite (NNUE, single-threaded WASM, ~1.8 MB, loaded on first use and then
// cached for offline use). If it cannot run on this phone, the bundled Stockfish 10 does the analysis instead.
const ENGINES = [
  { name: 'Stockfish 19 Lite', short: 'SF 19', js: 'engine/sf19/stockfish-19-lite-single.js', wasm: 'engine/sf19/stockfish-19-lite-single.wasm', nnue: true },
  { name: 'Stockfish 10', short: 'SF 10', js: 'engine/stockfish.js', wasm: 'engine/stockfish.wasm', nnue: false },
];

export class Analyzer {
  constructor() {
    this.worker = null; this.ready = false; this.info = null; this.loading = null;
    this.job = null; this.queue = []; this.onProgress = null;
  }
  // resolves with the engine description that loaded, or null
  start() {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      for (const e of ENGINES) {
        try { await this.boot(e); this.info = e; return e; } catch (err) { this.kill(); }
      }
      return null;
    })();
    return this.loading;
  }
  async boot(e) {
    if (typeof WebAssembly !== 'object') throw new Error('no wasm');
    const bin = await this.download(e.wasm);
    const src = await fetch(e.js).then((r) => { if (!r.ok) throw new Error(e.js + ' ' + r.status); return r.text(); });
    if (!WebAssembly.validate(new Uint8Array(bin))) throw new Error('wasm not supported here');
    const wasmUrl = URL.createObjectURL(new Blob([bin], { type: 'application/wasm' }));
    const script = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    await new Promise((resolve, reject) => {
      const w = new Worker(script + '#' + (e.nnue ? encodeURIComponent(wasmUrl) + ',' : wasmUrl));
      this.worker = w;
      const timer = setTimeout(() => reject(new Error('engine start timeout')), 25000);
      w.onerror = (ev) => { clearTimeout(timer); reject(new Error('engine worker error')); };
      w.onmessage = (m) => {
        const line = String(m.data);
        if (line === 'uciok') { w.postMessage('setoption name Hash value 32'); w.postMessage('isready'); }
        else if (line === 'readyok') { clearTimeout(timer); w.onmessage = (mm) => this.onLine(String(mm.data)); this.ready = true; resolve(); }
      };
      w.postMessage('uci');
    });
  }
  // fetch with progress, so the first download can show a bar
  async download(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(url + ' ' + res.status);
    const total = +res.headers.get('content-length') || 0;
    if (!res.body || !total || !this.onProgress) return res.arrayBuffer();
    const reader = res.body.getReader(); const parts = []; let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value); got += value.length;
      this.onProgress(Math.min(1, got / total));
    }
    const out = new Uint8Array(got); let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out.buffer;
  }
  kill() { try { this.worker && this.worker.terminate(); } catch (e) {} this.worker = null; this.ready = false; }
  stop() {
    this.queue.forEach((j) => j.resolve(null)); this.queue = [];
    if (this.job) { this.job.cancelled = true; this.worker && this.worker.postMessage('stop'); }
  }
  // { fen, depth, movetime, multipv } -> { lines: [{ cp|mate (side to move), pv: [uci], depth }], best }
  analyse(opts) {
    return new Promise((resolve) => { this.queue.push({ ...opts, resolve, lines: [] }); this.pump(); });
  }
  pump() {
    if (!this.ready || this.job || !this.queue.length) return;
    const j = this.job = this.queue.shift();
    const w = this.worker;
    w.postMessage('setoption name MultiPV value ' + (j.multipv || 1));
    w.postMessage('position fen ' + j.fen);
    w.postMessage(`go depth ${j.depth || 18} movetime ${j.movetime || 1000}`);
    j.guard = setTimeout(() => w.postMessage('stop'), (j.movetime || 1000) + 8000);
  }
  onLine(line) {
    const j = this.job; if (!j) return;
    if (line.startsWith('info ') && line.includes(' pv ') && line.includes(' score ')) {
      const t = line.split(' ');
      const g = (k) => { const i = t.indexOf(k); return i >= 0 ? t[i + 1] : null; };
      if (line.includes('lowerbound') || line.includes('upperbound')) return;
      const k = +(g('multipv') || 1) - 1;
      const sc = t.indexOf('score');
      const entry = { depth: +g('depth'), pv: t.slice(t.indexOf('pv') + 1) };
      if (t[sc + 1] === 'cp') entry.cp = +t[sc + 2]; else entry.mate = +t[sc + 2];
      j.lines[k] = entry;
      if (j.onInfo) j.onInfo(j.lines);
    } else if (line.startsWith('bestmove')) {
      clearTimeout(j.guard);
      this.job = null;
      const best = line.split(/\s+/)[1];
      j.resolve(j.cancelled ? null : { lines: j.lines.filter(Boolean), best: best && best !== '(none)' ? best : null });
      this.pump();
    }
  }
}
