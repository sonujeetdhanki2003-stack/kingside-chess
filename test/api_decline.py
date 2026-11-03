#!/usr/bin/env python3
"""v1.8.3 Quick Match decline (abort) API test: two fresh test accounts; a declined Quick Match is aborted, unrated,
not in history; abort is refused once both sides moved and in friend rooms; test accounts deleted at the end."""
import sys, json, time, random, string, urllib.request, threading
BASE = sys.argv[1].rstrip('/')
def call(path, body=None):
    req = urllib.request.Request(BASE + '/api/' + path, data=json.dumps(body).encode() if body is not None else None,
        headers={'content-type': 'application/json', 'user-agent': 'kingside-qa'}, method='POST' if body is not None else 'GET')
    try:
        with urllib.request.urlopen(req, timeout=30) as r: return json.loads(r.read())
    except urllib.error.HTTPError as e: return json.loads(e.read() or b'{}')
ok = True
def check(cond, what):
    global ok
    print(('PASS ' if cond else 'FAIL ') + what, flush=True); ok = ok and bool(cond)
tag = ''.join(random.choice(string.ascii_lowercase + string.digits) for _ in range(6))
U = {}
for n in ('a', 'b'):
    r = call('u/signup', {'username': f'qa183{n}_{tag}', 'password': 'qa-pass-1234', 'display': f'QA {n.upper()} {tag}'}); assert r.get('ok'), r
    U[n] = {'s': r['session']}
def me(u): return call('u/me?lite=1&s=' + u['s'])['user']
def pair(tc):
    a = call('q/seek', {'s': U['a']['s'], 'tc': tc}); b = call('q/seek', {'s': U['b']['s'], 'tc': tc})
    m = b.get('matched') or a.get('matched')
    for _ in range(20):
        if m: break
        pa = call('q/poll?id=' + a['id'] + '&hold=2000'); m = pa.get('matched')
    # both seats
    sa = call('q/poll?id=' + a['id'] + '&hold=0'); sb = call('q/poll?id=' + b['id'] + '&hold=0')
    return sa['matched'], sb['matched']
try:
    r0 = me(U['a'])['ratings']['blitz']
    ma, mb = pair('5+0')
    check(ma and mb and ma['code'] == mb['code'], 'paired into one room ' + ma['code'])
    r = call('action', {'code': ma['code'], 'tok': ma['seat'], 'type': 'abort'})
    check(r.get('ok') and r['status'] == 'over' and r['result']['reason'] == 'aborted' and r['result']['by'] == ma['color'], 'decline before any move: aborted %s' % r.get('result'))
    st = call('poll', {'code': mb['code'], 'tok': mb['seat'], 'ver': 0}) if False else call('join', {'code': mb['code'], 'tok': mb['seat'], 'name': ''})
    check(st.get('status') == 'over' and st['result']['reason'] == 'aborted' and st.get('quick'), 'the other player sees it aborted: %s' % st.get('result'))
    r2 = call('action', {'code': ma['code'], 'tok': mb['seat'], 'type': 'abort'})
    check(not r2.get('ok') and r2.get('code') == 'not_active', 'a second decline is refused: %s' % r2.get('code'))
    time.sleep(0.5)
    r1 = me(U['a'])['ratings']['blitz']
    check(r1['r'] == r0['r'] and r1['n'] == r0['n'], 'rating unchanged by an aborted game: %s -> %s' % (r0, r1))
    # after both sides moved, abort is refused
    ma, mb = pair('3+2')
    toks = {ma['color']: ma['seat'], mb['color']: mb['seat']}
    call('move', {'code': ma['code'], 'tok': toks['w'], 'uci': 'e2e4', 'ply': 0})
    r = call('action', {'code': ma['code'], 'tok': toks['b'], 'type': 'abort'})
    check(r.get('ok') and r['result']['reason'] == 'aborted', 'abort allowed after only White moved')
    ma, mb = pair('3+2')
    toks = {ma['color']: ma['seat'], mb['color']: mb['seat']}
    call('move', {'code': ma['code'], 'tok': toks['w'], 'uci': 'e2e4', 'ply': 0}); call('move', {'code': ma['code'], 'tok': toks['b'], 'uci': 'e7e5', 'ply': 1})
    r = call('action', {'code': ma['code'], 'tok': toks['w'], 'type': 'abort'})
    check(not r.get('ok') and r.get('code') == 'started', 'abort refused once both sides moved: %s' % r.get('code'))
    call('action', {'code': ma['code'], 'tok': toks['w'], 'type': 'resign'})
    # friend room: no abort
    room = call('create', {'color': 'w', 'tc': '5+0', 'name': 'QA', 'rated': False, 's': U['a']['s']})
    call('join', {'code': room['code'], 'tok': None, 'name': 'QB', 's': U['b']['s']})
    r = call('action', {'code': room['code'], 'tok': room['tok'], 'type': 'abort'})
    check(not r.get('ok') and r.get('code') == 'no_abort', 'friend rooms cannot be declined: %s' % r.get('code'))
    h = call('u/games?s=' + U['a']['s'])
    games = h.get('games', h.get('list', []))
    check(not any(g.get('reason') == 'aborted' for g in games), 'aborted games are not in history (%d games listed)' % len(games))
finally:
    for n in ('a', 'b'):
        d = call('u/delete', {'s': U[n]['s'], 'password': 'qa-pass-1234'}); print('deleted', n, d.get('ok'))
print('ALL PASS' if ok else 'SOME FAILED')
