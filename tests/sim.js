// Balance simulation. Open tests/sim.html or run: python tests/run_tests.py --sim [--games 300]
//
// 預設（?mode=levels）：每一關讓兩種玩家各玩 N 局（tests/sim.bots.js：casual / decent），
//   流程和 js/main.js 一模一樣（目標一達成就結束 → Sugar Crush → 星星），每局是不同的「第 n 次玩」盤面。
//   印出過關率、1/2/3 星比例和最終分數，並對照平衡目標（下面的 TARGETS）。
//   ?games=300  ?profiles=casual,decent  ?only=1,5,12
// ?mode=api  ：不自動跑，給工具呼叫 window.simLevels(levels, { games, profiles, start })。
// ?mode=kinds：舊的「種類數 × 防連鎖」表（greedy / random 機器人，?games=60&moves=20）。
import { createEngine } from '../js/engine.js';
import { LEVELS, validateLevels } from '../js/levels.js';
import { PIECES } from '../js/pieces.js';
import { mulberry, runsIn } from './util.js';
import { playLevel } from './sim.bots.js';

const params = new URLSearchParams(location.search);
const MODE = params.get('mode') || 'levels';
const pad = (s, n) => String(s).padStart(n);
const pct = x => `${Math.round(100 * x)}%`;

// ---------- balance targets (per level) ----------
// decent: pass ≥ 97%, 3★ ≥ 70%.  casual: pass ≥ 85% (≥ 75% on 12–15), 2+★ ≥ 60%, 3★ ≥ 35% (≥ 50% on 1–5).
export function targetsFor(id) {
  return {
    decent: { pass: 0.97, s3: 0.70 },
    casual: { pass: id >= 12 ? 0.75 : 0.85, s2: 0.60, s3: id <= 5 ? 0.50 : 0.35 },
  };
}

// ---------- level games through a worker pool ----------
let pool = null;
function getPool() {
  if (pool) return pool;
  const n = Math.max(1, Math.min(16, (navigator.hardwareConcurrency || 4) - 1));
  pool = { workers: [], idle: [], queue: [], pending: new Map(), seq: 0 };
  for (let i = 0; i < n; i++) {
    const w = new Worker(new URL('./sim.worker.js', import.meta.url), { type: 'module' });
    w.onmessage = ev => {
      const job = pool.pending.get(ev.data.id);
      pool.pending.delete(ev.data.id);
      pool.idle.push(w);
      if (ev.data.error) job.reject(new Error(ev.data.error)); else job.resolve(ev.data.games);
      pump();
    };
    w.onerror = ev => { console.error('worker error', ev.message); };
    pool.workers.push(w);
    pool.idle.push(w);
  }
  return pool;
}
function pump() {
  while (pool.idle.length && pool.queue.length) {
    const w = pool.idle.pop(), job = pool.queue.shift();
    pool.pending.set(job.msg.id, job);
    w.postMessage(job.msg);
  }
}
function runJob(level, profile, a0, a1, fixed) {
  const p = getPool();
  return new Promise((resolve, reject) => {
    p.queue.push({ msg: { id: ++p.seq, level, profile, a0, a1, fixed }, resolve, reject });
    pump();
  });
}
// window.simLevels(levels, opts) -> { [id]: { [profile]: [[won, used, left, atGoal, final, stars], ...] } }
//   opts.fixed = n: every game is attempt n (the same board), only the player's choices differ
async function simLevels(levels, { games = 300, profiles = ['casual', 'decent'], start = 0, chunk = 25, fixed = null } = {}) {
  const tasks = [];
  const out = {};
  for (const L of levels) {
    out[L.id] = {};
    for (const prof of profiles) {
      const parts = [];
      for (let a = start; a < start + games; a += chunk) parts.push(runJob(L, prof, a, Math.min(start + games, a + chunk), fixed));
      tasks.push(Promise.all(parts).then(rs => { out[L.id][prof] = rs.flat(); }));
    }
  }
  await Promise.all(tasks);
  return out;
}

export function summarize(L, games) {
  const n = games.length;
  const wins = games.filter(g => g[0]);
  const finals = wins.map(g => g[4]).sort((a, b) => a - b);
  const q = f => (finals.length ? finals[Math.min(finals.length - 1, Math.floor(f * finals.length))] : 0);
  const used = wins.map(g => g[1]).sort((a, b) => a - b);
  const s = k => games.filter(g => g[5] >= k).length / n;
  return {
    pass: wins.length / n, s1: s(1), s2: s(2), s3: s(3),
    p25: q(0.25), p50: q(0.5), p75: q(0.75),
    usedP50: used.length ? used[used.length >> 1] : 0,
    leftP50: wins.length ? wins.map(g => g[2]).sort((a, b) => a - b)[wins.length >> 1] : 0,
  };
}

function goalStr(L) {
  const g = L.goal || {};
  if (g.type === 'score') return `分數 ${g.target}`;
  if (g.type === 'collect') return '收集 ' + Object.entries(g.items).map(([k, v]) => `${PIECES[PIECES.findIndex(p => p.id === k)].name}${v}`).join(' ');
  return '果凍';
}

// pad by display width (CJK = 2 columns) so the table lines up
const wlen = str => [...str].reduce((n, ch) => n + (ch.codePointAt(0) > 0x2e80 ? 2 : 1), 0);
const wpad = (str, n) => str + ' '.repeat(Math.max(0, n - wlen(str)));

async function levelsMain() {
  const t0 = performance.now();
  const games = parseInt(params.get('games') || '300', 10);
  const profiles = (params.get('profiles') || 'casual,decent').split(',');
  const only = params.get('only') ? new Set(params.get('only').split(',').map(Number)) : null;
  const levels = LEVELS.filter(L => !only || only.has(L.id));
  const problems = validateLevels(LEVELS, PIECES.map(p => p.id));
  // pooled: game k = the k-th replay's board.  first: the board every fresh start shows (attempt 0), k = player's luck
  const [res, res0] = await Promise.all([simLevels(levels, { games, profiles }), simLevels(levels, { games, profiles, fixed: 0 })]);
  const rows = [];
  const head = ' 關 步數 ' + wpad('目標', 29) + wpad('星星門檻', 19) + '| ' +
    profiles.map(p => `${p.padEnd(6)}  過關  ★2+   ★3 剩步 最終分數 p25/p50/p75`).join(' | ');
  const lines = [
    `毛絨消消樂 關卡模擬 — 每關每種玩家 ${games} 局，流程同 main.js：達成目標就結束 → 毛絨狂歡（sugarCrush）→ 星星（過關至少 1 顆）`,
    'casual = 60% 亂走 + 40% 眼前最好的一步；decent = 每步挑最好的（會找特殊方塊和組合技）。★2+ / ★3 = 拿到至少 2 / 3 顆星的局數比例（沒過關算 0 顆）',
    `validateLevels: ${problems.length ? problems.join('; ') : 'OK'}`,
  ];
  const misses = [];
  const block = (title, R, tag) => {
    lines.push('', title, head);
    for (const L of levels) {
      const T = targetsFor(L.id);
      const row = { id: L.id, set: tag, moves: L.moves, goal: L.goal, stars: L.stars };
      const parts = [];
      for (const prof of profiles) {
        const S = summarize(L, R[L.id][prof]);
        row[prof] = S;
        parts.push(`${''.padEnd(6)} ${pad(pct(S.pass), 5)} ${pad(pct(S.s2), 4)} ${pad(pct(S.s3), 4)} ${pad(S.leftP50, 4)} ${pad(S.p25, 6)} ${pad(S.p50, 6)} ${pad(S.p75, 6)}`);
        const t = T[prof];
        if (t) {
          const who = `L${L.id} ${tag} ${prof}`;
          if (S.pass < t.pass) misses.push(`${who} 過關 ${pct(S.pass)} < ${pct(t.pass)}`);
          if (t.s2 && S.s2 < t.s2) misses.push(`${who} ★2+ ${pct(S.s2)} < ${pct(t.s2)}`);
          if (S.s3 < t.s3) misses.push(`${who} ★3 ${pct(S.s3)} < ${pct(t.s3)}`);
        }
      }
      rows.push(row);
      lines.push(`${pad(L.id, 3)} ${pad(L.moves, 4)} ${wpad(goalStr(L), 29)}${wpad(L.stars.join('/'), 19)}| ` + parts.join(' | '));
    }
  };
  block(`【各種盤面】第 0…${games - 1} 次玩的盤面各一局`, res, '各盤面');
  block(`【第 0 個盤面】每次打開遊戲第一次玩都是這個盤面（同一盤面玩 ${games} 次，只有玩家的選擇不同）`, res0, '第0盤');
  lines.push('', misses.length ? '沒達到平衡目標：\n  ' + misses.join('\n  ') : '每一關都達到平衡目標 ✓（兩組都是）');
  lines.push(`(${((performance.now() - t0) / 1000).toFixed(1)} s)`);
  const text = lines.join('\n');
  document.getElementById('out').textContent = text;
  window.__sim = { rows, text, games, misses, problems };
}

// ---------- old table: kinds × antiCascade (greedy / random bots) ----------
function randomValidMove(e, rnd) {
  const s = e.snapshot();
  const moves = [];
  for (let r = 0; r < s.rows; r++) for (let c = 0; c < s.cols; c++) for (const [dr, dc] of [[0, 1], [1, 0]]) {
    const r2 = r + dr, c2 = c + dc;
    if (r2 >= s.rows || c2 >= s.cols || !s.mask[r][c] || !s.mask[r2][c2]) continue;
    const p = s.grid[r][c], q = s.grid[r2][c2];
    let valid = (p.special !== 'none' && q.special !== 'none') || p.special === 'bomb' || q.special === 'bomb';
    if (!valid) {
      s.grid[r][c] = q; s.grid[r2][c2] = p;
      valid = runsIn(s.grid).length > 0;
      s.grid[r][c] = p; s.grid[r2][c2] = q;
    }
    if (valid) moves.push({ a: { r, c }, b: { r: r2, c: c2 } });
  }
  return moves[Math.floor(rnd() * moves.length)];
}

function kindsMain() {
  const GAMES = parseInt(params.get('games') || '60', 10);
  const MOVES = parseInt(params.get('moves') || '20', 10);
  const KINDS = [4, 5, 6];
  const ACS = [0, 0.5, 0.7, 0.85];
  const runConfig = (nk, ac, bot) => {
    const kinds = [0, 1, 2, 3, 4, 5].slice(0, nk);
    let moves = 0, cascades = 0, withCascade = 0, specials = 0, points = 0, cleared = 0, shuffles = 0, combos = 0;
    const scores = [];
    for (let g = 0; g < GAMES; g++) {
      const seed = 5000 + g * 7 + nk * 1009;           // same boards for every antiCascade / bot
      const e = createEngine({ kinds, seed, antiCascade: ac });
      const rnd = mulberry(seed * 3 + 1);
      for (let m = 0; m < MOVES; m++) {
        const mv = bot === 'greedy' ? e.findHint() : randomValidMove(e, rnd);
        const pa = e.cell(mv.a.r, mv.a.c), pb = e.cell(mv.b.r, mv.b.c);
        if ((pa.special !== 'none' && pb.special !== 'none') || pa.special === 'bomb' || pb.special === 'bomb') combos++;
        const res = e.swap(mv.a, mv.b);
        if (!res.ok) throw new Error(`bot made an invalid move (${bot}, k${nk}, ac${ac})`);
        const cl = res.events.filter(x => x.t === 'clear');
        moves++;
        cascades += cl.length - 1;
        if (cl.length > 1) withCascade++;
        for (const x of cl) { specials += x.created.length; cleared += x.removed.length; }
        points += res.gained;
        if (res.events.some(x => x.t === 'shuffle')) shuffles++;
      }
      scores.push(e.score);
    }
    scores.sort((a, b) => a - b);
    const q = f => scores[Math.min(scores.length - 1, Math.floor(f * scores.length))];
    return {
      kinds: nk, antiCascade: ac, bot,
      cascadesPerMove: cascades / moves, specialsPerMove: specials / moves, pctFreeCascade: (100 * withCascade) / moves,
      pointsPerMove: points / moves, clearedPerMove: cleared / moves, perKindPerMove: cleared / moves / nk,
      shufflesPer100: (100 * shuffles) / moves, combosPer100: (100 * combos) / moves,
      score: { mean: scores.reduce((s, x) => s + x, 0) / scores.length, p10: q(0.1), p50: q(0.5), p90: q(0.9) },
    };
  };
  const f2 = x => x.toFixed(2);
  const t0 = performance.now();
  const rows = [];
  for (const nk of KINDS) for (const ac of ACS) for (const bot of ['greedy', 'random']) rows.push(runConfig(nk, ac, bot));
  const ms = performance.now() - t0;
  const head = `kinds  antiC | casc/mv  spec/mv  %freeC  pts/mv | cleared/mv  per-kind/mv | ${MOVES}-move score  p10 / p50 / p90 | rnd pts/mv  rnd %freeC | shuf/100 combo/100`;
  const lines = [
    `毛絨消消樂 balance sim — ${GAMES} games x ${MOVES} moves per row, 8x8 full board, greedy bot = findHint()`,
    head, '-'.repeat(head.length)];
  for (const nk of KINDS) {
    for (const ac of ACS) {
      const g = rows.find(r => r.kinds === nk && r.antiCascade === ac && r.bot === 'greedy');
      const r = rows.find(x => x.kinds === nk && x.antiCascade === ac && x.bot === 'random');
      lines.push(`${pad(nk, 5)}  ${pad(ac.toFixed(2), 5)} | ${pad(f2(g.cascadesPerMove), 7)}  ${pad(f2(g.specialsPerMove), 7)}  ${pad(g.pctFreeCascade.toFixed(1), 5)}%  ${pad(g.pointsPerMove.toFixed(0), 6)} | ` +
        `${pad(g.clearedPerMove.toFixed(1), 10)}  ${pad(g.perKindPerMove.toFixed(2), 11)} | ${pad(g.score.mean.toFixed(0), 13)}  ${pad(g.score.p10, 5)} / ${pad(g.score.p50, 5)} / ${pad(g.score.p90, 5)} | ` +
        `${pad(r.pointsPerMove.toFixed(0), 10)}  ${pad(r.pctFreeCascade.toFixed(1), 9)}% | ${pad(f2(g.shufflesPer100), 8)} ${pad(f2(g.combosPer100), 9)}`);
    }
    lines.push('');
  }
  lines.push(`(${(ms / 1000).toFixed(1)} s, ${rows.length * GAMES * MOVES} simulated moves)`);
  const text = lines.join('\n');
  document.getElementById('out').textContent = text;
  window.__sim = { rows, text, games: GAMES, moves: MOVES };
}

window.simLevels = simLevels;
window.simLevelsLocal = (L, profile, a0, a1) => { const o = []; for (let k = a0; k < a1; k++) o.push(playLevel(L, profile, k)); return o; };
window.LEVELS = LEVELS;
window.validateLevels = L => validateLevels(L || LEVELS, PIECES.map(p => p.id));

const fail = err => {
  document.getElementById('out').textContent = String(err.stack || err);
  window.__sim = { error: String(err.stack || err), text: '' };
};
if (MODE === 'api') {
  document.getElementById('out').textContent = 'api mode: window.simLevels(levels, { games, profiles })';
  window.__simReady = true;
} else if (MODE === 'kinds') {
  try { kindsMain(); } catch (err) { fail(err); }
} else {
  levelsMain().catch(fail);
}
