// 教學小卡的示意動畫資料（11/23 工作單4、工作單11）。main.js 的 introDemo 用真的引擎照這裡一步一步演。
//
// 以後加新機關，main.js 的 INTRO 和這裡的 DEMO 要一起加（INTRO 寫 demo: '名字'），
// 再用 tests/engine.test.html 的「教學示意動畫」確認每個種子每一步都照預期。
//
// 每一筆：
//   kinds      這張盤面用到的玩偶（PIECES 的順序：0狗 1樹懶 2蛋 3小豬 4貓 5河馬 6史努比）
//   layout     5×5，數字是 PIECES 的順序，h 是橫條紋、w 是包裝糖；開頭沒有三個連在一起，也沒有 2×2
//              （機關蓋住的格子，數字只是佔位）
//   obstacles  同引擎的 obstacles（C 巧克力、P 巧克力壺、X 硬殼、A 鬧鐘、S 甘草漩渦糖、- 保鮮膜包條紋…）
//   opts       其他引擎選項；新的示意都關掉連鎖（cascadeBias 0、antiCascade 1），每一輪都一樣乾淨
//   seeds      輪流用的 10 個種子，每個都試過：每一步都換得動、沒有連鎖、沒有洗牌、結果照 ok
//   chip       目標小牌子（只有目標類的機關有）：icon 是 blockers.js 的圖，order 是訂單 0/1，否則顯示「還差 N」
//   steps      一步一步：a、b 是互換的兩格；bounce 是故意換不動（彈回去）；
//              mark 是這一步演完在某一格打 ✕（灰，不行）或 ✓（綠，可以），at 是格子或 'spread'（巧克力長到的那格）；
//              hit 是「看到這個事件就算做到了」（不等後面的掉落）；ok 是測試用的檢查
//   slowFall   掉落慢幾倍（傳送門要看清楚）
//   still      減少動態時的靜態圖要怎麼畫（combo 十字光、ring 一個大光圈、exit 傳送門出口、steps 每一步各一張）
//              steps 的每一步可以再給 stillAt: 'clear'（停在剛消掉那一刻）、stillBeam: 'h'/'v'（在 b 那一排／列疊一道光）
const at = (r, c) => ({ r, c });
const same = (p, q) => !!p && !!q && p.r === q.r && p.c === q.c;
const range = (a, n) => Array.from({ length: n }, (_, i) => a + i);
const CLEAN = { cascadeBias: 0, antiCascade: 1 };
const firstClear = res => (res.events || []).find(e => e.t === 'clear');

export const DEMO = {
  combo: {
    kinds: [0, 1, 2, 5],
    layout: ['0 1 2 5 0', '1 2 5 0 1', '2 0h 1w 2 5', '5 0 1 5 2', '0 5 2 1 0'],
    seeds: range(4100, 10),
    chip: { icon: 'o-combo', name: '特殊組合', order: true, val: s => ((s.comboCount | 0) >= 1 ? 1 : 0) },
    steps: [{ a: at(2, 1), b: at(2, 2), hit: cnt => (cnt.comboCount | 0) >= 1, ok: (s0, s1) => (s1.comboCount | 0) >= 1 }],
    still: 'combo',
  },
  bomb: {
    kinds: [0, 1, 2, 6],
    layout: ['0 1 2 0 1', '1 2 0 1 2', '6 6 0 6 6', '2 0 6 2 0', '0 1 2 0 1'],
    seeds: range(4100, 10),
    chip: { icon: 'o-bomb', name: '彩色炸彈', order: true, val: s => ((s.made && s.made.bomb) | 0) >= 1 ? 1 : 0 },
    steps: [{ a: at(3, 2), b: at(2, 2), hit: cnt => ((cnt.made && cnt.made.bomb) | 0) >= 1, ok: (s0, s1) => ((s1.made && s1.made.bomb) | 0) >= 1 }],
    still: 'ring',
  },
  // 巧克力：先在旁邊亂配一組（沒打到巧克力）→ 長出一塊 ✕；再在巧克力旁邊配對 → 打掉一塊 ✓。目標「還差」1 → 2 → 1
  choco: {
    kinds: [0, 3, 2, 5],
    layout: ['5 3 0 0 3', '0 2 0 5 2', '3 2 0 5 2', '0 3 2 2 5', '0 2 5 2 3'],
    obstacles: ['.....', '.....', '..C..', '.....', '.....'],
    opts: CLEAN,
    seeds: [2, 3, 7, 8, 9, 15, 16, 17, 21, 22],
    chip: { icon: 'choco', val: s => s.chocoLeft },
    steps: [
      { a: at(1, 0), b: at(2, 0), mark: { t: 'x', at: 'spread' },
        ok: (s0, s1, res) => s1.chocoLeft === s0.chocoLeft + 1 && res.events.some(e => e.t === 'spread' && (same(e.to, at(1, 2)) || same(e.to, at(2, 1)))) },
      { a: at(2, 4), b: at(2, 3), mark: { t: 'ok', at: at(2, 2) }, ok: (s0, s1) => s1.chocoLeft === s0.chocoLeft - 1 },
    ],
    still: 'steps',
  },
  // 巧克力壺：打掉旁邊的巧克力 → 壺噴出新的；再打掉 → 又噴。目標「還差」2 → 1 → 0（收集巧克力）
  pot: {
    kinds: [4, 1, 2, 6],
    layout: ['2 6 4 2 4', '4 2 2 1 2', '1 4 4 6 6', '4 4 6 2 2', '4 2 4 1 2'],
    obstacles: ['.....', '.....', '.CP..', '.....', '.....'],
    opts: CLEAN,
    seeds: [4, 7, 8, 11, 12, 13, 19, 22, 37, 44],
    chip: { icon: 'choco', val: s => 2 - (s.chocoGot | 0) },
    steps: [
      { a: at(1, 0), b: at(2, 0), ok: (s0, s1, res) => s1.chocoGot === 1 && s1.chocoLeft === 1 && res.events.some(e => e.t === 'spread' && same(e.to, at(2, 3))) },
      { a: at(1, 4), b: at(2, 4), ok: (s0, s1, res) => s1.chocoGot === 2 && s1.chocoLeft === 1 && res.events.some(e => e.t === 'spread') },
    ],
    still: 'steps',
  },
  // 硬殼：旁邊一般配對打不掉 ✕；條紋的光掃過去才打開 ✓。目標「還差」1 → 1 → 0
  shell: {
    kinds: [6, 1, 2, 3],
    layout: ['2 1 1 2 3', '2 6 1 1 3', '6 6 6 3 2h', '6 1 6 1 2', '3 2 6 2 3'],
    obstacles: ['.....', '.....', '..X..', '.....', '.....'],
    opts: CLEAN,
    seeds: range(1, 10),
    chip: { icon: 'shell2', val: s => s.shellLeft },
    steps: [
      { a: at(3, 0), b: at(3, 1), mark: { t: 'x', at: at(2, 2) }, ok: (s0, s1) => s1.shellLeft === s0.shellLeft },
      { a: at(4, 3), b: at(4, 4), mark: { t: 'ok', at: at(2, 2) }, ok: (s0, s1) => s0.shellLeft === 1 && s1.shellLeft === 0 },
    ],
    still: 'steps',
  },
  // 鬧鐘：走一步少一格（3 → 2）；在旁邊配對就拆掉 ✓。扣 3 步那件事留在小卡的字裡
  alarm: {
    kinds: [0, 3, 4, 5],
    layout: ['5 3 0 0 3', '0 4 0 5 4', '3 4 0 5 4', '0 3 4 4 5', '0 4 5 4 3'],
    obstacles: ['.....', '.....', '..A..', '.....', '.....'],
    opts: { ...CLEAN, alarm: { timer: 3 } },
    seeds: range(1, 10),
    steps: [
      { a: at(1, 0), b: at(2, 0), ok: (s0, s1, res) => s1.alarmsLeft === 1 && res.events.some(e => e.t === 'tick' && e.cells.some(q => q.hp === 2)) },
      { a: at(2, 4), b: at(2, 3), mark: { t: 'ok', at: at(2, 2) }, ok: (s0, s1) => s1.alarmsLeft === 0 && s1.alarmsBurst === 0 },
    ],
    still: 'steps',
  },
  // 傳送門：消掉出口下面那一排，上面入口的玩偶穿過門掉出來（慢慢播）
  portal: {
    kinds: [0, 1, 2, 5],
    layout: ['2 1 1 2 5', '2 1 2 5 0', '5 0 1 5 2', '2 0 2 2 1', '5 1 5 2 0'],
    opts: { ...CLEAN, portals: [[0, 1, 2, 3]] },
    seeds: range(1, 10),
    slowFall: 2.2,
    steps: [
      { a: at(2, 4), b: at(2, 3),
        ok: (s0, s1, res) => res.events.some(e => e.t === 'fall' && [...(e.moves || []), ...(e.spawns || [])].some(m => (m.path || []).some(p => p.warp))) },
    ],
    still: 'exit',
  },
  // 甘草漩渦糖：拖它會彈回來 ✕；在旁邊配對就消掉 ✓
  lic: {
    kinds: [1, 2, 3, 5],
    layout: ['3 1 2 1 5', '2 5 2 1 2', '5 2 1 3 1', '1 5 3 1 2', '5 5 1 1 5'],
    obstacles: ['.....', '.....', '..S..', '.....', '.....'],
    opts: CLEAN,
    seeds: range(1, 10),
    steps: [
      { a: at(2, 2), b: at(2, 3), bounce: true, mark: { t: 'x', at: at(2, 2) }, ok: (s0, s1, res) => !res.ok && res.events.length === 2 },
      { a: at(2, 0), b: at(2, 1), mark: { t: 'ok', at: at(2, 2) }, ok: (s0, s1) => s1.licoriceLeft === s0.licoriceLeft - 1 },
    ],
    still: 'steps',
  },
  // 保鮮膜：在旁邊配對拆開 → 裡面是條紋；換一下條紋就整排掃掉
  gift: {
    kinds: [0, 6, 2, 3],
    layout: ['2 0 6 0 3', '6 3 6 0 6', '3 6 2 3 0', '0 3 2 2 6', '3 3 0 2 2'],
    obstacles: ['.....', '.....', '..-..', '.....', '.....'],
    opts: CLEAN,
    seeds: range(1, 10),
    steps: [
      { a: at(2, 0), b: at(2, 1), ok: (s0, s1) => s1.giftLeft === s0.giftLeft - 1 },
      { a: at(2, 2), b: at(2, 3), stillAt: 'clear', stillBeam: 'h', ok: (s0, s1, res) => { const cl = firstClear(res); return !!cl && cl.removed.filter(q => q.r === 2).length >= 5; } },
    ],
    still: 'steps',
  },
};

// 測試和遊戲共用：照 DEMO 開一個引擎（createEngine 由呼叫的人給，這個檔不 import 任何東西）
export function demoEngine(createEngine, d, seed) {
  return createEngine({ kinds: d.kinds, layout: d.layout, obstacles: d.obstacles || undefined, seed, ...(d.opts || {}) });
}
