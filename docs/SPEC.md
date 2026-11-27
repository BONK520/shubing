# 毛絨消消樂 — implementation contract

This file is the contract between the parts of the game. REPORT.md has the design intent; this file pins
down file names, APIs and data shapes so each part can be built and tested on its own.

UI language: Traditional Chinese (zh-TW). Code comments: short, Chinese or English.

## 0. Runtime rules

- Plain HTML/CSS/ES modules. No bundler, no npm, no build step for the game itself.
- Served over HTTP from the repo root (`python -m http.server 8000`); `type="module"` scripts do not work from `file://`.
- The game (`index.html`) must work fully offline: no CDN, no web fonts. Font stack:
  `"Baloo 2", "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", system-ui, sans-serif` (Baloo only if installed).
- Only `ar.html` may load from a CDN: `@google/model-viewer` from jsDelivr with an exact pinned version.
- Targets: current Chrome/Edge/Firefox, iOS Safari 15+, Android Chrome. Mobile-first portrait layout,
  must also look good on desktop. No horizontal scroll at 360px width.
- All `localStorage` access wrapped in try/catch; the game must run if storage is unavailable.
- Every asset may be missing; code must fall back gracefully (see 2.3).

## 1. Files and ownership

| Path | Owner | What |
|---|---|---|
| `index.html`, `style.css`, `js/main.js`, `js/pieces.js` | app shell | screens, HUD, input, save data, flow |
| `js/renderer.js` | renderer | canvas board drawing, animations, particles, banners |
| `js/engine.js`, `tests/*` | engine | pure board logic + tests |
| `js/levels.js`, `js/audio.js` | levels/audio | level data, Web Audio synth |
| `ar.html`, `ar.css` | AR page | 3D / AR viewer |
| `tools/*`, `assets/*` | assets | conversion/render/post-process pipeline and its outputs |
| `docs/*`, `README.md`, `REPORT.md` | lead | docs |

`tools/out/`, `tools/source/` are git-ignored scratch/input folders.

## 2. Pieces and assets

### 2.1 `js/pieces.js`

```js
export const PIECES = [
  { id: 'dog',   name: '皮蛋',   color: '#8fd3ff', scan: true  },  // black plush dog
  { id: 'sloth', name: '薯餅',   color: '#9be8c8', scan: true  },  // sloth (the repo is named after it)
  { id: 'egg',   name: '蛋黃哥', color: '#ffb3d1', scan: true  },  // Gudetama egg
  { id: 'bunny', name: '兔兔', color: '#c9b6ff', scan: false },  // placeholder until a real scan exists
  { id: 'frog',  name: '呱呱', color: '#ffe08a', scan: false },  // placeholder
  { id: 'whale', name: '小鯨', color: '#ffc49b', scan: false },  // placeholder
];
export const TRIO = { id: 'trio', name: '三寶合照' };           // the color bomb picture
export const spritePath = id => `assets/sprites/${id}.png`;
export const spinPath   = id => `assets/sprites/${id}_spin.webp`;
export const SPIN = { frames: 24, cols: 6, rows: 4, size: 192 };
export const glbPath    = id => `assets/models/${id}.glb`;
export const usdzPath   = id => `assets/models/${id}.usdz`;
```

The three scanned toys are named 皮蛋 (dog), 薯餅 (sloth) and 蛋黃哥 (egg); always use these names in UI text.
A piece's **kind** is its index in `PIECES`. The color bomb has kind `-1`.
Replacing a placeholder later = new files with the same id (or edit this list). Nothing else in the game
may hard-code piece ids, except `levels.js`.

### 2.2 Asset files (produced by `python tools/build_assets.py`)

| File | Spec |
|---|---|
| `assets/sprites/<id>.png` | 256×256 RGBA. Toy centered, fills ~84% of the box. "Sticker" look: white outline ≈6px, soft drop shadow, transparent background. |
| `assets/sprites/<id>_spin.webp` | Turntable sheet: 24 frames in a 6×4 grid, 192×192 per frame (1152×768), same sticker look, frame 0 = the static sprite's view, 15° per frame, constant framing (no size jitter). |
| `assets/sprites/trio.png` | 384×384 RGBA, the three scanned toys grouped tightly, sticker look. Used for the color bomb. |
| `assets/sprites/hero.png` | 1024×640 RGBA, the three scanned toys composed for the title screen. |
| `assets/models/<id>.glb` | ≤ ~1 MB, 1024 textures. |
| `assets/models/<id>.usdz` | Slimmed for iPhone AR Quick Look, ≤ ~2 MB. |
| `assets/manifest.json` | `{ "pieces": [{ "id", "sprite", "spin", "glb", "usdz", "placeholder": bool }], "trio", "hero", "spin": {frames, cols, rows, size} }` |

Every toy image (sprites, spin sheets, `trio.png`, `assets/deco/`) is color graded by `tools/grade_toys.py` after post-processing:
one shared warm white for low-saturation highlights, aligned black / white points, warm (not blue-purple) shadows.
`tools/graded.json` records the graded files (sha1 + parameters) so a rebuild never grades a file twice.

### 2.3 Missing-asset fallback

If a sprite fails to load, draw a circle in the piece color with the first character of `name`.
If a spin sheet fails, use the static sprite with a gentle wobble instead.

## 3. Engine — `js/engine.js`

Pure logic: no DOM, no timers, no `Math.random` (seeded PRNG only, e.g. mulberry32), deterministic for a given seed.

### 3.1 Data

- Coordinates `{r, c}`, `r = 0` is the top row.
- `Piece = { id: int, kind: int, special: 'none' | 'h' | 'v' | 'wrap' | 'fish' | 'bomb' }`
  - `id` is unique for the engine's lifetime and never reused.
  - `'h'` striped: clears its whole **row**. `'v'` striped: clears its whole **column**.
  - `'wrap'` wrapped: clears the 3×3 around it.
  - `'fish'` winged flying plush (from a 2×2 square, Candy Crush's Swedish fish; shown as the plush with flapping angel wings): flies to one target and removes it —
    a piece on jelly first, else a piece the collect goal still needs (`createEngine({ collect: { [kind]: count } })`),
    else a random normal piece.
  - `'bomb'` color bomb: `kind === -1`, never part of a normal match.
- `mask`: array of row strings, `'.'` = hole (not a cell), anything else = cell. `null` = full board.
- `jelly`: array of row strings, digit = layers (0–2), `'.'` = 0. `null` = none.

### 3.2 API

```js
export function createEngine({ rows = 8, cols = 8, kinds, mask = null, jelly = null, seed = 1, antiCascade = 0.72 })
// kinds: array of global kind indices allowed to spawn, e.g. [0,1,2,3,4]

engine.rows, engine.cols, engine.kinds
engine.isCell(r, c)            // inside board and not a hole
engine.cell(r, c)              // Piece | null (copy)
engine.jellyAt(r, c)           // 0..2
engine.snapshot()              // { rows, cols, mask: bool[][], grid: (Piece|null)[][], jelly: int[][] }  (deep copies)
engine.score                   // running total of points
engine.stats                   // { cleared: { [kind]: count }, jellyLeft: int, specialsMade: int, cascadesMax: int }
engine.isAdjacent(a, b)
engine.swap(a, b)              // -> { ok, events, gained }
engine.findHint()              // -> { a, b } | null   (a valid swap; prefer bigger matches / specials)
engine.hasValidMove()          // -> bool
engine.shuffle()               // -> events (one 'shuffle' event)
engine.sugarCrush(movesLeft)   // -> { events, gained }  end-of-level bonus
```

The initial board has no matches and at least one valid move.
`stats.cleared[kind]` counts every removed piece of that kind, whatever removed it (used for collect goals).

### 3.3 Valid swaps

A swap of two adjacent cells is valid if it creates a match (a 3-in-a-row or a 2×2 square) at either cell, or both pieces are specials
(any two specials = combo), or either piece is a color bomb. Otherwise it returns
`{ ok: false, events: [swap, swapBack] }` and the board is unchanged.

### 3.4 Resolution (one move)

1. Swap. If it is a combo (two specials / bomb + anything), resolve the combo first (3.5).
2. Find matches: runs of ≥3 same kind horizontally or vertically. Runs of the same kind that share a
   cell form one group. **2×2 squares** of one kind also match: a square that touches a line group adds its
   other cells to that group (the line still decides shape and special); a square on its own is a group of
   its own (`shape: 'square'`).
3. Special creation per group:
   - straight run of ≥5 → color bomb
   - else the group has both a horizontal and a vertical run (L / T / +) → wrapped
   - else straight run of 4 → striped. **Horizontal 4 → `'v'`** (clears column); **vertical 4 → `'h'`** (clears row). (Same as Candy Crush.)
   - else the group has a 2×2 square (a lone square, or a 3 with a square = 'P' shape) → fish
   - The new special appears at the swapped cell if the group contains one; otherwise (cascade) at the
     run's intersection (L/T) or a middle cell of the run.
4. Remove all matched pieces except the cell receiving the new special. A removed special **activates**
   (chains recursively, each cell cleared once per step):
   `'h'` row, `'v'` column, `'wrap'` 3×3, `'fish'` one target (effect `{ fx: 'fish', r, c, to, carry }`, cause `'fish'`),
   `'bomb'` (hit by an effect) all pieces of the most common kind on the board.
   Each removed piece hits the jelly under it once (−1 layer).
5. Gravity: pieces fall straight down; holes are passed through (a piece never stops in a hole).
   New pieces spawn above the top of each column and fall in.
6. Refill with anti-cascade: process spawn cells bottom-up; with probability `antiCascade`, pick uniformly
   from kinds that would not form a 3-in-a-row or a 2×2 square with already-filled neighbours; otherwise
   (or if none are safe) pick uniformly from all kinds. The first board and shuffles avoid squares too.
7. Repeat 2–6 with `cascade + 1` until stable.
8. If no valid move remains, shuffle (append a `'shuffle'` event); the shuffle keeps the same pieces,
   leaves no matches and guarantees a valid move (regenerate kinds as a last resort). The renderer shows the
   「沒有可以消的了！」 banner (`SLOGANS.shuffle`) before the pieces fly to their new cells.

### 3.5 Special combos (both swapped specials are consumed; centered on the cell the moved piece lands on)

| Swap | Effect |
|---|---|
| striped + striped | row + column (cross) |
| striped + wrapped | 3 rows + 3 columns |
| wrapped + wrapped | 5×5 |
| bomb + normal piece of kind K | remove every piece of kind K |
| bomb + striped of kind K | every K becomes striped (random h/v) → `transform` event → all activate |
| bomb + wrapped of kind K | every K becomes wrapped → `transform` → all activate |
| bomb + fish of kind K | every K becomes a fish → `transform` → all swim |
| fish + fish | three fish |
| fish + striped / wrapped | the fish carries the stripe / wrap to its target, where it fires (`carry` on the fish effect) |
| bomb + bomb | clear the whole board |

### 3.6 Scoring

- Match group (`SCORE.match`): 3 → 60, 4 → 120, L/T → 200, 5+ → 200, lone 2×2 square → 120; each square
  that adds cells to a line group +60 (`SCORE.squareExtra`); all × cascade multiplier (1 for the swap's own
  matches, 2 for the first cascade, …).
- Each piece removed by a special effect / combo (not part of a match group): 60 × multiplier.
- Each jelly layer removed: 1,000.
- `sugarCrush(movesLeft)`: for each remaining move, turn a random normal piece into a random striped piece
  (`transform` event), then activate all specials on the board and resolve normally; scores as usual.

### 3.7 Events

Every event carries the board **after** the step: `board` (= `snapshot().grid`) and `jelly`.

```js
{ t: 'swap', a, b }
{ t: 'swapBack', a, b }
{ t: 'transform', cells: [{ r, c, piece }] }
{ t: 'clear', cascade,
  groups:   [{ kind, shape: '3'|'4'|'5'|'L'|'T'|'square', cells: [{ r, c }] }],
  removed:  [{ r, c, piece, cause: 'match'|'h'|'v'|'wrap'|'bomb'|'combo' }],
  effects:  [{ fx: 'line', dir: 'h'|'v', r, c } | { fx: 'blast', r, c, radius } |
             { fx: 'bomb', r, c, targets: [{ r, c }] } | { fx: 'board' }],
  created:  [{ r, c, piece }],
  jellyHits:[{ r, c, left }],
  points:   [{ r, c, value }],        // floating score labels
  gained }                            // points for this step
{ t: 'fall', moves: [{ id, from: {r,c}, to: {r,c} }], spawns: [{ piece, from: {r,c}, to: {r,c} }] }  // spawn from.r < 0
{ t: 'shuffle', moves: [{ id, from, to, piece }] }   // piece = after the shuffle (a last-resort shuffle may change kinds)
```

Order for one move: `swap` → (`transform`) → `clear` → `fall` → `clear` → `fall` … → (`shuffle`).

## 4. Levels — `js/levels.js`

```js
export const LEVELS = [
  { id: 1, moves: 20, kinds: ['dog','sloth','egg','bunny','frog'], antiCascade: 0.7,
    goal: { type: 'score', target: 3000 }, stars: [3000, 6000, 9000],
    mask: null, jelly: null, seed: 101, hint: '把三個一樣的連成一排！' },
  // goal types:
  //   { type: 'score', target }
  //   { type: 'collect', items: { dog: 15, egg: 15 } }
  //   { type: 'jelly' }                 // clear every jelly layer
];
```

- 12–150 levels (currently 100), mechanics introduced one at a time (collect → shapes → jelly → mixed); from level 16 on,
  chapters of five with the hardest level last (difficulty curve: `targetsFor` in `tests/sim.js`).
- Uses 4–6 kinds; never only 3 (too many free cascades).
- The scanned toys (`dog`, `sloth`, `egg`) appear in every level; collect goals prefer them.
- `stars[0]` is the minimum score to pass a score level; for other goals the goal must be met, stars come from the final score.
- `hint` = one short zh-TW line shown at level start (optional).

## 4a. Level rotation with board mechanics (2026-11)

- Every level keeps its board shape and chapter; mechanics were layered on by a generator (rules below), then all
  100 levels were retuned with `tests/tune_levels.py --min-moves 15`.
- First appearance (main.js shows a one-time intro card: icon + one sentence, tap to start; seen list in
  `save.seen`, per device): jelly 7, dino 10, cage 12, frosting 16, chocolate 22, licorice 26, portal 31.
- Levels 31–100, five per chapter: dino rescue (every other chapter: collect with portals + licorice) → jelly with
  cages / portals → clear frosting + cages (every other chapter: collect + clear chocolate) → jelly with frosting /
  portals → boss (`mix`: jelly or collect + dinos + frosting / cages).
- Placement rules: frosting builds up from the bottom of a column segment (no empty cell under it) and every
  frosting / chocolate cell has a neighbour that can still make a 3-in-a-row; chocolate starts in the middle rows;
  portals bridge gaps in a column (to the mirrored column when possible); dinos only drop into columns with at
  least 4 cells to an exit; every cell a dino cannot fall out of is an exit (arrows hidden on short column tops
  dinos never reach).
- `validateLevels` checks obstacles (size, characters, not on holes, frosting / chocolate not on jelly, nothing
  empty under frosting), portals (entrance has no cell below, exit no cell above), licorice, and that each goal's
  blockers exist on the board.
- Simulation bots pick from `engine.listMoves()` and value dino progress, blockers hit, cages opened and chocolate
  cleared (`tests/sim.bots.js` PROFILES: `block`, `chocoAny`, `dino`).

## 5. Audio — `js/audio.js`

All sounds synthesized with Web Audio (no audio files).

```js
export const audio = {
  unlock(),                 // call from the first pointerdown/keydown; creates/resumes the AudioContext
  play(name, opts = {}),    // silently ignored when muted or not unlocked
  setMuted(bool), get muted(),
  setMusic(bool), get music(),   // soft looping background tune
};
// names: 'tap','select','swap','invalid','match'(opts.cascade: 1..n, pitch rises),'stripe','wrap','bomb',
//        'special'(a special was created),'land','shuffle','win','lose','star','sugar','combo'
```

## 6. Renderer — `js/renderer.js`

```js
export function createRenderer(canvas, { pieces, images })
// images: Map id -> { sprite: HTMLImageElement|null, spin: HTMLImageElement|null }, also key 'trio'

R.setBoard(snapshot)               // show a board instantly (new level / after load)
R.layout()                         // recompute size from canvas CSS size and devicePixelRatio
R.cellAt(clientX, clientY)         // -> { r, c } | null
R.select(cell | null)              // selected piece spins (sheet) + glow
R.drag(cell, dx, dy)               // optional: piece follows finger a little while dragging (dx,dy in cells, clamp ±0.35)
R.hint(a, b) / R.hint(null)        // pulsing hint on two cells
R.play(events, { onEvent }) -> Promise   // animate events in order; onEvent(ev) when each starts
R.banner(text, { sub, duration }) -> Promise   // big center text
R.busy                             // true while play()/banner() is running
R.destroy()
```

Look and feel (Candy Crush-like, adapted to plush toys):
- Board on a translucent rounded panel; checkered cells; holes not drawn; jelly as translucent glossy pink
  squares under pieces (2 layers darker).
- Each piece: a soft glossy rounded tile in the piece color, sticker sprite on top.
- Specials: striped = white stripes + direction arrows over the tile, wrapped = candy-wrapper frame with
  twisted ends that breathes, bomb = trio sprite on a sparkling rainbow orb.
- Animations: swap ~160 ms (swapBack bounces), clear = pop + particles in the piece color, fall with gravity
  and a small landing squash, spawns fall in from above, stripe = light beam across the row/column,
  wrap = shockwave ring, bomb = lightning arcs to every target, floating points, screen shake on big effects.
- Cascade words: 2 → 「好棒！」, 3 → 「太甜了！」, 4 → 「超可愛！」, 5+ → 「毛茸茸爆發！」.
- requestAnimationFrame loop; stops drawing when nothing moves (except spin/hint).

## 7. App shell — `index.html`, `style.css`, `js/main.js`

- Screens: loading (progress bar while images load) → title → level map → game → win/lose modal; settings sheet.
- Title: 「毛絨消消樂」, the three scanned toys bouncing, buttons 「開始遊戲」 and 「3D / AR 看看」 (→ `ar.html`).
- Level map: winding path of level nodes, stars earned, locked levels greyed.
- Game HUD: moves left, score + 3-star progress bar, goal panel (score target / collect icons with counts / jelly left),
  pause button (settings: 音效, 音樂, 回到地圖, 重新開始).
- Input (pointer events, works with mouse and touch): press a piece to select it; drag ≥ 0.3 cell toward a
  neighbour to swap; or tap a second, adjacent piece to swap; tapping a non-adjacent piece selects it instead;
  tapping the selected piece deselects. Ignore input while `R.busy`.
- Idle hint after 5 s (`engine.findHint()`).
- Win: goal met → banner 「毛絨狂歡！」 → `engine.sugarCrush(movesLeft)` → win modal (stars animate in, score, 「下一關」「再玩一次」「地圖」).
- Lose: no moves left and goal not met → 「步數用完了」 modal with 「再試一次」「地圖」.
- Save (`localStorage` key `plushcrush.v1` for the guest on this device): `{ unlocked, stars: {id: n}, best: {id: score}, boosters, muted, music, t }`
  (`t` = time of the last progress change).
- Cloud save (optional, `docs/CLOUD_SAVE.md`): when `js/cloud-config.js` has a Firebase config, players can sign in with an in-game account name + password
  (`js/cloud.js`; no email needed). Each account's save is cached at `plushcrush.v1.u.<uid>` and synced to Firestore `saves/<uid>`
  (`{ v, unlocked, stars, best, boosters, t }`, owner-only rules in `firestore.rules`). Merging two saves keeps the best
  `unlocked` / stars / best per level and the newer `boosters`; `muted` / `music` stay per device. On sign-in, guest
  progress on the device can be brought into the account (the guest save is then cleared). Without a config nothing changes.
- Sounds: map renderer `onEvent` to `audio.play` (match with cascade, stripe/wrap/bomb by effects, special when created, land on fall, shuffle).

## 8. AR page — `ar.html`, `ar.css`

- `<model-viewer>` (pinned jsDelivr version) showing one toy at a time, tabs/thumbnails to switch between all six.
- `ar` with `ar-modes="webxr scene-viewer quick-look"`, `src` = GLB, `ios-src` = USDZ, camera-controls, auto-rotate,
  soft shadow. Shows 「這是暫代模型」 for placeholders. Back link to `index.html`. zh-TW labels.

## 8a. Gravity, refill and combos (2026-11)

- Holes stop pieces; new pieces enter only at each column's top cell. A cell under a hole is filled by a resting piece
  sliding diagonally from the upper-left / upper-right (`fall` moves / spawns carry `path` when not straight down);
  an unreachable cell gets a new piece directly.
- Refill colours are chosen after landing, bottom-up; `cascadeBias` (default 0.18) copies a neighbour's colour,
  `antiCascade` defaults to 0. sugarCrush turns the bias off.
- First board and shuffles have at least 2 valid moves.
- Combos: wrapped + wrapped = 5×5, refill, 5×5 again (second clear has cascade 2); fish + striped / wrapped = 3 carrying fish.

## 8c. Board mechanics (Candy Crush blockers, 2026-11) — `js/engine.js`, `js/blockers.js`

Composable per level. Level fields (passed to the engine by `mechOpts(level)` in `js/levels.js`):
- `obstacles`: one string per row. `L` cage (licorice lock: the piece cannot be swapped or fall and stops what falls
  onto it; a match through it or any effect breaks it, the piece stays), `1`/`2`/`3` frosting layers (never moves; a
  match next to it or an effect removes a layer), `C` chocolate (1 layer; after a move that broke none, one chocolate
  grows into a neighbouring normal piece), `S` licorice swirl (falls, swappable, never matches; removed by a match next
  to it or an effect; stops striped beams), `D` dino, `E` dino exit, `.` nothing.
- `portals: [[r1, c1, r2, c2], …]`: what falls out of the bottom of (r1, c1) comes in at the top of (r2, c2).
- `licorice: { rate, max }`: new pieces are sometimes swirls. `dinos: { onBoard, rate }`: how dinos drop in.
- Dinos (the dino plush 3D scan, `assets/sprites/dino_n.png`, built from `tools/assets.json` `rescue`) fall, slide and can be swapped, but cannot be matched or
  destroyed; one standing on an exit leaves the board. With dinos and no `E`, every column's bottom cell (not a
  portal entrance) is an exit.

Goals (`goal.type`): `collect`, `jelly`, `score`, plus `dino { count }`, `clear { what: ['frost', 'choco', 'cage'] }`
and `mix { items?, jelly?, dinos?, clear? }`. `goalParts`, `partLeft`, `goalDone` in `js/levels.js` are shared by the
game and the simulator.

Engine events and fields: every event has `lock` (cage layer); `clear` adds `unlocks [{ r, c }]` and
`blockerHits [{ r, c, block: 'frost', left }]`; a removed blocker is in `removed` (`piece.block`, cause `near` for a
neighbouring match); line effects cut by a swirl carry `reach [lo, hi]`; `exit { cells }` (then a `fall`);
`spread { from, to, piece, was }` (last event of a move, before an auto-shuffle); fall paths mark portal jumps with
`warp: true`. Pieces of these kinds carry `block` (`dino` / `frost` / `choco` / `licorice`) and `hp`.
`stats` adds `dinosOut`, `dinosTotal`, `frostLeft` (layers), `chocoLeft`, `licoriceLeft`, `locksLeft`.
Plain levels give exactly the same events as before.

Renderer: blockers are drawn from `js/blockers.js` (canvas, cached per cell size); cages break in two halves; frosting
and chocolate crumble; chocolate spread grows from the neighbour and melts the eaten piece; dinos (mint rescue bubble,
look around) hop out at exits (cues `dino`, `dinoout` → main.js flies them to the HUD); green arrows under exits; portal
rings on the cell edges; falling pieces drop out of a portal entrance and come in above the exit.

## 8b. Wardrobe (three-star cosmetics) — `js/cosmetics.js`

- `DEBUG_UNLOCK_ALL_COSMETICS` (top of the file): `true` unlocks every cosmetic for previewing; ship with `false`.
- `ITEMS` (4 categories: `hat`, `fx`, `frame`, `theme`), `CHESTS` (star milestones), `TOY_FACE` / `ACCESSORY_PLACE` /
  `ACCESSORY_TUNING` (where accessories sit on each plush photo; per-toy `offsetX`, `offsetY`, `scale`), `ACCESSORY_SVG`.
- `createCloset()` → `{ load(key), coins(stars), isUnlocked(item, stars), canBuy, buy, equip, chestState(i, stars), openChest, look(stars) }`.
  Coins = levels with 3 stars + chest coins − spent; state `{ owned, chests, equip }` in `localStorage[saveKey + '.closet']`.
- Renderer: `R.setLook({ hat, fx, frame, theme })` (accessory overlay on the toy, particle skin, tile frame, board theme from
  `BOARD_THEMES`), `R.demoBurst(r, c)` (wardrobe preview), `R.cellRect(r, c)` (HUD goal flights).

## 9. Tests

- `tests/engine.test.html` runs engine tests in the browser and sets `window.__results = { passed, failed, failures: [] }`.
- `tests/run_tests.py` serves the repo, runs that page in headless Chromium and exits non-zero on failure.
- `tools/browse.py` opens any page headless, runs JS, takes screenshots, prints console errors.

## 10. Dev environment notes (this machine)

- Python venv with everything installed: `C:\Users\Isaacyeo0926\.venvs\shubing\Scripts\python.exe`
  (usd-core, trimesh, numpy, pillow, scipy, playwright + Chromium). There is no Node.js.
- Windows path length limit: the repo lives in a deep folder. Keep new paths short and shallow; write scratch files
  under `tools/out/` (git-ignored).
