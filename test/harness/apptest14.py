
import asyncio, os, sys, time, json
from playwright.async_api import async_playwright
HOST='sonujeet-chess.sites.tab.bot'; ASSETS=sys.argv[1]; OUT=sys.argv[2]
UA='Mozilla/5.0 (Linux; Android 14; Pixel 7; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36 KingsideChessApp/1.4'
MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.svg':'image/svg+xml','.png':'image/png','.txt':'text/plain','.json':'application/json','.webp':'image/webp'}
BRIDGE="window.__nativeCalls=[];window.KingsideNative={share:function(t){__nativeCalls.push(['share',t])},copy:function(t){__nativeCalls.push(['copy',t])},open:function(u){__nativeCalls.push(['open',u])},version:function(){return '1.4'}};"
served=[]; blocked=[]
async def app_route(route):
    from urllib.parse import urlparse
    req=route.request; u=urlparse(req.url); p=u.path or '/'
    if p=='/': p='/index.html'
    f=ASSETS+p
    if u.hostname==HOST and req.method=='GET' and not p.startswith('/api/') and os.path.isfile(f):
        served.append(p); return await route.fulfill(status=200, body=open(f,'rb').read(), headers={'content-type':MIME.get(os.path.splitext(f)[1],'application/octet-stream')})
    blocked.append(req.url[:90]); return await route.abort('internetdisconnected')
async def wait_js(pg,e,t=20000):
    t0=time.time()
    while True:
        try:
            v=await pg.evaluate(e)
            if v: return v
        except Exception: pass
        if (time.time()-t0)*1000>t: raise Exception('timeout '+e)
        await asyncio.sleep(0.25)
async def click_sq(pg, sq):
    box=await pg.locator(f'#p-board .sq[data-sq="{sq}"]').bounding_box()
    await pg.mouse.click(box['x']+box['width']/2, box['y']+box['height']/2)
async def main():
    ok=[]
    def chk(name,cond,extra=''):
        ok.append(bool(cond)); print(('PASS ' if cond else 'FAIL ')+name, extra, flush=True)
    async with async_playwright() as p:
        b=await p.chromium.launch(); ctx=await b.new_context(viewport={'width':360,'height':780}, device_scale_factor=2, user_agent=UA, is_mobile=True, has_touch=True)
        await ctx.add_init_script(BRIDGE); await ctx.route('**/*', app_route)
        pg=await ctx.new_page(); errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(f'https://{HOST}/'); await wait_js(pg,'window.__chess && window.__chess.engine.ready',40000)
        chk('in-app mode', await pg.evaluate("document.documentElement.classList.contains('in-app')"))
        chk('engine from the APK', True, await pg.evaluate('__chess.engine.name'))
        await pg.evaluate("document.querySelectorAll('.sheet-backdrop').forEach(b=>b.hidden=true)")
        for lv in (2,9):
            await pg.evaluate(f"__chess.newGame({{mode:'ai',color:'w',level:{lv},tc:'none'}})"); await asyncio.sleep(0.5)
            await pg.evaluate("__chess.makeMove({from:'e2',to:'e4'})")
            await wait_js(pg,'__chess.chess.history().length===2',30000)
            await pg.evaluate("__chess.makeMove({from:'g1',to:'f3'})")
            await wait_js(pg,'__chess.chess.history().length===4',30000)
            chk(f'offline vs computer level {lv}', True, await pg.evaluate("__chess.chess.history().join(' ')"))
        await pg.screenshot(path=OUT+'/app14-game.png')
        chk('back from game goes home', await pg.evaluate('window.__kingsideBack()') and await pg.evaluate("document.body.classList.contains('view-home')"))
        chk('streak chip on home', await pg.evaluate("!!document.getElementById('hub-streak')"))
        await pg.click('#btn-rush'); await asyncio.sleep(1)
        await pg.click('[data-act=rushgo]')
        solved=0; t0=time.time()
        while time.time()-t0<40 and solved<3:
            st=await pg.evaluate("(()=>{const P=window.__kingsidePuzzles.P,R=window.__kingsidePuzzles.R; return {run:!!(R&&R.running), ready: !!P && !P.done && P.step%2===1, score:R?R.score:0}})()")
            if not st['run']: break
            solved=st['score']
            if not st['ready']: await asyncio.sleep(0.15); continue
            u=await pg.evaluate("window.__kingsidePuzzles.P.moves[window.__kingsidePuzzles.P.step]")
            await click_sq(pg,u[:2]); await click_sq(pg,u[2:4]); await asyncio.sleep(0.25)
        chk('Puzzle Rush offline (solved 3)', solved>=3, solved)
        await pg.screenshot(path=OUT+'/app14-rush.png')
        b1=await pg.evaluate('window.__kingsideBack()'); await asyncio.sleep(0.5)
        chk('back ends the rush run', b1 and not await pg.evaluate("!!(window.__kingsidePuzzles.R&&window.__kingsidePuzzles.R.running)"))
        for _ in range(4):
            if await pg.evaluate("document.body.classList.contains('view-home') && document.getElementById('pscreen').hidden"): break
            await pg.evaluate('window.__kingsideBack()'); await asyncio.sleep(0.4)
        chk('back returns home from Puzzles', await pg.evaluate("document.getElementById('pscreen').hidden"))
        await pg.click('#btn-ach'); await asyncio.sleep(0.6)
        chk('achievements open', await pg.evaluate("document.getElementById('ascreen').dataset.v==='achievements' && !document.getElementById('ascreen').hidden"))
        await pg.screenshot(path=OUT+'/app14-ach.png')
        await pg.evaluate('window.__kingsideBack()'); await asyncio.sleep(0.5)
        chk('back closes achievements', await pg.evaluate("document.getElementById('ascreen').hidden"))
        await pg.evaluate("window.__i18n.set('hi')"); await asyncio.sleep(1)
        txt=await pg.evaluate("document.querySelector('.hub-in').innerText")
        chk('Hindi applies offline', any('\u0900'<=c<='\u097f' for c in txt), txt[:80].replace('\n',' | '))
        await pg.screenshot(path=OUT+'/app14-hindi.png')
        chk('back at home returns false (app shows press-again)', (await pg.evaluate('window.__kingsideBack()'))==False)
        chk('no page errors', not errs, errs[:3])
        print('blocked requests:', len(blocked), blocked[:5])
        print('SUMMARY', sum(ok),'/',len(ok))
        await b.close()
asyncio.run(main())
