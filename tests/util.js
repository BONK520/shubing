// Shared helpers for tests/engine.test.js and tests/sim.js.
// Everything here is written independently of js/engine.js so it can check the engine.

// Background for hand-made layouts: kinds 4..9 in a pattern that never matches, not even after
// pieces fall (horizontal neighbours always differ in parity). Test pieces use kinds 0..3.
export const BG_KINDS = [4, 5, 6, 7, 8, 9];
export const bgKind = (r, c) => 4 + ((2 * r + c) % 6);

// '_' -> background piece. Rows are space separated tokens ("_ 0h _") or plain characters ("_0_").
export function lay(rowsArr) {
  return rowsArr.map((row, r) => {
    const s = row.trim();
    const toks = s.includes(' ') ? s.split(/\s+/) : s.split('');
    return toks.map((t, c) => (t === '_' ? String(bgKind(r, c)) : t)).join(' ');
  });
}

export const MASKS = {
  full: null,
  diamond: ['...##...', '..####..', '.######.', '########', '########', '.######.', '..####..', '...##...'],
  holes: ['########', '##.##.##', '########', '#.####.#', '#.####.#', '########', '##.##.##', '########'],
  ushape: ['##....##', '##....##', '########', '########', '###..###', '###..###', '########', '########'],
  tall: ['#######', '#.###.#', '#######', '#######', '...#...', '#######', '#######', '#.###.#', '#######'],
};
export const maskSize = m => (m ? { rows: m.length, cols: m[0].length } : { rows: 8, cols: 8 });

export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// runs of >= 3 same kind (kind >= 0) in a board grid
export function runsIn(board) {
  const R = board.length, C = board[0].length;
  const k = (r, c) => (r >= 0 && r < R && c >= 0 && c < C && board[r][c] && board[r][c].kind >= 0 ? board[r][c].kind : null);
  const runs = [];
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const v = k(r, c);
    if (v === null) continue;
    if (k(r, c - 1) !== v && k(r, c + 1) === v && k(r, c + 2) === v) runs.push({ r, c, dir: 'h', kind: v });
    if (k(r - 1, c) !== v && k(r + 1, c) === v && k(r + 2, c) === v) runs.push({ r, c, dir: 'v', kind: v });
  }
  return runs;
}
// 2×2 squares of the same kind (kind >= 0), by top-left corner
export function squaresIn(board) {
  const R = board.length, C = board[0].length;
  const k = (r, c) => (r >= 0 && r < R && c >= 0 && c < C && board[r][c] && board[r][c].kind >= 0 ? board[r][c].kind : null);
  const out = [];
  for (let r = 0; r + 1 < R; r++) for (let c = 0; c + 1 < C; c++) {
    const v = k(r, c);
    if (v !== null && k(r, c + 1) === v && k(r + 1, c) === v && k(r + 1, c + 1) === v) out.push({ r, c, dir: 'square', kind: v });
  }
  return out;
}
// everything that would clear: runs of 3+ and 2×2 squares
export const matchesIn = board => [...runsIn(board), ...squaresIn(board)];

export const pieceStr = p => (p ? `${p.id}:${p.kind}:${p.special}${p.block ? ':' + p.block + p.hp : ''}` : '-');
export const boardStr = b => b.map(row => row.map(pieceStr).join(' ')).join('\n');
export const sameBoard = (a, b) => boardStr(a) === boardStr(b);
const BLOCK_CH = { dino: 'D', frost: 'F', choco: 'C', licorice: 'S' };
export const kindStr = b => b.map(row => row.map(p => (!p ? '.' : p.block ? BLOCK_CH[p.block] + (p.block === 'frost' ? p.hp : ' ') : p.special === 'bomb' ? 'B' : p.kind + (p.special === 'none' ? ' ' : p.special[0]))).join('')).join('\n');
// pieces that never move: frosting, chocolate, anything in a cage
export const isFixed = (p, locked) => !!locked || (!!p && (p.block === 'frost' || p.block === 'choco'));

const fail = msg => { throw new Error(msg); };
const copyBoard = b => b.map(row => row.map(p => (p ? { ...p } : null)));

// Apply events to `board0` the way a renderer would, checking each step against ev.board/ev.jelly.
export function replayEvents(board0, jelly0, events, lock0 = null) {
  const g = copyBoard(board0);
  const j = jelly0.map(r => r.slice());
  const R = g.length, C = g[0].length;
  const L = lock0 ? lock0.map(r => r.slice()) : g.map(r => r.map(() => 0));
  const at = (p, what) => {
    if (!p || p.r < 0 || p.r >= R || p.c < 0 || p.c >= C) fail(`${what}: bad coord ${JSON.stringify(p)}`);
    return p;
  };
  events.forEach((e, i) => {
    const where = `event #${i} (${e.t})`;
    if (e.t === 'swap' || e.t === 'swapBack') {
      at(e.a, where); at(e.b, where);
      if (isFixed(g[e.a.r][e.a.c], L[e.a.r][e.a.c]) || isFixed(g[e.b.r][e.b.c], L[e.b.r][e.b.c])) fail(`${where}: swaps a piece that cannot move`);
      const t = g[e.a.r][e.a.c]; g[e.a.r][e.a.c] = g[e.b.r][e.b.c]; g[e.b.r][e.b.c] = t;
    } else if (e.t === 'transform') {
      for (const x of e.cells) {
        at(x, where);
        const cur = g[x.r][x.c];
        if (!cur || cur.id !== x.piece.id) fail(`${where}: transform changes the piece at ${x.r},${x.c} (${pieceStr(cur)} -> ${pieceStr(x.piece)})`);
        if (cur.block) fail(`${where}: transform of a ${cur.block}`);
        g[x.r][x.c] = { ...x.piece };
      }
    } else if (e.t === 'clear') {
      for (const x of e.unlocks || []) {
        at(x, where);
        if (!L[x.r][x.c]) fail(`${where}: unlock at ${x.r},${x.c} without a cage`);
        L[x.r][x.c] = 0;
      }
      for (const x of e.blockerHits || []) {
        at(x, where);
        const cur = g[x.r][x.c];
        if (!cur || cur.block !== x.block || x.left !== cur.hp - 1 || x.left < 1) fail(`${where}: blocker hit ${JSON.stringify(x)} on ${pieceStr(cur)}`);
        g[x.r][x.c] = { ...cur, hp: x.left };
      }
      for (const x of e.removed) {
        at(x, where);
        const cur = g[x.r][x.c];
        if (!cur || cur.id !== x.piece.id) fail(`${where}: removed ${pieceStr(x.piece)} at ${x.r},${x.c} but board has ${pieceStr(cur)}`);
        if (cur.block === 'dino') fail(`${where}: a dino was destroyed`);
        if (L[x.r][x.c]) fail(`${where}: removed a caged piece at ${x.r},${x.c}`);
        g[x.r][x.c] = null;
      }
      for (const x of e.jellyHits) { at(x, where); j[x.r][x.c] = x.left; }
      for (const x of e.created) {
        at(x, where);
        const cur = g[x.r][x.c];
        if (cur && cur.id !== x.piece.id) fail(`${where}: created ${pieceStr(x.piece)} over ${pieceStr(cur)} at ${x.r},${x.c}`);
        g[x.r][x.c] = { ...x.piece };
      }
    } else if (e.t === 'fall' || e.t === 'shuffle') {
      const lifted = [];
      for (const m of e.moves) {
        at(m.from, where); at(m.to, where);
        const cur = g[m.from.r][m.from.c];
        if (!cur || cur.id !== m.id) fail(`${where}: move of id ${m.id} from ${m.from.r},${m.from.c} but board has ${pieceStr(cur)}`);
        if (isFixed(cur, L[m.from.r][m.from.c]) || L[m.to.r][m.to.c]) fail(`${where}: moves a fixed piece / into a cage ${JSON.stringify(m)}`);
        if (e.t === 'fall') {
          if (m.path) checkPath(m.path, m.from, m.to, where, m);
          else if (m.to.c !== m.from.c || m.to.r <= m.from.r) fail(`${where}: fall move not straight down ${JSON.stringify(m)}`);
        }
        lifted.push([m, cur]);
        g[m.from.r][m.from.c] = null;
      }
      for (const [m, p] of lifted) {
        if (g[m.to.r][m.to.c]) fail(`${where}: move of id ${m.id} lands on occupied ${m.to.r},${m.to.c}`);
        g[m.to.r][m.to.c] = m.piece ? { ...m.piece } : p;
      }
      for (const s of e.spawns || []) {
        at(s.to, where);
        if (!(s.from.r < 0)) fail(`${where}: bad spawn ${JSON.stringify(s)}`);
        if (s.path) checkPath(s.path.slice(1), s.path[1], s.to, where, s);
        else if (s.from.c !== s.to.c) fail(`${where}: bad spawn ${JSON.stringify(s)}`);
        if (g[s.to.r][s.to.c]) fail(`${where}: spawn lands on occupied ${s.to.r},${s.to.c}`);
        g[s.to.r][s.to.c] = { ...s.piece };
      }
    } else if (e.t === 'exit') {
      if (!e.cells.length) fail(`${where}: empty exit`);
      for (const x of e.cells) {
        at(x, where);
        const cur = g[x.r][x.c];
        if (!cur || cur.block !== 'dino' || cur.id !== x.piece.id) fail(`${where}: exit of ${pieceStr(x.piece)} but board has ${pieceStr(cur)}`);
        g[x.r][x.c] = null;
      }
    } else if (e.t === 'tick') {
      if (!e.cells.length) fail(`${where}: empty tick`);
      for (const x of e.cells) {
        at(x, where);
        const cur = g[x.r][x.c];
        if (!cur || cur.block !== 'alarm' || x.hp !== cur.hp - 1 || x.hp < 0) fail(`${where}: tick ${JSON.stringify(x)} on ${pieceStr(cur)}`);
        g[x.r][x.c] = { ...cur, hp: x.hp };
      }
    } else if (e.t === 'alarm') {
      if (!e.cells.length) fail(`${where}: empty alarm`);
      for (const x of e.cells) {
        at(x, where);
        const cur = g[x.r][x.c];
        if (!cur || cur.block !== 'alarm' || cur.hp !== 0 || cur.id !== x.piece.id) fail(`${where}: alarm burst of ${pieceStr(x.piece)} but board has ${pieceStr(cur)}`);
        g[x.r][x.c] = null;
      }
    } else if (e.t === 'spread') {
      at(e.from, where); at(e.to, where);
      const src = g[e.from.r][e.from.c], cur = g[e.to.r][e.to.c];
      if (!src || src.block !== 'choco') fail(`${where}: spread from ${pieceStr(src)}`);
      if (Math.abs(e.from.r - e.to.r) + Math.abs(e.from.c - e.to.c) !== 1) fail(`${where}: spread not to a neighbour`);
      if (!cur || cur.block || cur.special !== 'none' || cur.kind < 0 || L[e.to.r][e.to.c] || cur.id !== e.was.id) fail(`${where}: spread over ${pieceStr(cur)}`);
      if (e.piece.block !== 'choco') fail(`${where}: spread makes ${pieceStr(e.piece)}`);
      g[e.to.r][e.to.c] = { ...e.piece };
    } else fail(`${where}: unknown event type`);
    if (!e.board || !e.jelly) fail(`${where}: missing board/jelly`);
    if (e.lock && JSON.stringify(L) !== JSON.stringify(e.lock)) fail(`${where}: replayed cages differ from ev.lock`);
    if (!sameBoard(g, e.board)) fail(`${where}: replayed board differs from ev.board\nreplayed:\n${boardStr(g)}\nev.board:\n${boardStr(e.board)}`);
    if (JSON.stringify(j) !== JSON.stringify(e.jelly)) fail(`${where}: replayed jelly differs from ev.jelly`);
  });
  return { board: g, jelly: j, lock: L };
}

// a fall path: from → … → to, every step either straight down the same column, one cell diagonally down,
// or a portal jump (marked warp: true)
function checkPath(pts, from, to, where, m) {
  const f = pts[0], l = pts[pts.length - 1];
  if (!f || f.r !== from.r || f.c !== from.c || l.r !== to.r || l.c !== to.c) fail(`${where}: path ends wrong ${JSON.stringify(m)}`);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const ok = b.warp === true || (b.c === a.c && b.r > a.r) || (b.r === a.r + 1 && Math.abs(b.c - a.c) === 1);
    if (!ok) fail(`${where}: bad path step ${JSON.stringify(a)} -> ${JSON.stringify(b)} in ${JSON.stringify(m)}`);
  }
}
const CAUSES = new Set(['match', 'h', 'v', 'wrap', 'bomb', 'combo', 'fish', 'near']);
const SHAPES = new Set(['3', '4', '5', 'L', 'T', 'square']);
const SPECIALS = new Set(['none', 'h', 'v', 'wrap', 'bomb', 'fish']);

// Check one engine.swap() / sugarCrush() result against everything the contract promises.
// ctx carries state across calls: { score, maxId, gone:Set, cleared:{}, specialsMade, shuffles }
// Sugar crush: transforms (one per move left, each worth SUGAR_MOVE flat) may come before any clear,
// but never between a clear and its fall.
export const SUGAR_MOVE = 3000;
export function newCtx(engine) {
  const snap = engine.snapshot();
  let maxId = 0;
  for (const row of snap.grid) for (const p of row) if (p) maxId = Math.max(maxId, p.id);
  return { score: engine.score, maxId, gone: new Set(), cleared: { ...engine.stats.cleared }, specialsMade: engine.stats.specialsMade, shuffles: 0, moves: 0, clears: 0,
    exits: 0, spreads: 0, unlocks: 0, blockerHits: 0 };
}

export function checkResult(engine, before, res, ctx, { sugar = false } = {}) {
  const { rows, cols, mask } = before;
  const after = engine.snapshot();
  const evs = res.events;
  if (!sugar && !res.ok) {
    if (!(evs.length === 0 || (evs.length === 2 && evs[0].t === 'swap' && evs[1].t === 'swapBack'))) fail('invalid swap: bad events');
    if (!sameBoard(after.grid, before.grid)) fail('invalid swap changed the board');
    if (res.gained !== 0 || engine.score !== ctx.score) fail('invalid swap changed the score');
    if (evs.length) replayEvents(before.grid, before.jelly, evs, before.lock);
    return;
  }
  // grammar
  let i = 0;
  if (!sugar) { if (!evs.length || evs[0].t !== 'swap') fail('first event must be swap'); i = 1; }
  if (!sugar) while (i < evs.length && evs[i].t === 'transform') i++;
  let expectCascade = 1, sawClear = false;
  for (; i < evs.length; i++) {
    const e = evs[i];
    if (e.t === 'clear') {
      if (!sugar && e.cascade !== expectCascade) fail(`clear cascade ${e.cascade}, expected ${expectCascade}`);
      if (sugar && e.cascade !== 1 && e.cascade !== expectCascade) fail(`sugar clear cascade ${e.cascade}`);
      expectCascade = e.cascade + 1;
      sawClear = true;
      if (!evs[i + 1] || evs[i + 1].t !== 'fall') fail('clear not followed by fall');
    } else if (e.t === 'exit') {
      if (!evs[i + 1] || evs[i + 1].t !== 'fall') fail('exit not followed by fall');
      ctx.exits += e.cells.length;
    } else if (e.t === 'fall') {
      if (!evs[i - 1] || !['clear', 'exit', 'alarm'].includes(evs[i - 1].t)) fail('fall not preceded by clear / exit / alarm');
    } else if (e.t === 'tick') {
      // alarms count down once, after the move has settled (then maybe burst, fall and cascade)
      if (sugar || !sawClear || evs.slice(0, i).some(x => x.t === 'tick')) fail('tick must come once, after the move');
      if (evs[i - 1] && evs[i - 1].t !== 'fall') fail(`tick after ${evs[i - 1].t}`);
    } else if (e.t === 'alarm') {
      if (!evs[i - 1] || evs[i - 1].t !== 'tick') fail('alarm not preceded by tick');
      if (!evs[i + 1] || evs[i + 1].t !== 'fall') fail('alarm not followed by fall');
      ctx.alarms = (ctx.alarms || 0) + e.cells.length;
    } else if (e.t === 'spread') {
      const rest = evs.slice(i + 1).map(x => x.t).join(',');
      if (sugar || !(rest === '' || rest === 'shuffle')) fail(`spread must end the move (then maybe a shuffle), got ${rest}`);
      ctx.spreads++;
    } else if (e.t === 'shuffle') {
      if (sugar || i !== evs.length - 1) fail('shuffle must be the last event of a move');
      ctx.shuffles++;
    } else if (e.t === 'transform' && sugar) {
      // a sugar-crush move: one random normal piece becomes striped (or none if no normal piece is left)
      if (e.sugar !== true) fail('sugar transform without sugar: true');
      if (e.cells.length > 1) fail('sugar transform converts more than one piece');
      for (const x of e.cells) if (!(x.piece.special === 'h' || x.piece.special === 'v' || x.piece.special === 'wrap') || x.piece.kind < 0) fail(`sugar transform makes ${pieceStr(x.piece)}`);
      expectCascade = 1;
    } else fail(`unexpected event ${e.t} at #${i}`);
  }
  if (!sugar && !sawClear) fail('valid swap without a clear');
  // per-event shape
  let gainedSum = 0;
  for (const e of evs) {
    if (!Array.isArray(e.board) || e.board.length !== rows || e.board.some(r => r.length !== cols)) fail(`${e.t}: board shape`);
    if (!Array.isArray(e.jelly) || e.jelly.length !== rows) fail(`${e.t}: jelly shape`);
    const ids = new Set();
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const p = e.board[r][c];
      if (!mask[r][c] && p) fail(`${e.t}: piece in hole ${r},${c}`);
      if (mask[r][c] && !p && e.t !== 'clear' && e.t !== 'exit' && e.t !== 'alarm') fail(`${e.t}: empty cell ${r},${c} after ${e.t}`);
      if (p) {
        if (ids.has(p.id)) fail(`${e.t}: duplicate id ${p.id}`);
        ids.add(p.id);
        if (!SPECIALS.has(p.special) || (p.special === 'bomb') !== (p.kind === -1)) fail(`${e.t}: bad piece ${pieceStr(p)}`);
        if (ctx.gone.has(p.id)) fail(`${e.t}: removed id ${p.id} came back`);
      }
    }
    if (e.t === 'clear') {
      for (const f of ['groups', 'removed', 'effects', 'created', 'jellyHits', 'points']) if (!Array.isArray(e[f])) fail(`clear.${f} missing`);
      const seen = new Set();
      for (const f of ['unlocks', 'blockerHits']) if (e[f] && !Array.isArray(e[f])) fail(`clear.${f} not an array`);
      ctx.unlocks += (e.unlocks || []).length;
      ctx.blockerHits += (e.blockerHits || []).length;
      for (const x of [...(e.unlocks || []), ...(e.blockerHits || [])]) {
        const k = x.r * cols + x.c;
        if (seen.has(k)) fail(`clear hits ${x.r},${x.c} twice`);
        seen.add(k);
      }
      for (const x of e.removed) {
        const k = x.r * cols + x.c;
        if (seen.has(k)) fail(`clear removes ${x.r},${x.c} twice`);
        seen.add(k);
        if (!CAUSES.has(x.cause)) fail(`bad cause ${x.cause}`);
        ctx.gone.add(x.piece.id);
        if (x.piece.kind >= 0) ctx.cleared[x.piece.kind] = (ctx.cleared[x.piece.kind] || 0) + 1;
      }
      for (const g of e.groups) if (!SHAPES.has(g.shape) || !g.cells.length || typeof g.kind !== 'number') fail('bad group');
      for (const f of e.effects) {
        const okFx = (f.fx === 'line' && (f.dir === 'h' || f.dir === 'v')) || (f.fx === 'blast' && f.radius >= 1) ||
          (f.fx === 'bomb' && Array.isArray(f.targets)) || f.fx === 'board' ||
          (f.fx === 'fish' && f.to && Number.isInteger(f.to.r) && Number.isInteger(f.to.c) && [null, 'h', 'v', 'wrap'].includes(f.carry));
        if (!okFx) fail(`bad effect ${JSON.stringify(f)}`);
        if (f.reach && !(f.fx === 'line' && Array.isArray(f.reach) && f.reach.length === 2)) fail(`bad beam reach ${JSON.stringify(f)}`);
      }
      ctx.specialsMade += e.created.length;
      const pts = e.points.reduce((s, p) => s + p.value, 0);
      if (pts !== e.gained) fail(`points ${pts} != gained ${e.gained}`);
      gainedSum += e.gained;
      ctx.clears++;
    } else if (e.t === 'transform' && sugar) {
      if (e.gained !== SUGAR_MOVE) fail(`sugar transform gained ${e.gained}, expected ${SUGAR_MOVE}`);
      if (!Array.isArray(e.points)) fail('sugar transform points missing');
      const pts = e.points.reduce((s, p) => s + p.value, 0);
      if (e.cells.length ? pts !== e.gained : pts !== 0) fail(`sugar transform points ${pts} != gained ${e.gained}`);
      for (const p of e.points) if (!e.cells.some(x => x.r === p.r && x.c === p.c)) fail('sugar transform point label not on the converted cell');
      gainedSum += e.gained;
    } else if (e.gained !== undefined) fail(`${e.t} has gained`);
    if (e.t === 'exit') for (const x of e.cells) ctx.gone.add(x.piece.id);
    if (e.t === 'alarm') for (const x of e.cells) ctx.gone.add(x.piece.id);
    if (e.t === 'spread') { ctx.gone.add(e.was.id); if (e.piece.id <= ctx.maxId) fail(`spread reuses id ${e.piece.id}`); }
    if (e.t === 'fall') {
      const byCol = {};
      for (const s of e.spawns) {
        if (s.piece.id <= ctx.maxId) fail(`spawn reuses id ${s.piece.id}`);
        if (!s.path) (byCol[s.to.c] = byCol[s.to.c] || []).push(s);   // pieces that slid sideways have their own path
      }
      for (const list of Object.values(byCol)) {
        list.sort((x, y) => y.to.r - x.to.r);
        list.forEach((s, n) => { if (s.from.r !== -1 - n) fail(`spawn stacking: ${JSON.stringify(s)} n=${n}`); });
      }
    }
    for (const row of e.board) for (const p of row) if (p) ctx.maxId = Math.max(ctx.maxId, p.id);
  }
  if (gainedSum !== res.gained) fail(`gained ${res.gained} != sum of event gains ${gainedSum}`);
  // replay
  const rep = replayEvents(before.grid, before.jelly, evs, before.lock);
  if (!sameBoard(rep.board, after.grid)) fail('replay does not reach the final board');
  if (after.lock && JSON.stringify(rep.lock) !== JSON.stringify(after.lock)) fail('replay does not reach the final cages');
  if (JSON.stringify(rep.jelly) !== JSON.stringify(after.jelly)) fail('replay does not reach the final jelly');
  // final board
  const ids = new Set();
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const p = after.grid[r][c];
    if (mask[r][c] !== !!p) fail(`final board: cell/hole mismatch at ${r},${c}`);
    if (p) { if (ids.has(p.id)) fail('final board: duplicate id'); ids.add(p.id); }
  }
  if (!sugar) {
    const runs = matchesIn(after.grid);
    if (runs.length) fail(`final board still has a match ${JSON.stringify(runs[0])}\n${kindStr(after.grid)}`);
    if (!engine.hasValidMove()) fail('final board has no valid move');
  }
  // bookkeeping
  ctx.score += res.gained;
  if (engine.score !== ctx.score) fail(`score ${engine.score} != expected ${ctx.score}`);
  const st = engine.stats;
  for (const k of Object.keys(ctx.cleared)) if ((st.cleared[k] || 0) !== ctx.cleared[k]) fail(`stats.cleared[${k}] ${st.cleared[k]} != ${ctx.cleared[k]}`);
  if (st.specialsMade !== ctx.specialsMade) fail(`specialsMade ${st.specialsMade} != ${ctx.specialsMade}`);
  const jl = after.jelly.reduce((s, row) => s + row.reduce((a, b) => a + b, 0), 0);
  if (st.jellyLeft !== jl) fail(`jellyLeft ${st.jellyLeft} != ${jl}`);
  if (st.frostLeft !== undefined) {
    const cnt = { frost: 0, choco: 0, licorice: 0, dino: 0 };
    for (const row of after.grid) for (const p of row) if (p && p.block) cnt[p.block] += p.block === 'frost' ? p.hp : 1;
    const locks = after.lock ? after.lock.reduce((s, row) => s + row.reduce((a, b) => a + b, 0), 0) : 0;
    if (st.frostLeft !== cnt.frost || st.chocoLeft !== cnt.choco || st.licoriceLeft !== cnt.licorice || st.locksLeft !== locks)
      fail(`blocker stats ${JSON.stringify(st)} vs board ${JSON.stringify(cnt)} locks ${locks}`);
  }
  ctx.moves++;
}
