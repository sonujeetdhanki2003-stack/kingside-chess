
import asyncio,sys,time,json,random
from playwright.async_api import async_playwright
UA="Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36"
BASE=sys.argv[1].rstrip('/'); OUT=sys.argv[2]; LANG=sys.argv[3] if len(sys.argv)>3 else 'en'
CHECK=r"""(()=>{
 const vw=innerWidth, out=[], low=[];
 const lum=(c)=>{const m=c.match(/[\d.]+/g); if(!m) return null; const a=m.slice(0,3).map(x=>{x=x/255; return x<=0.03928?x/12.92:Math.pow((x+0.055)/1.055,2.4)}); return {L:0.2126*a[0]+0.7152*a[1]+0.0722*a[2], a: m[3]===undefined?1:+m[3]};};
 const bgOf=(el)=>{for(let e=el;e;e=e.parentElement){const cs=getComputedStyle(e); if(cs.backgroundImage&&cs.backgroundImage!=='none') return null; const l=lum(cs.backgroundColor); if(l&&l.a>0.9) return l.L;} return 0.012;};
 const scrollX=(el)=>{for(let e=el.parentElement;e;e=e.parentElement){const cs=getComputedStyle(e); if(/(auto|scroll|hidden)/.test(cs.overflowX)&&e!==document.body&&e!==document.documentElement) return true;} return false;};
 for(const el of document.querySelectorAll('body *')){
  if(!el.offsetParent && getComputedStyle(el).position!=='fixed') continue;
  const r=el.getBoundingClientRect(); if(!r.width||!r.height) continue;
  const cs=getComputedStyle(el); if(cs.visibility==='hidden'||+cs.opacity===0) continue;
  if((r.right>vw+1||r.left<-1) && !scrollX(el) && !el.closest('.confetti')) out.push((el.id||el.className||el.tagName).toString().slice(0,40)+' '+Math.round(r.left)+'..'+Math.round(r.right));
  const own=[...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());
  if(own && r.bottom>0 && r.top<innerHeight){const f=lum(cs.color); const b=bgOf(el); if(f&&b!=null){const ratio=(Math.max(f.L,b)+0.05)/(Math.min(f.L,b)+0.05); if(ratio<3) low.push(el.textContent.trim().slice(0,30)+' '+ratio.toFixed(2));}}
 }
 return {sw:document.documentElement.scrollWidth>vw, out:out.slice(0,8), low:[...new Set(low)].slice(0,8)};
})()"""
COVER=r"""(()=>{
 const tb=document.getElementById('tabbar'); if(!tb||!tb.offsetParent) return [];
 const top=tb.getBoundingClientRect().top; const bad=[];
 document.querySelectorAll('*').forEach(e=>{const cs=getComputedStyle(e); if(/(auto|scroll)/.test(cs.overflowY)&&e.scrollHeight>e.clientHeight) e.scrollTop=e.scrollHeight;});
 window.scrollTo(0,document.documentElement.scrollHeight);
 for(const el of document.querySelectorAll('button,a,input,select,textarea,.a-card,.p-card,.t-card,.card')){
  if(tb.contains(el)||!el.offsetParent) continue; if(el.closest('.sheet-backdrop')) continue;
  const r=el.getBoundingClientRect(); if(!r.height) continue;
  if(r.bottom>top+1 && r.top<innerHeight) bad.push((el.id||el.textContent.trim().slice(0,25)||el.className)+' '+Math.round(r.bottom)+'>'+Math.round(top));
 }
 return bad.slice(0,6);
})()"""
res={}
async def run(width):
  async with async_playwright() as pw:
    br=await pw.chromium.launch()
    c=await br.new_context(viewport={'width':width,'height':780},device_scale_factor=2,is_mobile=True,has_touch=True,user_agent=UA, locale='hi-IN' if LANG=='hi' else 'en-IN')
    p=await c.new_page(); errs=[]
    p.on('pageerror',lambda e: errs.append('pageerror '+str(e)))
    p.on('console',lambda m: errs.append('console '+m.text) if m.type=='error' else None)
    if LANG=='hi':
        await c.add_init_script("try{localStorage.setItem('kingside-lang','hi')}catch(e){}")
    await p.goto(BASE+'/'); await p.wait_for_timeout(1500)
    async def snap(name):
        await p.wait_for_timeout(350)
        r=await p.evaluate(CHECK); res[f'{width}:{name}']=r
        await p.screenshot(path=f'{OUT}/{width}-{name}.png')
        r['covered']=await p.evaluate(COVER)
        if r['covered']: await p.screenshot(path=f'{OUT}/{width}-{name}-bottom.png')
        flag='OK ' if not r['sw'] and not r['out'] and not r['covered'] else 'BAD'
        r.pop('low') if '--low' not in sys.argv else None; print(flag,width,name,json.dumps(r,ensure_ascii=False),flush=True)
    async def esc():
        await p.evaluate("document.querySelectorAll('.sheet-backdrop').forEach(b=>b.hidden=true)")
    await snap('home')
    await p.click('[data-tab="more"]'); await snap('more')
    await p.click('[data-more="settings"]'); await snap('settings'); await p.click('#settings-done')
    await p.click('#btn-computer'); await snap('newgame-ai')
    await p.click('#new-start'); await p.wait_for_timeout(1500); await snap('game')
    await p.evaluate("window.__chess.newGame({mode:'pvp'})")
    for u in ['f2f3','e7e5','g2g4','d8h4']:
        await p.evaluate(f"window.__chess.makeMove({{from:'{u[:2]}',to:'{u[2:4]}'}})")
    await p.wait_for_timeout(1200); await snap('gameover')
    await esc()
    await p.click('#btn-home'); await p.wait_for_timeout(600)
    await p.click('[data-tab="puzzles"]'); await p.wait_for_timeout(1000); await snap('puzzles')
    await p.click('[data-tab="home"]'); await p.wait_for_timeout(300)
    await p.click('[data-tab="friends"]'); await p.wait_for_timeout(600); await snap('friends-guest')
    await p.click('[data-tab="home"]'); await p.click('#hub-hello'); await p.wait_for_timeout(500); await snap('signin')
    await p.click('[data-tab="home"]'); await p.wait_for_timeout(300)
    await p.click('[data-tab="more"]'); await p.click('[data-more="leaders"]'); await p.wait_for_timeout(1000); await snap('leaders')
    await p.click('[data-tab="home"]'); await p.wait_for_timeout(300)
    extra=sys.argv[4:] 
    for name,js in [('quick',"document.getElementById('btn-quick')&&document.getElementById('btn-quick').click()")]:
        await p.evaluate(js); await snap(name); await esc()
    await p.click('#btn-rush'); await p.wait_for_timeout(900); await snap('rush')
    await p.click('[data-act=rushgo]'); await p.wait_for_timeout(1500); await snap('rush-run')
    await p.evaluate("window.__kingsidePuzzles.endRush('time')"); await p.wait_for_timeout(1000); await snap('rush-over')
    await p.click('#p-back'); await p.wait_for_timeout(300); await p.click('#p-back'); await p.wait_for_timeout(300)
    await p.click('[data-tab="home"]'); await p.wait_for_timeout(300)
    await p.click('#btn-ach'); await p.wait_for_timeout(500); await snap('achievements')
    await p.click('[data-tab="home"]'); await p.wait_for_timeout(300)
    await p.evaluate("fetch('/api/r/forget',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({dev:JSON.parse(localStorage.getItem('kingside-device-v1'))})})")
    print('ERRS',width,errs,flush=True)
    await br.close()
async def main():
    for w in (360,412): await run(w)
asyncio.run(main())
