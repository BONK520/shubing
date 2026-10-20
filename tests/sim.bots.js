// 關卡平衡模擬的核心：照 js/main.js 的流程玩一整關（tests/sim.js、tests/sim.worker.js 都用這份）。
//
// 跟真的遊戲一樣的地方（main.js startLevel / afterMove / goalMet / winFlow / scoreLevelEnd / recordWin，
// 規則本身在 js/levels.js 的 isScoreLevel / passScore / starsFor，兩邊共用）：
//   * 盤面：同樣的 kinds、mask、jelly、antiCascade；第 n 次玩（attempt n）用 main.js 同一條 seed 公式，
//     attempt 0 = level.seed（第一次打開大家看到的盤面），之後每次「再玩一次」換一個盤面。
//   * 分數關：步數全部用完（到了目標也繼續）→ engine.sugarCrush(0)（剩下的特殊方塊引爆）→ 分數 ≥ stars[0] 過關。
//   * 目標關：每走一步就檢查目標，一達成就結束 → 分數不到 stars[0] 先 addScore 補到 stars[0]
//     → engine.sugarCrush(剩下步數)（每步 3,000 + 條紋方塊）。
//   * 星星 = starsFor(最終分數)（過關至少 1 顆）；沒過關 = 0 顆。
//
// 兩種「像真人」的玩家（都不往後看，只看這一步交換後馬上連成的線）：
//   casual = 60% 隨便挑一個能走的步，40% 挑眼前最好的一步（會看目標：果凍格 / 還要收集的毛絨）
//   decent = 每一步都挑最好的（會看目標），而且會特別找能做出條紋 / 包裝 / 彩色炸彈的步、會交換特殊方塊組合技，
//            稍微偏好在下面消（比較容易連鎖）
import { createEngine } from '../js/engine.js';
import { PIECES } from '../js/pieces.js';
import { isScoreLevel, passScore, starsFor } from '../js/levels.js';

export { isScoreLevel, passScore, starsFor };

export const kindOf = id => PIECES.findIndex(p => p.id === id);

export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// main.js startLevel()
export function seedFor(level, attempt, idx = (level.id || 1) - 1) {
  const baseSeed = Number.isFinite(level.seed) ? level.seed : 1 + idx;
  return attempt === 0 ? baseSeed : ((baseSeed * 2654435761) ^ (attempt * 40503)) >>> 0;
}
function boardDims(lvl) {
  const m = lvl.mask || lvl.jelly;
  if (Array.isArray(m) && m.length) return { rows: m.length, cols: Math.max(...m.map(r => r.length)) };
  return { rows: lvl.rows || 8, cols: lvl.cols || 8 };
}
export function makeEngine(level, attempt) {
  const kinds = (level.kinds || PIECES.slice(0, 5).map(p => p.id)).map(kindOf).filter(k => k >= 0);
  const dims = boardDims(level);
  const opts = { rows: dims.rows, cols: dims.cols, kinds, mask: level.mask || null, jelly: level.jelly || null, seed: seedFor(level, attempt) };
  if (level.antiCascade != null) opts.antiCascade = level.antiCascade;
  return createEngine(opts);
}
// main.js goalMet()（目標關；分數關沒有「提早達成」）
export function goalMet(level, e) {
  const g = level.goal || {};
  if (g.type === 'collect') return Object.entries(g.items || {}).every(([id, n]) => (e.stats.cleared[kindOf(id)] || 0) >= n);
  if (g.type === 'jelly') return e.stats.jellyLeft <= 0;
  return e.score >= passScore(level);          // 分數關：到了目標就結束
}

// ---------- players ----------
export const PROFILES = {
  // weights are in "cells" (1 = one plain piece cleared); urgency: jelly weight × (1 + urgency / jelly left)
  casual: { randomP: 0.6, stripe: 1.5, wrap: 2, bomb: 3, fire: 1, combo: 2, low: 0, jelly: 3, urgency: 6, want: 2, noise: 0.3 },
  decent: { randomP: 0, stripe: 5, wrap: 6, bomb: 10, fire: 1, combo: 8, low: 0.6, jelly: 3, urgency: 6, want: 2, noise: 1.5 },
};

// top-left corners of the 2×2 squares a cell can be part of (offsets), same as js/engine.js
const SQ = [[0, 0], [0, -1], [-1, 0], [-1, -1]];
// the cells (y * C + x) of a 2×2 square of one kind that (r,c) is part of, or null
function squareCells(g, R, C, mask, r, c) {
  const p = g[r][c];
  if (!p || p.kind < 0) return null;
  const k = p.kind;
  const is = (y, x) => y >= 0 && y < R && x >= 0 && x < C && mask[y][x] && g[y][x] && g[y][x].kind === k;
  for (const [dy, dx] of SQ) {
    const y = r + dy, x = c + dx;
    if (is(y, x) && is(y, x + 1) && is(y + 1, x) && is(y + 1, x + 1)) return [y * C + x, y * C + x + 1, (y + 1) * C + x, (y + 1) * C + x + 1];
  }
  return null;
}

function validMoves(s) {
  const { rows: R, cols: C, mask, grid: g } = s;
  const out = [];
  const runAt = (r, c) => {
    const p = g[r][c];
    if (!p || p.kind < 0) return false;
    const k = p.kind;
    const is = (y, x) => y >= 0 && y < R && x >= 0 && x < C && mask[y][x] && g[y][x] && g[y][x].kind === k;
    let h = 1, v = 1;
    for (let x = c - 1; is(r, x); x--) h++;
    for (let x = c + 1; is(r, x); x++) h++;
    if (h >= 3) return true;
    for (let y = r - 1; is(y, c); y--) v++;
    for (let y = r + 1; is(y, c); y++) v++;
    return v >= 3 || !!squareCells(g, R, C, mask, r, c);
  };
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    if (!mask[r][c]) continue;
    for (let d = 0; d < 2; d++) {
      const r2 = r + d, c2 = c + 1 - d;
      if (r2 >= R || c2 >= C || !mask[r2][c2]) continue;
      const p = g[r][c], q = g[r2][c2];
      if (!p || !q) continue;
      let ok = (p.special !== 'none' && q.special !== 'none') || p.special === 'bomb' || q.special === 'bomb';
      if (!ok) {
        g[r][c] = q; g[r2][c2] = p;
        ok = runAt(r, c) || runAt(r2, c2);
        g[r][c] = p; g[r2][c2] = q;
      }
      if (ok) out.push({ a: { r, c }, b: { r: r2, c: c2 } });
    }
  }
  return out;
}

// best move by immediate value (no lookahead)
function bestMove(s, moves, level, e, W, rnd) {
  const { rows: R, cols: C, mask, grid: g, jelly: J } = s;
  const goal = level.goal || {};
  const jellyGoal = goal.type === 'jelly';
  const want = new Set();
  if (goal.type === 'collect') {
    const cl = e.stats.cleared;
    for (const [id, n] of Object.entries(goal.items || {})) if ((cl[kindOf(id)] || 0) < n) want.add(kindOf(id));
  }
  const isCell = (y, x) => y >= 0 && y < R && x >= 0 && x < C && mask[y][x];
  // the fewer jelly layers are left, the more a player focuses on them (the last few are the hard part)
  const jellyW = jellyGoal ? W.jelly * (1 + W.urgency / Math.max(1, e.stats.jellyLeft)) : 0;
  const cellVal = key => {
    const y = (key / C) | 0, x = key % C, p = g[y][x];
    let v = 1;
    if (jellyGoal && J[y][x] > 0) v += jellyW;
    if (p && want.has(p.kind)) v += W.want;
    return v;
  };
  const addRow = (set, y) => { for (let x = 0; x < C; x++) if (isCell(y, x)) set.add(y * C + x); };
  const addCol = (set, x) => { for (let y = 0; y < R; y++) if (isCell(y, x)) set.add(y * C + x); };
  const addSq = (set, y0, x0, rad) => {
    for (let y = y0 - rad; y <= y0 + rad; y++) for (let x = x0 - rad; x <= x0 + rad; x++) if (isCell(y, x)) set.add(y * C + x);
  };
  const lineInfo = (r, c) => {
    const p = g[r][c];
    if (!p || p.kind < 0) return null;
    const k = p.kind;
    const is = (y, x) => isCell(y, x) && g[y][x] && g[y][x].kind === k;
    let c0 = c, c1 = c, r0 = r, r1 = r;
    while (is(r, c0 - 1)) c0--;
    while (is(r, c1 + 1)) c1++;
    while (is(r0 - 1, c)) r0--;
    while (is(r1 + 1, c)) r1++;
    const h = c1 - c0 + 1, v = r1 - r0 + 1;
    const sq = squareCells(g, R, C, mask, r, c);
    // a 2×2 square on its own clears 4 (no special); next to a line it adds its other cells
    if (h < 3 && v < 3) return sq ? { cells: sq, shape: '', low: Math.floor(Math.max(...sq) / C) } : null;
    const cells = [];
    if (h >= 3) for (let x = c0; x <= c1; x++) cells.push(r * C + x);
    if (v >= 3) for (let y = r0; y <= r1; y++) if (!(h >= 3 && y === r)) cells.push(y * C + c);
    if (sq) for (const k of sq) if (!cells.includes(k)) cells.push(k);
    const shape = h >= 5 || v >= 5 ? 'bomb' : h >= 3 && v >= 3 ? 'wrap' : h === 4 || v === 4 ? 'stripe' : '';
    return { cells, shape, low: Math.max(r1, r, ...cells.map(k => Math.floor(k / C))) };
  };

  let best = null, bestV = -Infinity;
  for (const mv of moves) {
    const { a, b } = mv;
    const p = g[a.r][a.c], q = g[b.r][b.c];
    let v = 0;
    const area = new Set();
    if ((p.special !== 'none' && q.special !== 'none') || p.special === 'bomb' || q.special === 'bomb') {
      // combo: estimate the cells it clears
      const sp = [p.special, q.special];
      if (sp[0] === 'bomb' && sp[1] === 'bomb') { for (let y = 0; y < R; y++) addRow(area, y); }
      else if (sp.includes('bomb')) {
        const other = p.special === 'bomb' ? q : p;
        let n = 0;
        for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) {
          const o = g[y][x];
          if (!isCell(y, x) || !o || o.kind !== other.kind) continue;
          area.add(y * C + x);
          if (other.special === 'wrap') addSq(area, y, x, 1);
          else if (other.special !== 'none') { if (n++ % 2) addRow(area, y); else addCol(area, x); }
        }
        area.add(a.r * C + a.c); area.add(b.r * C + b.c);
      } else {
        const stripes = sp.filter(x => x === 'h' || x === 'v').length;
        if (stripes === 2) { addRow(area, b.r); addCol(area, b.c); }
        else if (stripes === 1) { for (let d = -1; d <= 1; d++) { addRow(area, b.r + d); addCol(area, b.c + d); } }
        else addSq(area, b.r, b.c, 2);
      }
      for (const k of area) v += cellVal(k);
      v += W.combo;
    } else {
      g[a.r][a.c] = q; g[b.r][b.c] = p;
      const matched = new Set();
      let low = 0;
      for (const [r, c] of [[a.r, a.c], [b.r, b.c]]) {
        const L = lineInfo(r, c);
        if (!L) continue;
        if (L.shape) v += W[L.shape];
        low = Math.max(low, L.low);
        for (const k of L.cells) matched.add(k);
      }
      for (const k of matched) {
        v += cellVal(k);
        const y = (k / C) | 0, x = k % C, sp = g[y][x].special;
        if (sp === 'h') addRow(area, y);
        else if (sp === 'v') addCol(area, x);
        else if (sp === 'wrap') addSq(area, y, x, 1);
      }
      for (const k of area) if (!matched.has(k)) v += W.fire * cellVal(k);
      v += W.low * (low / Math.max(1, R - 1));
      g[a.r][a.c] = p; g[b.r][b.c] = q;
    }
    v += rnd() * W.noise;   // people don't weigh moves exactly: near-equal moves are a coin flip
    if (v > bestV) { bestV = v; best = mv; }
  }
  return best;
}

export function pickMove(e, level, profile, rnd) {
  const W = PROFILES[profile];
  const s = e.snapshot();
  const moves = validMoves(s);
  if (!moves.length) return null;
  if (W.randomP > 0 && rnd() < W.randomP) return moves[Math.floor(rnd() * moves.length)];
  return bestMove(s, moves, level, e, W, rnd);
}

// One full level, exactly like the game ends it. Returns a compact record.
// salt varies only the player's choices (same board), e.g. to replay attempt 0 many times.
//   atGoal = score when the playing part ended (goal met / moves used up), before the bump and sugarCrush
export function playLevel(level, profile, attempt, salt = 0) {
  const e = makeEngine(level, attempt);
  const rnd = mulberry((((level.id || 1) * 7919) ^ (attempt * 104729) ^ (salt * 15485863) ^ (profile === 'decent' ? 0x5bd1e995 : 0x1b873593)) >>> 0);
  let movesLeft = level.moves, done = goalMet(level, e);
  while (!done && movesLeft > 0) {
    const mv = pickMove(e, level, profile, rnd);
    if (!mv) throw new Error(`L${level.id}: no valid move`);
    const res = e.swap(mv.a, mv.b);
    if (!res.ok) throw new Error(`L${level.id}: bot made an invalid move`);
    movesLeft--;
    done = goalMet(level, e);
  }
  const atGoal = e.score;
  let won, left = 0;
  won = done;
  if (won) {
    left = movesLeft;
    if (e.score < passScore(level)) e.addScore(passScore(level) - e.score);
    e.sugarCrush(left);
  }
  const final = e.score;
  return { won, used: level.moves - movesLeft, left, atGoal, final, stars: won ? starsFor(level, final) : 0 };
}
