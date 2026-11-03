Kingside Chess v1.9.0 source (v1.9: rating changes after every game, rating graph, Bullet rating, rank titles; v1.8.3: Quick Match timer fix + search in the background, see below; v1.8.2: bug fixes; v1.8.1: avatars buyable/wearable in the Shop, active board/pieces/avatar/frame marked; v1.8 added Crowns 👑: free-earned coins, a server wallet with a full ledger, and the Crown Shop) — on top of v1.7 ratings/bots/share/streaks, v1.6 Learn, v1.4 Stockfish 19, v1.3 redesign
web-site/      the deployable site (Cloudflare Worker + D1). worker.mjs is built from server/ with server/build.sh (needs esbuild: npm i esbuild).
server/        worker.src.js (rooms, tournaments) + accounts.src.js (accounts, quick match, friends, challenges).
test/          Playwright test scripts used for each wave (test/harness).
android/       the Android WebView app project. build.sh builds, sign.sh signs with the release keystore (kept separately, not in this zip).
download-page/ the kingside-chess-app landing page (the APK goes in pkg/kingside-chess-v1-8.bin; the Windows installer is split into pkg/win/kw180.NNN.bin parts listed in worker.mjs).
Piece-set and engine credits: web-site/pieces/CREDITS.txt, web-site/engine/*/COPYING.txt

UI files added in v1.3: web-site/ui.css (layered over game.css). The views code (home hub, tab bar, More menu, back button) is in web-site/game.js under 'views'.
The Android assets in android/assets/www are the web-site files plus app-bridge.js (index.html adds <script src="app-bridge.js">, without the manifest/apple-touch-icon links).

Added in v1.4:
web-site/engine.js    Engine class: Stockfish 19 Lite first, Stockfish 10 as fallback; pickHuman() for the human-like low levels. Levels are in game.js (LEVELS).
web-site/progress.js  streaks (IST days) + 19 achievements, unlock toast, local storage for guests, synced to the account via /api/u/progress.
web-site/puzzles.js   Puzzle Rush (rushIntro/startRush/endRush); server side is rApi in server/accounts.src.js (/api/r/submit, /api/r/top, /api/r/forget).
web-site/i18n.js      English/Hindi: dictionary + patterns, applied to the DOM by a MutationObserver. Language row in More; storage key kingside-lang.
server: pulse table + f/wait long-poll (friends, challenges, presence) and q/poll hold (quick match); signups 60/hour + 300/day per IP.
test/harness: rt.py (realtime), rush.py, ach.py, hindi.py, sweep.py (360/412 px), apptest14.py (APK assets offline).

Added in v1.5 (Game Review accuracy):
web-site/review.js   Lichess's own rules: win% curve, inaccuracy/mistake/blunder at win-chance drops of 0.1/0.2/0.3 (5/10/15 win% points)
                     plus its forced-mate rules, and Lichess's game accuracy (volatility-weighted mean + harmonic mean).
                     Brilliant = best move + a new, real sacrifice, still sound, not already winning, not escaping check or a fork.
                     Great = best move that is the only good one (2nd best >= 20 win% worse) in an open position, not a recapture.
                     Second pass: Brilliant/Great candidates first, then the costliest moves, at most 16 positions, 1.3 s each.
                     Review cache key bumped to kingside-review-v3; sw.js VERSION kingside-v13.
test/review-bench/   the 28-game benchmark (games.json with Lichess judgments + accuracy, deep.json deep Stockfish evals,
                     bench.py = live-site phone-path run).

Added for the itch.io release:
itch/            the itch.io browser build: itch-bridge.js + make-itch-build.py (see itch/README.txt).
windows/         the Electron Windows app (NSIS installer via electron-builder).
CREDITS.txt      every bundled asset with its author and licence.
LICENSE-GPLv3.txt  Kingside Chess is distributed under the GNU GPL v3 (it bundles Stockfish, GPLv3).

Added in v1.6 (Learn):
web-site/learn.js        the Learn screen: lesson list with ✅ and % per chapter, Continue, the lesson player (explanation, the learner
                         makes the moves, try again / Hint / scripted replies), stars mode for piece moves, and "play it out" goals
                         against Stockfish (mate, promote, catch the pawn). Progress: localStorage kingside-learn-v1 + account
                         counters ln_<lesson> (progress.js setCounter, synced by /api/u/progress, no server change).
web-site/learn-data.js   the 35 lessons (Basics 12, Tactics 5, Checkmate patterns 5, Openings 8, Endgames 5), English + Hindi.
web-site/i18n.js         Learn UI strings in Hindi; set('hi') fires a 'kingside-lang' event so open lessons re-render.
web-site/CREDITS.txt, web-site/licenses/   full credits on the site, APK and Windows app (credits line in index.html fixed).
test/learn.test.mjs      node --test: every lesson loads, every scripted move is legal, stars reachable, EN+HI text.
test/learn_verify.py     Stockfish check: learner moves are the best/winning ones, goals are real wins (pip install chess).
test/harness/learn.py    browser run of every lesson through the real UI code (add --real-clicks to tap the squares,
                         --assets DIR to run an unzipped APK's assets offline).
android/sync-www.sh, windows/sync-www.sh   copy web-site into the app projects. sw.js VERSION kingside-v14.
Note: test/site.test.mjs reads ../site; run it with a symlink: ln -s web-site site && node --test test/

Fixed in v1.8.2:
- Gold & Onyx and Ruby & Ivory piece sets never showed on the game board (game.css had no rules for them); added.
- A worn avatar now shows on the home greeting and in your own player bar (game.js), not only the top bar/profile.
- Locked bots show their Crown price in the bot picker.
- Long names no longer push the profile settings gear off screen; long @usernames stay inside leaderboard rows.
- Leaderboard rows showed two avatars (worn avatar + letter tile); now one. "Your rank" shows the worn avatar (server accounts.src.js).
- Website/PWA: phone Back closes an open sheet instead of leaving the game (game.js; apps keep window.__kingsideBack).
- Hindi: a few strings that stayed English (how-to-earn note, profile Crown Shop line, "rating").
- Service worker cache bumped to kingside-v18.

Fixed in v1.8.1:
- Avatars: the Shop looked items up by type+value but an avatar's value is its emoji, so every avatar looked owned (Wear, no price) and the server refused. Now looked up by type+value (crowns-data.js itemOf), each avatar shows its price; "buy it first" opens that item.
- The board / piece set in use is marked with a ring and ✓ in Settings, and "✓ In use" / "✓ Wearing" in the Shop.

Added in v1.8 (Crowns):
web-site/crowns-data.js  the shared catalogue: earn amounts + daily caps (EARN), shop items + prices (ITEMS), free reviews per day, streak-freeze cap. Server and app both read it.
web-site/crowns.js       the app side: top-bar balance, "+N 👑" animation, Crown Shop / Crown history / How to earn screens, locks on premium boards, pieces and bots, the review gate.
server/crowns.src.js     the wallet: D1 tables crown_ledger (every earn/spend, unique per owner+kind+ref so nothing pays twice), crown_items, crown_init, crown_days, crown_seen, crown_reviews, crown_rate.
                         Every reward is checked on the server (bot wins are replayed move by move and must end in checkmate; the daily puzzle is re-derived and its solution checked; lessons pay once).
                         Guests earn on a device id and their Crowns move into the account on sign-up. /api/c/... endpoints.
web-site/pieces/gold, web-site/pieces/ruby  recolours of the cburnett set (GPLv2+, see web-site/pieces/CREDITS.txt).
test/api_crowns.py       server tests for the earn rules, caps, replays, forged requests, balance, purchases on two devices, the welcome gift.

Fixed / added in v1.8.3 (Quick Match):
- The search timer jumped (0:00, 0:06, 0:13…): it was redrawn only when the 6 s server long-poll answered. It now has its own
  ticker drawn from Date.now() 4x a second (account.js renderSeekTime), so it is right after navigating, after the screen dims
  and after the app comes back from the background; the 30 s "play the computer" offer comes from the same ticker (it waited
  for a poll, up to ~36 s).
- The search runs in the background: "Browse while searching" (or Back, or tapping outside the card) puts the card away and a bar
  pinned to the top (#seekbar, body.seeking moves every header down by its height) shows the time and a ✕; tapping it reopens
  the card. The 30 s offer shows under the bar when the card is away.
- A match found from any screen shows "Match found!" (#match-found) with a 4 s countdown, Play now and Decline, plus the existing
  notify sound/vibration. Decline sends the new room action "abort" (server worker.src.js: Quick Match only, before both sides
  have moved): the room ends with reason "aborted", nothing is rated, recorded or paid (accounts.src.js recordRoomGame skips it),
  and the other player's app goes home and searches again.
- Starting any other game (new game, bot, friend room, challenge) while searching stops the search (game.js stopQuickSearch).
- Learn closes when a found game opens. Hindi strings for all of the above. Service worker cache kingside-v19.
- Tests: test/api_decline.py (API), test/harness/rt.py updated for the match-found prompt.

Added in v1.9.0 (ratings):
- Bullet: time controls 1+0 and 2+1 (server/worker.src.js TCS, web-site/game.js TCS), their own Glicko-2 pool 'bullet'
  (server/glicko2.js POOLS). In Quick Match, friend challenges and invite rooms.
- Provisional ("1500?"): RD > 110 and fewer than 10 rated games in the pool (server/glicko2.js isProv / PROV_SQL).
- Result screen (game.js renderResultRating/showRatingChange): the rating counts up from old to new, "+8" green / "−12" red,
  the rank badge and how far the next rank is. /api/u/rres also answers p0 (provisional before) and n (games in the pool);
  games carry wrd0/brd0 (RD before the game; new columns, added by migration).
- web-site/ranks.js: Bronze <1000, Silver, Gold 1200, Platinum 1400, Diamond 1600, Master 1800, Grandmaster 2000+; SVG shield
  icons; badges on the profile, leaderboard (+ a ranks ladder), in-game player bars, home avatar. "Promoted to Gold!" /
  "You're Gold!" (placement complete) celebration once per game (game.js showRankUp), sound 'rankup' (sound.js).
- Profile rating graph (account.js ratingGraph): SVG, Bullet/Blitz/Rapid tabs, 30 days / 90 days / all time, peak marked,
  rank lines; the profile API returns the newest 3000 history points. One-time migration 'hist_v19' (accounts.src.js
  backfillHist) adds a history point for any rated game that has none (nothing existing changes).
- Hindi for every new string (i18n.js). Service worker cache kingside-v20.
- Tests: test/api_v19.py (API + migration: seed with the old server, check after the upgrade), test/harness/ui19.py (phone UI,
  two accounts, rated games, screenshots), test/glicko.test.mjs (provisional rule). test/harness/serve.mjs now reports last_row_id.
