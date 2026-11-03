
import asyncio, sys, json, time, re
from playwright.async_api import async_playwright
BASE = sys.argv[1].rstrip('/')
FMT = sys.argv[2]            # rr | ko
OUT = sys.argv[3]            # screenshot dir
NAMES = ['Sonujeet', 'Rahul', 'Amit', 'Priya']
UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36"
log = []
def L(*a):
    s = ' '.join(str(x) for x in a); print(s, flush=True); log.append(s)

async def wait_js(page, expr, timeout=20000, what=''):
    t0 = time.time()
    while True:
        try:
            v = await page.evaluate(expr)
            if v: return v
        except Exception as e:
            pass
        if (time.time() - t0) * 1000 > timeout: raise Exception('timeout waiting: ' + (what or expr))
        await asyncio.sleep(0.25)

async def click_sq(page, sq):
    el = page.locator(f'.sq[data-square="{sq}"]')
    box = await el.bounding_box()
    await page.mouse.click(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)

async def hist(page):
    return await page.evaluate('window.__chess ? window.__chess.chess.history().length : -1')

async def move(pages, color, uci):
    p = pages[color]; o = pages['b' if color == 'w' else 'w']
    n = await hist(p)
    await click_sq(p, uci[:2]); await asyncio.sleep(0.15); await click_sq(p, uci[2:4])
    await wait_js(p, f'window.__chess.chess.history().length === {n+1}', 8000, f'move {uci} on mover')
    await wait_js(o, f'window.__chess.chess.history().length === {n+1}', 15000, f'move {uci} on opponent')

SCHOLAR = ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7']  # white mates
FOOL = ['f2f3', 'e7e5', 'g2g4', 'd8h4']                           # black mates

async def play(pages, how, refresh=None):
    """pages: {'w': page, 'b': page}; how: w|b (mate), d (agreed draw), rw/rb (black/white resigns)"""
    seq = SCHOLAR if how == 'w' else FOOL if how == 'b' else ['e2e4', 'e7e5', 'g1f3', 'b8c6']
    for i, u in enumerate(seq):
        c = 'w' if i % 2 == 0 else 'b'
        await move(pages, c, u)
        if refresh and i == 1:
            rp = pages[refresh]
            L('   refreshing', refresh, 'mid-game')
            await rp.reload(); await rp.wait_for_load_state('domcontentloaded')
            await wait_js(rp, 'window.__chess && window.__chess.online && window.__chess.online.state && window.__chess.chess.history().length === 2', 15000, 'rejoin after refresh')
            L('   rejoined after refresh: same game, 2 moves on the board')
    if how in ('rw', 'rb'):
        loser = pages['b' if how == 'rw' else 'w']
        await loser.click('#btn-resign'); await loser.click('#confirm-yes')
    if how == 'd':
        await pages['w'].click('#btn-draw')
        await wait_js(pages['b'], "!document.getElementById('offer-bar').hidden", 15000, 'draw offer bar')
        await pages['b'].click('#offer-yes')
    for c in 'wb':
        await wait_js(pages[c], "window.__chess.online.state.status === 'over'", 20000, 'game over')

async def tstate(page):
    return await page.evaluate("fetch('/api/t/poll?' + new URLSearchParams({code: new URLSearchParams(location.search).get('t') || window.__tcode, tok: localStorage.getItem('kingside-device-v1').replace(/\"/g,''), ver: -1})).then(r => r.json())")

async def main():
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        ctxs, pages = [], []
        for i in range(4):
            c = await br.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, user_agent=UA)
            p = await c.new_page()
            p.on('pageerror', lambda e, i=i: L(f'PAGEERROR[{NAMES[i]}]', e))
            p.on('console', lambda m, i=i: (m.type == 'error') and L(f'console[{NAMES[i]}]', m.text[:200]))
            ctxs.append(c); pages.append(p)
        A = pages[0]
        await A.goto(BASE + '/'); await A.wait_for_load_state('networkidle')
        if await A.locator('#sheet-new').is_visible(): await A.click('#new-cancel')
        await A.click('#btn-tourney')
        await A.click('[data-act="new"]')
        tname = 'Sunday Blitz' if FMT == 'rr' else 'Knockout Cup'
        await A.fill('#t-name', tname)
        await A.click(f'[data-tseg="format"] button[data-v="{FMT}"]')
        await A.click('[data-tseg="tc"] button[data-v="5+0"]')
        await A.fill('#t-myname', NAMES[0])
        await A.click('form[data-form="create"] button[type=submit]')
        await A.wait_for_selector('.t-code')
        code = (await A.inner_text('.t-code')).strip()
        wa = await A.get_attribute('.t-invite .btn-wa', 'href')
        L('created', FMT, 'tournament', code, '| WhatsApp link ok:', wa.startswith('https://wa.me/?text=') and code in wa)
        await A.screenshot(path=f'{OUT}/{FMT}-lobby-organizer.png')
        for i in range(1, 4):
            p = pages[i]
            await p.goto(f'{BASE}/?t={code}'); await p.wait_for_selector('#t-join-name')
            await p.fill('#t-join-name', NAMES[i]); await p.click('form[data-form="join"] button[type=submit]')
            await p.wait_for_selector('.t-ok')
            t0 = time.time()
            await wait_js(A, f"document.querySelectorAll('.t-players li').length === {i+1}", 15000, 'lobby shows join')
            L(f'  {NAMES[i]} joined; organizer lobby updated in {time.time()-t0:.1f}s')
        await A.screenshot(path=f'{OUT}/{FMT}-lobby-4.png')
        await A.click('[data-act="start"]')
        for p in pages: await p.evaluate(f"window.__tcode = '{code}'")
        await wait_js(A, "document.querySelector('.chip-live')", 15000, 'tournament live')
        L('started')
        await asyncio.sleep(1.5)
        await A.screenshot(path=f'{OUT}/{FMT}-started-organizer.png')
        L('organizer sees own game card 1.5s after start:', await A.locator('.ts-mygame [data-act=play]').count() == 1)
        st = await tstate(A)
        ids = {p['id']: p['name'] for p in st['players']}
        page_of = {}
        for i, p in enumerate(pages):
            s = await tstate(p); page_of[s['me']] = p
        # plans per round index: list of hows by match order
        if FMT == 'rr':
            plans = [['w', 'd'], ['rw', 'b'], ['d', 'w']]
        else:
            plans = None
        rnd = 0; refreshed_t = False; refreshed_room = False
        games_log = []
        while True:
            st = await tstate(A)
            if st['status'] == 'done': break
            r = st['round']
            ms = st['rounds'][r]
            jobs = []
            for mi, m in enumerate(ms):
                if m['done'] or m['bye']: continue
                g = m['games'][-1]
                if g['res']: continue
                if FMT == 'rr': how = plans[r][len([x for x in ms[:mi] if not x['bye']])]
                else:
                    name = st['roundNames'][r]
                    if name == 'Final': how = 'd'                       # final: draw, then armageddon draw -> Black wins
                    elif mi == 0: how = 'd' if not g['arma'] else 'w'   # semi 1: draw -> armageddon won by White (mate)
                    else: how = 'rb'                                     # semi 2: White resigns
                jobs.append((mi, g, how))
            if not jobs:
                await asyncio.sleep(1); continue
            async def run(mi, g, how):
                pw_, pb_ = page_of[g['w']], page_of[g['b']]
                # each player taps Play now on their own tournament page
                for pp in (pw_, pb_):
                    await wait_js(pp, f"document.querySelector('[data-act=play][data-room=\"{g['room']}\"]')", 20000, 'play now button')
                    await pp.click(f"[data-act=play][data-room=\"{g['room']}\"]")
                for pp in (pw_, pb_):
                    await wait_js(pp, f"window.__chess && window.__chess.online && window.__chess.online.state && window.__chess.online.state.code === '{g['room']}'", 20000, 'room loaded')
                pages_ = {'w': pw_, 'b': pb_}
                nonlocal refreshed_room
                ref = None
                if not refreshed_room and r == 1: ref = 'b'; refreshed_room = True
                await play(pages_, how, refresh=ref)
                res_w = await pw_.evaluate('JSON.stringify(window.__chess.online.state.result)')
                label = (await pw_.inner_text('#substatus'))
                L(f"  {st['roundNames'][r] if FMT=='ko' else 'Round '+str(r+1)}{' (Armageddon)' if g['arma'] else ''}: {ids[g['w']]} (W) vs {ids[g['b']]} (B) -> {how}: {res_w} | {label}")
                games_log.append((r, ids[g['w']], ids[g['b']], how, g['arma']))
                # back to the tournament from the result sheet
                for pp in (pw_, pb_):
                    await wait_js(pp, "!document.getElementById('sheet-result').hidden", 10000, 'result sheet')
                    rt = await pp.inner_text('#result-title')
                    L(f"     result screen for {'White' if pp is pw_ else 'Black'}: {rt!r}")
                    t = await pp.inner_text('#result-again')
                    assert t == 'Back to tournament', t
                    await pp.click('#result-again')
                    await pp.wait_for_selector('#tscreen:not([hidden])')
            await asyncio.gather(*[run(*j) for j in jobs])
            if not refreshed_t:
                # refresh-and-rejoin on the tournament page: same seat, same player
                p = pages[2]
                before = (await tstate(p))['me']
                await p.reload(); await p.wait_for_selector('.t-headcard')
                after = (await tstate(p))['me']
                L(f'  refreshed {NAMES[2]} tournament page mid-tournament: seat {before} -> {after}', 'KEPT' if before == after and after else 'LOST')
                refreshed_t = True
            await asyncio.sleep(1.5)
        # wait for the champion screen on every phone
        for i, p in enumerate(pages):
            await wait_js(p, "document.querySelector('.t-champ')", 20000, 'champion card')
        st = await tstate(A)
        L('DONE. champion:', ids.get(st['champion']))
        for x in st['standings']:
            L('   ', x['place'], x['name'], 'pts', x['pts'], 'W/D/L', x['w'], x['d'], x['l'], 'SB', x['sb'])
        json.dump({'state': st, 'games': games_log}, open(f'{OUT}/{FMT}-final.json', 'w'), indent=1)
        # screenshots at phone size: champion (with confetti) and standings
        P = pages[0]
        await P.reload(); await P.wait_for_selector('.t-champ'); await asyncio.sleep(1.2)
        await P.screenshot(path=f'{OUT}/{FMT}-champion.png')
        await P.evaluate("document.querySelector('[data-k=table]').scrollIntoView({block:'start'}); document.getElementById('tscreen').scrollBy(0,-64)")
        await asyncio.sleep(5.5)
        await P.screenshot(path=f'{OUT}/{FMT}-standings.png')
        if FMT == 'ko':
            await P.evaluate("document.querySelector('[data-k=bracket]').scrollIntoView({block:'start'}); document.getElementById('tscreen').scrollBy(0,-64)")
            await asyncio.sleep(0.5); await P.screenshot(path=f'{OUT}/{FMT}-bracket.png')
        await P.screenshot(path=f'{OUT}/{FMT}-champion-full.png', full_page=False)
        # leaderboard
        await P.click('#t-lbtop'); await P.wait_for_selector('.t-lb'); await asyncio.sleep(0.3)
        await P.screenshot(path=f'{OUT}/{FMT}-leaderboard.png')
        L('leaderboard rows:', await P.locator('.t-lb tbody tr').count())
        if len(sys.argv) > 4 and sys.argv[4] == 'forget':
            for p in pages:
                await p.evaluate("fetch('/api/t/forget', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({tok: JSON.parse(localStorage.getItem('kingside-device-v1'))})})")
            L('test players removed from the leaderboard')
        json.dump(log, open(f'{OUT}/{FMT}-log.json', 'w'), indent=1)
        await br.close()
asyncio.run(main())
