#!/usr/bin/env python3
"""v1.8 Crowns API test. Fresh test accounts + guest phone ids earn and spend through the real API; checks the earn rules,
caps, no double-claims on replays, forged requests rejected, insufficient balance, purchases persisting on another device,
the welcome gift exactly once, guest -> account merge; deletes every test account at the end.
usage: api_crowns.py BASE [--db /path/to/local.sqlite]   (--db: local server only; adds the cap / streak / freeze / existing-player checks)"""
import sys, json, time, random, string, urllib.request, sqlite3, datetime
import chess
BASE = sys.argv[1].rstrip('/')
DB = sys.argv[sys.argv.index('--db') + 1] if '--db' in sys.argv else None
def call(path, body=None):
    req = urllib.request.Request(BASE + '/api/' + path, data=json.dumps(body).encode() if body is not None else None,
        headers={'content-type': 'application/json', 'user-agent': 'kingside-qa'}, method='POST' if body is not None else 'GET')
    try:
        with urllib.request.urlopen(req, timeout=30) as r: return json.loads(r.read())
    except urllib.error.HTTPError as e:
        d = json.loads(e.read() or b'{}'); d['_status'] = e.code; return d
ok = True
def check(cond, what):
    global ok
    print(('PASS ' if cond else 'FAIL ') + what, flush=True)
    ok = ok and bool(cond)
tag = ''.join(random.choice(string.ascii_lowercase + string.digits) for _ in range(6))
rdev = lambda: ''.join(random.choice('0123456789abcdef') for _ in range(32))
made = []
def signup(n, dev=None):
    r = call('u/signup', {'username': f'qa18{n}_{tag}', 'password': 'qa-pass-1234', 'display': f'QA {n} {tag}', 'dev': dev})
    assert r.get('ok'), r
    u = {'s': r['session'], 'uname': f'qa18{n}_{tag}', 'id': r['user']['id']}; made.append(u); return u
def st(who): return call('c/state?' + ('s=' + who['s'] if 's' in who else 'dev=' + who['dev']))
def hist(who): return call('c/history?' + ('s=' + who['s'] if 's' in who else 'dev=' + who['dev']))
def P(who, extra): return {**({'s': who['s']} if 's' in who else {'dev': who['dev']}), **extra}
def istday(t=None): return (datetime.datetime.utcnow() + datetime.timedelta(hours=5, minutes=30)).strftime('%Y-%m-%d')
def mate_game(waits):
    """white mates on move 5: e4, Bc4, Qf3, Nc3, Qxf7#; black only shuffles (waits = 4 black moves)"""
    w = ['e2e4', 'f1c4', 'd1f3', 'b1c3', 'f3f7']; out = []
    for i in range(5):
        out.append(w[i])
        if i < 4: out.append(waits[i])
    b = chess.Board()
    for m in out: b.push_uci(m)
    assert b.is_checkmate(), out
    return ' '.join(out)
WAITS = [['a7a6', 'a6a5', 'h7h6', 'h6h5'], ['h7h6', 'a7a6', 'h6h5', 'a6a5'], ['a7a5', 'h7h5', 'b7b6', 'a5a4'], ['h7h5', 'a7a5', 'h5h4', 'a5a4'],
         ['b7b6', 'a7a6', 'h7h6', 'a6a5'], ['a7a6', 'h7h6', 'b7b6', 'h6h5'], ['h7h6', 'b7b6', 'a7a5', 'h6h5']]
GAMES = [mate_game(w) for w in WAITS]
db = sqlite3.connect(DB, timeout=10) if DB else None
try:
    # ---------- guest phone ----------
    G = {'dev': rdev()}
    r = call('c/checkin', P(G, {}))
    check(r.get('ok') and r['owner'] == 'guest' and r['bal'] == 10 and [e['kind'] for e in r['earned']] == ['login'], 'guest: daily login bonus +10 (%s)' % r.get('bal'))
    r = call('c/checkin', P(G, {}))
    check(r.get('ok') and r['bal'] == 10 and r['earned'] == [], 'guest: second check-in the same day pays nothing')
    r = call('c/lesson', P(G, {'id': 'rook'}))
    check(r.get('ok') and r['bal'] == 20, 'guest: first lesson +10 (bal %s)' % r.get('bal'))
    r = call('c/lesson', P(G, {'id': 'rook'}))
    check(r.get('ok') and r['earned'] == [] and r['bal'] == 20, 'guest: same lesson again pays nothing')
    # ---------- sign up on that phone: welcome gift + the guest Crowns move in ----------
    A = signup('a', G['dev'])
    s = st(A)
    check(s.get('ok') and s['owner'] == 'account' and s['bal'] == 120, 'new account: welcome 100 + 20 brought from the guest phone = %s' % s.get('bal'))
    check(st(G)['bal'] == 0, 'guest wallet is empty after moving into the account')
    r = call('c/lesson', P(A, {'id': 'rook'}))
    check(r.get('ok') and r['earned'] == [], 'a lesson already paid on the guest phone is not paid again to the account')
    for _ in range(3): call('c/checkin', P(A, {}))
    h = hist(A)['list']
    check(sum(1 for x in h if x['kind'] == 'welcome') == 1, 'welcome gift given exactly once after repeated check-ins')
    check(sum(1 for x in h if x['kind'] == 'login') <= 1, 'daily login bonus at most once per day (today\'s was already paid on the guest phone and moved in)')
    bal = st(A)['bal']
    # ---------- bot wins ----------
    r = call('c/game', P(A, {'moves': GAMES[0], 'mode': 'ai', 'bot': 'meera', 'color': 'w', 'result': '1-0'}))
    kinds = sorted(e['kind'] for e in r.get('earned', []))
    check(r.get('ok') and kinds == ['ach', 'bot'] and r['bal'] == bal + 5 + 50, 'win vs Meera (~600) by checkmate: +5, First Win +50 (%s)' % r.get('earned'))
    bal = r['bal']
    r = call('c/game', P(A, {'moves': GAMES[0], 'mode': 'ai', 'bot': 'meera', 'color': 'w', 'result': '1-0'}))
    check(r.get('ok') and r.get('dup') and r['earned'] == [] and r['bal'] == bal, 'replaying the same game pays nothing (no double claim)')
    r = call('c/game', P(A, {'moves': GAMES[1], 'mode': 'ai', 'bot': 'vikram', 'color': 'w', 'result': '1-0'}))
    check(r.get('ok') and r['earned'] == [] and r.get('why') == 'too_fast', 'a second win within 30 s is not paid (rate limit): %s' % r.get('why'))
    # forged requests
    r = call('c/game', P(A, {'moves': 'e2e4 e7e5 e1e3', 'mode': 'ai', 'bot': 'meera', 'color': 'w', 'result': '1-0'}))
    check(r.get('_status') == 400, 'forged game with an illegal move is rejected (400)')
    r = call('c/game', P(A, {'moves': 'e2e4 e7e5 g1f3 b8c6 f1c4 g8f6 b1c3 f8c5 e1g1 e8g8', 'mode': 'ai', 'bot': 'titan', 'color': 'w', 'result': '1-0'}))
    check(r.get('ok') and r['earned'] == [] and r.get('why') == 'locked_bot', 'claimed win vs a locked bot pays nothing: %s' % r.get('why'))
    r = call('c/game', P(A, {'moves': 'd2d4 d7d5 c2c4 e7e6 b1c3 g8f6 c1g5 f8e7', 'mode': 'ai', 'bot': 'rocky', 'color': 'w', 'result': '1-0'}))
    check(r.get('ok') and r['earned'] == [] and r.get('why') == 'not_mate', '"I won" without a checkmate on the board pays nothing: %s' % r.get('why'))
    r = call('c/game', P(A, {'moves': 'f2f3 e7e5 g2g4 d8h4', 'mode': 'ai', 'bot': 'rocky', 'color': 'b', 'result': '0-1'}))
    check(r.get('ok') and r['earned'] == [] and r.get('why') == 'too_short', 'a 2-move mate is too short to pay: %s' % r.get('why'))
    r = call('c/game', {'s': 'f' * 48, 'moves': GAMES[2], 'mode': 'ai', 'bot': 'meera', 'color': 'w'})
    check(r.get('_status') == 401, 'a forged session is rejected (401)')
    r = call('c/game', {'moves': GAMES[2], 'mode': 'ai', 'bot': 'meera', 'color': 'w'})
    check(r.get('_status') == 400, 'no player id is rejected (400)')
    r = call('c/lesson', P(A, {'id': 'no_such_lesson'}))
    check(r.get('_status') == 400, 'unknown lesson id is rejected (400)')
    time.sleep(16)
    r = call('c/lesson', P(A, {'id': 'bishop'}))
    check(r.get('ok') and r['bal'] == st(A)['bal'] and [e['amt'] for e in r['earned']] == [10], 'new lesson for the account +10')
    # ---------- daily puzzle ----------
    def fnv(s):
        h = 2166136261
        for ch in s: h ^= ord(ch); h = (h * 16777619) & 0xffffffff
        return h
    def get(p):
        with urllib.request.urlopen(urllib.request.Request(BASE + p, headers={'user-agent': 'kingside-qa'}), timeout=30) as f: return json.loads(f.read())
    idx = get('/data/puzzles/index.json'); bands = [2, 3, 4]; day = istday()
    k = fnv('kingside-daily-' + day) % sum(idx['chunks'][b]['n'] for b in bands)
    for b in bands:
        if k < idx['chunks'][b]['n']: pz = get('/data/puzzles/' + idx['chunks'][b]['f'])[k]; break
        k -= idx['chunks'][b]['n']
    mine = pz[2].split(' ')[1::2]
    r = call('c/daily', P(A, {'date': day, 'moves': ' '.join(['a2a3'] * len(mine))}))
    check(r.get('_status') == 400 and r.get('code') == 'bad_solution', 'daily puzzle with wrong moves is rejected')
    r = call('c/daily', P(A, {'date': '2026-01-01', 'moves': ' '.join(mine)}))
    check(r.get('_status') == 400, 'daily puzzle for another day is rejected')
    b0 = st(A)['bal']
    r = call('c/daily', P(A, {'date': day, 'moves': ' '.join(mine)}))
    check(r.get('ok') and [e['amt'] for e in r['earned'] if e['kind'] == 'daily'] == [15], 'daily puzzle solved: +15')
    r = call('c/daily', P(A, {'date': day, 'moves': ' '.join(mine)}))
    check(r.get('ok') and not [e for e in r['earned'] if e['kind'] == 'daily'], 'daily puzzle again: nothing more')
    # ---------- shop ----------
    s = st(A); bal = s['bal']
    r = call('c/buy', P(A, {'item': 'bot:titan'}))
    check(r.get('_status') == 402 and r.get('code') == 'no_crowns' and st(A)['bal'] == bal, 'buying Titan (400) with %s Crowns fails, balance unchanged' % bal)
    r = call('c/buy', P(A, {'item': 'theme:gold-hack'}))
    check(r.get('_status') == 400, 'unknown item is rejected')
    r = call('c/equip', P(A, {'slot': 'frame', 'item': 'frame:gold'}))
    check(r.get('_status') == 403, 'wearing a frame you do not own is rejected')
    r = call('c/buy', P(A, {'item': 'theme:royal'}))
    check(r.get('ok') and r['own'].get('theme:royal') and r['bal'] == bal - 150, 'bought Royal Gold board for 150 (bal %s)' % r.get('bal'))
    r = call('c/buy', P(A, {'item': 'theme:royal'}))
    check(r.get('_status') == 409, 'buying the same board twice is refused')
    # another device: log in fresh, different phone id
    L = call('u/login', {'username': A['uname'], 'password': 'qa-pass-1234', 'dev': rdev()})
    A2 = {'s': L['session']}
    s2 = st(A2)
    check(s2['own'].get('theme:royal') and s2['bal'] == bal - 150, 'purchase is there after logging in on another device')
    # reviews
    rv = lambda k, t=False: call('c/review', P(A, {'key': k, 'useTicket': t}))
    a1, a2, a1b, a3 = rv('qa:g1'), rv('qa:g2'), rv('qa:g1'), rv('qa:g3')
    check(a1['allowed'] and a1['how'] == 'free' and a2['allowed'] and a1b['how'] == 'again' and not a3['allowed'] and a3['how'] == 'limit',
          'reviews: 2 free a day, reopening one is free, the 3rd needs a ticket')
    r = call('c/buy', P(A, {'item': 'review:1'})); check(r.get('ok') and r['tickets'] == 1, 'bought 1 review ticket (15)')
    a3 = rv('qa:g3', True); check(a3['allowed'] and a3['how'] == 'ticket' and a3['tickets'] == 0, 'the ticket unlocks the 3rd review')
    # ---------- rated online game between two accounts ----------
    B = signup('b')
    call('f/request', {'s': A['s'], 'uname': B['uname']}); call('f/accept', {'s': B['s'], 'uname': A['uname']})
    ch = call('f/challenge', {'s': A['s'], 'uname': B['uname'], 'tc': '5+0', 'color': 'w', 'rated': True}); assert ch.get('ok'), ch
    acc = call('f/answer', {'s': B['s'], 'id': ch['id'], 'accept': True}); assert acc.get('ok'), acc
    code, tokB = acc['room'], acc['seat']
    tokA = [x for x in call('f/list?s=' + A['s'])['challenges'] if x['id'] == ch['id']][0]['seat']
    ba, bb = st(A)['bal'], st(B)['bal']
    for i, m in enumerate(['e2e4', 'e7e5', 'd1h5', 'b8c6', 'f1c4', 'g8f6', 'h5f7']):
        rr = call('move', {'code': code, 'tok': tokA if i % 2 == 0 else tokB, 'uci': m, 'ply': i}); assert rr.get('ok'), rr
    time.sleep(1)
    ha = [x for x in hist(A)['list'] if x['kind'] in ('online', 'ach')][:2]; hb = [x for x in hist(B)['list'] if x['kind'] in ('online', 'ach')]
    check(st(A)['bal'] - ba == 15 + 30, 'rated online win: +15 and First Online Game +30 for the winner (got %+d)' % (st(A)['bal'] - ba))
    check(st(B)['bal'] - bb == 5 + 30, 'rated online loss: +5 and First Online Game +30 for the loser (got %+d)' % (st(B)['bal'] - bb))
    # ---------- local-only checks (direct database access) ----------
    if db:
        today = istday(); y = lambda n: (datetime.date.fromisoformat(today) - datetime.timedelta(days=n)).isoformat()
        oa = 'u:%d' % A['id']
        # bot-win cap: 5 paid wins a day
        for i in range(1, 6): db.execute("INSERT OR IGNORE INTO crown_ledger (owner, amt, kind, ref, note, day, t) VALUES (?, 5, 'bot', ?, 'seed', ?, 0)", (oa, f'{today}#{i}', today))
        db.execute("DELETE FROM crown_rate WHERE k LIKE 'botwin:%'"); db.commit()
        r = call('c/game', P(A, {'moves': GAMES[3], 'mode': 'ai', 'bot': 'meera', 'color': 'w', 'result': '1-0'}))
        check(r.get('ok') and r['earned'] == [] and r.get('why') == 'cap', 'bot-win daily cap (5) holds: %s' % r.get('why'))
        # streak milestone: days before today recorded -> 3-day streak pays 25 once
        C = signup('c')
        oc = 'u:%d' % C['id']; call('c/state?s=' + C['s'])
        for n in (1, 2): db.execute("INSERT OR IGNORE INTO crown_days (owner, day, kind) VALUES (?, ?, 'game')", (oc, y(n)))
        db.commit()
        r = call('c/lesson', P(C, {'id': 'rook'}))
        check(any(e['kind'] == 'streak' and e['amt'] == 25 for e in r['earned']), '3-day streak milestone +25 (%s)' % r['earned'])
        time.sleep(16); r = call('c/lesson', P(C, {'id': 'bishop'}))
        check(not any(e['kind'] == 'streak' for e in r['earned']), 'the same milestone is not paid twice in one streak')
        # streak freeze: yesterday missed, a freeze covers it
        D = signup('d'); od = 'u:%d' % D['id']; call('c/state?s=' + D['s'])
        for n in (2, 3, 4): db.execute("INSERT OR IGNORE INTO crown_days (owner, day, kind) VALUES (?, ?, 'game')", (od, y(n)))
        db.execute("INSERT INTO crown_items (owner, item, n, src, t) VALUES (?, 'freeze', 1, 'test', 0)", (od,)); db.commit()
        r = call('c/checkin', P(D, {}))
        check(r['frozenNow'] == [y(1)] and r['freeze'] == 0 and r['streak']['cur'] == 4, 'streak freeze covers the missed day, streak kept at 4 (%s %s)' % (r['frozenNow'], r['streak']))
        # existing player: account made before Crowns -> 300 welcome + previously free items stay unlocked, exactly once
        E = signup('e'); db.execute('UPDATE users SET created = 1000 WHERE id = ?', (E['id'],))
        db.execute("UPDATE users SET prog = ? WHERE id = ?", (json.dumps({'v': 1, 'days': ['2026-01-01']}), E['id'])); db.commit()
        s = call('c/state?s=' + E['s'])
        check(s['bal'] == 300 and all(s['own'].get(i) for i in ('theme:purple', 'theme:coral', 'pieces:fantasy', 'pieces:spatial', 'bot:natasha', 'bot:titan')),
              'existing player: 300 welcome gift + everything that was free before stays unlocked')
        for _ in range(3): call('c/checkin', P(E, {}))
        check(sum(1 for x in hist(E)['list'] if x['kind'] == 'welcome') == 1, 'existing player welcome gift exactly once')
        r = call('c/game', P(E, {'moves': GAMES[4], 'mode': 'ai', 'bot': 'titan', 'color': 'w', 'result': '1-0'}))
        check(any(e['kind'] == 'bot' and e['amt'] == 25 for e in r['earned']), 'existing player can still play (and earn vs) Titan: +25')
        # spend race: two buys that together exceed the balance -> only one goes through
        F = signup('f'); call('c/state?s=' + F['s'])  # 100
        r1 = call('c/buy', P(F, {'item': 'frame:gold'})); r2 = call('c/buy', P(F, {'item': 'avatar:tiger'}))
        check(r1.get('ok') and r2.get('_status') == 402 and st(F)['bal'] == 40, 'balance never goes below zero (60 + 50 > 100)')
        e = call('c/equip', P(F, {'slot': 'frame', 'item': 'frame:gold'}))
        check(e.get('ok') and e['cos'].get('frame') == 'gold', 'wear an owned frame')
        lb = call('u/me?lite=1&s=' + F['s'])
        check(lb['user'].get('cos', {}).get('frame') == 'gold', 'the frame is on the account (shown to others)')
finally:
    for u in made:
        r = call('u/delete', {'s': u['s'], 'password': 'qa-pass-1234'})
        print('deleted', u['uname'], r.get('ok'))
    if db:
        left = db.execute("SELECT COUNT(*) FROM crown_ledger WHERE owner IN (%s)" % ','.join("'u:%d'" % u['id'] for u in made)).fetchone()[0]
        check(left == 0, 'deleted accounts leave no Crown rows behind')
print('ALL PASS' if ok else 'SOME FAILED')
sys.exit(0 if ok else 1)
