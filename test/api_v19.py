#!/usr/bin/env python3
"""v1.9 rating API test (Bullet pool, rating change with p0/n, history points, provisional -> settled, ranks data).
usage: api_v19.py BASE seed STATEFILE           make 2 accounts + 3 rated blitz games, keep them (migration test, local only)
       api_v19.py BASE check STATEFILE          after the upgrade: the seeded ratings/history are intact, then the v1.9 checks
       api_v19.py BASE full [--quick] [--keep STATEFILE]   fresh accounts, all v1.9 checks, accounts deleted unless --keep"""
import sys, json, time, random, string, urllib.request
BASE = sys.argv[1].rstrip('/'); MODE = sys.argv[2]; QUICK = '--quick' in sys.argv
STATE = sys.argv[3] if MODE in ('seed', 'check') else (sys.argv[sys.argv.index('--keep') + 1] if '--keep' in sys.argv else None)
UA = 'kingside-qa'
def call(path, body=None):
    req = urllib.request.Request(BASE + '/api/' + path, data=json.dumps(body).encode() if body is not None else None,
        headers={'content-type': 'application/json', 'user-agent': UA}, method='POST' if body is not None else 'GET')
    for i in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as r: return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code >= 500 and i < 3: time.sleep(1.5); continue
            return json.loads(e.read() or b'{}')
        except Exception:
            if i < 3: time.sleep(1.5); continue
            raise
ok = True
def check(cond, what):
    global ok
    print(('PASS ' if cond else 'FAIL ') + what, flush=True); ok = ok and bool(cond)
SCHOLAR = ['e2e4', 'e7e5', 'd1h5', 'b8c6', 'f1c4', 'g8f6', 'h5f7']
def play(code, toks, moves):
    for i, m in enumerate(moves):
        r = call('move', {'code': code, 'tok': toks['w' if i % 2 == 0 else 'b'], 'uci': m, 'ply': i}); assert r.get('ok'), (m, r)
def me(u): return call('u/me?lite=1&s=' + u['s'])['user']
def mk(tag, n):
    un = f'qa19{n}_{tag}'
    r = call('u/signup', {'username': un, 'password': 'qa-pass-1234', 'display': f'QA {n.upper()}'}); assert r.get('ok'), r
    return {'s': r['session'], 'uname': un}
def rated_game(W, B, tc, winner='w'):
    """W challenges B with W as white; scholar's mate (white wins) or B resigns/W resigns after 2 moves each"""
    ch = call('f/challenge', {'s': W['s'], 'uname': B['uname'], 'tc': tc, 'color': 'w', 'rated': True}); assert ch.get('ok'), ch
    acc = call('f/answer', {'s': B['s'], 'id': ch['id'], 'accept': True}); assert acc.get('ok'), acc
    code = acc['room']; tokB = acc['seat']
    c = [x for x in call('f/list?s=' + W['s'])['challenges'] if x['id'] == ch['id']][0]; tokW = c['seat']
    if winner == 'w': play(code, {'w': tokW, 'b': tokB}, SCHOLAR)
    else:
        play(code, {'w': tokW, 'b': tokB}, ['e2e4', 'e7e5', 'g1f3', 'b8c6'])
        call('action', {'code': code, 'tok': tokW, 'type': 'resign'})
    for _ in range(10):
        rr = call(f'u/rres?code={code}&game=1')
        if rr.get('found'): return code, rr
        time.sleep(0.3)
    return code, rr
def friends(A, B):
    call('f/request', {'s': A['s'], 'uname': B['uname']}); call('f/accept', {'s': B['s'], 'uname': A['uname']})

if MODE == 'seed':
    tag = ''.join(random.choice(string.ascii_lowercase + string.digits) for _ in range(6))
    A, B = mk(tag, 'a'), mk(tag, 'b'); friends(A, B)
    for i in range(3): rated_game(A, B, '5+0', 'w' if i != 1 else 'b')
    st = {'A': A, 'B': B, 'ratings': {'A': me(A)['ratings'], 'B': me(B)['ratings']},
          'graphA': call('u/profile?name=' + A['uname'])['profile']['graph']}
    json.dump(st, open(STATE, 'w')); print('seeded', st['ratings']); sys.exit(0)

if MODE == 'check':
    st = json.load(open(STATE)); A, B = st['A'], st['B']
    ra, rb = me(A)['ratings'], me(B)['ratings']
    for k in ('blitz', 'rapid'):
        check(all(ra[k][f] == st['ratings']['A'][k][f] for f in ('r', 'rd', 'p', 'n')), f'A {k} rating kept across the upgrade: {ra[k]}')
        check(all(rb[k][f] == st['ratings']['B'][k][f] for f in ('r', 'rd', 'p', 'n')), f'B {k} rating kept across the upgrade: {rb[k]}')
    check(ra['bullet']['r'] == 1500 and ra['bullet']['p'] and ra['bullet']['n'] == 0, 'new Bullet pool starts at 1500? for existing players: %s' % ra['bullet'])
    pr = call('u/profile?name=' + A['uname'])['profile']
    check([p['r'] for p in pr['graphs']['blitz']] == [p['r'] for p in st['graphA']], 'blitz history intact + backfilled: %s' % [p['r'] for p in pr['graphs']['blitz']])
    check(set(pr['graphs']) == {'bullet', 'blitz', 'rapid'}, 'graphs for all three pools')
    U = [A, B]
else:
    tag = ''.join(random.choice(string.ascii_lowercase + string.digits) for _ in range(6))
    A, B = mk(tag, 'a'), mk(tag, 'b'); friends(A, B); U = [A, B]
    if STATE: json.dump({'A': A, 'B': B}, open(STATE, 'w'))
try:
    # Bullet: a rated 1+0 game is rated in its own pool; the result says provisional before/after and the game count
    code, rr = rated_game(A, B, '1+0', 'w')
    check(rr.get('rated') and rr.get('pool') == 'bullet', 'a rated 1+0 game is rated in the Bullet pool: %s' % rr.get('pool'))
    check(rr['w']['d'] > 0 and rr['b']['d'] < 0 and rr['w']['p0'] is True and rr['w']['p'] is True and rr['w']['n'] == 1, 'rres: +/- change, p0/p provisional, n=1: %s' % rr['w'])
    code, rr = rated_game(A, B, '2+1', 'w')
    check(rr.get('pool') == 'bullet' and rr['w']['n'] == 2, '2+1 is Bullet too, n=2')
    bl = me(A)['ratings']
    check(bl['bullet']['n'] == 2 and bl['blitz']['n'] == (0 if MODE == 'full' else bl['blitz']['n']), 'Bullet games leave Blitz alone')
    # keep playing until A's Bullet rating settles (RD <= 110, Lichess's rule): the "?" goes away
    n = 2; settled = None
    while n < 40:
        code, rr = rated_game(A, B, '1+0', 'w' if n % 4 else 'b'); n += 1
        if rr['w']['p0'] and not rr['w']['p']: settled = (n, rr['w']); break
    check(settled is not None, 'provisional clears after %s rated Bullet games (RD <= 110): %s' % (settled and settled[0], settled and settled[1]))
    lb = call('u/leaderboard?pool=bullet&s=' + A['s'])
    check(lb.get('pool') == 'bullet' and any(x['uname'] == A['uname'] and not x['p'] for x in lb['list']), 'Bullet leaderboard lists A, settled')
    pr = call('u/profile?name=' + A['uname'])['profile']
    g = pr['graphs']['bullet']
    check(len(g) == n + 1 and g[-1]['r'] == pr['ratings']['bullet']['r'] and g[-1]['p'] == 0 and g[1]['p'] == 1, 'Bullet graph: one point per game + start, last = current, p flags: %d points' % len(g))
    check(pr['ratings']['bullet'].get('pk') is not None, 'peak recorded once settled: %s' % pr['ratings']['bullet'].get('pk'))
    hist = call('u/games?s=' + A['s'])
    g0 = (hist.get('games') or [{}])[0]
    check(g0.get('rated') and g0.get('dw') is not None and g0.get('tc') == '1+0', 'history rows carry the rating change: %s' % {k: g0.get(k) for k in ('tc', 'dw', 'db')})
    if QUICK:
        sa = call('q/seek', {'s': A['s'], 'tc': '1+0'}); sb = call('q/seek', {'s': B['s'], 'tc': '1+0'})
        m = sb.get('matched'); ma = None
        for _ in range(8):  # the rating window widens with the wait (120 + 18/s), so a big gap pairs after a few seconds
            m = m or call(f"q/poll?id={sb['id']}&hold=2500").get('matched'); ma = ma or call(f"q/poll?id={sa['id']}&hold=1000").get('matched')
            if m and ma: break
        check(m and ma and m['code'] == ma['code'], 'Quick Match 1+0 pairs the two test accounts')
        toks = {m['color']: m['seat'], ma['color']: ma['seat']}
        play(m['code'], toks, SCHOLAR); time.sleep(0.4)
        rr5 = call(f"u/rres?code={m['code']}&game=1")
        check(rr5.get('rated') and rr5.get('pool') == 'bullet', 'Quick Match 1+0 is rated Bullet')
finally:
    if MODE == 'full' and not STATE or MODE == 'check':
        for u in U:
            r = call('u/delete', {'s': u['s'], 'password': 'qa-pass-1234'}); print('deleted', u['uname'], r.get('ok'))
        lb = call('u/leaderboard?pool=bullet')
        check(not any(x['uname'].startswith('qa19') for x in lb['list']), 'cleanup: no test account left on the Bullet leaderboard')
print('ALL PASS' if ok else 'SOME FAILED'); sys.exit(0 if ok else 1)
