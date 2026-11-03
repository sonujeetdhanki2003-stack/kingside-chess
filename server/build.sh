#!/bin/sh
# bundles the game server (with chess.js) into the site's Worker entry
cd "$(dirname "$0")" && npx esbuild worker.src.js --bundle --format=esm --minify --target=es2022 --outfile=../site/worker.mjs --legal-comments=inline
