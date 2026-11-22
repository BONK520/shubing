// 毛絨消消樂 — board engine (docs/SPEC.md §3).
// Pure logic: no DOM, no timers, no Math.random. Same options + same calls => same results.
//
// ---------------------------------------------------------------------------------------------
// Conventions the renderer / app can rely on (all consistent with SPEC §3):
//
// * cascade / multiplier: the first `clear` of a move (the swap's own matches, or the combo) has
//   cascade = 1; the first free cascade is 2, and so on. Points of a step are multiplied by it.
// * Every event carries `board` (= snapshot().grid) and `jelly` (int[][]) AFTER that step.
//   A `clear` board still has `null` where pieces were removed; the following `fall` fills them.
// * Replaying events on the previous board reproduces each event's board exactly:
//     swap / swapBack : exchange the pieces at a and b
//     transform       : put cells[i].piece at (r, c)
//     clear           : set every removed (r, c) to null, then put every created piece at (r, c)
//     fall / shuffle  : lift every moves[i] piece from `from`, then drop all of them at `to`
//                       (simultaneously); put every spawns[i].piece at `to`
//   tests/engine.test.js checks this on thousands of random moves.
// * A new special is the matched piece in the receiving cell, transformed in place: it keeps its
//   id and is NOT in `removed` (and not counted in stats.cleared). A colour bomb gets kind -1.
//   Only if that cell held a special (which is removed and fires) does the new special get a new id.
//   A freshly created special is protected for the rest of its step (effects pass over it).
// * Jelly: every matched cell (including the receiving cell) and every removed piece hits the jelly
//   under it once per step. stats.jellyLeft = total remaining jelly LAYERS (0 => jelly goal met).
// * stats.cleared[kind] counts removed pieces per kind (colour bombs are not counted);
//   every kind in `kinds` starts at 0. stats.specialsMade counts specials created by matches.
//   stats.cascadesMax = highest `cascade` value reached by a player move (1 = no free cascade).
// * swap() with non-adjacent cells, holes or out-of-board coordinates returns
//   { ok: false, events: [], gained: 0 } (nothing to animate). An adjacent swap that makes no match
//   returns { ok: false, events: [swap, swapBack], gained: 0 }. The board is unchanged in both cases.
// * Combos are centred on b (where the piece moved from a lands); a bomb's effect is drawn from the
//   bomb's own cell. Causes in `removed`: 'match' (in a match group), 'h' | 'v' | 'wrap' | 'bomb'
//   (hit by that special's effect, including bomb targets), 'combo' (the swapped specials consumed by
//   a combo, and cells hit by a striped/wrapped combo or bomb+bomb).
// * 2×2 squares of one kind also match. A square on its own is a group of its own (shape 'square') and makes a
//   FISH (special 'fish', Candy Crush's Swedish fish). A square that touches a line group (3+ in a row) adds its other
//   cells to that group; the line decides the shape, and the special is the line's (bomb > wrap > stripe) or, when the
//   line alone makes none (a 3 with a square = 'P' shape), a fish. Swaps that only make a square are valid moves;
//   refills, the first board and shuffles avoid squares just like 3-in-a-rows.
// * Fish: when it fires it swims to ONE target and removes it (cause 'fish'). Target = a random piece on jelly; else a
//   piece of a kind the collect goal still needs (option `collect: { [kind]: count }`); else a random normal piece.
//   Effect { fx: 'fish', r, c (where it starts), to: { r, c }, carry: null | 'h' | 'v' | 'wrap' }.
//   Combos: fish + fish -> 3 fish; fish + striped / wrapped -> the fish carries that special to its target and it
//   fires there (a 'line' / 'blast' effect at the target follows the fish effect; cells it hits have cause 'combo');
//   colour bomb + fish -> every piece of the fish's kind becomes a fish, then they all fire.
// * Scoring = Candy Crush (exported as SCORE):
//     match group   3 in a row 60 · 4 in a row 120 · L / T (wrapped) 200 · 5 in a row (colour bomb) 200
//                   2×2 square on its own 120 · each square that adds cells to a line group +60
//     each piece removed by a special effect or a combo (not part of a match group) 60
//     both of the above × the step's cascade multiplier (1 for the move itself, 2 for the first free cascade, …)
//     each jelly layer removed 1,000 (no multiplier)
//     sugarCrush: each move left 3,000 (flat)
// * points[] labels: one per match group, one per firing special / combo (sum of its 60 × mult),
//   one per jelly layer (1,000); labels on the same cell are merged. sum(points) === gained.
// * findHint() / hasValidMove() never touch the PRNG, so calling them does not change the game.
//   findHint prefers combos, then bigger matches, matches that fire specials, and matches on jelly.
// * sugarCrush(n) — the end-of-level bonus (Candy Crush "Sugar Crush"), in waves of up to SUGAR_WAVE moves:
//     for each move of the wave: one `transform` event { cells: [{ r, c, piece }] (a random normal piece became
//       striped h / v, or wrapped about 1 in 4; [] if no normal piece is left), sugar: true, gained: 3000, points: [{ r, c, value: 3000 }] }
//     then one clear (cascade 1) that fires exactly the pieces this wave converted (their effects may set off
//       other specials), gravity, free cascades (cascade 2, 3, …);
//   after the last wave: rounds of "fire every special still on the board" (clear, cascade 1) + gravity /
//   cascades until no special is left. sugarCrush(0) only does that last part (used when a score level runs out
//   of moves). Sugar-crush transforms are the only events besides `clear` that carry `gained` / `points`.
//   No shuffle is appended at the end of sugarCrush.
// * addScore(n): adds n bonus points to the score (main.js lifts a completed goal level to 1 star with it).
// * Gravity (Candy Crush style): holes stop pieces. New pieces enter only at the top cell of each column (its spawner)
//   and fall inside that column's top segment. A cell that nothing can fall into from straight above (a hole above
//   it) is filled by a piece sliding diagonally from the upper-left / upper-right cell (only a piece that is resting,
//   i.e. cannot fall straight down). A cell nothing can ever reach that way gets a new piece directly.
//   fall moves / spawns carry `path` ([{ r, c }, …], first = start; spawns start above their spawner) when the piece
//   did not just fall straight down.
// * Refill colours: chosen after everything has landed, bottom-up. Option `cascadeBias` (default 0.18): that share of
//   new pieces copies the colour of a neighbour (more free cascades, Candy Crush feel). Option `antiCascade`
//   (default 0): that share avoids colours that would match at once.
// * The first board and every shuffle have at least 2 valid moves.
// * Combos also: wrapped + wrapped = 5×5 blast, then after the refill a second 5×5 blast (its own clear, cascade 2);
//   fish + striped / wrapped = 3 fish, each carrying it.
// * Board mechanics (Candy Crush blockers). Option `obstacles`: rows of characters over the board:
//     L  cage (licorice lock) on the piece there: it cannot be swapped and does not fall (it also stops what falls
//        onto it). A match through it, or any effect, breaks the cage (clear `unlocks`); the piece stays.
//     1 2 3  frosting with that many layers: fills the cell, never moves. A match next to it (up / down / left /
//        right) or an effect removes one layer (clear `blockerHits` { r, c, block, left }); at 0 it is removed.
//     C  chocolate: like 1-layer frosting. After a player move that broke no chocolate, one chocolate grows into a
//        neighbouring normal piece (event { t: 'spread', from, to, piece, was }).
//     S  licorice swirl: falls and can be swapped, never matches; removed by a match next to it or an effect.
//        It stops striped beams (the beam removes it and goes no further that way; line effects carry `reach`).
//     D  a dino (Candy Crush ingredient): falls and slides, can be swapped, cannot be matched or destroyed.
//     E  a dino exit. A dino that lands on an exit leaves the board (event { t: 'exit', cells }), then gravity.
//   Pieces of these kinds carry `block` ('frost' | 'choco' | 'licorice' | 'dino') and `hp` (frost layers);
//   kinds -4 / -5 / -6 / -3. Cages are a separate layer: every event carries `lock` (0 / 1 per cell).
//   Option `dinos: { total, onBoard = 2, rate = 0.3 }`: dinos drop in at the top until `total` have entered
//   (counting the ones on the starting board), at most `onBoard` at a time. With dinos and no E, every column's
//   bottom cell is an exit. Option `licorice: { rate, max }`: new pieces are sometimes licorice swirls.
//   Option `portals: [[r1, c1, r2, c2], …]`: what falls out of the bottom of (r1, c1) comes in at the top of
//   (r2, c2) (fall paths mark that step with `warp: true`).
//   stats also: dinosOut, dinosTotal, frostLeft (layers), chocoLeft, licoriceLeft, locksLeft.
//
// TEST-ONLY option `layout` (not part of the game API): createEngine({ kinds, layout: [rowStrings] }).
//   Each row is a list of tokens, spaces optional:  "0 1 2h 3v 4w B . ?"  ==  "012h3v4wB.?"
//     digit d  -> normal piece of global kind d        dh / dv / dw / df -> striped h / striped v / wrapped / fish
//     B or *   -> colour bomb                           .  -> hole (unless `mask` is also given)
//     ?        -> random kind from `kinds` that makes no 3-in-a-row with its neighbours
//   rows/cols default to the layout size. The layout is used as-is (it may contain matches).
// ---------------------------------------------------------------------------------------------

// Candy Crush scoring (see the header). main.js / tests read the numbers from here.
export const SCORE = Object.freeze({
  match: Object.freeze({ '3': 60, '4': 120, L: 200, T: 200, '5': 200, square: 120 }),
  squareExtra: 60,   // a 2×2 square that adds cells to a line group, × cascade multiplier
  effect: 60,        // each piece removed by a special effect / combo, × cascade multiplier
  jelly: 1000,       // each jelly layer
  sugarMove: 3000,   // each move left in sugarCrush
});
const SHAPE_POINTS = SCORE.match;
const SQUARE_EXTRA_POINTS = SCORE.squareExtra;
const EFFECT_POINTS = SCORE.effect;
// top-left corners of the four 2×2 squares a cell can be part of (offsets from the cell)
const SQ = [[0, 0], [0, -1], [-1, 0], [-1, -1]];
const JELLY_POINTS = SCORE.jelly;
const SUGAR_MOVE_POINTS = SCORE.sugarMove;
const SUGAR_WAVE = 5;      // sugarCrush converts up to this many moves, fires them, then the next wave
const NONE = 'none';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseLayout(layout) {
  return layout.map((row, r) => {
    const compact = String(row).replace(/\s+/g, '');
    const toks = compact.match(/\d[hvwf]?|[B*.?]/g) || [];
    if (toks.join('') !== compact) throw new Error(`engine: bad layout row ${r}: "${row}"`);
    return toks;
  });
}

const cp = p => (p ? (p.block ? { id: p.id, kind: p.kind, special: p.special, block: p.block, hp: p.hp } : { id: p.id, kind: p.kind, special: p.special }) : null);
const isSpecial = p => !!p && !p.block && p.special !== NONE;
// two specials, or a colour bomb with a candy; blockers (dino, licorice …) never make a combo
const isComboPair = (p, q) => !p.block && !q.block && ((isSpecial(p) && isSpecial(q)) || p.special === 'bomb' || q.special === 'bomb');
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BLOCK_KIND = { dino: -3, frost: -4, choco: -5, licorice: -6 };

export function createEngine(opts = {}) {
  const layoutToks = opts.layout ? parseLayout(opts.layout) : null;
  const rows = opts.rows ?? (layoutToks ? layoutToks.length : 8);
  const cols = opts.cols ?? (layoutToks ? Math.max(...layoutToks.map(t => t.length)) : 8);
  const kinds = Array.isArray(opts.kinds) && opts.kinds.length ? opts.kinds.slice() : [0, 1, 2, 3, 4];
  const antiCascade = opts.antiCascade ?? 0;
  const cascadeBias = opts.cascadeBias ?? 0.18;
  let biasNow = cascadeBias;            // sugarCrush turns it off (the bonus should settle, not keep chaining)
  const rng = mulberry32(opts.seed ?? 1);
  const rand = n => Math.floor(rng() * n);
  const maskIn = opts.mask || null;
  const jellyIn = opts.jelly || null;
  // collect goal { kind: count } (main.js / sim bots pass it): the fish prefers pieces the goal still needs
  const collect = opts.collect && typeof opts.collect === 'object' ? { ...opts.collect } : null;
  const obsIn = Array.isArray(opts.obstacles) ? opts.obstacles : null;
  const portalsIn = (opts.portals || []).map(q => (Array.isArray(q) ? { from: { r: q[0], c: q[1] }, to: { r: q[2], c: q[3] } } : q));
  const dinoOpt = opts.dinos && opts.dinos.total > 0 ? { total: opts.dinos.total | 0, onBoard: opts.dinos.onBoard || 2, rate: opts.dinos.rate ?? 0.3 } : null;
  const licOpt = opts.licorice && opts.licorice.rate > 0 ? { rate: opts.licorice.rate, max: opts.licorice.max ?? 4 } : null;

  // ---- state ----
  const cellMask = [];
  const grid = [];
  const jel = [];
  const lock = [], exitAt = [];
  for (let r = 0; r < rows; r++) {
    cellMask.push([]); grid.push([]); jel.push([]); lock.push(new Array(cols).fill(0)); exitAt.push(new Array(cols).fill(false));
    for (let c = 0; c < cols; c++) {
      let on;
      if (maskIn) { const ch = maskIn[r] ? maskIn[r][c] : undefined; on = ch !== undefined && ch !== '.'; }
      else if (layoutToks) { const t = layoutToks[r] ? layoutToks[r][c] : undefined; on = t !== undefined && t !== '.'; }
      else on = true;
      cellMask[r].push(on);
      grid[r].push(null);
      const j = on && jellyIn && jellyIn[r] ? parseInt(jellyIn[r][c], 10) : 0;
      jel[r].push(Number.isFinite(j) && j > 0 ? j : 0);
    }
  }
  let nextId = 1;
  let score = 0;
  const cleared = {};
  for (const k of kinds) cleared[k] = 0;
  let jellyLeft = 0;
  for (const row of jel) for (const v of row) jellyLeft += v;
  let specialsMade = 0;
  let cascadesMax = 0;
  let frostLeft = 0, chocoLeft = 0, licoriceLeft = 0, locksLeft = 0, dinosOnBoard = 0, dinosSpawned = 0, dinosOut = 0;
  let chocoBroken = 0, dinosStart = 0;

  const newPiece = (kind, special = NONE) => ({ id: nextId++, kind, special });
  const newBlock = (block, hp = 1) => ({ id: nextId++, kind: BLOCK_KIND[block], special: NONE, block, hp });
  const isCell = (r, c) => r >= 0 && r < rows && c >= 0 && c < cols && cellMask[r][c];
  const key = (r, c) => r * cols + c;
  // kind usable for matching at (r,c), or -9 (hole / empty / bomb)
  const kAt = (r, c) => {
    if (!isCell(r, c)) return -9;
    const p = grid[r][c];
    return p && p.kind >= 0 ? p.kind : -9;
  };
  const gridCopy = () => grid.map(row => row.map(cp));
  const jellyCopy = () => jel.map(row => row.slice());
  const ev = o => { o.board = gridCopy(); o.jelly = jellyCopy(); o.lock = lock.map(row => row.slice()); return o; };
  // frosting / chocolate and caged pieces never move; everything else falls
  const immovable = (r, c) => { const p = grid[r][c]; return !!lock[r][c] || (!!p && (p.block === 'frost' || p.block === 'choco')); };
  const movableAt = (r, c) => isCell(r, c) && !!grid[r][c] && !immovable(r, c);
  const canSwap = (r, c) => movableAt(r, c);
  const forCells = fn => { for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (cellMask[r][c]) fn(r, c); };

  // ---- matching ----
  function lineLens(r, c) {
    const k = kAt(r, c);
    if (k < 0) return { h: 0, v: 0 };
    let h = 1, v = 1;
    for (let x = c - 1; kAt(r, x) === k; x--) h++;
    for (let x = c + 1; kAt(r, x) === k; x++) h++;
    for (let y = r - 1; kAt(y, c) === k; y--) v++;
    for (let y = r + 1; kAt(y, c) === k; y++) v++;
    return { h, v };
  }
  // the 2×2 square of one kind that (r,c) is part of (its top-left corner), or null
  function squareOf(r, c) {
    const k = kAt(r, c);
    if (k < 0) return null;
    for (const [dy, dx] of SQ) {
      const y = r + dy, x = c + dx;
      if (kAt(y, x) === k && kAt(y, x + 1) === k && kAt(y + 1, x) === k && kAt(y + 1, x + 1) === k) return { r: y, c: x };
    }
    return null;
  }
  function matchAt(r, c) { const L = lineLens(r, c); return L.h >= 3 || L.v >= 3 || !!squareOf(r, c); }

  // would kind k at (r,c) make a 3-in-a-row or a 2×2 square with already-filled neighbours?
  function wouldMatch(r, c, k) {
    const a = (y, x) => kAt(y, x) === k;
    if ((a(r, c - 1) && (a(r, c - 2) || a(r, c + 1))) || (a(r, c + 1) && a(r, c + 2)) ||
      (a(r - 1, c) && (a(r - 2, c) || a(r + 1, c))) || (a(r + 1, c) && a(r + 2, c))) return true;
    for (const [dy, dx] of SQ) {
      const y = r + dy, x = c + dx;
      let n = 0;
      for (const [yy, xx] of [[y, x], [y, x + 1], [y + 1, x], [y + 1, x + 1]]) if ((yy !== r || xx !== c) && a(yy, xx)) n++;
      if (n === 3) return true;
    }
    return false;
  }

  function findRuns() {
    const runs = [];
    for (let r = 0; r < rows; r++) {
      let c = 0;
      while (c < cols) {
        const k = kAt(r, c);
        if (k < 0) { c++; continue; }
        let e = c + 1;
        while (kAt(r, e) === k) e++;
        if (e - c >= 3) runs.push({ dir: 'h', kind: k, r, c, len: e - c });
        c = e;
      }
    }
    for (let c = 0; c < cols; c++) {
      let r = 0;
      while (r < rows) {
        const k = kAt(r, c);
        if (k < 0) { r++; continue; }
        let e = r + 1;
        while (kAt(e, c) === k) e++;
        if (e - r >= 3) runs.push({ dir: 'v', kind: k, r, c, len: e - r });
        r = e;
      }
    }
    for (const run of runs) {
      run.cells = [];
      for (let i = 0; i < run.len; i++) run.cells.push(run.dir === 'h' ? [run.r, run.c + i] : [run.r + i, run.c]);
    }
    return runs;
  }
  function findSquares() {
    const out = [];
    for (let r = 0; r + 1 < rows; r++) for (let c = 0; c + 1 < cols; c++) {
      const k = kAt(r, c);
      if (k >= 0 && kAt(r, c + 1) === k && kAt(r + 1, c) === k && kAt(r + 1, c + 1) === k)
        out.push({ kind: k, r, c, cells: [[r, c], [r, c + 1], [r + 1, c], [r + 1, c + 1]] });
    }
    return out;
  }

  function findGroups() {
    const runs = findRuns();
    const parent = runs.map((_, i) => i);
    const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const owner = new Map();
    runs.forEach((run, i) => {
      for (const [r, c] of run.cells) {
        const k = key(r, c);
        if (owner.has(k)) parent[find(i)] = find(owner.get(k));
        else owner.set(k, i);
      }
    });
    const byRoot = new Map();
    runs.forEach((run, i) => {
      const root = find(i);
      if (!byRoot.has(root)) byRoot.set(root, { kind: run.kind, runs: [], cells: [], keys: new Set() });
      const g = byRoot.get(root);
      g.runs.push(run);
      for (const [r, c] of run.cells) {
        const k = key(r, c);
        if (!g.keys.has(k)) { g.keys.add(k); g.cells.push([r, c]); }
      }
    });
    const groups = [...byRoot.values()];
    // 2×2 squares: cells not in any line group are added to a line group the square touches (+60 each),
    // or become a square group of their own (squares never overlap without also making a 3-in-a-row)
    const ownerG = new Map();
    for (const g of groups) for (const k of g.keys) ownerG.set(k, g);
    for (const sq of findSquares()) {
      const free = sq.cells.filter(([r, c]) => !ownerG.has(key(r, c)));
      if (!free.length) continue;
      const touch = sq.cells.map(([r, c]) => ownerG.get(key(r, c))).find(Boolean);
      const g = touch || { kind: sq.kind, runs: [], cells: [], keys: new Set() };
      if (touch) g.squares = (g.squares || 0) + 1; else groups.push(g);
      for (const [r, c] of free) { const k = key(r, c); g.keys.add(k); g.cells.push([r, c]); ownerG.set(k, g); }
    }
    for (const g of groups) g.cells.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    return groups;
  }

  function classify(g) {
    if (!g.runs.length) return { shape: 'square', special: 'fish', longest: null };
    const hs = g.runs.filter(x => x.dir === 'h');
    const vs = g.runs.filter(x => x.dir === 'v');
    const longest = g.runs.reduce((m, x) => (x.len > m.len ? x : m), g.runs[0]);
    if (longest.len >= 5) return { shape: '5', special: 'bomb', longest };
    if (hs.length && vs.length) {
      const crosses = [];
      let shape = 'T';
      for (const h of hs) for (const v of vs) {
        if (v.c >= h.c && v.c < h.c + h.len && h.r >= v.r && h.r < v.r + v.len) {
          const endH = v.c === h.c || v.c === h.c + h.len - 1;
          const endV = h.r === v.r || h.r === v.r + v.len - 1;
          if (!crosses.length) shape = endH && endV ? 'L' : 'T';
          crosses.push({ r: h.r, c: v.c });
        }
      }
      return { shape, special: 'wrap', crosses, longest };
    }
    if (longest.len === 4) return { shape: '4', special: longest.dir === 'h' ? 'v' : 'h', longest };
    // a 3 in a row that also has a 2×2 square ('P' shape): the square makes a fish
    return { shape: '3', special: g.squares ? 'fish' : NONE, longest };
  }

  // receiving cell of a new special
  function placeSpecial(g, cls, swapped) {
    if (cls.special === NONE) return null;
    if (swapped) for (const s of swapped) if (g.keys.has(key(s.r, s.c))) return { r: s.r, c: s.c };
    // never into a cage: a group of only caged / special cells makes no new special
    const normal = p => grid[p.r][p.c] && grid[p.r][p.c].special === NONE && !lock[p.r][p.c];
    const free = p => !lock[p.r][p.c];
    const or = (pick, list) => { const q = pick || list.find(free); return q ? { r: q.r, c: q.c } : null; };
    if (cls.special === 'fish') {
      // the cell nearest the middle of the group (a normal piece if there is one); ties: lower, then left
      const n = g.cells.length, my = g.cells.reduce((s, x) => s + x[0], 0) / n, mx = g.cells.reduce((s, x) => s + x[1], 0) / n;
      const order = g.cells.map(([r, c]) => ({ r, c, d: Math.abs(r - my) + Math.abs(c - mx) }))
        .sort((x, y) => x.d - y.d || y.r - x.r || x.c - y.c);
      return or(order.find(normal), order);
    }
    if (cls.special === 'wrap' && cls.crosses.length) {
      const cr = cls.crosses.map(x => ({ r: x.r, c: x.c }));
      const q = or(cr.find(normal), cr);
      if (q) return q;
    }
    const run = cls.longest;
    const mid = (run.len - 1) / 2;
    const order = run.cells.map((cell, i) => ({ r: cell[0], c: cell[1], d: Math.abs(i - mid), i }))
      .sort((x, y) => x.d - y.d || x.i - y.i);
    return or(order.find(normal), order);
  }

  // ---- one clear step ----
  function newStep(cascade) {
    return { cascade, mult: cascade, done: new Set(), prot: new Set(), removed: [], effects: [], created: [],
      jellyHits: [], groups: [], pts: new Map(), queue: [], unlocks: [], blockerHits: [] };
  }
  function addPts(st, r, c, v) {
    if (!v) return;
    const k = key(r, c);
    st.pts.set(k, (st.pts.get(k) || 0) + v);
  }
  function hitJelly(st, r, c) {
    if (jel[r][c] > 0) {
      jel[r][c]--; jellyLeft--;
      st.jellyHits.push({ r, c, left: jel[r][c] });
      addPts(st, r, c, JELLY_POINTS);
    }
  }
  function countCleared(p) { if (p.kind >= 0) cleared[p.kind] = (cleared[p.kind] || 0) + 1; }
  // remove the piece at (r,c) once per step; specials fire unless noFire
  function hit(st, r, c, cause, src, noFire = false) {
    if (!isCell(r, c)) return false;
    const k = key(r, c);
    if (st.done.has(k) || st.prot.has(k)) return false;
    const p = grid[r][c];
    if (lock[r][c]) {
      // cage: it breaks, the piece inside stays (a match through it also counts for the jelly under it)
      st.done.add(k);
      lock[r][c] = 0; locksLeft--;
      st.unlocks.push({ r, c });
      hitJelly(st, r, c);
      if (cause !== 'match') addPts(st, src.r, src.c, EFFECT_POINTS * st.mult);
      return true;
    }
    if (!p) return false;
    if (p.block === 'dino') return false;                 // dinos cannot be destroyed
    if (p.block === 'frost' && p.hp > 1) {
      st.done.add(k);
      p.hp--; frostLeft--;
      st.blockerHits.push({ r, c, block: 'frost', left: p.hp });
      addPts(st, src.r, src.c, EFFECT_POINTS * st.mult);
      return true;
    }
    if (p.block) {
      st.done.add(k);
      grid[r][c] = null;
      if (p.block === 'frost') frostLeft--;
      else if (p.block === 'choco') { chocoLeft--; chocoBroken++; }
      else if (p.block === 'licorice') licoriceLeft--;
      st.removed.push({ r, c, piece: cp(p), cause });
      hitJelly(st, r, c);
      addPts(st, src.r, src.c, EFFECT_POINTS * st.mult);
      return true;
    }
    st.done.add(k);
    grid[r][c] = null;
    st.removed.push({ r, c, piece: cp(p), cause });
    countCleared(p);
    hitJelly(st, r, c);
    if (cause !== 'match') addPts(st, src.r, src.c, EFFECT_POINTS * st.mult);
    if (p.special !== NONE && !noFire) st.queue.push({ r, c, special: p.special });
    return true;
  }
  // a beam both ways from (r, c), one cell at a time each way (the same order as always); a licorice swirl
  // is removed and stops the beam on that side. Returns how far each side reached (row or column index)
  // when a swirl stopped it, else null.
  function hitBeam(st, r, c, dr, dc, cause, src) {
    hit(st, r, c, cause, src);
    const reach = [dr ? r : c, dr ? r : c], open = [true, true];
    let cut = false;
    for (let d = 1; open[0] || open[1]; d++) {
      for (let s = 0; s < 2; s++) {
        if (!open[s]) continue;
        const sg = s ? 1 : -1, y = r + dr * d * sg, x = c + dc * d * sg;
        if (y < 0 || y >= rows || x < 0 || x >= cols) { open[s] = false; continue; }
        reach[s] = dr ? y : x;
        const p = isCell(y, x) ? grid[y][x] : null;
        const stop = !!p && p.block === 'licorice' && !st.done.has(key(y, x));
        hit(st, y, x, cause, src);
        if (stop) { open[s] = false; cut = true; }
      }
    }
    return cut ? reach : null;
  }
  const hitRow = (st, r, c, cause, src) => hitBeam(st, r, c, 0, 1, cause, src);
  const hitCol = (st, r, c, cause, src) => hitBeam(st, r, c, 1, 0, cause, src);
  // frosting / chocolate / licorice next to a matched cell lose a layer (once per step each)
  function hitNear(st, cells) {
    for (const [r, c] of cells) for (const [dr, dc] of DIRS) {
      const y = r + dr, x = c + dc;
      if (!isCell(y, x)) continue;
      const q = grid[y][x];
      if (q && (q.block === 'frost' || q.block === 'choco' || q.block === 'licorice')) hit(st, y, x, 'near', { r, c });
    }
  }
  function hitSquare(st, r, c, rad, cause, src) {
    for (let d = 0; d <= rad; d++)
      for (let y = r - d; y <= r + d; y++)
        for (let x = c - d; x <= c + d; x++)
          if (Math.max(Math.abs(y - r), Math.abs(x - c)) === d) hit(st, y, x, cause, src);
  }
  function commonKind(st) {
    const n = new Map();
    forCells((r, c) => {
      const p = grid[r][c];
      if (p && p.kind >= 0 && !st.prot.has(key(r, c))) n.set(p.kind, (n.get(p.kind) || 0) + 1);
    });
    let best = null, bestN = 0;
    const order = [...kinds, ...[...n.keys()].filter(k => !kinds.includes(k)).sort((a, b) => a - b)];
    for (const k of order) if ((n.get(k) || 0) > bestN) { best = k; bestN = n.get(k); }
    return best;
  }
  function cellsOfKind(k, st) {
    const out = [];
    forCells((r, c) => {
      const p = grid[r][c];
      if (p && p.kind === k && !st.prot.has(key(r, c))) out.push({ r, c });
    });
    return out;
  }
  // fish target: a piece on jelly; else a piece the collect goal still needs; else a normal piece; else any piece
  function fishTarget(st, src) {
    const tiers = [[], [], [], [], [], []];
    forCells((r, c) => {
      const p = grid[r][c], k = key(r, c);
      if (!p || p.block === 'dino' || st.done.has(k) || st.prot.has(k) || (r === src.r && c === src.c)) return;
      const underDino = r > 0 && grid[r - 1][c] && grid[r - 1][c].block === 'dino';
      if (jel[r][c] > 0) tiers[0].push({ r, c });
      else if (collect && p.kind >= 0 && collect[p.kind] > (cleared[p.kind] || 0)) tiers[1].push({ r, c });
      else if (underDino) tiers[2].push({ r, c });                       // clear the way for a dino
      else if (p.block || lock[r][c]) tiers[3].push({ r, c });            // frosting, chocolate, licorice, cages
      else if (p.special === NONE) tiers[4].push({ r, c });
      else tiers[5].push({ r, c });
    });
    const t = tiers.find(x => x.length);
    return t ? t[rand(t.length)] : null;
  }
  // n fish swim from src; each removes its target (carry: a special it brings along that fires there)
  function launchFish(st, src, n, carry = null) {
    for (let i = 0; i < n; i++) {
      const t = fishTarget(st, src);
      if (!t) return;
      st.effects.push({ fx: 'fish', r: src.r, c: src.c, to: { r: t.r, c: t.c }, carry });
      hit(st, t.r, t.c, 'fish', src);
      if (carry === 'h' || carry === 'v') {
        const f = { fx: 'line', dir: carry, r: t.r, c: t.c };
        st.effects.push(f);
        const rc = carry === 'h' ? hitRow(st, t.r, t.c, 'combo', t) : hitCol(st, t.r, t.c, 'combo', t);
        if (rc) f.reach = rc;
      } else if (carry === 'wrap') {
        st.effects.push({ fx: 'blast', r: t.r, c: t.c, radius: 1 });
        hitSquare(st, t.r, t.c, 1, 'combo', t);
      }
    }
  }
  function runQueue(st) {
    while (st.queue.length) {
      const { r, c, special } = st.queue.shift();
      const src = { r, c };
      if (special === 'fish') launchFish(st, src, 1);
      else if (special === 'h') { const f = { fx: 'line', dir: 'h', r, c }; st.effects.push(f); const rc = hitRow(st, r, c, 'h', src); if (rc) f.reach = rc; }
      else if (special === 'v') { const f = { fx: 'line', dir: 'v', r, c }; st.effects.push(f); const rc = hitCol(st, r, c, 'v', src); if (rc) f.reach = rc; }
      else if (special === 'wrap') { st.effects.push({ fx: 'blast', r, c, radius: 1 }); hitSquare(st, r, c, 1, 'wrap', src); }
      else if (special === 'bomb') {
        const k = commonKind(st);
        const targets = k === null ? [] : cellsOfKind(k, st);
        st.effects.push({ fx: 'bomb', r, c, targets: targets.map(t => ({ ...t })) });
        for (const t of targets) hit(st, t.r, t.c, 'bomb', src);
      }
    }
  }
  function finishStep(st) {
    const points = [];
    let gained = 0;
    for (const [k, value] of st.pts) { points.push({ r: Math.floor(k / cols), c: k % cols, value }); gained += value; }
    return ev({ t: 'clear', cascade: st.cascade, groups: st.groups, removed: st.removed, effects: st.effects,
      created: st.created, jellyHits: st.jellyHits, unlocks: st.unlocks, blockerHits: st.blockerHits, points, gained });
  }

  function matchStep(groups, cascade, swapped) {
    const st = newStep(cascade);
    const plans = groups.map(g => { const cls = classify(g); return { g, cls, at: placeSpecial(g, cls, swapped) }; });
    for (const { g, cls, at } of plans) {
      st.groups.push({ kind: g.kind, shape: cls.shape, cells: g.cells.map(([r, c]) => ({ r, c })) });
      const label = at || { r: g.cells[g.cells.length >> 1][0], c: g.cells[g.cells.length >> 1][1] };
      addPts(st, label.r, label.c, (SHAPE_POINTS[cls.shape] + (g.squares || 0) * SQUARE_EXTRA_POINTS) * st.mult);
      if (at) st.prot.add(key(at.r, at.c));
    }
    for (const { g, at } of plans)
      for (const [r, c] of g.cells) if (!at || at.r !== r || at.c !== c) hit(st, r, c, 'match');
    for (const { g } of plans) hitNear(st, g.cells);
    for (const { g, cls, at } of plans) {
      if (!at) continue;
      const { r, c } = at;
      const p = grid[r][c];
      st.done.add(key(r, c));
      hitJelly(st, r, c);
      let np;
      if (p && p.special === NONE) {
        p.special = cls.special;
        if (cls.special === 'bomb') p.kind = -1;
        np = p;
      } else {
        if (p) {
          st.removed.push({ r, c, piece: cp(p), cause: 'match' });
          countCleared(p);
          st.queue.push({ r, c, special: p.special });
        }
        np = newPiece(cls.special === 'bomb' ? -1 : g.kind, cls.special);
        grid[r][c] = np;
      }
      st.created.push({ r, c, piece: cp(np) });
      specialsMade++;
    }
    runQueue(st);
    return finishStep(st);
  }

  // swap already applied: grid[b] holds the piece that came from a
  function comboSteps(a, b, events) {
    const pa = grid[a.r][a.c], pb = grid[b.r][b.c];
    const st = newStep(1);
    let again = null;
    const center = { r: b.r, c: b.c };
    if (pa.special === 'bomb' && pb.special === 'bomb') {
      hit(st, a.r, a.c, 'combo', center, true);
      hit(st, b.r, b.c, 'combo', center, true);
      st.effects.push({ fx: 'board' });
      forCells((r, c) => hit(st, r, c, 'combo', center, true));
    } else if (pa.special === 'bomb' || pb.special === 'bomb') {
      const bombAt = pa.special === 'bomb' ? { r: a.r, c: a.c } : { r: b.r, c: b.c };
      const other = pa.special === 'bomb' ? pb : pa;
      const K = other.kind;
      if (other.special !== NONE) {
        const cells = [];
        forCells((r, c) => {
          const p = grid[r][c];
          if (p && p.kind === K && p.special === NONE && !lock[r][c]) {
            p.special = other.special === 'wrap' || other.special === 'fish' ? other.special : rng() < 0.5 ? 'h' : 'v';
            cells.push({ r, c, piece: cp(p) });
          }
        });
        if (cells.length) events.push(ev({ t: 'transform', cells }));
      }
      hit(st, bombAt.r, bombAt.c, 'combo', center, true);
      const targets = cellsOfKind(K, st);
      st.effects.push({ fx: 'bomb', r: bombAt.r, c: bombAt.c, targets: targets.map(t => ({ ...t })) });
      for (const t of targets) hit(st, t.r, t.c, 'bomb', bombAt);
    } else if (pa.special === 'fish' || pb.special === 'fish') {
      // fish + fish: three fish; fish + striped / wrapped: the fish carries the other special to its target
      const other = pa.special === 'fish' ? pb.special : pa.special;
      hit(st, a.r, a.c, 'combo', center, true);
      hit(st, b.r, b.c, 'combo', center, true);
      if (other === 'fish') launchFish(st, center, 3);
      else launchFish(st, center, 3, other);           // 3 隻強化的飛天玩偶，各自帶著條紋 / 包裝飛過去
    } else {
      const stripes = [pa.special, pb.special].filter(s => s === 'h' || s === 'v').length;
      hit(st, a.r, a.c, 'combo', center, true);
      hit(st, b.r, b.c, 'combo', center, true);
      if (stripes === 2) {
        const fh = { fx: 'line', dir: 'h', r: center.r, c: center.c }, fv = { fx: 'line', dir: 'v', r: center.r, c: center.c };
        st.effects.push(fh, fv);
        const rh = hitRow(st, center.r, center.c, 'combo', center), rv = hitCol(st, center.r, center.c, 'combo', center);
        if (rh) fh.reach = rh;
        if (rv) fv.reach = rv;
      } else if (stripes === 1) {
        const fx = { h: [], v: [] };
        for (let d = -1; d <= 1; d++) if (center.r + d >= 0 && center.r + d < rows) {
          const f = { fx: 'line', dir: 'h', r: center.r + d, c: center.c }; st.effects.push(f); fx.h[d + 1] = f;
        }
        for (let d = -1; d <= 1; d++) if (center.c + d >= 0 && center.c + d < cols) {
          const f = { fx: 'line', dir: 'v', r: center.r, c: center.c + d }; st.effects.push(f); fx.v[d + 1] = f;
        }
        for (let d = -1; d <= 1; d++) {
          if (fx.h[d + 1]) { const rc = hitRow(st, center.r + d, center.c, 'combo', center); if (rc) fx.h[d + 1].reach = rc; }
          if (fx.v[d + 1]) { const rc = hitCol(st, center.r, center.c + d, 'combo', center); if (rc) fx.v[d + 1].reach = rc; }
        }
      } else {
        st.effects.push({ fx: 'blast', r: center.r, c: center.c, radius: 2 });
        hitSquare(st, center.r, center.c, 2, 'combo', center);
        again = center;
      }
    }
    runQueue(st);
    events.push(finishStep(st));
    return again;
  }
  // wrapped + wrapped: after the refill, the same 5×5 blast once more
  function secondBlast(center, events, cascade) {
    const st = newStep(cascade);
    st.effects.push({ fx: 'blast', r: center.r, c: center.c, radius: 2 });
    hitSquare(st, center.r, center.c, 2, 'combo', center);
    runQueue(st);
    events.push(finishStep(st));
  }
  // a player combo: the combo itself, the refill, and (wrapped + wrapped) the second blast; returns the next cascade
  function playCombo(a, b, events) {
    const again = comboSteps(a, b, events);
    fall(events);
    if (!again) return 2;
    secondBlast(again, events, 2);
    fall(events);
    return 3;
  }

  // ---- gravity + refill ----
  // spawner of each column = its top cell; new pieces only enter there
  const spawnRow = [];
  for (let c = 0; c < cols; c++) { let r = 0; while (r < rows && !cellMask[r][c]) r++; spawnRow.push(r < rows ? r : -1); }
  // gravity graph: what a cell falls into (a portal sends the bottom of one column to the top of another)
  const portalOut = new Map(), portalIn = new Map();
  for (const q of portalsIn) if (isCell(q.from.r, q.from.c) && isCell(q.to.r, q.to.c)) {
    portalOut.set(key(q.from.r, q.from.c), { r: q.to.r, c: q.to.c });
    portalIn.set(key(q.to.r, q.to.c), { r: q.from.r, c: q.from.c });
  }
  // (a portal exit is fed only by its portal, not by the cell above it)
  const below = (r, c) => portalOut.get(key(r, c)) || (isCell(r + 1, c) && !portalIn.has(key(r + 1, c)) ? { r: r + 1, c } : null);
  const above = (r, c) => portalIn.get(key(r, c)) || (isCell(r - 1, c) && !portalOut.has(key(r - 1, c)) ? { r: r - 1, c } : null);
  // chains: from a cell nothing falls into, following `below` (each cell is in exactly one chain)
  const chains = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (!cellMask[r][c] || above(r, c)) continue;
    const ch = [], seen = new Set();
    for (let q = { r, c }; q && !seen.has(key(q.r, q.c)); q = below(q.r, q.c)) { seen.add(key(q.r, q.c)); ch.push(q); }
    chains.push(ch);
  }
  // column by column, the lower part of a column first
  chains.sort((x, y) => x[0].c - y[0].c || y[0].r - x[0].r);
  const isSpawner = q => q.r === spawnRow[q.c] && !above(q.r, q.c);
  function pickKind(r, c) {
    if (antiCascade > 0 && rng() < antiCascade) {
      const safe = kinds.filter(k => !wouldMatch(r, c, k));
      if (safe.length) return safe[rand(safe.length)];
    }
    if (biasNow > 0 && rng() < biasNow) {
      // 爽感輔助：照旁邊已經有的顏色（下、左、右、上），比較容易接著連消
      const nb = [];
      for (const [dr, dc] of [[1, 0], [0, -1], [0, 1], [-1, 0]]) { const k = kAt(r + dr, c + dc); if (k >= 0 && kinds.includes(k)) nb.push(k); }
      if (nb.length) return nb[rand(nb.length)];
    }
    return kinds[rand(kinds.length)];
  }
  function fall(events) {
    const paths = new Map(), starts = new Map(), spawned = [], count = new Array(cols).fill(0);
    // walk a piece from ch[y] to ch[w] (marking portal jumps), recording the path
    const walk = (t, ch, y, w) => {
      for (let i = y + 1; i <= w; i++) {
        const a = ch[i - 1], b = ch[i];
        if (b.c === a.c && b.r === a.r + 1) continue;
        const last = t[t.length - 1];
        if (last.r !== a.r || last.c !== a.c) t.push({ r: a.r, c: a.c });
        t.push({ r: b.r, c: b.c, warp: true });
      }
      const to = ch[w], last = t[t.length - 1];
      if (last.r !== to.r || last.c !== to.c) t.push({ r: to.r, c: to.c });
    };
    const move = (q, ch, y, w) => {
      const from = ch[y], to = ch[w];
      if (!paths.has(q)) { paths.set(q, [{ r: from.r, c: from.c }]); starts.set(q, { r: from.r, c: from.c }); }
      walk(paths.get(q), ch, y, w);
      grid[to.r][to.c] = q; grid[from.r][from.c] = null;
    };
    const spawnInto = (ch, y) => {
      const head = ch[0], j = count[head.c]++;
      const p = newPiece(-2);                         // colour chosen after everything has landed
      const t = [{ r: head.r - 1 - j, c: head.c }];
      walk(t, ch, 0, y);
      grid[ch[y].r][ch[y].c] = p;
      paths.set(p, t);
      spawned.push({ p, c: head.c, j });
    };
    // gravity along every chain; frosting, chocolate and cages split a chain (nothing passes them)
    function settleColumns() {
      let moved = false;
      for (const ch of chains) {
        let i = ch.length - 1;
        while (i >= 0) {
          if (immovable(ch[i].r, ch[i].c)) { i--; continue; }
          let top = i;
          while (top - 1 >= 0 && !immovable(ch[top - 1].r, ch[top - 1].c)) top--;
          let w = i;
          for (let y = i; y >= top; y--) {
            const q = grid[ch[y].r][ch[y].c];
            if (!q) continue;
            if (y !== w) { move(q, ch, y, w); moved = true; }
            w--;
          }
          if (top === 0 && isSpawner(ch[0])) for (let y = w; y >= top; y--) { spawnInto(ch, y); moved = true; }
          i = top - 1;
        }
      }
      return moved;
    }
    // a cell nothing can fall into from straight above (hole, frosting, chocolate or a cage above it):
    // a resting piece slides in from the upper-left / upper-right
    function slideOne() {
      for (let r = rows - 1; r >= 1; r--) for (let c = 0; c < cols; c++) {
        if (!cellMask[r][c] || grid[r][c]) continue;
        const up = above(r, c);
        if (up && !immovable(up.r, up.c)) continue;
        const order = (r + c) % 2 ? [-1, 1] : [1, -1];
        for (const d of order) {
          const sc = c + d;
          if (!movableAt(r - 1, sc)) continue;
          const bl = below(r - 1, sc);
          if (bl && !grid[bl.r][bl.c] && !immovable(bl.r, bl.c)) continue;   // that piece can still fall straight down
          const q = grid[r - 1][sc];
          if (!paths.has(q)) { paths.set(q, [{ r: r - 1, c: sc }]); starts.set(q, { r: r - 1, c: sc }); }
          paths.get(q).push({ r, c });
          grid[r][c] = q; grid[r - 1][sc] = null;
          return true;
        }
      }
      return false;
    }
    for (let guard = 0; guard < 4000; guard++) {
      if (settleColumns()) continue;
      if (slideOne()) continue;
      // nothing can reach a cell any more: a new piece appears there directly (dropping in from above it)
      let filled = false;
      forCells((r, c) => {
        if (filled || grid[r][c]) return;
        const j = count[c]++;
        const p = newPiece(-2);
        let top = r;
        while (top - 1 >= 0 && cellMask[top - 1][c]) top--;
        grid[r][c] = p;
        paths.set(p, [{ r: top - 1 - j, c }, { r, c }]);
        spawned.push({ p, c, j });
        filled = true;
      });
      if (!filled) break;
    }
    // colours of the new pieces, bottom-up (so the cascade-friendly refill sees what is below)
    const fresh = spawned.map(sp => ({ sp, at: paths.get(sp.p)[paths.get(sp.p).length - 1] }))
      .sort((x, y) => y.at.r - x.at.r || x.at.c - y.at.c);
    // a dino drops in at the top while the goal still needs more (the highest new piece becomes one)
    if (dinoOpt && fresh.length && dinosSpawned < dinoOpt.total && dinosOnBoard < dinoOpt.onBoard && rng() < dinoOpt.rate) {
      const top = fresh.reduce((m, x) => (x.at.r < m.at.r ? x : m), fresh[0]);
      Object.assign(top.sp.p, { kind: BLOCK_KIND.dino, block: 'dino', hp: 0 });
      dinosSpawned++; dinosOnBoard++;
    }
    for (const { sp, at } of fresh) {
      if (sp.p.block) continue;
      if (licOpt && licoriceLeft < licOpt.max && rng() < licOpt.rate) { Object.assign(sp.p, { kind: BLOCK_KIND.licorice, block: 'licorice', hp: 1 }); licoriceLeft++; continue; }
      sp.p.kind = pickKind(at.r, at.c);
    }
    const straight = pts => pts.every(q => q.c === pts[0].c && !q.warp);
    const moves = [], spawns = [];
    for (const [p, pts] of paths) {
      if (spawned.some(sp => sp.p === p)) continue;
      const to = pts[pts.length - 1], from = starts.get(p);
      if (from.r === to.r && from.c === to.c) continue;
      const m = { id: p.id, from: { ...from }, to: { ...to } };
      if (!straight(pts)) m.path = pts.map(q => ({ ...q }));
      moves.push(m);
    }
    // pieces that stayed in their column stack above it -1, -2, … (lowest first); ones that slid sideways keep their path
    const stack = new Array(cols).fill(0);
    const order = spawned.slice().sort((x, y) => {
      const a = paths.get(x.p), b = paths.get(y.p);
      return b[b.length - 1].r - a[a.length - 1].r;
    });
    for (const sp of order) {
      const pts = paths.get(sp.p), to = pts[pts.length - 1];
      const o = { piece: cp(sp.p), from: { r: -1 - sp.j, c: sp.c }, to: { ...to } };
      if (!straight(pts)) o.path = pts.map(q => ({ ...q }));
      else o.from.r = -1 - stack[sp.c]++;
      spawns.push(o);
    }
    spawns.sort((x, y) => y.to.r - x.to.r || x.to.c - y.to.c);
    if (moves.length || spawns.length) events.push(ev({ t: 'fall', moves, spawns }));
  }

  // dinos standing on an exit leave the board
  function collectDinos(events) {
    const cells = [];
    forCells((r, c) => {
      const p = grid[r][c];
      if (p && p.block === 'dino' && exitAt[r][c]) { cells.push({ r, c, piece: cp(p) }); grid[r][c] = null; dinosOnBoard--; dinosOut++; }
    });
    if (!cells.length) return false;
    events.push(ev({ t: 'exit', cells }));
    return true;
  }
  // after a move that broke no chocolate: one chocolate grows into a neighbouring normal piece
  function spreadChoco(events) {
    const cand = [];
    forCells((r, c) => {
      const p = grid[r][c];
      if (!p || p.block !== 'choco') return;
      for (const [dr, dc] of DIRS) {
        const y = r + dr, x = c + dc;
        if (!isCell(y, x) || lock[y][x]) continue;
        const q = grid[y][x];
        if (q && !q.block && q.kind >= 0 && q.special === NONE) cand.push({ from: { r, c }, to: { r: y, c: x } });
      }
    });
    if (!cand.length) return;
    const pick = cand[rand(cand.length)], was = grid[pick.to.r][pick.to.c], np = newBlock('choco', 1);
    grid[pick.to.r][pick.to.c] = np;
    chocoLeft++;
    events.push(ev({ t: 'spread', from: pick.from, to: pick.to, piece: cp(np), was: cp(was) }));
  }

  // matches -> clear -> fall, repeated (dinos on exits leave first); returns the last cascade number used
  function settle(events, cascade, swapped) {
    let last = cascade - 1;
    for (let guard = 0; guard < 200; guard++) {
      if (collectDinos(events)) { fall(events); continue; }
      const groups = findGroups();
      if (!groups.length) break;
      events.push(matchStep(groups, cascade, swapped));
      swapped = null;
      fall(events);
      last = cascade++;
    }
    return last;
  }

  // ---- moves ----
  function pairValid(r1, c1, r2, c2) {
    const p = grid[r1][c1], q = grid[r2][c2];
    if (!p || !q || !canSwap(r1, c1) || !canSwap(r2, c2)) return false;
    if (isComboPair(p, q)) return true;
    grid[r1][c1] = q; grid[r2][c2] = p;
    const ok = matchAt(r1, c1) || matchAt(r2, c2);
    grid[r1][c1] = p; grid[r2][c2] = q;
    return ok;
  }
  function validMoves(limit = 1) {
    let n = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (!cellMask[r][c]) continue;
      if (isCell(r, c + 1) && pairValid(r, c, r, c + 1) && ++n >= limit) return n;
      if (isCell(r + 1, c) && pairValid(r, c, r + 1, c) && ++n >= limit) return n;
    }
    return n;
  }
  function hasValidMove() { return validMoves(1) >= 1; }
  const COMBO_VALUE = { 'bomb+bomb': 1000, 'bomb+wrap': 900, 'bomb+h': 850, 'bomb+v': 850, 'bomb+fish': 800, 'wrap+wrap': 700,
    'h+wrap': 650, 'v+wrap': 650, 'h+h': 600, 'h+v': 600, 'v+v': 600,
    'fish+wrap': 580, 'fish+h': 560, 'fish+v': 560, 'fish+fish': 540 };
  function cellValue(r, c) {
    const { h, v } = lineLens(r, c);
    const sq = squareOf(r, c);
    // specials in the match fire (+40); cells on jelly help the jelly goal (+35)
    const sp = (y, x) => (grid[y][x].special !== NONE ? 40 : 0) + (jel[y][x] > 0 ? 35 : 0);
    const sqPart = () => {           // the square's other three cells
      let s = 0;
      for (const [y, x] of [[sq.r, sq.c], [sq.r, sq.c + 1], [sq.r + 1, sq.c], [sq.r + 1, sq.c + 1]]) if (y !== r || x !== c) s += sp(y, x);
      return s;
    };
    if (h < 3 && v < 3) return sq ? 140 + sqPart() + sp(r, c) : 0;    // 2×2 on its own makes a fish: almost a 4
    let s = h >= 5 || v >= 5 ? 300 : h >= 3 && v >= 3 ? 200 : h === 4 || v === 4 ? 150 : 100;
    s += (h >= 3 ? h : 0) + (v >= 3 ? v : 0);
    if (sq) s += 20;
    const k = kAt(r, c);
    if (h >= 3) {
      for (let x = c - 1; kAt(r, x) === k; x--) s += sp(r, x);
      for (let x = c + 1; kAt(r, x) === k; x++) s += sp(r, x);
    }
    if (v >= 3) {
      for (let y = r - 1; kAt(y, c) === k; y--) s += sp(y, c);
      for (let y = r + 1; kAt(y, c) === k; y++) s += sp(y, c);
    }
    return s + sp(r, c);
  }
  function swapValue(r1, c1, r2, c2) {
    const p = grid[r1][c1], q = grid[r2][c2];
    if (!p || !q || !canSwap(r1, c1) || !canSwap(r2, c2)) return -1;
    if (isComboPair(p, q)) {
      if (p.special !== NONE && q.special !== NONE) return COMBO_VALUE[[p.special, q.special].sort().join('+')] || 600;
      const other = p.special === 'bomb' ? q : p;
      let n = 0;
      forCells((r, c) => { if (grid[r][c] && grid[r][c].kind === other.kind) n++; });
      return 400 + n;
    }
    grid[r1][c1] = q; grid[r2][c2] = p;
    const v = cellValue(r1, c1) + cellValue(r2, c2);
    grid[r1][c1] = p; grid[r2][c2] = q;
    return v > 0 ? v : -1;
  }
  function findHint() {
    let best = null, bestV = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (!cellMask[r][c]) continue;
      for (const [dr, dc] of [[0, 1], [1, 0]]) {
        const r2 = r + dr, c2 = c + dc;
        if (!isCell(r2, c2)) continue;
        const v = swapValue(r, c, r2, c2);
        if (v > bestV) { bestV = v; best = { a: { r, c }, b: { r: r2, c: c2 } }; }
      }
    }
    return best;
  }

  // stable (no match yet) and at least `need` valid moves (shuffles and the first board want 2)
  function stableAndPlayable(need = 2) { return !findRuns().length && !findSquares().length && validMoves(need) >= need; }

  function shuffleInternal() {
    const cells = [];
    forCells((r, c) => { const p = grid[r][c]; if (p && !p.block && !lock[r][c]) cells.push([r, c]); });
    const pieces = [];
    const from = new Map();
    for (const [r, c] of cells) { const p = grid[r][c]; if (p) { pieces.push(p); from.set(p.id, { r, c }); } }
    let ok = false;
    for (let attempt = 0; attempt < 80 && !ok; attempt++) {
      const pool = pieces.slice();
      for (let i = pool.length - 1; i > 0; i--) { const j = rand(i + 1); [pool[i], pool[j]] = [pool[j], pool[i]]; }
      for (const [r, c] of cells) grid[r][c] = null;
      for (const [r, c] of cells) {
        if (!pool.length) break;
        let idx = pool.findIndex(p => p.kind < 0 || !wouldMatch(r, c, p.kind));
        if (idx < 0) idx = 0;
        grid[r][c] = pool.splice(idx, 1)[0];
      }
      ok = stableAndPlayable();
    }
    // last resort: keep ids/positions/specials, re-roll the kinds of normal pieces
    for (let attempt = 0; attempt < 200 && !ok; attempt++) {
      const normals = cells.filter(([r, c]) => grid[r][c] && grid[r][c].special === NONE);
      const saved = normals.map(([r, c]) => grid[r][c]);
      for (const [r, c] of normals) grid[r][c] = null;
      normals.forEach(([r, c], i) => {
        const safe = kinds.filter(k => !wouldMatch(r, c, k));
        saved[i].kind = safe.length ? safe[rand(safe.length)] : kinds[rand(kinds.length)];
        grid[r][c] = saved[i];
      });
      ok = stableAndPlayable(attempt < 150 ? 2 : 1);
    }
    const moves = [];
    // piece = the piece after the shuffle (the last resort may have changed its kind)
    for (const [r, c] of cells) { const p = grid[r][c]; if (p) moves.push({ id: p.id, from: { ...from.get(p.id) }, to: { r, c }, piece: { ...p } }); }
    return ev({ t: 'shuffle', moves });
  }

  // ---- obstacles (applied over the starting pieces) ----
  function applyObstacles() {
    if (obsIn) forCells((r, c) => {
      const ch = obsIn[r] ? obsIn[r][c] : undefined;
      if (!ch || ch === '.') return;
      if (ch === 'L') { lock[r][c] = 1; const p = grid[r][c]; if (p && (p.block || p.special !== NONE)) grid[r][c] = newPiece(kinds[rand(kinds.length)]); return; }
      if (ch === 'E') { exitAt[r][c] = true; return; }
      if (ch >= '1' && ch <= '3') grid[r][c] = newBlock('frost', +ch);
      else if (ch === 'C') grid[r][c] = newBlock('choco', 1);
      else if (ch === 'S') grid[r][c] = newBlock('licorice', 1);
      else if (ch === 'D') grid[r][c] = newBlock('dino', 0);
    });
    frostLeft = chocoLeft = licoriceLeft = locksLeft = dinosOnBoard = 0;
    forCells((r, c) => {
      const p = grid[r][c];
      if (lock[r][c]) locksLeft++;
      if (!p || !p.block) return;
      if (p.block === 'frost') frostLeft += p.hp;
      else if (p.block === 'choco') chocoLeft++;
      else if (p.block === 'licorice') licoriceLeft++;
      else if (p.block === 'dino') dinosOnBoard++;
    });
    dinosSpawned = dinosStart = dinosOnBoard;
    // dinos but no exit given: the bottom cell of every column is an exit (not a portal entrance: dinos go through those)
    if ((dinoOpt || dinosOnBoard) && !exitAt.some(row => row.some(Boolean)))
      for (let c = 0; c < cols; c++) {
        let r = rows - 1;
        while (r >= 0 && !cellMask[r][c]) r--;
        if (r >= 0 && !portalOut.has(key(r, c))) exitAt[r][c] = true;
      }
  }
  const clearObstacles = () => { for (const row of lock) row.fill(0); for (const row of exitAt) row.fill(false); };

  // ---- initial board ----
  if (layoutToks) {
    const later = [];
    forCells((r, c) => {
      const t = (layoutToks[r] && layoutToks[r][c]) || '?';
      if (t === '?' || t === '.') { later.push([r, c]); return; }
      if (t === 'B' || t === '*') { grid[r][c] = newPiece(-1, 'bomb'); return; }
      const sp = t[1] === 'h' ? 'h' : t[1] === 'v' ? 'v' : t[1] === 'w' ? 'wrap' : t[1] === 'f' ? 'fish' : NONE;
      grid[r][c] = newPiece(parseInt(t[0], 10), sp);
    });
    for (const [r, c] of later) {
      const safe = kinds.filter(k => !wouldMatch(r, c, k));
      grid[r][c] = newPiece(safe.length ? safe[rand(safe.length)] : kinds[rand(kinds.length)]);
    }
    applyObstacles();
  } else {
    for (let attempt = 0; attempt < 300; attempt++) {
      nextId = 1;
      clearObstacles();
      forCells((r, c) => { grid[r][c] = null; });
      forCells((r, c) => {
        const safe = kinds.filter(k => !wouldMatch(r, c, k));
        grid[r][c] = newPiece(safe.length ? safe[rand(safe.length)] : kinds[rand(kinds.length)]);
      });
      applyObstacles();
      if (stableAndPlayable(attempt < 200 ? 2 : 1)) break;
    }
  }

  // ---- public API ----
  const engine = {
    rows, cols, kinds: kinds.slice(),
    isCell,
    cell: (r, c) => (isCell(r, c) ? cp(grid[r][c]) : null),
    jellyAt: (r, c) => (isCell(r, c) ? jel[r][c] : 0),
    snapshot: () => ({ rows, cols, mask: cellMask.map(row => row.slice()), grid: gridCopy(), jelly: jellyCopy(),
      lock: lock.map(row => row.slice()), exits: exitAt.map(row => row.slice()), portals: portalsIn.map(q => ({ from: { ...q.from }, to: { ...q.to } })) }),
    get score() { return score; },
    get stats() {
      return { cleared: { ...cleared }, jellyLeft, specialsMade, cascadesMax,
        dinosOut, dinosTotal: dinoOpt ? Math.max(dinoOpt.total, dinosStart) : dinosStart, frostLeft, chocoLeft, licoriceLeft, locksLeft };
    },
    lockAt: (r, c) => (isCell(r, c) ? lock[r][c] : 0),
    isExit: (r, c) => isCell(r, c) && exitAt[r][c],
    portals: () => portalsIn.map(q => ({ from: { ...q.from }, to: { ...q.to } })),
    isAdjacent: (a, b) => !!a && !!b && Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1,

    swap(a, b) {
      if (!a || !b || !isCell(a.r, a.c) || !isCell(b.r, b.c) || !engine.isAdjacent(a, b) ||
        !grid[a.r][a.c] || !grid[b.r][b.c] || !canSwap(a.r, a.c) || !canSwap(b.r, b.c)) return { ok: false, events: [], gained: 0 };
      a = { r: a.r, c: a.c }; b = { r: b.r, c: b.c };
      const pa = grid[a.r][a.c], pb = grid[b.r][b.c];
      const combo = isComboPair(pa, pb);
      const chocoBefore = chocoLeft;
      chocoBroken = 0;
      grid[a.r][a.c] = pb; grid[b.r][b.c] = pa;
      if (!combo && !matchAt(a.r, a.c) && !matchAt(b.r, b.c)) {
        const e1 = ev({ t: 'swap', a: { ...a }, b: { ...b } });
        grid[a.r][a.c] = pa; grid[b.r][b.c] = pb;
        const e2 = ev({ t: 'swapBack', a: { ...a }, b: { ...b } });
        return { ok: false, events: [e1, e2], gained: 0 };
      }
      const events = [ev({ t: 'swap', a: { ...a }, b: { ...b } })];
      let cascade = 1;
      if (combo) cascade = playCombo(a, b, events);
      const last = settle(events, cascade, combo ? null : [b, a]);
      cascadesMax = Math.max(cascadesMax, last);
      if (chocoBefore > 0 && chocoBroken === 0 && chocoLeft > 0) spreadChoco(events);
      if (!hasValidMove()) events.push(shuffleInternal());
      const gained = events.reduce((s, e) => s + (e.gained || 0), 0);
      score += gained;
      return { ok: true, events, gained };
    },

    // ---- 道具（Candy Crush 的 booster；都不算步數） ----
    // smash(cell)：棒棒糖槌，敲掉一顆（特殊方塊會發動），之後照常掉落、連鎖
    smash(cell) {
      if (!cell || !isCell(cell.r, cell.c) || !grid[cell.r][cell.c] || grid[cell.r][cell.c].block === 'dino') return { ok: false, events: [], gained: 0 };
      const events = [];
      const st = newStep(1);
      hit(st, cell.r, cell.c, 'combo', { r: cell.r, c: cell.c });
      runQueue(st);
      events.push(finishStep(st));
      fall(events);
      cascadesMax = Math.max(cascadesMax, settle(events, 2, null));
      if (!hasValidMove()) events.push(shuffleInternal());
      const gained = events.reduce((s2, e) => s2 + (e.gained || 0), 0);
      score += gained;
      return { ok: true, events, gained };
    },
    // freeSwap(a, b)：自由交換，相鄰兩顆不用湊成三連也能換；兩個特殊方塊照樣組合技
    freeSwap(a, b) {
      if (!a || !b || !isCell(a.r, a.c) || !isCell(b.r, b.c) || !engine.isAdjacent(a, b) ||
        !grid[a.r][a.c] || !grid[b.r][b.c] || !canSwap(a.r, a.c) || !canSwap(b.r, b.c)) return { ok: false, events: [], gained: 0 };
      a = { r: a.r, c: a.c }; b = { r: b.r, c: b.c };
      const pa = grid[a.r][a.c], pb = grid[b.r][b.c];
      const combo = isComboPair(pa, pb);
      grid[a.r][a.c] = pb; grid[b.r][b.c] = pa;
      const events = [ev({ t: 'swap', a: { ...a }, b: { ...b } })];
      let cascade = 1;
      if (combo) cascade = playCombo(a, b, events);
      cascadesMax = Math.max(cascadesMax, settle(events, cascade, combo ? null : [b, a]));
      if (!hasValidMove()) events.push(shuffleInternal());
      const gained = events.reduce((s2, e) => s2 + (e.gained || 0), 0);
      score += gained;
      return { ok: true, events, gained };
    },
    // airDrop(n)：薯餅空投，隨機 n 顆普通方塊變成包裝糖果，一起爆
    airDrop(n = 3) {
      const cells = [];
      for (let i = 0; i < n; i++) {
        const normals = [];
        forCells((r, c) => { const q = grid[r][c]; if (q && q.kind >= 0 && q.special === NONE && !lock[r][c]) normals.push({ r, c }); });
        if (!normals.length) break;
        const { r, c } = normals[rand(normals.length)];
        grid[r][c].special = 'wrap';
        cells.push({ r, c, piece: cp(grid[r][c]) });
      }
      if (!cells.length) return { ok: false, events: [], gained: 0 };
      const events = [ev({ t: 'transform', cells })];
      const st = newStep(1);
      for (const { r, c } of cells) if (grid[r][c]) hit(st, r, c, 'wrap', { r, c });
      runQueue(st);
      events.push(finishStep(st));
      fall(events);
      cascadesMax = Math.max(cascadesMax, settle(events, 2, null));
      if (!hasValidMove()) events.push(shuffleInternal());
      const gained = events.reduce((s2, e) => s2 + (e.gained || 0), 0);
      score += gained;
      return { ok: true, events, gained };
    },

    findHint,
    hasValidMove,
    shuffle: () => [shuffleInternal()],

    addScore(points) {
      const v = Math.max(0, Math.round(Number(points) || 0));
      score += v;
      return score;
    },

    sugarCrush(movesLeft) {
      const events = [];
      biasNow = 0;
      let left = Math.max(0, Math.floor(movesLeft || 0));
      // waves: convert up to SUGAR_WAVE moves into striped pieces (3,000 each), fire exactly those, let it settle
      while (left > 0) {
        const wave = Math.min(SUGAR_WAVE, left);
        left -= wave;
        const lit = [];
        for (let i = 0; i < wave; i++) {
          const normals = [];
          forCells((r, c) => { const p = grid[r][c]; if (p && p.kind >= 0 && p.special === NONE && !lock[r][c]) normals.push({ r, c }); });
          if (!normals.length) {
            events.push(ev({ t: 'transform', cells: [], sugar: true, gained: SUGAR_MOVE_POINTS, points: [] }));
            continue;
          }
          const { r, c } = normals[rand(normals.length)];
          const roll = rng();
          grid[r][c].special = roll < 0.25 ? 'wrap' : roll < 0.625 ? 'h' : 'v';   // 超級糖果：條紋為主，約 1/4 是包裝
          lit.push({ r, c });
          events.push(ev({ t: 'transform', cells: [{ r, c, piece: cp(grid[r][c]) }], sugar: true,
            gained: SUGAR_MOVE_POINTS, points: [{ r, c, value: SUGAR_MOVE_POINTS }] }));
        }
        if (!lit.length) continue;
        const st = newStep(1);
        for (const { r, c } of lit) { const p = grid[r][c]; if (p && p.special !== NONE) hit(st, r, c, p.special, { r, c }); }
        runQueue(st);
        events.push(finishStep(st));
        fall(events);
        settle(events, 2, null);
      }
      // then every special still on the board (left by the player or made by cascades) fires, until none is left
      for (let round = 0; round < 60; round++) {
        const st = newStep(1);
        forCells((r, c) => { const p = grid[r][c]; if (isSpecial(p) && !lock[r][c]) hit(st, r, c, p.special, { r, c }); });
        if (!st.removed.length) break;
        runQueue(st);
        events.push(finishStep(st));
        fall(events);
        settle(events, 2, null);
      }
      biasNow = cascadeBias;
      const gained = events.reduce((s, e) => s + (e.gained || 0), 0);
      score += gained;
      return { events, gained };
    },
  };
  return engine;
}
