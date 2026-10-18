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
// * points[] labels: one per match group, one per firing special / combo (sum of its 20 × mult),
//   one per jelly layer (100); labels on the same cell are merged. sum(points) === gained.
// * findHint() / hasValidMove() never touch the PRNG, so calling them does not change the game.
//   findHint prefers combos, then bigger matches, matches that fire specials, and matches on jelly.
// * sugarCrush(n): one `transform` event per converted piece, then repeated rounds of
//   "fire every special on the board" (clear, cascade 1) + gravity/cascades until no special is left.
//   No shuffle is appended at the end of sugarCrush.
//
// TEST-ONLY option `layout` (not part of the game API): createEngine({ kinds, layout: [rowStrings] }).
//   Each row is a list of tokens, spaces optional:  "0 1 2h 3v 4w B . ?"  ==  "012h3v4wB.?"
//     digit d  -> normal piece of global kind d        dh / dv / dw -> striped h / striped v / wrapped
//     B or *   -> colour bomb                           .  -> hole (unless `mask` is also given)
//     ?        -> random kind from `kinds` that makes no 3-in-a-row with its neighbours
//   rows/cols default to the layout size. The layout is used as-is (it may contain matches).
// ---------------------------------------------------------------------------------------------

const SHAPE_POINTS = { '3': 60, '4': 120, L: 150, T: 150, '5': 200 };
const EFFECT_POINTS = 20;
const JELLY_POINTS = 100;
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
    const toks = compact.match(/\d[hvw]?|[B*.?]/g) || [];
    if (toks.join('') !== compact) throw new Error(`engine: bad layout row ${r}: "${row}"`);
    return toks;
  });
}

const cp = p => (p ? { id: p.id, kind: p.kind, special: p.special } : null);
const isComboPair = (p, q) =>
  (p.special !== NONE && q.special !== NONE) || p.special === 'bomb' || q.special === 'bomb';

export function createEngine(opts = {}) {
  const layoutToks = opts.layout ? parseLayout(opts.layout) : null;
  const rows = opts.rows ?? (layoutToks ? layoutToks.length : 8);
  const cols = opts.cols ?? (layoutToks ? Math.max(...layoutToks.map(t => t.length)) : 8);
  const kinds = Array.isArray(opts.kinds) && opts.kinds.length ? opts.kinds.slice() : [0, 1, 2, 3, 4];
  const antiCascade = opts.antiCascade ?? 0.72;
  const rng = mulberry32(opts.seed ?? 1);
  const rand = n => Math.floor(rng() * n);
  const maskIn = opts.mask || null;
  const jellyIn = opts.jelly || null;

  // ---- state ----
  const cellMask = [];
  const grid = [];
  const jel = [];
  for (let r = 0; r < rows; r++) {
    cellMask.push([]); grid.push([]); jel.push([]);
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

  const newPiece = (kind, special = NONE) => ({ id: nextId++, kind, special });
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
  const ev = o => { o.board = gridCopy(); o.jelly = jellyCopy(); return o; };
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
  function matchAt(r, c) { const L = lineLens(r, c); return L.h >= 3 || L.v >= 3; }

  // would kind k at (r,c) make a 3-in-a-row with already-filled neighbours?
  function wouldMatch(r, c, k) {
    const a = (y, x) => kAt(y, x) === k;
    return (a(r, c - 1) && (a(r, c - 2) || a(r, c + 1))) || (a(r, c + 1) && a(r, c + 2)) ||
      (a(r - 1, c) && (a(r - 2, c) || a(r + 1, c))) || (a(r + 1, c) && a(r + 2, c));
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
    for (const g of groups) g.cells.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    return groups;
  }

  function classify(g) {
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
    return { shape: '3', special: NONE, longest };
  }

  // receiving cell of a new special
  function placeSpecial(g, cls, swapped) {
    if (cls.special === NONE) return null;
    if (swapped) for (const s of swapped) if (g.keys.has(key(s.r, s.c))) return { r: s.r, c: s.c };
    const normal = p => grid[p.r][p.c] && grid[p.r][p.c].special === NONE;
    if (cls.special === 'wrap' && cls.crosses.length) return { ...(cls.crosses.find(normal) || cls.crosses[0]) };
    const run = cls.longest;
    const mid = (run.len - 1) / 2;
    const order = run.cells.map((cell, i) => ({ r: cell[0], c: cell[1], d: Math.abs(i - mid), i }))
      .sort((x, y) => x.d - y.d || x.i - y.i);
    const pick = order.find(normal) || order[0];
    return { r: pick.r, c: pick.c };
  }

  // ---- one clear step ----
  function newStep(cascade) {
    return { cascade, mult: cascade, done: new Set(), prot: new Set(), removed: [], effects: [], created: [],
      jellyHits: [], groups: [], pts: new Map(), queue: [] };
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
    if (!p) return false;
    st.done.add(k);
    grid[r][c] = null;
    st.removed.push({ r, c, piece: cp(p), cause });
    countCleared(p);
    hitJelly(st, r, c);
    if (cause !== 'match') addPts(st, src.r, src.c, EFFECT_POINTS * st.mult);
    if (p.special !== NONE && !noFire) st.queue.push({ r, c, special: p.special });
    return true;
  }
  function hitRow(st, r, c, cause, src) {
    hit(st, r, c, cause, src);
    for (let d = 1; d < cols; d++) { hit(st, r, c - d, cause, src); hit(st, r, c + d, cause, src); }
  }
  function hitCol(st, r, c, cause, src) {
    hit(st, r, c, cause, src);
    for (let d = 1; d < rows; d++) { hit(st, r - d, c, cause, src); hit(st, r + d, c, cause, src); }
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
  function runQueue(st) {
    while (st.queue.length) {
      const { r, c, special } = st.queue.shift();
      const src = { r, c };
      if (special === 'h') { st.effects.push({ fx: 'line', dir: 'h', r, c }); hitRow(st, r, c, 'h', src); }
      else if (special === 'v') { st.effects.push({ fx: 'line', dir: 'v', r, c }); hitCol(st, r, c, 'v', src); }
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
      created: st.created, jellyHits: st.jellyHits, points, gained });
  }

  function matchStep(groups, cascade, swapped) {
    const st = newStep(cascade);
    const plans = groups.map(g => { const cls = classify(g); return { g, cls, at: placeSpecial(g, cls, swapped) }; });
    for (const { g, cls, at } of plans) {
      st.groups.push({ kind: g.kind, shape: cls.shape, cells: g.cells.map(([r, c]) => ({ r, c })) });
      const label = at || { r: g.cells[g.cells.length >> 1][0], c: g.cells[g.cells.length >> 1][1] };
      addPts(st, label.r, label.c, SHAPE_POINTS[cls.shape] * st.mult);
      if (at) st.prot.add(key(at.r, at.c));
    }
    for (const { g, at } of plans)
      for (const [r, c] of g.cells) if (!at || at.r !== r || at.c !== c) hit(st, r, c, 'match');
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
          if (p && p.kind === K && p.special === NONE) {
            p.special = other.special === 'wrap' ? 'wrap' : rng() < 0.5 ? 'h' : 'v';
            cells.push({ r, c, piece: cp(p) });
          }
        });
        if (cells.length) events.push(ev({ t: 'transform', cells }));
      }
      hit(st, bombAt.r, bombAt.c, 'combo', center, true);
      const targets = cellsOfKind(K, st);
      st.effects.push({ fx: 'bomb', r: bombAt.r, c: bombAt.c, targets: targets.map(t => ({ ...t })) });
      for (const t of targets) hit(st, t.r, t.c, 'bomb', bombAt);
    } else {
      const stripes = [pa.special, pb.special].filter(s => s === 'h' || s === 'v').length;
      hit(st, a.r, a.c, 'combo', center, true);
      hit(st, b.r, b.c, 'combo', center, true);
      if (stripes === 2) {
        st.effects.push({ fx: 'line', dir: 'h', r: center.r, c: center.c });
        st.effects.push({ fx: 'line', dir: 'v', r: center.r, c: center.c });
        hitRow(st, center.r, center.c, 'combo', center);
        hitCol(st, center.r, center.c, 'combo', center);
      } else if (stripes === 1) {
        for (let d = -1; d <= 1; d++) if (center.r + d >= 0 && center.r + d < rows)
          st.effects.push({ fx: 'line', dir: 'h', r: center.r + d, c: center.c });
        for (let d = -1; d <= 1; d++) if (center.c + d >= 0 && center.c + d < cols)
          st.effects.push({ fx: 'line', dir: 'v', r: center.r, c: center.c + d });
        for (let d = -1; d <= 1; d++) {
          if (center.r + d >= 0 && center.r + d < rows) hitRow(st, center.r + d, center.c, 'combo', center);
          if (center.c + d >= 0 && center.c + d < cols) hitCol(st, center.r, center.c + d, 'combo', center);
        }
      } else {
        st.effects.push({ fx: 'blast', r: center.r, c: center.c, radius: 2 });
        hitSquare(st, center.r, center.c, 2, 'combo', center);
      }
    }
    runQueue(st);
    events.push(finishStep(st));
  }

  // ---- gravity + refill ----
  function pickKind(r, c) {
    if (rng() < antiCascade) {
      const safe = kinds.filter(k => !wouldMatch(r, c, k));
      if (safe.length) return safe[rand(safe.length)];
    }
    return kinds[rand(kinds.length)];
  }
  function fall(events) {
    const moves = [], spawnCells = [];
    for (let c = 0; c < cols; c++) {
      const col = [];
      for (let r = 0; r < rows; r++) if (cellMask[r][c]) col.push(r);
      let w = col.length - 1;
      for (let i = col.length - 1; i >= 0; i--) {
        const r = col[i], p = grid[r][c];
        if (!p) continue;
        const tr = col[w--];
        if (tr !== r) { grid[tr][c] = p; grid[r][c] = null; moves.push({ id: p.id, from: { r, c }, to: { r: tr, c } }); }
      }
      for (let i = w; i >= 0; i--) spawnCells.push({ r: col[i], c, j: w - i });
    }
    spawnCells.sort((x, y) => y.r - x.r || x.c - y.c);
    const spawns = [];
    for (const s of spawnCells) {
      const p = newPiece(pickKind(s.r, s.c));
      grid[s.r][s.c] = p;
      spawns.push({ piece: cp(p), from: { r: -1 - s.j, c: s.c }, to: { r: s.r, c: s.c } });
    }
    if (moves.length || spawns.length) events.push(ev({ t: 'fall', moves, spawns }));
  }

  // matches -> clear -> fall, repeated; returns the last cascade number used
  function settle(events, cascade, swapped) {
    let last = cascade - 1;
    for (let guard = 0; guard < 200; guard++) {
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
    if (!p || !q) return false;
    if (isComboPair(p, q)) return true;
    grid[r1][c1] = q; grid[r2][c2] = p;
    const ok = matchAt(r1, c1) || matchAt(r2, c2);
    grid[r1][c1] = p; grid[r2][c2] = q;
    return ok;
  }
  function hasValidMove() {
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (!cellMask[r][c]) continue;
      if (isCell(r, c + 1) && pairValid(r, c, r, c + 1)) return true;
      if (isCell(r + 1, c) && pairValid(r, c, r + 1, c)) return true;
    }
    return false;
  }
  const COMBO_VALUE = { 'bomb+bomb': 1000, 'bomb+wrap': 900, 'bomb+h': 850, 'bomb+v': 850, 'wrap+wrap': 700,
    'h+wrap': 650, 'v+wrap': 650, 'h+h': 600, 'h+v': 600, 'v+v': 600 };
  function cellValue(r, c) {
    const { h, v } = lineLens(r, c);
    if (h < 3 && v < 3) return 0;
    let s = h >= 5 || v >= 5 ? 300 : h >= 3 && v >= 3 ? 200 : h === 4 || v === 4 ? 150 : 100;
    s += (h >= 3 ? h : 0) + (v >= 3 ? v : 0);
    const k = kAt(r, c);
    // specials in the match fire (+40); cells on jelly help the jelly goal (+35)
    const sp = (y, x) => (grid[y][x].special !== NONE ? 40 : 0) + (jel[y][x] > 0 ? 35 : 0);
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
    if (!p || !q) return -1;
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

  function stableAndPlayable() { return !findRuns().length && hasValidMove(); }

  function shuffleInternal() {
    const cells = [];
    forCells((r, c) => cells.push([r, c]));
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
    for (let attempt = 0; attempt < 100 && !ok; attempt++) {
      const normals = cells.filter(([r, c]) => grid[r][c] && grid[r][c].special === NONE);
      const saved = normals.map(([r, c]) => grid[r][c]);
      for (const [r, c] of normals) grid[r][c] = null;
      normals.forEach(([r, c], i) => {
        const safe = kinds.filter(k => !wouldMatch(r, c, k));
        saved[i].kind = safe.length ? safe[rand(safe.length)] : kinds[rand(kinds.length)];
        grid[r][c] = saved[i];
      });
      ok = stableAndPlayable();
    }
    const moves = [];
    for (const [r, c] of cells) { const p = grid[r][c]; if (p) moves.push({ id: p.id, from: { ...from.get(p.id) }, to: { r, c } }); }
    return ev({ t: 'shuffle', moves });
  }

  // ---- initial board ----
  if (layoutToks) {
    const later = [];
    forCells((r, c) => {
      const t = (layoutToks[r] && layoutToks[r][c]) || '?';
      if (t === '?' || t === '.') { later.push([r, c]); return; }
      if (t === 'B' || t === '*') { grid[r][c] = newPiece(-1, 'bomb'); return; }
      const sp = t[1] === 'h' ? 'h' : t[1] === 'v' ? 'v' : t[1] === 'w' ? 'wrap' : NONE;
      grid[r][c] = newPiece(parseInt(t[0], 10), sp);
    });
    for (const [r, c] of later) {
      const safe = kinds.filter(k => !wouldMatch(r, c, k));
      grid[r][c] = newPiece(safe.length ? safe[rand(safe.length)] : kinds[rand(kinds.length)]);
    }
  } else {
    for (let attempt = 0; attempt < 300; attempt++) {
      nextId = 1;
      forCells((r, c) => { grid[r][c] = null; });
      forCells((r, c) => {
        const safe = kinds.filter(k => !wouldMatch(r, c, k));
        grid[r][c] = newPiece(safe.length ? safe[rand(safe.length)] : kinds[rand(kinds.length)]);
      });
      if (stableAndPlayable()) break;
    }
  }

  // ---- public API ----
  const engine = {
    rows, cols, kinds: kinds.slice(),
    isCell,
    cell: (r, c) => (isCell(r, c) ? cp(grid[r][c]) : null),
    jellyAt: (r, c) => (isCell(r, c) ? jel[r][c] : 0),
    snapshot: () => ({ rows, cols, mask: cellMask.map(row => row.slice()), grid: gridCopy(), jelly: jellyCopy() }),
    get score() { return score; },
    get stats() { return { cleared: { ...cleared }, jellyLeft, specialsMade, cascadesMax }; },
    isAdjacent: (a, b) => !!a && !!b && Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1,

    swap(a, b) {
      if (!a || !b || !isCell(a.r, a.c) || !isCell(b.r, b.c) || !engine.isAdjacent(a, b) ||
        !grid[a.r][a.c] || !grid[b.r][b.c]) return { ok: false, events: [], gained: 0 };
      a = { r: a.r, c: a.c }; b = { r: b.r, c: b.c };
      const pa = grid[a.r][a.c], pb = grid[b.r][b.c];
      const combo = isComboPair(pa, pb);
      grid[a.r][a.c] = pb; grid[b.r][b.c] = pa;
      if (!combo && !matchAt(a.r, a.c) && !matchAt(b.r, b.c)) {
        const e1 = ev({ t: 'swap', a: { ...a }, b: { ...b } });
        grid[a.r][a.c] = pa; grid[b.r][b.c] = pb;
        const e2 = ev({ t: 'swapBack', a: { ...a }, b: { ...b } });
        return { ok: false, events: [e1, e2], gained: 0 };
      }
      const events = [ev({ t: 'swap', a: { ...a }, b: { ...b } })];
      let cascade = 1;
      if (combo) { comboSteps(a, b, events); fall(events); cascade = 2; }
      const last = settle(events, cascade, combo ? null : [b, a]);
      cascadesMax = Math.max(cascadesMax, last);
      if (!hasValidMove()) events.push(shuffleInternal());
      const gained = events.reduce((s, e) => s + (e.gained || 0), 0);
      score += gained;
      return { ok: true, events, gained };
    },

    findHint,
    hasValidMove,
    shuffle: () => [shuffleInternal()],

    sugarCrush(movesLeft) {
      const events = [];
      const n = Math.max(0, Math.floor(movesLeft || 0));
      for (let i = 0; i < n; i++) {
        const normals = [];
        forCells((r, c) => { const p = grid[r][c]; if (p && p.kind >= 0 && p.special === NONE) normals.push({ r, c }); });
        if (!normals.length) break;
        const { r, c } = normals[rand(normals.length)];
        grid[r][c].special = rng() < 0.5 ? 'h' : 'v';
        events.push(ev({ t: 'transform', cells: [{ r, c, piece: cp(grid[r][c]) }] }));
      }
      for (let round = 0; round < 30; round++) {
        const st = newStep(1);
        forCells((r, c) => { const p = grid[r][c]; if (p && p.special !== NONE) hit(st, r, c, p.special, { r, c }); });
        if (!st.removed.length) break;
        runQueue(st);
        events.push(finishStep(st));
        fall(events);
        settle(events, 2, null);
      }
      const gained = events.reduce((s, e) => s + (e.gained || 0), 0);
      score += gained;
      return { events, gained };
    },
  };
  return engine;
}
