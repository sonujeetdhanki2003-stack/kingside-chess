#!/bin/sh
# Copies ../web-site into www/ for the Windows (Electron) app: no worker/PWA files; index.html loads desktop-bridge.js.
# Usage (from the folder holding package.json, main.js, desktop-bridge.js): sh sync-www.sh /path/to/web-site
set -e
SITE="${1:-../web-site}"
rm -rf www && mkdir -p www
(cd "$SITE" && tar cf - --exclude=worker.mjs --exclude=tab-site.json --exclude=sw.js --exclude=manifest.webmanifest .) | (cd www && tar xf -)
cp desktop-bridge.js www/desktop-bridge.js
python3 - <<'EOF'
p = 'www/index.html'; s = open(p, encoding='utf-8').read()
a = '<link rel="apple-touch-icon" href="icon-180.png">\n<link rel="manifest" href="manifest.webmanifest">\n'
assert a in s; s = s.replace(a, '<script src="desktop-bridge.js"></script>\n'); open(p, 'w', encoding='utf-8').write(s)
EOF
echo synced
