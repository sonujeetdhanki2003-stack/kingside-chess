
import asyncio, sys, json, time
from playwright.async_api import async_playwright
BASE=sys.argv[1]; OUT=sys.argv[2]
UA="Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36"
async def wait_js(pg,e,t=15000):
    t0=time.time()
    while True:
        try:
            v=await pg.evaluate(e)
            if v: return v
        except Exception: pass
        if (time.time()-t0)*1000>t: raise Exception('timeout '+e)
        await asyncio.sleep(0.2)
async def click_sq(pg, sq):
    box=await pg.locator(f'#p-board .sq[data-sq="{sq}"]').bounding_box()
    await pg.mouse.click(box['x']+box['width']/2, box['y']+box['height']/2)
async def solve(pg, wrong_first=False):
    await wait_js(pg,"window.__kingsidePuzzles.P && !window.__kingsidePuzzles.P.done && window.__kingsidePuzzles.P.step===1")
    await asyncio.sleep(0.4)
    P=await pg.evaluate("(()=>{const P=window.__kingsidePuzzles.P;return {id:P.id,moves:P.moves,rating:P.rating,color:P.color}})()")
    if wrong_first:
        legal=await pg.evaluate("(()=>{const P=window.__kingsidePuzzles.P;return P.chess.moves({verbose:true}).map(m=>m.from+m.to)})()")
        bad=[m for m in legal if m!=P['moves'][1][:4]][0]
        await click_sq(pg,bad[:2]); await asyncio.sleep(0.15); await click_sq(pg,bad[2:4]); await asyncio.sleep(0.4); print('  mid', (await pg.inner_text('#p-feedback')).split('\n')[0]); await asyncio.sleep(0.8)
        print('  wrong move', bad, 'feedback:', (await pg.inner_text('#p-feedback')).split('\n')[0], await pg.evaluate('window.__kingsidePuzzles.P.failed'))
    for k in range(1,len(P['moves']),2):
        u=P['moves'][k]
        await wait_js(pg,f"window.__kingsidePuzzles.P.step==={k}",8000); await asyncio.sleep(0.3)
        await click_sq(pg,u[:2]); await asyncio.sleep(0.15); await click_sq(pg,u[2:4])
    await wait_js(pg,"window.__kingsidePuzzles.P.done",8000)
    return P
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch()
        ctx=await b.new_context(viewport={'width':390,'height':844}, device_scale_factor=2, user_agent=UA, is_mobile=True, has_touch=True)
        pg=await ctx.new_page(); errs=[]
        pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append('console:'+m.text) if m.type=='error' else None)
        await pg.goto(BASE); await asyncio.sleep(1.5)
        await pg.evaluate("document.querySelectorAll('.sheet-backdrop').forEach(b=>b.hidden=true)")
        await pg.screenshot(path=OUT+'/home-main.png')
        await pg.click('#btn-puzzles'); await asyncio.sleep(1); await pg.screenshot(path=OUT+'/pz-home.png')
        await pg.click('#p-body [data-act=daily]')
        await wait_js(pg,"window.__kingsidePuzzles.P && window.__kingsidePuzzles.P.step>=1"); await asyncio.sleep(0.5)
        await pg.screenshot(path=OUT+'/pz-daily-start.png')
        P=await solve(pg)
        print('daily', P['id'], P['rating'], (await pg.inner_text('#p-feedback')).replace('\n',' | '))
        await pg.screenshot(path=OUT+'/pz-daily-solved.png')
        await pg.click('#p-actions [data-act=rated]')
        P=await solve(pg); print('rated1', P['id'],P['rating'], (await pg.inner_text('#p-feedback')).replace('\n',' | '))
        await pg.screenshot(path=OUT+'/pz-rated-solved.png')
        await pg.click('#p-actions [data-act=next]')
        P=await solve(pg, wrong_first=True); print('rated2 (wrong first)', P['id'],P['rating'], (await pg.inner_text('#p-feedback')).replace('\n',' | '))
        st=await pg.evaluate("window.__kingsidePuzzles.stats()"); print('stats r',round(st['r']),'n',st['n'],'won',st['won'],'daily',st['daily'],'streak',st['streak'])
        # daily is same in a 2nd context
        ctx2=await b.new_context(viewport={'width':390,'height':844}); pg2=await ctx2.new_page(); await pg2.goto(BASE+'?puzzle=daily')
        await wait_js(pg2,"window.__kingsidePuzzles && window.__kingsidePuzzles.P"); d2=await pg2.evaluate("window.__kingsidePuzzles.P.id")
        print('daily same on other device:', d2==(await pg.evaluate("window.__kingsidePuzzles.dailyPuzzle().then(p=>p.id)")), d2)
        await pg.click('#p-back'); await asyncio.sleep(0.5); await pg.click('#p-back'); await asyncio.sleep(0.5)
        print('closed puzzles:', await pg.evaluate("document.getElementById('pscreen').hidden"), '| quick:', await pg.inner_text('#btn-puzzles'), '/', await pg.inner_text('#btn-daily'))
        await pg.screenshot(path=OUT+'/home-after.png')
        print('errors', errs)
        await b.close()
asyncio.run(main())
