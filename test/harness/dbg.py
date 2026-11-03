
import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); ctx=await b.new_context(viewport={'width':390,'height':844}); pg=await ctx.new_page()
        evs=[]; pg.on('console', lambda m: evs.append(m.text))
        await pg.goto('http://localhost:8790/'); await asyncio.sleep(1)
        await pg.evaluate("document.querySelectorAll('.sheet-backdrop').forEach(b=>b.hidden=true); __chess.newGame({mode:'pvp'})")
        await pg.evaluate("['pointerdown','pointerup','pointermove','contextmenu'].forEach(t=>document.getElementById('board').addEventListener(t,e=>console.log(t,e.button,e.buttons),true))")
        bx=await pg.locator('#board .sq[data-square="g1"]').bounding_box(); by=await pg.locator('#board .sq[data-square="f3"]').bounding_box()
        await pg.mouse.move(bx['x']+20, bx['y']+20); await pg.mouse.down(button='right'); await pg.mouse.move(by['x']+20, by['y']+20, steps=4); await pg.mouse.up(button='right'); await asyncio.sleep(0.3)
        print(evs[:12]); print(await pg.evaluate("document.querySelectorAll('#arrows g').length"))
        await b.close()
asyncio.run(main())
