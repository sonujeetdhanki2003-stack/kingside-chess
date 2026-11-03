
import Database from 'better-sqlite3';
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
const SITE = process.argv[2]; const PORT = +process.argv[3] || 8787;
const sq = new Database(process.argv[4] || ':memory:');
function conv(sql, args) {
  // turn ?N into positional with expanded args
  if (/\?\d/.test(sql)) { const out = []; sql = sql.replace(/\?(\d+)/g, (_, n) => { out.push(args[+n - 1]); return '?'; }); return [sql, out]; }
  return [sql, args];
}
class Stmt { constructor(sql) { this.sql = sql; this.args = []; } bind(...a) { this.args = a; return this; }
  _p() { const [s, a] = conv(this.sql, this.args); return [sq.prepare(s), a]; }
  async first() { const [p, a] = this._p(); return p.get(...a) || null; }
  async all() { const [p, a] = this._p(); return { results: p.all(...a) }; }
  async run() { const [p, a] = this._p(); if (p.reader) { p.all(...a); return { meta: { changes: 0 } }; } const r = p.run(...a); return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } }; } }
const DB = { prepare: (s) => new Stmt(s), batch: async (st) => { const o = []; for (const s of st) o.push(await s.run()); return o; } };
const MIME = { '.gif': 'image/gif', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };
const ASSETS = { fetch: async (req) => { const u = new URL(req.url); let p = u.pathname === '/' ? '/index.html' : u.pathname; const f = join(SITE, p);
  if (!existsSync(f) || statSync(f).isDirectory()) return new Response('nf', { status: 404 });
  return new Response(readFileSync(f), { headers: { 'content-type': MIME[extname(f)] || 'application/octet-stream' } }); } };
const mod = await import((process.env.WORKER || join(SITE, 'worker.mjs')) + '?v=' + Date.now());
http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const r = await mod.default.fetch(new Request('http://localhost:' + PORT + req.url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }), { DB, ASSETS });
  res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
}).listen(PORT, () => console.log('listening', PORT));
