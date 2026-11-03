
import asyncio, os, sys, time, json
from playwright.async_api import async_playwright
HOST='sonujeet-chess.sites.tab.bot'; HOME=f'https://{HOST}/'
ASSETS=sys.argv[1]; OUT=sys.argv[2]
UA='Mozilla/5.0 (Linux; Android 14; Pixel 7; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36'
MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.svg':'image/svg+xml','.png':'image/png','.txt':'text/plain'}
BRIDGE = "window.__nativeCalls=[];window.KingsideNative={share:function(t){__nativeCalls.push(['share',t])},copy:function(t){__nativeCalls.push(['copy',t])},open:function(u){__nativeCalls.push(['open',u])},version:function(){return '1.1'}};"
served=[]; missing=[]
def L(*a): print(*a, flush=True)
async def app_route(route):
    from urllib.parse import urlparse
    req=route.request; u=urlparse(req.url)
    if u.hostname!=HOST: return await route.continue_()
    if req.method!='GET' or u.path.startswith('/api/'): return await route.continue_()
    p=u.path or '/'
    if p=='/': p='/index.html'
    if p=='/sw.js': return await route.fulfill(status=404, body='')
    f=ASSETS+p
    if os.path.isfile(f):
        served.append(p); return await route.fulfill(status=200, body=open(f,'rb').read(), headers={'content-type':MIME.get(os.path.splitext(f)[1],'application/octet-stream')})
    missing.append(p); return await route.continue_()
async def wait_js(page, expr, timeout=20000, what=''):
    t0=time.time()
    while True:
        try:
            v=await page.evaluate(expr)
            if v: return v
        except Exception: pass
        if (time.time()-t0)*1000>timeout: raise Exception('timeout: '+(what or expr))
        await asyncio.sleep(0.25)
async def main():
    async with async_playwright() as p:
        br=await p.chromium.launch()
        app=await br.new_context(viewport={'width':393,'height':780}, device_scale_factor=2, is_mobile=True, has_touch=True, user_agent=UA)
        await app.add_init_script(BRIDGE); await app.route('**/*', app_route)
        A=await app.new_page(); errs=[]; A.on('pageerror', lambda e: errs.append(str(e)))
        web=await br.new_context(viewport={'width':390,'height':844}, is_mobile=True, has_touch=True)
        B=await web.new_page(); C=await (await br.new_context(viewport={'width':390,'height':844}, is_mobile=True, has_touch=True)).new_page(); D=await (await br.new_context(viewport={'width':390,'height':844}, is_mobile=True, has_touch=True)).new_page()
        await A.goto(HOME); await wait_js(A, 'window.__chess && window.__chess.engine', 20000)
        if await A.locator('#sheet-new').is_visible(): await A.click('#new-cancel')
        L('app: in-app mode', await A.evaluate("document.documentElement.classList.contains('in-app')"), '| no service worker:', await A.evaluate("navigator.serviceWorker.getRegistrations().then(r=>r.length===0)"))
        await A.click('#btn-tourney'); await A.wait_for_selector('#tscreen:not([hidden])')
        L('app: Tournaments screen opens; back button closes it:', await A.evaluate('window.__kingsideBack()'), await A.evaluate("document.getElementById('tscreen').hidden"))
        await A.click('#btn-tourney'); await A.click('[data-act="new"]')
        await A.fill('#t-name', 'App test'); await A.click('[data-tseg="format"] button[data-v="ko"]'); await A.fill('#t-myname', 'Sonu (app)')
        await A.click('form[data-form="create"] button[type=submit]'); await A.wait_for_selector('.t-code')
        code=(await A.inner_text('.t-code')).strip()
        await A.click('[data-act="copy"]'); await asyncio.sleep(0.3)
        L('app: created knockout', code, '| Copy link went to the phone clipboard:', await A.evaluate('JSON.stringify(__nativeCalls)'))
        for pg, n in ((B, 'Web friend'), (C, 'Web friend 2'), (D, 'Web friend 3')):
            await pg.goto(f'{HOME}?t={code}'); await pg.wait_for_selector('#t-join-name'); await pg.fill('#t-join-name', n); await pg.click('form[data-form="join"] button[type=submit]'); await pg.wait_for_selector('.t-ok')
        await wait_js(A, "document.querySelectorAll('.t-players li').length === 4", 15000, 'app lobby live')
        L('app: lobby updated live with 3 friends who joined from a normal browser')
        await A.click('[data-act="start"]'); await wait_js(A, "document.querySelector('.chip-live')", 15000)
        st=await A.evaluate(f"fetch('/api/t/poll?code={code}&ver=-1').then(r=>r.json())")
        L('app: started; 4 players -> bracket of 4 with', sum(1 for m in st['rounds'][0] if m['bye']), 'bye')
        try: await A.wait_for_selector('[data-act="play"]', timeout=10000); mine = 1
        except Exception: mine = 0
        if mine:
            await A.click('[data-act="play"]'); await wait_js(A, "window.__chess.online && window.__chess.online.state && window.__chess.online.state.t", 15000, 'app room')
            L('app: Play now opened the tournament game inside the app:', await A.inner_text('#substatus'))
            await A.click('#btn-resign'); await A.click('#confirm-yes'); await wait_js(A, "!document.getElementById('sheet-result').hidden", 15000)
            L('app: resigned; result sheet button:', await A.inner_text('#result-again'))
            await A.click('#result-again'); await A.wait_for_selector('#tscreen:not([hidden])')
            L('app: back on the tournament page')
        else:
            L('app: organizer had the bye this round')
        await A.screenshot(path=OUT+'/app-tournament.png')
        L('app back button inside tournament -> home:', await A.evaluate('window.__kingsideBack()'), '| title:', await A.inner_text('#t-title'))
        L('app back again -> closes:', await A.evaluate('window.__kingsideBack()'), await A.evaluate("document.getElementById('tscreen').hidden"))
        # tidy: end it and forget test ratings
        adm = await A.evaluate(f"JSON.parse(localStorage.getItem('kingside-tadmin-v1'))['{code}']")
        await A.evaluate(f"fetch('/api/t/admin',{{method:'POST',headers:{{'content-type':'application/json'}},body:JSON.stringify({{code:'{code}',adm:'{adm}',action:'end'}})}})")
        for pg in (A, B, C, D):
            await pg.evaluate("fetch('/api/t/forget', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({tok: JSON.parse(localStorage.getItem('kingside-device-v1') || 'null')})})")
        L('assets served from the app bundle:', sorted(set(served)))
        L('assets NOT in the bundle (went to network):', sorted(set(missing)))
        L('page errors:', errs)
        await br.close()
asyncio.run(main())
