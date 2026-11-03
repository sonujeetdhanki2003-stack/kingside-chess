
import asyncio, time, json
from playwright.async_api import async_playwright
import sys
B=sys.argv[1].rstrip('/') if len(sys.argv)>1 else 'https://sonujeet-chess.sites.tab.bot'
async def wait_js(pg, e, t=20000):
    t0=time.time()
    while True:
        try:
            v=await pg.evaluate(e)
            if v: return v
        except Exception: pass
        if (time.time()-t0)*1000>t: raise Exception('timeout '+e)
        await asyncio.sleep(0.25)
async def main():
    async with async_playwright() as p:
        br=await p.chromium.launch()
        mk=lambda: br.new_context(viewport={'width':390,'height':844}, is_mobile=True, has_touch=True)
        c=await mk(); pg=await c.new_page(); errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(B+'/'); await wait_js(pg, 'window.__chess && window.__chess.engine.ready', 30000)
        await pg.evaluate("__chess.newGame({mode:'ai', color:'w', level:2, tc:'none'})"); await asyncio.sleep(0.5)
        await pg.evaluate("__chess.makeMove({from:'e2',to:'e4'})")
        await wait_js(pg, '__chess.chess.history().length === 2', 20000)
        print('vs computer: engine replied', await pg.evaluate('__chess.chess.history()'))
        await pg.evaluate("__chess.newGame({mode:'pvp', tc:'none'})"); await asyncio.sleep(0.3)
        for m in ['f3','e5','g4','Qh4']: await pg.evaluate(f"__chess.makeMove('{m}')")
        await wait_js(pg, "!document.getElementById('sheet-result').hidden", 5000)
        print('2-player mate result:', await pg.inner_text('#result-title'))
        await pg.click('#result-close')
        # stalemate draw title (the path that had the bug)
        await pg.evaluate("__chess.newGame({mode:'pvp', tc:'none'}); __chess.chess.load('7k/5Q2/6K1/8/8/8/8/8 w - - 0 1');")
        await pg.evaluate("__chess.makeMove({from:'f7',to:'f6'})")  # not stalemate yet
        # 1v1 online: create, friend joins, draw, rematch
        await pg.goto(B+'/'); await asyncio.sleep(1)
        if await pg.locator('#sheet-new').is_visible(): await pg.click('#new-cancel')
        await pg.click('#btn-online'); await pg.click('#new-start'); await wait_js(pg, "__chess.online && __chess.online.code", 15000)
        code=await pg.evaluate('__chess.online.code')
        c2=await mk(); f=await c2.new_page(); await f.goto(B+'/?room='+code); await wait_js(f, "__chess.online && __chess.online.state && __chess.online.state.status==='active'", 15000)
        print('1v1 online: friend joined room', code)
        me = await pg.evaluate('__chess.online.color'); w, b = (pg, f) if me=='w' else (f, pg)
        await w.evaluate("__chess.makeMove({from:'e2',to:'e4'})"); await wait_js(b, '__chess.chess.history().length===1')
        await w.click('#btn-draw'); await wait_js(b, "!document.getElementById('offer-bar').hidden"); await b.click('#offer-yes')
        await wait_js(w, "!document.getElementById('sheet-result').hidden", 15000)
        print('1v1 draw result title:', repr(await w.inner_text('#result-title')), '| button:', await w.inner_text('#result-again'))
        await w.click('#result-again'); await b.wait_for_timeout(1500)
        await wait_js(b, "!document.getElementById('sheet-result').hidden && document.getElementById('result-again').textContent.includes('Accept')", 15000)
        await b.click('#result-again'); await wait_js(w, "__chess.online.state.game === 2", 15000)
        print('1v1 rematch started, colours swapped:', await w.evaluate('__chess.online.color') != ('w' if w is pg and me=='w' else me))
        print('page errors:', errs)
        await br.close()
asyncio.run(main())
