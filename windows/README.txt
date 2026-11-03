Kingside Chess for Windows (Electron), v1.8.0.
www/ = the web-site files without worker.mjs, tab-site.json, sw.js and manifest.webmanifest, plus desktop-bridge.js
(index.html loads desktop-bridge.js before game.css and drops the manifest/apple-touch-icon links). Copy them in before building (sh sync-www.sh ../web-site does it).
main.js answers every page file from the bundled www/ under the game's own address (https://sonujeet-chess.sites.tab.bot/),
so it works offline; only /api/ goes to the live server.
Build:  npm install && npx electron-builder --win --x64   (on Linux: needs wine for the exe's icon/version)
Output: dist/KingsideChess-Setup-1.8.0.exe (NSIS, per-user install, Start menu + desktop shortcut). Unsigned.
