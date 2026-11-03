
import asyncio, sys, json, time
from playwright.async_api import async_playwright
BASE = sys.argv[1].rstrip('/'); OUT = sys.argv[2]
UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36"
def L(*a): print(' '.join(str(x) for x in a), flush=True)
async def wait_js(page, expr, timeout=20000, what=''):
    t0 = time.time()
    while True:
        try:
            v = await page.evaluate(expr)
            if v: return v
        except Exception: pass
        if (time.time() - t0) * 1000 > timeout: raise Exception('timeout: ' + (what or expr))
        await asyncio.sleep(0.25)
async def main():
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        pages = []
        for i in range(5):
            c = await br.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, user_agent=UA)
            p = await c.new_page(); p.on('pageerror', lambda e, i=i: L('PAGEERROR', i, e)); pages.append(p)
        O = pages[0]
        await O.goto(BASE + '/'); await O.wait_for_load_state('networkidle')
        if await O.locator('#sheet-new').is_visible(): await O.click('#new-cancel')
        await O.click('#btn-tourney'); await O.click('[data-act="new"]')
        await O.fill('#t-name', 'Admin test')
        await O.click('[data-tseg="format"] button[data-v="rr"]'); await O.click('[data-tseg="tc"] button[data-v="none"]')
        await O.click('#t-playing + span')  # untick "I'm playing too"
        await O.click('form[data-form="create"] button[type=submit]')
        await O.wait_for_selector('.t-code'); code = (await O.inner_text('.t-code')).strip()
        L('organizer (not playing) created', code, '| players listed:', await O.locator('.t-players li').count())
        names = ['Ravi', 'Kiran', 'Neha', 'Dev']
        for i, n in enumerate(names):
            p = pages[i + 1]; await p.goto(f'{BASE}/?t={code}'); await p.wait_for_selector('#t-join-name')
            await p.fill('#t-join-name', n); await p.click('form[data-form="join"] button[type=submit]'); await p.wait_for_selector('.t-ok')
        await wait_js(O, "document.querySelectorAll('.t-players li').length === 4", 10000)
        # Dev leaves by himself, then rejoins
        await pages[4].click('[data-act="quit"]'); await wait_js(O, "document.querySelectorAll('.t-players li').length === 3", 10000, 'quit')
        await pages[4].wait_for_selector('#t-join-name'); await pages[4].click('form[data-form="join"] button[type=submit]')
        await wait_js(O, "document.querySelectorAll('.t-players li').length === 4", 10000, 'rejoin')
        L('player left the lobby and rejoined: OK')
        # organizer removes Dev in the lobby
        await O.click('.t-players li:nth-child(4) [data-act="kick"]'); await O.click('#t-sheet [data-yes]')
        await wait_js(O, "document.querySelectorAll('.t-players li').length === 3", 10000, 'kick lobby')
        await wait_js(pages[4], "!!document.getElementById('t-join-name')", 10000, 'kicked sees join box again')
        L('organizer removed a player in the lobby: OK (their page went back to the join box)')
        await O.click('[data-act="start"]'); await wait_js(O, "document.querySelector('.chip-live')", 10000)
        st = await O.evaluate(f"fetch('/api/t/poll?code={code}&ver=-1').then(r=>r.json())")
        L('started 3-player round-robin; rounds:', st['totalRounds'], '| byes per round:', [sum(1 for m in r if m['bye']) for r in st['rounds']])
        # a stranger opening a tournament game link cannot take a seat
        room = [m for m in st['rounds'][0] if not m['bye']][0]['games'][0]['room']
        await pages[4].goto(f'{BASE}/?room={room}'); await asyncio.sleep(2.5)
        L('stranger opening a tournament game link:', repr(await pages[4].inner_text('#toast')))
        # organizer sets a result
        await O.click('[data-act="setres"]'); await O.click('#t-sheet [data-res="b"]')
        await wait_js(O, "document.querySelector('.t-res')", 10000, 'manual result')
        L('organizer set a result manually:', await O.inner_text('.ts-round .t-game'))
        await wait_js(O, "document.querySelector('.ts-round .t-label, .ts-round .label') && document.querySelector('.ts-round .label').textContent.includes('Round 2')", 15000, 'round 2 started')
        L('round 2 started automatically')
        await O.screenshot(path=f'{OUT}/admin-round2.png')
        # organizer removes a player mid-tournament -> forfeit
        st = await O.evaluate(f"fetch('/api/t/poll?code={code}&ver=-1').then(r=>r.json())")
        m = [m for m in st['rounds'][st['round']] if not m['bye']][0]; g = m['games'][0]
        victim = [p for p in st['players'] if p['id'] == g['w']][0]['name']
        await O.locator('.t-kick li', has_text=victim).locator('[data-act="kick"]').click(); await O.click('#t-sheet [data-yes]')
        await asyncio.sleep(2)
        st = await O.evaluate(f"fetch('/api/t/poll?code={code}&ver=-1').then(r=>r.json())")
        L('removed', victim, 'mid-tournament -> now round', st['round'] + 1, '| their game:', [ (x['games'][0]['res'], x['games'][0]['reason']) for r in st['rounds'] for x in r if not x['bye'] and x['games'] and (x['games'][0]['w']==g['w'] or x['games'][0]['b']==g['w'])])
        await O.click('[data-act="end"]'); await O.click('#t-sheet [data-yes]')
        await wait_js(O, "document.querySelector('.chip-done')", 10000, 'ended')
        st = await O.evaluate(f"fetch('/api/t/poll?code={code}&ver=-1').then(r=>r.json())")
        L('organizer ended the tournament: status', st['status'], '| endedEarly', st['endedEarly'], '| champion', [p['name'] for p in st['players'] if p['id']==st['champion']])
        for x in st['standings']: L('   ', x['place'], x['name'], x['pts'], x['w'], x['d'], x['l'], 'withdrawn' if x['kicked'] else '')
        await O.screenshot(path=f'{OUT}/admin-ended.png')
        for p in pages:
            await p.evaluate("fetch('/api/t/forget', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({tok: JSON.parse(localStorage.getItem('kingside-device-v1') || 'null')})})")
        await br.close()
asyncio.run(main())
