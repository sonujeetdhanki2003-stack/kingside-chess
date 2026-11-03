#!/usr/bin/env python3
"""v1.7 rating API test: two fresh test accounts play rated games through the real API; checks Glicko-2 changes,
the abuse guards (abort before move 2 per side, same account) and the leaderboard; deletes the test accounts at the end.
usage: api_ratings.py BASE [--quick]  (--quick also plays a Quick Match; skip it on the live site so no real player is paired)"""
import sys, json, time, random, string, urllib.request
BASE = sys.argv[1].rstrip('/'); QUICK = '--quick' in sys.argv
def call(path, body=None):
    req = urllib.request.Request(BASE + '/api/' + path, data=json.dumps(body).encode() if body is not None else None,
        headers={'content-type': 'application/json', 'user-agent': 'kingside-qa'}, method='POST' if body is not None else 'GET')
    try:
        with urllib.request.urlopen(req, timeout=30) as r: return json.loads(r.read())
    except urllib.error.HTTPError as e: return json.loads(e.read() or b'{}')
ok = True
def check(cond, what):
    global ok
    print(('PASS ' if cond else 'FAIL ') + what, flush=True)
    ok = ok and bool(cond)
tag = ''.join(random.choice(string.ascii_lowercase + string.digits) for _ in range(6))
users = {}
for n in ('a', 'b'):
    r = call('u/signup', {'username': f'qa17{n}_{tag}', 'password': 'qa-pass-1234', 'display': f'QA {n.upper()} {tag}'})
    assert r.get('ok'), r
    users[n] = {'s': r['session'], 'uname': f'qa17{n}_{tag}'}
print('signed up', [u['uname'] for u in users.values()])
A, B = users['a'], users['b']
def me(u): return call('u/me?lite=1&s=' + u['s'])['user']
def play(code, toks, colors, moves):
    for i, m in enumerate(moves):
        side = 'w' if i % 2 == 0 else 'b'
        tok = toks[side]
        r = call('move', {'code': code, 'tok': tok, 'uci': m, 'ply': i})
        assert r.get('ok'), (m, r)
    return r
def resign(code, tok): return call('action', {'code': code, 'tok': tok, 'type': 'resign'})
SCHOLAR = ['e2e4', 'e7e5', 'd1h5', 'b8c6', 'f1c4', 'g8f6', 'h5f7']
try:
    r0a, r0b = me(A)['ratings'], me(B)['ratings']
    check(r0a['blitz']['r'] == 1500 and r0a['blitz']['p'] and r0a['blitz']['n'] == 0, 'new account starts at 1500, provisional: %s' % r0a['blitz'])
    # friends + a rated friend challenge (5+0 = blitz)
    call('f/request', {'s': A['s'], 'uname': B['uname']}); r = call('f/accept', {'s': B['s'], 'uname': A['uname']})
    ch = call('f/challenge', {'s': A['s'], 'uname': B['uname'], 'tc': '5+0', 'color': 'w', 'rated': True}); assert ch.get('ok'), ch
    acc = call('f/answer', {'s': B['s'], 'id': ch['id'], 'accept': True}); assert acc.get('ok'), acc
    code = acc['room']; tokB = acc['seat']
    lst = call('f/list?s=' + A['s']); c = [x for x in lst['challenges'] if x['id'] == ch['id']][0]
    check(c['rated'] is True, 'challenge carries rated flag')
    tokA = c['seat']
    st = call(f'poll?code={code}&tok={tokA}&ver=-1')
    check(st.get('rated') and st.get('rt') and st['rt']['pool'] == 'blitz', 'room is rated, ratings shown beside names: %s' % st.get('rt'))
    play(code, {'w': tokA, 'b': tokB}, None, SCHOLAR)
    time.sleep(0.5)
    rr = call(f'u/rres?code={code}&game=1')
    check(rr.get('rated') and rr['w']['d'] > 0 and rr['b']['d'] < 0, 'rated result: white %+d, black %+d' % (rr['w']['d'], rr['b']['d']))
    ra, rb = me(A)['ratings']['blitz'], me(B)['ratings']['blitz']
    check(ra['r'] > 1500 and rb['r'] < 1500 and ra['n'] == 1 and rb['n'] == 1, f'both ratings changed: A {ra} B {rb}')
    check(abs((ra['r'] - 1500) + (rb['r'] - 1500)) <= 1, 'symmetric change for two new players')
    check(me(A)['ratings']['rapid']['n'] == 0, 'rapid pool untouched by a blitz game')
    # abort guard: a rematch resigned after 1 move each changes nothing
    call('action', {'code': code, 'tok': tokA, 'type': 'rematch'}); call('action', {'code': code, 'tok': tokB, 'type': 'rematch'})
    st = call(f'poll?code={code}&tok={tokA}&ver=-1')
    check(st.get('game') == 2 and st['status'] == 'active', 'rematch started (game 2), seats swapped')
    w2 = 'w' if st['you'] == 'w' else 'b'
    toks2 = {st['you']: tokA, ('b' if st['you'] == 'w' else 'w'): tokB}
    check(st.get('rt') and str(st['uids'][st['you']]) in {str(k) for k in st['rt']['u']}, 'rematch shows fresh ratings')
    play(code, toks2, None, ['d2d4', 'd7d5'])
    resign(code, toks2['w']); time.sleep(0.3)
    rr2 = call(f'u/rres?code={code}&game=2')
    check(rr2.get('found') and not rr2.get('rated'), 'game resigned before move 2 per side is NOT rated')
    check(me(A)['ratings']['blitz'] == ra, 'A rating unchanged after the aborted game')
    # same account on both sides of a rated invite room -> unrated
    cr = call('create', {'s': A['s'], 'tc': '3+2', 'color': 'w', 'rated': True, 'name': 'A'})
    jn = call('join', {'s': A['s'], 'code': cr['code'], 'name': 'A again'})
    play(cr['code'], {'w': cr['tok'], 'b': jn['tok']}, None, SCHOLAR); time.sleep(0.3)
    rr3 = call(f"u/rres?code={cr['code']}&game=1")
    check(rr3.get('found') and not rr3.get('rated'), 'playing yourself (same account) is NOT rated')
    check(me(A)['ratings']['blitz'] == ra, 'A rating unchanged after playing self')
    # rated invite room between A and B (B joins by code) -> rated
    cr = call('create', {'s': B['s'], 'tc': '3+2', 'color': 'w', 'rated': True, 'name': 'B'})
    jn = call('join', {'s': A['s'], 'code': cr['code'], 'name': 'A'})
    st = call(f"poll?code={cr['code']}&tok={jn['tok']}&ver=-1")
    check(st.get('rated') and st.get('rt'), 'rated invite-code room shows ratings after join')
    play(cr['code'], {'w': cr['tok'], 'b': jn['tok']}, None, ['e2e4', 'e7e5', 'g1f3', 'b8c6']); call('action', {'code': cr['code'], 'tok': cr['tok'], 'type': 'offer_draw'}); call('action', {'code': cr['code'], 'tok': jn['tok'], 'type': 'accept_draw'}); time.sleep(0.3)
    rr4 = call(f"u/rres?code={cr['code']}&game=1")
    check(rr4.get('rated') and rr4['w']['d'] > 0 and rr4['b']['d'] < 0, 'draw: lower-rated B gains, higher-rated A loses: B %+d, A %+d' % (rr4['w']['d'], rr4['b']['d']))
    if QUICK:
        sa = call('q/seek', {'s': A['s'], 'tc': '10+0'}); sb = call('q/seek', {'s': B['s'], 'tc': '10+0'})
        m = sb.get('matched') or call(f"q/poll?id={sb['id']}&hold=3000").get('matched')
        ma = call(f"q/poll?id={sa['id']}&hold=3000").get('matched')
        check(m and ma and m['code'] == ma['code'], 'quick match paired the two test accounts')
        toks = {m['color']: m['seat'], ma['color']: ma['seat']}
        play(m['code'], toks, None, SCHOLAR); time.sleep(0.3)
        rr5 = call(f"u/rres?code={m['code']}&game=1")
        check(rr5.get('rated') and rr5.get('pool') == 'rapid', 'quick match 10+0 is rated in the rapid pool')
    # leaderboard
    lb = call('u/leaderboard?pool=blitz&s=' + A['s'])
    names = [x['uname'] for x in lb['list']]
    check(A['uname'] in names and B['uname'] in names, 'leaderboard lists both test accounts (%d players)' % len(lb['list']))
    check(lb['me'] and lb['me']['uname'] == A['uname'] and lb['me']['rank'] == names.index(A['uname']) + 1, 'your rank = position in the list: %s' % lb['me']['rank'])
    check(all(x['p'] for x in lb['list'] if x['uname'] in (A['uname'], B['uname'])), 'test accounts shown as provisional (?)')
    pr = call('u/profile?name=' + A['uname'])['profile']
    check(len(pr['graphs']['blitz']) >= 3 and pr['ratings']['blitz']['n'] == 2, 'profile has rating history: %s' % [p['r'] for p in pr['graphs']['blitz']])
finally:
    for u in (A, B):
        r = call('u/delete', {'s': u['s'], 'password': 'qa-pass-1234'})
        print('deleted', u['uname'], r.get('ok'))
    lb = call('u/leaderboard?pool=blitz')
    check(not any(x['uname'].startswith('qa17') for x in lb['list']), 'cleanup: no test account left on the leaderboard')
print('ALL PASS' if ok else 'SOME FAILED')
sys.exit(0 if ok else 1)
