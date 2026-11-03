#!/usr/bin/env python3
"""Learn end-to-end test: opens the real app in a headless phone-size browser, loads EVERY lesson and plays the
solution through the actual lesson code (the same answer Hint uses; "play it out" steps are played with Stockfish's
best move against the in-app engine). Checks each lesson ends with "Lesson complete", that no JS errors happen,
that a wrong move is refused, and that progress is saved (35/35 ticks, chapter %).
Usage: python3 test/harness/learn.py http://localhost:8790 [--real-clicks]"""
import asyncio, sys, time, json
from playwright.async_api import async_playwright
BASE = sys.argv[1].rstrip('/') if len(sys.argv) > 1 else 'http://localhost:8790'
REAL = '--real-clicks' in sys.argv
# --assets DIR: serve the app's files from DIR (an unzipped APK's assets/www) with the network cut off, like the Android app offline
ASSETS = sys.argv[sys.argv.index('--assets') + 1] if '--assets' in sys.argv else None
MIME = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain', '.json': 'application/json'}
async def app_route(route):
    import os
    from urllib.parse import urlparse
    u = urlparse(route.request.url); pth = u.path if u.path not in ('', '/') else '/index.html'
    f = ASSETS + pth
    if route.request.method == 'GET' and not pth.startswith('/api/') and os.path.isfile(f):
        return await route.fulfill(status=200, body=open(f, 'rb').read(), headers={'content-type': MIME.get(os.path.splitext(f)[1], 'application/octet-stream')})
    return await route.abort('internetdisconnected')
async def wait_js(pg, e, t=30000):
    t0 = time.time()
    while True:
        try:
            v = await pg.evaluate(e)
            if v: return v
        except Exception: pass
        if (time.time() - t0) * 1000 > t: raise Exception('timeout ' + e)
        await asyncio.sleep(0.1)
async def click_sq(pg, sq):
    box = await pg.locator(f'#l-board .sq[data-sq="{sq}"]').bounding_box()
    await pg.mouse.click(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
async def main():
    results, errs = [], []
    async with async_playwright() as p:
        br = await p.chromium.launch()
        ctx = await br.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        if ASSETS: await ctx.route('**/*', app_route)
        pg = await ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(BASE + '/'); await wait_js(pg, 'window.__learn && window.__chess')
        await pg.evaluate("document.querySelector('#tabbar [data-tab=learn]').click()")
        await wait_js(pg, "!document.getElementById('lscreen').hidden")
        ids = await pg.evaluate('__learn.LESSONS.map(l => l.id)')
        print('lessons:', len(ids))
        # a wrong move is refused (the rook lesson: a non-star square is still a legal rook move, so use the pawn lesson)
        await pg.evaluate("__learn.startLesson('pawn')"); await wait_js(pg, '!__learn.state().busy')
        await pg.evaluate("__learn.move('e2','e3')"); await asyncio.sleep(0.2)
        wrong_txt = await pg.inner_text('#l-fb'); await wait_js(pg, '!__learn.state().busy')
        st = await pg.evaluate('__learn.state()')
        assert st['fen'].startswith('4k3/8/8/8/8/8/4P3/4K3'), st
        print('wrong move refused:', wrong_txt.split('\n')[0])
        for lid in ids:
            t0 = time.time(); moves = 0
            await pg.evaluate(f"__learn.startLesson('{lid}')")
            for guard in range(400):
                await wait_js(pg, '!__learn.state().busy', 60000)
                st = await pg.evaluate('__learn.state()')
                if st['lessonDone']: break
                if st['done'] or st['mode'] == 'info':
                    await pg.evaluate('__learn.next()'); await asyncio.sleep(0.05); continue
                if st['mode'] == 'goal': a = await pg.evaluate('__learn.best()')
                else: a = await pg.evaluate('__learn.answer()')
                if not a: raise Exception(f'{lid}: no answer at step {st["step"]} {st}')
                if REAL and not a.get('promotion'):
                    await click_sq(pg, a['from']); await asyncio.sleep(0.08); await click_sq(pg, a['to'])
                else:
                    await pg.evaluate(f"__learn.move('{a['from']}','{a['to']}',{json.dumps(a.get('promotion'))})")
                moves += 1; await asyncio.sleep(0.05)
            else: raise Exception(f'{lid}: did not finish')
            fb = (await pg.inner_text('#l-fb')).split('\n')[0]
            ok = 'Lesson complete' in fb
            results.append((lid, ok, moves, round(time.time() - t0, 1)))
            print(('PASS' if ok else 'FAIL'), lid, f'{moves} learner moves', f'{time.time() - t0:.1f}s', '|', fb)
        await pg.evaluate("__learn.back()"); await asyncio.sleep(0.3)
        done = await pg.evaluate('[...__learn.done()].length')
        chap = await pg.evaluate("[...document.querySelectorAll('.l-pct')].map(e => e.textContent)")
        ticks = await pg.evaluate("document.querySelectorAll('.l-row.done').length")
        print('progress saved:', done, 'lessons; chapter %:', chap, '; ticks:', ticks)
        await br.close()
    bad = [r for r in results if not r[1]]
    print('JS errors:', errs[:5])
    ok = not bad and not errs and done == len(ids) and ticks == len(ids)
    print('RESULT', 'PASS' if ok else 'FAIL', f'{len(results) - len(bad)}/{len(results)} lessons')
    sys.exit(0 if ok else 1)
asyncio.run(main())
