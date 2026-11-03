// A light, reusable board for Game Review, Puzzles and Analysis: renders any position, highlights,
// arrows and move badges, and (when interactive) takes moves by tap-tap or drag, with legal-move dots.
const FILES = 'abcdefgh';
export const pieceUrl = (code) => {
  const set = document.body.dataset.pieces;
  return (set && set !== 'classic' ? `pieces/${set}/` : 'pieces/') + code + '.svg';
};

export class Board {
  constructor(root, opts = {}) {
    this.root = root; this.opts = opts;
    this.orientation = opts.orientation || 'w';
    this.fen = null; this.pieces = new Map(); this.sel = null; this.dests = [];
    this.marks = {}; this.arrows = []; this.userArrows = []; this.userMarks = new Set(); this.badge = null;
    root.classList.add('kb-board');
    root.innerHTML = '<div class="kb-squares"></div><div class="kb-layer"></div><svg class="kb-arrows" viewBox="0 0 800 800" aria-hidden="true"></svg><div class="kb-badges"></div>';
    this.sqWrap = root.children[0]; this.layer = root.children[1]; this.svg = root.children[2]; this.badges = root.children[3];
    this.buildSquares();
    root.addEventListener('pointerdown', (e) => this.down(e));
    root.addEventListener('pointermove', (e) => this.moveP(e));
    root.addEventListener('pointerup', (e) => this.up(e));
    root.addEventListener('pointercancel', () => this.cancelDrag());
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('kingside-pieces', () => this.refreshPieceImages());
  }
  rc(sq) { const f = FILES.indexOf(sq[0]), r = +sq[1] - 1; return this.orientation === 'w' ? { row: 7 - r, col: f } : { row: r, col: 7 - f }; }
  sqAt(row, col) { return this.orientation === 'w' ? FILES[col] + (8 - row) : FILES[7 - col] + (row + 1); }
  pointSq(x, y) {
    const r = this.root.getBoundingClientRect();
    const col = Math.floor(((x - r.left) / r.width) * 8), row = Math.floor(((y - r.top) / r.height) * 8);
    return col < 0 || col > 7 || row < 0 || row > 7 ? null : this.sqAt(row, col);
  }
  buildSquares() {
    this.sqs = new Map(); let html = '';
    for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
      const sq = this.sqAt(row, col); const dark = (FILES.indexOf(sq[0]) + +sq[1]) % 2 === 1;
      html += `<div class="sq ${dark ? 'dark' : 'light'}" data-sq="${sq}">${col === 0 ? `<span class="coord rank">${sq[1]}</span>` : ''}${row === 7 ? `<span class="coord file">${sq[0]}</span>` : ''}</div>`;
    }
    this.sqWrap.innerHTML = html;
    for (const el of this.sqWrap.children) this.sqs.set(el.dataset.sq, el);
  }
  flip(o) {
    this.orientation = o || (this.orientation === 'w' ? 'b' : 'w');
    this.buildSquares();
    for (const [sq, el] of this.pieces) this.place(el, sq);
    this.paint();
  }
  place(el, sq) { const { row, col } = this.rc(sq); el.style.transform = `translate(${col * 100}%, ${row * 100}%)`; }
  // set the position; pieces glide from where they were
  set(fen, { animate = true } = {}) {
    this.fen = fen;
    const next = new Map();
    const rows = fen.split(' ')[0].split('/');
    rows.forEach((r, i) => { let f = 0; for (const ch of r) { if (/\d/.test(ch)) f += +ch; else { const c = ch === ch.toUpperCase() ? 'w' : 'b'; next.set(FILES[f] + (8 - i), c + ch.toUpperCase()); f++; } } });
    const removed = [], added = [];
    for (const [sq, el] of this.pieces) if (next.get(sq) !== el.dataset.code) removed.push([sq, el]);
    for (const [sq, code] of next) { const el = this.pieces.get(sq); if (!el || el.dataset.code !== code) added.push([sq, code]); }
    for (const [sq] of removed) this.pieces.delete(sq);
    const dist = (a, b) => Math.abs(a.charCodeAt(0) - b.charCodeAt(0)) + Math.abs(+a[1] - +b[1]);
    for (const [sq, code] of added) {
      let best = -1, bd = 99;
      removed.forEach(([rsq, el], i) => { if (el.dataset.code === code) { const d = dist(rsq, sq); if (d < bd) { bd = d; best = i; } } });
      let el;
      if (best >= 0) { el = removed.splice(best, 1)[0][1]; el.classList.toggle('anim', animate); }
      else { el = document.createElement('div'); el.className = 'kb-piece'; el.dataset.code = code; el.style.backgroundImage = `url(${pieceUrl(code)})`; this.layer.appendChild(el); }
      this.place(el, sq); this.pieces.set(sq, el);
    }
    for (const [, el] of removed) el.remove();
    this.sel = null; this.dests = [];
    this.paint();
  }
  refreshPieceImages() { for (const [, el] of this.pieces) el.style.backgroundImage = `url(${pieceUrl(el.dataset.code)})`; }
  // marks: { last: [from,to], check: sq, cls: {sq: className} }
  setMarks(m) { this.marks = m || {}; this.paint(); }
  setArrows(list) { this.arrows = list || []; this.drawArrows(); }
  setBadge(b) { this.badge = b; this.drawBadge(); }
  clearUser() { this.userArrows = []; this.userMarks.clear(); this.paint(); }
  paint() {
    const m = this.marks; const last = m.last || [];
    const dests = new Set(this.dests.map((d) => d.to));
    const caps = new Set(this.dests.filter((d) => d.captured).map((d) => d.to));
    for (const [sq, el] of this.sqs) {
      el.className = 'sq ' + (el.classList.contains('dark') ? 'dark' : 'light');
      if (last.includes(sq)) el.classList.add('last');
      if (m.cls && m.cls[sq]) el.classList.add(m.cls[sq]);
      if (m.check === sq) el.classList.add('check');
      if (this.sel === sq) el.classList.add('sel');
      if (dests.has(sq)) el.classList.add(caps.has(sq) ? 'dest' : 'dest', ...(caps.has(sq) ? ['cap'] : []));
      if (this.userMarks.has(sq)) el.classList.add('umark');
    }
    this.drawArrows(); this.drawBadge();
  }
  arrowSvg(from, to, color, w = 15) {
    const a = this.rc(from), b = this.rc(to);
    const x1 = a.col * 100 + 50, y1 = a.row * 100 + 50, x2 = b.col * 100 + 50, y2 = b.row * 100 + 50;
    const ang = Math.atan2(y2 - y1, x2 - x1), len = Math.hypot(x2 - x1, y2 - y1);
    const hl = 34, ex = x1 + Math.cos(ang) * (len - hl), ey = y1 + Math.sin(ang) * (len - hl);
    const px = Math.cos(ang + Math.PI / 2), py = Math.sin(ang + Math.PI / 2);
    const tx = x1 + Math.cos(ang) * (len - 8), ty = y1 + Math.sin(ang) * (len - 8);
    const sx = x1 + Math.cos(ang) * 22, sy = y1 + Math.sin(ang) * 22;
    return `<g opacity=".86"><line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" stroke="${color}" stroke-width="${w}" stroke-linecap="butt"/>` +
      `<polygon points="${tx},${ty} ${ex + px * 26},${ey + py * 26} ${ex - px * 26},${ey - py * 26}" fill="${color}"/></g>`;
  }
  drawArrows() {
    let s = '';
    for (const a of this.arrows) s += this.arrowSvg(a.from, a.to, a.color || 'rgba(110,190,70,.95)');
    for (const a of this.userArrows) s += this.arrowSvg(a.from, a.to, 'rgba(240,160,40,.92)');
    if (this.dragArrow && this.dragArrow.to && this.dragArrow.to !== this.dragArrow.from) s += this.arrowSvg(this.dragArrow.from, this.dragArrow.to, 'rgba(240,160,40,.7)');
    this.svg.innerHTML = s;
  }
  drawBadge() {
    const b = this.badge;
    if (!b) { this.badges.innerHTML = ''; return; }
    const { row, col } = this.rc(b.sq);
    this.badges.innerHTML = `<span class="kb-badge" style="left:${(col + 1) * 12.5}%;top:${row * 12.5}%;background:${b.color};transform:translate(${col === 7 ? '-100%' : '-62%'},${row === 0 ? '0%' : '-38%'})">${b.icon}</span>`;
  }
  /* ---------- input ---------- */
  pieceAt(sq) { const el = this.pieces.get(sq); return el ? el.dataset.code : null; }
  canPick(sq) { const c = this.pieceAt(sq); return !!c && !!this.opts.movable && this.opts.movable(c[0], sq); }
  select(sq) { this.sel = sq; this.dests = sq && this.opts.dests ? this.opts.dests(sq) : []; this.paint(); }
  tryMove(from, to) {
    const d = this.dests.find((x) => x.to === to);
    if (!d) return false;
    this.select(null);
    this.opts.onMove && this.opts.onMove(from, to, d);
    return true;
  }
  down(e) {
    const sq = this.pointSq(e.clientX, e.clientY); if (!sq) return;
    if (e.button === 2) { this.dragArrow = { from: sq, to: sq }; e.preventDefault(); return; }
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (this.userArrows.length || this.userMarks.size) { this.userArrows = []; this.userMarks.clear(); this.paint(); }
    // long-press draws an arrow on touch screens
    clearTimeout(this.lp);
    if (e.pointerType !== 'mouse') this.lp = setTimeout(() => { this.cancelDrag(); this.select(null); this.dragArrow = { from: sq, to: sq, touch: true }; navigator.vibrate && navigator.vibrate(15); }, 480);
    if (this.sel && this.sel !== sq && this.tryMove(this.sel, sq)) { clearTimeout(this.lp); return; }
    if (this.canPick(sq)) {
      this.select(sq);
      const el = this.pieces.get(sq);
      const r = this.root.getBoundingClientRect();
      this.drag = { from: sq, el, x0: e.clientX, y0: e.clientY, size: r.width / 8, moved: false };
      try { this.root.setPointerCapture(e.pointerId); } catch (er) {}
    } else if (this.sel) this.select(null);
  }
  moveP(e) {
    if (this.dragArrow) { const sq = this.pointSq(e.clientX, e.clientY); if (sq && sq !== this.dragArrow.to) { this.dragArrow.to = sq; this.drawArrows(); } return; }
    const d = this.drag; if (!d) return;
    const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
    if (!d.moved && Math.hypot(dx, dy) < 6) return;
    clearTimeout(this.lp);
    d.moved = true;
    const { row, col } = this.rc(d.from);
    d.el.classList.add('dragging'); d.el.classList.remove('anim');
    d.el.style.transform = `translate(calc(${col * 100}% + ${dx}px), calc(${row * 100}% + ${dy}px))`;
  }
  up(e) {
    clearTimeout(this.lp);
    if (this.dragArrow) {
      const a = this.dragArrow; this.dragArrow = null;
      const to = this.pointSq(e.clientX, e.clientY) || a.to;
      if (to === a.from) { if (this.userMarks.has(to)) this.userMarks.delete(to); else this.userMarks.add(to); }
      else {
        const i = this.userArrows.findIndex((x) => x.from === a.from && x.to === to);
        if (i >= 0) this.userArrows.splice(i, 1); else this.userArrows.push({ from: a.from, to });
      }
      this.paint(); return;
    }
    const d = this.drag; this.drag = null; if (!d) return;
    d.el.classList.remove('dragging');
    if (!d.moved) return;
    const to = this.pointSq(e.clientX, e.clientY);
    this.place(d.el, d.from);
    if (to && to !== d.from) this.tryMove(d.from, to);
  }
  cancelDrag() { clearTimeout(this.lp); if (this.drag) { this.drag.el.classList.remove('dragging'); this.place(this.drag.el, this.drag.from); this.drag = null; } }
}
