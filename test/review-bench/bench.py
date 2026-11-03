
import asyncio, sys, json, time
from playwright.async_api import async_playwright
BASE=sys.argv[1]; OUT=sys.argv[2]; IDS=sys.argv[3].split(',')
UA="Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36"
GAMES={g['id']:g for g in json.load(open(sys.argv[4] if len(sys.argv)>4 else 'games.json'))}
async def main():
    res={}
    async with async_playwright() as p:
        b=await p.chromium.launch()
        for gid in IDS:
            g=GAMES[gid]
            ctx=await b.new_context(viewport={'width':390,'height':844}, device_scale_factor=2, user_agent=UA, is_mobile=True, has_touch=True)
            pg=await ctx.new_page(); errs=[]
            pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.goto(BASE, wait_until='load'); await asyncio.sleep(1.5)
            # warm the engine first (download is not counted in per-game analysis time, but reported)
            t_load=time.time()
            await pg.evaluate("async()=>{const m=await import('./review.js'); await m.analyzer.start();}")
            t_load=time.time()-t_load
            t0=time.time()
            await pg.evaluate("(g)=>import('./review.js').then(m=>m.open(g))", {'moves':g['ucis'],'white':g['white'],'black':g['black'],'result':g['result'],'orientation':'w'})
            while time.time()-t0<900:
                d=await pg.evaluate("!!(window.__kingsideReview && window.__kingsideReview.G && window.__kingsideReview.G.done)")
                if d: break
                await asyncio.sleep(0.5)
            secs=time.time()-t0
            G=await pg.evaluate("(()=>{const G=window.__kingsideReview.G;return {acc:G.acc,cls:G.cls,evals:G.evals.map(e=>e&&({cp:e.cp,mate:e.mate,matedSide:e.matedSide,best:e.best,second:e.second,depth:e.depth})),eng:window.__kingsideReview.analyzer.info&&window.__kingsideReview.analyzer.info.name}})()")
            G['secs']=round(secs,1); G['load']=round(t_load,1); G['errs']=errs
            res[gid]=G
            print(gid, len(g['ucis']), 'plies', G['secs'],'s', G['acc'], flush=True)
            await ctx.close()
            json.dump(res,open(OUT,'w'))
        await b.close()
asyncio.run(main())
