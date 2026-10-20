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

### 2.3 Missing-asset fallback

If a sprite fails to load, draw a circle in the piece color with the first character of `name`.
If a spin sheet fails, use the static sprite with a gentle wobble instead.

## 3. Engine — `js/engine.js`

Pure logic: no DOM, no timers, no `Math.random` (seeded PRNG only, e.g. mulberry32), deterministic for a given seed.

### 3.1 Data

- Coordinates `{r, c}`, `r = 0` is the top row.
- `Piece = { id: int, kind: int, special: 'none' | 'h' | 'v' | 'wrap' | 'bomb' }`
  - `id` is unique for the engine's lifetime and never reused.
  - `'h'` striped: clears its whole **row**. `'v'` striped: clears its whole **column**.
  - `'wrap'` wrapped: clears the 3×3 around it.
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

A swap of two adjacent cells is valid if it creates a match at either cell, or both pieces are specials
(any two specials = combo), or either piece is a color bomb. Otherwise it returns
`{ ok: false, events: [swap, swapBack] }` and the board is unchanged.

### 3.4 Resolution (one move)

1. Swap. If it is a combo (two specials / bomb + anything), resolve the combo first (3.5).
2. Find matches: runs of ≥3 same kind horizontally or vertically. Runs of the same kind that share a
   cell form one group.
3. Special creation per group:
   - straight run of ≥5 → color bomb
   - else the group has both a horizontal and a vertical run (L / T / +) → wrapped
   - else straight run of 4 → striped. **Horizontal 4 → `'v'`** (clears column); **vertical 4 → `'h'`** (clears row). (Same as Candy Crush.)
   - The new special appears at the swapped cell if the group contains one; otherwise (cascade) at the
     run's intersection (L/T) or a middle cell of the run.
4. Remove all matched pieces except the cell receiving the new special. A removed special **activates**
   (chains recursively, each cell cleared once per step):
   `'h'` row, `'v'` column, `'wrap'` 3×3, `'bomb'` (hit by an effect) all pieces of the most common kind on the board.
   Each removed piece hits the jelly under it once (−1 layer).
5. Gravity: pieces fall straight down; holes are passed through (a piece never stops in a hole).
   New pieces spawn above the top of each column and fall in.
6. Refill with anti-cascade: process spawn cells bottom-up; with probability `antiCascade`, pick uniformly
   from kinds that would not form a 3-in-a-row with already-filled neighbours; otherwise (or if none are safe)
   pick uniformly from all kinds.
7. Repeat 2–6 with `cascade + 1` until stable.
8. If no valid move remains, shuffle (append a `'shuffle'` event); the shuffle keeps the same pieces,
   leaves no matches and guarantees a valid move (regenerate kinds as a last resort).

### 3.5 Special combos (both swapped specials are consumed; centered on the cell the moved piece lands on)

| Swap | Effect |
|---|---|
| striped + striped | row + column (cross) |
| striped + wrapped | 3 rows + 3 columns |
| wrapped + wrapped | 5×5 |
| bomb + normal piece of kind K | remove every piece of kind K |
| bomb + striped of kind K | every K becomes striped (random h/v) → `transform` event → all activate |
| bomb + wrapped of kind K | every K becomes wrapped → `transform` → all activate |
| bomb + bomb | clear the whole board |

### 3.6 Scoring

- Match group: 3 → 60, 4 → 120, L/T → 150, 5+ → 200, each × cascade multiplier (1 for the swap's own
  matches, 2 for the first cascade, …).
- Each piece removed by a special effect / combo (not part of a match group): 20 × multiplier.
- Each jelly layer removed: 100.
- `sugarCrush(movesLeft)`: for each remaining move, turn a random normal piece into a random striped piece
  (`transform` event), then activate all specials on the board and resolve normally; scores as usual.

### 3.7 Events

Every event carries the board **after** the step: `board` (= `snapshot().grid`) and `jelly`.

```js
{ t: 'swap', a, b }
{ t: 'swapBack', a, b }
{ t: 'transform', cells: [{ r, c, piece }] }
{ t: 'clear', cascade,
  groups:   [{ kind, shape: '3'|'4'|'5'|'L'|'T', cells: [{ r, c }] }],
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

- 12–60 levels (currently 30), mechanics introduced one at a time (collect → shapes → jelly → mixed); from level 16 on,
  chapters of five with the hardest level last (difficulty curve: `targetsFor` in `tests/sim.js`).
- Uses 4–6 kinds; never only 3 (too many free cascades).
- The scanned toys (`dog`, `sloth`, `egg`) appear in every level; collect goals prefer them.
- `stars[0]` is the minimum score to pass a score level; for other goals the goal must be met, stars come from the final score.
- `hint` = one short zh-TW line shown at level start (optional).

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
- Save (`localStorage` key `plushcrush.v1`): `{ unlocked, stars: {id: n}, best: {id: score}, muted, music }`.
- Sounds: map renderer `onEvent` to `audio.play` (match with cascade, stripe/wrap/bomb by effects, special when created, land on fall, shuffle).

## 8. AR page — `ar.html`, `ar.css`

- `<model-viewer>` (pinned jsDelivr version) showing one toy at a time, tabs/thumbnails to switch between all six.
- `ar` with `ar-modes="webxr scene-viewer quick-look"`, `src` = GLB, `ios-src` = USDZ, camera-controls, auto-rotate,
  soft shadow. Shows 「這是暫代模型」 for placeholders. Back link to `index.html`. zh-TW labels.

## 9. Tests

- `tests/engine.test.html` runs engine tests in the browser and sets `window.__results = { passed, failed, failures: [] }`.
- `tests/run_tests.py` serves the repo, runs that page in headless Chromium and exits non-zero on failure.
- `tools/browse.py` opens any page headless, runs JS, takes screenshots, prints console errors.

## 10. Dev environment notes (this machine)

- Python venv with everything installed: `C:\Users\Isaacyeo0926\.venvs\shubing\Scripts\python.exe`
  (usd-core, trimesh, numpy, pillow, scipy, playwright + Chromium). There is no Node.js.
- Windows path length limit: the repo lives in a deep folder. Keep new paths short and shallow; write scratch files
  under `tools/out/` (git-ignored).
