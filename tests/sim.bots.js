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
import { isScoreLevel, passScore, starsFor, mechOpts, goalDone, goalParts, partLeft } from '../js/levels.js';

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
  Object.assign(opts, mechOpts(level));                    // 盤面機關（鐵籠子、糖霜、巧克力、甘草、龍龍、傳送門）
  if (level.goal && level.goal.type === 'collect') {      // 跟 main.js 一樣：小魚優先游去目標還要收集的毛絨
    opts.collect = {};
    for (const [id, n] of Object.entries(level.goal.items || {})) { const k = kindOf(id); if (k >= 0) opts.collect[k] = n; }
  }
  return createEngine(opts);
}
// main.js goalMet()（目標關；分數關沒有「提早達成」）
export function goalMet(level, e) {
  return goalDone(level, e.stats, e.score, kindOf);     // 分數關：到了目標就結束
}

// ---------- players ----------
export const PROFILES = {
  // weights are in "cells" (1 = one plain piece cleared); urgency: jelly weight × (1 + urgency / jelly left)
  // board mechanics: block = one layer of a goal blocker (frosting / chocolate / cage / shell), chocoAny = clearing chocolate
  // that is not a goal (it would spread), dino = one row a dino moves down, alarm = taking out an alarm clock
  // (worth more the closer it is to bursting)
  casual: { randomP: 0.6, stripe: 1.5, wrap: 2, bomb: 3, fish: 1.5, fire: 1, combo: 2, low: 0, jelly: 3, urgency: 6, want: 2, noise: 0.3,
    block: 2, chocoAny: 1, dino: 2.5, order: 3, alarm: 2 },
  decent: { randomP: 0, stripe: 5, wrap: 6, bomb: 10, fish: 4, fire: 1, combo: 8, low: 0.6, jelly: 3, urgency: 6, want: 2, noise: 1.5,
    block: 3, chocoAny: 1.5, dino: 4, order: 8, alarm: 4 },
  // 11/23 工作單7：使用者在第116關的玩法 = 只要能打到巧克力就打（打得到的步裡挑最好的），打不到才像 casual 那樣走
  //   ?profiles=chocofirst（目標表沒有它，只看過關率）
  chocofirst: { randomP: 0.6, stripe: 1.5, wrap: 2, bomb: 3, fish: 1.5, fire: 1, combo: 2, low: 0, jelly: 3, urgency: 6, want: 2, noise: 0.3,
    block: 2, chocoAny: 1, dino: 2.5, order: 3, alarm: 2, chocoFirst: true },
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
  const LK = s.lock || null;
  const parts = goalParts(level), st = e.stats;
  const part = k => parts.find(q => q.kind === k);
  const leftOf = k => (part(k) ? partLeft(part(k), st, kindOf) : 0);
  const jellyGoal = !!part('jelly') && leftOf('jelly') > 0;
  const want = new Set();
  for (const q of parts) if (q.kind === 'collect' && partLeft(q, st, kindOf) > 0) want.add(kindOf(q.id));
  // board mechanics: what one hit on each kind of blocker is worth, and one row of dino progress
  const urg = k => 1 + W.urgency / Math.max(1, leftOf(k));
  const BLK = {
    frost: leftOf('frost') > 0 ? W.block * urg('frost') : 0.3,
    choco: (W.chocoFirst ? CHOCO_FIRST : 0) +
      (leftOf('choco') > 0 ? W.block * urg('choco') : leftOf('chocoGot') > 0 ? W.block * urg('chocoGot') : W.chocoAny),
    cage: leftOf('cage') > 0 ? W.block * urg('cage') : 0.4,
    shell: leftOf('shell') > 0 ? W.block * urg('shell') : 0.3,
    licorice: 0.4,
    // 第131關起：驚喜蛋 / 燈籠 / 烤箱被旁邊的配對打到；票閘、熱氣球、蜂蜜罐不吃一般打擊（看 cellVal）
    surprise: leftOf('egg') > 0 ? W.block * urg('egg') : 0.5,
    lantern: leftOf('lantern') > 0 ? W.block * urg('lantern') : 0.3,
    oven: leftOf('bake') > 0 ? W.block * urg('bake') : 0.3,
  };
  const blkV = q => (q.block === 'alarm' ? W.alarm * (q.hp <= 2 ? 3 : q.hp <= 4 ? 1.5 : 0.6) : BLK[q.block]);
  // 訂單：還要做的特殊方塊 / 組合（做出來加分；組合訂單也會想先做出那兩種特殊方塊）
  const orderNeed = {};
  for (const q of parts) if (q.kind === 'order' && partLeft(q, st, kindOf) > 0) orderNeed[q.what] = true;
  const sk = x => (x === 'h' || x === 'v' ? 'stripe' : x);
  const shapeBonus = shape => (orderNeed[shape] ? W.order
    : Object.keys(orderNeed).some(w => w === 'combo' ? shape !== 'fish' : w.split('+').includes(shape)) ? W.order * 0.4 : 0);
  const comboBonus = (s1, s2) => {
    if (s1 === 'none' || s2 === 'none') return 0;
    return (orderNeed[[sk(s1), sk(s2)].sort().join('+')] || orderNeed.combo) ? W.order * 1.5 : 0;
  };
  const dinoW = leftOf('dino') > 0 ? W.dino * (1 + 2 / Math.max(1, leftOf('dino'))) : 0;
  const dinos = [];
  if (dinoW) for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) if (g[y][x] && g[y][x].block === 'dino') dinos.push({ y, x });
  const isCell = (y, x) => y >= 0 && y < R && x >= 0 && x < C && mask[y][x];
  // extra value of clearing these cells (matched = cells of the match itself, area = cells effects hit)
  const mech = (matched, area, mv) => {
    let v = 0;
    const hitCells = new Set([...matched, ...area]);
    const seen = new Set();
    for (const k of hitCells) {
      const y = (k / C) | 0, x = k % C, q = g[y][x];
      if (LK && LK[y][x]) v += BLK.cage;
      if (q && q.block && blkV(q) && area.has(k)) { v += blkV(q); seen.add(k); }
    }
    // a match also hits frosting / chocolate / swirls next to it
    for (const k of matched) {
      const y = (k / C) | 0, x = k % C;
      for (const [dy, dx] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const yy = y + dy, xx = x + dx, kk = yy * C + xx;
        if (!isCell(yy, xx) || seen.has(kk) || hitCells.has(kk)) continue;
        const q = g[yy][xx];
        if (q && q.block && q.block !== 'shell' && blkV(q)) { v += blkV(q); seen.add(kk); }   // a plain match never cracks a shell
      }
    }
    // dinos drop by the number of cleared cells below them in their column
    for (const d of dinos) {
      let n = 0;
      for (const k of hitCells) if (k % C === d.x && ((k / C) | 0) > d.y && !(LK && LK[(k / C) | 0][d.x])) n++;
      if (mv) {
        const da = mv.a.r === d.y && mv.a.c === d.x, db = mv.b.r === d.y && mv.b.c === d.x;
        if (da || db) n += (da ? mv.b.r - mv.a.r : mv.a.r - mv.b.r);     // swapped down (+1) / up (-1)
      }
      v += dinoW * n;
    }
    return v;
  };
  // the fewer jelly layers are left, the more a player focuses on them (the last few are the hard part)
  const jellyW = jellyGoal ? W.jelly * (1 + W.urgency / Math.max(1, e.stats.jellyLeft)) : 0;
  const ticketW = leftOf('gate') > 0 ? W.block * urg('gate') : 0;
  const jarW = leftOf('jar') > 0 ? W.block * urg('jar') : 0.3;
  const cellVal = key => {
    const y = (key / C) | 0, x = key % C, p = g[y][x];
    let v = 1;
    if (jellyGoal && J[y][x] > 0) v += jellyW;
    if (p && want.has(p.kind)) v += W.want;
    if (p && p.tk && ticketW) v += ticketW;                       // 帶車票的玩偶：消掉就有一張車票飛去票閘
    if (p && jarW && p.kind >= 0) {                               // 蜂蜜罐旁邊八格、罐子畫的那種玩偶
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const q = (dy || dx) && isCell(y + dy, x + dx) ? g[y + dy][x + dx] : null;
        if (q && q.block === 'jar' && q.hp > 0 && q.jk === p.kind) v += jarW;
      }
    }
    return v;
  };
  // a fish hits one cell, and it picks a useful one (jelly / a piece the goal still needs) when there is one
  const fishHit = () => 1 + (jellyGoal && e.stats.jellyLeft > 0 ? jellyW : want.size ? W.want : 0);
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
    // a 2×2 square on its own clears 4 and makes a fish; next to a line it adds its other cells
    if (h < 3 && v < 3) return sq ? { cells: sq, shape: 'fish', low: Math.floor(Math.max(...sq) / C) } : null;
    const cells = [];
    if (h >= 3) for (let x = c0; x <= c1; x++) cells.push(r * C + x);
    if (v >= 3) for (let y = r0; y <= r1; y++) if (!(h >= 3 && y === r)) cells.push(y * C + c);
    if (sq) for (const k of sq) if (!cells.includes(k)) cells.push(k);
    const shape = h >= 5 || v >= 5 ? 'bomb' : h >= 3 && v >= 3 ? 'wrap' : h === 4 || v === 4 ? 'stripe' : sq ? 'fish' : '';
    return { cells, shape, low: Math.max(r1, r, ...cells.map(k => Math.floor(k / C))) };
  };

  let best = null, bestV = -Infinity;
  lastBestV = -Infinity;
  for (const mv of moves) {
    const { a, b } = mv;
    const p = g[a.r][a.c], q = g[b.r][b.c];
    let v = 0;
    const area = new Set();
    if (!p.block && !q.block && ((p.special !== 'none' && q.special !== 'none') || p.special === 'bomb' || q.special === 'bomb')) {
      // combo: estimate the cells it clears
      const sp = [p.special, q.special];
      if (sp[0] === 'bomb' && sp[1] === 'bomb') { for (let y = 0; y < R; y++) addRow(area, y); }
      else if (sp.includes('fish') && !sp.includes('bomb')) {
        const other = sp[0] === 'fish' ? sp[1] : sp[0];
        // fish + fish: 3 hits; fish + stripe: a row / column somewhere; fish + wrapped: a 3×3 somewhere
        v += other === 'fish' ? 3 * fishHit() : other === 'wrap' ? 9 + fishHit() : Math.max(R, C) + fishHit();
        area.add(a.r * C + a.c); area.add(b.r * C + b.c);
      }
      else if (sp.includes('bomb')) {
        const other = p.special === 'bomb' ? q : p;
        let n = 0;
        for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) {
          const o = g[y][x];
          if (!isCell(y, x) || !o || o.kind !== other.kind) continue;
          area.add(y * C + x);
          if (other.special === 'wrap') addSq(area, y, x, 1);
          else if (other.special === 'fish') v += fishHit();
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
      v += W.combo + comboBonus(p.special, q.special) + mech(new Set(), area, null);
    } else {
      g[a.r][a.c] = q; g[b.r][b.c] = p;
      const matched = new Set();
      let low = 0;
      for (const [r, c] of [[a.r, a.c], [b.r, b.c]]) {
        const L = lineInfo(r, c);
        if (!L) continue;
        if (L.shape) v += W[L.shape] + shapeBonus(L.shape);
        low = Math.max(low, L.low);
        for (const k of L.cells) matched.add(k);
      }
      for (const k of matched) {
        v += cellVal(k);
        const y = (k / C) | 0, x = k % C, sp = g[y][x].special;
        if (sp === 'h') addRow(area, y);
        else if (sp === 'v') addCol(area, x);
        else if (sp === 'wrap') addSq(area, y, x, 1);
        else if (sp === 'fish') v += W.fire * fishHit();
      }
      for (const k of area) if (!matched.has(k)) v += W.fire * cellVal(k);
      v += W.low * (low / Math.max(1, R - 1));
      g[a.r][a.c] = p; g[b.r][b.c] = q;
      v += mech(matched, area, mv);
    }
    v += rnd() * W.noise;   // people don't weigh moves exactly: near-equal moves are a coin flip
    if (v > bestV) { bestV = v; best = mv; }
  }
  lastBestV = bestV;
  return best;
}
// chocofirst：打到一塊巧克力就加這麼多，所以能打巧克力的步一定排第一
const CHOCO_FIRST = 1000;
let lastBestV = -Infinity;

export function pickMove(e, level, profile, rnd) {
  const W = PROFILES[profile];
  const s = e.snapshot();
  const moves = e.listMoves ? e.listMoves() : validMoves(s);
  if (!moves.length) return null;
  if (W.chocoFirst) {
    const mv = bestMove(s, moves, level, e, W, rnd);
    if (lastBestV >= CHOCO_FIRST) return mv;                 // 這一步打得到巧克力
  }
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
    movesLeft = Math.max(0, movesLeft - 1 - 3 * (res.alarms || 0));
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
