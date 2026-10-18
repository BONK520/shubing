// Balance simulation: bots play many short games for each kinds / antiCascade setting.
// Open tests/sim.html or run: python tests/run_tests.py --sim [--games 60 --moves 20]
//   greedy bot = always plays engine.findHint() (biggest match / special / combo first)
//   random bot = a uniformly random valid swap (a careless player; lower bound)
import { createEngine } from '../js/engine.js';
import { mulberry, runsIn } from './util.js';

const params = new URLSearchParams(location.search);
const GAMES = parseInt(params.get('games') || '60', 10);
const MOVES = parseInt(params.get('moves') || '20', 10);
const KINDS = [4, 5, 6];
const ACS = [0, 0.5, 0.7, 0.85];

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

function runConfig(nk, ac, bot) {
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
    cascadesPerMove: cascades / moves,
    specialsPerMove: specials / moves,
    pctFreeCascade: (100 * withCascade) / moves,
    pointsPerMove: points / moves,
    clearedPerMove: cleared / moves,
    perKindPerMove: cleared / moves / nk,
    shufflesPer100: (100 * shuffles) / moves,
    combosPer100: (100 * combos) / moves,
    score: { mean: scores.reduce((s, x) => s + x, 0) / scores.length, p10: q(0.1), p50: q(0.5), p90: q(0.9) },
  };
}

const pad = (s, n) => String(s).padStart(n);
const f2 = x => x.toFixed(2);

function main() {
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

try { main(); } catch (err) {
  document.getElementById('out').textContent = String(err.stack || err);
  window.__sim = { error: String(err.stack || err), text: '' };
}
