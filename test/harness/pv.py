
import asyncio, sys
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        br=await p.chromium.launch(); pg=await (await br.new_context(viewport={'width':1440,'height':900})).new_page()
        logs=[]; pg.on('console', lambda m: logs.append(m.type+': '+m.text[:300])); pg.on('pageerror', lambda e: logs.append('ERR '+str(e)))
        pg.on('response', lambda r: r.status>=400 and logs.append(f'{r.status} {r.url}')); pg.on('requestfailed', lambda r: logs.append('FAILED '+r.url[-60:]+' '+str(r.failure)))
        await pg.goto(sys.argv[1], wait_until='domcontentloaded'); await pg.wait_for_timeout(9000)
        print(await pg.inner_text('#status')); print('\n'.join(logs[:20])); await br.close()
asyncio.run(main())
