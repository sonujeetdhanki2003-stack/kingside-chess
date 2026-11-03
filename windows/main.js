// Kingside Chess for Windows (Electron). Like the Android app: the window opens the game's own address,
// every page file (HTML, JS, Stockfish WASM, pieces, puzzles) is answered from the files bundled in the app,
// and only /api/ (online play, accounts, tournaments) goes to the live server.
const { app, BrowserWindow, protocol, net, shell, Menu, session, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

const HOST = 'sonujeet-chess.sites.tab.bot';
const HOME = 'https://' + HOST + '/';
const WWW = path.join(__dirname, 'www');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.nnue': 'application/octet-stream', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };

app.setAppUserModelId('bot.tab.kingsidechess');
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

let win = null;

function bundled(u) {
  let p = decodeURIComponent(u.pathname || '/');
  if (p === '/' || p === '') p = '/index.html';
  if (p.includes('..')) return null;
  const f = path.join(WWW, p);
  if (!f.startsWith(WWW)) return null;
  try { if (fs.statSync(f).isFile()) return f; } catch (e) {}
  return null;
}

function setupProtocol() {
  protocol.handle('https', async (req) => {
    const u = new URL(req.url);
    if (u.host === HOST && req.method === 'GET' && !u.pathname.startsWith('/api/')) {
      if (u.pathname === '/sw.js') return new Response('', { status: 404 }); // no service worker: files are already local
      const f = bundled(u);
      if (f) {
        const body = await fs.promises.readFile(f);
        return new Response(body, { status: 200, headers: { 'content-type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream',
          'cache-control': 'no-cache', 'access-control-allow-origin': '*' } });
      }
    }
    // online play, accounts, tournaments, and anything not bundled: the network
    return net.fetch(req, { bypassCustomProtocolHandlers: true });
  });
}

function isGamePage(u) {
  return u.protocol === 'https:' && u.host === HOST && (u.pathname === '/' || u.pathname === '/index.html' || u.pathname === '');
}

function createWindow(startUrl) {
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 380, minHeight: 560,
    title: 'Kingside Chess', backgroundColor: '#312e2b', show: false, autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false, backgroundThrottling: false },
  });
  win.removeMenu();
  win.on('page-title-updated', (e) => { e.preventDefault(); win.setTitle('Kingside Chess'); });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    try { const u = new URL(url); if (isGamePage(u)) { win.loadURL(url); return { action: 'deny' }; } } catch (e) {}
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    try { if (isGamePage(new URL(url))) return; } catch (er) {}
    e.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });
  // mouse "back" button / Alt+Left: close the open sheet or step back, like the phone's back button
  const back = () => win.webContents.executeJavaScript('(function(){try{return !!(window.__kingsideBack&&window.__kingsideBack());}catch(e){return false;}})()').catch(() => {});
  win.on('app-command', (e, cmd) => { if (cmd === 'browser-backward') back(); });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    else if (input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r')) { win.reload(); e.preventDefault(); }
    else if (input.alt && input.key === 'ArrowLeft') { back(); e.preventDefault(); }
    else if (input.control && (input.key === '=' || input.key === '+')) { win.webContents.setZoomLevel(win.webContents.getZoomLevel() + 0.5); e.preventDefault(); }
    else if (input.control && input.key === '-') { win.webContents.setZoomLevel(win.webContents.getZoomLevel() - 0.5); e.preventDefault(); }
    else if (input.control && input.key === '0') { win.webContents.setZoomLevel(0); e.preventDefault(); }
    else if (input.control && input.shift && input.key.toLowerCase() === 'i' && process.env.KINGSIDE_DEVTOOLS) { win.webContents.openDevTools(); }
  });
  win.webContents.on('render-process-gone', () => { try { win.loadURL(HOME); } catch (e) {} });
  win.loadURL(startUrl || HOME);
}

function urlFromArgs(argv) {
  for (const a of argv || []) { try { const u = new URL(a); if (u.protocol === 'https:' && u.host === HOST) return u.toString(); } catch (e) {} }
  return null;
}

app.on('second-instance', (e, argv) => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
  const u = urlFromArgs(argv); if (u) win.loadURL(u);
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  const ua = session.defaultSession.getUserAgent().replace(/ Electron\/\S+/, '').replace(/ kingside-chess\/\S+/i, '');
  session.defaultSession.setUserAgent(ua + ' KingsideChessDesktop/' + app.getVersion());
  setupProtocol();
  // v1.7 Share your game: a saved GIF goes straight to Downloads\Kingside Chess and the folder opens with it selected
  session.defaultSession.on('will-download', (e, item) => {
    try {
      const dir = path.join(app.getPath('downloads'), 'Kingside Chess');
      fs.mkdirSync(dir, { recursive: true });
      const base = item.getFilename().replace(/[\\/:*?"<>|]/g, '-') || 'kingside-game.gif';
      let f = path.join(dir, base); const ext = path.extname(base); let n = 1;
      while (fs.existsSync(f)) f = path.join(dir, base.slice(0, base.length - ext.length) + ` (${n++})` + ext);
      item.setSavePath(f);
      item.once('done', (ev, state) => { if (state === 'completed') shell.showItemInFolder(f); });
    } catch (er) { /* fall back to the normal save dialog */ }
  });
  createWindow(urlFromArgs(process.argv));
});
app.on('window-all-closed', () => app.quit());
