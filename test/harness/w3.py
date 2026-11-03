
import asyncio, sys, json, time, random
from playwright.async_api import async_playwright
BASE=sys.argv[1].rstrip('/'); OUT=sys.argv[2]; SUF=sys.argv[3] if len(sys.argv)>3 else str(random.randint(100,999))
UA="Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36"
log=[]
def L(*a): s=' '.join(str(x) for x in a); print(s, flush=True); log.append(s)
async def wait_js(pg,e,t=15000):
    t0=time.time()
    while True:
        try:
            v=await pg.evaluate(e)
            if v: return v
        except Exception: pass
        if (time.time()-t0)*1000>t: raise Exception('timeout '+e)
        await asyncio.sleep(0.25)
async def newpage(b):
    ctx=await b.new_context(viewport={'width':390,'height':844}, device_scale_factor=2, user_agent=UA, is_mobile=True, has_touch=True)
    pg=await ctx.new_page(); pg.errs=[]
    pg.on('pageerror', lambda e: pg.errs.append(str(e))); pg.on('console', lambda m: pg.errs.append('console:'+m.text) if m.type=='error' else None)
    await pg.goto(BASE+'/'); await asyncio.sleep(1.2)
    await pg.evaluate("document.querySelectorAll('.sheet-backdrop').forEach(b=>b.hidden=true)")
    return pg
async def signup(pg, u, pw, disp):
    await pg.click('#btn-account'); await asyncio.sleep(0.4)
    await pg.click('[data-go=signup]'); await asyncio.sleep(0.2)
    await pg.fill('form[data-form=signup] input[name=username]', u); await pg.fill('form[data-form=signup] input[name=display]', disp)
    await pg.fill('form[data-form=signup] input[name=password]', pw)
    await pg.click('form[data-form=signup] button[type=submit]')
    await wait_js(pg, "document.querySelectorAll('.a-codes code').length===6")
    codes=await pg.evaluate("[...document.querySelectorAll('.a-codes code')].map(c=>c.textContent)")
    return codes
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch()
        A=await newpage(b); B=await newpage(b)
        ua='sonu'+SUF; ub='amit'+SUF
        codes=await signup(A, ua, '4321', 'Sonu QA'); L('A signed up', ua, 'codes', len(codes))
        await A.screenshot(path=OUT+'/codes.png')
        await A.click('[data-act=codesdone]'); await wait_js(A, "document.querySelector('.a-phead')"); await asyncio.sleep(0.5)
        await A.screenshot(path=OUT+'/profile-new.png')
        await signup(B, ub, 'abcd', 'Amit QA'); await B.click('[data-act=codesdone]'); L('B signed up', ub)
        for pg in (A,B): await pg.click('#a-back'); await asyncio.sleep(0.3)
        L('top avatar A:', await A.inner_text('#btn-account'))
        # quick match
        await A.click('#btn-quick'); await asyncio.sleep(0.3); await A.click('#sheet-quick [data-tc="5+0"]')
        await wait_js(A, "!document.getElementById('seek').hidden"); await asyncio.sleep(1.5)
        await A.screenshot(path=OUT+'/seeking.png')
        await B.click('#btn-quick'); await asyncio.sleep(0.3); await B.click('#sheet-quick [data-tc="5+0"]')
        t0=time.time()
        for pg in (A,B): await wait_js(pg, "window.__chess.online && window.__chess.online.state && window.__chess.online.state.status==='active'", 20000)
        L('quick match paired in %.1fs' % (time.time()-t0), await A.evaluate('__chess.online.code'), 'A plays', await A.evaluate('__chess.online.color'), '| quick:', await A.evaluate('__chess.online.state.quick'))
        await asyncio.sleep(0.6); await A.screenshot(path=OUT+'/quick-game.png')
        ca=await A.evaluate('__chess.online.color'); W,K=(A,B) if ca=='w' else (B,A)
        for i,u in enumerate(['f2f3','e7e5','g2g4','d8h4']):
            mover = W if i%2==0 else K; other = K if i%2==0 else W
            n=await mover.evaluate('__chess.chess.history().length')
            await mover.evaluate(f"__chess.makeMove({{from:'{u[:2]}',to:'{u[2:4]}'}})")
            await wait_js(other, f'__chess.chess.history().length==={n+1}', 15000)
        await wait_js(A, "!document.getElementById('sheet-result').hidden", 15000)
        L('quick game over:', await A.inner_text('#result-title'))
        await asyncio.sleep(1.5)
        # profile after rated game
        for pg,nm in ((A,'A'),(B,'B')):
            await pg.click('#result-close'); await asyncio.sleep(0.2)
            await pg.click('#btn-account'); await wait_js(pg, "document.querySelector('.a-stats') && document.querySelectorAll('.a-game').length>0", 15000); await asyncio.sleep(0.6)
            L(nm, 'profile stats:', (await pg.inner_text('.a-stats')).replace('\n',' '), '| recent:', (await pg.inner_text('.a-games')).split('\n')[0:2])
        await A.screenshot(path=OUT+'/profile-after.png', full_page=False)
        await A.evaluate("document.getElementById('ascreen').scrollTop=500"); await asyncio.sleep(0.3); await A.screenshot(path=OUT+'/profile-after2.png')
        await A.click('[data-review]'); await wait_js(A, "window.__kingsideReview.G && window.__kingsideReview.G.done", 60000)
        L('review from history: moves', await A.evaluate('__kingsideReview.G.sans.join(" ")'), 'cls', await A.evaluate('__kingsideReview.G.cls.map(x=>x&&x.c).join(",")'))
        await A.click('#r-back'); await asyncio.sleep(0.4)
        # sign out, wrong password x9 -> rate limit
        await A.click('[data-go=settings]'); await asyncio.sleep(0.3); await A.click('[data-act=logout]'); await asyncio.sleep(0.6)
        msgs=[]
        for i in range(9):
            await A.fill('form[data-form=login] input[name=username]', ua); await A.fill('form[data-form=login] input[name=password]', 'wrong'+str(i))
            await A.click('form[data-form=login] button[type=submit]'); await asyncio.sleep(0.5)
            msgs.append(await A.inner_text('form[data-form=login] .a-err'))
        L('wrong logins:', msgs[0], '...', msgs[-1])
        # recovery with a code
        await A.click('[data-go=recover]'); await asyncio.sleep(0.3)
        await A.fill('form[data-form=recover] input[name=username]', ua); await A.fill('form[data-form=recover] input[name=code]', codes[0]); await A.fill('form[data-form=recover] input[name=password]', 'newpin9')
        await A.click('form[data-form=recover] button[type=submit]'); await wait_js(A, "document.querySelector('.a-phead')", 10000)
        L('recovered with code -> signed in as', await A.evaluate('__kingsideAccount.user().uname'))
        # computer game saved to history (logged in)
        await A.click('#a-back'); await asyncio.sleep(0.3)
        await A.evaluate("__chess.newGame({mode:'pvp', tc:'none'})"); await asyncio.sleep(0.2)
        for m in ['e4','e5','Bc4','Nc6','Qh5','Nf6','Qxf7']: await A.evaluate(f"__chess.makeMove('{m}')")
        await wait_js(A, "!document.getElementById('sheet-result').hidden", 5000); await asyncio.sleep(1.5); await A.click('#result-close')
        await A.click('#btn-account'); await wait_js(A, "document.querySelectorAll('.a-game').length>=2", 15000)
        L('history now:', [x.split('\n')[0] for x in (await A.inner_text('.a-games')).split('Review') if x.strip()][:3])
        # guest quick match fallback after 30s
        C=await newpage(b)
        await C.click('#btn-quick'); await asyncio.sleep(0.3); await C.click('#sheet-quick [data-tc="10+0"]')
        await wait_js(C, "!document.getElementById('seek-fallback').hidden", 45000)
        L('guest alone: fallback shown after', await C.inner_text('#seek-time'))
        await C.screenshot(path=OUT+'/seek-fallback.png')
        await C.click('#seek-ai'); await asyncio.sleep(1)
        L('fallback -> mode', await C.evaluate('__chess.settings.mode'), 'tc', await C.evaluate('__chess.settings.tc'))
        # clean up: delete the QA accounts
        r1=await A.evaluate("fetch('/api/u/delete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({s:__kingsideAccount.session(),password:'newpin9'})}).then(r=>r.json())")
        r2=await B.evaluate("fetch('/api/u/delete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({s:__kingsideAccount.session(),password:'abcd'})}).then(r=>r.json())")
        L('QA accounts deleted:', r1.get('ok'), r2.get('ok'))
        L('errors', [e for e in A.errs if '401' not in e and '429' not in e], B.errs, C.errs)
        json.dump(log, open(OUT+'/log.json','w'), indent=1)
        await b.close()
asyncio.run(main())
