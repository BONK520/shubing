// 毛絨消消樂 — 關卡資料（docs/SPEC.md §4）
// 盤面都是 8×8。mask：'.' = 洞，其他字元 = 格子；jelly：數字 = 果凍層數（0–2），'.' = 0。
// 進度：分數（1–2）→ 收集（3–4）→ 造型盤面（5–6）→ 果凍（7–9）→ 綜合挑戰（10–15）。
// 掃描的三隻（dog / sloth / egg）每一關都會出現；收集目標都用牠們。
// 目前的步數、星星門檻是用 tools/out 裡的模擬機器人（隨機 / 提示 / 會想的玩家）調出來的。

const ALL_IDS = ['dog', 'sloth', 'egg', 'bunny', 'frog', 'whale'];
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
    id: 1, moves: 20, kinds: ['dog', 'sloth', 'egg', 'bunny'], antiCascade: 0.7,
    goal: { type: 'score', target: 3000 }, stars: [3000, 6000, 9000],
    mask: null, jelly: null, seed: 101,
    hint: '把三個一樣的毛絨連成一排！',
  },
  {
    id: 2, moves: 20, kinds: ['dog', 'sloth', 'egg', 'frog', 'bunny'], antiCascade: 0.7,
    goal: { type: 'score', target: 3000 }, stars: [3000, 6000, 9000],
    mask: null, jelly: null, seed: 202,
    hint: '一次連四個，會變出條紋方塊喔！',
  },
  {
    id: 3, moves: 20, kinds: ['dog', 'sloth', 'egg', 'whale', 'bunny'], antiCascade: 0.72,
    goal: { type: 'collect', items: { egg: 20 } }, stars: [3000, 6000, 9000],
    mask: null, jelly: null, seed: 303,
    hint: '把蛋蛋都收集起來！',
  },
  {
    id: 4, moves: 22, kinds: ['dog', 'sloth', 'egg', 'frog', 'whale'], antiCascade: 0.72,
    goal: { type: 'collect', items: { dog: 18, sloth: 18 } }, stars: [3000, 6000, 9000],
    mask: null, jelly: null, seed: 404,
    hint: '排成 L 形或 T 形，會變出會爆炸的包裝糖！',
  },
  {
    id: 5, moves: 22, kinds: ['dog', 'sloth', 'egg', 'bunny'], antiCascade: 0.72,
    goal: { type: 'score', target: 3000 }, stars: [3000, 6000, 9000],
    mask: HEART, jelly: null, seed: 505,
    hint: '愛心盤面！五個連成一排會變出彩色炸彈～',
  },
  {
    id: 6, moves: 22, kinds: ['dog', 'sloth', 'egg', 'bunny', 'whale'], antiCascade: 0.72,
    goal: { type: 'collect', items: { sloth: 18, egg: 18 } }, stars: [3000, 6000, 9000],
    mask: COOKIE, jelly: null, seed: 606,
    hint: '把彩色炸彈和毛絨交換，全場同款一次消光！',
  },
  {
    id: 7, moves: 22, kinds: ['dog', 'sloth', 'egg', 'frog', 'bunny'], antiCascade: 0.72,
    goal: { type: 'jelly' }, stars: [3000, 6000, 9000],
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
    id: 8, moves: 24, kinds: ['dog', 'sloth', 'egg', 'whale', 'frog'], antiCascade: 0.72,
    goal: { type: 'jelly' }, stars: [3000, 6000, 9000],
    mask: DONUT,
    jelly: [
      '11....11',
      '11....11',
      '..1111..',
      '..1..1..',
      '..1..1..',
      '..1111..',
      '11....11',
      '11....11',
    ],
    seed: 808,
    hint: '角落的果凍，交給條紋方塊吧！',
  },
  {
    id: 9, moves: 25, kinds: ['dog', 'sloth', 'egg', 'bunny', 'frog'], antiCascade: 0.72,
    goal: { type: 'jelly' }, stars: [3000, 6000, 9000],
    mask: PLUS,
    jelly: [
      '........',
      '........',
      '..2222..',
      '..2222..',
      '..2222..',
      '..2222..',
      '........',
      '........',
    ],
    seed: 909,
    hint: '深粉紅的果凍有兩層，要消兩次喔！',
  },
  {
    id: 10, moves: 25, kinds: ['dog', 'sloth', 'egg', 'bunny', 'whale'], antiCascade: 0.74,
    goal: { type: 'collect', items: { dog: 20, sloth: 20, egg: 20 } }, stars: [3000, 6000, 9000],
    mask: BUTTERFLY, jelly: null, seed: 1010,
    hint: '蝴蝶盤面！三隻一起收集～',
  },
  {
    id: 11, moves: 26, kinds: ['dog', 'sloth', 'egg', 'frog', 'whale'], antiCascade: 0.74,
    goal: { type: 'jelly' }, stars: [3000, 6000, 9000],
    mask: HOURGLASS,
    jelly: [
      '11111111',
      '.111111.',
      '........',
      '........',
      '........',
      '........',
      '.111111.',
      '11111111',
    ],
    seed: 1111,
    hint: '沙漏的上下兩頭都有果凍！',
  },
  {
    id: 12, moves: 24, kinds: ['dog', 'sloth', 'egg', 'bunny', 'frog'], antiCascade: 0.74,
    goal: { type: 'score', target: 3000 }, stars: [3000, 6000, 9000],
    mask: STAIRS, jelly: null, seed: 1212,
    hint: '階梯盤面，多做特殊方塊拿高分！',
  },
  {
    id: 13, moves: 28, kinds: ['dog', 'sloth', 'egg', 'bunny', 'frog', 'whale'], antiCascade: 0.76,
    goal: { type: 'collect', items: { dog: 22, sloth: 22, egg: 22 } }, stars: [3000, 6000, 9000],
    mask: ROUNDED, jelly: null, seed: 1313,
    hint: '六種毛絨全員到齊，眼睛要放亮！',
  },
  {
    id: 14, moves: 28, kinds: ['dog', 'sloth', 'egg', 'bunny', 'frog', 'whale'], antiCascade: 0.76,
    goal: { type: 'jelly' }, stars: [3000, 6000, 9000],
    mask: DIAMOND,
    jelly: [
      '...11...',
      '..1111..',
      '.111111.',
      '11122111',
      '11122111',
      '.111111.',
      '..1111..',
      '...11...',
    ],
    seed: 1414,
    hint: '鑽石果凍，正中間有兩層！',
  },
  {
    id: 15, moves: 30, kinds: ['dog', 'sloth', 'egg', 'bunny', 'frog', 'whale'], antiCascade: 0.76,
    goal: { type: 'jelly' }, stars: [3000, 6000, 9000],
    mask: null,
    jelly: [
      '.11..11.',
      '12211221',
      '12222221',
      '12222221',
      '.122221.',
      '..1221..',
      '...11...',
      '........',
    ],
    seed: 1515,
    hint: '最後一關！把愛心果凍通通融化～',
  },
];

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
