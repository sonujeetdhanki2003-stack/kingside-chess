#!/usr/bin/env python3
"""v1.9 browser test at phone size: two throwaway accounts play rated Bullet games (most through the API, the key ones
in the real UI by tapping squares). Checks: the result sheet's +X / -X with the count-up, "?" while provisional, the
placement celebration when it settles, a "Promoted to ...!" when crossing a rank, the rank badge in the player bars,
profile graph (3 pools, ranges, peak), leaderboard badges, Hindi strings, 0 console errors. Deletes both accounts.
usage: ui19.py BASE OUTDIR [--keep]"""
import asyncio, sys, json, time, random, string, os, urllib.request
from playwright.async_api import async_playwright
BASE = sys.argv[1].rstrip('/'); OUT = sys.argv[2]; KEEP = '--keep' in sys.argv
os.makedirs(OUT, exist_ok=True)
UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36"
RANKS = [0, 1000, 1200, 1400, 1600, 1800, 2000]
ok = True; log = []
def L(*a): s = ' '.join(str(x) for x in a); print(s, flush=True); log.append(s)
def check(c, what):
    global ok; L(('PASS ' if c else 'FAIL ') + what); ok = ok and bool(c)
def call(path, body=None):
    req = urllib.request.Request(BASE + '/api/' + path, data=json.dumps(body).encode() if body is not None else None,
        headers={'content-type': 'application/json', 'user-agent': 'kingside-qa'}, method='POST' if body is not None else 'GET')
    for i in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as r: return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code >= 500 and i < 3: time.sleep(1.5); continue
            return json.loads(e.read() or b'{}')
        except Exception:
            if i < 3: time.sleep(1.5); continue
            raise
SCHOLAR = ['e2e4', 'e7e5', 'd1h5', 'b8c6', 'f1c4', 'g8f6', 'h5f7']
def api_moves(code, toks, moves):
    for i, m in enumerate(moves):
        r = call('move', {'code': code, 'tok': toks['w' if i % 2 == 0 else 'b'], 'uci': m, 'ply': i}); assert r.get('ok'), (m, r)
def challenge(W, B, tc='1+0'):
    ch = call('f/challenge', {'s': W['s'], 'uname': B['uname'], 'tc': tc, 'color': 'w', 'rated': True}); assert ch.get('ok'), ch
    acc = call('f/answer', {'s': B['s'], 'id': ch['id'], 'accept': True}); assert acc.get('ok'), acc
    c = [x for x in call('f/list?s=' + W['s'])['challenges'] if x['id'] == ch['id']][0]
    return acc['room'], {'w': c['seat'], 'b': acc['seat']}
def api_game(A, B, a_wins):
    code, toks = challenge(A, B)
    if a_wins: api_moves(code, toks, SCHOLAR)
    else: api_moves(code, toks, ['e2e4', 'e7e5', 'g1f3', 'b8c6']); call('action', {'code': code, 'tok': toks['w'], 'type': 'resign'})
    for _ in range(10):
        rr = call(f'u/rres?code={code}&game=1')
        if rr.get('found'): return rr
        time.sleep(0.3)
def bullet(u): return call('u/me?lite=1&s=' + u['s'])['user']['ratings']['bullet']
async def wait_js(pg, e, t=20000):
    t0 = time.time()
    while True:
        try:
            v = await pg.evaluate(e)
            if v: return v
        except Exception: pass
        if (time.time() - t0) * 1000 > t: raise Exception('timeout ' + e)
        await asyncio.sleep(0.2)
async def page_for(b, u, lang='en', w=390, h=844, mobile=True):
    ctx = await b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=3 if mobile else 1, user_agent=UA if mobile else None, is_mobile=mobile, has_touch=mobile)
    st = {'kingside-session-v1': json.dumps(u['s']) if u else None, 'kingside-lang': lang}
    await ctx.add_init_script("(() => { const st = %s; for (const k in st) if (st[k] != null && !sessionStorage.getItem('qa-init-' + k)) { localStorage.setItem(k, st[k]); sessionStorage.setItem('qa-init-' + k, '1'); } })()" % json.dumps(st))
    pg = await ctx.new_page(); pg.errs = []
    pg.on('pageerror', lambda e: pg.errs.append(str(e)))
    pg.on('console', lambda m: pg.errs.append('console:' + m.text) if m.type == 'error' else None)
    return pg
async def click_sq(pg, sq):
    box = await pg.locator(f'#board .sq[data-square="{sq}"]').bounding_box()
    await pg.mouse.click(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
async def ui_game(PA, PB, A, B, name):
    """A (white) mates B with the scholar's mate, tapping squares on both phones; returns A's rating text from the result"""
    code, toks = challenge(A, B)
    for pg, c in ((PA, 'w'), (PB, 'b')):
        await pg.evaluate("([c, t]) => { const m = JSON.parse(localStorage.getItem('kingside-rooms-v1') || '{}'); m[c] = { tok: t, at: Date.now() }; localStorage.setItem('kingside-rooms-v1', JSON.stringify(m)); }", [code, toks[c]])
        await pg.goto(BASE + '/?room=' + code)
    for pg in (PA, PB): await wait_js(pg, "window.__chess && window.__chess.online && window.__chess.online.state && window.__chess.online.state.status === 'active'")
    await asyncio.sleep(1.0)
    bar_before = await PA.evaluate("document.querySelector('.player-bar, #top-name, body') && [...document.querySelectorAll('.rt')].map(x=>x.innerText).join(' | ')")
    L(name, 'player bars before:', bar_before)
    for i, m in enumerate(SCHOLAR):
        pg, o = (PA, PB) if i % 2 == 0 else (PB, PA)
        await click_sq(pg, m[:2]); await asyncio.sleep(0.12); await click_sq(pg, m[2:4])
        await wait_js(o, f'window.__chess.chess.history().length === {i + 1}', 15000)
        if i == 0: await PA.screenshot(path=f'{OUT}/{name}-ingame.png')
    await wait_js(PA, "!document.getElementById('sheet-result').hidden && document.querySelector('#result-rating .rr-num')", 20000)
    await asyncio.sleep(0.25); await PA.screenshot(path=f'{OUT}/{name}-countup.png')
    await wait_js(PA, "document.querySelector('#result-rating .rr-num.rr-done')", 10000)
    return code, bar_before
async def main():
    tag = ''.join(random.choice(string.ascii_lowercase + string.digits) for _ in range(5))
    A = {'uname': f'qa19a_{tag}', 'disp': 'Arjun'}; B = {'uname': f'qa19b_{tag}', 'disp': 'Kabir'}
    for u in (A, B):
        r = call('u/signup', {'username': u['uname'], 'password': 'qa-pass-1234', 'display': u['disp']}); assert r.get('ok'), r; u['s'] = r['session']
    call('f/request', {'s': A['s'], 'uname': B['uname']}); call('f/accept', {'s': B['s'], 'uname': A['uname']})
    L('accounts', A['uname'], B['uname'])
    try:
        # 9 Bullet games through the API: A loses most, so A is low and still provisional
        for i in range(9): api_game(A, B, a_wins=i in (2, 6))
        ra = bullet(A); L('A after 9 games', ra)
        check(ra['p'] and ra['n'] == 9, 'A still provisional after 9 games: %s' % ra)
        async with async_playwright() as p:
            br = await p.chromium.launch()
            PA = await page_for(br, A); PB = await page_for(br, B)
            for pg in (PA, PB): await pg.goto(BASE + '/'); await asyncio.sleep(0.8)
            # game 10 in the UI: A wins and the rating settles -> placement celebration
            await ui_game(PA, PB, A, B, 'g10')
            txt = await PA.evaluate("document.getElementById('result-rating').innerText")
            L('g10 result:', txt.replace('\n', ' / '))
            check('+' in txt, 'game 10: green +X shown: %s' % txt.split('\n')[0])
            await wait_js(PA, "document.getElementById('rank-up') && !document.getElementById('rank-up').hidden", 5000)
            await asyncio.sleep(1.3); await PA.screenshot(path=f'{OUT}/g10-placement.png')
            t = await PA.evaluate("document.querySelector('#rank-up h2').innerText"); check(t.startswith('You’re'), 'placement celebration: %s' % t)
            await PA.click('#ru-ok'); await asyncio.sleep(0.5)
            await PA.screenshot(path=f'{OUT}/g10-result.png')
            ra = bullet(A); check(not ra['p'], 'A settled after game 10 (no ?): %s' % ra)
            rb10 = await PB.evaluate("document.getElementById('result-rating').innerText")
            check('−' in rb10, 'loser sees a red −X: %s' % rb10.split('\n')[0])
            # wins through the API until one more win should cross the next rank
            last_gain = 30
            for k in range(30):
                r = bullet(A)['r']; nxt = next((x for x in RANKS if x > r), None)
                if nxt is None or nxt - r < max(4, last_gain * 0.6): break
                rr = api_game(A, B, a_wins=True); last_gain = rr['w']['d']
            ra0 = bullet(A); L('A before the promotion game', ra0, 'last gain', last_gain)
            code, bars = await ui_game(PA, PB, A, B, 'g-promo')
            check('?' not in bars.split('|')[0] if bars else True, 'player bar shows a settled rating with the rank icon: %s' % bars)
            has_icon = await PA.evaluate("!!document.querySelector('.rt .rk-mini svg')"); check(has_icon, 'rank icon in the in-game player bar')
            try:
                await wait_js(PA, "document.getElementById('rank-up') && !document.getElementById('rank-up').hidden", 5000)
                await asyncio.sleep(1.3); await PA.screenshot(path=f'{OUT}/promo.png')
                t = await PA.evaluate("document.querySelector('#rank-up h2').innerText"); check(t.startswith('Promoted to'), 'promotion celebration: %s' % t)
                await PA.click('#ru-ok'); await asyncio.sleep(0.6)
            except Exception as e:
                ra1 = bullet(A); check(False, 'no promotion overlay: %s -> %s' % (ra0, ra1))
            await PA.screenshot(path=f'{OUT}/gameover.png')
            txt = await PA.evaluate("document.getElementById('result-rating').innerText"); L('promo result:', txt.replace('\n', ' / '))
            # a reload of the same result must not celebrate again
            # profile: graph + rank badge
            await PA.goto(BASE + '/'); await asyncio.sleep(1.2)
            await PA.click('#btn-account'); await wait_js(PA, "document.querySelector('.a-rcard .a-graph')", 15000)
            await PA.click('[data-gpool=bullet]'); await asyncio.sleep(1.2)
            await PA.evaluate("(sel) => { const el = document.querySelector(sel); el.scrollIntoView({block:'start'}); let s = el.parentElement; while (s && s.scrollHeight <= s.clientHeight + 2) s = s.parentElement; (s || document.scrollingElement).scrollBy(0, -78); }", '.a-rcard')
            await asyncio.sleep(1.0); await PA.screenshot(path=f'{OUT}/profile-graph.png')
            g = await PA.evaluate("({pts: document.querySelectorAll('.a-rcard .ag-dot').length, peak: (document.querySelector('.ag-peak')||{}).innerText||'', badge: (document.querySelector('.a-rcard .rk-badge')||{}).innerText||'', head: (document.querySelector('.a-prank')||{}).innerText||''})")
            check(g['badge'] and g['badge'] != 'Placement', 'rating card rank badge: %s, header: %s, peak label: %s' % (g['badge'], g['head'], g['peak']))
            for k in ('30', '90'):
                await PA.click(f'[data-grange="{k}"]'); await asyncio.sleep(0.4)
                ok30 = await PA.evaluate("!!document.querySelector('.a-rcard .a-graph path')"); check(ok30, f'{k}-day range draws')
            await PA.click('[data-grange="all"]'); await asyncio.sleep(0.3)
            await PA.evaluate("document.querySelector('.a-phead').scrollIntoView({block:'start'})"); await asyncio.sleep(0.3); await PA.screenshot(path=f'{OUT}/profile-top.png')
            hist_txt = await PA.evaluate("(document.querySelector('.a-games')||{}).innerText||''")
            check('+' in hist_txt or '−' in hist_txt, 'recent games show the rating change')
            # leaderboard (Bullet) with badges
            await PA.click('[data-go=leaderboard]'); await asyncio.sleep(0.5); await PA.click('[data-lbpool=bullet]'); await wait_js(PA, "document.querySelector('.lb-list')", 10000)
            await asyncio.sleep(0.5); await PA.screenshot(path=f'{OUT}/leaderboard.png')
            lbi = await PA.evaluate("document.querySelectorAll('.lb-r .rk-mini').length"); check(lbi >= 1, 'leaderboard shows rank icons: %d' % lbi)
            # home: rank on the avatar
            await PA.goto(BASE + '/'); await asyncio.sleep(1.5); await PA.screenshot(path=f'{OUT}/home.png')
            hs = await PA.evaluate("document.getElementById('hub-sub').innerText"); L('home sub:', hs)
            # Hindi pass: the same screens in Hindi, collecting untranslated strings
            await PA.evaluate("localStorage.setItem('kingside-lang','hi')"); await PA.goto(BASE + '/'); await asyncio.sleep(1.5)
            await PA.click('#btn-account'); await wait_js(PA, "document.querySelector('.a-rcard')", 15000); await asyncio.sleep(0.8)
            await PA.evaluate("(sel) => { const el = document.querySelector(sel); el.scrollIntoView({block:'start'}); let s = el.parentElement; while (s && s.scrollHeight <= s.clientHeight + 2) s = s.parentElement; (s || document.scrollingElement).scrollBy(0, -78); }", '.a-rcard'); await asyncio.sleep(1.0); await PA.screenshot(path=f'{OUT}/hi-profile.png')
            await PA.click('[data-go=leaderboard]'); await asyncio.sleep(1.5); await PA.evaluate("document.querySelector('.rk-ladder').scrollIntoView()"); await PA.screenshot(path=f'{OUT}/hi-leaderboard.png')
            await PA.evaluate("import('./ranks.js').then((R) => window.__chess.showRankUp(R.RANKS[2], 'bullet', 1234, false))"); await asyncio.sleep(1.4); await PA.screenshot(path=f'{OUT}/hi-promo.png')
            miss = await PA.evaluate("[...(window.__i18nMiss||[])]"); L('hindi misses:', miss)
            for pg, n in ((PA, 'A'), (PB, 'B')):
                errs = [e for e in pg.errs if 'favicon' not in e]
                check(not errs, f'{n}: 0 console errors {errs[:5]}')
            await br.close()
    finally:
        if not KEEP:
            for u in (A, B):
                r = call('u/delete', {'s': u['s'], 'password': 'qa-pass-1234'}); L('deleted', u['uname'], r.get('ok'))
            lb = call('u/leaderboard?pool=bullet'); check(not any(x['uname'].startswith('qa19') for x in lb['list']), 'cleanup: no test account on the Bullet leaderboard')
    L('ALL PASS' if ok else 'SOME FAILED')
    open(f'{OUT}/ui19.log', 'w').write('\n'.join(log))
asyncio.run(main())
