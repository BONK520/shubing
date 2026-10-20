// 毛絨消消樂 — 關卡資料（docs/SPEC.md §4）
// 盤面都是 8×8。mask：'.' = 洞，其他字元 = 格子；jelly：數字 = 果凍層數（0–2），'.' = 0。
// 進度：收集（1–4）→ 造型盤面（5–6）→ 果凍（7–9）→ 綜合挑戰（10–15）
//   → 第 16–30 關：每五關一章，新的造型盤面輪流收集 / 果凍；章末（20、25、30）最難，下一章開頭先放鬆一點。
// 掃描的三隻（dog / sloth / egg）每一關都會出現；收集目標大多用牠們，偶爾用照片玩具。
// 步數和星星門檻用 tests/sim.html 調（python tests/run_tests.py --sim；新關卡先用 python tests/tune_levels.py 找初值）：
// 兩種玩家照正式流程各玩上千局（目標一達成就結束 → 毛絨狂歡 → 星星；每局換一個「第 n 次玩」的盤面，
// 另外單獨檢查每次打開都會先看到的第 0 個盤面）。
//   casual = 60% 隨便走、40% 挑眼前最好的一步；decent = 每步都挑最好的，會找條紋 / 包裝 / 彩色炸彈和組合技。
//   每一關的平衡目標（過關率、三星比例的下限）在 tests/sim.js 的 targetsFor：難度 t 從第 1 關的 0 到第 15 關的 1，
//   之後每章從 0.65 / 0.75 / 0.85 開始、每關 +0.1。星星門檻一律 1 : 2 : 3。
// 分數關一到目標就結束，二、三星只差在最後一步多拿的分數和剩下步數的毛絨狂歡（每步約 +100，剩 10 步左右就封頂），
// 所以分數關的星星門檻會離目標很近。

const ALL_IDS = ['dog', 'sloth', 'egg', 'dino', 'nyanko', 'moodeng', 'snoopy'];
const SCANNED = ['dog', 'sloth', 'egg'];

const HEART = [
  '.##.##.',
  '#######',
  '#######',
  '#######',
  '#######',
  '#######',
  '.#####.',
  '..###..',
  '...#...',
];

const COOKIE = [
  '..###..',
  '.#####.',
  '#######',
  '#######',
  '#######',
  '#######',
  '#######',
  '.#####.',
  '..###..',
];

const DONUT = [
  '#######',
  '#######',
  '#######',
  '##...##',
  '##...##',
  '#######',
  '#######',
  '#######',
  '#######',
];

const PLUS = [
  '..###..',
  '..###..',
  '#######',
  '#######',
  '#######',
  '#######',
  '#######',
  '..###..',
  '..###..',
];

const BUTTERFLY = [
  '##...##',
  '###.###',
  '#######',
  '.#####.',
  '.#####.',
  '.#####.',
  '#######',
  '###.###',
  '##...##',
];

const HOURGLASS = [
  '#######',
  '#######',
  '.#####.',
  '..###..',
  '..###..',
  '..###..',
  '.#####.',
  '#######',
  '#######',
];

const STAIRS = [
  '####...',
  '####...',
  '#####..',
  '######.',
  '#######',
  '.######',
  '..#####',
  '...####',
  '...####',
];

const ROUNDED = [
  '.#####.',
  '#######',
  '#######',
  '#######',
  '#######',
  '#######',
  '#######',
  '#######',
  '.#####.',
];

const DIAMOND = [
  '...#...',
  '..###..',
  '.#####.',
  '#######',
  '#######',
  '#######',
  '.#####.',
  '..###..',
  '...#...',
];

// ---- 第 16–30 關的盤面 ----
const ZIGZAG = [       // 彎彎的小路
  '#####..',
  '#####..',
  '..#####',
  '..#####',
  '#####..',
  '#####..',
  '..#####',
  '..#####',
  '#####..',
];

const CAT = [          // 貓咪老師的臉（上面兩個耳朵）
  '##...##',
  '###.###',
  '#######',
  '#######',
  '#######',
  '#######',
  '#######',
  '.#####.',
  '..###..',
];

const DOGHOUSE = [     // 史努比的狗屋（屋頂 + 門口）
  '...#...',
  '..###..',
  '.#####.',
  '#######',
  '#######',
  '#######',
  '##...##',
  '##...##',
  '##...##',
];

const CASTLE = [       // 城堡：上面一排城垛、兩座塔
  '#.#.#.#',
  '###.###',
  '###.###',
  '###.###',
  '#######',
  '#######',
  '#######',
  '#######',
  '#######',
];

const PAW = [          // 皮蛋的腳印：三個腳趾 + 肉球（中間空一排，方塊會穿過去）
  '##.#.##',
  '##.#.##',
  '##.#.##',
  '.......',
  '.#####.',
  '#######',
  '#######',
  '#######',
  '.#####.',
];

const TREE = [         // 薯餅最愛的大樹
  '..###..',
  '.#####.',
  '#######',
  '#######',
  '.#####.',
  '..###..',
  '..###..',
  '..###..',
  '.#####.',
];

const ISLANDS = [      // 左右兩座島，中間一座橋
  '###.###',
  '###.###',
  '###.###',
  '###.###',
  '#######',
  '###.###',
  '###.###',
  '###.###',
  '###.###',
];

const DOTS = [         // 點點：散在盤面上的小洞
  '#######',
  '#.###.#',
  '#######',
  '###.###',
  '#######',
  '#.###.#',
  '#######',
  '###.###',
  '#######',
];

const CUP = [          // 杯子：杯口兩邊很窄
  '##...##',
  '##...##',
  '##...##',
  '###.###',
  '#######',
  '#######',
  '#######',
  '.#####.',
  '..###..',
];

const RING = [         // 大圓環
  '.#####.',
  '#######',
  '##...##',
  '##...##',
  '##...##',
  '##...##',
  '##...##',
  '#######',
  '.#####.',
];

const BONE = [         // 皮蛋的骨頭
  '###.###',
  '#######',
  '.#####.',
  '..###..',
  '..###..',
  '..###..',
  '.#####.',
  '#######',
  '###.###',
];

const CANDY = [        // 包裝糖果（上下兩端是糖果紙）
  '###.###',
  '###.###',
  '.#####.',
  '.#####.',
  '.#####.',
  '.#####.',
  '.#####.',
  '###.###',
  '###.###',
];

const CROWN = [        // 王冠（最後一關）
  '#..#..#',
  '#.###.#',
  '#######',
  '#######',
  '#######',
  '#######',
  '#######',
  '.#####.',
  '.#####.',
];

export const LEVELS = [
  {
    id: 1, rows: 9, cols: 7, moves: 15, kinds: ['dog', 'sloth', 'egg', 'snoopy'], antiCascade: 0.7,
    goal: { type: 'collect', items: { sloth: 15 } }, stars: [17000, 34000, 51000],
    mask: null, jelly: null, seed: 101,
    hint: '把三個一樣的連成一排，收集 15 個薯餅！',
  },
  {
    id: 2, rows: 9, cols: 7, moves: 18, kinds: ['dog', 'sloth', 'egg', 'nyanko', 'dino'], antiCascade: 0.7,
    goal: { type: 'collect', items: { dog: 15, egg: 15 } }, stars: [12000, 24000, 36000],
    mask: null, jelly: null, seed: 202,
    hint: '一次連四個，會變出條紋方塊喔！',
  },
  {
    id: 3, rows: 9, cols: 7, moves: 20, kinds: ['dog', 'sloth', 'egg', 'moodeng', 'snoopy'], antiCascade: 0.72,
    goal: { type: 'collect', items: { egg: 20 } }, stars: [15000, 30000, 45000],
    mask: null, jelly: null, seed: 303,
    hint: '把蛋黃哥都收集起來！',
  },
  {
    id: 4, rows: 9, cols: 7, moves: 23, kinds: ['dog', 'sloth', 'egg', 'nyanko', 'moodeng'], antiCascade: 0.72,
    goal: { type: 'collect', items: { dog: 20, sloth: 20 } }, stars: [16000, 32000, 48000],
    mask: null, jelly: null, seed: 411,   // 加了 2×2 正方形之後重挑：第一次玩看到的盤面跟平常的盤面差不多
    hint: '排成\u00a0L\u00a0形或\u00a0T\u00a0形，會變出會爆炸的包裝糖！',   // 不斷行空格：只在逗號後換行
  },
  {
    id: 5, rows: 9, cols: 7, moves: 15, kinds: ['dog', 'sloth', 'egg', 'dino'], antiCascade: 0.72,
    goal: { type: 'collect', items: { sloth: 18, dog: 18 } }, stars: [12000, 24000, 36000],
    mask: HEART, jelly: null, seed: 505,
    hint: '愛心盤面！五個連成一排會變出彩色炸彈～',
  },
  {
    id: 6, rows: 9, cols: 7, moves: 22, kinds: ['dog', 'sloth', 'egg', 'snoopy', 'moodeng'], antiCascade: 0.72,
    goal: { type: 'collect', items: { sloth: 20, egg: 20 } }, stars: [14000, 28000, 42000],
    mask: COOKIE, jelly: null, seed: 606,
    hint: '把彩色炸彈和毛絨交換，全場同款一次消光！',
  },
  {
    id: 7, rows: 9, cols: 7, moves: 17, kinds: ['dog', 'sloth', 'egg', 'nyanko', 'dino'], antiCascade: 0.72,
    goal: { type: 'jelly' }, stars: [15000, 30000, 45000],
    mask: null,
    jelly: [
      '.......',
      '.......',
      '..111..',
      '..111..',
      '.11111.',
      '..111..',
      '..111..',
      '.......',
      '.......',
    ],
    seed: 756,
    hint: '在粉紅果凍上消除，果凍就會融化！',
  },
  {
    id: 8, rows: 9, cols: 7, moves: 27, kinds: ['dog', 'sloth', 'egg', 'moodeng', 'snoopy'], antiCascade: 0.72,
    goal: { type: 'jelly' }, stars: [23000, 46000, 69000],
    mask: DONUT,
    jelly: [
      '.......',
      '.......',
      '.11111.',
      '.1...1.',
      '.1...1.',
      '.11111.',
      '.......',
      '.......',
      '.......',
    ],
    seed: 871,
    hint: '果凍圍著甜甜圈的洞，一圈一圈消掉吧！',
  },
  {
    id: 9, rows: 9, cols: 7, moves: 20, kinds: ['dog', 'sloth', 'egg', 'dino', 'nyanko'], antiCascade: 0.72,
    goal: { type: 'jelly' }, stars: [20000, 40000, 60000],
    mask: PLUS,
    jelly: [
      '.......',
      '.......',
      '..111..',
      '.11211.',
      '.12221.',
      '.11211.',
      '..111..',
      '.......',
      '.......',
    ],
    seed: 909,
    hint: '深粉紅的果凍有兩層，要消兩次喔！',
  },
  {
    id: 10, rows: 9, cols: 7, moves: 24, kinds: ['dog', 'sloth', 'egg', 'snoopy', 'moodeng'], antiCascade: 0.74,
    goal: { type: 'collect', items: { dog: 17, sloth: 17, egg: 17 } }, stars: [10000, 20000, 30000],
    mask: BUTTERFLY, jelly: null, seed: 1017,
    hint: '蝴蝶盤面！皮蛋、薯餅、蛋黃哥一起收集～',
  },
  {
    id: 11, rows: 9, cols: 7, moves: 24, kinds: ['dog', 'sloth', 'egg', 'nyanko', 'dino'], antiCascade: 0.74,
    goal: { type: 'jelly' }, stars: [20000, 40000, 60000],
    mask: HOURGLASS,
    jelly: [
      '.......',
      '.11111.',
      '..111..',
      '...1...',
      '...1...',
      '...1...',
      '..111..',
      '.11111.',
      '.......',
    ],
    seed: 1118,
    hint: '沙漏中間的果凍，用直的一排消最快！',
  },
  {
    id: 12, rows: 9, cols: 7, moves: 23, kinds: ['dog', 'sloth', 'egg', 'snoopy', 'nyanko'], antiCascade: 0.74,
    goal: { type: 'collect', items: { egg: 20, nyanko: 20 } }, stars: [11000, 22000, 33000],
    mask: STAIRS, jelly: null, seed: 1254,
    hint: '階梯盤面，用特殊方塊一次收集一大堆！',
  },
  {
    id: 13, rows: 9, cols: 7, moves: 27, kinds: ['dog', 'sloth', 'egg', 'dino', 'snoopy', 'moodeng'], antiCascade: 0.76,
    goal: { type: 'collect', items: { dog: 17, sloth: 17, egg: 17 } }, stars: [15000, 30000, 45000],
    mask: ROUNDED, jelly: null, seed: 1334,
    hint: '把兩個特殊方塊互換，會放出超強組合技！',
  },
  {
    id: 14, rows: 9, cols: 7, moves: 40, kinds: ['dog', 'sloth', 'egg', 'dino', 'nyanko', 'snoopy'], antiCascade: 0.76,
    goal: { type: 'jelly' }, stars: [35000, 70000, 105000],
    mask: DIAMOND,
    jelly: [
      '.......',
      '..111..',
      '.11211.',
      '.12221.',
      '.12221.',
      '.12221.',
      '.11211.',
      '..111..',
      '.......',
    ],
    seed: 1414,
    hint: '鑽石果凍，正中間有兩層！',
  },
  {
    id: 15, rows: 9, cols: 7, moves: 26, kinds: ['dog', 'sloth', 'egg', 'nyanko', 'moodeng'], antiCascade: 0.76,
    goal: { type: 'jelly' }, stars: [30000, 60000, 90000],
    mask: null,
    jelly: [
      '.......',
      '.11.11.',
      '1111111',
      '1122211',
      '1122211',
      '.11211.',
      '..111..',
      '...1...',
      '.......',
    ],
    seed: 1550,
    hint: '把愛心形狀的果凍通通融化～',
  },
  // ---- 第 16–30 關：每五關一章，章末最難（20、25、30），下一章開頭先放鬆一點 ----
  {
    id: 16, rows: 9, cols: 7, moves: 20, kinds: ['dog', 'sloth', 'egg', 'moodeng', 'nyanko'], antiCascade: 0.76,
    goal: { type: 'collect', items: { dog: 16, egg: 16 } }, stars: [10000, 20000, 30000],
    mask: ZIGZAG, jelly: null, seed: 1624,
    hint: '彎彎的小路！在下面消，比較容易連鎖～',
  },
  {
    id: 17, rows: 9, cols: 7, moves: 29, kinds: ['dog', 'sloth', 'egg', 'nyanko', 'snoopy'], antiCascade: 0.76,
    goal: { type: 'jelly' }, stars: [28000, 56000, 84000],
    mask: CAT,
    jelly: [
      '.1...1.',
      '.1...1.',
      '.......',
      '..1.1..',
      '.......',
      '...1...',
      '.11111.',
      '.......',
      '.......',
    ],
    seed: 1722,
    hint: '貓咪老師的耳朵上也有果凍喔！',
  },
  {
    id: 18, rows: 9, cols: 7, moves: 22, kinds: ['dog', 'sloth', 'egg', 'snoopy', 'dino'], antiCascade: 0.76,
    goal: { type: 'collect', items: { snoopy: 16, sloth: 16 } }, stars: [11000, 22000, 33000],
    mask: DOGHOUSE, jelly: null, seed: 1819,
    hint: '史努比的狗屋！收集史努比和薯餅～',
  },
  {
    id: 19, rows: 9, cols: 7, moves: 32, kinds: ['dog', 'sloth', 'egg', 'dino', 'moodeng'], antiCascade: 0.76,
    goal: { type: 'jelly' }, stars: [26000, 52000, 78000],
    mask: CASTLE,
    jelly: [
      '.......',
      '.1...1.',
      '111.111',
      '.1...1.',
      '.......',
      '.......',
      '.......',
      '..222..',
      '..222..',
    ],
    seed: 1923,
    hint: '城堡的塔和城門都有果凍，城門有兩層！',
  },
  {
    id: 20, rows: 9, cols: 7, moves: 21, kinds: ['dog', 'sloth', 'egg', 'nyanko', 'snoopy'], antiCascade: 0.76,
    goal: { type: 'collect', items: { dog: 16, sloth: 16, egg: 16 } }, stars: [11000, 22000, 33000],
    mask: PAW, jelly: null, seed: 2029,
    hint: '皮蛋留下了大腳印！三寶一起收集～',
  },
  {
    id: 21, rows: 9, cols: 7, moves: 15, kinds: ['dog', 'sloth', 'egg', 'dino', 'nyanko'], antiCascade: 0.78,
    goal: { type: 'jelly' }, stars: [13000, 26000, 39000],
    mask: TREE,
    jelly: [
      '.......',
      '..111..',
      '.11111.',
      '.11111.',
      '..111..',
      '.......',
      '.......',
      '.......',
      '.......',
    ],
    seed: 2122,
    hint: '薯餅最愛的大樹，果凍藏在樹葉裡！',
  },
  {
    id: 22, rows: 9, cols: 7, moves: 25, kinds: ['dog', 'sloth', 'egg', 'dino', 'moodeng'], antiCascade: 0.78,
    goal: { type: 'collect', items: { dino: 18, moodeng: 18 } }, stars: [13000, 26000, 39000],
    mask: ISLANDS, jelly: null, seed: 2227,
    hint: '左右兩座島，條紋方塊可以一次清兩邊！',
  },
  {
    id: 23, rows: 9, cols: 7, moves: 28, kinds: ['dog', 'sloth', 'egg', 'snoopy', 'moodeng'], antiCascade: 0.78,
    goal: { type: 'jelly' }, stars: [25000, 50000, 75000],
    mask: DOTS,
    jelly: [
      '.......',
      '..1.1..',
      '.......',
      '..1.1..',
      '...1...',
      '..1.1..',
      '...1...',
      '..1.1..',
      '...1...',
    ],
    seed: 2326,
    hint: '小洞旁邊都是果凍，用特殊方塊一起炸！',
  },
  {
    id: 24, rows: 9, cols: 7, moves: 22, kinds: ['dog', 'sloth', 'egg', 'nyanko', 'dino'], antiCascade: 0.78,
    goal: { type: 'collect', items: { egg: 18, nyanko: 18 } }, stars: [13000, 26000, 39000],
    mask: CUP, jelly: null, seed: 2435,
    hint: '杯子的兩邊很窄，只能直直地消喔！',
  },
  {
    id: 25, rows: 9, cols: 7, moves: 38, kinds: ['dog', 'sloth', 'egg', 'moodeng', 'nyanko'], antiCascade: 0.78,
    goal: { type: 'jelly' }, stars: [31000, 62000, 93000],
    mask: RING,
    jelly: [
      '.......',
      '..222..',
      '.1...1.',
      '.1...1.',
      '.1...1.',
      '.1...1.',
      '.1...1.',
      '..222..',
      '.......',
    ],
    seed: 2528,
    hint: '圓環上下的果凍有兩層，一圈一圈融化它！',
  },
  {
    id: 26, rows: 9, cols: 7, moves: 32, kinds: ['dog', 'sloth', 'egg', 'snoopy', 'dino'], antiCascade: 0.8,
    goal: { type: 'collect', items: { dog: 28 } }, stars: [15000, 30000, 45000],
    mask: BONE, jelly: null, seed: 2631,
    hint: '皮蛋最愛的骨頭！收集好多皮蛋～',
  },
  {
    id: 27, rows: 9, cols: 7, moves: 31, kinds: ['dog', 'sloth', 'egg', 'snoopy', 'moodeng'], antiCascade: 0.8,
    goal: { type: 'jelly' }, stars: [26000, 52000, 78000],
    mask: HEART,
    jelly: [
      '.11.11.',
      '.......',
      '.1...1.',
      '.1...1.',
      '..1.1..',
      '...1...',
      '.......',
      '.......',
      '.......',
    ],
    seed: 2740,   // 加了 2×2 正方形之後重挑（第一次玩的盤面三星太難）
    hint: '愛心裡面藏著一顆果凍小愛心！',
  },
  {
    id: 28, rows: 9, cols: 7, moves: 31, kinds: ['dog', 'sloth', 'egg', 'dino', 'nyanko', 'moodeng'], antiCascade: 0.8,
    goal: { type: 'collect', items: { dog: 16, sloth: 16, egg: 16 } }, stars: [13000, 26000, 39000],
    mask: CANDY, jelly: null, seed: 2832,
    hint: '包裝糖果盤面！三寶大集合～',
  },
  {
    id: 29, rows: 9, cols: 7, moves: 19, kinds: ['dog', 'sloth', 'egg', 'nyanko', 'snoopy', 'dino'], antiCascade: 0.8,
    goal: { type: 'jelly' }, stars: [17000, 34000, 51000],
    mask: null,
    jelly: [
      '.......',
      '.......',
      '.1...1.',
      '..1.1..',
      '...2...',
      '..1.1..',
      '.1...1.',
      '.......',
      '.......',
    ],
    seed: 2938,
    hint: '叉叉果凍的正中間有兩層喔！',
  },
  {
    id: 30, rows: 9, cols: 7, moves: 42, kinds: ['dog', 'sloth', 'egg', 'snoopy', 'moodeng', 'nyanko'], antiCascade: 0.8,
    goal: { type: 'jelly' }, stars: [36000, 72000, 108000],
    mask: CROWN,
    jelly: [
      '.......',
      '..222..',
      '1111111',
      '.......',
      '.2.2.2.',
      '.......',
      '1111111',
      '.......',
      '.......',
    ],
    seed: 3041,
    hint: '最後一關！戴上王冠，把果凍通通融化～',
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
  const DEF_ROWS = 9, DEF_COLS = 7;   // 長條盤面（像 Candy Crush）
  if (!Array.isArray(levels) || !levels.length) return ['LEVELS 是空的'];
  if (levels.length < 12 || levels.length > 60) out.push(`關卡數 ${levels.length}（SPEC：12–60）`);
  const seenSeeds = new Set();
  levels.forEach((L, i) => {
    const tag = `第 ${i + 1} 關`;
    const bad = msg => out.push(`${tag}：${msg}`);
    const ROWS = (L && L.rows) || DEF_ROWS, COLS = (L && L.cols) || DEF_COLS;
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
