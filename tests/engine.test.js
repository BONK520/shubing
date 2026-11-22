// Engine tests. Open tests/engine.test.html (served over HTTP) or run: python tests/run_tests.py
// Query params: ?fuzz=N (games per mask/kinds config, default 6), ?only=substring,
//               ?engine=/path/to/engine.js (test another build, e.g. a mutated copy)
import { lay, BG_KINDS, MASKS, maskSize, mulberry, matchesIn, replayEvents, sameBoard, kindStr, newCtx, checkResult } from './util.js';

const params = new URLSearchParams(location.search);
const engineMod = await import(params.get('engine') || '../js/engine.js');
const { createEngine } = engineMod;
const FUZZ = parseInt(params.get('fuzz') || '6', 10);
const ONLY = params.get('only');

const T = [];
const test = (name, fn) => T.push({ name, fn });
const notes = [];
const note = s => notes.push(s);
const ok = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || 'eq'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const deq = (a, b, m) => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${m || 'deq'}:\n  expected ${y}\n  got      ${x}`);
};
const P = (r, c) => ({ r, c });

// hand-made board: background kinds 4..9 never match; test pieces are 0..3
const mk = (rowsArr, o = {}) => createEngine({ kinds: BG_KINDS, antiCascade: 1, seed: 7, layout: lay(rowsArr), ...o });
const clears = res => res.events.filter(e => e.t === 'clear');
const firstClear = res => res.events.find(e => e.t === 'clear');
const cellSet = list => new Set(list.map(x => `${x.r},${x.c}`));
// swap + full contract check (replay etc.)
function play(e, a, b) {
  const before = e.snapshot();
  const ctx = newCtx(e);
  const res = e.swap(a, b);
  checkResult(e, before, res, ctx);
  return res;
}

// ---------------------------------------------------------------- basics
test('API surface, isCell / cell / snapshot copies', () => {
  const e = createEngine({ kinds: [0, 1, 2, 3, 4], mask: MASKS.holes, jelly: ['2.......'], seed: 3 });
  eq(e.rows, 8); eq(e.cols, 8); deq(e.kinds, [0, 1, 2, 3, 4]);
  for (const f of ['isCell', 'cell', 'jellyAt', 'snapshot', 'isAdjacent', 'swap', 'findHint', 'hasValidMove', 'shuffle', 'sugarCrush'])
    eq(typeof e[f], 'function', f);
  eq(e.score, 0);
  ok(e.isCell(0, 0) && !e.isCell(1, 2) && !e.isCell(-1, 0) && !e.isCell(0, 8), 'isCell');
  eq(e.cell(1, 2), null, 'hole cell is null');
  eq(e.jellyAt(0, 0), 2); eq(e.jellyAt(0, 1), 0);
  const p = e.cell(0, 0);
  p.kind = 99; p.special = 'bomb';
  ok(e.cell(0, 0).kind !== 99 && e.cell(0, 0).special === 'none', 'cell() returns a copy');
  const s = e.snapshot();
  eq(s.rows, 8); eq(s.cols, 8); eq(s.mask[1][2], false); eq(s.mask[0][0], true); eq(s.jelly[0][0], 2);
  s.grid[0][0].kind = 99; s.jelly[0][0] = 0; s.mask[0][0] = false;
  ok(e.cell(0, 0).kind !== 99 && e.jellyAt(0, 0) === 2 && e.isCell(0, 0), 'snapshot() is a deep copy');
  const st = e.stats;
  deq(st, { cleared: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 }, jellyLeft: 2, specialsMade: 0, cascadesMax: 0,
    made: { stripe: 0, wrap: 0, bomb: 0, fish: 0 }, combos: {}, comboCount: 0, chocoGot: 0,
    dinosOut: 0, dinosTotal: 0, frostLeft: 0, chocoLeft: 0, licoriceLeft: 0, locksLeft: 0, alarmsLeft: 0, alarmsBurst: 0, shellLeft: 0, giftLeft: 0 });
  st.cleared[0] = 50;
  eq(e.stats.cleared[0], 0, 'stats is a copy');
  ok(e.isAdjacent(P(2, 2), P(2, 3)) && e.isAdjacent(P(2, 2), P(1, 2)), 'adjacent');
  ok(!e.isAdjacent(P(2, 2), P(3, 3)) && !e.isAdjacent(P(2, 2), P(2, 4)) && !e.isAdjacent(P(2, 2), P(2, 2)), 'not adjacent');
});

test('determinism: same seed -> same board and same events; different seed -> different board', () => {
  const run = seed => {
    const e = createEngine({ kinds: [0, 1, 2, 3, 4], seed, mask: MASKS.diamond });
    const out = [JSON.stringify(e.snapshot())];
    for (let i = 0; i < 40; i++) { const h = e.findHint(); out.push(JSON.stringify(e.swap(h.a, h.b))); }
    out.push(JSON.stringify(e.sugarCrush(5)), e.score);
    return out.join('|');
  };
  eq(run(42), run(42), 'same seed');
  ok(run(42) !== run(43), 'different seeds differ');
  const a = createEngine({ kinds: [0, 1, 2, 3, 4], seed: 1 }).snapshot();
  const b = createEngine({ kinds: [0, 1, 2, 3, 4], seed: 2 }).snapshot();
  ok(!sameBoard(a.grid, b.grid), 'seed 1 vs 2 boards differ');
  // findHint / hasValidMove must not consume randomness
  const e1 = createEngine({ kinds: [0, 1, 2, 3, 4], seed: 9 }), e2 = createEngine({ kinds: [0, 1, 2, 3, 4], seed: 9 });
  for (let i = 0; i < 20; i++) { e1.findHint(); e1.hasValidMove(); }
  const h = e2.findHint();
  eq(JSON.stringify(e1.swap(h.a, h.b)), JSON.stringify(e2.swap(h.a, h.b)), 'findHint does not change the game');
});

test('initial board: no match, a valid move, all cells filled (300 seeds x masks x kinds 4-6)', () => {
  let n = 0;
  for (const [name, mask] of Object.entries(MASKS)) for (const nk of [4, 5, 6]) for (let seed = 1; seed <= 20; seed++) {
    const kinds = [0, 1, 2, 3, 4, 5].slice(0, nk);
    const e = createEngine({ kinds, mask, seed: seed * 31 + nk, ...maskSize(mask) });
    const s = e.snapshot();
    const runs = matchesIn(s.grid);
    ok(!runs.length, `${name} k${nk} s${seed}: initial match\n${kindStr(s.grid)}`);
    ok(e.hasValidMove(), `${name} k${nk} s${seed}: no valid move`);
    ok(e.findHint(), `${name} k${nk} s${seed}: no hint`);
    const ids = new Set();
    for (let r = 0; r < s.rows; r++) for (let c = 0; c < s.cols; c++) {
      const p = s.grid[r][c];
      eq(!!p, s.mask[r][c], `${name}: filled iff cell at ${r},${c}`);
      if (p) { ok(kinds.includes(p.kind) && p.special === 'none', 'normal piece of allowed kind'); ok(!ids.has(p.id), 'unique id'); ids.add(p.id); }
    }
    n++;
  }
  note(`initial boards checked: ${n}`);
});

test('invalid swaps leave the board unchanged (non-adjacent, diagonal, hole, outside, no match)', () => {
  const e = createEngine({ kinds: BG_KINDS, layout: lay(['______', '__.___', '______', '______']), seed: 1 });
  const before = e.snapshot();
  for (const [a, b] of [[P(0, 0), P(0, 2)], [P(0, 0), P(1, 1)], [P(0, 2), P(1, 2)], [P(-1, 0), P(0, 0)], [P(3, 5), P(3, 6)], [P(2, 2), P(2, 2)]]) {
    const res = e.swap(a, b);
    eq(res.ok, false); eq(res.events.length, 0, 'no events for an illegal swap'); eq(res.gained, 0);
  }
  ok(sameBoard(e.snapshot().grid, before.grid), 'unchanged after illegal swaps');
  // adjacent, no match: swap + swapBack
  const res = e.swap(P(0, 0), P(0, 1));
  eq(res.ok, false);
  deq(res.events.map(x => x.t), ['swap', 'swapBack']);
  deq([res.events[0].a, res.events[0].b], [P(0, 0), P(0, 1)]);
  eq(res.events[0].board[0][0].id, before.grid[0][1].id, 'swap event shows the swapped board');
  ok(sameBoard(res.events[1].board, before.grid), 'swapBack event shows the original board');
  ok(sameBoard(e.snapshot().grid, before.grid), 'board unchanged');
  eq(e.score, 0);
  replayEvents(before.grid, before.jelly, res.events);
});

// ---------------------------------------------------------------- 2×2 squares
test('a 2x2 square on its own makes a fish at the swapped cell: shape "square", 120 points; hint finds it', () => {
  const rowsA = ['______', '_00___', '_0_0__', '______'];
  const h = mk(rowsA).findHint();
  deq(cellSet([h.a, h.b]), cellSet([P(2, 2), P(2, 3)]), 'the only move makes the square');
  const e = mk(rowsA);
  const id = e.cell(2, 3).id;
  const res = play(e, P(2, 3), P(2, 2));
  const c = firstClear(res);
  deq(c.groups.map(g => `${g.kind}:${g.shape}:${g.cells.length}`), ['0:square:4']);
  deq(cellSet(c.removed), cellSet([P(1, 1), P(1, 2), P(2, 1)]), 'the other three go, the swapped one becomes the fish');
  eq(c.created.length, 1);
  deq(c.created[0], { r: 2, c: 2, piece: { id, kind: 0, special: 'fish' } });
  eq(e.stats.specialsMade, 1);
  eq(e.stats.made.fish, 1, 'order counter: fish');
  eq(c.cnt.made.fish, 1, 'the clear event carries the counters');
  eq(c.gained, 120);
});

test('a square touching a 3-in-a-row adds its other cells to that group (+60) and makes a fish ("P" shape)', () => {
  // the 0 from (0,1) lands on (1,1): row 1 becomes 0 0 0 and (1,0) (1,1) (2,0) (2,1) a square
  const e = mk(['_0____', '0_0___', '00____', '______']);
  const c = firstClear(play(e, P(0, 1), P(1, 1)));
  deq(c.groups.map(g => `${g.kind}:${g.shape}:${g.cells.length}`), ['0:3:5']);
  eq(c.created.length, 1); deq([c.created[0].r, c.created[0].c, c.created[0].piece.special], [1, 1, 'fish']);
  eq(c.gained, 60 + 60);
});

// ---------------------------------------------------------------- fish (from 2×2 squares)
test('a fish in a match swims to one target and removes it (+60)', () => {
  const e = mk(['_ _ _ _ _ _', '0f 0 _ _ _ _', '_ _ 0 _ _ _', '_ _ _ _ _ _']);
  const c = firstClear(play(e, P(2, 2), P(1, 2)));
  const f = c.effects.filter(x => x.fx === 'fish');
  eq(f.length, 1, 'one fish');
  deq([f[0].r, f[0].c, f[0].carry], [1, 0, null], 'it starts where the fish was');
  const hitByFish = c.removed.filter(x => x.cause === 'fish');
  eq(hitByFish.length, 1);
  deq([hitByFish[0].r, hitByFish[0].c], [f[0].to.r, f[0].to.c], 'the target is what it removes');
  eq(c.gained, 60 + 60);
});

test('fish targets jelly first, then pieces the collect goal still needs', () => {
  const rowsF = ['_ _ _ _ _ _', '0f 0 _ _ _ _', '_ _ 0 _ _ _', '_ _ _ _ _ _'];
  for (let s = 1; s <= 6; s++) {
    const e = mk(rowsF, { seed: s, jelly: ['......', '......', '......', '.....1'] });
    const f = firstClear(play(e, P(2, 2), P(1, 2))).effects.find(x => x.fx === 'fish');
    deq(f.to, { r: 3, c: 5 }, 'the only jelly cell');
  }
  for (let s = 1; s <= 6; s++) {
    const e = mk(rowsF, { seed: s, collect: { 5: 99 } });
    const c = firstClear(play(e, P(2, 2), P(1, 2)));
    const t = c.removed.find(x => x.cause === 'fish');
    eq(t.piece.kind, 5, 'a kind the goal needs');
  }
});

test('fish + striped: three fish each carry the stripe to a target and it fires there', () => {
  const e = mk(['_ _ _ _ _ _', '0f 1h _ _ _ _', '_ _ _ _ _ _', '_ _ _ _ _ _'], { jelly: ['......', '......', '......', '.....1'] });
  const c = firstClear(play(e, P(1, 0), P(1, 1)));
  const fs = c.effects.filter(x => x.fx === 'fish');
  eq(fs.length, 3, 'three fish');
  ok(fs.every(f => f.carry === 'h'), 'each carries the stripe');
  deq([fs[0].to.r, fs[0].to.c], [3, 5], 'the first one goes for the jelly');
  ok(c.effects.some(x => x.fx === 'line' && x.dir === 'h' && x.r === 3 && x.c === 5), 'a row stripe at the target');
  for (let x = 0; x < 6; x++) ok(c.removed.some(it => it.r === 3 && it.c === x), `row 3 col ${x} cleared`);
});

test('fish + wrapped: blast around the target; fish + fish: three fish, three different targets', () => {
  const e1 = mk(['_ _ _ _ _ _', '0f 1w _ _ _ _', '_ _ _ _ _ _', '_ _ _ _ _ _', '_ _ _ _ _ _'], { jelly: ['......', '......', '......', '....1.', '......'] });
  const c1 = firstClear(play(e1, P(1, 0), P(1, 1)));
  ok(c1.effects.some(x => x.fx === 'fish' && x.carry === 'wrap' && x.to.r === 3 && x.to.c === 4));
  ok(c1.effects.some(x => x.fx === 'blast' && x.r === 3 && x.c === 4 && x.radius === 1));
  for (const [r, c] of [[2, 3], [2, 5], [4, 3], [4, 5]]) ok(c1.removed.some(it => it.r === r && it.c === c), `(${r},${c}) blasted`);
  const e2 = mk(['_ _ _ _ _ _', '0f 1f _ _ _ _', '_ _ _ _ _ _', '_ _ _ _ _ _']);
  const c2 = firstClear(play(e2, P(1, 0), P(1, 1)));
  const fs = c2.effects.filter(x => x.fx === 'fish');
  eq(fs.length, 3, 'three fish');
  eq(new Set(fs.map(x => `${x.to.r},${x.to.c}`)).size, 3, 'different targets');
  eq(c2.removed.filter(it => it.cause === 'fish').length, 3);
});

test('colour bomb + fish: every piece of the fish kind becomes a fish, then they all swim', () => {
  const e = mk(['_ _ 0 _ _ _', 'B 0f _ _ 0 _', '_ _ _ 0 _ _', '_ _ _ _ _ _']);
  const res = play(e, P(1, 0), P(1, 1));
  const tr = res.events.find(x => x.t === 'transform');
  eq(tr.cells.length, 3, 'the three other 0s');
  ok(tr.cells.every(x => x.piece.special === 'fish' && x.piece.kind === 0));
  const c = firstClear(res);
  eq(c.effects.filter(x => x.fx === 'fish').length, 4, 'the fish itself + 3 new ones');
});

test('squares do not change line specials: a 4 in a row with a square still makes a stripe', () => {
  // 0 0 _ 0 on row 1, 0 0 under the first two: the 0 from (0,2) completes the 4 and the square
  const e = mk(['__0___', '00_0__', '00____', '______']);
  const c = firstClear(play(e, P(0, 2), P(1, 2)));
  deq(c.groups.map(g => `${g.kind}:${g.shape}`), ['0:4']);
  eq(c.created.length, 1); eq(c.created[0].piece.special, 'v');
  eq(c.gained, 120 + 60);
});

// ---------------------------------------------------------------- special creation
test('horizontal 4 -> column-striped "v" at the swapped cell (both drag directions)', () => {
  for (const [a, b] of [[P(1, 2), P(2, 2)], [P(2, 2), P(1, 2)]]) {
    const e = mk(['______', '__0___', '00_0__', '______', '______']);
    const id = e.cell(1, 2).id;
    const res = play(e, a, b);
    ok(res.ok, 'valid');
    const cl = firstClear(res);
    eq(cl.cascade, 1);
    deq(cl.groups, [{ kind: 0, shape: '4', cells: [P(2, 0), P(2, 1), P(2, 2), P(2, 3)] }]);
    deq(cl.created, [{ r: 2, c: 2, piece: { id, kind: 0, special: 'v' } }]);
    deq(cl.removed.map(x => [x.r, x.c, x.cause]), [[2, 0, 'match'], [2, 1, 'match'], [2, 3, 'match']]);
    deq(cl.points, [{ r: 2, c: 2, value: 120 }]);
    eq(res.gained, 120); eq(e.score, 120);
    eq(clears(res).length, 1, 'no cascade on this board');
    deq(cl.board[2][2], { id, kind: 0, special: 'v' });
    eq(e.stats.specialsMade, 1);
  }
});

test('vertical 4 -> row-striped "h" at the swapped cell', () => {
  const e = mk(['______', '__0___', '__0___', '_0____', '__0___', '______']);
  const id = e.cell(3, 1).id;
  const res = play(e, P(3, 1), P(3, 2));
  const cl = firstClear(res);
  eq(cl.groups[0].shape, '4');
  deq(cl.created, [{ r: 3, c: 2, piece: { id, kind: 0, special: 'h' } }]);
  eq(cl.removed.length, 3);
});

test('L -> wrapped at the swapped corner', () => {
  const e = mk(['______', '__0___', '__0___', '_0_00_', '______']);
  const res = play(e, P(3, 1), P(3, 2));
  const cl = firstClear(res);
  deq(cl.groups.map(g => [g.kind, g.shape, g.cells.length]), [[0, 'L', 5]]);
  deq(cl.created.map(x => [x.r, x.c, x.piece.kind, x.piece.special]), [[3, 2, 0, 'wrap']]);
  eq(cl.removed.length, 4);
  eq(cl.gained, 200, 'L = 200');
});

test('T -> wrapped at the swapped cell', () => {
  const e = mk(['______', '__0___', '__0___', '_0_0__', '__0___']);
  const res = play(e, P(4, 2), P(3, 2));
  const cl = firstClear(res);
  deq(cl.groups.map(g => [g.shape, g.cells.length]), [['T', 5]]);
  deq(cl.created.map(x => [x.r, x.c, x.piece.special]), [[3, 2, 'wrap']]);
  eq(cl.gained, 200, 'T = 200');
});

test('5 in a row -> colour bomb (kind -1) at the swapped cell', () => {
  const e = mk(['_______', '__0____', '00_00__', '_______']);
  const id = e.cell(1, 2).id;
  const res = play(e, P(1, 2), P(2, 2));
  const cl = firstClear(res);
  deq(cl.groups.map(g => [g.shape, g.cells.length]), [['5', 5]]);
  deq(cl.created, [{ r: 2, c: 2, piece: { id, kind: -1, special: 'bomb' } }]);
  eq(cl.removed.length, 4);
  eq(cl.gained, 200);
  deq(cl.board[2][2], { id, kind: -1, special: 'bomb' });
  eq(e.stats.cleared[0], 4, 'the piece that became the bomb is not counted');
});

test('cascade: special goes to the middle of the run; cascade multiplier x2; jelly 2 -> 1 -> 0', () => {
  const e = mk(['______', '__1___', '__0___', '__0___', '11_1__', '__0___'],
    { jelly: ['......', '......', '......', '......', '..2...', '......'] });
  const id41 = e.cell(4, 1).id;
  const res = play(e, P(5, 2), P(4, 2));
  const cs = clears(res);
  eq(cs.length, 2, 'one cascade');
  deq(cs[0].groups.map(g => [g.kind, g.shape]), [[0, '3']]);
  deq(cs[0].jellyHits, [{ r: 4, c: 2, left: 1 }]);
  eq(cs[0].gained, 60 + 1000);
  eq(cs[1].cascade, 2);
  deq(cs[1].groups.map(g => [g.kind, g.shape]), [[1, '4']]);
  deq(cs[1].created, [{ r: 4, c: 1, piece: { id: id41, kind: 1, special: 'v' } }]);
  deq(cs[1].jellyHits, [{ r: 4, c: 2, left: 0 }]);
  eq(cs[1].gained, 120 * 2 + 1000);
  eq(res.gained, 1060 + 1240);
  eq(e.stats.cascadesMax, 2);
  eq(e.stats.jellyLeft, 0);
  eq(e.stats.cleared[0], 3); eq(e.stats.cleared[1], 3);
});

test('a new special survives effects fired in its own step', () => {
  const e = mk(['______', '__0___', '0 0h _ 0 _ _', '______', '______']);
  const id = e.cell(1, 2).id;
  const res = play(e, P(1, 2), P(2, 2));
  const cl = firstClear(res);
  deq(cl.effects, [{ fx: 'line', dir: 'h', r: 2, c: 1 }]);
  deq(cl.created, [{ r: 2, c: 2, piece: { id, kind: 0, special: 'v' } }]);
  ok(!cl.removed.some(x => x.r === 2 && x.c === 2), 'receiving cell not removed');
  deq(cl.board[2][2], { id, kind: 0, special: 'v' });
  eq(cl.removed.length, 3 + 2, '3 matched + 2 by the stripe');
});

test('cascade with a stripe: special avoids the striped cell, effect points use the multiplier', () => {
  const e = mk(['______', '__1___', '__0___', '__0___', '1 1h _ 1 _ _', '__0___']);
  const res = play(e, P(5, 2), P(4, 2));
  const cs = clears(res);
  eq(cs.length, 2);
  const c2 = cs[1];
  eq(c2.cascade, 2);
  deq(c2.groups.map(g => [g.shape, g.cells.length]), [['4', 4]]);
  deq(c2.created.map(x => [x.r, x.c, x.piece.kind, x.piece.special]), [[4, 2, 1, 'v']]);
  deq(c2.effects, [{ fx: 'line', dir: 'h', r: 4, c: 1 }]);
  deq(c2.points, [{ r: 4, c: 2, value: 240 }, { r: 4, c: 1, value: 2 * 60 * 2 }]);
  eq(c2.gained, 480);
});

test('"+" shape (cascade / pre-existing) -> wrapped at the intersection, shape "T"', () => {
  const e = mk(['______', '_1____', '111___', '_1____', '____0_', '___0_0']);
  const res = play(e, P(4, 4), P(5, 4));
  const cl = firstClear(res);
  const g1 = cl.groups.find(g => g.kind === 1), g0 = cl.groups.find(g => g.kind === 0);
  eq(g1.shape, 'T'); eq(g1.cells.length, 5); eq(g0.shape, '3');
  deq(cl.created.map(x => [x.r, x.c, x.piece.kind, x.piece.special]), [[2, 1, 1, 'wrap']]);
  eq(cl.gained, 60 + 200);
});

// ---------------------------------------------------------------- activation
test('activation chain: stripe hits wrap hits stripe', () => {
  const e = mk(['_______', '_______', '_______', '0 0h _ 2w _ _ _', '_ _ 0 _ 3v _ _', '_______', '_______']);
  const res = play(e, P(4, 2), P(3, 2));
  const cl = firstClear(res);
  deq(cl.effects, [{ fx: 'line', dir: 'h', r: 3, c: 1 }, { fx: 'blast', r: 3, c: 3, radius: 1 }, { fx: 'line', dir: 'v', r: 4, c: 4 }]);
  const cause = {};
  for (const x of cl.removed) cause[`${x.r},${x.c}`] = x.cause;
  const expect = {};
  for (let c = 0; c < 7; c++) expect[`3,${c}`] = c <= 2 ? 'match' : 'h';
  for (const [r, c] of [[2, 2], [2, 3], [2, 4], [4, 2], [4, 3], [4, 4]]) expect[`${r},${c}`] = 'wrap';
  for (const r of [0, 1, 5, 6]) expect[`${r},4`] = 'v';
  deq(Object.keys(cause).sort(), Object.keys(expect).sort(), 'removed cells');
  for (const k of Object.keys(expect)) eq(cause[k], expect[k], `cause at ${k}`);
  deq(cl.points, [{ r: 3, c: 1, value: 60 + 4 * 60 }, { r: 3, c: 3, value: 6 * 60 }, { r: 4, c: 4, value: 4 * 60 }]);
  eq(cl.gained, 900);
  eq(e.stats.cleared[0], 3); eq(e.stats.cleared[2], 1); eq(e.stats.cleared[3], 1);
});

test('colour bomb hit by an effect clears the most common kind', () => {
  const e = mk(['2_2_2_2', '_2_2_2_', '_______', '0 0h _ _ _ B _', '__0____', '2_2_2_2', '_2_2_2_']);
  const res = play(e, P(4, 2), P(3, 2));
  const cl = firstClear(res);
  eq(cl.effects.length, 2);
  deq(cl.effects[0], { fx: 'line', dir: 'h', r: 3, c: 1 });
  const bomb = cl.effects[1];
  eq(bomb.fx, 'bomb'); eq(bomb.r, 3); eq(bomb.c, 5);
  eq(bomb.targets.length, 14, 'all fourteen 2s');
  ok(!cl.board.some(row => row.some(p => p && p.kind === 2)), 'no 2 left after the clear');
  eq(cl.removed.filter(x => x.cause === 'bomb').length, 14);
  eq(e.stats.cleared[2], 14);
});

// ---------------------------------------------------------------- combos
const comboBoard = (r3, extra = {}) => mk(extra.rows || ['_______', '_______', '_______', r3, '_______', '_______', '_______'], extra.o);

test('combo striped + striped = row + column through the landing cell', () => {
  const e = comboBoard('_ _ _ 0h 1v _ _', { o: { jelly: Array(7).fill('1111111') } });
  const res = play(e, P(3, 3), P(3, 4));
  const cl = firstClear(res);
  eq(cl.cascade, 1);
  deq(cl.groups, []);
  deq(cl.effects, [{ fx: 'line', dir: 'h', r: 3, c: 4 }, { fx: 'line', dir: 'v', r: 3, c: 4 }]);
  const cells = cellSet(cl.removed);
  eq(cells.size, 13);
  for (let i = 0; i < 7; i++) ok(cells.has(`3,${i}`) && cells.has(`${i},4`), 'row 3 and column 4');
  ok(cl.removed.every(x => x.cause === 'combo'), 'cause combo');
  eq(cl.jellyHits.length, 13);
  eq(cl.gained, 13 * 60 + 13 * 1000);
  eq(e.stats.jellyLeft, 49 - 13);
});

test('combo striped + wrapped = 3 rows + 3 columns', () => {
  const e = comboBoard('_ _ _ 0h 1w _ _');
  const res = play(e, P(3, 4), P(3, 3));
  const cl = firstClear(res);
  eq(cl.effects.filter(f => f.fx === 'line' && f.dir === 'h').map(f => f.r).join(), '2,3,4');
  eq(cl.effects.filter(f => f.fx === 'line' && f.dir === 'v').map(f => f.c).join(), '2,3,4');
  const cells = cellSet(cl.removed);
  eq(cells.size, 33);
  for (let i = 0; i < 7; i++) for (const d of [2, 3, 4]) ok(cells.has(`${d},${i}`) && cells.has(`${i},${d}`), 'band');
  eq(e.stats.comboCount, 1, 'order counter: one combo');
  deq(e.stats.combos, { 'stripe+wrap': 1 }, 'combo keys are sorted names');
});

test('combo wrapped + wrapped = 5x5', () => {
  const e = comboBoard('_ _ _ 0w 1w _ _');
  const res = play(e, P(3, 3), P(3, 4));
  const cl = firstClear(res);
  deq(cl.effects, [{ fx: 'blast', r: 3, c: 4, radius: 2 }]);
  const cells = cellSet(cl.removed);
  eq(cells.size, 25);
  for (let r = 1; r <= 5; r++) for (let c = 2; c <= 6; c++) ok(cells.has(`${r},${c}`), `5x5 ${r},${c}`);
});

test('combo wrapped + wrapped explodes twice: after the refill, a second 5x5 blast (cascade 2)', () => {
  const e = comboBoard('_ _ _ 0w 1w _ _');
  const res = play(e, P(3, 3), P(3, 4));
  const clears = res.events.filter(x => x.t === 'clear');
  const blasts = clears.filter(x => x.effects.some(f => f.fx === 'blast' && f.radius === 2 && f.r === 3 && f.c === 4));
  eq(blasts.length >= 2, true, 'two 5x5 blasts');
  eq(blasts[1].cascade, 2, 'the second blast is the first free cascade');
  const i1 = res.events.indexOf(blasts[0]), i2 = res.events.indexOf(blasts[1]);
  eq(res.events.slice(i1 + 1, i2).map(x => x.t).join(), 'fall', 'a refill between the two blasts');
});

test('cascade-friendly refill: new pieces copy a neighbour colour more often than chance', () => {
  // same boards with and without the bias: count free cascades
  const run = bias => {
    let cascades = 0, moves = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const e = createEngine({ kinds: [0, 1, 2, 3, 4], seed, cascadeBias: bias });
      for (let i = 0; i < 8; i++) {
        const h = e.findHint();
        if (!h) break;
        const r = e.swap(h.a, h.b);
        moves++;
        if (r.events.some(x => x.t === 'clear' && x.cascade >= 2)) cascades++;
      }
    }
    return cascades / Math.max(1, moves);
  };
  const off = run(0), on = run(0.18);
  ok(on > off, `free cascades: bias 0 → ${(off * 100).toFixed(1)}%, bias 0.18 → ${(on * 100).toFixed(1)}%`);
});

test('combo bomb + normal = every piece of that kind (specials among them fire)', () => {
  const e = mk(['0_____0', '_______', '__0____', '_ _ _ B 0 _ _', '_______', '_ 0 _ _ _ 0h _', '_______']);
  const res = play(e, P(3, 3), P(3, 4));
  const cl = firstClear(res);
  const bomb = cl.effects[0];
  eq(bomb.fx, 'bomb'); deq([bomb.r, bomb.c], [3, 4]);
  eq(bomb.targets.length, 6);
  deq(cl.effects[1], { fx: 'line', dir: 'h', r: 5, c: 5 });
  ok(!cl.board.some(row => row.some(p => p && p.kind === 0)), 'no 0 left');
  eq(cl.removed.length, 1 + 6 + 5);
  eq(cl.removed.find(x => x.piece.special === 'bomb').cause, 'combo');
  eq(cl.removed.filter(x => x.cause === 'bomb').length, 6);
});

test('combo bomb + striped = every K becomes striped (transform) then all fire', () => {
  const e = mk(['0_____0', '_______', '__0____', '_ _ _ B 0v _ _', '_______', '_0_____', '_______']);
  const res = play(e, P(3, 4), P(3, 3));
  deq(res.events.slice(0, 3).map(x => x.t), ['swap', 'transform', 'clear']);
  const tr = res.events[1];
  deq(tr.cells.map(x => `${x.r},${x.c}`).sort(), ['0,0', '0,6', '2,2', '5,1']);
  ok(tr.cells.every(x => x.piece.kind === 0 && (x.piece.special === 'h' || x.piece.special === 'v')), 'all striped');
  const cl = res.events[2];
  eq(cl.effects[0].fx, 'bomb'); deq([cl.effects[0].r, cl.effects[0].c], [3, 4]);
  eq(cl.effects[0].targets.length, 5);
  eq(cl.effects.filter(f => f.fx === 'line').length, 5, 'each striped K fires');
  ok(!cl.board.some(row => row.some(p => p && p.kind === 0)), 'no 0 left');
});

test('combo bomb + wrapped = every K becomes wrapped then all fire', () => {
  const e = mk(['0_____0', '_______', '__0____', '_ _ _ B 0w _ _', '_______', '_0_____', '_______']);
  const res = play(e, P(3, 3), P(3, 4));
  const tr = res.events[1];
  eq(tr.t, 'transform');
  ok(tr.cells.length === 4 && tr.cells.every(x => x.piece.special === 'wrap'), 'all wrapped');
  const cl = res.events[2];
  eq(cl.effects.filter(f => f.fx === 'blast').length, 5);
});

test('combo bomb + bomb = whole board', () => {
  const e = comboBoard('_ _ _ B B _ _');
  const res = play(e, P(3, 3), P(3, 4));
  const cl = firstClear(res);
  deq(cl.effects, [{ fx: 'board' }]);
  eq(cl.removed.length, 49);
  ok(cl.board.every(row => row.every(p => p === null)), 'board empty after the clear');
  eq(cl.gained, 49 * 60);
});

test('two specials always combo even without a match; bomb swaps are always valid', () => {
  const e = comboBoard('_ _ _ 0h 0h _ _');
  ok(e.findHint(), 'hint finds the combo');
  ok(play(e, P(3, 3), P(3, 4)).ok, 'stripe + stripe of the same kind');
  const e2 = comboBoard('_ _ _ B _ _ _');
  ok(play(e2, P(3, 3), P(2, 3)).ok, 'bomb + background piece');
});

// ---------------------------------------------------------------- gravity, spawn, jelly
test('gravity: holes stop pieces; the cell under a hole is filled by a diagonal slide; spawns only from column tops', () => {
  const e = mk(['__1___', '______', '__2___', '__.___', '__0___', '00____']);
  ok(!e.isCell(3, 2), 'hole');
  const id2 = e.cell(2, 2).id;
  const res = play(e, P(4, 2), P(5, 2));
  const fall = res.events.find(x => x.t === 'fall');
  ok(!fall.moves.some(m => m.id === id2), 'the piece above the hole stays (it cannot fall through)');
  const slid = fall.moves.find(m => m.to.r === 4 && m.to.c === 2);
  ok(slid && slid.path && slid.from.r === 3 && Math.abs(slid.from.c - 2) === 1, 'the cell under the hole is filled diagonally');
  deq(fall.spawns.map(s => [s.from.r, s.from.c, s.to.r, s.to.c]).sort(), [[-1, 0, 0, 0], [-1, 1, 0, 1], [-1, slid.from.c, 0, slid.from.c]].sort());
  for (const ev of res.events) eq(ev.board[3][2], null, `hole stays empty in ${ev.t}`);
});

test('a column cut off by holes on both sides above still fills (diagonal from a neighbour)', () => {
  // col 2 rows 3–5 sit under holes; col 1 / col 3 feed them sideways
  const e = mk(['______', '__.___', '__.___', '______', '______', '______']);
  for (let i = 0; i < 6; i++) {
    const h = e.findHint();
    if (!h) break;
    const res = play(e, h.a, h.b);
    for (const ev of res.events) eq(ev.board[1][2], null, 'hole stays empty');
    for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) if (e.isCell(r, c)) ok(e.cell(r, c), `cell ${r},${c} filled after move ${i}`);
  }
});

test('column with holes on top still refills from above; multiple spawns stack -1, -2, -3', () => {
  const e = mk(['. . _ _', '. . _ _', '_ 0 _ _', '_ 0 _ _', '0 _ _ _', '_ _ _ _']);
  const res = play(e, P(4, 0), P(4, 1));
  const fall = res.events.find(x => x.t === 'fall');
  const col1 = fall.spawns.filter(s => s.to.c === 1).sort((a, b) => b.to.r - a.to.r);
  deq(col1.map(s => [s.from.r, s.to.r]), [[-1, 4], [-2, 3], [-3, 2]]);
});

test('jelly: matched cells (incl. the new special) lose one layer, 1,000 points each, jellyLeft', () => {
  const e = mk(['______', '__0___', '00_0__', '______', '______'], { jelly: ['......', '......', '1221..', '......', '......'] });
  eq(e.stats.jellyLeft, 6);
  const res = play(e, P(1, 2), P(2, 2));
  const cl = firstClear(res);
  deq(cl.jellyHits.map(x => [x.r, x.c, x.left]).sort(), [[2, 0, 0], [2, 1, 1], [2, 2, 1], [2, 3, 0]]);
  eq(cl.gained, 120 + 4000);
  eq(e.stats.jellyLeft, 2);
  eq(e.jellyAt(2, 1), 1); eq(e.jellyAt(2, 2), 1); eq(e.jellyAt(2, 0), 0);
});

// ---------------------------------------------------------------- scoring
test('scoring (Candy Crush): 3 = 60, 4 = 120, L/T = 200, 5 = 200, effect pieces 60 x multiplier, jelly 1,000', () => {
  const e = mk(['______', '__0___', '00____', '______']);
  eq(play(e, P(1, 2), P(2, 2)).gained, 60);
  const e2 = mk(['_______', '_ _ 0 _ _ _ _', '_ 0h _ _ _ _ _', '_ 0 _ _ _ _ _', '_______']);
  // vertical 3 with an "h" stripe inside: 60 + 6 other pieces of the row x 60
  const res = play(e2, P(1, 2), P(1, 1));
  eq(firstClear(res).gained, 60 + 6 * 60);
  // the numbers are exported for the app / simulator
  const { SCORE } = engineMod;
  deq(SCORE.match, { '3': 60, '4': 120, L: 200, T: 200, '5': 200, square: 120 });
  eq(SCORE.squareExtra, 60); eq(SCORE.effect, 60); eq(SCORE.jelly, 1000); eq(SCORE.sugarMove, 3000);
  // multiplier x1, x2, x3: the 0s match (move), the 1 falls into a row of 1s (cascade 2), then the 2s line up (cascade 3)
  const e3 = mk(['_____', '__2__', '__1__', '__2__', '__2__', '_101_', '__0__', '_0___']);
  const cs = clears(play(e3, P(7, 1), P(7, 2)));
  deq(cs.map(c => [c.cascade, c.groups.map(g => `${g.kind}:${g.shape}`).join(), c.gained]),
    [[1, '0:3', 60], [2, '1:3', 120], [3, '2:3', 180]]);
});

test('addScore adds flat bonus points (main.js: completed goal level lifted to 1 star)', () => {
  const e = mk(['______', '__0___', '00____', '______']);
  eq(e.addScore(2500), 2500); eq(e.score, 2500);
  eq(e.addScore(-50), 2500, 'never negative'); eq(e.addScore('x'), 2500);
  eq(play(e, P(1, 2), P(2, 2)).gained, 60); eq(e.score, 2560);
});

// ---------------------------------------------------------------- shuffle, hint, sugar crush
test('shuffle keeps the same pieces, leaves no match and a valid move', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const mask = Object.values(MASKS)[seed % 5];
    const e = createEngine({ kinds: [0, 1, 2, 3, 4], seed, mask, ...maskSize(mask) });
    const before = e.snapshot();
    const evs = e.shuffle();
    eq(evs.length, 1); eq(evs[0].t, 'shuffle');
    const after = e.snapshot();
    const ms = g => g.flat().filter(Boolean).map(p => `${p.id}:${p.kind}:${p.special}`).sort().join();
    eq(ms(after.grid), ms(before.grid), 'same multiset of pieces');
    ok(!matchesIn(after.grid).length, 'no match');
    ok(e.hasValidMove(), 'has move');
    replayEvents(before.grid, before.jelly, evs);
    eq(evs[0].moves.length, after.grid.flat().filter(Boolean).length, 'a move entry per piece');
  }
});

test('dead board: hasValidMove false, findHint null, shuffle fixes it', () => {
  const rowsA = ['010101', '232323', '010101', '232323', '010101', '232323'];
  const e = createEngine({ kinds: [0, 1, 2, 3], layout: rowsA, seed: 5 });
  eq(e.hasValidMove(), false); eq(e.findHint(), null);
  const before = e.snapshot();
  e.shuffle();
  ok(e.hasValidMove() && !matchesIn(e.snapshot().grid).length, 'playable after shuffle');
  const ms = g => g.flat().map(p => `${p.id}:${p.kind}`).sort().join();
  eq(ms(e.snapshot().grid), ms(before.grid));
});

test('last-resort shuffle (kinds re-rolled) is still replayable from its event', () => {
  // 3x3 with one of each-ish: no arrangement of these pieces has a move, so the shuffle must re-roll kinds
  const e = createEngine({ kinds: [0, 1, 2, 3, 4], layout: ['0 1 2', '3 4 0', '1 2 3'], seed: 3 });
  eq(e.hasValidMove(), false);
  const before = e.snapshot();
  const evs = e.shuffle();
  ok(e.hasValidMove() && !matchesIn(e.snapshot().grid).length, 'playable after shuffle');
  ok(evs[0].moves.every(m => m.piece && m.piece.id === m.id), 'every move carries its piece');
  replayEvents(before.grid, before.jelly, evs);
});

test('boosters: smash / freeSwap / airDrop keep every invariant and replay exactly', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const e = createEngine({ kinds: [0, 1, 2, 3, 4], rows: 9, cols: 7, seed });
    const rnd = mulberry(seed * 77);
    for (const kind of ['smash', 'freeSwap', 'airDrop']) {
      const before = e.snapshot();
      let res;
      if (kind === 'smash') res = e.smash({ r: Math.floor(rnd() * 9), c: Math.floor(rnd() * 7) });
      else if (kind === 'freeSwap') {
        const r = Math.floor(rnd() * 9), c = Math.floor(rnd() * 6);
        res = e.freeSwap({ r, c }, { r, c: c + 1 });
      } else res = e.airDrop(3);
      ok(res.ok, `${kind} ok (seed ${seed})`);
      replayEvents(before.grid, before.jelly, res.events);
      const g = e.snapshot().grid;
      ok(g.every(row => row.every(p => p)), `${kind}: board full`);
      ok(!matchesIn(g).length, `${kind}: no match left`);
      ok(e.hasValidMove(), `${kind}: a move exists`);
      const ids = g.flat().map(p => p.id);
      eq(new Set(ids).size, ids.length, `${kind}: ids unique`);
    }
  }
  // freeSwap of two non-matching pieces just swaps them (no swapBack)
  const e2 = createEngine({ kinds: [0, 1, 2, 3], layout: ['0 1 2 3', '1 2 3 0', '2 3 0 1', '3 0 1 2'], seed: 2 });
  const r2 = e2.freeSwap({ r: 0, c: 0 }, { r: 0, c: 1 });
  ok(r2.ok && r2.events[0].t === 'swap' && !r2.events.some(x => x.t === 'swapBack'), 'free swap without a match');
  if (!r2.events.some(x => x.t === 'shuffle')) { eq(e2.cell(0, 0).kind, 1); eq(e2.cell(0, 1).kind, 0); }
  else eq(r2.events[0].t, 'swap');   // 小盤面換完沒步可走 → 自動洗牌
  // airDrop makes wrapped pieces that fire
  const e3 = createEngine({ kinds: [0, 1, 2, 3, 4], rows: 9, cols: 7, seed: 9 });
  const r3 = e3.airDrop(3);
  eq(r3.events[0].t, 'transform'); eq(r3.events[0].cells.length, 3);
  ok(r3.events[0].cells.every(x => x.piece.special === 'wrap'), 'three wrapped');
  ok(r3.events[1].effects.filter(x => x.fx === 'blast').length >= 3, 'they blast');
});

test('findHint prefers bigger matches', () => {
  const e = mk(['_______', '__0____', '00_00__', '_______', '_1_____', '1_1____']);
  const h = e.findHint();
  deq(cellSet([h.a, h.b]), cellSet([P(1, 2), P(2, 2)]));
  // a combo is preferred over a plain match
  const e3 = mk(['_______', '_ _ _ 0w 1h _ _', '_______', '_1_____', '1_1____']);
  const h3 = e3.findHint();
  deq(cellSet([h3.a, h3.b]), cellSet([P(1, 3), P(1, 4)]));
});

test('sugarCrush: every move left = 3,000 + a random striped / wrapped piece that fires (waves of 5), then leftovers fire', () => {
  const e = createEngine({ kinds: [0, 1, 2, 3, 4], seed: 11, jelly: Array(8).fill('11111111') });
  const before = e.snapshot();
  const ctx = newCtx(e);
  const res = e.sugarCrush(7);
  const trs = res.events.filter(x => x.t === 'transform');
  eq(trs.length, 7, 'one transform per move');
  ok(trs.every(t => t.sugar === true && t.gained === 3000 && t.cells.length === 1 && ['h', 'v', 'wrap'].includes(t.cells[0].piece.special)), 'random striped / wrapped, 3,000 each');
  ok(trs.every(t => t.points.length === 1 && t.points[0].value === 3000 && t.points[0].r === t.cells[0].r && t.points[0].c === t.cells[0].c), 'label on the piece');
  // waves: 5 transforms, the clear that fires them, …, then 2 transforms and their clear
  const kinds = res.events.map(x => x.t);
  deq(kinds.slice(0, 6), ['transform', 'transform', 'transform', 'transform', 'transform', 'clear']);
  const firstWave = res.events[5];
  for (const t of trs.slice(0, 5)) ok(firstWave.removed.some(x => x.piece.id === t.cells[0].piece.id), 'each converted piece fires in its wave');
  const w2 = kinds.indexOf('transform', 6);
  ok(w2 > 6 && kinds.slice(w2, w2 + 3).join() === 'transform,transform,clear', `second wave of 2 (${kinds.join()})`);
  ok(res.gained > 7 * 3000 + 7 * 7 * 60, `gained ${res.gained}`);
  eq(e.score, res.gained);
  checkResult(e, before, { ok: true, ...res }, ctx, { sugar: true });
  ok(!e.snapshot().grid.flat().some(p => p && p.special !== 'none'), 'no special left');
  deq(e.sugarCrush(0).events, [], 'sugarCrush(0) does nothing on a board without specials');
  // sugarCrush(0) on a board with specials: they fire (a score level ran out of moves), no bonus
  const e0 = mk(['_ _ _ _ _ _', '_ 0h _ _ _ _', '_ _ _ _ _ _', '_ _ _ 1w _ _', '_ _ _ _ _ _']);
  const b0 = e0.snapshot(), c0 = newCtx(e0);
  const r0 = e0.sugarCrush(0);
  checkResult(e0, b0, { ok: true, ...r0 }, c0, { sugar: true });
  ok(!r0.events.some(x => x.t === 'transform'), 'no transform for 0 moves');
  eq(r0.events[0].t, 'clear');
  eq(r0.events[0].removed.length, 6 + 9, 'row 1 + the 3x3 around (3,3)');
  eq(r0.events[0].gained, 15 * 60, 'effect pieces 60 each');
  // specials made by sugar-crush cascades are fired too, until none is left
  let rounds = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const e2 = createEngine({ kinds: [0, 1, 2, 3], seed, antiCascade: 0 });
    const b2 = e2.snapshot(), c2 = newCtx(e2);
    const r2 = e2.sugarCrush(12);
    checkResult(e2, b2, { ok: true, ...r2 }, c2, { sugar: true });
    ok(!e2.snapshot().grid.flat().some(p => p && p.special !== 'none'), `seed ${seed}: special left after sugarCrush`);
    eq(r2.events.filter(x => x.t === 'transform').length, 12, 'one transform per move');
    rounds += r2.events.filter(x => x.t === 'clear' && x.cascade === 1).length;
  }
  ok(rounds > 40 * 3, 'three waves (5 + 5 + 2) and some leftover rounds');
  // a board with no normal piece left still pays 3,000 per move
  const eb = createEngine({ kinds: [0, 1, 2], layout: ['B B B', 'B B B'], seed: 2 });
  const bb = eb.snapshot(), cb = newCtx(eb);
  const rb = eb.sugarCrush(2);
  checkResult(eb, bb, { ok: true, ...rb }, cb, { sugar: true });
  ok(rb.events.slice(0, 2).every(x => x.t === 'transform' && x.cells.length === 0 && x.gained === 3000), 'empty transforms still pay');
});

// ---------------------------------------------------------------- statistics
test('anti-cascade: far fewer free cascades at 0.9 than at 0', () => {
  const rate = ac => {
    let moves = 0, withCascade = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const e = createEngine({ kinds: [0, 1, 2, 3, 4], seed, antiCascade: ac });
      for (let i = 0; i < 20; i++) {
        const h = e.findHint();
        const res = e.swap(h.a, h.b);
        moves++;
        if (clears(res).length > 1) withCascade++;
      }
    }
    return withCascade / moves;
  };
  const r0 = rate(0), r9 = rate(0.9);
  note(`moves with a free cascade: antiCascade 0 -> ${(r0 * 100).toFixed(1)}%, 0.9 -> ${(r9 * 100).toFixed(1)}%`);
  // anti-cascade only picks the kinds of new pieces; 2×2 squares also form from pieces that were already on the
  // board falling together, so with squares the drop is about ×0.65 (it was ×0.55 with lines only)
  ok(r9 < r0 * 0.72, `expected far fewer cascades (${r0.toFixed(3)} vs ${r9.toFixed(3)})`);
});

// ---------------------------------------------------------------- board mechanics (blockers)
// obstacles: rows of characters over a hand-made board ('.' = nothing)
const mo = (rowsArr, obstacles, o = {}) => mk(rowsArr, { obstacles, ...o });
const evOf = (res, t) => res.events.filter(x => x.t === t);
// the board after the move but before any auto-shuffle (hand-made boards often end without a move)
const bb = res => { const evs = res.events.filter(x => x.t !== 'shuffle'); return evs[evs.length - 1].board; };

test('cage: a caged piece cannot be swapped; a match through the cage breaks it and the piece stays', () => {
  const e = mo(['______', '______', '00____', '__0___', '______', '______'],
    ['......', '......', 'L.....', '......', '......', '......']);
  eq(e.lockAt(2, 0), 1);
  eq(e.stats.locksLeft, 1);
  const id = e.cell(2, 0).id;
  const bad = e.swap(P(2, 0), P(3, 0));
  ok(!bad.ok && bad.events.length === 0, 'caged piece does not swap');
  const res = play(e, P(3, 2), P(2, 2));
  const cl = firstClear(res);
  deq(cl.unlocks, [{ r: 2, c: 0 }], 'cage breaks');
  ok(!cl.removed.some(x => x.r === 2 && x.c === 0), 'the caged piece is not removed');
  eq(cl.removed.length, 2);
  eq(e.lockAt(2, 0), 0); eq(e.stats.locksLeft, 0);
  eq(bb(res)[2][0].id, id, 'same piece is still there');
});

test('cage: a caged piece does not fall and nothing falls through it; an effect also breaks it', () => {
  // col 1: caged piece at row 2 over the 3-in-a-row on row 3
  const e = mo(['______', '______', '______', '_0_0__', '__0___', '______'],
    ['......', '......', '.L....', '......', '......', '......']);
  const caged = e.cell(2, 1).id, above = e.cell(1, 1).id;
  const res = play(e, P(4, 2), P(3, 2));
  eq(bb(res)[2][1].id, caged, 'caged piece stays put');
  eq(bb(res)[1][1].id, above, 'the piece above the cage stays put');
  const fall = evOf(res, 'fall')[0];
  ok(!fall.moves.some(m => m.id === caged || m.id === above), 'no fall move for the caged column above the cage');
  ok(bb(res)[3][1], 'the cell under the cage is refilled (sideways)');
  // a row stripe through a cage: the cage breaks, the piece stays
  const e2 = mo(['______', '______', '_ 0 0h _ _ _', '___0__', '______', '______'],
    ['......', '......', '.....L', '......', '......', '......']);
  const id2 = e2.cell(2, 5).id;
  const r2 = play(e2, P(3, 3), P(2, 3));
  ok(r2.events.some(x => x.t === 'clear' && (x.unlocks || []).some(u => u.r === 2 && u.c === 5)), 'stripe breaks the cage');
  eq(e2.lockAt(2, 5), 0);
  eq(bb(r2)[2][5].id, id2, 'the piece that was caged is still there');
});

test('gift: a wrapped special cannot be swapped and does not fall; a match next to it opens the wrap, the special stays unfired', () => {
  const e = mo(['______', '______', '00_1__', '__0___', '______', '______'],
    ['......', '......', '...-..', '......', '......', '......']);
  eq(e.lockAt(2, 3), 2);
  eq(e.stats.giftLeft, 1); eq(e.stats.locksLeft, 0, 'a gift is not a cage');
  eq(e.cell(2, 3).special, 'h', 'the starting piece keeps its colour and becomes a striped piece');
  eq(e.cell(2, 3).kind, 1);
  const id = e.cell(2, 3).id;
  ok(!e.swap(P(2, 3), P(2, 4)).ok, 'a gift cannot be swapped');
  const res = play(e, P(3, 2), P(2, 2));
  const cl = firstClear(res);
  deq(cl.unlocks, [{ r: 2, c: 3, gift: true }], 'the match next to it opens the wrap');
  eq(cl.removed.length, 3, 'only the match is removed; the stripe inside does not fire');
  eq(e.lockAt(2, 3), 0); eq(e.stats.giftLeft, 0);
  eq(bb(res)[2][3].id, id, 'same piece is still there');
  eq(bb(res)[2][3].special, 'h', 'still striped');
});

test('gift: an effect opens it without firing it; an unwrapped colour bomb can be used', () => {
  // a row stripe through a wrapped vertical stripe: the wrap opens, its column is not cleared
  const e = mo(['______', '______', '_ 0 0h _ _ _', '___0__', '______', '______'],
    ['......', '......', '.....|', '......', '......', '......']);
  eq(e.cell(2, 5).special, 'v');
  const id = e.cell(2, 5).id;
  const res = play(e, P(3, 3), P(2, 3));
  ok(res.events.some(x => x.t === 'clear' && (x.unlocks || []).some(u => u.r === 2 && u.c === 5 && u.gift)), 'the stripe opens the gift');
  const cl = firstClear(res);
  ok(!cl.removed.some(x => x.c === 5), 'the stripe inside did not fire');
  eq(bb(res)[2][5].id, id); eq(e.lockAt(2, 5), 0);
  // B = a wrapped colour bomb: no colour, cannot be swapped until a match next to it opens it
  const e2 = mo(['______', '______', '00____', '__0___', '______', '______'],
    ['......', '......', '...B..', '......', '......', '......']);
  eq(e2.cell(2, 3).special, 'bomb'); ok(e2.cell(2, 3).kind < 0, 'a bomb has no colour');
  ok(!e2.swap(P(2, 3), P(2, 4)).ok, 'a wrapped bomb cannot be swapped');
  const r1 = play(e2, P(3, 2), P(2, 2));
  deq(firstClear(r1).unlocks, [{ r: 2, c: 3, gift: true }]);
  eq(e2.cell(2, 3).special, 'bomb', 'the bomb is still there, unfired');
  const r2 = play(e2, P(2, 3), P(2, 4));
  ok(r2.ok, 'now it can be used');
  ok(firstClear(r2).removed.length >= 3, 'the colour bomb fires');
});

test('frosting: 2 layers; a match next to it removes one layer, the second match removes it; it never moves', () => {
  const e = mo(['______', '______', '______', '00_0__', '______', '______'],
    ['......', '......', '..2...', '......', '......', '......']);
  eq(e.cell(2, 2).block, 'frost'); eq(e.cell(2, 2).hp, 2); eq(e.stats.frostLeft, 2);
  const above = e.cell(1, 2).id;
  const bad = e.swap(P(2, 2), P(3, 2));
  ok(!bad.ok, 'frosting cannot be swapped');
  const res = play(e, P(3, 3), P(3, 2));
  const cl = firstClear(res);
  deq(cl.blockerHits, [{ r: 2, c: 2, block: 'frost', left: 1 }]);
  eq(e.cell(2, 2).hp, 1); eq(e.stats.frostLeft, 1);
  eq(bb(res)[1][2].id, above, 'the piece above the frosting does not fall');
  ok(cl.points.reduce((s, p) => s + p.value, 0) > 60, 'a layer is worth points');
  // second hit: an effect (bomb on the whole board) removes the last layer
  const e2 = mo(['______', '______', '______', '00_0__', '______', '______'],
    ['......', '......', '..1...', '......', '......', '......']);
  const r2 = play(e2, P(3, 3), P(3, 2));
  ok(firstClear(r2).removed.some(x => x.r === 2 && x.c === 2 && x.piece.block === 'frost' && x.cause === 'near'), 'removed by the match next to it');
  eq(e2.stats.frostLeft, 0);
  ok(!e2.cell(2, 2).block, 'the cell refills once the frosting is gone');
});

test('frosting: 3 layers, a striped beam takes one layer per hit', () => {
  const e = mo(['______', '______', '_ 0 0h _ _ _', '___0__', '______', '______'],
    ['......', '......', '.....3', '......', '......', '......']);
  const res = play(e, P(3, 3), P(2, 3));
  ok(res.events.some(x => x.t === 'clear' && (x.blockerHits || []).some(b => b.r === 2 && b.c === 5 && b.left === 2)), 'beam hits the frosting once');
  eq(e.cell(2, 5).hp, 2); eq(e.stats.frostLeft, 2);
});

test('shell: a match next to it does nothing; it cannot be swapped and never moves', () => {
  const e = mo(['______', '______', '______', '00_0__', '______', '______'],
    ['......', '......', '..X...', '......', '......', '......']);
  eq(e.cell(2, 2).block, 'shell'); eq(e.cell(2, 2).hp, 1); eq(e.stats.shellLeft, 1);
  ok(e.cell(2, 2).kind < 0, 'shells have no colour');
  const sid = e.cell(2, 2).id, above = e.cell(1, 2).id;
  ok(!e.swap(P(2, 2), P(3, 2)).ok, 'a shell cannot be swapped');
  const res = play(e, P(3, 3), P(3, 2));
  const cl = firstClear(res);
  ok(!(cl.blockerHits || []).some(b => b.block === 'shell'), 'no layer taken by the match next to it');
  ok(!cl.removed.some(x => x.piece.id === sid), 'not removed by the match next to it');
  eq(bb(res)[1][2].id, above, 'the piece above the shell does not fall');
});

test('shell: effects crack it, one layer per hit (Y = 2 layers), then it is gone and the cell refills', () => {
  const e = mo(['______', '______', '_ 0 0h _ _ _', '___0__', '______', '______'],
    ['......', '......', '.....Y', '......', '......', '......']);
  eq(e.stats.shellLeft, 2);
  const res = play(e, P(3, 3), P(2, 3));
  ok(res.events.some(x => x.t === 'clear' && (x.blockerHits || []).some(b => b.r === 2 && b.c === 5 && b.block === 'shell' && b.left === 1)), 'the beam takes one layer');
  eq(e.cell(2, 5).block, 'shell'); eq(e.cell(2, 5).hp, 1); eq(e.stats.shellLeft, 1);
  const e2 = mo(['______', '______', '_ 0 0h _ _ _', '___0__', '______', '______'],
    ['......', '......', '.....X', '......', '......', '......']);
  const sid = e2.cell(2, 5).id;
  const r2 = play(e2, P(3, 3), P(2, 3));
  ok(r2.events.some(x => x.t === 'clear' && x.removed.some(y => y.piece.id === sid && y.piece.block === 'shell')), 'one beam breaks a 1-layer shell');
  eq(e2.stats.shellLeft, 0);
  ok(!(e2.cell(2, 5).block === 'shell'), 'the cell refills once the shell is gone');
  // the hammer cracks it too
  const e3 = mo(['______', '______', '______', '______', '______', '______'],
    ['......', '......', '......', '......', '......', '....X.']);
  ok(e3.smash(P(5, 4)).ok, 'smash works on a shell');
  eq(e3.stats.shellLeft, 0);
});

test('chocolate: a match next to it removes it (no spread); a move that breaks none grows it into a neighbour', () => {
  const e = mo(['______', '______', '______', '00_0__', '______', '______'],
    ['......', '......', '..C...', '......', '......', '......']);
  eq(e.stats.chocoLeft, 1);
  const res = play(e, P(3, 3), P(3, 2));
  ok(firstClear(res).removed.some(x => x.piece.block === 'choco'), 'chocolate removed');
  eq(evOf(res, 'spread').length, 0, 'no spread on a move that broke chocolate');
  eq(e.stats.chocoLeft, 0);
  eq(e.stats.chocoGot, 1, 'order counter: chocolate broken');
  // far away from the chocolate: it spreads
  const e2 = mo(['______', '______', '______', '______', '______', '00_0__'],
    ['C.....', '......', '......', '......', '......', '......']);
  const r2 = play(e2, P(5, 3), P(5, 2));
  const sp = evOf(r2, 'spread');
  eq(sp.length, 1, 'one spread');
  deq(sp[0].from, { r: 0, c: 0 });
  ok((sp[0].to.r === 1 && sp[0].to.c === 0) || (sp[0].to.r === 0 && sp[0].to.c === 1), 'into a neighbour');
  eq(e2.cell(sp[0].to.r, sp[0].to.c).block, 'choco');
  eq(e2.stats.chocoLeft, 2);
  ok(sp[0].was && sp[0].was.kind >= 0, 'the eaten piece is reported');
});

test('chocolate pot: never moves or breaks; a move that broke no chocolate spits one onto the nearest normal piece', () => {
  const e = mo(['______', '______', '______', '______', '______', '00_0__'],
    ['P.....', '......', '......', '......', '......', '......']);
  eq(e.cell(0, 0).block, 'pot');
  ok(e.cell(0, 0).kind < 0, 'pots have no colour');
  eq(e.stats.chocoLeft, 0);
  const pid = e.cell(0, 0).id;
  ok(!e.swap(P(0, 0), P(0, 1)).ok, 'a pot cannot be swapped');
  const r = play(e, P(5, 3), P(5, 2));
  const sp = evOf(r, 'spread');
  eq(sp.length, 1, 'one chocolate spat');
  deq(sp[0].from, { r: 0, c: 0 });
  ok((sp[0].to.r === 1 && sp[0].to.c === 0) || (sp[0].to.r === 0 && sp[0].to.c === 1), 'onto the nearest normal piece');
  eq(e.cell(sp[0].to.r, sp[0].to.c).block, 'choco');
  eq(e.stats.chocoLeft, 1);
  eq(e.cell(0, 0).id, pid, 'the pot stays');
  // nearest = by distance: its neighbours are frosting, so it lands two steps away
  const e2 = mo(['______', '______', '______', '______', '______', '00_0__'],
    ['......', '..1...', '.1P1..', '..1...', '......', '......']);
  const s2 = evOf(play(e2, P(5, 3), P(5, 2)), 'spread');
  eq(s2.length, 1);
  eq(Math.abs(s2[0].to.r - 2) + Math.abs(s2[0].to.c - 2), 2, 'two steps from the pot');
  // a move that breaks chocolate: no spitting
  const e3 = mo(['______', '______', '______', '00_0__', '______', '______'],
    ['P.....', '......', '..C...', '......', '......', '......']);
  const r3 = play(e3, P(3, 3), P(3, 2));
  ok(firstClear(r3).removed.some(x => x.piece.block === 'choco'), 'chocolate removed');
  eq(evOf(r3, 'spread').length, 0, 'no spit on a move that broke chocolate');
  eq(e3.stats.chocoGot, 1);
  // cap: pot.max chocolates on the board → no spit, and with a pot plain chocolate does not grow on its own
  const e4 = mo(['______', '______', '______', '______', '______', '00_0__'],
    ['P....C', '......', 'C.....', '......', '.....C', '......'], { pot: { max: 3 } });
  eq(e4.stats.chocoLeft, 3);
  eq(evOf(play(e4, P(5, 3), P(5, 2)), 'spread').length, 0, 'full: nothing spat, nothing grows');
  eq(e4.stats.chocoLeft, 3);
  const e5 = mo(['______', '______', '______', '______', '______', '00_0__'],
    ['P....C', '......', '......', '......', '......', '......'], { pot: { max: 3 } });
  const s5 = evOf(play(e5, P(5, 3), P(5, 2)), 'spread');
  eq(s5.length, 1, 'below the cap it spits');
  deq(s5[0].from, { r: 0, c: 0 }, 'the pot spits, the old chocolate does not grow');
  // effects and the hammer cannot break it
  const e6 = mo(['______', '______', '_ 0 0h _ _ _', '___0__', '______', '______'],
    ['......', '......', '.....P', '......', '......', '......']);
  const p6 = e6.cell(2, 5).id;
  const r6 = play(e6, P(3, 3), P(2, 3));
  ok(!r6.events.some(x => x.t === 'clear' && x.removed.some(y => y.piece.id === p6)), 'a striped beam does not break it');
  eq(e6.cell(2, 5).id, p6);
  ok(!e6.smash(P(2, 5)).ok, 'the hammer refuses a pot');
  eq(e6.cell(2, 5).id, p6);
});

test('chocolate pot: with dinos and no exit marked, the cell above a pot is an exit', () => {
  const e = mo(['______', '______', '______', '______', '______', '______'],
    ['......', '......', '......', '......', '......', '..P...'], { dinos: { total: 1, onBoard: 0, rate: 0 } });
  ok(e.isExit(4, 2), 'above the pot');
  ok(!e.isExit(5, 2), 'not the pot itself');
  ok(e.isExit(5, 0) && !e.isExit(4, 0), 'bottom row elsewhere');
});

test('licorice swirl: never matches, can be swapped, removed by a match next to it, stops a striped beam', () => {
  // three swirls in a row are no match
  const e = mo(['______', '______', '______', '______', '______', '______'],
    ['......', '......', 'SSS...', '......', '......', '......']);
  eq(e.stats.licoriceLeft, 3);
  eq(e.cell(2, 0).block, 'licorice');
  ok(e.cell(2, 0).kind < 0, 'swirls have no colour');
  // swapped into place: the swirl moves, the piece it traded with matches
  const e2 = mo(['______', '______', '00____', '__0___', '______', '______'],
    ['......', '......', '..S...', '......', '......', '......']);
  const sid = e2.cell(2, 2).id;
  const res = play(e2, P(2, 2), P(3, 2));
  const cl = firstClear(res);
  ok(cl.removed.some(x => x.piece.id === sid && x.cause === 'near'), 'the swirl next to the match is removed');
  // beam stops at a swirl
  const e3 = mo(['________', '________', '_ 0 0h _ _ _ _ _', '___0____', '________', '________'],
    ['........', '........', '......S.', '........', '........', '........']);
  const behind = e3.cell(2, 7).id;
  const r3 = play(e3, P(3, 3), P(2, 3));
  const line = r3.events.filter(x => x.t === 'clear').flatMap(x => x.effects).find(f => f.fx === 'line' && f.dir === 'h' && f.r === 2);
  ok(line && line.reach && line.reach[0] === 0 && line.reach[1] === 6, `beam stops at the swirl: ${JSON.stringify(line)}`);
  const cl3 = r3.events.find(x => x.t === 'clear' && x.effects.length);
  ok(cl3.removed.some(x => x.r === 2 && x.c === 6 && x.piece.block === 'licorice'), 'the swirl itself is removed');
  ok(!cl3.removed.some(x => x.r === 2 && x.c === 7), 'the piece behind it is safe');
  eq(bb(r3)[2][7].id, behind, 'still there');
});

test('alarm: a match next to it takes it out (no tick for it); otherwise it counts down once per move', () => {
  // the match at row 3 is next to the alarm at (2,2): it goes, nothing is left to tick
  const e = mo(['______', '______', '______', '00_0__', '______', '______'],
    ['......', '......', '..A...', '......', '......', '......'], { alarm: { timer: 5 } });
  eq(e.stats.alarmsLeft, 1);
  eq(e.cell(2, 2).block, 'alarm'); eq(e.cell(2, 2).hp, 5);
  ok(e.cell(2, 2).kind < 0, 'alarms have no colour');
  const aid = e.cell(2, 2).id;
  const res = play(e, P(3, 3), P(3, 2));
  ok(firstClear(res).removed.some(x => x.piece.id === aid && x.cause === 'near'), 'the alarm next to the match is removed');
  eq(evOf(res, 'tick').length, 0, 'nothing ticks');
  eq(res.alarms, 0);
  eq(e.stats.alarmsLeft, 0); eq(e.stats.alarmsBurst, 0);
  // far away: it ticks 5 -> 4
  const e2 = mo(['______', '______', '______', '______', '______', '00_0__'],
    ['A.....', '......', '......', '......', '......', '......'], { alarm: { timer: 5 } });
  const a2 = e2.cell(0, 0).id;
  const r2 = play(e2, P(5, 3), P(5, 2));
  const tk = evOf(r2, 'tick');
  eq(tk.length, 1);
  eq(tk[0].cells.length, 1); eq(tk[0].cells[0].hp, 4);
  const at = tk[0].cells[0];
  eq(e2.cell(at.r, at.c).id, a2, 'the tick names the alarm where it stands (it fell one row)');
  eq(e2.cell(at.r, at.c).hp, 4);
  eq(r2.alarms, 0);
});

test('alarm: at 0 it bursts (alarm event, fall, cascade numbering goes on), swap() returns how many burst', () => {
  const e = mo(['______', '______', '______', '______', '______', '00_0__'],
    ['A.....', '......', '......', '......', '......', '......'], { alarm: { timer: 1 } });
  const id = e.cell(0, 0).id;
  const res = play(e, P(5, 3), P(5, 2));
  const types = res.events.map(x => x.t);
  const ti = types.indexOf('tick');
  ok(ti > 0 && types[ti + 1] === 'alarm' && types[ti + 2] === 'fall', `tick -> alarm -> fall: ${types.join(',')}`);
  deq(evOf(res, 'alarm')[0].cells.map(x => [x.r, x.c, x.piece.id]), [[1, 0, id]], 'it fell one row, then burst');
  eq(res.alarms, 1);
  eq(e.stats.alarmsLeft, 0); eq(e.stats.alarmsBurst, 1);
  ok(!e.snapshot().grid.flat().some(p => p && p.block === 'alarm'), 'gone from the board');
  // boosters do not tick alarms
  const e2 = mo(['______', '______', '______', '______', '______', '______'],
    ['A.....', '......', '......', '......', '......', '......'], { alarm: { timer: 2 } });
  e2.smash(P(4, 4));
  eq(e2.cell(0, 0).hp, 2, 'smash does not tick');
});

test('alarm: spawns from the top at the given rate, never more than max on the board; every invariant holds', () => {
  let maxSeen = 0, bursts = 0, ticks = 0, spawned = 0;
  for (let g = 0; g < Math.max(4, FUZZ); g++) {
    const e = createEngine({ kinds: [0, 1, 2, 3, 4], seed: 700 + g * 37, alarm: { timer: 4, rate: 0.15, max: 2 } });
    const ctx = newCtx(e);
    for (let m = 0; m < 40; m++) {
      const h = e.findHint();
      if (!h) break;
      const before = e.snapshot();
      const res = e.swap(h.a, h.b);
      checkResult(e, before, res, ctx);
      eq(res.alarms, evOf(res, 'alarm').reduce((n, x) => n + x.cells.length, 0), 'alarms = burst count');
      ticks += evOf(res, 'tick').length;
      const n = e.snapshot().grid.flat().filter(p => p && p.block === 'alarm').length;
      ok(n <= 2, `at most 2 alarms on the board (${n})`);
      eq(e.stats.alarmsLeft, n, 'alarmsLeft matches the board');
      maxSeen = Math.max(maxSeen, n);
      bursts += res.alarms;
    }
    spawned += e.stats.alarmsBurst;
  }
  note(`alarm fuzz: max on board ${maxSeen}, ticks ${ticks}, bursts ${bursts}`);
  ok(maxSeen >= 1 && ticks > 0, 'alarms spawned and ticked');
});

test('dino: falls onto the exit row and leaves (exit event, then a refill); cannot be destroyed', () => {
  const e = mo(['______', '______', '______', '______', '______', '00_0__'],
    ['......', '......', '......', '......', '..D...', '......']);
  ok(e.isExit(5, 2) && e.isExit(5, 0) && !e.isExit(4, 2), 'default exits: the bottom row');
  eq(e.stats.dinosTotal, 1);
  const res = play(e, P(5, 3), P(5, 2));
  deq(res.events.map(x => x.t).slice(0, 5), ['swap', 'clear', 'fall', 'exit', 'fall']);
  const ex = evOf(res, 'exit')[0];
  eq(ex.cells.length, 1); eq(ex.cells[0].r, 5); eq(ex.cells[0].c, 2); eq(ex.cells[0].piece.block, 'dino');
  eq(e.stats.dinosOut, 1);
  ok(!e.snapshot().grid.flat().some(p => p && p.block === 'dino'), 'gone from the board');
  // a column stripe through a dino leaves it
  const e2 = mo(['______', '______', '___0__', '_ 0 0v _ _ _', '______', '______'],
    ['..D...', '......', '......', '......', '......', '......']);
  const did = e2.cell(0, 2).id;
  const r2 = play(e2, P(2, 3), P(3, 3));
  ok(r2.events.some(x => x.t === 'clear' && x.effects.some(f => f.fx === 'line' && f.dir === 'v' && f.c === 2)), 'the column beam fired');
  ok(!r2.events.some(x => x.t === 'clear' && x.removed.some(y => y.piece.id === did)), 'dino not removed by the beam');
});

test('dino swapped down onto an exit: the match clears first, then the dino leaves', () => {
  const e = mo(['______', '______', '______', '______', '00____', '__0___'],
    ['......', '......', '......', '......', '..D...', '......']);
  ok(e.isExit(5, 2), 'bottom row is an exit');
  const res = play(e, P(4, 2), P(5, 2));
  const ts = res.events.map(x => x.t);
  eq(ts[1], 'clear', 'the match clears right after the swap');
  ok(ts.indexOf('exit') > ts.indexOf('clear'), 'the dino leaves after the clear');
  eq(e.stats.dinosOut, 1);
});

test('dino: swappable; drops in from the top while the goal needs more (dinos option); fish never targets one', () => {
  const e = createEngine({ kinds: [0, 1, 2, 3, 4], seed: 5, dinos: { total: 3, onBoard: 1, rate: 1 } });
  eq(e.stats.dinosTotal, 3);
  const ctx = newCtx(e);
  let seen = 0;
  for (let m = 0; m < 20; m++) {
    const h = e.findHint();
    const before = e.snapshot();
    const res = e.swap(h.a, h.b);
    checkResult(e, before, res, ctx);
    const onBoard = e.snapshot().grid.flat().filter(p => p && p.block === 'dino').length;
    ok(onBoard <= 1, 'at most onBoard dinos');
    seen = Math.max(seen, onBoard);
  }
  ok(seen === 1, 'a dino dropped in');
  ok(e.stats.dinosOut + e.snapshot().grid.flat().filter(p => p && p.block === 'dino').length <= 3, 'never more than total');
  // dino swaps with a piece that then matches
  const e2 = mo(['______', '______', '00____', '__0___', '______', '______'],
    ['......', '......', '..D...', '......', '......', '......']);
  const r2 = play(e2, P(2, 2), P(3, 2));
  ok(r2.ok, 'dino + matching piece is a valid swap');
});

test('dino exits default to every cell a dino cannot fall out of; listMoves = exactly the valid swaps', () => {
  const rows = ['__0___', '__.___', '_0_0__', '__0___', '______', '______'];
  const obst = ['D.....', '......', 'L.....', '...2..', '......', '......'];
  const e = mo(rows, obst);
  ok(e.isExit(0, 2), 'the cell above a hole is an exit');
  for (let c = 0; c < 6; c++) ok(e.isExit(5, c), `bottom cell ${c} is an exit`);
  ok(!e.isExit(4, 0) && !e.isExit(2, 2), 'cells with something below are not exits');
  const list = e.listMoves();
  ok(list.length > 0, 'some moves');
  for (const m of list) {
    const f = mo(rows, obst);
    ok(f.swap(m.a, m.b).ok, `listed move ${JSON.stringify(m)} is valid`);
  }
  ok(!list.some(m => [m.a, m.b].some(q => (q.r === 2 && q.c === 0) || (q.r === 3 && q.c === 3))), 'never the caged piece or the frosting');
  // every valid adjacent swap is listed
  let n = 0;
  for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) for (const [dr, dc] of [[0, 1], [1, 0]]) {
    if (!e.isCell(r, c) || !e.isCell(r + dr, c + dc)) continue;
    if (mo(rows, obst).swap(P(r, c), P(r + dr, c + dc)).ok) n++;
  }
  eq(list.length, n, 'listMoves count');
});

test('portal: what falls out of the bottom of one column comes in at the top of another (warp path)', () => {
  // the top-left 3×2 and the bottom-right 3×2 only meet through the portal (2,1) -> (3,2)
  const e = mk(['_ _ . .', '_ _ . .', '_ _ . .', '. . 0 _', '. . 0 _', '. . _ 0'], { portals: [[2, 1, 3, 2]] });
  deq(e.portals(), [{ from: { r: 2, c: 1 }, to: { r: 3, c: 2 } }]);
  const ids = [e.cell(0, 1).id, e.cell(1, 1).id, e.cell(2, 1).id];
  const res = play(e, P(5, 3), P(5, 2));
  const fall = evOf(res, 'fall')[0];
  for (const id of ids) {
    const m = fall.moves.find(x => x.id === id);
    ok(m && m.to.c === 2 && m.path && m.path.some(q => q.warp), `column 1 piece ${id} warps into column 2: ${JSON.stringify(m)}`);
  }
  eq(bb(res)[5][2].id, ids[2], 'the lowest one lands at the bottom');
  ok(!fall.spawns.some(s => s.to.c === 2), 'column 2 gets no spawn of its own (fed through the portal)');
  eq(fall.spawns.filter(s => s.to.c === 1).length, 3, 'column 1 refills from its top');
});

test('belt: after the move every piece on the belt moves one cell along; the last one warps to the first', () => {
  const belt = [[5, 0], [5, 1], [5, 2], [5, 3], [5, 4], [5, 5]];
  const e = mk(['_____0', '_____0', '____0_', '______', '______', '______'], { belts: [belt] });
  deq(e.belts(), [belt.map(([r, c]) => P(r, c))]);
  deq(e.snapshot().belts, [belt.map(([r, c]) => P(r, c))]);
  const ids = belt.map(([r, c]) => e.cell(r, c).id);
  const res = play(e, P(2, 4), P(2, 5));
  const bi = res.events.findIndex(x => x.t === 'belt');
  ok(bi > 0, 'a belt event');
  eq(res.events[bi - 1].t, 'fall', 'after the move has settled');
  const mv = res.events[bi].moves;
  eq(mv.length, 6);
  for (let i = 0; i < 6; i++) {
    const m = mv.find(x => x.id === ids[i]);
    deq([m.from, m.to], [P(5, i), P(5, (i + 1) % 6)]);
    eq(!!m.warp, i === 5, `warp only for the last cell (${i})`);
    eq(res.events[bi].board[5][(i + 1) % 6].id, ids[i]);
  }
});

test('belt: pieces it brings together match (next cascade); a cage or fixed block on it stops it', () => {
  // a 2-cell belt swaps (5,2) and (5,3): 0 0 _ 0 -> 0 0 0 _
  const e = mk(['_____0', '_____0', '____0_', '______', '______', '00_0__'], { belts: [[[5, 2], [5, 3]]] });
  const res = play(e, P(2, 4), P(2, 5));
  const bi = res.events.findIndex(x => x.t === 'belt');
  const c2 = res.events.slice(bi).find(x => x.t === 'clear');
  ok(c2, 'a clear after the belt');
  eq(c2.cascade, 2, 'belt match is the next cascade');
  deq([...cellSet(c2.removed.filter(x => x.r === 5))].sort(), ['5,0', '5,1', '5,2']);
  ok(e.stats.cascadesMax >= 2, 'cascadesMax counts it');
  const f = mo(['_____0', '_____0', '____0_', '______', '______', '______'], ['......', '......', '......', '......', '......', '.L....'],
    { belts: [[[5, 0], [5, 1], [5, 2]]] });
  ok(!play(f, P(2, 4), P(2, 5)).events.some(x => x.t === 'belt'), 'a caged piece on the belt: it waits');
  const g = mo(['_____0', '_____0', '____0_', '______', '______', '______'], ['......', '......', '......', '......', '......', '..1...'],
    { belts: [[[5, 0], [5, 1], [5, 2]]] });
  ok(!play(g, P(2, 4), P(2, 5)).events.some(x => x.t === 'belt'), 'frosting on the belt: it waits');
  // boosters do not run the belt
  const h = mk(['_____0', '_____0', '____0_', '______', '______', '______'], { belts: [[[5, 0], [5, 1]]] });
  ok(!h.freeSwap(P(2, 4), P(2, 5)).events.some(x => x.t === 'belt'), 'freeSwap: no belt');
  ok(!h.smash(P(0, 0)).events.some(x => x.t === 'belt'), 'smash: no belt');
});

test('shuffle leaves frosting, chocolate, swirls, dinos, shells and caged pieces where they are', () => {
  const e = createEngine({ kinds: [0, 1, 2, 3, 4], seed: 9,
    obstacles: ['L.......', '..2.....', '....C...', '......S.', '.D......', '...L....', '......Y.', '........'] });
  const before = e.snapshot();
  const ev = e.shuffle()[0];
  const fixedIds = new Set();
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = before.grid[r][c];
    if (p && (p.block || before.lock[r][c])) fixedIds.add(p.id);
  }
  eq(fixedIds.size, 7);
  ok(!(ev.moves || []).some(m => fixedIds.has(m.id) && (m.from.r !== m.to.r || m.from.c !== m.to.c)), 'fixed pieces do not move');
  const after = e.snapshot();
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (fixedIds.has(before.grid[r][c] && before.grid[r][c].id)) eq(after.grid[r][c].id, before.grid[r][c].id);
});

test('fuzz with every mechanic: cages, gifts, frosting 1–3, chocolate, swirls, shells, pots, dinos + exits, portals; every invariant', () => {
  let moves = 0, exits = 0, spreads = 0, unlocks = 0, hits = 0;
  const cfgs = [
    { name: 'mixed', rows: 8, cols: 8, portals: [] },
    { name: 'portal', rows: 8, cols: 8, mask: ['####....', '####....', '####....', '####....', '....####', '....####', '....####', '....####'],
      portals: [[3, 0, 4, 4], [3, 1, 4, 5], [3, 2, 4, 6], [3, 3, 4, 7]] },
    { name: 'tall', rows: 9, cols: 7, mask: MASKS.tall, portals: [] },
    { name: 'pot', rows: 8, cols: 8, portals: [], pot: true },
    { name: 'gift', rows: 8, cols: 8, portals: [], gift: true },
    // a ring in the middle and the bottom row (its end warps back to its start); pots spit, chocolate grows
    { name: 'belt', rows: 8, cols: 8, portals: [], pot: true,
      belts: [[[2, 2], [2, 3], [2, 4], [2, 5], [3, 5], [4, 5], [4, 4], [4, 3], [4, 2], [3, 2]], [[6, 0], [6, 1], [6, 2], [6, 3], [6, 4], [6, 5], [6, 6], [6, 7]]] },
  ];
  let gifts = 0, belts = 0;
  for (const cfg of cfgs) for (let g = 0; g < Math.max(3, FUZZ); g++) {
    const seed = 4000 + g * 131 + cfg.name.length;
    const rnd = mulberry(seed);
    const obstacles = [];
    for (let r = 0; r < cfg.rows; r++) {
      let s = '';
      for (let c = 0; c < cfg.cols; c++) {
        const x = rnd();
        s += cfg.pot && r === cfg.rows - 1 && (c === 2 || c === 5) ? 'P' : cfg.gift && x < 0.08 ? '-|WB'[Math.floor(x / 0.02)] : r >= cfg.rows - 1 ? '.' : x < 0.07 ? 'L' : x < 0.10 ? '1' : x < 0.12 ? '2' : x < 0.13 ? '3' : x < 0.15 ? 'C' : x < 0.18 ? 'S' : x < 0.20 && r < 3 ? 'D' : x >= 0.20 && x < 0.215 ? 'X' : x >= 0.215 && x < 0.225 ? 'Y' : '.';
      }
      obstacles.push(s);
    }
    const beltCells = new Set((cfg.belts || []).flat().map(([r, c]) => r * cfg.cols + c));
    // belt cells: only pieces that can ride (dinos, swirls, normal pieces); one belt cell keeps its blocker now and then (it waits)
    if (beltCells.size) for (let r = 0; r < cfg.rows; r++) obstacles[r] = [...obstacles[r]].map((ch, c) => (beltCells.has(r * cfg.cols + c) && !'DS.'.includes(ch) && !(r === 4 && c === 3 && g % 2) ? '.' : ch)).join('');
    const e = createEngine({ kinds: [0, 1, 2, 3, 4], seed, rows: cfg.rows, cols: cfg.cols, mask: cfg.mask || null, obstacles, portals: cfg.portals, belts: cfg.belts,
      dinos: { total: 4, onBoard: 2, rate: 0.4 }, licorice: { rate: 0.05, max: 4 }, alarm: { timer: 6, rate: 0.03, max: 2 },
      ...(cfg.pot ? { pot: { max: 6 } } : {}) });
    const ctx = newCtx(e);
    const gift0 = e.stats.giftLeft;
    for (let m = 0; m < 40; m++) {
      const h = e.findHint();
      if (!h) break;
      const before = e.snapshot();
      const res = e.swap(h.a, h.b);
      ok(res.ok, 'hint is valid');
      try { checkResult(e, before, res, ctx); } catch (err) { throw new Error(`${cfg.name} seed ${seed} move ${m}: ${err.message}\n${kindStr(before.grid)}`); }
      if (beltCells.size) {
        const gr = e.snapshot().grid;
        for (const k of beltCells) { const p = gr[Math.floor(k / cfg.cols)][k % cfg.cols]; ok(!(p && p.block === 'choco' && res.events.some(x => x.t === 'spread' && x.to.r * cfg.cols + x.to.c === k)), 'no chocolate onto a belt'); }
      }
      moves++;
    }
    belts += ctx.belts || 0;
    eq(e.stats.dinosOut, ctx.exits, 'dinosOut counts exits');
    gifts += gift0 - e.stats.giftLeft;
    exits += ctx.exits; spreads += ctx.spreads; unlocks += ctx.unlocks; hits += ctx.blockerHits;
    // boosters on a board full of blockers: replay exactly, board stays full, dinos are never destroyed
    for (const kind of ['smash', 'freeSwap', 'airDrop']) {
      const before = e.snapshot();
      const r = Math.floor(rnd() * cfg.rows), c = Math.floor(rnd() * (cfg.cols - 1));
      const res = kind === 'smash' ? e.smash({ r, c }) : kind === 'freeSwap' ? e.freeSwap({ r, c }, { r, c: c + 1 }) : e.airDrop(3);
      if (!res.ok) { ok(sameBoard(e.snapshot().grid, before.grid), `${kind} refused without a change`); continue; }
      try { replayEvents(before.grid, before.jelly, res.events, before.lock); } catch (err) { throw new Error(`${cfg.name} seed ${seed} ${kind}: ${err.message}`); }
      const g = e.snapshot().grid;
      ok(g.every((row, y) => row.every((p, x) => !e.isCell(y, x) || p)), `${kind}: board full`);
      ok(!res.events.some(x => x.t === 'clear' && x.removed.some(y => y.piece.block === 'dino')), `${kind}: no dino destroyed`);
    }
    const before = e.snapshot();
    const sres = e.sugarCrush(Math.floor(rnd() * 8));
    try { replayEvents(before.grid, before.jelly, sres.events, before.lock); } catch (err) { throw new Error(`${cfg.name} seed ${seed} sugarCrush: ${err.message}`); }
  }
  note(`mechanics fuzz: ${moves} moves, ${exits} dinos out, ${spreads} chocolate spreads, ${unlocks} cages broken / gifts opened (${gifts} gifts), ${hits} frosting layers, ${belts} belt runs`);
  ok(exits > 0 && spreads > 0 && unlocks > 0 && hits > 0 && gifts > 0 && belts > 0, 'every mechanic happened');
});

// ---------------------------------------------------------------- fuzz + perf
test(`fuzz: random valid moves on many seeds/masks, every invariant after every move`, () => {
  let moves = 0, invalid = 0, shuffles = 0, combos = 0, sugar = 0;
  const configs = [];
  for (const [name, mask] of Object.entries(MASKS)) for (const nk of [4, 5, 6]) configs.push({ name, mask, nk });
  configs.push({ name: 'small5x5', mask: ['#####', '#####', '#####', '#####', '#####'], nk: 5 });
  configs.push({ name: 'tiny4x6', mask: ['######', '######', '######', '######'], nk: 4 });
  for (const cfg of configs) for (let g = 0; g < FUZZ; g++) {
    const seed = 1000 + g * 97 + cfg.nk * 13 + cfg.name.length;
    const rnd = mulberry(seed ^ 0x5bd1e995);
    const size = cfg.mask ? { rows: cfg.mask.length, cols: cfg.mask[0].length } : { rows: 8, cols: 8 };
    const jelly = [];
    for (let r = 0; r < size.rows; r++) { let s = ''; for (let c = 0; c < size.cols; c++) s += rnd() < 0.3 ? String(1 + Math.floor(rnd() * 2)) : '.'; jelly.push(s); }
    const ac = [0, 0.5, 0.72, 0.95][g % 4];
    const e = createEngine({ kinds: [0, 1, 2, 3, 4, 5].slice(0, cfg.nk), mask: cfg.mask, jelly, seed, antiCascade: ac, ...size });
    const ctx = newCtx(e);
    const where = () => `${cfg.name} k${cfg.nk} seed ${seed} ac ${ac} move ${ctx.moves}`;
    for (let m = 0; m < 50; m++) {
      let a, b;
      if (rnd() < 0.5) ({ a, b } = e.findHint());
      else {
        // random adjacent pair; invalid tries are checked too
        for (let t = 0; t < 40; t++) {
          const r = Math.floor(rnd() * size.rows), c = Math.floor(rnd() * size.cols);
          const [dr, dc] = rnd() < 0.5 ? [0, 1] : [1, 0];
          const before = e.snapshot();
          a = P(r, c); b = P(r + dr, c + dc);
          const res = e.swap(a, b);
          try { checkResult(e, before, res, ctx); } catch (err) { throw new Error(`${where()}: ${err.message}`); }
          if (res.ok) { moves++; a = null; if (res.events.some(x => x.t === 'shuffle')) shuffles++; break; }
          invalid++;
        }
        if (a === null) continue;
        ({ a, b } = e.findHint());
      }
      const before = e.snapshot();
      const pa = e.cell(a.r, a.c), pb = e.cell(b.r, b.c);
      if (pa.special !== 'none' && pb.special !== 'none' || pa.special === 'bomb' || pb.special === 'bomb') combos++;
      const res = e.swap(a, b);
      if (!res.ok) throw new Error(`${where()}: findHint returned an invalid swap`);
      try { checkResult(e, before, res, ctx); } catch (err) { throw new Error(`${where()}: ${err.message}`); }
      moves++;
      if (res.events.some(x => x.t === 'shuffle')) shuffles++;
    }
    const before = e.snapshot();
    const res = e.sugarCrush(Math.floor(rnd() * 12));
    try { checkResult(e, before, { ok: true, ...res }, ctx, { sugar: true }); } catch (err) { throw new Error(`${where()} sugarCrush: ${err.message}`); }
    sugar++;
  }
  note(`fuzz: ${moves} valid moves (${combos} combos, ${shuffles} auto-shuffles), ${invalid} invalid swaps, ${sugar} sugar crushes, ${configs.length} configs x ${FUZZ} games`);
  ok(moves >= configs.length * FUZZ * 50, 'enough moves');
});

test('performance: a move resolves in a few ms', () => {
  const e = createEngine({ kinds: [0, 1, 2, 3, 4], seed: 77 });
  const times = [];
  for (let i = 0; i < 1500; i++) {
    const h = e.findHint();
    const t0 = performance.now();
    e.swap(h.a, h.b);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const avg = times.reduce((s, x) => s + x, 0) / times.length;
  const p99 = times[Math.floor(times.length * 0.99)], max = times[times.length - 1];
  let t0 = performance.now();
  for (let i = 0; i < 200; i++) e.findHint();
  const hint = (performance.now() - t0) / 200;
  note(`perf: swap avg ${avg.toFixed(3)} ms, p99 ${p99.toFixed(2)} ms, max ${max.toFixed(2)} ms; findHint ${hint.toFixed(3)} ms`);
  ok(avg < 3 && p99 < 10, `too slow: avg ${avg} p99 ${p99}`);
});

// ---------------------------------------------------------------- runner
async function main() {
  const out = document.getElementById('out');
  const failures = [];
  let passed = 0;
  const t0 = performance.now();
  for (const t of T) {
    if (ONLY && !t.name.includes(ONLY)) continue;
    const li = document.createElement('li');
    const s = performance.now();
    try {
      await t.fn();
      passed++;
      li.className = 'pass';
      li.textContent = `✓ ${t.name}`;
    } catch (err) {
      failures.push({ name: t.name, message: String(err && err.message || err) });
      li.className = 'fail';
      li.textContent = `✗ ${t.name}\n${err && err.message}`;
    }
    const ms = document.createElement('span');
    ms.textContent = ` ${(performance.now() - s).toFixed(0)} ms`;
    li.appendChild(ms);
    out.appendChild(li);
    await new Promise(r => setTimeout(r, 0));
  }
  const total = performance.now() - t0;
  const sum = document.getElementById('sum');
  sum.textContent = `${passed} passed, ${failures.length} failed (${(total / 1000).toFixed(1)} s)`;
  sum.className = failures.length ? 'fail' : 'pass';
  const nl = document.getElementById('notes');
  nl.textContent = notes.join('\n');
  window.__results = { passed, failed: failures.length, failures, notes, ms: Math.round(total) };
}
main().catch(err => { window.__results = { passed: 0, failed: 1, failures: [{ name: 'runner', message: String(err && err.stack || err) }], notes }; });
