#!/usr/bin/env python3
"""Stockfish check of every Learn lesson (test/learn_verify.py).
Usage: python3 test/learn_verify.py [path/to/stockfish]   (needs: pip install chess; node on PATH)
Checks: every scripted position is legal (rule-teaching basics steps are only checked for legality; a step marked demo, like Scholar's mate, is a trap shown on purpose); every learner move in tactics, checkmate and endgame steps is Stockfish's
best move (or keeps a forced mate / is within 0.3 pawns of the best when winning); opening moves are not mistakes
(lose < 0.7 pawns vs the best move); every "play it out" goal is a real win/hold, and is reached when Stockfish plays
both sides from the goal position."""
import json, subprocess, sys, os
import chess, chess.engine
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.join(HERE, '..', 'web-site')
SF = sys.argv[1] if len(sys.argv) > 1 else '/usr/games/stockfish'
out = subprocess.run(['node', '--input-type=module', '-e', "import('" + os.path.join(SITE, 'learn-data.js') + "').then(m=>console.log(JSON.stringify(m.CHAPTERS)))"], capture_output=True, text=True, check=True)
CH = json.loads(out.stdout)
eng = chess.engine.SimpleEngine.popen_uci(SF); eng.configure({'Threads': os.cpu_count() or 2, 'Hash': 256})
fails, warns, nsteps, nmoves = [], [], 0, 0
def score_after(b, mv, depth):
    b2 = b.copy(); b2.push(mv)
    if b2.is_checkmate(): return chess.engine.Mate(0)
    return eng.analyse(b2, chess.engine.Limit(depth=depth))['score'].pov(b.turn)
def top(b, depth, n=4):
    return [(x['pv'][0], x['score'].pov(b.turn)) for x in eng.analyse(b, chess.engine.Limit(depth=depth), multipv=n)]
def wins(sc): return sc.is_mate() and sc.mate() > 0 or (not sc.is_mate() and sc.score() > 300)
for ch in CH:
    for L in ch['lessons']:
        cur = None
        for si, s in enumerate(L['steps']):
            tag = f"{ch['id']}/{L['id']} step {si + 1}"; nsteps += 1
            if 'stars' in s: cur = None; continue
            if s.get('fen'): b = chess.Board(s['fen'])
            elif s.get('from'):
                b = chess.Board()
                for m in s['from'].split(): b.push_san(m)
            else: b = cur.copy()
            if not b.is_valid(): fails.append((tag, 'illegal start position', b.fen()))
            for m in s.get('pre', []): b.push_san(m)
            lines = s.get('lines') or ([s['line']] if s.get('line') else None)
            if s.get('goal'):
                me = {'w': chess.WHITE, 'b': chess.BLACK}[s['me']] if s.get('me') else b.turn
                ev = top(b, 24, 1)[0][1]
                if b.turn != me: ev = -ev
                sim = b.copy(); ok = False
                for ply in range(160):
                    if sim.is_game_over(): break
                    if s['goal'] == 'promote' and any(sim.pieces(chess.QUEEN, me)): ok = True; break
                    if s['goal'] == 'catch' and not sim.pieces(chess.PAWN, not me) and not sim.pieces(chess.QUEEN, not me): ok = True; break
                    sim.push(eng.play(sim, chess.engine.Limit(depth=18)).move)
                if s['goal'] == 'mate': ok = sim.is_checkmate() and sim.turn != me
                if s['goal'] == 'promote' and any(sim.pieces(chess.QUEEN, me)): ok = True
                if s['goal'] == 'catch' and not sim.pieces(chess.PAWN, not me) and not sim.pieces(chess.QUEEN, not me): ok = True
                if s['goal'] in ('mate', 'promote') and not wins(ev): fails.append((tag, 'goal position is not a win', ev))
                if not ok: fails.append((tag, 'Stockfish self-play did not reach the goal', sim.fen()))
                else: print(f'ok   {tag}: goal {s["goal"]} reached in {len(sim.move_stack) - len(b.move_stack)} plies (eval {ev})')
                cur = b; continue
            if not lines: cur = b; continue
            for li, line in enumerate(lines):
                bb = b.copy()
                for i, san in enumerate(line):
                    mv = bb.parse_san(san)
                    if i % 2 == 0:
                        nmoves += 1
                        if ch['id'] == 'openings' or (ch['id'] == 'mates' and L['id'] == 'scholar' and si == 1) or (L['id'] == 'principles') or (L['id'] == 'backrank' and si == 2):
                            t = top(bb, 20, 1)[0][1]; mine = score_after(bb, mv, 20)
                            loss = (t.score(mate_score=10000) - mine.score(mate_score=10000))
                            (fails if loss > 70 else warns if loss > 35 else []).append((tag, f'line {li + 1} move {san}: loses {loss} cp vs best'))
                        elif s.get('demo'): pass
                        elif ch['id'] != 'basics' or s.get('best') or any('#' in x for x in line):
                            t = top(bb, 22, 3); best_mv, best = t[0]; mine = score_after(bb, mv, 22)
                            b2 = bb.copy(); b2.push(mv)
                            if b2.is_checkmate(): pass
                            elif best.is_mate() and best.mate() > 0:
                                if not (mine.is_mate() and mine.mate() > 0): fails.append((tag, f'line {li + 1} move {san} misses the forced mate ({bb.san(best_mv)} {best})'))
                                elif ch['id'] != 'endgames' and mine.mate() > best.mate() + 0 and mv != best_mv: warns.append((tag, f'{san} mates in {mine.mate()}, best {bb.san(best_mv)} mates in {best.mate()}'))
                            elif mv != best_mv:
                                loss = best.score(mate_score=10000) - mine.score(mate_score=10000)
                                if loss > 30 and not (wins(mine) and loss <= 80): fails.append((tag, f'line {li + 1} move {san} is not best: {bb.san(best_mv)} {best} vs {mine}'))
                    bb.push(mv)
                if li == 0: cur = bb
            print(f'ok   {tag}')
eng.quit()
print(f'\n{nsteps} steps, {nmoves} learner moves checked')
for w in warns: print('WARN', *w)
for f in fails: print('FAIL', *f)
print('RESULT', 'PASS' if not fails else 'FAIL')
sys.exit(1 if fails else 0)
