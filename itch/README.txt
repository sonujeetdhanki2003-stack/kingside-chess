itch.io browser build (added for the itch.io release)
- itch-bridge.js: loaded before the game. It turns on itch mode (window.__kingsideItch), sends every /api/ call
  to the live server https://sonujeet-chess.sites.tab.bot (its API allows any origin, so CORS works from *.itch.zone),
  and makes invite/share links point to the live site instead of itch.zone.
- make-itch-build.py: copies ../web-site, applies the small itch patches (no service worker, no PWA manifest,
  in-page links that stay inside the itch frame, full credits) and zips it with index.html at the root.
- No SharedArrayBuffer needed: Stockfish 19 Lite runs single-threaded.
