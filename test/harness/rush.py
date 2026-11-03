
import asyncio, sys, json, time, random
from playwright.async_api import async_playwright
BASE=sys.argv[1]; OUT=sys.argv[2]
UA="Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36"
async def solve_current(pg, correct=True):
    # play the expected move for the current step (or a wrong legal move)
    return await pg.evaluate("""(ok)=>{const P=window.__kingsidePuzzles.P; if(!P||P.done) return 'none';
      const exp=P.moves[P.step]; const sq=(s)=>document.querySelector('#p-board .sq[data-square="'+s+'"]');
      let u=exp; if(!ok){const m=P.chess.moves({verbose:true}).map(x=>x.from+x.to).filter(x=>x!==exp.slice(0,4)); u=m[0];}
      return u;}""", correct)
async def click_sq(pg, sq):
    box=await pg.locator(f'#p-board .sq[data-sq="{sq}"]').bounding_box()
    await pg.mouse.click(box['x']+box['width']/2, box['y']+box['height']/2)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch()
        ctx=await b.new_context(viewport={'width':360,'height':780}, device_scale_factor=2, user_agent=UA, is_mobile=True, has_touch=True)
        pg=await ctx.new_page(); errs=[]
        pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append('console:'+m.text) if m.type=='error' else None)
        await pg.goto(BASE); await pg.wait_for_timeout(1500)
        await pg.screenshot(path=OUT+'/home-v14.png')
        await pg.click('#btn-rush'); await pg.wait_for_timeout(1200)
        await pg.screenshot(path=OUT+'/rush-intro.png')
        await pg.click('[data-act=rushgo]')
        solved=0; t0=time.time()
        while time.time()-t0<60:
            st=await pg.evaluate("(()=>{const P=window.__kingsidePuzzles.P,R=window.__kingsidePuzzles.R; return {run:!!(R&&R.running), ready: !!P && !P.done && P.step%2===1, score:R?R.score:0, strikes:R?R.strikes:0}})()")
            if not st['run']: break
            if not st['ready']: await asyncio.sleep(0.15); continue
            ok = not (st['score'] in (3,7,9))
            u=await solve_current(pg, ok)
            if u=='none': continue
            await click_sq(pg,u[:2]); await click_sq(pg,u[2:4])
            await asyncio.sleep(0.2)
            if st['score']==4: await pg.screenshot(path=OUT+'/rush-run.png')
        await pg.wait_for_timeout(1500)
        print('rush state', await pg.evaluate("JSON.stringify({best: window.__kingsidePuzzles.rushBest(), body: document.getElementById('p-body').innerText.slice(0,300)})"))
        await pg.screenshot(path=OUT+'/rush-over.png')
        print('progress', await pg.evaluate("JSON.stringify(window.__kingsideProgress.load())"))
        # achievements view
        await pg.click('#p-back'); await pg.wait_for_timeout(400)
        await pg.click('[data-tab=home]'); await pg.wait_for_timeout(400)
        print('hub', await pg.inner_text('#rush-sub'), '|', await pg.inner_text('#ach-sub'), '| streak', await pg.inner_text('#hub-streak-n'))
        # win a game vs computer level 1 quickly by forcing result via resign of engine? play 2-player mate for streak
        await pg.evaluate("window.__chess.newGame({mode:'pvp'})")
        for u in ['f2f3','e7e5','g2g4','d8h4']:
            await pg.evaluate(f"window.__chess.makeMove({{from:'{u[:2]}',to:'{u[2:4]}'}})")
        await pg.wait_for_timeout(4000)
        await pg.evaluate("document.querySelectorAll('.sheet-backdrop').forEach(b=>b.hidden=true)")
        await pg.click('#btn-home'); await pg.wait_for_timeout(600)
        print('after game: streak', await pg.inner_text('#hub-streak-n'), await pg.get_attribute('#hub-streak','class'), '|', await pg.inner_text('#ach-sub'))
        await pg.screenshot(path=OUT+'/home-streak.png')
        await pg.click('#btn-ach'); await pg.wait_for_timeout(600)
        await pg.screenshot(path=OUT+'/achievements.png')
        print('errors', errs)
        await pg.evaluate("fetch('/api/r/forget',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({dev:JSON.parse(localStorage.getItem('kingside-device-v1'))})})")
        await b.close()
asyncio.run(main())
