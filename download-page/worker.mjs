const WIN_PARTS = [["/pkg/win/kw190.000.bin",880000],["/pkg/win/kw190.001.bin",880000],["/pkg/win/kw190.002.bin",880000],["/pkg/win/kw190.003.bin",880000],["/pkg/win/kw190.004.bin",880000],["/pkg/win/kw190.005.bin",880000],["/pkg/win/kw190.006.bin",880000],["/pkg/win/kw190.007.bin",880000],["/pkg/win/kw190.008.bin",880000],["/pkg/win/kw190.009.bin",880000],["/pkg/win/kw190.010.bin",880000],["/pkg/win/kw190.011.bin",880000],["/pkg/win/kw190.012.bin",880000],["/pkg/win/kw190.013.bin",880000],["/pkg/win/kw190.014.bin",880000],["/pkg/win/kw190.015.bin",880000],["/pkg/win/kw190.016.bin",880000],["/pkg/win/kw190.017.bin",880000],["/pkg/win/kw190.018.bin",880000],["/pkg/win/kw190.019.bin",880000],["/pkg/win/kw190.020.bin",880000],["/pkg/win/kw190.021.bin",880000],["/pkg/win/kw190.022.bin",880000],["/pkg/win/kw190.023.bin",880000],["/pkg/win/kw190.024.bin",880000],["/pkg/win/kw190.025.bin",880000],["/pkg/win/kw190.026.bin",880000],["/pkg/win/kw190.027.bin",880000],["/pkg/win/kw190.028.bin",880000],["/pkg/win/kw190.029.bin",880000],["/pkg/win/kw190.030.bin",880000],["/pkg/win/kw190.031.bin",880000],["/pkg/win/kw190.032.bin",880000],["/pkg/win/kw190.033.bin",880000],["/pkg/win/kw190.034.bin",880000],["/pkg/win/kw190.035.bin",880000],["/pkg/win/kw190.036.bin",880000],["/pkg/win/kw190.037.bin",880000],["/pkg/win/kw190.038.bin",880000],["/pkg/win/kw190.039.bin",880000],["/pkg/win/kw190.040.bin",880000],["/pkg/win/kw190.041.bin",880000],["/pkg/win/kw190.042.bin",880000],["/pkg/win/kw190.043.bin",880000],["/pkg/win/kw190.044.bin",880000],["/pkg/win/kw190.045.bin",880000],["/pkg/win/kw190.046.bin",880000],["/pkg/win/kw190.047.bin",880000],["/pkg/win/kw190.048.bin",880000],["/pkg/win/kw190.049.bin",880000],["/pkg/win/kw190.050.bin",880000],["/pkg/win/kw190.051.bin",880000],["/pkg/win/kw190.052.bin",880000],["/pkg/win/kw190.053.bin",880000],["/pkg/win/kw190.054.bin",880000],["/pkg/win/kw190.055.bin",880000],["/pkg/win/kw190.056.bin",880000],["/pkg/win/kw190.057.bin",880000],["/pkg/win/kw190.058.bin",880000],["/pkg/win/kw190.059.bin",880000],["/pkg/win/kw190.060.bin",880000],["/pkg/win/kw190.061.bin",880000],["/pkg/win/kw190.062.bin",880000],["/pkg/win/kw190.063.bin",880000],["/pkg/win/kw190.064.bin",880000],["/pkg/win/kw190.065.bin",880000],["/pkg/win/kw190.066.bin",880000],["/pkg/win/kw190.067.bin",880000],["/pkg/win/kw190.068.bin",880000],["/pkg/win/kw190.069.bin",880000],["/pkg/win/kw190.070.bin",880000],["/pkg/win/kw190.071.bin",880000],["/pkg/win/kw190.072.bin",880000],["/pkg/win/kw190.073.bin",880000],["/pkg/win/kw190.074.bin",880000],["/pkg/win/kw190.075.bin",880000],["/pkg/win/kw190.076.bin",880000],["/pkg/win/kw190.077.bin",880000],["/pkg/win/kw190.078.bin",880000],["/pkg/win/kw190.079.bin",880000],["/pkg/win/kw190.080.bin",880000],["/pkg/win/kw190.081.bin",880000],["/pkg/win/kw190.082.bin",880000],["/pkg/win/kw190.083.bin",880000],["/pkg/win/kw190.084.bin",880000],["/pkg/win/kw190.085.bin",880000],["/pkg/win/kw190.086.bin",880000],["/pkg/win/kw190.087.bin",880000],["/pkg/win/kw190.088.bin",880000],["/pkg/win/kw190.089.bin",880000],["/pkg/win/kw190.090.bin",880000],["/pkg/win/kw190.091.bin",880000],["/pkg/win/kw190.092.bin",880000],["/pkg/win/kw190.093.bin",880000],["/pkg/win/kw190.094.bin",880000],["/pkg/win/kw190.095.bin",880000],["/pkg/win/kw190.096.bin",880000],["/pkg/win/kw190.097.bin",880000],["/pkg/win/kw190.098.bin",880000],["/pkg/win/kw190.099.bin",880000],["/pkg/win/kw190.100.bin",880000],["/pkg/win/kw190.101.bin",880000],["/pkg/win/kw190.102.bin",880000],["/pkg/win/kw190.103.bin",880000],["/pkg/win/kw190.104.bin",880000],["/pkg/win/kw190.105.bin",880000],["/pkg/win/kw190.106.bin",880000],["/pkg/win/kw190.107.bin",880000],["/pkg/win/kw190.108.bin",880000],["/pkg/win/kw190.109.bin",880000],["/pkg/win/kw190.110.bin",880000],["/pkg/win/kw190.111.bin",880000],["/pkg/win/kw190.112.bin",880000],["/pkg/win/kw190.113.bin",880000],["/pkg/win/kw190.114.bin",880000],["/pkg/win/kw190.115.bin",880000],["/pkg/win/kw190.116.bin",880000],["/pkg/win/kw190.117.bin",880000],["/pkg/win/kw190.118.bin",880000],["/pkg/win/kw190.119.bin",880000],["/pkg/win/kw190.120.bin",880000],["/pkg/win/kw190.121.bin",880000],["/pkg/win/kw190.122.bin",880000],["/pkg/win/kw190.123.bin",880000],["/pkg/win/kw190.124.bin",880000],["/pkg/win/kw190.125.bin",880000],["/pkg/win/kw190.126.bin",880000],["/pkg/win/kw190.127.bin",880000],["/pkg/win/kw190.128.bin",880000],["/pkg/win/kw190.129.bin",880000],["/pkg/win/kw190.130.bin",334706]];
const WIN_SIZE = 114734706;
const WIN_NAME = 'KingsideChess-Setup-1.9.0.exe';

async function serveWindows(request, env, url) {
  const base = {
    'content-type': 'application/vnd.microsoft.portable-executable',
    'content-disposition': 'attachment; filename="' + WIN_NAME + '"',
    'cache-control': 'public, max-age=300',
    'accept-ranges': 'bytes',
    'x-content-sha256': 'bc86b1c92c623e1cd772a3be8bc07a745c0f0195dbdfe6b53d3b6aba997f08fc',
  };
  let start = 0, end = WIN_SIZE - 1, status = 200;
  const range = request.headers.get('range');
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (m && (m[1] !== '' || m[2] !== '')) {
      if (m[1] === '') { start = Math.max(0, WIN_SIZE - parseInt(m[2], 10)); }
      else { start = parseInt(m[1], 10); if (m[2] !== '') end = Math.min(WIN_SIZE - 1, parseInt(m[2], 10)); }
      if (start > end || start >= WIN_SIZE) return new Response('', { status: 416, headers: { 'content-range': 'bytes */' + WIN_SIZE } });
      status = 206;
      base['content-range'] = 'bytes ' + start + '-' + end + '/' + WIN_SIZE;
    }
  }
  base['content-length'] = String(end - start + 1);
  if (request.method === 'HEAD') return new Response(null, { status, headers: base });
  const { readable, writable } = new FixedLengthStream(end - start + 1);
  (async () => {
    const want = [];
    let off = 0;
    for (const [p, len] of WIN_PARTS) {
      const pStart = off, pEnd = off + len - 1; off += len;
      if (pEnd < start || pStart > end) continue;
      want.push([p, pStart, pEnd]);
    }
    const get = (i) => i < want.length ? env.ASSETS.fetch(new Request(new URL(want[i][0], url))).then(async (res) => {
      if (!res.ok) throw new Error('part ' + want[i][0] + ' ' + res.status);
      return new Uint8Array(await res.arrayBuffer());
    }) : null;
    try {
      const w = writable.getWriter();
      let next = get(0), next2 = get(1);
      for (let i = 0; i < want.length; i++) {
        let buf = await next; next = next2; next2 = get(i + 2);
        const [, pStart, pEnd] = want[i];
        const a = Math.max(start, pStart) - pStart, b = Math.min(end, pEnd) - pStart + 1;
        if (a !== 0 || b !== buf.length) buf = buf.subarray(a, b);
        await w.write(buf);
      }
      w.releaseLock();
      await writable.close();
    } catch (e) { try { await writable.abort(e); } catch (er) {} }
  })();
  return new Response(readable, { status, headers: base });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/KingsideChess.apk') {
      const res = await env.ASSETS.fetch(new Request(new URL('/pkg/kingside-chess-v1-9-0.bin', url), request));
      const h = new Headers(res.headers);
      h.set('content-type', 'application/vnd.android.package-archive');
      h.set('content-disposition', 'attachment; filename="KingsideChess.apk"');
      h.set('cache-control', 'public, max-age=300');
      return new Response(res.body, { status: res.status, headers: h });
    }
    if (url.pathname === '/KingsideChess-Setup.exe' || url.pathname === '/' + WIN_NAME) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
      return serveWindows(request, env, url);
    }
    if (url.pathname.startsWith('/pkg/win/')) return new Response('Not found', { status: 404 });
    return env.ASSETS.fetch(request);
  },
};
