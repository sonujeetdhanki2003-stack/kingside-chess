import asyncio, sys, json, time
from playwright.async_api import async_playwright
BASE=sys.argv[1]
UA="Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36"
GAME=['e2e4','e7e5','g1f3','b8c6','f1c4','g8f6','f3g5','d7d5','e4d5','f6d5','g5f7','e8f7','d1f3','f7e6','b1c3','c6b4','f3e4','c7c6','d2d4','e5d4','c1f4','d8a5','e1g1']
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch()
        ctx=await b.new_context(viewport={'width':390,'height':844}, device_scale_factor=2, user_agent=UA, is_mobile=True, has_touch=True)
        pg=await ctx.new_page(); errs=[]
        pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append('console:'+m.text) if m.type=='error' else None)
        await pg.goto(BASE); await asyncio.sleep(2)
        # dismiss new game sheet if open
        await pg.evaluate("document.querySelectorAll('.sheet-backdrop').forEach(b=>b.hidden=true)")
        await pg.evaluate("window.__chess.newGame({mode:'pvp'})")
        for u in GAME:
            await pg.evaluate(f"window.__chess.makeMove({{from:'{u[:2]}',to:'{u[2:4]}'}})")
        await asyncio.sleep(0.5)
        op=await pg.evaluate("document.getElementById('opening').textContent"); print('opening:',op)
        await pg.screenshot(path='/tmp/w1/game.png')
        await pg.click('#btn-review')
        t0=time.time()
        while time.time()-t0<120:
            d=await pg.evaluate("window.__kingsideReview.G && window.__kingsideReview.G.done")
            if d: break
            await asyncio.sleep(1)
        print('analysis secs', round(time.time()-t0,1))
        await pg.screenshot(path='/tmp/w1/rev0.png')
        G=await pg.evaluate("(()=>{const G=window.__kingsideReview.G;return {acc:G.acc,cls:G.cls.map(x=>x&&x.c),sans:G.sans,ev:G.evals.map(e=>e&&(e.mate!==undefined?'M'+e.mate:e.cp))}})()")
        print(json.dumps(G))
        for i in range(14): await pg.click('#r-next'); await asyncio.sleep(0.15)
        await asyncio.sleep(0.5); await pg.screenshot(path='/tmp/w1/rev14.png')
        await pg.evaluate("window.scrollTo(0,0)"); 
        await pg.evaluate("document.getElementById('rscreen').scrollTop=600"); await asyncio.sleep(0.3); await pg.screenshot(path='/tmp/w1/rev_sum.png')
        print('errors', errs)
        await b.close()
asyncio.run(main())
