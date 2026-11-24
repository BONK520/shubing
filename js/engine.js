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
//   bottom cell (and every cell above a hole) is an exit. Option `licorice: { rate, max }`: new pieces are sometimes licorice swirls.
//   Option `portals: [[r1, c1, r2, c2], …]`: what falls out of the bottom of (r1, c1) comes in at the top of
//   (r2, c2) (fall paths mark that step with `warp: true`).
//   Obstacle 'A' = an alarm clock (block 'alarm', kind -7, hp = moves left on its timer). Option
//   `alarm: { timer = 15, rate = 0, max = 2 }`: the starting number, and how often new pieces are alarms. Each
//   swap() counts down every alarm that was on the board before it; at 0 it bursts (event 'alarm', then fall and
//   settle) and swap() returns `alarms` = how many burst (main.js takes 3 moves each). Boosters do not tick them.
//   Obstacle 'X' / 'Y' = a hard shell (block 'shell', kind -8) with 1 / 2 layers: fills the cell, never moves, and a
//   match next to it does nothing; only effects (stripes, wrapped, fish, combos, boosters) take off a layer.
//   stats also: dinosOut, dinosTotal, frostLeft (layers), chocoLeft, licoriceLeft, locksLeft, alarmsLeft, alarmsBurst,
//   shellLeft (layers).
//   Obstacle 'P' = a chocolate pot (block 'pot', kind -9): fills the cell, never moves, cannot be removed. After a
//   player move that broke no chocolate, or that left no chocolate on the board, one pot spits one chocolate onto
//   the nearest normal piece (event 'spread' with `from` = the pot; then plain chocolate does not grow by itself).
//   Option `pot: { max = 8 }`: no spitting while that many chocolates are on the board. With dinos and no E, the
//   cell above a pot is an exit too.
//   Obstacles '-' / '|' / 'W' / 'B' = a gift: a special (stripe h / stripe v / wrapped / colour bomb) under plastic
//   wrap (lock 2 in the cage layer). Like a cage it cannot be swapped and does not fall; a match through it, a match
//   next to it or any effect only opens the wrap (clear `unlocks` item with `gift: true`) — the special inside does
//   not fire then and can be used afterwards. stats: giftLeft (locksLeft counts cages only).
//   Option `belts: [[[r, c], …], …]` (or {r, c}) = conveyor belts. After each swap() (not boosters, not sugarCrush),
//   once the move has settled, every piece on a belt moves one cell along it (the last cell's piece goes to the
//   first one; `warp: true` when they are not neighbours) — event 'belt' { moves: [{ id, from, to, warp? }] }, replayed
//   like a fall. Then matching again (free cascades), then the alarms tick. A belt with a hole, a cage / gift or a
//   fixed block (frost, chocolate, shell, pot) on it waits that move. Chocolate never grows / is spat onto a belt.
//   ---- 第131關起（工作單9）----
//   Obstacle 'G' / 'Q' = a ticket gate (block 'gate', kind -10, hp = tickets still needed: 1 / 2). Never moves, nothing
//   breaks it. Obstacle 'T' = a ticket on the starting normal piece (piece.tk = 1). Option `tickets: { rate, max = 3 }`:
//   new pieces carry a ticket with that chance while a closed gate is left and fewer than `max` tickets are on the
//   board. When a piece with a ticket is removed (any cause) the ticket flies to the nearest closed gate (Manhattan
//   distance, ties: upper row, then left column): clear effect { fx: 'ticket', r, c, to }, the gate loses 1 (clear
//   blockerHits) or opens (removed with cause 'ticket') and leaves a striped piece there (created).
//   Obstacle 'O' = a hot-air balloon (block 'balloon', kind -11). It can be swapped but never matches or falls;
//   nothing breaks it. After each swap() (after the belts), every balloon trades places with the movable piece
//   above it (event 'float' { moves: [{ id, from, to, warp? }] }, replayed like a belt; through a portal exit it
//   goes up the portal). A balloon with no cell above leaves the board (event 'exit' with `balloon: true`, then fall).
//   Obstacles 'a'–'d' = a honey jar (block 'jar', kind -12, jk = kinds[0..3], hp = pieces still needed, option
//   `jar: { need = 6 }`). Never moves, nothing breaks it; each removed piece of kind jk in the 8 cells around it
//   fills it by 1 (one blockerHits item per jar per step). Full: removed (cause 'near') and bursts radius 1.
//   Obstacle 'U' = a surprise egg (block 'surprise', kind -13, hp 3, option `egg: { hp }`). Never moves; a match next to it or an effect
//   takes 1 (once per step); at 0 it is removed and a random special (h / v / wrap / fish) appears there (created).
//   Obstacles 'm' 'n' 'o' 'p' = lanterns on string 1–4 (block 'lantern', kind -14, hp = string id). Never move; a match
//   next to any lantern or an effect on it lights (removes) every lantern of that string in the same step.
//   Obstacle 'K' = an oven (block 'oven', kind -15, hp = fire 0–2, option `oven: { fire }` to start with). Never moves, never removed; a match next to it
//   or an effect adds 1 fire (blockerHits with left = new fire, once per step); the third fire bakes: fire back to 0
//   and a cross (row + column) goes off from the oven.
//   counts().prog / stats.prog = { gatesOpened, balloonsOut, jarsFilled, eggsHatched, lanternsLit, bakes };
//   stats also gateLeft, balloonLeft, jarLeft, eggLeft, lanternLeft (strings), ovenCount, ticketsOnBoard.
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
  const next = function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // 玩到一半的存檔要能接著玩：亂數的位置也要存起來、再放回去
  next.getState = () => a;
  next.setState = v => { a = Number(v) | 0; };
  return next;
}

function parseLayout(layout) {
  return layout.map((row, r) => {
    const compact = String(row).replace(/\s+/g, '');
    const toks = compact.match(/\d[hvwf]?|[B*.?]/g) || [];
    if (toks.join('') !== compact) throw new Error(`engine: bad layout row ${r}: "${row}"`);
    return toks;
  });
}

const cp = p => {
  if (!p) return null;
  const o = p.block ? { id: p.id, kind: p.kind, special: p.special, block: p.block, hp: p.hp } : { id: p.id, kind: p.kind, special: p.special };
  if (p.tk) o.tk = 1;                       // 車票（第131關起）
  if (p.jk !== undefined) o.jk = p.jk;      // 蜂蜜罐要的玩偶
  return o;
};
const isSpecial = p => !!p && !p.block && p.special !== NONE;
// two specials, or a colour bomb with a candy; blockers (dino, licorice …) never make a combo
const isComboPair = (p, q) => !p.block && !q.block && ((isSpecial(p) && isSpecial(q)) || p.special === 'bomb' || q.special === 'bomb');
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BLOCK_KIND = { dino: -3, frost: -4, choco: -5, licorice: -6, alarm: -7, shell: -8, pot: -9,
  gate: -10, balloon: -11, jar: -12, surprise: -13, lantern: -14, oven: -15 };
// 第131關起的固定方塊（不會動、不會掉）：票閘、蜂蜜罐、驚喜蛋、燈籠、烤箱
const FIXED_NEW = new Set(['gate', 'jar', 'surprise', 'lantern', 'oven']);
// 打不壞的：龍龍、巧克力壺、票閘（只吃車票）、熱氣球（只會往上飄）、蜂蜜罐（只吃同種玩偶）
const IMMUNE = new Set(['dino', 'pot', 'gate', 'balloon', 'jar']);
const HATCH = ['h', 'v', 'wrap', 'fish'];   // what a surprise egg hatches into

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
  // 鬧鐘：每走一步倒數一格（hp = 還剩幾步），數到 0 爆開；timer = 起始數字，rate / max = 從上面掉下來的機率和上限
  const alarmOpt = opts.alarm ? { timer: (opts.alarm.timer | 0) || 15, rate: opts.alarm.rate || 0, max: opts.alarm.max ?? 2 } : null;
  const alarmTimer = alarmOpt ? alarmOpt.timer : 15;
  // 巧克力壺：盤面上巧克力到 potMax 塊就先不噴
  const potMax = opts.pot && opts.pot.max > 0 ? opts.pot.max | 0 : 8;
  let potCount = 0;
  // 車票：新掉下來的方塊有 rate 的機率帶車票（盤上還有關著的票閘、車票少於 max 張時）
  const ticketOpt = opts.tickets && opts.tickets.rate > 0 ? { rate: opts.tickets.rate, max: opts.tickets.max ?? 3 } : null;
  // 蜂蜜罐：要裝幾隻同種玩偶才會滿
  const jarNeed = opts.jar && opts.jar.need > 0 ? opts.jar.need | 0 : 6;
  // starting hp for eggs (1–3) and starting fire for ovens (0–2); the tutorial demos use these to show a hatch / bake in two steps
  const eggHp = opts.egg && opts.egg.hp >= 1 && opts.egg.hp <= 3 ? opts.egg.hp | 0 : 3;
  const ovenFire = opts.oven && opts.oven.fire >= 0 && opts.oven.fire <= 2 ? opts.oven.fire | 0 : 0;
  // 第131關起的機關計數：開了幾個票閘、飛走幾個熱氣球、裝滿幾罐蜂蜜、孵了幾顆蛋、點亮幾串燈籠、烤好幾次
  const prog = { gatesOpened: 0, balloonsOut: 0, jarsFilled: 0, eggsHatched: 0, lanternsLit: 0, bakes: 0 };
  let hasNew = !!ticketOpt;   // a 第131關起 mechanic is on the board (cellValue / stats only look for them then)
  const beltsIn = (Array.isArray(opts.belts) ? opts.belts : []).map(path => (Array.isArray(path) ? path : [])
    .map(q => (Array.isArray(q) ? { r: q[0] | 0, c: q[1] | 0 } : { r: q.r | 0, c: q.c | 0 })));

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
  let alarmsLeft = 0, alarmsBurst = 0, shellLeft = 0, giftLeft = 0;
  // 訂單目標用：做出幾個條紋 / 包裝糖 / 彩色炸彈 / 飛天玩偶、打出哪些組合；收集巧克力目標用：一共打掉幾塊巧克力
  const made = { stripe: 0, wrap: 0, bomb: 0, fish: 0 };
  const combos = {};
  let comboCount = 0, chocoGot = 0;
  const kindOf = s => (s === 'h' || s === 'v' ? 'stripe' : s);
  const counts = () => ({ made: { ...made }, combos: { ...combos }, comboCount, chocoGot, prog: { ...prog } });

  const newPiece = (kind, special = NONE) => ({ id: nextId++, kind, special });
  const newBlock = (block, hp = 1) => ({ id: nextId++, kind: BLOCK_KIND[block], special: NONE, block, hp });
  const isCell = (r, c) => r >= 0 && r < rows && c >= 0 && c < cols && cellMask[r][c];
  const key = (r, c) => r * cols + c;
  // 輸送帶：每條至少兩格、格子都在盤面上、彼此不重疊（重疊的那條不用）
  const belts = [], beltAt = new Set();
  for (const path of beltsIn) {
    if (path.length < 2 || !path.every(q => isCell(q.r, q.c))) continue;
    const ks = path.map(q => key(q.r, q.c));
    if (new Set(ks).size !== ks.length || ks.some(k => beltAt.has(k))) continue;
    ks.forEach(k => beltAt.add(k));
    belts.push(path.map(q => ({ r: q.r, c: q.c })));
  }
  const onBelt = (r, c) => beltAt.has(key(r, c));
  // kind usable for matching at (r,c), or -9 (hole / empty / bomb)
  const kAt = (r, c) => {
    if (!isCell(r, c)) return -9;
    const p = grid[r][c];
    return p && p.kind >= 0 ? p.kind : -9;
  };
  const gridCopy = () => grid.map(row => row.map(cp));
  const jellyCopy = () => jel.map(row => row.slice());
  const ev = o => { o.board = gridCopy(); o.jelly = jellyCopy(); o.lock = lock.map(row => row.slice()); o.cnt = counts(); return o; };
  // frosting / chocolate / hard shells / pots and caged pieces never move; everything else falls
  const isFixedBlock = p => !!p && (p.block === 'frost' || p.block === 'choco' || p.block === 'shell' || p.block === 'pot' || FIXED_NEW.has(p.block));
  // a balloon can be swapped but never falls (it floats up by itself)
  const immovable = (r, c) => !!lock[r][c] || isFixedBlock(grid[r][c]) || (!!grid[r][c] && grid[r][c].block === 'balloon');
  const movableAt = (r, c) => isCell(r, c) && !!grid[r][c] && !immovable(r, c);
  const canSwap = (r, c) => isCell(r, c) && !!grid[r][c] && !lock[r][c] && !isFixedBlock(grid[r][c]);
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
      // cage: it breaks, the piece inside stays (a match through it also counts for the jelly under it);
      // a gift's wrap opens the same way and the special inside does not fire
      st.done.add(k);
      if (lock[r][c] === 2) { giftLeft--; st.unlocks.push({ r, c, gift: true }); } else { locksLeft--; st.unlocks.push({ r, c }); }
      lock[r][c] = 0;
      hitJelly(st, r, c);
      if (cause !== 'match') addPts(st, src.r, src.c, EFFECT_POINTS * st.mult);
      return true;
    }
    if (!p) return false;
    if (IMMUNE.has(p.block)) return false;   // dinos, chocolate pots, gates, balloons and honey jars cannot be destroyed
    if (p.block === 'surprise') {
      st.done.add(k);
      p.hp--;
      addPts(st, src.r, src.c, EFFECT_POINTS * st.mult);
      if (p.hp > 0) { st.blockerHits.push({ r, c, block: 'surprise', left: p.hp }); return true; }
      grid[r][c] = null;
      st.removed.push({ r, c, piece: cp(p), cause });
      hitJelly(st, r, c);
      prog.eggsHatched++;
      spawnAt(st, r, c, HATCH[rand(HATCH.length)]);
      return true;
    }
    if (p.block === 'lantern') {
      // the whole string lights up at once
      const sid = p.hp;
      forCells((y, x) => {
        const q = grid[y][x], kk = key(y, x);
        if (!q || q.block !== 'lantern' || q.hp !== sid || lock[y][x] || (st.done.has(kk) && kk !== k)) return;
        st.done.add(kk);
        grid[y][x] = null;
        st.removed.push({ r: y, c: x, piece: cp(q), cause });
        hitJelly(st, y, x);
      });
      st.done.add(k);
      prog.lanternsLit++;
      addPts(st, src.r, src.c, EFFECT_POINTS * 2 * st.mult);
      return true;
    }
    if (p.block === 'oven') {
      st.done.add(k);
      p.hp++;
      if (p.hp >= 3) { p.hp = 0; prog.bakes++; st.queue.push({ r, c, special: 'oven' }); }
      st.blockerHits.push({ r, c, block: 'oven', left: p.hp });
      addPts(st, src.r, src.c, EFFECT_POINTS * st.mult);
      return true;
    }
    if (p.block === 'shell' && (cause === 'near' || cause === 'match')) return false;   // only effects crack a shell
    if ((p.block === 'frost' || p.block === 'shell') && p.hp > 1) {
      st.done.add(k);
      p.hp--;
      if (p.block === 'frost') frostLeft--; else shellLeft--;
      st.blockerHits.push({ r, c, block: p.block, left: p.hp });
      addPts(st, src.r, src.c, EFFECT_POINTS * st.mult);
      return true;
    }
    if (p.block) {
      st.done.add(k);
      grid[r][c] = null;
      if (p.block === 'frost') frostLeft--;
      else if (p.block === 'choco') { chocoLeft--; chocoBroken++; chocoGot++; }
      else if (p.block === 'licorice') licoriceLeft--;
      else if (p.block === 'alarm') alarmsLeft--;
      else if (p.block === 'shell') shellLeft--;
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
    onRemoved(st, r, c, p);
    return true;
  }
  // a normal piece left the board: its ticket flies to a gate, honey jars of its kind around it fill up
  function onRemoved(st, r, c, p) {
    if (p.tk) deliverTicket(st, r, c);
    if (p.kind >= 0) feedJars(st, r, c, p.kind);
  }
  // one blockerHits item per cell per step (gates and jars can take several in one step)
  function bumpHit(st, r, c, block, left) {
    const kk = key(r, c);
    if (!st.bh) st.bh = new Map();
    const e = st.bh.get(kk);
    if (left > 0) {
      if (e) e.left = left;
      else { const n = { r, c, block, left }; st.blockerHits.push(n); st.bh.set(kk, n); }
    } else if (e) { st.blockerHits.splice(st.blockerHits.indexOf(e), 1); st.bh.delete(kk); }
  }
  function deliverTicket(st, r, c) {
    let best = null, bd = Infinity;
    forCells((y, x) => {
      const q = grid[y][x];
      if (!q || q.block !== 'gate' || q.hp <= 0) return;
      const d = Math.abs(y - r) + Math.abs(x - c);
      if (d < bd) { bd = d; best = { r: y, c: x }; }
    });
    if (!best) return;
    st.effects.push({ fx: 'ticket', r, c, to: { ...best } });
    const g = grid[best.r][best.c];
    g.hp--;
    addPts(st, best.r, best.c, EFFECT_POINTS * st.mult);
    bumpHit(st, best.r, best.c, 'gate', g.hp);
    if (g.hp > 0) return;
    st.done.add(key(best.r, best.c));
    grid[best.r][best.c] = null;
    st.removed.push({ r: best.r, c: best.c, piece: cp(g), cause: 'ticket' });
    hitJelly(st, best.r, best.c);
    prog.gatesOpened++;
    spawnAt(st, best.r, best.c, rng() < 0.5 ? 'h' : 'v');
  }
  function feedJars(st, r, c, kind) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const y = r + dy, x = c + dx;
      if ((!dy && !dx) || !isCell(y, x)) continue;
      const q = grid[y][x];
      if (!q || q.block !== 'jar' || q.jk !== kind || q.hp <= 0) continue;
      q.hp--;
      addPts(st, y, x, EFFECT_POINTS * st.mult);
      bumpHit(st, y, x, 'jar', q.hp);
      if (q.hp > 0) continue;
      st.done.add(key(y, x));
      grid[y][x] = null;
      st.removed.push({ r: y, c: x, piece: cp(q), cause: 'near' });
      hitJelly(st, y, x);
      prog.jarsFilled++;
      st.queue.push({ r: y, c: x, special: 'jar' });
    }
  }
  // a special appears in an empty cell during a step (gate opened, egg hatched); it does not fire this step
  function spawnAt(st, r, c, special) {
    const np = newPiece(special === 'bomb' ? -1 : kinds[rand(kinds.length)], special);
    grid[r][c] = np;
    st.prot.add(key(r, c)); st.done.add(key(r, c));
    st.created.push({ r, c, piece: cp(np) });
    specialsMade++;
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
  // frosting / chocolate / licorice / alarms next to a matched cell lose a layer, gifts open (once per step each)
  function hitNear(st, cells) {
    for (const [r, c] of cells) for (const [dr, dc] of DIRS) {
      const y = r + dr, x = c + dc;
      if (!isCell(y, x)) continue;
      const q = grid[y][x];
      if (lock[y][x] === 2 || (q && (q.block === 'frost' || q.block === 'choco' || q.block === 'licorice' || q.block === 'alarm' ||
        q.block === 'surprise' || q.block === 'lantern' || q.block === 'oven'))) hit(st, y, x, 'near', { r, c });
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
  // fish target: an alarm about to go off; a piece on jelly; else a piece the collect goal still needs; else a normal
  // piece; else any piece
  function fishTarget(st, src) {
    const tiers = [[], [], [], [], [], [], []];
    forCells((r, c) => {
      const p = grid[r][c], k = key(r, c);
      if (!p || p.block === 'dino' || p.block === 'gate' || p.block === 'balloon' || p.block === 'jar' ||
        st.done.has(k) || st.prot.has(k) || (r === src.r && c === src.c)) return;
      const underDino = r > 0 && grid[r - 1][c] && grid[r - 1][c].block === 'dino';
      if (p.block === 'alarm' && p.hp <= 3) tiers[0].push({ r, c });
      else if (jel[r][c] > 0) tiers[1].push({ r, c });
      else if (collect && p.kind >= 0 && collect[p.kind] > (cleared[p.kind] || 0)) tiers[2].push({ r, c });
      else if (underDino) tiers[3].push({ r, c });                       // clear the way for a dino
      else if (p.block || lock[r][c]) tiers[4].push({ r, c });            // frosting, chocolate, licorice, alarms, cages
      else if (p.special === NONE) tiers[5].push({ r, c });
      else tiers[6].push({ r, c });
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
      else if (special === 'oven') {
        // 烤箱烤好：從烤箱射出十字
        const f1 = { fx: 'line', dir: 'h', r, c }, f2 = { fx: 'line', dir: 'v', r, c };
        st.effects.push(f1, f2);
        const a = hitRow(st, r, c, 'combo', src); if (a) f1.reach = a;
        const b = hitCol(st, r, c, 'combo', src); if (b) f2.reach = b;
      } else if (special === 'jar') { st.effects.push({ fx: 'blast', r, c, radius: 1 }); hitSquare(st, r, c, 1, 'combo', src); }
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
        if (g.kind >= 0) feedJars(st, r, c, g.kind);
      } else {
        if (p) {
          st.removed.push({ r, c, piece: cp(p), cause: 'match' });
          countCleared(p);
          st.queue.push({ r, c, special: p.special });
          onRemoved(st, r, c, p);
        }
        np = newPiece(cls.special === 'bomb' ? -1 : g.kind, cls.special);
        grid[r][c] = np;
      }
      st.created.push({ r, c, piece: cp(np) });
      specialsMade++;
      if (made[kindOf(cls.special)] !== undefined) made[kindOf(cls.special)]++;
    }
    runQueue(st);
    return finishStep(st);
  }

  // swap already applied: grid[b] holds the piece that came from a
  function comboSteps(a, b, events) {
    const pa = grid[a.r][a.c], pb = grid[b.r][b.c];
    const st = newStep(1);
    let again = null;
    if (isSpecial(pa) && isSpecial(pb)) {
      // 兩個特殊方塊互換才算「組合」（彩色炸彈配普通玩具不算）
      const ck = [kindOf(pa.special), kindOf(pb.special)].sort().join('+');
      combos[ck] = (combos[ck] || 0) + 1;
      comboCount++;
    }
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
  // exits worth drawing: not the end of a short column top that dinos never drop into (they still work as exits)
  const shownExits = () => {
    const out = exitAt.map(row => row.slice()), ok = dinoCol();
    for (const ch of chains) {
      const end = ch[ch.length - 1];
      if (isSpawner(ch[0]) && !ok[ch[0].c] && !ch.some(q => immovable(q.r, q.c))) out[end.r][end.c] = false;
    }
    return out;
  };
  // columns a dino may drop into: the spawner's chain is at least 4 cells long (or the longest there is)
  let dinoCols = null;
  const dinoCol = () => {
    if (dinoCols) return dinoCols;
    const len = new Array(cols).fill(0);
    for (const ch of chains) if (isSpawner(ch[0])) len[ch[0].c] = ch.length;
    const need = Math.min(4, Math.max(...len));
    return (dinoCols = len.map(n => n > 0 && n >= need));
  };
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
    // a dino drops in at the top while the goal still needs more (the highest new piece in a column with a real way
    // down — at least 4 cells to its exit — becomes one)
    if (dinoOpt && fresh.length && dinosSpawned < dinoOpt.total && dinosOnBoard < dinoOpt.onBoard && rng() < dinoOpt.rate) {
      const ok = fresh.filter(x => dinoCol()[x.sp.c]);
      if (ok.length) {
        const top = ok.reduce((m, x) => (x.at.r < m.at.r ? x : m), ok[0]);
        Object.assign(top.sp.p, { kind: BLOCK_KIND.dino, block: 'dino', hp: 0 });
        dinosSpawned++; dinosOnBoard++;
      }
    }
    let gatesClosed = 0, ticketsNow = 0;
    if (ticketOpt) forCells((r, c) => { const q = grid[r][c]; if (q && q.block === 'gate') gatesClosed++; else if (q && q.tk && !fresh.some(x => x.sp.p === q)) ticketsNow++; });
    for (const { sp, at } of fresh) {
      if (sp.p.block) continue;
      if (licOpt && licoriceLeft < licOpt.max && rng() < licOpt.rate) { Object.assign(sp.p, { kind: BLOCK_KIND.licorice, block: 'licorice', hp: 1 }); licoriceLeft++; continue; }
      if (alarmOpt && alarmOpt.rate > 0 && alarmsLeft < alarmOpt.max && rng() < alarmOpt.rate) { Object.assign(sp.p, { kind: BLOCK_KIND.alarm, block: 'alarm', hp: alarmOpt.timer }); alarmsLeft++; continue; }
      sp.p.kind = pickKind(at.r, at.c);
      if (ticketOpt && gatesClosed > 0 && ticketsNow < ticketOpt.max && rng() < ticketOpt.rate) { sp.p.tk = 1; ticketsNow++; }
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
        if (!isCell(y, x) || lock[y][x] || onBelt(y, x)) continue;
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
  // 巧克力壺：這一步沒打到巧克力、或盤上的巧克力被打光了 → 一個壺（隨機）往離它最近的一般方塊噴一塊巧克力
  function potSpit(events) {
    if (chocoLeft >= potMax) return;
    const pots = [];
    forCells((r, c) => { const p = grid[r][c]; if (p && p.block === 'pot') pots.push({ r, c }); });
    for (let i = pots.length - 1; i > 0; i--) { const j = rand(i + 1); [pots[i], pots[j]] = [pots[j], pots[i]]; }
    for (const s of pots) {
      const seen = new Set([key(s.r, s.c)]);
      let front = [s];
      while (front.length) {
        const next = [], cand = [];
        for (const q of front) for (const [dr, dc] of DIRS) {
          const y = q.r + dr, x = q.c + dc;
          if (!isCell(y, x) || seen.has(key(y, x))) continue;
          seen.add(key(y, x));
          next.push({ r: y, c: x });
          const p = grid[y][x];
          if (p && !p.block && p.kind >= 0 && p.special === NONE && !lock[y][x] && !onBelt(y, x)) cand.push({ r: y, c: x });
        }
        if (cand.length) {
          const to = cand[rand(cand.length)], was = grid[to.r][to.c], np = newBlock('choco', 1);
          grid[to.r][to.c] = np;
          chocoLeft++;
          events.push(ev({ t: 'spread', from: { ...s }, to, piece: cp(np), was: cp(was) }));
          return;
        }
        front = next;
      }
    }
  }

  // 輸送帶：帶子上的方塊各往前一格（最後一格回到第一格）；有空格、籠子、保鮮膜或固定方塊的那條這一步不動
  function runBelts(events) {
    const moves = [];
    for (const path of belts) {
      if (path.some(q => !grid[q.r][q.c] || immovable(q.r, q.c))) continue;
      const ps = path.map(q => grid[q.r][q.c]), n = path.length;
      for (let i = 0; i < n; i++) {
        const from = path[i], to = path[(i + 1) % n];
        grid[to.r][to.c] = ps[i];
        const m = { id: ps[i].id, from: { ...from }, to: { ...to } };
        if (Math.abs(from.r - to.r) + Math.abs(from.c - to.c) !== 1) m.warp = true;
        moves.push(m);
      }
    }
    if (!moves.length) return false;
    events.push(ev({ t: 'belt', moves }));
    return true;
  }

  // 熱氣球：每一步走完，每顆氣球和正上方的方塊換位置（往上飄一格）；上面已經沒有格子的氣球飄走（算收集）
  function floatBalloons(events) {
    const exits = [], swaps = [];
    forCells((r, c) => {
      const p = grid[r][c];
      if (!p || p.block !== 'balloon' || lock[r][c]) return;
      const t = above(r, c);
      if (!t) { exits.push({ r, c }); return; }
      const q = grid[t.r][t.c];
      if (!q || q.block === 'balloon' || lock[t.r][t.c] || isFixedBlock(q)) return;
      swaps.push({ from: { r, c }, to: { r: t.r, c: t.c } });
    });
    if (!exits.length && !swaps.length) return false;
    if (swaps.length) {
      const moves = [];
      for (const { from, to } of swaps) {
        const b = grid[from.r][from.c], q = grid[to.r][to.c];
        grid[to.r][to.c] = b; grid[from.r][from.c] = q;
        const warp = Math.abs(from.r - to.r) + Math.abs(from.c - to.c) !== 1;
        const m1 = { id: b.id, from: { ...from }, to: { ...to } }, m2 = { id: q.id, from: { ...to }, to: { ...from } };
        if (warp) { m1.warp = true; m2.warp = true; }
        moves.push(m1, m2);
      }
      events.push(ev({ t: 'float', moves }));
    }
    if (exits.length) {
      const cells = exits.map(({ r, c }) => ({ r, c, piece: cp(grid[r][c]) }));
      for (const { r, c } of exits) grid[r][c] = null;
      prog.balloonsOut += exits.length;
      events.push(ev({ t: 'exit', cells, balloon: true }));
      fall(events);
    }
    return true;
  }
  const hasBalloon = () => { let n = 0; if (hasNew) forCells((r, c) => { if (grid[r][c] && grid[r][c].block === 'balloon') n++; }); return n > 0; };

  // 鬧鐘：這一步開始前就在盤面上的鬧鐘各倒數一格；數到 0 的爆開（拿掉，main.js 扣 3 步），再掉落、連鎖。
  // 回傳這一步爆了幾個
  function alarmIds() {
    const ids = new Set();
    if (alarmsLeft > 0) forCells((r, c) => { const p = grid[r][c]; if (p && p.block === 'alarm') ids.add(p.id); });
    return ids;
  }
  function tickAlarms(events, ids, cascade) {
    if (!ids.size) return 0;
    const ticks = [], burst = [];
    forCells((r, c) => {
      const p = grid[r][c];
      if (!p || p.block !== 'alarm' || !ids.has(p.id)) return;
      p.hp = Math.max(0, p.hp - 1);
      ticks.push({ r, c, hp: p.hp });
    });
    if (!ticks.length) return 0;
    events.push(ev({ t: 'tick', cells: ticks }));
    for (const { r, c, hp } of ticks) {
      if (hp > 0) continue;
      burst.push({ r, c, piece: cp(grid[r][c]) });
      grid[r][c] = null;
      alarmsLeft--; alarmsBurst++;
    }
    if (!burst.length) return 0;
    events.push(ev({ t: 'alarm', cells: burst }));
    fall(events);
    cascadesMax = Math.max(cascadesMax, settle(events, cascade, null));
    return burst.length;
  }

  // matches -> clear -> fall, repeated; when nothing matches, dinos standing on exits leave (then gravity, and
  // matching again). Returns the last cascade number used
  function settle(events, cascade, swapped) {
    let last = cascade - 1;
    for (let guard = 0; guard < 200; guard++) {
      const groups = findGroups();
      if (!groups.length) {
        if (collectDinos(events)) { fall(events); continue; }
        break;
      }
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
  // every valid swap (simulation bots pick from these; they know cages, frosting and blockers this way)
  function listMoves() {
    const out = [];
    forCells((r, c) => {
      if (isCell(r, c + 1) && pairValid(r, c, r, c + 1)) out.push({ a: { r, c }, b: { r, c: c + 1 } });
      if (isCell(r + 1, c) && pairValid(r, c, r + 1, c)) out.push({ a: { r, c }, b: { r: r + 1, c } });
    });
    return out;
  }
  const COMBO_VALUE = { 'bomb+bomb': 1000, 'bomb+wrap': 900, 'bomb+h': 850, 'bomb+v': 850, 'bomb+fish': 800, 'wrap+wrap': 700,
    'h+wrap': 650, 'v+wrap': 650, 'h+h': 600, 'h+v': 600, 'v+v': 600,
    'fish+wrap': 580, 'fish+h': 560, 'fish+v': 560, 'fish+fish': 540 };
  function cellValue(r, c) {
    const { h, v } = lineLens(r, c);
    const sq = squareOf(r, c);
    // specials in the match fire (+40); cells on jelly help the jelly goal (+35); with board mechanics also a cage
    // opened (+35), frosting / chocolate / a swirl next to it (+25 each) and a dino above it that will drop (+45)
    const mech = frostLeft || chocoLeft || licoriceLeft || alarmsLeft || locksLeft || dinosOnBoard || shellLeft || giftLeft || hasNew;
    const sp = (y, x) => {
      let v = (grid[y][x].special !== NONE && lock[y][x] !== 2 ? 40 : 0) + (jel[y][x] > 0 ? 35 : 0);
      if (!mech) return v;
      if (lock[y][x]) v += 35;
      for (const [dr, dc] of DIRS) {
        const q = isCell(y + dr, x + dc) ? grid[y + dr][x + dc] : null;
        if (q && lock[y + dr][x + dc] === 2) v += 40;   // a gift next to the match opens
        if (q && (q.block === 'frost' || q.block === 'choco' || q.block === 'licorice')) v += 25;
        else if (q && q.block === 'alarm') v += q.hp <= 3 ? 60 : 30;
        else if (q && (q.block === 'surprise' || q.block === 'lantern')) v += 30;
        else if (q && q.block === 'oven') v += q.hp === 2 ? 50 : 30;
      }
      if (hasNew) {
        const me = grid[y][x];
        if (me.tk) v += 45;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const q = (dy || dx) && isCell(y + dy, x + dx) ? grid[y + dy][x + dx] : null;
          if (q && q.block === 'jar' && q.jk === me.kind) v += 30;
        }
      }
      for (let u = y - 1; u >= 0 && isCell(u, x); u--) {
        const q = grid[u][x];
        if (lock[u][x] || isFixedBlock(q)) break;
        if (q && q.block === 'dino') { v += 45; break; }
      }
      return v;
    };
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
      if (ch === '-' || ch === '|' || ch === 'W' || ch === 'B') {
        // gift: keep the starting piece's colour (no new matches); a colour bomb has no colour
        const p = grid[r][c];
        lock[r][c] = 2;
        if (ch === 'B') grid[r][c] = newPiece(-1, 'bomb');
        else if (!p || p.block || p.kind < 0) grid[r][c] = newPiece(kinds[rand(kinds.length)], ch === '-' ? 'h' : ch === '|' ? 'v' : 'wrap');
        else p.special = ch === '-' ? 'h' : ch === '|' ? 'v' : 'wrap';
        return;
      }
      if (ch >= '1' && ch <= '3') grid[r][c] = newBlock('frost', +ch);
      else if (ch === 'C') grid[r][c] = newBlock('choco', 1);
      else if (ch === 'S') grid[r][c] = newBlock('licorice', 1);
      else if (ch === 'A') grid[r][c] = newBlock('alarm', alarmTimer);
      else if (ch === 'X' || ch === 'Y') grid[r][c] = newBlock('shell', ch === 'Y' ? 2 : 1);
      else if (ch === 'P') grid[r][c] = newBlock('pot', 1);
      else if (ch === 'D') grid[r][c] = newBlock('dino', 0);
      else if (ch === 'G' || ch === 'Q') { grid[r][c] = newBlock('gate', ch === 'Q' ? 2 : 1); hasNew = true; }
      else if (ch === 'T') { const p = grid[r][c]; if (p && !p.block && p.kind >= 0) p.tk = 1; hasNew = true; }
      else if (ch === 'O') { grid[r][c] = newBlock('balloon', 0); hasNew = true; }
      else if (ch >= 'a' && ch <= 'd') {
        const q = newBlock('jar', jarNeed);
        q.jk = kinds[ch.charCodeAt(0) - 97] ?? kinds[0];
        grid[r][c] = q; hasNew = true;
      }
      else if (ch === 'U') { grid[r][c] = newBlock('surprise', eggHp); hasNew = true; }
      else if (ch >= 'm' && ch <= 'p') { grid[r][c] = newBlock('lantern', ch.charCodeAt(0) - 108); hasNew = true; }
      else if (ch === 'K') { grid[r][c] = newBlock('oven', ovenFire); hasNew = true; }
    });
    frostLeft = chocoLeft = licoriceLeft = alarmsLeft = locksLeft = dinosOnBoard = shellLeft = potCount = giftLeft = 0;
    forCells((r, c) => {
      const p = grid[r][c];
      if (lock[r][c] === 2) giftLeft++; else if (lock[r][c]) locksLeft++;
      if (!p || !p.block) return;
      if (p.block === 'frost') frostLeft += p.hp;
      else if (p.block === 'choco') chocoLeft++;
      else if (p.block === 'licorice') licoriceLeft++;
      else if (p.block === 'alarm') alarmsLeft++;
      else if (p.block === 'shell') shellLeft += p.hp;
      else if (p.block === 'pot') potCount++;
      else if (p.block === 'dino') dinosOnBoard++;
    });
    dinosSpawned = dinosStart = dinosOnBoard;
    // dinos but no exit given: every cell a dino cannot fall out of is an exit — the bottom of each column and the
    // cell above a hole (not a portal entrance: dinos go through those); a chocolate pot never goes away, so the cell
    // above it is an exit instead of the pot's own cell
    const potAt = q => !!q && !!grid[q.r][q.c] && grid[q.r][q.c].block === 'pot';
    if ((dinoOpt || dinosOnBoard) && !exitAt.some(row => row.some(Boolean)))
      forCells((r, c) => { if (!potAt({ r, c }) && (!below(r, c) || potAt(below(r, c)))) exitAt[r][c] = true; });
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

  // 第131關起的機關還剩多少（盤上數；沒有這些機關時都是 0）
  function newStats() {
    const o = { gateLeft: 0, balloonLeft: 0, jarLeft: 0, eggLeft: 0, lanternLeft: 0, ovenCount: 0, ticketsOnBoard: 0 };
    if (!hasNew) return o;
    const strings = new Set();
    forCells((r, c) => {
      const q = grid[r][c];
      if (!q) return;
      if (q.tk) o.ticketsOnBoard++;
      if (q.block === 'gate') o.gateLeft++;
      else if (q.block === 'balloon') o.balloonLeft++;
      else if (q.block === 'jar') o.jarLeft++;
      else if (q.block === 'surprise') o.eggLeft++;
      else if (q.block === 'lantern') strings.add(q.hp);
      else if (q.block === 'oven') o.ovenCount++;
    });
    o.lanternLeft = strings.size;
    return o;
  }

  // ---- public API ----
  const engine = {
    rows, cols, kinds: kinds.slice(),
    isCell,
    cell: (r, c) => (isCell(r, c) ? cp(grid[r][c]) : null),
    jellyAt: (r, c) => (isCell(r, c) ? jel[r][c] : 0),
    snapshot: () => ({ rows, cols, mask: cellMask.map(row => row.slice()), grid: gridCopy(), jelly: jellyCopy(),
      lock: lock.map(row => row.slice()), exits: shownExits(), portals: portalsIn.map(q => ({ from: { ...q.from }, to: { ...q.to } })),
      belts: belts.map(path => path.map(q => ({ ...q }))) }),
    get score() { return score; },
    get stats() {
      return { cleared: { ...cleared }, jellyLeft, specialsMade, cascadesMax, ...counts(),
        dinosOut, dinosTotal: dinoOpt ? Math.max(dinoOpt.total, dinosStart) : dinosStart, frostLeft, chocoLeft, licoriceLeft, locksLeft,
        alarmsLeft, alarmsBurst, shellLeft, giftLeft, ...newStats() };
    },
    lockAt: (r, c) => (isCell(r, c) ? lock[r][c] : 0),
    isExit: (r, c) => isCell(r, c) && exitAt[r][c],
    portals: () => portalsIn.map(q => ({ from: { ...q.from }, to: { ...q.to } })),
    belts: () => belts.map(path => path.map(q => ({ ...q }))),
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
      const ticking = alarmIds();
      const events = [ev({ t: 'swap', a: { ...a }, b: { ...b } })];
      let cascade = 1;
      if (combo) cascade = playCombo(a, b, events);
      let last = settle(events, cascade, combo ? null : [b, a]);
      if (belts.length && runBelts(events)) last = Math.max(last, settle(events, last + 1, null));
      if (hasBalloon() && floatBalloons(events)) last = Math.max(last, settle(events, last + 1, null));
      cascadesMax = Math.max(cascadesMax, last);
      const alarms = tickAlarms(events, ticking, last + 1);
      // 11/23：盤上的巧克力被打光時，壺一定補一塊（不然一直打巧克力的玩家會沒東西打）
      if (potCount) { if (chocoBroken === 0 || chocoLeft === 0) potSpit(events); }
      else if (chocoBefore > 0 && chocoBroken === 0 && chocoLeft > 0) spreadChoco(events);
      if (!hasValidMove()) events.push(shuffleInternal());
      const gained = events.reduce((s, e) => s + (e.gained || 0), 0);
      score += gained;
      return { ok: true, events, gained, alarms };
    },

    // ---- 道具（Candy Crush 的 booster；都不算步數） ----
    // smash(cell)：棒棒糖槌，敲掉一顆（特殊方塊會發動），之後照常掉落、連鎖
    smash(cell) {
      if (!cell || !isCell(cell.r, cell.c) || !grid[cell.r][cell.c] || IMMUNE.has(grid[cell.r][cell.c].block)) return { ok: false, events: [], gained: 0 };
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

    // ---- 玩到一半的存檔（11/23）：整個盤面和計數，含亂數位置；同一關同一個 seed 才能還原 ----
    exportState() {
      return { v: 1, rows, cols, rng: rng.getState(), nextId, score, grid: gridCopy(), jelly: jellyCopy(),
        lock: lock.map(row => row.slice()), exitAt: exitAt.map(row => row.slice()), cleared: { ...cleared },
        jellyLeft, specialsMade, cascadesMax, frostLeft, chocoLeft, licoriceLeft, locksLeft, dinosOnBoard, dinosSpawned,
        dinosOut, chocoBroken, dinosStart, alarmsLeft, alarmsBurst, shellLeft, giftLeft, potCount, biasNow,
        made: { ...made }, combos: { ...combos }, comboCount, chocoGot, prog: { ...prog }, hasNew };
    },
    restore(s) {
      const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
      const okRows = a => Array.isArray(a) && a.length === rows && a.every(row => Array.isArray(row) && row.length === cols);
      if (!s || s.v !== 1 || s.rows !== rows || s.cols !== cols || !okRows(s.grid) || !okRows(s.jelly) || !okRows(s.lock) || !okRows(s.exitAt)) return false;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const q = s.grid[r][c];
        grid[r][c] = cellMask[r][c] && q ? (q.block ? { id: num(q.id), kind: num(q.kind), special: q.special || NONE, block: String(q.block), hp: num(q.hp) }
          : { id: num(q.id), kind: num(q.kind), special: q.special || NONE }) : null;
        if (grid[r][c] && q.tk) grid[r][c].tk = 1;
        if (grid[r][c] && q.jk !== undefined) grid[r][c].jk = num(q.jk);
        jel[r][c] = cellMask[r][c] ? num(s.jelly[r][c]) : 0;
        lock[r][c] = cellMask[r][c] ? num(s.lock[r][c]) : 0;
        exitAt[r][c] = cellMask[r][c] && !!s.exitAt[r][c];
      }
      for (const k of Object.keys(cleared)) delete cleared[k];
      for (const k of kinds) cleared[k] = 0;
      Object.assign(cleared, s.cleared || {});
      for (const k of Object.keys(made)) made[k] = num(s.made && s.made[k]);
      for (const k of Object.keys(combos)) delete combos[k];
      Object.assign(combos, s.combos || {});
      rng.setState(s.rng);
      nextId = num(s.nextId) || 1; score = num(s.score);
      jellyLeft = num(s.jellyLeft); specialsMade = num(s.specialsMade); cascadesMax = num(s.cascadesMax);
      frostLeft = num(s.frostLeft); chocoLeft = num(s.chocoLeft); licoriceLeft = num(s.licoriceLeft); locksLeft = num(s.locksLeft);
      dinosOnBoard = num(s.dinosOnBoard); dinosSpawned = num(s.dinosSpawned); dinosOut = num(s.dinosOut);
      chocoBroken = num(s.chocoBroken); dinosStart = num(s.dinosStart);
      alarmsLeft = num(s.alarmsLeft); alarmsBurst = num(s.alarmsBurst); shellLeft = num(s.shellLeft); giftLeft = num(s.giftLeft);
      potCount = num(s.potCount); biasNow = Number.isFinite(Number(s.biasNow)) ? Number(s.biasNow) : cascadeBias;
      comboCount = num(s.comboCount); chocoGot = num(s.chocoGot);
      for (const k of Object.keys(prog)) prog[k] = num(s.prog && s.prog[k]);
      hasNew = !!s.hasNew || !!ticketOpt;
      return true;
    },

    findHint,
    hasValidMove,
    listMoves,
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
