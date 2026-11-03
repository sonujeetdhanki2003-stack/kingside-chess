
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
        A=await newpage(b)
        # guest: finish a game (2-player fool's mate) -> streak day + First Move
        await A.evaluate("window.__chess.newGame({mode:'pvp'})")
        for u in ['f2f3','e7e5','g2g4','d8h4']: await A.evaluate(f"window.__chess.makeMove({{from:'{u[:2]}',to:'{u[2:4]}'}})")
        await asyncio.sleep(2.5)
        g=await A.evaluate("JSON.stringify(window.__kingsideProgress.load())"); L('guest progress', g)
        toast=await A.evaluate("document.getElementById('ach-toast') ? document.getElementById('ach-toast').innerText : ''"); L('unlock toast:', toast.replace('\n',' / '))
        # beat the computer: simulate a win at level 6 by resigning for the engine side is not possible; record via the same path the game uses
        await A.evaluate("window.__kingsideProgress.record('game',{plies:30,mode:'ai',level:6,win:true})")
        ach=await A.evaluate("Object.keys(window.__kingsideProgress.load().ach).sort().join(',')"); L('guest badges:', ach)
        await A.evaluate("document.querySelectorAll('.sheet-backdrop').forEach(b=>b.hidden=true)")
        await A.click('#btn-home'); await asyncio.sleep(0.5)
        L('home streak chip:', await A.inner_text('#hub-streak-n'), '| class', await A.get_attribute('#hub-streak','class'), '| tile:', await A.inner_text('#ach-sub'))
        # sign up -> merged to the account
        u='ach'+SUF
        await signup(A, u, 'pass1', 'Kavya QA'); await asyncio.sleep(2.5)
        srv=await A.evaluate("(async()=>{const s=JSON.parse(localStorage.getItem('kingside-session-v1'));const r=await fetch('/api/u/progress',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({s})});return JSON.stringify((await r.json()).prog)})()")
        L('server copy after sign-up:', srv)
        ok1=all(k in srv for k in ['first_game','first_win','beat_4','beat_6'])
        # profile shows badges
        if not await A.locator('#ascreen').is_visible(): await A.click('#hub-hello')
        await A.evaluate("document.querySelector('[data-go=profile]') && 0"); await asyncio.sleep(1.5)
        prof=await A.inner_text('#a-body'); L('profile has achievements card:', 'Achievements' in prof)
        await A.screenshot(path=OUT+'/ach-profile.png')
        # sign out -> local cleared; sign in -> restored
        await A.evaluate("document.querySelector('[data-go=settings]').click()"); await asyncio.sleep(0.5)
        await A.evaluate("document.querySelector('[data-act=logout]').click()"); await asyncio.sleep(1)
        cleared=await A.evaluate("Object.keys(window.__kingsideProgress.load().ach).length"); L('badges on phone after sign-out:', cleared)
        await A.fill('form[data-form=login] input[name=username]', u); await A.fill('form[data-form=login] input[name=password]', 'pass1')
        await A.click('form[data-form=login] button[type=submit]'); await asyncio.sleep(2.5)
        back=await A.evaluate("Object.keys(window.__kingsideProgress.load().ach).sort().join(',')"); L('badges after signing in again:', back)
        L('RESULT', 'PASS' if ok1 and cleared==0 and 'beat_6' in back else 'FAIL')
        d=await A.evaluate("(async()=>{const s=JSON.parse(localStorage.getItem('kingside-session-v1'));const r=await fetch('/api/u/delete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({s,password:'pass1'})});return (await r.json()).ok})()")
        L('deleted', d); L('errors', A.errs)
        await b.close()
asyncio.run(main())
