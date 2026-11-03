#!/usr/bin/env python3
"""v1.7 share link test: POST a real game to /api/share (with its 1200x630 preview image), then check the public replay
page /g/<id>: status, Open Graph + Twitter tags (title, description, image, url), the image itself, and bad input refused.
usage: og_test.py BASE GAME.json OG.jpg"""
import sys, json, re, base64, urllib.request, html
BASE = sys.argv[1].rstrip('/'); game = json.load(open(sys.argv[2])); img = open(sys.argv[3], 'rb').read()
ok = True
def check(c, w):
    global ok; print(('PASS ' if c else 'FAIL ') + w, flush=True); ok = ok and bool(c)
def req(path, body=None, ua='kingside-qa'):
    r = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None, headers={'content-type': 'application/json', 'user-agent': ua}, method='POST' if body is not None else 'GET')
    try:
        with urllib.request.urlopen(r, timeout=30) as x: return x.status, dict(x.headers), x.read()
    except urllib.error.HTTPError as e: return e.code, dict(e.headers), e.read()
body = {'moves': ' '.join(game['moves']), 'white': game['white'], 'black': game['black'], 'wr': game.get('wr', ''), 'br': game.get('br', ''), 'result': game['result'],
        'reason': game.get('reason', ''), 'opening': game.get('opening', ''), 'source': 'bot', 'light': '#ecedd1', 'dark': '#739552', 'set': 'classic',
        'img': 'data:image/jpeg;base64,' + base64.b64encode(img).decode()}
st, h, b = req('/api/share', body); d = json.loads(b)
check(st == 200 and d.get('ok') and re.match(r'^[a-z0-9]{8}$', d['id']), 'share created: %s' % d.get('url'))
gid = d['id']
st2, h2, b2 = req('/api/share', body); d2 = json.loads(b2)
check(d2.get('id') == gid, 'sharing the same game again gives the same link')
st, h, page = req('/g/' + gid, ua='WhatsApp/2.23.20.0')
page = page.decode()
check(st == 200 and 'text/html' in h.get('Content-Type', h.get('content-type', '')), 'replay page answers 200 text/html')
meta = {m.group(1): html.unescape(m.group(2)) for m in re.finditer(r'<meta (?:property|name)="([^"]+)" content="([^"]*)"', page)}
for k in ['og:title', 'og:description', 'og:image', 'og:url', 'og:type', 'og:site_name', 'twitter:card', 'twitter:image']: check(k in meta and meta[k], f'{k} = {meta.get(k, "")[:110]}')
check(game['white'] in meta.get('og:title', '') and game['black'] in meta.get('og:title', ''), 'title names both players')
check(meta.get('og:url', '').endswith('/g/' + gid) and meta.get('og:image', '').startswith('http'), 'absolute og:url and og:image')
check(meta.get('og:image:width') == '1200' and meta.get('og:image:height') == '630', 'image size declared 1200x630')
check(meta.get('twitter:card') == 'summary_large_image', 'large image card')
ipath = '/' + meta['og:image'].split('/', 3)[3]
st, h, ib = req(ipath, ua='WhatsApp/2.23.20.0')
check(st == 200 and ib[:2] == b'\xff\xd8' and len(ib) == len(img), f'preview image served as JPEG ({len(ib)} bytes, {h.get("Content-Type", h.get("content-type"))})')
check('Analyse this game' in page and '/?g=' + gid in page, 'page links back into the app (Analyse in Kingside)')
st, h, b = req('/g/zzzzzzzz')
check(st == 404, 'unknown id -> 404 page')
st, h, b = req('/api/share', {'moves': 'e2e4 e2e4', 'white': 'x', 'black': 'y', 'result': '1-0'})
check(st == 400, 'illegal moves are refused')
st, h, b = req('/api/share', {'moves': 'e2e4', 'white': '<script>alert(1)</script>', 'black': 'y', 'result': '1-0'})
sid = json.loads(b).get('id'); st, h, pg = req('/g/' + sid)
check('<script>alert(1)' not in pg.decode(), 'names are cleaned/escaped on the page')
st, h, b = req('/api/share?id=' + gid); g2 = json.loads(b)['game']
check(g2['moves'] == ' '.join(game['moves']), 'GET /api/share returns the game for the app (?g= link)')
print('ALL PASS' if ok else 'SOME FAILED'); sys.exit(0 if ok else 1)
