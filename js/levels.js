// 毛絨消消樂 — 關卡資料（docs/SPEC.md §4）
// 盤面都是 8×8。mask：'.' = 洞，其他字元 = 格子；jelly：數字 = 果凍層數（0–2），'.' = 0。
// 進度：分數（1–2）→ 收集（3–4）→ 造型盤面（5–6）→ 果凍（7–9）→ 綜合挑戰（10–15）。
// 掃描的三隻（dog / sloth / egg）每一關都會出現；收集目標都用牠們。
// 步數、目標和星星門檻用 tests/sim.html 調（python tests/run_tests.py --sim）：兩種玩家照正式流程各玩上千局
// （目標一達成就結束 → 毛絨狂歡 → 星星；每局換一個「第 n 次玩」的盤面，另外單獨檢查每次打開都會先看到的第 0 個盤面）。
//   casual = 60% 隨便走、40% 挑眼前最好的一步；decent = 每步都挑最好的，會找條紋 / 包裝 / 彩色炸彈和組合技。
//   目標：decent 每關過關 ≥ 97%、三星 ≥ 70%；casual 過關 ≥ 85%（12–15 關 ≥ 75%）、兩星以上 ≥ 60%、三星 ≥ 35%（1–5 關 ≥ 50%）。
//   現在：casual 過關約 97%（1–5 關）慢慢降到 90% 左右；三星 decent 約 78–99%、casual 約 65–97%。
// 分數關一到目標就結束，二、三星只差在最後一步多拿的分數和剩下步數的毛絨狂歡（每步約 +100，剩 10 步左右就封頂），
// 所以分數關的星星門檻會離目標很近。

const ALL_IDS = ['dog', 'sloth', 'egg', 'dino', 'nyanko', 'moodeng', 'snoopy'];
const SCANNED = ['dog', 'sloth', 'egg'];

const HEART = [
  '.##..##.',
  '########',
  '########',
  '########',
  '########',
  '.######.',
  '..####..',
  '...##...',
];

const COOKIE = [
  '..####..',
  '.######.',
  '########',
  '########',
  '########',
  '########',
  '.######.',
  '..####..',
];

const DONUT = [
  '########',
  '########',
  '########',
  '###..###',
  '###..###',
  '########',
  '########',
  '########',
];

const PLUS = [
  '..####..',
  '..####..',
  '########',
  '########',
  '########',
  '########',
  '..####..',
  '..####..',
];

const BUTTERFLY = [
  '##....##',
  '###..###',
  '########',
  '.######.',
  '.######.',
  '########',
  '###..###',
  '##....##',
];

const HOURGLASS = [
  '########',
  '.######.',
  '..####..',
  '...##...',
  '...##...',
  '..####..',
  '.######.',
  '########',
];

const STAIRS = [
  '####....',
  '####....',
  '######..',
  '######..',
  '..######',
  '..######',
  '....####',
  '....####',
];

const ROUNDED = [
  '.######.',
  '########',
  '########',
  '########',
  '########',
  '########',
  '########',
  '.######.',
];

const DIAMOND = [
  '...##...',
  '..####..',
  '.######.',
  '########',
  '########',
  '.######.',
  '..####..',
  '...##...',
];

export const LEVELS = [
  {
    id: 1, moves: 15, kinds: ['dog', 'sloth', 'egg', 'snoopy'], antiCascade: 0.7,
    goal: { type: 'collect', items: { sloth: 15 } }, stars: [14000, 28000, 42000],
    mask: null, jelly: null, seed: 101,
    hint: '把三個一樣的連成一排，收集 15 個薯餅！',
  },
  {
    id: 2, moves: 19, kinds: ['dog', 'sloth', 'egg', 'nyanko', 'dino'], antiCascade: 0.7,
    goal: { type: 'collect', items: { dog: 15, egg: 15 } }, stars: [8000, 16000, 24000],
    mask: null, jelly: null, seed: 202,
    hint: '一次連四個，會變出條紋方塊喔！',
  },
  {
    id: 3, moves: 20, kinds: ['dog', 'sloth', 'egg', 'moodeng', 'snoopy'], antiCascade: 0.72,
    goal: { type: 'collect', items: { egg: 20 } }, stars: [14000, 28000, 42000],
    mask: null, jelly: null, seed: 303,
    hint: '把蛋黃哥都收集起來！',
  },
  {
    id: 4, moves: 24, kinds: ['dog', 'sloth', 'egg', 'nyanko', 'moodeng'], antiCascade: 0.72,
    goal: { type: 'collect', items: { dog: 20, sloth: 20 } }, stars: [16000, 32000, 48000],
    mask: null, jelly: null, seed: 404,
    hint: '排成\u00a0L\u00a0形或\u00a0T\u00a0形，會變出會爆炸的包裝糖！',   // 不斷行空格：只在逗號後換行
  },
  {
    id: 5, moves: 16, kinds: ['dog', 'sloth', 'egg', 'dino'], antiCascade: 0.72,
    goal: { type: 'collect', items: { sloth: 18, dog: 18 } }, stars: [10000, 20000, 30000],
    mask: HEART, jelly: null, seed: 505,
    hint: '愛心盤面！五個連成一排會變出彩色炸彈～',
  },
  {
    id: 6, moves: 22, kinds: ['dog', 'sloth', 'egg', 'snoopy', 'moodeng'], antiCascade: 0.72,
    goal: { type: 'collect', items: { sloth: 20, egg: 20 } }, stars: [12000, 24000, 36000],
    mask: COOKIE, jelly: null, seed: 606,
    hint: '把彩色炸彈和毛絨交換，全場同款一次消光！',
  },
  {
    id: 7, moves: 16, kinds: ['dog', 'sloth', 'egg', 'nyanko', 'dino'], antiCascade: 0.72,
    goal: { type: 'jelly' }, stars: [16000, 32000, 48000],
    mask: null,
    jelly: [
      '........',
      '........',
      '..1111..',
      '..1111..',
      '..1111..',
      '..1111..',
      '........',
      '........',
    ],
    seed: 707,
    hint: '在粉紅果凍上消除，果凍就會融化！',
  },
  {
    id: 8, moves: 29, kinds: ['dog', 'sloth', 'egg', 'moodeng', 'snoopy'], antiCascade: 0.72,
    goal: { type: 'jelly' }, stars: [23000, 46000, 69000],
    mask: DONUT,
    jelly: [
      '........',
      '........',
      '.111111.',
      '.11..11.',
      '.11..11.',
      '.111111.',
      '........',
      '........',
    ],
    seed: 871,
    hint: '果凍圍著甜甜圈的洞，一圈一圈消掉吧！',
  },
  {
    id: 9, moves: 16, kinds: ['dog', 'sloth', 'egg', 'dino', 'nyanko'], antiCascade: 0.72,
    goal: { type: 'jelly' }, stars: [16000, 32000, 48000],
    mask: PLUS,
    jelly: [
      '........',
      '........',
      '..1111..',
      '..1221..',
      '..1221..',
      '..1111..',
      '........',
      '........',
    ],
    seed: 909,
    hint: '深粉紅的果凍有兩層，要消兩次喔！',
  },
  {
    id: 10, moves: 25, kinds: ['dog', 'sloth', 'egg', 'snoopy', 'moodeng'], antiCascade: 0.74,
    goal: { type: 'collect', items: { dog: 17, sloth: 17, egg: 17 } }, stars: [10000, 20000, 30000],
    mask: BUTTERFLY, jelly: null, seed: 1010,
    hint: '蝴蝶盤面！皮蛋、薯餅、蛋黃哥一起收集～',
  },
  {
    id: 11, moves: 26, kinds: ['dog', 'sloth', 'egg', 'nyanko', 'dino'], antiCascade: 0.74,
    goal: { type: 'jelly' }, stars: [22000, 44000, 66000],
    mask: HOURGLASS,
    jelly: [
      '........',
      '..1111..',
      '..1111..',
      '...11...',
      '...11...',
      '..1111..',
      '..1111..',
      '........',
    ],
    seed: 1111,
    hint: '沙漏中間的果凍，用直的一排消最快！',
  },
  {
    id: 12, moves: 26, kinds: ['dog', 'sloth', 'egg', 'snoopy', 'nyanko'], antiCascade: 0.74,
    goal: { type: 'collect', items: { egg: 20, nyanko: 20 } }, stars: [9000, 18000, 27000],
    mask: STAIRS, jelly: null, seed: 1212,
    hint: '階梯盤面，用特殊方塊一次收集一大堆！',
  },
  {
    id: 13, moves: 29, kinds: ['dog', 'sloth', 'egg', 'dino', 'snoopy', 'moodeng'], antiCascade: 0.76,
    goal: { type: 'collect', items: { dog: 17, sloth: 17, egg: 17 } }, stars: [14000, 28000, 42000],
    mask: ROUNDED, jelly: null, seed: 1334,
    hint: '六種毛絨一起上場，眼睛要放亮！',
  },
  {
    id: 14, moves: 26, kinds: ['dog', 'sloth', 'egg', 'dino', 'nyanko', 'snoopy'], antiCascade: 0.76,
    goal: { type: 'jelly' }, stars: [23000, 46000, 69000],
    mask: DIAMOND,
    jelly: [
      '........',
      '........',
      '..1111..',
      '.112211.',
      '.112211.',
      '..1111..',
      '........',
      '........',
    ],
    seed: 1414,
    hint: '鑽石果凍，正中間有兩層！',
  },
  {
    id: 15, moves: 26, kinds: ['dog', 'sloth', 'egg', 'nyanko', 'moodeng'], antiCascade: 0.76,
    goal: { type: 'jelly' }, stars: [29000, 58000, 87000],
    mask: null,
    jelly: [
      '........',
      '.11..11.',
      '11111111',
      '11122111',
      '.111111.',
      '..1111..',
      '...11...',
      '........',
    ],
    seed: 1515,
    hint: '最後一關！把愛心果凍通通融化～',
  },
];

// ---------- 規則（js/main.js 和 tests/sim.bots.js 都用這幾個，模擬才會跟真的玩法一模一樣）----------
// Candy Crush 的過關和星星：
//   所有關卡：目標一達成就結束（分數關的目標 = stars[0]）→ 目標關分數還不到 stars[0] 就先補到 stars[0]
//     → 薯餅狂歡（engine.sugarCrush(剩下步數)）：每剩 1 步 +3,000 分，並把一顆隨機方塊變成超級糖果（條紋 / 包裝）引爆
//     → 剩下的特殊方塊引爆。步數用完還沒達成目標 = 失敗。
//   星星 = 最終分數到了幾個門檻（過關至少 1 顆、最多 3 顆）。
export function isScoreLevel(L) {
  const t = L && L.goal && L.goal.type;
  return t !== 'collect' && t !== 'jelly';
}
// 過關分數（分數關）/ 完成目標時保底的分數（目標關）
export function passScore(L) {
  return (L && Array.isArray(L.stars) && L.stars[0]) || (L && L.goal && L.goal.target) || 0;
}
export function starsFor(L, score) {
  const thr = (L && L.stars) || [];
  return Math.max(1, Math.min(3, thr.filter(s => score >= s).length));
}

// ---------- 檢查 ----------
// 回傳問題清單（空陣列 = 沒問題）。pieceIds 可以傳 PIECES.map(p => p.id)，預設是目前的六隻。
export function validateLevels(levels = LEVELS, pieceIds = ALL_IDS) {
  const out = [];
  const ROWS = 8, COLS = 8;
  if (!Array.isArray(levels) || !levels.length) return ['LEVELS 是空的'];
  if (levels.length < 12 || levels.length > 15) out.push(`關卡數 ${levels.length}（SPEC：12–15）`);
  const seenSeeds = new Set();
  levels.forEach((L, i) => {
    const tag = `第 ${i + 1} 關`;
    const bad = msg => out.push(`${tag}：${msg}`);
    if (!L || typeof L !== 'object') { bad('不是物件'); return; }
    if (L.id !== i + 1) bad(`id 應該是 ${i + 1}，現在是 ${L.id}`);
    if (!Number.isInteger(L.moves) || L.moves < 5 || L.moves > 60) bad(`moves 不合理：${L.moves}`);
    if (!Number.isInteger(L.seed) || L.seed <= 0) bad(`seed 要是正整數：${L.seed}`);
    else if (seenSeeds.has(L.seed)) bad(`seed ${L.seed} 重複`);
    else seenSeeds.add(L.seed);
    if (L.antiCascade != null && !(typeof L.antiCascade === 'number' && L.antiCascade >= 0 && L.antiCascade <= 1)) bad(`antiCascade 要在 0–1：${L.antiCascade}`);
    if (L.hint != null && (typeof L.hint !== 'string' || !L.hint.trim() || L.hint.length > 30)) bad('hint 要是一句短短的字');

    // kinds
    const kinds = Array.isArray(L.kinds) ? L.kinds : [];
    if (kinds.length < 4 || kinds.length > 6) bad(`kinds 要 4–6 種（現在 ${kinds.length}）`);
    if (new Set(kinds).size !== kinds.length) bad('kinds 有重複');
    kinds.forEach(k => { if (!pieceIds.includes(k)) bad(`不認識的毛絨 id：${k}`); });
    SCANNED.forEach(k => { if (pieceIds.includes(k) && !kinds.includes(k)) bad(`掃描毛絨 ${k} 沒有出現`); });

    // stars
    const st = L.stars;
    if (!Array.isArray(st) || st.length !== 3 || !st.every(v => Number.isInteger(v) && v > 0)) bad('stars 要是三個正整數');
    else if (!(st[0] < st[1] && st[1] < st[2])) bad(`stars 要遞增：${st.join(', ')}`);

    // mask
    let cells = null;
    if (L.mask != null) {
      if (!Array.isArray(L.mask) || L.mask.length !== ROWS || !L.mask.every(r => typeof r === 'string' && r.length === COLS)) {
        bad('mask 要是 8 個長度 8 的字串');
      } else {
        cells = L.mask.map(r => [...r].map(ch => ch !== '.'));
      }
    }
    const isCell = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS && (cells ? cells[r][c] : true);
    let nCells = 0;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (isCell(r, c)) nCells++;
    if (nCells < 30) bad(`格子太少（${nCells}）`);
    // 每個格子至少要在一段長度 ≥3 的橫線或直線上，不然永遠消不到
    const runLen = (r, c, dr, dc) => {
      let n = 1;
      for (let k = 1; isCell(r + dr * k, c + dc * k); k++) n++;
      for (let k = 1; isCell(r - dr * k, c - dc * k); k++) n++;
      return n;
    };
    const dead = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (isCell(r, c) && runLen(r, c, 0, 1) < 3 && runLen(r, c, 1, 0) < 3) dead.push(`(${r},${c})`);
    }
    if (dead.length) bad(`這些格子永遠湊不成三連：${dead.join(' ')}`);
    // 每一欄的格子要能從上面補到（中間有洞沒關係，方塊會穿過去）
    // → 只要盤面的格子都在 0..7 就一定補得到，這裡不用另外檢查。

    // jelly
    let layers = 0;
    if (L.jelly != null) {
      if (!Array.isArray(L.jelly) || L.jelly.length !== ROWS || !L.jelly.every(r => typeof r === 'string' && r.length === COLS)) {
        bad('jelly 要是 8 個長度 8 的字串');
      } else {
        for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
          const ch = L.jelly[r][c];
          if (ch === '.' || ch === '0') continue;
          if (ch !== '1' && ch !== '2') { bad(`jelly (${r},${c}) 只能是 . 0 1 2，現在是 '${ch}'`); continue; }
          if (!isCell(r, c)) { bad(`jelly (${r},${c}) 放在洞上`); continue; }
          layers += Number(ch);
        }
      }
    }

    // goal
    const g = L.goal || {};
    if (g.type === 'score') {
      if (!Number.isInteger(g.target) || g.target <= 0) bad('score 目標要是正整數');
      else if (Array.isArray(st) && st[0] !== g.target) bad(`score 關的 stars[0]（${st[0]}）要等於目標（${g.target}）`);
      if (layers) bad('score 關不要放果凍（目標面板不會顯示）');
    } else if (g.type === 'collect') {
      const items = g.items && typeof g.items === 'object' ? Object.entries(g.items) : [];
      if (!items.length || items.length > 3) bad('collect 要 1–3 種');
      items.forEach(([k, n]) => {
        if (!kinds.includes(k)) bad(`collect 的 ${k} 不在 kinds 裡`);
        if (!Number.isInteger(n) || n <= 0) bad(`collect ${k} 的數量要是正整數`);
        if (!SCANNED.includes(k)) bad(`collect 建議用掃描的毛絨（${k}）`);
      });
      if (layers) bad('collect 關不要放果凍（目標面板不會顯示）');
    } else if (g.type === 'jelly') {
      if (!layers) bad('jelly 關卻沒有果凍');
    } else {
      bad(`不認識的目標類型：${g.type}`);
    }
  });
  return out;
}
