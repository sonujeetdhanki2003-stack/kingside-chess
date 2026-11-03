#!/bin/sh
# Copies ../web-site into assets/www for the Android app (no PWA files; index.html loads app-bridge.js).
set -e
cd "$(dirname "$0")"
cp assets/www/app-bridge.js /tmp/kingside-app-bridge.js
rm -rf assets/www && mkdir -p assets/www
(cd ../web-site && tar cf - --exclude=worker.mjs --exclude=tab-site.json --exclude=sw.js --exclude=manifest.webmanifest --exclude=og.png --exclude='icon-*.png' .) | (cd assets/www && tar xf -)
cp /tmp/kingside-app-bridge.js assets/www/app-bridge.js
python3 - <<'EOF'
p = 'assets/www/index.html'; s = open(p, encoding='utf-8').read()
for a, b in [('<link rel="apple-touch-icon" href="icon-180.png">\n', ''), ('<link rel="manifest" href="manifest.webmanifest">\n', '')]:
    assert a in s, a; s = s.replace(a, b)
a = '<script type="module" src="game.js"></script>'; assert a in s
s = s.replace(a, '<script src="app-bridge.js"></script>\n' + a); open(p, 'w', encoding='utf-8').write(s)
EOF
echo synced
