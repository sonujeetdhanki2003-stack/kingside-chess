
import asyncio, os, sys, time, json
from playwright.async_api import async_playwright
HOST='sonujeet-chess.sites.tab.bot'; ASSETS=sys.argv[1]; OUT=sys.argv[2]
UA='Mozilla/5.0 (Linux; Android 14; Pixel 7; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36 KingsideChessApp/1.2'
MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.svg':'image/svg+xml','.png':'image/png','.txt':'text/plain','.json':'application/json'}
BRIDGE="window.__nativeCalls=[];window.KingsideNative={share:function(t){__nativeCalls.push(['share',t])},copy:function(t){__nativeCalls.push(['copy',t])},open:function(u){__nativeCalls.push(['open',u])},version:function(){return '1.2'}};"
served=[]; missing=[]
async def app_route(route):
    from urllib.parse import urlparse
    req=route.request; u=urlparse(req.url)
    if u.hostname!=HOST or req.method!='GET' or u.path.startswith('/api/'): return await route.continue_()
    p=u.path or '/'
    if p=='/': p='/index.html'
    if p=='/sw.js': return await route.fulfill(status=404, body='')
    f=ASSETS+p
    if os.path.isfile(f): served.append(p); return await route.fulfill(status=200, body=open(f,'rb').read(), headers={'content-type':MIME.get(os.path.splitext(f)[1],'application/octet-stream')})
    missing.append(p); return await route.continue_()
async def wait_js(pg,e,t=20000):
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
        b=await p.chromium.launch(); ctx=await b.new_context(viewport={'width':412,'height':915}, device_scale_factor=2.6, user_agent=UA, is_mobile=True, has_touch=True)
        await ctx.add_init_script(BRIDGE); await ctx.route('**/*', app_route)
        pg=await ctx.new_page(); errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(f'https://{HOST}/'); await wait_js(pg,'window.__chess && window.__chess.engine.ready',30000)
        print('in-app class:', await pg.evaluate("document.documentElement.classList.contains('in-app')"))
        await pg.evaluate("document.querySelectorAll('.sheet-backdrop').forEach(b=>b.hidden=true); __chess.newGame({mode:'ai',color:'w',level:2,tc:'none'})"); await asyncio.sleep(0.4)
        await pg.evaluate("__chess.makeMove({from:'e2',to:'e4'})"); await wait_js(pg,'__chess.chess.history().length===2',20000)
        print('vs computer (bundled SF10):', await pg.evaluate("__chess.chess.history().join(' ')"))
        print('opening shown:', await pg.inner_text('#opening'))
        await pg.click('#btn-review'); await wait_js(pg,'window.__kingsideReview.G && window.__kingsideReview.G.done',60000)
        print('review done with', await pg.evaluate('__kingsideReview.analyzer.info.name'), '| sf19 served from APK:', '/engine/sf19/stockfish-19-lite-single.wasm' in served)
        print('back closes review:', await pg.evaluate('window.__kingsideBack()'), await pg.evaluate("document.getElementById('rscreen').hidden"))
        print('back from the game goes home:', await pg.evaluate('window.__kingsideBack()'), await pg.evaluate("document.body.classList.contains('view-home')"))
        await pg.click('#btn-daily'); await wait_js(pg,"window.__kingsidePuzzles.P && window.__kingsidePuzzles.P.step===1",15000)
        print('daily puzzle from bundle:', await pg.evaluate('__kingsidePuzzles.P.id'))
        await pg.screenshot(path=OUT+'/app-puzzle.png')
        print('back x2 closes puzzles:', await pg.evaluate('window.__kingsideBack()'), await pg.evaluate('window.__kingsideBack()'), await pg.evaluate("document.getElementById('pscreen').hidden"))
        await pg.click('#btn-account'); await asyncio.sleep(0.5); print('account screen:', await pg.inner_text('#a-title'), '| google button present:', await pg.evaluate("!!document.getElementById('g-btn')"))
        print('back closes account:', await pg.evaluate('window.__kingsideBack()'), '| back at board (false = app shows press-again toast):', await pg.evaluate('window.__kingsideBack()'))
        await pg.click('#btn-quick'); await asyncio.sleep(0.3); print('quick sheet open:', await pg.evaluate("!document.getElementById('sheet-quick').hidden"), '| back closes it:', await pg.evaluate('window.__kingsideBack()'))
        await pg.screenshot(path=OUT+'/app-home.png')
        print('missing from bundle:', sorted(set(missing))); print('errors:', errs)
        await b.close()
asyncio.run(main())
