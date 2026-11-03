
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

async def until(pg, e, t=15000):
    t0=time.time(); await wait_js(pg, e, t); return time.time()-t0
async def delete(pg, pw):
    return await pg.evaluate(f"(async()=>{{const s=JSON.parse(localStorage.getItem('kingside-session-v1'));const r=await fetch('/api/u/delete',{{method:'POST',headers:{{'content-type':'application/json'}},body:JSON.stringify({{s,password:'{pw}'}})}});return (await r.json()).ok}})()")
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch()
        A=await newpage(b); B=await newpage(b)
        ua='rtA'+SUF; ub='rtB'+SUF
        await signup(A, ua, 'pass1', 'Vikram QA'); await signup(B, ub, 'pass2', 'Neha QA'); L('signed up', ua, ub)
        await asyncio.sleep(2.5)  # let both long-polls settle
        # friend request: B is on the home screen (not on the friends page) and should get the badge fast
        await A.click('[data-go=friends]'); await asyncio.sleep(0.5)
        await A.fill('form[data-form=fsearch] input', ub); await A.click('form[data-form=fsearch] button'); await wait_js(A, "document.querySelector('#f-results [data-act=fadd]')")
        for pg in (A,B): await pg.evaluate("document.getElementById('a-back') && !document.getElementById('ascreen').hidden && 0")
        await B.click('#a-back'); await asyncio.sleep(0.4)
        await A.click('#f-results [data-act=fadd]')
        dt=await until(B, "document.getElementById('btn-account').dataset.badge==='1'", 10000); L('friend request badge on B after %.2fs' % dt); RES['request']=dt
        await B.click('[data-tab=friends]'); await wait_js(B, "document.querySelector('[data-act=faccept]')", 5000)
        await B.click('[data-act=faccept]')
        dt=await until(A, "document.querySelector('[data-act=challenge]')", 10000); L('A sees acceptance after %.2fs' % dt); RES['accept']=dt
        # presence: B goes away (page hidden -> no long-poll), A's list should still show online within window; skip
        # challenge: B back on home screen
        await B.click('[data-tab=home]'); await asyncio.sleep(0.5)
        await A.click('[data-act=challenge]'); await asyncio.sleep(0.3)
        await A.click('#sheet-chal [data-tc="10+0"]')
        dt=await until(B, "!document.getElementById('challenge-bar').hidden", 10000); L('challenge bar on B after %.2fs' % dt); RES['challenge']=dt
        await A.click('#a-back'); await asyncio.sleep(0.3)
        await B.click('#challenge-yes')
        dt=await until(A, "window.__chess.online && window.__chess.online.state && window.__chess.online.state.status==='active'", 10000); L('A in the game after %.2fs' % dt); RES['enter']=dt
        await wait_js(B, "window.__chess.online && window.__chess.online.state && window.__chess.online.state.status==='active'", 10000)
        # chat latency both ways
        for (S,R,name) in ((A,B,'A->B'),(B,A,'B->A')):
            await S.evaluate("document.getElementById('chat-card') && document.getElementById('chat-card').classList.remove('min')")
            msg='hi '+str(random.randint(1000,9999))
            await S.fill('#chat-input', msg); await S.press('#chat-input','Enter')
            dt=await until(R, f"document.getElementById('chat-log') && document.getElementById('chat-log').textContent.includes('{msg}')", 10000)
            L('chat %s after %.2fs' % (name, dt)); RES['chat '+name]=dt
        # moves
        ca=await A.evaluate('__chess.online.color'); Wp,Kp=(A,B) if ca=='w' else (B,A)
        await click_sq(Wp,'e2'); await click_sq(Wp,'e4')
        dt=await until(Kp, "window.__chess.chess.history().length===1", 10000); L('move seen after %.2fs' % dt); RES['move']=dt
        # home card rating refreshes after a rated (Quick Match) game, without reopening the app
        for pg in (A,B):
            await pg.evaluate("document.querySelectorAll('.sheet-backdrop').forEach(b=>b.hidden=true)"); await pg.click('#btn-home'); await asyncio.sleep(0.6)
        before=await A.inner_text('#hub-sub')
        t0=time.time()
        for pg in (A,B): await pg.evaluate("window.__acct && 0"); 
        await A.click('#btn-quick'); await asyncio.sleep(0.3); await A.click('#sheet-quick [data-tc="5+0"]')
        await B.click('#btn-quick'); await asyncio.sleep(0.3); await B.click('#sheet-quick [data-tc="5+0"]')
        # v1.8.3: a found match shows "Match found!" (4 s countdown, Play now / Decline); the pairing time is until that prompt
        for pg in (A,B): await wait_js(pg, "!document.getElementById('match-found').hidden", 15000)
        L('quick match paired after %.2fs' % (time.time()-t0)); RES['quick pair']=time.time()-t0
        for pg in (A,B): await pg.click('#mf-play')
        for pg in (A,B): await wait_js(pg, "window.__chess.online && window.__chess.online.state && window.__chess.online.state.status==='active' && window.__chess.online.state.quick", 15000)
        ca=await A.evaluate('__chess.online.color'); Wp,Kp=(A,B) if ca=='w' else (B,A)
        L('quick room', await A.evaluate('[__chess.online.code,__chess.online.color,__chess.chess.history().length,__chess.chess.turn()]'), await B.evaluate('[__chess.online.code,__chess.online.color,__chess.chess.history().length]'))
        for n,(pg,u) in enumerate(((Wp,'f2f3'),(Kp,'e7e5'),(Wp,'g2g4'),(Kp,'d8h4'))):
            try: await wait_js(pg, f"window.__chess.chess.history().length==={n} && window.__chess.chess.turn()===window.__chess.online.color", 8000)
            except Exception:
                for q in (A,B): print('FAIL state', await q.evaluate("[__chess.chess.history(), __chess.online.code, __chess.online.ver, __chess.online.conn, document.getElementById('toast').textContent, document.getElementById('status').textContent]"))
                await A.screenshot(path='/tmp/w1/rtA.png'); await B.screenshot(path='/tmp/w1/rtB.png'); raise
            await click_sq(pg,u[:2]); await click_sq(pg,u[2:])
            await wait_js(pg, f"window.__chess.chess.history().length==={n+1}", 8000)
        await wait_js(A, "window.__chess.result", 8000); await asyncio.sleep(1.5)
        await A.evaluate("document.querySelectorAll('.sheet-backdrop').forEach(b=>b.hidden=true)")
        await A.click('#btn-home'); await asyncio.sleep(1.5)
        after=await A.inner_text('#hub-sub')
        L('home card before/after:', before, '|', after); import re as _re; RES_OK['hub rating refreshed']=_re.findall(r'\d+',before)[:1]!=_re.findall(r'\d+',after)[:1]
        L('RESULT', json.dumps(RES), json.dumps(RES_OK))
        bad=[k for k,v in RES.items() if v>2.5]+[k for k,v in RES_OK.items() if not v]
        L('FAILED/slow (>2.5s):', bad)
        L('deleted', await delete(A,'pass1'), await delete(B,'pass2'))
        L('errors', A.errs, B.errs)
        await b.close()
RES={}; RES_OK={}
asyncio.run(main())
