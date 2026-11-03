
import asyncio, json, requests, secrets
from playwright.async_api import async_playwright
B='https://sonujeet-chess.sites.tab.bot'
c=requests.post(B+'/api/t/create',json={'name':'404 probe','format':'ko','tc':'none'}).json()
t1,t2=secrets.token_hex(16),secrets.token_hex(16)
requests.post(B+'/api/t/join',json={'code':c['code'],'tok':t1,'name':'A'}); requests.post(B+'/api/t/join',json={'code':c['code'],'tok':t2,'name':'B'})
s=requests.post(B+'/api/t/admin',json={'code':c['code'],'adm':c['adm'],'action':'start'}).json()
room=s['rounds'][0][0]['games'][0]['room']
async def main():
    async with async_playwright() as p:
        br=await p.chromium.launch(); ctx=await br.new_context(); pg=await ctx.new_page()
        bad=[]; pg.on('response', lambda r: r.status>=400 and bad.append((r.status, r.url)))
        await pg.goto(B+'/?t='+c['code']); await pg.evaluate(f"localStorage.setItem('kingside-device-v1', JSON.stringify('{t1}'))")
        await pg.reload(); await pg.wait_for_timeout(2500)
        await pg.click('[data-act=play]'); await pg.wait_for_timeout(3000)
        st=requests.get(B+'/api/poll',params={'code':room,'ver':-1}).json()
        wt = t1 if st['names']['w']=='A' else t2; bt = t2 if wt==t1 else t1
        requests.post(B+'/api/move',json={'code':room,'tok':wt,'uci':'e2e4','ply':0})
        requests.post(B+'/api/action',json={'code':room,'tok':wt,'type':'offer_draw'}); requests.post(B+'/api/action',json={'code':room,'tok':bt,'type':'accept_draw'})
        await pg.wait_for_timeout(4000)
        print(bad); await br.close()
asyncio.run(main())
requests.post(B+'/api/t/admin',json={'code':c['code'],'adm':c['adm'],'action':'end'})
