// v1.7 Bot personalities: named opponents with their own strength, style, openings and chat (English + Hindi).
// Strength comes from real Stockfish settings (search depth, MultiPV width, softmax temperature over centipawn loss,
// slip rate, or Stockfish's own UCI_Elo limit); style re-weights the engine's candidate moves (checks, captures,
// king attacks, trades, castling, draw avoidance) without letting a bot throw away more than its temperature allows;
// openings come from a small repertoire per bot whose positions are all named in the Lichess opening book
// (data/openings.json; test/bots.test.mjs checks every line).
import { Chess } from './vendor/chess.js';

export const BOTS = [
  { id: 'chintu', name: 'Chintu', flag: '🇮🇳', elo: 250, lvl: 1, style: 'beginner',
    bio: { en: '8 years old, from Pune. Just learned how the horse moves and grabs every piece he can!', hi: '8 साल का, पुणे से। अभी-अभी घोड़े की चाल सीखी है और हर मोहरा पकड़ लेता है!' },
    tag: { en: 'Beginner-friendly', hi: 'नए खिलाड़ियों के लिए' },
    cfg: { multipv: 8, depth: 1, temp: 300, blunder: 0.25, random: 0.3 },
    rep: { w: ['e4 e5 Qh5', 'e4 e5 Bc4', 'e4 e5 Nf3 Nc6'], b: ['e4 e5', 'd4 d5', 'c4 e5', 'Nf3 d5'] },
    say: {
      start: { en: ['Hi! Let’s play! I’m going to get your queen 😄', 'My mummy says I’m really good at chess!'], hi: ['हाय! चलो खेलें! मैं तुम्हारी रानी पकड़ लूँगा 😄', 'मम्मी कहती हैं मैं शतरंज में बहुत अच्छा हूँ!'] },
      win: { en: ['YAY! I won! Can I tell my friends? 🎉'], hi: ['ये! मैं जीत गया! दोस्तों को बताऊँ? 🎉'] },
      lose: { en: ['Aww… you’re good! One more game? 🙏'], hi: ['ओह… तुम तो बहुत अच्छे हो! एक और गेम? 🙏'] },
      draw: { en: ['A draw? Nobody won? Okay, again!'], hi: ['ड्रॉ? कोई नहीं जीता? चलो फिर से!'] } } },
  { id: 'meera', name: 'Meera Didi', short: 'Meera', flag: '🇮🇳', elo: 600, lvl: 2, style: 'friendly',
    bio: { en: 'School chess-club coach from Jaipur. Plays fair, keeps it simple and lets you learn from mistakes.', hi: 'जयपुर के स्कूल चेस क्लब की कोच। सीधा-सादा, साफ़ खेल खेलती हैं ताकि आप गलतियों से सीखें।' },
    tag: { en: 'Friendly coach', hi: 'दोस्ताना कोच' },
    cfg: { multipv: 6, depth: 2, temp: 150, blunder: 0.07, random: 0.03 },
    rep: { w: ['e4 e5 Nf3 Nc6 Bc4 Bc5 c3', 'e4 e5 Nf3 Nc6 Bc4 Nf6 d3', 'd4 d5 Nf3 Nf6 Bf4'], b: ['e4 e5 Nf3 Nc6 Bc4 Bc5', 'd4 d5 c4 e6', 'c4 e5', 'Nf3 d5'] },
    say: {
      start: { en: ['Namaste! Control the centre, develop your pieces, and castle early. Let’s go!', 'Take your time. Check every capture before you play it 🙂'], hi: ['नमस्ते! केंद्र पर कब्ज़ा करो, मोहरे निकालो और जल्दी कैसलिंग करो। चलो!', 'आराम से खेलो। हर कैप्चर से पहले एक बार जाँच लो 🙂'] },
      win: { en: ['Good fight! Look at the review to see where it turned.'], hi: ['अच्छा मुकाबला! रिव्यू में देखो खेल कहाँ पलटा।'] },
      lose: { en: ['Shabash! Very well played 👏'], hi: ['शाबाश! बहुत बढ़िया खेले 👏'] },
      draw: { en: ['A fair draw. Well defended!'], hi: ['बराबरी का ड्रॉ। अच्छा बचाव किया!'] } } },
  { id: 'rocky', name: 'Rocky', flag: '💪', elo: 1000, lvl: 4, style: 'aggressive',
    bio: { en: 'Gym trainer who plays chess like he lifts: all-out attack, gambits every game, never says sorry.', hi: 'जिम ट्रेनर, जो वैसे ही शतरंज खेलता है जैसे वज़न उठाता है: पूरा हमला, हर गेम में गैम्बिट।' },
    tag: { en: 'Aggressive gambiteer', hi: 'हमलावर गैम्बिट वाला' },
    cfg: { multipv: 5, depth: 4, temp: 80, blunder: 0.035 },
    rep: { w: ['e4 e5 f4', 'e4 e5 d4 exd4 c3', 'e4 c5 d4 cxd4 c3'], b: ['e4 e5 Nf3 f5', 'd4 d5 c4 e5', 'e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5', 'c4 e5', 'Nf3 d5'] },
    say: {
      start: { en: ['Pawns are just weights. I’m throwing them at your king 💪', 'No defence today. Only attack!'], hi: ['प्यादे तो बस वज़न हैं। सब तुम्हारे राजा पर फेंकूँगा 💪', 'आज कोई बचाव नहीं। सिर्फ़ हमला!'] },
      win: { en: ['BOOM! That’s how you finish a set! 🔥'], hi: ['धमाका! ऐसे ख़त्म होता है सेट! 🔥'] },
      lose: { en: ['You survived the storm. Respect. Rematch?'], hi: ['तूफ़ान झेल लिया। सलाम। रीमैच?'] },
      draw: { en: ['A draw?! I hate draws. Again!'], hi: ['ड्रॉ?! मुझे ड्रॉ से नफ़रत है। फिर से!'] } } },
  { id: 'iyer', name: 'Professor Iyer', short: 'Prof. Iyer', flag: '🇮🇳', elo: 1300, lvl: 5, style: 'solid',
    bio: { en: 'Retired maths professor from Chennai. Never in a hurry: trades pieces, defends everything, loves endgames.', hi: 'चेन्नई के रिटायर्ड गणित प्रोफ़ेसर। कभी जल्दी नहीं: मोहरे बदलते हैं, सब बचाते हैं, एंडगेम पसंद है।' },
    tag: { en: 'Solid defender', hi: 'मज़बूत बचाव' },
    cfg: { multipv: 4, depth: 6, temp: 45, blunder: 0.012 },
    rep: { w: ['d4 d5 Bf4', 'd4 Nf6 Bf4'], b: ['e4 c6 d4 d5', 'd4 d5 c4 e6', 'c4 e6', 'Nf3 d5'] },
    say: {
      start: { en: ['Good evening. Let us see whose structure holds up. Slowly, slowly.', 'Patience wins more games than brilliance.'], hi: ['शुभ संध्या। देखते हैं किसका ढाँचा टिकता है। धीरे-धीरे।', 'धैर्य, चतुराई से ज़्यादा गेम जिताता है।'] },
      win: { en: ['As expected: the better structure won. Q.E.D.'], hi: ['जैसा सोचा था: बेहतर ढाँचा जीता। सिद्ध हुआ।'] },
      lose: { en: ['Excellent. You found the weakness. Full marks.'], hi: ['उत्तम। तुमने कमज़ोरी पकड़ ली। पूरे अंक।'] },
      draw: { en: ['A draw. Perfectly balanced, as it should be.'], hi: ['ड्रॉ। बिल्कुल संतुलित, जैसा होना चाहिए।'] } } },
  { id: 'zara', name: 'Zara', flag: '🎭', elo: 1500, lvl: 5, style: 'tricky',
    bio: { en: 'Chess streamer who lives for traps and swindles. Look twice before you take anything she offers!', hi: 'चेस स्ट्रीमर, जिसे जाल बिछाना पसंद है। जो वो दे, लेने से पहले दो बार देखना!' },
    tag: { en: 'Tricky trapper', hi: 'चालाक जाल वाली' },
    cfg: { multipv: 5, depth: 8, temp: 40, blunder: 0.01 },
    rep: { w: ['e4 e5 Nf3 Nc6 Bc4 Bc5 b4', 'e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5', 'e4 e5 Nc3 Nf6 f4'], b: ['e4 e5 Nf3 Nf6 Nxe5 Nc6', 'd4 e5', 'e4 e5 Nf3 Nc6 Bc4 Nd4', 'c4 e5', 'Nf3 d5'] },
    say: {
      start: { en: ['Hey chat! Let’s see if they fall for it 😏', 'Free pieces? Sure… totally free 😇'], hi: ['हेलो चैट! देखते हैं ये जाल में फँसते हैं या नहीं 😏', 'मुफ़्त मोहरे? हाँ… बिल्कुल मुफ़्त 😇'] },
      win: { en: ['Gotcha! Clip that 🎬'], hi: ['पकड़ लिया! इसकी क्लिप बनाओ 🎬'] },
      lose: { en: ['You saw through all my tricks?! New subscriber unlocked.'], hi: ['सारे जाल पकड़ लिए?! नया सब्सक्राइबर मिल गया।'] },
      draw: { en: ['Draw… my traps need an upgrade.'], hi: ['ड्रॉ… मेरे जालों को अपग्रेड चाहिए।'] } } },
  { id: 'vikram', name: 'Vikram', flag: '🇮🇳', elo: 1800, lvl: 6, style: 'aggressive',
    bio: { en: 'Delhi college champion. Sharp and fearless: the Sicilian Najdorf, opposite castling, straight at your king.', hi: 'दिल्ली कॉलेज चैंपियन। तेज़ और निडर: सिसिलियन नाइडोर्फ़ और सीधा राजा पर हमला।' },
    tag: { en: 'Sharp attacker', hi: 'तेज़ हमलावर' },
    cfg: { multipv: 3, depth: 11, temp: 25, blunder: 0.004 },
    rep: { w: ['e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6', 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O', 'e4 e6 d4 d5 Nc3'], b: ['e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6', 'd4 Nf6 c4 g6', 'c4 c5', 'Nf3 Nf6 c4 g6'] },
    say: {
      start: { en: ['Najdorf ready. Hope you’ve done your homework.', 'Let’s make it sharp. No quiet games here.'], hi: ['नाइडोर्फ़ तैयार है। उम्मीद है तुमने तैयारी की है।', 'चलो खेल को तेज़ बनाते हैं। यहाँ शांत गेम नहीं चलते।'] },
      win: { en: ['Good game. The attack was faster.'], hi: ['अच्छा गेम। हमला ज़्यादा तेज़ था।'] },
      lose: { en: ['Well played. You defended like a pro.'], hi: ['बढ़िया खेले। प्रो की तरह बचाव किया।'] },
      draw: { en: ['Draw. Tough nut to crack.'], hi: ['ड्रॉ। तुम्हें तोड़ना मुश्किल है।'] } } },
  { id: 'natasha', name: 'Natasha', flag: '♛', elo: 2200, lvl: 8, style: 'positional',
    bio: { en: 'Old-school coach. Calm and precise: wins a pawn, then squeezes the position until it cracks.', hi: 'पुराने स्कूल की कोच। शांत और सटीक: एक प्यादा जीतती हैं, फिर धीरे-धीरे दबाती हैं।' },
    tag: { en: 'Positional master', hi: 'पोज़िशनल मास्टर' },
    cfg: { elo: 2200, movetime: 900 },
    rep: { w: ['d4 Nf6 c4 e6 g3', 'd4 d5 c4 e6 Nc3 Nf6 Bg5', 'c4 e5 Nc3'], b: ['e4 e5 Nf3 Nc6 Bb5 Nf6', 'd4 d5 c4 e6', 'c4 e5', 'Nf3 d5'] },
    say: {
      start: { en: ['Good luck. Small advantages add up.', 'Every move should have a reason.'], hi: ['शुभकामनाएँ। छोटे फ़ायदे जुड़कर बड़े बनते हैं।', 'हर चाल के पीछे एक वजह होनी चाहिए।'] },
      win: { en: ['Thank you for the game. Study the endgame.'], hi: ['गेम के लिए धन्यवाद। एंडगेम पढ़ो।'] },
      lose: { en: ['Impressive. You played like a master today.'], hi: ['प्रभावशाली। आज तुम मास्टर की तरह खेले।'] },
      draw: { en: ['A correct draw. Well played.'], hi: ['सही ड्रॉ। अच्छा खेले।'] } } },
  { id: 'titan', name: 'Titan', flag: '🤖', elo: 3000, lvl: 10, style: 'machine',
    bio: { en: 'Stockfish 19 at full power. No feelings, no mistakes, no mercy.', hi: 'पूरी ताक़त पर Stockfish 19। न भावनाएँ, न गलतियाँ, न दया।' },
    tag: { en: 'Full-strength engine', hi: 'पूरी ताक़त का इंजन' },
    cfg: { skill: 20, movetime: 2500 },
    rep: null,
    say: {
      start: { en: ['Calculating… 87 million positions per… just kidding. Good luck, human.'], hi: ['गणना जारी… बस मज़ाक। शुभकामनाएँ, इंसान।'] },
      win: { en: ['Result: 1. Expected.'], hi: ['नतीजा: जीत। अपेक्षित।'] },
      lose: { en: ['ERROR… recalculating… you are very strong.'], hi: ['त्रुटि… दोबारा गणना… तुम बहुत मज़बूत हो।'] },
      draw: { en: ['Draw. Statistically remarkable.'], hi: ['ड्रॉ। आँकड़ों में असाधारण।'] } } },
];
export const botById = (id) => BOTS.find((b) => b.id === id) || null;
export const avatarUrl = (b) => `bots/${b.id}.svg`;
const lang = () => (window.__i18n && window.__i18n.lang && window.__i18n.lang() === 'hi' ? 'hi' : 'en');
export const t = (o) => (o ? o[lang()] || o.en : '');
export function line(bot, kind) { const l = bot.say[kind] ? bot.say[kind][lang()] || bot.say[kind].en : []; return l.length ? l[Math.floor(Math.random() * l.length)] : ''; }

// next repertoire move for the bot (SAN) given the game so far, or null once out of its lines
export function bookMove(bot, sans, color) {
  if (!bot.rep) return null;
  const lines = (color === 'w' ? bot.rep.w : bot.rep.b).map((l) => l.split(' '));
  const n = sans.length;
  const fit = lines.filter((l) => l.length > n && sans.every((s, i) => l[i] === s));
  if (!fit.length) return null;
  return fit[Math.floor(Math.random() * fit.length)][n];
}

// style bonus (in centipawns) for one candidate move, read off the position after it
const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
function styleBonus(bot, g, mv, cp, best) {
  const st = bot.style, me = mv.color, opp = me === 'w' ? 'b' : 'w';
  let b = 0;
  const check = mv.san.includes('+') || mv.san.includes('#');
  const toRank = +mv.to[1], fromRank = +mv.from[1];
  const fwd = me === 'w' ? toRank - fromRank : fromRank - toRank;
  let oppK = null;
  for (const row of g.board()) for (const p of row) if (p && p.type === 'k' && p.color === opp) oppK = p.square;
  const dist = oppK ? Math.max(Math.abs(oppK.charCodeAt(0) - mv.to.charCodeAt(0)), Math.abs(+oppK[1] - toRank)) : 8;
  const drawish = g.isThreefoldRepetition() || g.isInsufficientMaterial() || g.isStalemate();
  if (st === 'beginner') { if (mv.captured) b += 60 + 10 * VAL[mv.captured]; if (mv.piece === 'q') b += 15; if (check) b += 20; }
  else if (st === 'aggressive') {
    if (check) b += 28; if (mv.captured) b += 12; if (dist <= 2 && mv.piece !== 'k') b += 18; if (fwd > 0) b += 6 * Math.min(fwd, 3); if (fwd < 0 && !mv.captured) b -= 12;
    if (mv.piece === 'p' && 'fgh'.includes(mv.to[0]) && fwd > 0) b += 6; // pawn storm
    if (drawish && best > -150) b -= 300; // contempt: an attacker plays on
  } else if (st === 'solid') {
    if (mv.flags.includes('k') || mv.flags.includes('q')) b += 30;
    if (mv.captured && mv.piece !== 'p' && VAL[mv.captured] === VAL[mv.piece] && best >= -50) b += 18; // trades when not worse
    const kingSide = me === 'w' ? fromRank <= 3 : fromRank >= 6;
    if (mv.piece === 'p' && kingSide && 'fgh'.includes(mv.from[0])) b -= 20; // keep the king's pawns home
    if (check) b -= 4;
    if (drawish && best < 60) b += 40; // happy with a draw unless clearly better
  } else if (st === 'tricky') {
    if (check) b += 22;
    // new attacks on undefended or bigger enemy pieces = threats the opponent must see
    let threats = 0;
    for (const row of g.board()) for (const p of row) {
      if (!p || p.color !== opp || p.type === 'k') continue;
      const atk = g.attackers(p.square, me);
      if (atk.length && (!g.isAttacked(p.square, opp) || atk.some((s) => VAL[g.get(s).type] < VAL[p.type]))) threats += VAL[p.type];
    }
    b += Math.min(30, threats * 5);
    if (drawish && best > -150) b -= 250;
  } else if (st === 'friendly') { if (mv.flags.includes('k') || mv.flags.includes('q')) b += 25; if (mv.piece === 'n' || mv.piece === 'b') b += fwd > 0 && g.history().length < 20 ? 10 : 0; }
  return b;
}

// choose among the engine's candidate lines with the bot's style: softmax over (cp + style bonus) at the bot's temperature,
// with the bot's slip rate. lines = [{ cp, move }] from MultiPV, g = Chess with the game's history (for repetitions).
export function pickStyled(bot, lines, best, game) {
  const cfg = bot.cfg;
  const ls = (lines || []).filter((l) => l && l.move);
  if (!cfg.multipv || cfg.multipv < 2 || ls.length < 2) return best;
  const top = Math.max(...ls.map((l) => l.cp));
  if (cfg.blunder && Math.random() < cfg.blunder) {
    const ok = ls.filter((l) => l.cp > -50000);
    return (ok.length ? ok : ls)[Math.floor(Math.random() * (ok.length || ls.length))].move;
  }
  const scored = ls.map((l) => {
    let bonus = 0;
    try {
      const mv = game.move({ from: l.move.slice(0, 2), to: l.move.slice(2, 4), promotion: l.move[4] || undefined });
      if (mv) { bonus = styleBonus(bot, game, mv, l.cp, top); game.undo(); }
    } catch (e) { /* not legal here: ignore the line */ }
    // never let style turn a forced mate into something else, and cap how much it can buy
    if (top > 50000 && l.cp < top) bonus = Math.min(bonus, 0);
    return { move: l.move, s: l.cp + Math.max(-300, Math.min(cfg.temp ? cfg.temp * 1.2 : 60, bonus)) };
  });
  const sTop = Math.max(...scored.map((x) => x.s));
  const temp = cfg.temp || 50;
  const w = scored.map((x) => Math.exp(-Math.min(3000, sTop - x.s) / temp));
  let r = Math.random() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < scored.length; i++) { r -= w[i]; if (r <= 0) return scored[i].move; }
  return scored[0].move;
}
export function gameCopy(chess) { const g = new Chess(); for (const m of chess.history({ verbose: true })) g.move({ from: m.from, to: m.to, promotion: m.promotion }); return g; }

// the bot's move in this position (SAN book move, a random-ish slip for the weakest bots, or the engine with its style).
// Used by the game and by the bot test harness, so both run exactly the same code.
export async function chooseMove(bot, chess, engine) {
  const book = bookMove(bot, chess.history(), chess.turn());
  const bm = book ? chess.moves({ verbose: true }).find((m) => m.san === book) : null;
  if (bm) return { uci: bm.from + bm.to + (bm.promotion || ''), how: 'book' };
  const cfg = bot.cfg;
  if (cfg.random && Math.random() < cfg.random) {
    const moves = chess.moves({ verbose: true });
    const caps = moves.filter((m) => m.captured === 'q');
    const pool = caps.length && Math.random() < 0.5 ? caps : moves;
    const m = pool[Math.floor(Math.random() * pool.length)];
    return { uci: m.from + m.to + (m.promotion || ''), how: 'random' };
  }
  let L = cfg;
  if (cfg.multipv) { const gc = gameCopy(chess); L = { ...cfg, pick: (lines, best) => pickStyled(bot, lines, best, gc) }; }
  return { uci: await engine.bestMove(chess.fen(), L), how: 'engine' };
}
