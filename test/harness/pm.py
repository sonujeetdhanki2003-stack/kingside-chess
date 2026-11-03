
import asyncio, time
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); ctx=await b.new_context(viewport={'width':390,'height':844}, is_mobile=True, has_touch=True); pg=await ctx.new_page()
        await pg.goto('https://sonujeet-chess.sites.tab.bot/'); 
        t0=time.time()
        while not await pg.evaluate('window.__chess && window.__chess.engine.ready') and time.time()-t0<30: await asyncio.sleep(0.3)
        await pg.evaluate("document.querySelectorAll('.sheet-backdrop').forEach(b=>b.hidden=true); __chess.newGame({mode:'ai', color:'w', level:5, tc:'none'})"); await asyncio.sleep(0.5)
        await pg.evaluate("__chess.makeMove({from:'e2',to:'e4'})"); await asyncio.sleep(0.1)
        async def tap(sq):
            bb=await pg.locator(f'#board .sq[data-square="{sq}"]').bounding_box(); await pg.touchscreen.tap(bb['x']+bb['width']/2, bb['y']+bb['height']/2)
        print('thinking:', await pg.evaluate('__chess.thinking'))
        await tap('g1'); await asyncio.sleep(0.1); await tap('f3')
        print('premove squares:', await pg.evaluate("document.querySelectorAll('#board .sq.pre').length"))
        t0=time.time()
        while await pg.evaluate('__chess.chess.history().length') < 3 and time.time()-t0<15: await asyncio.sleep(0.2)
        print('history after engine reply:', await pg.evaluate("__chess.chess.history().join(' ')"))
        # long-press arrow on touch: CDP touch events
        cdp=await ctx.new_cdp_session(pg)
        a=await pg.locator('#board .sq[data-square="d2"]').bounding_box(); c=await pg.locator('#board .sq[data-square="d4"]').bounding_box()
        x1,y1=a['x']+a['width']/2,a['y']+a['height']/2; x2,y2=c['x']+c['width']/2,c['y']+c['height']/2
        await cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x1,'y':y1}]}); await asyncio.sleep(0.7)
        for k in range(1,6): await cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x1+(x2-x1)*k/5,'y':y1+(y2-y1)*k/5}]}); await asyncio.sleep(0.05)
        await cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]}); await asyncio.sleep(0.3)
        print('long-press arrows:', await pg.evaluate("document.querySelectorAll('#arrows g').length"), '| history unchanged:', await pg.evaluate("__chess.chess.history().length"))
        await pg.screenshot(path='/tmp/w1/premove-arrow.png')
        await b.close()
asyncio.run(main())
