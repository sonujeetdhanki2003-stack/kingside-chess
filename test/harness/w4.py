
import asyncio, sys, json, time, random
from playwright.async_api import async_playwright
BASE=sys.argv[1].rstrip('/'); OUT=sys.argv[2]; SUF=str(random.randint(100,999))
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
async def newpage(b, mobile=True):
    ctx=await b.new_context(viewport={'width':390,'height':844}, device_scale_factor=2, user_agent=UA, is_mobile=mobile, has_touch=mobile)
    pg=await ctx.new_page(); pg.errs=[]
    pg.on('pageerror', lambda e: pg.errs.append(str(e))); pg.on('console', lambda m: pg.errs.append('console:'+m.text) if m.type=='error' else None)
    await pg.goto(BASE+'/'); await asyncio.sleep(1.2)
    await pg.evaluate("document.querySelectorAll('.sheet-backdrop').forEach(b=>b.hidden=true)")
    return pg
async def signup(pg, u, pw, disp):
    await pg.click('#btn-account'); await asyncio.sleep(0.4); await pg.click('[data-go=signup]'); await asyncio.sleep(0.2)
    await pg.fill('form[data-form=signup] input[name=username]', u); await pg.fill('form[data-form=signup] input[name=display]', disp)
    await pg.fill('form[data-form=signup] input[name=password]', pw); await pg.click('form[data-form=signup] button[type=submit]')
    await wait_js(pg, "document.querySelectorAll('.a-codes code').length===6"); await pg.click('[data-act=codesdone]'); await asyncio.sleep(0.4)
async def click_sq(pg, sq):
    box=await pg.locator(f'#board .sq[data-square="{sq}"]').bounding_box()
    await pg.mouse.click(box['x']+box['width']/2, box['y']+box['height']/2)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch()
        A=await newpage(b, mobile=False); B=await newpage(b)
        ua='raj'+SUF; ub='priya'+SUF
        await signup(A, ua, 'pass1', 'Raj QA'); await signup(B, ub, 'pass2', 'Priya QA'); L('signed up', ua, ub)
        await A.click('[data-go=friends]'); await asyncio.sleep(0.5)
        await A.fill('form[data-form=fsearch] input', ub); await A.click('form[data-form=fsearch] button'); await wait_js(A, "document.querySelector('#f-results [data-act=fadd]')")
        await A.click('#f-results [data-act=fadd]'); await asyncio.sleep(0.8); L('A sent friend request')
        await B.click('[data-go=friends]'); await wait_js(B, "document.querySelector('[data-act=faccept]')", 10000)
        L('B sees request; badge on avatar:', await B.evaluate("document.getElementById('btn-account').dataset.badge"))
        await B.click('[data-act=faccept]'); await asyncio.sleep(1)
        await wait_js(A, "document.querySelector('[data-act=challenge]')", 10000); L('A sees B as friend')
        await A.screenshot(path=OUT+'/friends.png')
        await A.click('[data-act=challenge]'); await asyncio.sleep(0.3); await A.click('#sheet-chal [data-tc="10+0"]'); await asyncio.sleep(0.5)
        for pg in (A,B): await pg.click('#a-back'); await asyncio.sleep(0.3)
        await wait_js(B, "!document.getElementById('challenge-bar').hidden", 20000)
        L('B challenge bar:', await B.inner_text('#challenge-text'))
        await B.screenshot(path=OUT+'/challenge-bar.png')
        await B.click('#challenge-yes')
        for pg in (A,B): await wait_js(pg, "window.__chess.online && window.__chess.online.state && window.__chess.online.state.status==='active'", 20000)
        L('challenge accepted -> both in room', await A.evaluate('__chess.online.code'), '| A color', await A.evaluate('__chess.online.color'), '| names', await A.evaluate('JSON.stringify(__chess.online.state.names)'))
        ca=await A.evaluate('__chess.online.color'); W,K=(A,B) if ca=='w' else (B,A)
        # chat
        await A.click('#chat-quick button:nth-child(2)'); await wait_js(B, "document.querySelectorAll('#chat-log li').length>=1", 10000)
        L('B got chat:', await B.inner_text('#chat-log'), '| pop:', await B.evaluate("!document.getElementById('chat-pop').hidden && document.getElementById('chat-pop').textContent"))
        await B.fill('#chat-input', 'Thanks, you too! 🙂'); await B.press('#chat-input', 'Enter'); await wait_js(A, "document.querySelectorAll('#chat-log li').length>=2", 10000)
        L('A chat log:', (await A.inner_text('#chat-log')).replace('\n',' | '))
        await B.screenshot(path=OUT+'/chat-B.png')
        # premove: black picks e7->e5 while white to move
        await click_sq(K,'e7'); await asyncio.sleep(0.2); await click_sq(K,'e5'); await asyncio.sleep(0.3)
        L('black premove set:', await K.evaluate("document.querySelectorAll('#board .sq.pre').length"))
        await K.screenshot(path=OUT+'/premove.png')
        await W.evaluate("__chess.makeMove({from:'e2',to:'e4'})")
        await wait_js(W, "__chess.chess.history().length===2", 10000)
        L('premove auto-played:', await W.evaluate("__chess.chess.history().join(' ')"))
        # arrows: right-click drag on desktop A
        await A.evaluate("document.getElementById('board').scrollIntoView({block:'center'})"); await asyncio.sleep(0.3)
        await A.evaluate("window.__ev=[];['pointerdown','pointerup'].forEach(t=>document.getElementById('board').addEventListener(t,e=>window.__ev.push(t+e.button),true))")
        bx=await A.locator('#board .sq[data-square="g1"]').bounding_box(); by=await A.locator('#board .sq[data-square="f3"]').bounding_box()
        await A.mouse.move(bx['x']+bx['width']/2, bx['y']+bx['height']/2); await A.mouse.down(button='right'); await A.mouse.move(by['x']+by['width']/2, by['y']+by['height']/2, steps=5); await A.mouse.up(button='right')
        await A.mouse.click(by['x']+5, by['y']+5, button='right'); await asyncio.sleep(0.3)
        L('ev', await A.evaluate('JSON.stringify(window.__ev)'), await A.evaluate("document.elementFromPoint(%f,%f).id+'/'+document.elementFromPoint(%f,%f).className" % (bx['x']+5,bx['y']+5,bx['x']+5,bx['y']+5)))
        L('A drew arrows:', await A.evaluate("document.querySelectorAll('#arrows g').length"), 'marks:', await A.evaluate("document.querySelectorAll('#board .sq.umark').length"))
        await A.screenshot(path=OUT+'/arrows.png')
        # piece set + theme
        await B.click('#btn-settings'); await asyncio.sleep(0.3); await B.click('#sheet-settings [data-value=merida]'); await B.click('#sheet-settings [data-value=purple]'); await asyncio.sleep(0.3)
        await B.screenshot(path=OUT+'/settings.png')
        await B.click('#settings-done'); await asyncio.sleep(0.3)
        L('B pieces now:', await B.evaluate("getComputedStyle(document.querySelector('#board .piece.wK')).backgroundImage.split('/').slice(-2).join('/')"), '| theme class:', await B.evaluate("[...document.body.classList].join(' ')"))
        await B.screenshot(path=OUT+'/merida.png')
        # resign to finish, check history on both
        await W.evaluate("document.getElementById('btn-resign').click()"); await asyncio.sleep(0.3)
        if await W.locator('#confirm-yes').is_visible(): await W.click('#confirm-yes')
        await wait_js(K, "!document.getElementById('sheet-result').hidden", 15000); L('game over for black:', await K.inner_text('#result-title'))
        # cleanup
        for pg,pw in ((A,'pass1'),(B,'pass2')):
            r=await pg.evaluate(f"fetch('/api/u/delete',{{method:'POST',headers:{{'content-type':'application/json'}},body:JSON.stringify({{s:__kingsideAccount.session(),password:'{pw}'}})}}).then(r=>r.json())")
            L('deleted', r.get('ok'))
        L('errors', A.errs, B.errs)
        json.dump(log, open(OUT+'/log.json','w'), indent=1)
        await b.close()
asyncio.run(main())
