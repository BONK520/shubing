// Engine tests. Open tests/engine.test.html (served over HTTP) or run: python tests/run_tests.py
// Query params: ?fuzz=N (games per mask/kinds config, default 6), ?only=substring,
//               ?engine=/path/to/engine.js (test another build, e.g. a mutated copy)
import { lay, BG_KINDS, MASKS, maskSize, mulberry, runsIn, replayEvents, sameBoard, kindStr, newCtx, checkResult } from './util.js';

const params = new URLSearchParams(location.search);
const { createEngine } = await import(params.get('engine') || '../js/engine.js');
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
  deq(st, { cleared: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 }, jellyLeft: 2, specialsMade: 0, cascadesMax: 0 });
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
    const runs = runsIn(s.grid);
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
  eq(cl.gained, 150);
});

test('T -> wrapped at the swapped cell', () => {
  const e = mk(['______', '__0___', '__0___', '_0_0__', '__0___']);
  const res = play(e, P(4, 2), P(3, 2));
  const cl = firstClear(res);
  deq(cl.groups.map(g => [g.shape, g.cells.length]), [['T', 5]]);
  deq(cl.created.map(x => [x.r, x.c, x.piece.special]), [[3, 2, 'wrap']]);
  eq(cl.gained, 150);
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
  eq(cs[0].gained, 60 + 100);
  eq(cs[1].cascade, 2);
  deq(cs[1].groups.map(g => [g.kind, g.shape]), [[1, '4']]);
  deq(cs[1].created, [{ r: 4, c: 1, piece: { id: id41, kind: 1, special: 'v' } }]);
  deq(cs[1].jellyHits, [{ r: 4, c: 2, left: 0 }]);
  eq(cs[1].gained, 120 * 2 + 100);
  eq(res.gained, 160 + 340);
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
  deq(c2.points, [{ r: 4, c: 2, value: 240 }, { r: 4, c: 1, value: 2 * 20 * 2 }]);
  eq(c2.gained, 320);
});

test('"+" shape (cascade / pre-existing) -> wrapped at the intersection, shape "T"', () => {
  const e = mk(['______', '_1____', '111___', '_1____', '____0_', '___0_0']);
  const res = play(e, P(4, 4), P(5, 4));
  const cl = firstClear(res);
  const g1 = cl.groups.find(g => g.kind === 1), g0 = cl.groups.find(g => g.kind === 0);
  eq(g1.shape, 'T'); eq(g1.cells.length, 5); eq(g0.shape, '3');
  deq(cl.created.map(x => [x.r, x.c, x.piece.kind, x.piece.special]), [[2, 1, 1, 'wrap']]);
  eq(cl.gained, 60 + 150);
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
  deq(cl.points, [{ r: 3, c: 1, value: 60 + 4 * 20 }, { r: 3, c: 3, value: 6 * 20 }, { r: 4, c: 4, value: 4 * 20 }]);
  eq(cl.gained, 340);
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
  eq(cl.gained, 13 * 20 + 13 * 100);
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
  eq(cl.gained, 49 * 20);
});

test('two specials always combo even without a match; bomb swaps are always valid', () => {
  const e = comboBoard('_ _ _ 0h 0h _ _');
  ok(e.findHint(), 'hint finds the combo');
  ok(play(e, P(3, 3), P(3, 4)).ok, 'stripe + stripe of the same kind');
  const e2 = comboBoard('_ _ _ B _ _ _');
  ok(play(e2, P(3, 3), P(2, 3)).ok, 'bomb + background piece');
});

// ---------------------------------------------------------------- gravity, spawn, jelly
test('gravity passes through holes; spawns come from above (from.r < 0, stacked)', () => {
  const e = mk(['__1___', '______', '__2___', '__.___', '__0___', '00____']);
  ok(!e.isCell(3, 2), 'hole');
  const id1 = e.cell(0, 2).id, id2 = e.cell(2, 2).id;
  const res = play(e, P(4, 2), P(5, 2));
  const fall = res.events.find(x => x.t === 'fall');
  const mv = Object.fromEntries(fall.moves.map(m => [m.id, m]));
  deq([mv[id2].from, mv[id2].to], [P(2, 2), P(4, 2)], 'piece above the hole jumps over it');
  deq([mv[id1].from, mv[id1].to], [P(0, 2), P(1, 2)]);
  deq(fall.spawns.map(s => [s.from.r, s.from.c, s.to.r, s.to.c]).sort(), [[-1, 0, 0, 0], [-1, 1, 0, 1], [-1, 2, 0, 2]]);
  for (const ev of res.events) eq(ev.board[3][2], null, `hole stays empty in ${ev.t}`);
});

test('column with holes on top still refills from above; multiple spawns stack -1, -2, -3', () => {
  const e = mk(['. . _ _', '. . _ _', '_ 0 _ _', '_ 0 _ _', '0 _ _ _', '_ _ _ _']);
  const res = play(e, P(4, 0), P(4, 1));
  const fall = res.events.find(x => x.t === 'fall');
  const col1 = fall.spawns.filter(s => s.to.c === 1).sort((a, b) => b.to.r - a.to.r);
  deq(col1.map(s => [s.from.r, s.to.r]), [[-1, 4], [-2, 3], [-3, 2]]);
});

test('jelly: matched cells (incl. the new special) lose one layer, 100 points each, jellyLeft', () => {
  const e = mk(['______', '__0___', '00_0__', '______', '______'], { jelly: ['......', '......', '1221..', '......', '......'] });
  eq(e.stats.jellyLeft, 6);
  const res = play(e, P(1, 2), P(2, 2));
  const cl = firstClear(res);
  deq(cl.jellyHits.map(x => [x.r, x.c, x.left]).sort(), [[2, 0, 0], [2, 1, 1], [2, 2, 1], [2, 3, 0]]);
  eq(cl.gained, 120 + 400);
  eq(e.stats.jellyLeft, 2);
  eq(e.jellyAt(2, 1), 1); eq(e.jellyAt(2, 2), 1); eq(e.jellyAt(2, 0), 0);
});

// ---------------------------------------------------------------- scoring
test('scoring: 3 = 60, 4 = 120, L/T = 150, 5 = 200, effect pieces 20 x multiplier', () => {
  const e = mk(['______', '__0___', '00____', '______']);
  eq(play(e, P(1, 2), P(2, 2)).gained, 60);
  const e2 = mk(['_______', '_ _ 0 _ _ _ _', '_ 0h _ _ _ _ _', '_ 0 _ _ _ _ _', '_______']);
  // vertical 3 with an "h" stripe inside: 60 + 6 other pieces of the row x 20
  const res = play(e2, P(1, 2), P(1, 1));
  eq(firstClear(res).gained, 60 + 6 * 20);
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
    ok(!runsIn(after.grid).length, 'no match');
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
  ok(e.hasValidMove() && !runsIn(e.snapshot().grid).length, 'playable after shuffle');
  const ms = g => g.flat().map(p => `${p.id}:${p.kind}`).sort().join();
  eq(ms(e.snapshot().grid), ms(before.grid));
});

test('last-resort shuffle (kinds re-rolled) is still replayable from its event', () => {
  // 3x3 with one of each-ish: no arrangement of these pieces has a move, so the shuffle must re-roll kinds
  const e = createEngine({ kinds: [0, 1, 2, 3, 4], layout: ['0 1 2', '3 4 0', '1 2 3'], seed: 3 });
  eq(e.hasValidMove(), false);
  const before = e.snapshot();
  const evs = e.shuffle();
  ok(e.hasValidMove() && !runsIn(e.snapshot().grid).length, 'playable after shuffle');
  ok(evs[0].moves.every(m => m.piece && m.piece.id === m.id), 'every move carries its piece');
  replayEvents(before.grid, before.jelly, evs);
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

test('sugarCrush: each move becomes a striped piece, then everything fires and scores', () => {
  const e = createEngine({ kinds: [0, 1, 2, 3, 4], seed: 11, jelly: Array(8).fill('11111111') });
  const before = e.snapshot();
  const ctx = newCtx(e);
  const res = e.sugarCrush(6);
  const trs = res.events.filter(x => x.t === 'transform');
  eq(trs.length, 6);
  ok(trs.every(t => t.cells.length === 1 && 'hv'.includes(t.cells[0].piece.special)), 'random striped');
  eq(new Set(trs.map(t => t.cells[0].piece.id)).size, 6, 'six different pieces');
  ok(res.gained > 6 * 7 * 20, `gained ${res.gained}`);
  eq(e.score, res.gained);
  checkResult(e, before, { ok: true, ...res }, ctx, { sugar: true });
  ok(!e.snapshot().grid.flat().some(p => p && p.special !== 'none'), 'no special left');
  deq(e.sugarCrush(0).events, [], 'sugarCrush(0) does nothing on a board without specials');
  // specials made by sugar-crush cascades are fired too, until none is left
  let rounds = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const e2 = createEngine({ kinds: [0, 1, 2, 3], seed, antiCascade: 0 });
    const b2 = e2.snapshot(), c2 = newCtx(e2);
    const r2 = e2.sugarCrush(10);
    checkResult(e2, b2, { ok: true, ...r2 }, c2, { sugar: true });
    ok(!e2.snapshot().grid.flat().some(p => p && p.special !== 'none'), `seed ${seed}: special left after sugarCrush`);
    rounds += r2.events.filter(x => x.t === 'clear' && x.cascade === 1).length;
  }
  ok(rounds > 40, 'some sugar crushes needed more than one round');
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
  ok(r9 < r0 * 0.6, `expected far fewer cascades (${r0.toFixed(3)} vs ${r9.toFixed(3)})`);
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
