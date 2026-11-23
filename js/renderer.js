// 毛絨消消樂：Canvas 2D 盤面渲染、動畫、粒子、橫幅（docs/SPEC.md §6）
// 所有位置都用「格」做單位（r、c 可以是小數），畫的時候才換成像素，所以 layout() 隨時可以呼叫。
// 每個引擎事件播完後都會用事件附帶的 board 重新同步，畫面永遠不會和引擎不一致。
//
// 手感（像 Candy Crush 那樣「刷刷刷」）：
//   * 事件是「接力」播放，不是一個播完才播下一個：消除的方塊還在縮小時，上面的方塊就開始掉；
//     掉落用重力加速度，同一欄由下往上錯開一點點，落地有壓扁回彈；下一輪連鎖只等「會被消掉的那幾顆」落地就爆。
//     還在掉的方塊被下一次掉落接手時，保留當下的位置和速度繼續掉（不會停頓）。
//   * 粒子、飄分、連鎖字、光束尾巴都在背景播，不會拖住 play()。play() 在盤面完全停下來的那一刻 resolve。
//   * 每幀不建立漸層、不用 shadowBlur：光暈 / 光束 / 文字都先畫好快取起來。
//
// 除了 SPEC §6 的 API，另有：
//   R.play(events, { onEvent, onCue })
//               onCue(name, { delay, ... })：音效 / 震動的時間點，和畫面同步。delay = 從現在算起幾毫秒後發生。
//               name：'swap' 'invalid' 'pop'(cascade, group, size) 'stripe' 'wrap'(radius) 'bomb'(n) 'board'
//                     'combo' 'special'(special) 'land' 'chime'(level) 'shuffle' 'belt'
//   R.pause()   停掉 requestAnimationFrame 迴圈（遊戲畫面被藏起來時用，例如回到地圖 / 標題），
//               選取、提示、特殊方塊的待機動畫都不再每幀重畫。play() / banner() 照常計時完成，不會卡住。
//   R.resume()  恢復迴圈並立刻重畫一次（期間尺寸若有變也會重新排版）。兩者都可以重複呼叫。
//   R.paused    目前是否暫停（唯讀）。

import { SLOGANS, cascadeSlogan } from './slogans.js?v=20261123x';
import { TOY_FACE, ACCESSORY_PLACE, ACCESSORY_TUNING, ACCESSORY_SVG, svgUrl } from './cosmetics.js?v=20261123x';
import { paintCage, paintFrost, paintChoco, paintSwirl, paintAlarm, paintShell, paintPot, paintWrap, paintExitArrow, PORTAL_COLORS, CRUMBS } from './blockers.js?v=20261123x';

// 數字用胖數字 PlushNum（只有數字和符號，style.css 的 unicode-range），其他字是源泉圓體
const FONT = '"PlushNum", "GenSenRounded", "Baloo 2", "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", system-ui, sans-serif';
const MAX_DPR = 2;        // 手機上限：再高肉眼幾乎看不出差別，填色量卻多很多
const MARGIN_RIM = 0.25;  // 有外框的主題：盤面四周保留（格），放得下有厚度的盤子外框
const FRAME_B_RIM = 0.34; //               盤面下面再多留（格）：盤子的厚度和投影
const MARGIN_FLAT = 0.1;  // 平面底板（改版 2026-11 的預設主題）：深紫底板只比格子多一圈細邊，沒有厚度
const PAD = 1.42;         // 方塊快取畫布邊長 / 格（留給陰影、糖果紙兩端）
const TILE = 0.8;         // 圓角方塊邊長 / 格（改版 2026-11：從 0.88 縮小，格子露出比較多）
const MAX_PARTS = 900;

// ---- 節奏（毫秒）----
const SWAP_MS = 220;      // 成功交換（主動的那顆有一點點回彈）
const SWAP_BAD_MS = 150;  // 不成立的交換：過去
const SWAP_BACK_MS = 170; //                 彈回來
const POP_MS = 380;       // 消除：放大 + 白光 → 碎開
const POP_HIT = 75;       // 頓幀：被消的玩偶先在 75ms 內放大到 1.2 倍、閃一下亮白，才「啵」地爆開
const POP_LEAD = 150;     // 最後一顆閃光之後 ~150ms 上面的方塊才開始往下灌（碎開的動畫在背景收尾，不等；2026-11 從 105 拉長，消掉的那一下看得到）
const GROUP_STAGGER = 40; // 同一步裡好幾組消除：一組接一組爆，音高一組比一組高（2026-11 從 24 拉開，聲音不會黏成一團）
const POP_SEQ = 34;       // 同一組裡一顆接一顆爆（「啵、啵、啵」）
const MERGE_MS = 140;     // 合成特殊方塊：同組的方塊吸過去
const POPIN_MS = 420;     // 新特殊方塊 / 變身的彈出（放大到 1.3 倍再彈回；改版 2026-11 從 340 拉長，大的那一下看得清楚）
const LAND_MS = 130;      // 落地壓扁回彈（麻糬：壓扁 1.16 / 0.84 → 回彈 0.95 / 1.06 → 恢復），約 120ms 內做完
const LAND_HOLD = 230;    // 下一輪連鎖：會被消掉的方塊落地後停一拍（230ms）才爆，每一段連鎖分得開（2026-11 從 80 拉長：玩家覺得太快、全部黏在一起）
const G_FALL = 0.00006;   // 掉落重力加速度（格 / ms²）：越掉越快，一格約 0.12 秒、整欄約 0.44 秒（2026-11 放慢約兩成）
const V0_FALL = 0.005;    // 掉落初速（格 / ms）
const STAGGER_ROW = 36, STAGGER_MAX = 180, COL_JITTER = 16;   // 同一欄一顆接一顆落下（間隔約 0.036 秒），像瀑布
// 特效傳到某格要多久
// CHAIN_MS：被波及的特殊方塊，一個接一個接力引爆的間隔（70ms）
const LINE_MS = 28, BLAST_MS = 55, BOARD_MS = 36, CHAIN_MS = 70, BOMB_FIRST = 110, CLEAR_CAP = 900;
// 飛天玩偶（2×2 正方形變的特殊方塊，引擎裡叫 'fish'）飛到目標的時間：基本 + 每格距離，最久 FISH_MAX
// （先往上飛出一段弧線再俯衝，看得清楚）
const FISH_BASE = 430, FISH_PER = 30, FISH_MAX = 720;
const fishMs = e => Math.min(FISH_MAX, FISH_BASE + FISH_PER * Math.hypot(e.to.r - e.r, e.to.c - e.c));

const DINO_GLOW = [110, 240, 150];       // 龍龍：綠色的光
const ALARM_RED = [255, 84, 120];        // 鬧鐘爆開：紅色的圈和「-3步」
const POT_GLOW = [255, 170, 200];        // 巧克力壺噴巧克力：壺亮一圈粉紅色的光
const WHITE = [255, 255, 255], BLACK = [0, 0, 0], PLUM = [74, 34, 112], PLUM_D = [40, 12, 78], GOLD = [255, 196, 40], SPARK_GOLD = [255, 186, 60];
// 盤面主題（衣櫃的「棋盤背景主題」）：玻璃、格子、內壁影子、外框顏色、裝飾。預設是「夢幻馬卡龍」：
// 半透明的奶白 → 淡薰衣草毛玻璃，粉白 / 淡紫交錯的格子，奶油粉外框
const FRAME_CREAM = {
  glow: 'rgba(255,236,248,0.9)', base: '#f6dbe4', drop: 'rgba(110,60,120,0.26)', dropBase: '#c98f9e',
  side: ['#ecc3b4', '#dba597', '#c4877d'], ring: ['#fff7ec', '#fcecdc', '#f2d8c4'], ringShade: [190, 120, 110], innerEdge: 'rgba(170,110,150,0.45)',
};
export const BOARD_THEMES = {
  // 格子裡面是沉穩的半透明深藍紫玻璃（兩種深度交錯 + 細細的淡色內格線），淺色、深色的玩偶和彩色底座都跳得出來；
  // 外框維持粉嫩的奶油色
  macaron: {
    glass: [[0, 'rgba(46,54,112,0.9)'], [1, 'rgba(30,36,82,0.93)']],
    glow: ['rgba(150,170,255,0.14)', 'rgba(150,170,255,0)'],
    cellA: 'rgba(38,46,95,0.72)', cellB: 'rgba(48,58,115,0.72)',
    grid: 'rgba(180,195,255,0.13)',
    wallDark: 'rgba(6,8,36,0.55)', wallLit: 'rgba(190,200,255,0.14)', rimShadow: 'rgba(8,6,36,0.24)',
    shadow: [10, 6, 44],             // 糖果落在盤面上的影子顏色
    frame: FRAME_CREAM,
    // 改版 2026-11：預設主題改成平的深紫底板（拿掉奶油厚框），格子深淺交錯。其他主題的裝飾畫在外框上，維持原樣
    flat: { base: '#2b2560', cellA: '#3d3680', cellB: '#342e72' },
  },
  // 粉紅夾娃娃機台：桃紅色的機台外框、一圈會發亮的小燈泡，裡面粉粉的
  claw: {
    glass: [[0, 'rgba(88,30,86,0.9)'], [1, 'rgba(60,18,62,0.93)']],
    glow: ['rgba(255,150,220,0.16)', 'rgba(255,150,220,0)'],
    cellA: 'rgba(96,34,92,0.72)', cellB: 'rgba(116,44,108,0.72)',
    grid: 'rgba(255,180,230,0.14)',
    wallDark: 'rgba(30,4,30,0.55)', wallLit: 'rgba(255,190,240,0.14)', rimShadow: 'rgba(30,4,30,0.24)',
    shadow: [30, 4, 30],
    frame: { glow: 'rgba(255,160,210,0.95)', base: '#ff9bcb', drop: 'rgba(150,30,90,0.3)', dropBase: '#c2427f',
      side: ['#e0559b', '#c63d84', '#9e2a63'], ring: ['#ffd9ec', '#ff8cc2', '#ec5fa3'], ringShade: [150, 30, 90], innerEdge: 'rgba(170,40,110,0.5)' },
    deco: 'bulbs',
  },
  // 野餐草莓格紋：紅白格子布、藤編籃子色的外框
  picnic: {
    glass: [[0, 'rgba(255,252,247,0.92)'], [1, 'rgba(255,245,238,0.94)']],
    glow: ['rgba(255,255,255,0.4)', 'rgba(255,255,255,0)'],
    cellA: 'rgba(255,255,255,0.96)', cellB: 'rgba(255,240,240,0.96)',
    wallDark: 'rgba(160,90,60,0.26)', wallLit: 'rgba(255,255,255,0.95)', rimShadow: 'rgba(120,70,30,0.14)',
    shadow: [120, 60, 40],
    pattern: 'gingham',
    frame: { glow: 'rgba(255,238,205,0.85)', base: '#efd2a0', drop: 'rgba(110,60,20,0.3)', dropBase: '#b07a3c',
      side: ['#c99456', '#b07a3c', '#8a5a26'], ring: ['#fbe6c0', '#eac68a', '#d6a560'], ringShade: [140, 90, 40], innerEdge: 'rgba(150,90,40,0.45)' },
    deco: 'berries',
  },
  // 深邃夢幻星空：深紫藍的夜空玻璃、滿滿的小星星、紫色外框
  galaxy: {
    glass: [[0, 'rgba(56,42,128,0.95)'], [1, 'rgba(22,16,66,0.97)']],
    glow: ['rgba(160,130,255,0.35)', 'rgba(160,130,255,0)'],
    cellA: 'rgba(130,110,240,0.2)', cellB: 'rgba(96,76,210,0.13)',
    wallDark: 'rgba(5,2,25,0.6)', wallLit: 'rgba(190,170,255,0.22)', rimShadow: 'rgba(5,2,30,0.3)',
    shadow: [8, 4, 40],
    frame: { glow: 'rgba(170,150,255,0.75)', base: '#8a78e0', drop: 'rgba(20,10,60,0.4)', dropBase: '#3a2a8a',
      side: ['#4c3aa8', '#3a2a8a', '#24186a'], ring: ['#a493f2', '#6b56d0', '#4a36a8'], ringShade: [20, 10, 60], innerEdge: 'rgba(20,10,60,0.6)' },
    deco: 'stars',
  },
};
const now = () => performance.now();
const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
const easeInCubic = t => t * t * t;
const easeInOutSine = t => 0.5 - 0.5 * Math.cos(Math.PI * t);
const easeInOutCubic = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutBack = (t, s = 1.70158) => { const u = t - 1; return 1 + (s + 1) * u * u * u + s * u * u; };
const easeInBack = (t, s = 1.70158) => (s + 1) * t * t * t - s * t * t;
const easeSwap = t => easeOutBack(t, 1.25);
const easeSwapBack = t => easeOutBack(t, 2.4);
// 彈出：小 → 放大 → 回彈到 1
const popCurve = p => (p < 0.22 ? lerp(0.35, 1.3, easeOutCubic(p / 0.22))
  : 1 + 0.3 * Math.exp(-5.5 * (p - 0.22)) * Math.cos((p - 0.22) * 11));

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- 顏色 ----------
function parseColor(hex) {
  let h = String(hex || '#cccccc').trim().replace('#', '');
  if (h.length === 3) h = h.split('').map(x => x + x).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (!Number.isFinite(n)) return [204, 204, 204];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const mixc = (a, b, t) => [0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * t));
const css = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
function saturate(c, amt) {
  const g = (c[0] + c[1] + c[2]) / 3;
  return c.map(v => clamp(Math.round(g + (v - g) * (1 + amt)), 0, 255));
}

// ---------- 畫布小工具 ----------
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}
function rr(g, x, y, w, h, r) {
  g.beginPath();
  rrSub(g, x, y, w, h, r);
}
// 圓角方框加進目前的路徑（不開新路徑）：拿來做「外框 + 中間挖洞」的路徑
function rrSub(g, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
// 糖果外形（像 Candy Crush：每一種糖果形狀都不一樣，一眼就分得出來）
function roundedPoly(g, pts, r) {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
    if (i === 0) g.moveTo((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2);
    g.arcTo(p1[0], p1[1], (p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2, r);
  }
  g.closePath();
}
// 愛心的幾何（單位 = 糖果半徑 R、原點在糖果中心、y 往下）：
//   兩瓣 = 圓心 (±a, b)、半徑 r；底尖 = 圓心 (0, t)、半徑 rt；兩邊是「瓣」和「底尖」的外公切線；
//   上凹口 = 同時外切兩瓣、半徑 f 的小圓。整顆和圓形糖果一樣寬（1.94R），dy 讓它上下置中。
//   底尖圓圓的（rt 0.28、舊版 0.18）、兩瓣大一點：玩具蓋住上半部時，下面露出來的是一顆圓鼓鼓的糖尖，不是硬硬的 V 字
const HEART = (() => {
  const a = 0.46, b = -0.31, r = 0.51, t = 0.6, rt = 0.28, f = 0.11;
  // 外公切線朝外的法向量 n：切點 = 圓心 + 半徑 × n，兩個切點在同一條線上 → n·(底尖圓心 − 右瓣圓心) = r − rt
  const ux = -a, uy = t - b, d = Math.hypot(ux, uy), k = (r - rt) / d, s = Math.sqrt(1 - k * k);
  const nx = (k * ux + s * uy) / d, ny = (k * uy - s * ux) / d;
  const fc = b - Math.sqrt((r + f) ** 2 - a * a), fa = Math.atan2(b - fc, a);
  return { a, b, r, t, rt, f, fc, fa, fx: f * Math.cos(fa), fy: fc + f * Math.sin(fa),
    ra: Math.atan2(fc - b, -a), na: Math.atan2(ny, nx), dy: -((t + rt) + (b - r)) / 2 };
})();
function candyPath(g, shape, cx, cy, R) {
  g.beginPath();
  switch (shape) {
    case 'ball': g.arc(cx, cy, R * 0.97, 0, Math.PI * 2); break;
    case 'square': { const w = R * 1.74, r = w * 0.32; rr(g, cx - w / 2, cy - w / 2, w, w, r); break; }
    case 'egg': {
      const w = R * 0.93, h = R;
      g.moveTo(cx, cy - h);
      g.bezierCurveTo(cx + w * 1.08, cy - h, cx + w * 1.12, cy + h * 0.6, cx, cy + h);
      g.bezierCurveTo(cx - w * 1.12, cy + h * 0.6, cx - w * 1.08, cy - h, cx, cy - h);
      g.closePath();
      break;
    }
    case 'flower': {
      const r = R * 0.43, d = R * 0.55;
      for (let k = 0; k < 6; k++) {
        const a = k * Math.PI / 3 - Math.PI / 2, x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
        g.moveTo(x + r, y); g.arc(x, y, r, 0, Math.PI * 2);
      }
      g.moveTo(cx + R * 0.62, cy); g.arc(cx, cy, R * 0.62, 0, Math.PI * 2);
      break;
    }
    case 'hex': {
      const pts = [];
      for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; pts.push([cx + Math.cos(a) * R * 1.02, cy + Math.sin(a) * R * 0.92]); }
      roundedPoly(g, pts, R * 0.24);
      break;
    }
    case 'bean': g.ellipse(cx, cy, R * 1.0, R * 0.88, -0.25, 0, Math.PI * 2); break;
    case 'heart': {
      // 飽滿的愛心軟糖：兩個圓圓的大瓣 + 圓圓的底尖 + 圓角的上凹口，全部用相切的圓弧接起來（沒有尖角，邊緣平滑 Q 彈）
      const H = HEART, y = cy + H.dy * R;
      g.moveTo(cx - H.fx * R, y + H.fy * R);
      g.arc(cx, y + H.fc * R, H.f * R, Math.PI - H.fa, H.fa, true);                  // 上凹口（往下凹的小圓角）
      g.arc(cx + H.a * R, y + H.b * R, H.r * R, H.ra, H.na);                         // 右瓣
      g.arc(cx, y + H.t * R, H.rt * R, H.na, Math.PI - H.na);                        // 底尖（兩邊用直線接過來）
      g.arc(cx - H.a * R, y + H.b * R, H.r * R, Math.PI - H.na, Math.PI - H.ra);    // 左瓣
      g.closePath();
      break;
    }
    default: g.arc(cx, cy, R, 0, Math.PI * 2);
  }
}
// 四個角各自的圓角半徑（盤面外框用：只有凸出去的角才圓）
function rr4(g, x, y, w, h, tl, tr, br, bl) {
  g.beginPath();
  g.moveTo(x + tl, y);
  g.lineTo(x + w - tr, y);
  if (tr) g.arcTo(x + w, y, x + w, y + tr, tr);
  g.lineTo(x + w, y + h - br);
  if (br) g.arcTo(x + w, y + h, x + w - br, y + h, br);
  g.lineTo(x + bl, y + h);
  if (bl) g.arcTo(x, y + h, x, y + h - bl, bl);
  g.lineTo(x, y + tl);
  if (tl) g.arcTo(x, y, x + tl, y, tl);
  g.closePath();
}
const isImgEl = img => typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement;
const natW = img => img.naturalWidth || img.width || 0;
const natH = img => img.naturalHeight || img.height || 0;

// quiet: true → 不畫飄分數、稱讚字和大標語（教學小卡的 5×5 示意盤面太小，字會蓋住整個盤面）
export function createRenderer(canvas, { pieces = [], images = new Map(), quiet = false } = {}) {
  const ctx = canvas.getContext('2d');

  // ---- 版面 ----
  let W = 0, H = 0, dpr = 1, cs = 40, ox = 0, oy = 0;
  // ---- 盤面狀態（顯示用）----
  let rows = 0, cols = 0, mask = [], jelly = [];
  let visuals = new Map();          // piece id -> visual
  let cellMap = [];                 // [r][c] -> visual
  let ghosts = [];                  // 正在消失的方塊
  let fx = [];                      // 光束 / 衝擊波 / 閃電 / 閃光
  let parts = [];                   // 粒子
  let texts = [];                   // 飄分
  let word = null;                  // 連鎖字（口號）
  let surpriseUsed = false;         // 照片驚喜口號每關最多一次（setBoard 重設）
  // 口號語音（2026-11：玩家覺得太吵、每段連鎖都講一句全部黏在一起）：學 Candy Crush 平常安靜，
  // 一步最多講一句，連到第 3 段以上（或組合技、照片驚喜）才講，兩句之間至少隔 VOICE_GAP 毫秒。字照樣每段都跳
  const VOICE_GAP = 6000;
  let lastVoiceAt = -Infinity, moveVoiced = false;
  let banners = [];
  let shakes = [];
  let sched = [];                   // 定時動作 { t, fn }
  const jellyFx = new Map();        // key -> { t0, from }
  let selected = null, hintPair = null, dragState = null;
  let fallSeq = 0;
  // 盤面機關：鐵籠子（每格 0 / 1）、龍龍出口、傳送門、輸送帶（每條是一串格子，方塊照順序往下一格跑）
  let locks = [], exitCells = [], portalList = [], beltList = [];
  const blockCache = new Map(), crumbCache = new Map();
  let blockS = 0;
  // ---- 流程 ----
  let gen = 0, busyCount = 0, destroyed = false;
  let queue = Promise.resolve(), bannerQueue = Promise.resolve();
  let curOpts = null;
  const waits = new Set();
  let raf = 0, lastDraw = 0, paused = false, inFrame = false;
  // ---- 快取 ----
  const tileCache = new Map();
  let cacheS = 0;
  let bgCache = null, clipPath = null, jellyCache = [], rimCache = [], glowImg = null, starImg = null, flashImg = null;
  const fluffCache = new Map(), starColCache = new Map(), glowColCache = new Map(), beamCache = new Map();
  const spriteCache = new WeakMap();
  const watched = new WeakSet();
  const colorMemo = new Map();
  let scratch = null;
  let BOARD_THEME = BOARD_THEMES.macaron;
  // 盤面四周和下面留多少（格）：平面底板幾乎不用留，有外框的主題要留給外框和厚度
  let MARGIN = MARGIN_FLAT, FRAME_B = 0;
  function themeGeom() { MARGIN = BOARD_THEME.flat ? MARGIN_FLAT : MARGIN_RIM; FRAME_B = BOARD_THEME.flat ? 0 : FRAME_B_RIM; }
  // 衣櫃的外觀（R.setLook）：hat 配件、frame 方塊底座、theme 盤面主題；消除特效在 particleSkin
  let look = { hat: 'none', fx: 'default', frame: 'jelly', theme: 'macaron' };

  // ================= 素材 =================
  function pieceInfo(kind) { return pieces[kind] || { id: '?', name: '?', color: '#cccccc' }; }
  function kindColor(kind) {
    if (kind < 0 || kind == null) return [255, 214, 120];
    let c = colorMemo.get(kind);
    if (!c) { c = parseColor(pieceInfo(kind).color); colorMemo.set(kind, c); }
    return c;
  }
  function imgsFor(id) {
    const e = images && typeof images.get === 'function' ? images.get(id) : null;
    if (!e) return {};
    if ('sprite' in e || 'spin' in e) return e;
    return { sprite: e };            // 也接受直接放圖片
  }
  function usable(img) {
    if (!img) return false;
    if (isImgEl(img)) {
      if (img.complete) return img.naturalWidth > 0;
      if (!watched.has(img)) {
        watched.add(img);
        const on = () => { if (!destroyed) { tileCache.clear(); requestDraw(); } };
        img.addEventListener('load', on, { once: true });
        img.addEventListener('error', on, { once: true });
      }
      return false;
    }
    return natW(img) > 0;
  }
  // 高品質縮圖（逐次減半），結果快取
  function scaled(img, size) {
    size = Math.max(1, Math.round(size));
    let m = spriteCache.get(img);
    if (!m) { m = new Map(); spriteCache.set(img, m); }
    let out = m.get(size);
    if (out) return out;
    let src = img, sw = natW(img), sh = natH(img);
    const k = size / Math.max(sw, sh), tw = sw * k, th = sh * k;
    while (sw / 2 >= tw * 1.05 && sw > 2) {
      const n = makeCanvas(sw / 2, sh / 2), g = n.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(src, 0, 0, n.width, n.height);
      src = n; sw = n.width; sh = n.height;
    }
    out = makeCanvas(size, size);
    const g = out.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, (size - tw) / 2, (size - th) / 2, tw, th);
    m.set(size, out);
    return out;
  }

  // ================= 方塊預先繪製 =================
  function paintFallback(g, info, cx, cy, box) {
    const col = parseColor(info.color), rad = box * 0.34;
    g.save();
    g.shadowColor = 'rgba(40,10,70,0.35)'; g.shadowBlur = box * 0.05; g.shadowOffsetY = box * 0.03;
    g.beginPath(); g.arc(cx, cy, rad + box * 0.04, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
    g.restore();
    const gr = g.createRadialGradient(cx - rad * 0.3, cy - rad * 0.4, rad * 0.1, cx, cy, rad);
    gr.addColorStop(0, css(mixc(col, WHITE, 0.25)));
    gr.addColorStop(1, css(mixc(saturate(col, 0.6), BLACK, 0.12)));
    g.beginPath(); g.arc(cx, cy, rad, 0, Math.PI * 2); g.fillStyle = gr; g.fill();
    const ch = Array.from(String(info.name || '?'))[0] || '?';
    g.font = `900 ${Math.round(rad * 1.12)}px ${FONT}`;
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    g.lineWidth = rad * 0.2; g.strokeStyle = css(mixc(saturate(col, 0.5), BLACK, 0.5));
    g.strokeText(ch, cx, cy + rad * 0.06);
    g.fillStyle = '#fff'; g.fillText(ch, cx, cy + rad * 0.06);
  }
  // 玩具圖加飽和度和對比（像 Candy Crush 一樣鮮豔）；在方塊快取時做一次，之後每幀都是現成的圖
  const vividCache = new WeakMap();
  function vivid(src) {
    let c = vividCache.get(src);
    if (c) return c;
    const w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
    c = makeCanvas(w, h);
    const g = c.getContext('2d');
    g.drawImage(src, 0, 0);
    try {
      const d = g.getImageData(0, 0, w, h), a = d.data;
      // 暗色的玩具（像黑色的皮蛋）先把暗部提亮，臉和輪廓才看得清楚
      let sumL = 0, nL = 0;
      for (let i = 0; i < a.length; i += 16) if (a[i + 3] > 128) { sumL += 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2]; nL++; }
      const meanL = nL ? sumL / nL : 128, lift = meanL < 115 ? 0.72 + (meanL / 115) * 0.28 : 1;
      const lut = new Uint8ClampedArray(256);
      for (let v = 0; v < 256; v++) lut[v] = 255 * Math.pow(v / 255, lift);
      for (let i = 0; i < a.length; i += 4) {
        if (!a[i + 3]) continue;
        let r = lut[a[i]], gg = lut[a[i + 1]], b = lut[a[i + 2]];
        const l = 0.299 * r + 0.587 * gg + 0.114 * b;
        r = l + (r - l) * 1.12; gg = l + (gg - l) * 1.12; b = l + (b - l) * 1.12;   // 飽和度 ×1.12（素材已經公仔化、加過飽和）
        r = (r - 128) * 1.07 + 133; gg = (gg - 128) * 1.07 + 133; b = (b - 128) * 1.07 + 133;   // 對比、稍微提亮
        a[i] = r < 0 ? 0 : r > 255 ? 255 : r; a[i + 1] = gg < 0 ? 0 : gg > 255 ? 255 : gg; a[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
      }
      g.putImageData(d, 0, 0);
    } catch (e) { /* 讀不到像素（例如跨網域）就用原圖 */ }
    vividCache.set(src, c);
    return c;
  }
  // 亮度 × 對比（等於 CSS 的 filter: brightness() contrast()）。用像素算，不用 ctx.filter（舊的 Safari 不支援）
  function brighten(src, k, ct) {
    const w = src.width, h = src.height, c = makeCanvas(w, h), g = c.getContext('2d');
    g.drawImage(src, 0, 0);
    try {
      const d = g.getImageData(0, 0, w, h), a = d.data;
      for (let i = 0; i < a.length; i += 4) {
        if (!a[i + 3]) continue;
        for (let j = 0; j < 3; j++) { const v = (a[i + j] * k - 128) * ct + 128; a[i + j] = v < 0 ? 0 : v > 255 ? 255 : v; }
      }
      g.putImageData(d, 0, 0);
    } catch (e) { return src; }
    return c;
  }
  // 盤面上的玩具：沒白邊的版本，不描邊。外圍一圈糖果色的柔光、往右下的落影；
  // 玩具暗的地方帶一點糖果的顏色（被底下發光的糖果照到），和糖果像是同一個世界的東西
  const toyCache = new Map();
  function silhouette(src, color) {
    const c = makeCanvas(src.width, src.height), g = c.getContext('2d');
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = color; g.fillRect(0, 0, c.width, c.height);
    return c;
  }
  function embeddedToy(kind, im, box) {
    const key = kind + '|' + box;
    let c = toyCache.get(key);
    if (c) return c;
    let src = vivid(scaled(im, box));
    if (pieceInfo(kind).id === 'dog') src = brighten(src, 1.25, 1.1);   // 皮蛋是黑色的，放在深紫格子上再調亮一點
    const pad = Math.ceil(box * 0.16), W = src.width + pad * 2;
    c = makeCanvas(W, W);
    const g = c.getContext('2d'), col = kindColor(kind);
    // 外圍柔光：糖果色的亮色版（不是白色、也不是一條硬線），兩圈位置疊出往外淡掉的光（淡淡的就好，太亮玩具會像浮在糖果上）
    const glow = silhouette(src, css(mixc(saturate(col, 0.35), WHITE, 0.4)));
    // 愛心上的玩具（白色的史努比）：柔光幾乎不要 —— 白光疊在白毛外面，愛心的顏色會被洗掉、邊緣毛毛碎碎的；改靠下面更柔的落影陷進去
    const heart = shapeOf(kind) === 'heart';
    for (const [rr2, a] of heart ? [[box * 0.03, 0.02]] : [[box * 0.045, 0.05], [box * 0.024, 0.1]]) {
      g.globalAlpha = a;
      for (let k = 0; k < 16; k++) { const t = k / 16 * Math.PI * 2; g.drawImage(glow, pad + Math.cos(t) * rr2, pad + Math.sin(t) * rr2); }
    }
    g.globalAlpha = 1;
    // 貼紙白邊：玩偶照片外面一圈細細、柔柔的白色描邊（像高級貼紙），照片本身完全不改。
    // 做法：白色剪影往 16 個方向各偏一點疊起來（外圈再一層更淡的），落影也照「含白邊」的形狀算
    const sticker = makeCanvas(W, W), sq = sticker.getContext('2d'), white = silhouette(src, '#fff');
    const ow = Math.min(1.5 * dpr, Math.max(1, box * 0.02));     // 約 1.5px 的柔和白邊
    for (const [r2, a] of [[ow, 0.85], [ow * 0.5, 1]]) {
      sq.globalAlpha = a;
      for (let k = 0; k < 16; k++) { const t = k / 16 * Math.PI * 2; sq.drawImage(white, pad + Math.cos(t) * r2, pad + Math.sin(t) * r2); }
    }
    sq.globalAlpha = 1;
    // 落影：糖果色的深色版，往右下偏（光從左上來）。兩層：範圍大、很柔的影子（玩具像陷進糖果的凹槽裡）+ 貼著底部的接觸影
    // 柔邊用 shadowBlur（不用 ctx.filter，Safari 也一樣）：白邊圖畫在原位、影子往右下偏
    const shc = mixc(saturate(col, 0.5), [34, 16, 84], 0.74);
    const shadows = heart ? [[0.03, 0.085, 0.15, 0.62], [0.014, 0.04, 0.05, 0.4]] : [[0.022, 0.075, 0.1, 0.55], [0.012, 0.034, 0.032, 0.42]];
    for (const [ox2, oy2, blur, a] of shadows) {
      g.save();
      g.shadowColor = css(shc, a); g.shadowBlur = box * blur; g.shadowOffsetX = box * ox2; g.shadowOffsetY = box * oy2;
      g.drawImage(sticker, 0, 0);
      g.restore();
    }
    g.drawImage(sticker, 0, 0);
    // 玩具本身
    const lit = makeCanvas(src.width, src.height), lg = lit.getContext('2d');
    lg.drawImage(src, 0, 0);
    // 環境光：越暗的地方越帶糖果的顏色（不會有死灰）
    try {
      const d = lg.getImageData(0, 0, lit.width, lit.height), a = d.data, tc = mixc(saturate(col, 0.3), BLACK, 0.1);
      for (let i = 0; i < a.length; i += 4) {
        if (!a[i + 3]) continue;
        const l = (0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2]) / 255, k = 0.2 * (1 - l) * (1 - l);
        a[i] += (tc[0] - a[i]) * k; a[i + 1] += (tc[1] - a[i + 1]) * k; a[i + 2] += (tc[2] - a[i + 2]) * k;
      }
      lg.putImageData(d, 0, 0);
    } catch (e) { /* 讀不到像素就不調 */ }
    // 下半部反射一點糖果的顏色（像坐在發光的糖果上）
    lg.globalCompositeOperation = 'source-atop';
    const bg2 = lg.createLinearGradient(0, src.height * 0.5, 0, src.height);
    bg2.addColorStop(0, css(mixc(saturate(col, 0.5), WHITE, 0.3), 0)); bg2.addColorStop(1, css(mixc(saturate(col, 0.5), WHITE, 0.3), 0.24));
    lg.fillStyle = bg2; lg.fillRect(0, 0, src.width, src.height);
    g.drawImage(lit, pad, pad);     // 邊緣光、光澤已經做在圖裡（tools/postprocess.py 的 toyify）
    if (toyCache.size > 80) toyCache.clear();
    toyCache.set(key, c);
    return c;
  }
  // 選取時轉圈 / 彈跳用的圖也加同樣的貼紙白邊（整張旋轉序列一格一格加，白邊不會跨到隔壁格）；每張圖做一次
  const outlineCache = new WeakMap();
  function outlined(src, nx = 1, ny = 1) {
    let c = outlineCache.get(src);
    if (c) return c;
    const w = src.width, h = src.height, fw = w / nx, fh = h / ny, ow = Math.min(1.5 * dpr, Math.max(1, Math.min(fw, fh) * 0.016));
    c = makeCanvas(w, h);
    const g = c.getContext('2d'), white = silhouette(src, '#fff');
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      g.save();
      g.beginPath(); g.rect(i * fw, j * fh, fw, fh); g.clip();
      for (const [r2, a] of [[ow, 0.85], [ow * 0.5, 1]]) {
        g.globalAlpha = a;
        for (let k = 0; k < 16; k++) { const t = k / 16 * Math.PI * 2; g.drawImage(white, Math.cos(t) * r2, Math.sin(t) * r2); }
      }
      g.globalAlpha = 1;
      g.drawImage(src, 0, 0);
      g.restore();
    }
    outlineCache.set(src, c);
    return c;
  }
  // ---- 配件（衣櫃）：SVG 先載成圖，疊在實拍玩偶照片「上面」的透明圖層，照片本身不動 ----
  const accImgs = new Map();
  function accImg(name) {
    let im = accImgs.get(name);
    if (!im) {
      const svg = ACCESSORY_SVG[name];
      if (!svg) return null;
      // SVG 只有 viewBox 時，有的瀏覽器量不到圖的大小：補上 width / height（viewBox 的 4 倍，畫大一點也清楚）
      const vb = (svg.match(/viewBox="([\d.\s-]+)"/) || [])[1], [, , vw, vh] = (vb || '0 0 100 100').split(/\s+/).map(Number);
      im = new Image();
      im.decoding = 'async';
      im.src = svgUrl(svg.replace('<svg ', `<svg width="${vw * 4}" height="${vh * 4}" `));
      im.addEventListener('load', () => { if (!destroyed) { tileCache.clear(); accCache.clear(); requestDraw(); } }, { once: true });
      accImgs.set(name, im);
    }
    return im.complete && im.naturalWidth > 0 ? im : null;
  }
  // 配件畫在一張以「玩偶中心」為中心、邊長 box × 2 的透明小圖上（裝置像素）；照每隻玩偶的臉的位置 + 微調設定檔放
  const accCache = new Map();
  function accOverlay(kind, box) {
    const name = look.hat;
    if (!name || name === 'none') return null;
    const key = name + '|' + kind + '|' + box;
    if (accCache.has(key)) return accCache.get(key);
    const img = accImg(name), toy = toyImage(kind);
    if (!img || !toy) return null;
    const id = pieceInfo(kind).id, face = TOY_FACE[id] || { x: 0.5, top: 0.05, eyes: 0.4, cheeks: 0.55, w: 0.7 };
    const place = ACCESSORY_PLACE[name] || { anchor: 'top', size: 0.6, ay: 0.8, dx: 0 };
    const tune = Object.assign({ offsetX: 0, offsetY: 0, scale: 1 }, (ACCESSORY_TUNING[id] || {})[name]);
    const b = toyBounds(toy), n = box * 2, c = makeCanvas(n, n), g = c.getContext('2d');
    const bx0 = n / 2 - box / 2 + b.x0 * box, by0 = n / 2 - box / 2 + b.y0 * box, bw = (b.x1 - b.x0) * box, bh = (b.y1 - b.y0) * box;
    const fw = face.w * bw, aw = place.size * fw * tune.scale, ah = aw * natH(img) / Math.max(1, natW(img));
    const ax = bx0 + face.x * bw + place.dx * fw + tune.offsetX * bw;
    const ay = by0 + (face[place.anchor] != null ? face[place.anchor] : face.top) * bh - place.ay * ah + tune.offsetY * bh;
    g.save();
    if (name !== 'blush' && name !== 'halo') { g.shadowColor = 'rgba(60,20,80,0.32)'; g.shadowBlur = aw * 0.05; g.shadowOffsetY = aw * 0.03; }
    g.drawImage(img, ax - aw / 2, ay, aw, ah);
    g.restore();
    if (accCache.size > 60) accCache.clear();
    const out = { c, n };
    accCache.set(key, out);
    return out;
  }
  // 在 (tx, ty) 為中心、box 大小的玩偶上戴配件（g 是快取畫布，裝置像素）
  function paintAccessory(g, kind, tx, ty, box) {
    const a = accOverlay(kind, Math.round(box));
    if (a) g.drawImage(a.c, tx - a.n / 2, ty - a.n / 2);
  }
  function toyImage(kind) {
    const all = imgsFor(pieceInfo(kind).id);
    return usable(all.clean) ? all.clean : usable(all.sprite) ? all.sprite : null;
  }
  function paintSprite(g, kind, cx, cy, box) {
    const info = pieceInfo(kind), all = imgsFor(info.id);
    if (usable(all.clean)) {
      const c = embeddedToy(kind, all.clean, Math.round(box));
      g.drawImage(c, cx - c.width / 2, cy - c.height / 2);
      return;
    }
    const im = all.sprite;
    if (usable(im)) { g.drawImage(vivid(scaled(im, box)), cx - Math.round(box) / 2, cy - Math.round(box) / 2); return; }
    paintFallback(g, info, cx, cy, box);
  }
  // 玩具圖裡不透明部分的範圍（0–1）：照玩具「實際的大小」塞進糖果，而不是照圖框
  const boundsCache = new WeakMap();
  function toyBounds(img) {
    let b = boundsCache.get(img);
    if (b) return b;
    b = { x0: 0.05, y0: 0.05, x1: 0.95, y1: 0.95 };
    try {
      const n = 96, c = makeCanvas(n, n), g = c.getContext('2d'), w = natW(img), h = natH(img), k = n / Math.max(w, h);
      g.drawImage(img, (n - w * k) / 2, (n - h * k) / 2, w * k, h * k);
      const a = g.getImageData(0, 0, n, n).data;
      let x0 = n, y0 = n, x1 = -1, y1 = -1;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        if (a[(y * n + x) * 4 + 3] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
      if (x1 >= x0) b = { x0: x0 / n, y0: y0 / n, x1: (x1 + 1) / n, y1: (y1 + 1) / n };
    } catch (e) { /* 讀不到像素就用預設範圍 */ }
    boundsCache.set(img, b);
    return b;
  }
  // 玩具要多大：照片裡不透明部分最長的那邊 = 一格的 TOY_CELL（約 78%），置中在底座上（愛心的玩偶放高一點，
  // 下面露出圓圓的糖尖）。回傳以「格」為單位的 { box, dx, dy }（box = 整張圖的邊長）
  const fitCache = new Map();
  function toyFit(kind, im) {
    let f = fitCache.get(kind);
    if (f && f.im === im) return f;
    const b = toyBounds(im), span = Math.max(0.05, b.x1 - b.x0, b.y1 - b.y0), box = TOY_CELL / span;
    const lift = shapeOf(kind) === 'heart' ? -0.05 : 0;
    f = { im, box, dx: (0.5 - (b.x0 + b.x1) / 2) * box, dy: (0.5 - (b.y0 + b.y1) / 2) * box + lift };
    fitCache.set(kind, f);
    return f;
  }
  // 玩具在糖果裡的大小和位置（像素）
  function toyLayout(kind, special, S) {
    const k = special === 'wrap' ? 0.86 : special === 'h' || special === 'v' ? 0.9 : 1, im = toyImage(kind);
    if (!im) return { box: Math.round(S * 0.72 * k), dx: 0, dy: 0 };
    const f = toyFit(kind, im);
    return { box: Math.round(S * f.box * k), dx: f.dx * S * k, dy: f.dy * S * k };
  }
  // 條紋糖果：玩具身上也印淡淡的條紋（只印在玩具上，不印在影子上）
  function paintToyStripes(g, kind, tx, ty, box, x, y, T, dir) {
    const im = toyImage(kind);
    if (!im) return;
    const c = makeCanvas(box, box), q = c.getContext('2d');
    q.fillStyle = 'rgba(255,255,255,0.42)';   // 改版 2026-11：0.32 → 0.42，蛋形這種窄的方塊直條紋才看得出來
    q.translate(box / 2 - tx, box / 2 - ty);
    paintStripes(q, x, y, T, dir);
    q.setTransform(1, 0, 0, 1, 0, 0);
    q.globalCompositeOperation = 'destination-in';
    q.drawImage(scaled(im, box), 0, 0);
    g.drawImage(c, tx - box / 2, ty - box / 2);
  }
  function paintStripes(g, x, y, T, dir) {
    const n = 4, band = T * 0.125, step = T / n;   // 改版 2026-11：從 0.105 加粗，縮小後還看得到
    for (let i = 0; i < n; i++) {
      const o = step * (i + 0.5) - band / 2;
      if (dir === 'h') g.fillRect(x - T, y + o, T * 3, band);
      else g.fillRect(x + o, y - T, band, T * 3);
    }
  }
  const SHAPE_OF = { dog: 'ball', sloth: 'square', egg: 'egg', piggy: 'flower', nyanko: 'hex', moodeng: 'bean', snoopy: 'heart' };   // 顏色在 pieces.js
  const SHAPE_CYCLE = ['ball', 'square', 'egg', 'flower', 'hex', 'bean', 'heart'];
  function shapeOf(kind) { const id = pieceInfo(kind).id; return SHAPE_OF[id] || SHAPE_CYCLE[((kind % 7) + 7) % 7]; }
  const CANDY_R = 0.42;     // 糖果半徑 / 格（改版 2026-11：底座約一格的 84%，格子的深淺交錯露得出來）
  const TOY_CELL = 0.66;    // 玩偶（照片裡不透明的部分）最長的那邊 = 一格的 66%
  // 立體糖果（像 Candy Crush）：光從左上來 → 左上亮、右下暗；壓在盤面上的落影；玩具在裡面，上面再蓋反光
  function paintCandy(g, kind, cx, cy, S, col, special) {
    const shape = shapeOf(kind), R = S * CANDY_R;
    const sat = saturate(col, 0.12), dark = saturate(col, 0.3);
    const deep = mixc(dark, BLACK, 0.55), deeper = mixc(dark, [26, 10, 64], 0.7);
    // 落影三層（深藍紫色、半透明，光從左上來所以都往右下）：
    //   1. 範圍大、很柔的落影，壓在格子的凹槽裡   2. 貼著底部的接觸陰影（糖果的重量）
    //   3. 四周一圈很窄的暗（環境光遮蔽）：糖果像重重地壓進格子裡，不是平平地懸空貼在上面
    // （淺色毛玻璃盤面：影子用主題的淡紫玫瑰色、淡一點，不會在白底上變成髒髒的黑圈）
    const shc = BOARD_THEME.shadow || [110, 60, 140];
    g.save();
    g.shadowColor = css(shc, 0.42); g.shadowBlur = S * 0.11; g.shadowOffsetX = S * 0.05; g.shadowOffsetY = S * 0.09;
    candyPath(g, shape, cx, cy, R * 1.04); g.fillStyle = css(deep); g.fill();
    g.restore();
    g.save();
    g.shadowColor = css(mixc(shc, BLACK, 0.3), 0.45); g.shadowBlur = S * 0.035; g.shadowOffsetX = S * 0.018; g.shadowOffsetY = S * 0.045;
    candyPath(g, shape, cx, cy, R * 1.05); g.fillStyle = css(deep); g.fill();
    g.restore();
    g.save();
    g.shadowColor = css(shc, 0.22); g.shadowBlur = S * 0.05; g.shadowOffsetX = S * 0.006; g.shadowOffsetY = S * 0.012;
    candyPath(g, shape, cx, cy, R * 1.06); g.fillStyle = css(deep); g.fill();
    g.restore();
    // 壓克力 / 果凍的厚度：往下錯開一點的深色底，露出底部一圈柔和的厚邊
    {
      const ty = S * 0.04, tg = g.createLinearGradient(0, cy, 0, cy + R + ty);
      tg.addColorStop(0, css(mixc(dark, BLACK, 0.35))); tg.addColorStop(1, css(deeper));
      candyPath(g, shape, cx, cy + ty, R * 1.05); g.fillStyle = tg; g.fill();
    }
    if (shape === 'heart') {
      // 愛心外面一圈柔柔的光暈（沒有硬邊線，在深色的盤面上看得出是一顆飽滿、發亮的愛心糖）
      g.save();
      g.shadowColor = css(mixc(saturate(col, 0.3), WHITE, 0.55), 0.6); g.shadowBlur = R * 0.22;
      candyPath(g, shape, cx, cy, R * 1.04); g.fillStyle = css(deep); g.fill();
      g.restore();
    }
    // 外框：左上受光的地方淺一點、右下背光的地方深
    const og = g.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    og.addColorStop(0, css(mixc(dark, BLACK, 0.28))); og.addColorStop(1, css(deeper));
    candyPath(g, shape, cx, cy, R * 1.06); g.fillStyle = og; g.fill();
    // 糖果面：整片都是飽和的糖果色（玩具蓋住中間，露出來的那圈一眼就看得出顏色），中間亮一點
    const rg = g.createRadialGradient(cx - R * 0.3, cy - R * 0.4, R * 0.04, cx, cy, R * 1.12);
    rg.addColorStop(0, css(mixc(sat, WHITE, 0.5)));
    rg.addColorStop(0.35, css(mixc(sat, WHITE, 0.1)));
    rg.addColorStop(0.72, css(sat));
    rg.addColorStop(1, css(mixc(dark, BLACK, 0.2)));
    candyPath(g, shape, cx, cy, R); g.fillStyle = rg; g.fill();
    g.save();
    candyPath(g, shape, cx, cy, R); g.clip();
    if (shape === 'heart') paintHeartPuff(g, cx, cy, R, col);   // 愛心：枕頭狀的明暗
    // 暗部：右下角淡淡地深一點（用自己顏色的深色版，不是灰黑）
    const dg = g.createLinearGradient(cx - R * 0.6, cy - R * 0.7, cx + R * 0.8, cy + R);
    dg.addColorStop(0, css(deeper, 0)); dg.addColorStop(0.55, css(deeper, 0)); dg.addColorStop(1, css(deeper, 0.32));
    g.fillStyle = dg; g.fillRect(cx - R * 1.3, cy - R * 1.3, R * 2.6, R * 2.6);
    // 透光：光從玻璃底部透上來，下半部裡面亮一團（不碰到邊，邊緣保持暗）
    if (shape !== 'heart') {   // 愛心的糖尖自己有透光（paintHeartPuff）
      const cg = g.createRadialGradient(cx + R * 0.05, cy + R * 0.58, 0, cx + R * 0.05, cy + R * 0.58, R * 0.5);
      cg.addColorStop(0, css(mixc(sat, WHITE, 0.55), 0.55)); cg.addColorStop(1, css(sat, 0));
      g.fillStyle = cg; g.fillRect(cx - R, cy, R * 2, R * 1.3);
    }
    if (shape !== 'heart') {
      // 果凍邊：貼著外緣一圈粗粗的、很飽和的糖果色（左上受光比較亮、右下比較濃），玩具放大也蓋不掉
      candyPath(g, shape, cx, cy, R);
      const jg = g.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
      jg.addColorStop(0, css(mixc(sat, WHITE, 0.3))); jg.addColorStop(0.45, css(sat)); jg.addColorStop(1, css(mixc(dark, BLACK, 0.22)));
      g.lineWidth = R * 0.34; g.strokeStyle = jg; g.stroke();
      // 果凍邊內側一條細細的亮線（左上最亮），邊才有「果凍」的厚度
      candyPath(g, shape, cx, cy, R * 0.84);
      const lg = g.createLinearGradient(cx - R, cy - R, cx + R * 0.4, cy + R * 0.4);
      lg.addColorStop(0, 'rgba(255,255,255,0.75)'); lg.addColorStop(0.5, 'rgba(255,255,255,0.18)'); lg.addColorStop(1, 'rgba(255,255,255,0)');
      g.lineWidth = Math.max(1, R * 0.05); g.strokeStyle = lg; g.stroke();
    }
    if (special === 'h' || special === 'v') {
      // 改版 2026-11：粗白條紋畫在果凍邊上面（以前被果凍邊和玩偶蓋掉，縮小後看不出來）。橫條紋＝整排消除，直條紋＝整行消除
      g.fillStyle = 'rgba(255,255,255,0.93)';
      paintStripes(g, cx - R, cy - R, R * 2, special);
      const sd = g.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
      sd.addColorStop(0, css(deeper, 0)); sd.addColorStop(0.6, css(deeper, 0)); sd.addColorStop(1, css(deeper, 0.22));
      g.fillStyle = sd; g.fillRect(cx - R * 1.3, cy - R * 1.3, R * 2.6, R * 2.6);
    }
    // 最外緣一圈暗邊（輪廓清楚）：右下深、左上淡
    candyPath(g, shape, cx, cy, R);
    const eg = g.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    eg.addColorStop(0, css(deeper, 0.18)); eg.addColorStop(0.5, css(deeper, 0.35)); eg.addColorStop(1, css(deeper, 0.75));
    g.lineWidth = R * 0.07; g.strokeStyle = eg; g.stroke();
    if (shape === 'heart') {
      // 愛心最外緣裡面一圈發光的亮邊：左上幾乎是白的、右下帶一點糖果色，邊緣像膨起來、很光滑的軟糖
      const pk = mixc(saturate(col, 0.3), WHITE, 0.7), pg = g.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
      pg.addColorStop(0, 'rgba(255,255,255,0.95)'); pg.addColorStop(0.5, css(pk, 0.7)); pg.addColorStop(1, css(pk, 0.5));
      g.save();
      g.shadowColor = css(pk, 0.9); g.shadowBlur = R * 0.1;
      candyPath(g, shape, cx, cy, R * 0.93);
      g.lineWidth = R * 0.05; g.strokeStyle = pg; g.stroke();
      g.restore();
    }
    g.restore();
    if (special === 'h' || special === 'v') {
      // 條紋糖果外面一圈白邊
      candyPath(g, shape, cx, cy, R * 1.03);
      g.lineWidth = R * 0.075; g.strokeStyle = 'rgba(255,255,255,0.95)'; g.stroke();
    }
    if (special === 'wrap') paintWrapFrame(g, k => candyPath(g, shape, cx, cy, R * k), R);
  }
  // 包裝糖：白色粗外框，外面再一圈橘色細邊（改版 2026-11，照草稿；以前是一圈白色小點）
  function paintWrapFrame(g, path, R) {
    g.save();
    g.lineJoin = 'round';
    g.shadowColor = 'rgba(255,150,40,0.85)'; g.shadowBlur = R * 0.12;
    path(1.11); g.lineWidth = R * 0.08; g.strokeStyle = '#ff7a12'; g.stroke();
    g.shadowColor = 'transparent';
    path(1.0); g.lineWidth = R * 0.17; g.strokeStyle = '#fff'; g.stroke();
    path(0.915); g.lineWidth = Math.max(1, R * 0.025); g.strokeStyle = 'rgba(255,170,90,0.55)'; g.stroke();
    g.restore();
  }
  // 愛心的「枕頭」明暗：不用一圈一圈的同心邊線（看起來像扁平貼紙），改成中間鼓起來、往邊緣柔柔地變深的軟糖
  // （已經在 candyPath 的 clip 裡面）
  function paintHeartPuff(g, cx, cy, R, col) {
    const far = R * 40;
    // 愛心的顏色比別的糖果濃一階（淺色的天空藍露出來的面積小，太淡會像玻璃、不像糖）
    const body = mixc(saturate(col, 0.45), BLACK, 0.08), edge = mixc(body, [22, 14, 70], 0.52), puff = mixc(body, WHITE, 0.22);
    // 整片：中間是飽和的糖果色，往外緣圓滑地變深
    candyPath(g, 'heart', cx, cy, R);
    const eg = g.createRadialGradient(cx - R * 0.12, cy - R * 0.16, R * 0.3, cx, cy, R * 1.1);
    eg.addColorStop(0, css(body)); eg.addColorStop(0.58, css(body)); eg.addColorStop(0.84, css(mixc(body, edge, 0.6))); eg.addColorStop(1, css(edge));
    g.fillStyle = eg; g.fill();
    // 一顆模糊、縮小、往左上偏的亮色愛心 → 中間鼓起來（用 shadowBlur 做柔邊：形狀畫在畫面外，只有影子落回來）
    g.save();
    g.shadowColor = css(puff, 0.75); g.shadowBlur = R * 0.24; g.shadowOffsetX = far - R * 0.07; g.shadowOffsetY = -R * 0.1;
    candyPath(g, 'heart', cx - far, cy, R * 0.66); g.fillStyle = '#000'; g.fill();
    g.restore();
    // 玩具坐的地方往下凹一點（玩具周圍一圈柔柔的暗，像陷進軟糖的凹槽）
    const ay = cy + R * 0.16, ao = g.createRadialGradient(cx + R * 0.04, ay, R * 0.22, cx + R * 0.04, ay, R * 0.8);
    ao.addColorStop(0, css(edge, 0.38)); ao.addColorStop(0.68, css(edge, 0.14)); ao.addColorStop(1, css(edge, 0));
    g.fillStyle = ao; g.fillRect(cx - R * 1.2, cy - R * 1.2, R * 2.4, R * 2.4);
    // 下面圓圓的糖尖：裡面透一點光（軟糖被光穿透），讓露出來的那塊也是鼓鼓的
    const ty = cy + (HEART.t + HEART.dy) * R, tg = g.createRadialGradient(cx + R * 0.03, ty + R * 0.02, 0, cx + R * 0.03, ty + R * 0.02, R * 0.32);
    tg.addColorStop(0, css(puff, 0.5)); tg.addColorStop(1, css(puff, 0));
    g.fillStyle = tg; g.fillRect(cx - R * 0.5, ty - R * 0.4, R, R * 0.8);
  }
  function paintCandyGloss(g, kind, cx, cy, S) {
    const shape = shapeOf(kind), R = S * CANDY_R, col = kindColor(kind);
    // 左上的月牙形反光：只在果凍邊那一圈（中間挖掉到 0.8 倍），不會橫過玩具的臉
    const hl = makeCanvas(g.canvas.width, g.canvas.height), q = hl.getContext('2d');
    q.save();
    candyPath(q, shape, cx, cy, R); q.clip();
    q.translate(cx - R * 0.34, cy - R * 0.5); q.rotate(-0.62);
    const hg = q.createLinearGradient(0, -R * 0.4, 0, R * 0.32), ha = shape === 'heart' ? 0.45 : 1;   // 愛心露出來的面積小，大片反光會把顏色刷白（兩瓣另外有反光）
    hg.addColorStop(0, `rgba(255,255,255,${0.8 * ha})`); hg.addColorStop(0.5, `rgba(255,255,255,${0.32 * ha})`); hg.addColorStop(1, 'rgba(255,255,255,0)');
    q.beginPath(); q.ellipse(0, 0, R * 0.78, R * 0.4, 0, 0, Math.PI * 2); q.fillStyle = hg; q.fill();
    if (shape === 'heart') {
      // 愛心的兩個瓣各一塊順著圓弧的反光（右瓣背光、淡一點），看起來像膨起來的軟糖
      q.setTransform(1, 0, 0, 1, 0, 0);
      const H = HEART, ly = cy + (H.b + H.dy) * R;
      for (const [sx, a] of [[-1, 0.92], [1, 0.55]]) {
        q.save();
        q.translate(cx + sx * (H.a + H.r * 0.44) * R, ly - H.r * 0.44 * R); q.rotate(sx * 0.785);
        const lg2 = q.createLinearGradient(0, -R * 0.14, 0, R * 0.12);
        lg2.addColorStop(0, `rgba(255,255,255,${a})`); lg2.addColorStop(1, 'rgba(255,255,255,0)');
        q.beginPath(); q.ellipse(0, 0, R * 0.3, R * 0.13, 0, 0, Math.PI * 2); q.fillStyle = lg2; q.fill();
        q.restore();
      }
    }
    q.restore();
    q.globalCompositeOperation = 'destination-out';
    const ix = cx + R * 0.06, iy = cy + R * 0.08, cut = q.createRadialGradient(ix, iy, 0, ix, iy, R * 0.94);
    cut.addColorStop(0, 'rgba(0,0,0,1)'); cut.addColorStop(0.84, 'rgba(0,0,0,1)'); cut.addColorStop(1, 'rgba(0,0,0,0)');
    q.fillStyle = cut; q.fillRect(cx - R * 1.2, cy - R * 1.2, R * 2.4, R * 2.4);
    g.drawImage(hl, 0, 0);
    g.save();
    candyPath(g, shape, cx, cy, R); g.clip();
    // 右下：玻璃內側一道很細的折射光（在果凍邊上，最外緣保持暗）
    candyPath(g, shape, cx, cy, R * 0.9);
    const lc = mixc(saturate(col, 0.4), WHITE, 0.55), rl = g.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    rl.addColorStop(0, css(lc, 0)); rl.addColorStop(0.7, css(lc, 0)); rl.addColorStop(1, css(lc, shape === 'heart' ? 0.2 : 0.45));
    g.lineWidth = R * 0.06; g.strokeStyle = rl; g.stroke();
    // 頂部一片淡淡的弧形高光（壓克力 / 扭蛋殼的反光），薄薄地蓋過玩具的頭頂，玩具像是在同一顆糖果裡面
    if (shape !== 'heart') {
      const ag = g.createLinearGradient(0, cy - R, 0, cy - R * 0.25);
      ag.addColorStop(0, 'rgba(255,255,255,0.36)'); ag.addColorStop(0.6, 'rgba(255,255,255,0.1)'); ag.addColorStop(1, 'rgba(255,255,255,0)');
      g.beginPath(); g.ellipse(cx - R * 0.04, cy - R * 0.72, R * 0.92, R * 0.48, 0, Math.PI, Math.PI * 2);
      g.ellipse(cx - R * 0.04, cy - R * 0.72, R * 0.92, R * 0.18, 0, 0, Math.PI);
      g.fillStyle = ag; g.fill();
    }
    g.restore();
    // 亮點：也放在左上的邊上
    g.beginPath(); g.arc(cx - R * 0.6, cy - R * 0.58, R * 0.075, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,255,255,0.95)'; g.fill();
    g.beginPath(); g.arc(cx - R * 0.36, cy - R * 0.76, R * 0.04, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.fill();
  }
  // 液態玻璃糖果：有厚度的側邊、中間亮邊緣濃的玻璃面、底部透光、內圈亮邊（玩具上面再蓋一層反光，見 paintGlassOverlay）
  function paintTileBody(g, cx, cy, S, col, special) {
    const T = S * TILE, x = cx - T / 2, y = cy - T / 2, rad = T * 0.3;
    const sat = saturate(col, 0.38), deep = mixc(saturate(col, 0.6), BLACK, 0.48);
    const D = S * 0.065;                                   // 厚度
    // 投影 + 側邊（糖果的厚度）
    g.save();
    g.shadowColor = 'rgba(25,5,55,0.55)'; g.shadowBlur = S * 0.09; g.shadowOffsetY = S * 0.07;
    rr(g, x, y + D, T, T, rad); g.fillStyle = css(deep); g.fill();
    g.restore();
    const sw = g.createLinearGradient(0, y + T * 0.6, 0, y + T + D);
    sw.addColorStop(0, css(mixc(sat, BLACK, 0.18))); sw.addColorStop(1, css(deep));
    rr(g, x, y + D * 0.55, T, T, rad); g.fillStyle = sw; g.fill();
    // 玻璃面：中間亮、邊緣顏色濃（越厚的地方顏色越深）
    const rg = g.createRadialGradient(cx - T * 0.06, cy - T * 0.1, T * 0.04, cx, cy, T * 0.74);
    rg.addColorStop(0, css(mixc(sat, WHITE, 0.58)));
    rg.addColorStop(0.42, css(mixc(sat, WHITE, 0.16)));
    rg.addColorStop(0.78, css(sat));
    rg.addColorStop(1, css(mixc(saturate(col, 0.55), BLACK, 0.26)));
    rr(g, x, y, T, T, rad); g.fillStyle = rg; g.fill();
    g.save();
    rr(g, x, y, T, T, rad); g.clip();
    if (special === 'h' || special === 'v') {
      g.fillStyle = 'rgba(255,255,255,0.82)';
      paintStripes(g, x, y, T, special);
    }
    // 底部透光：一團比較亮的顏色（光從玻璃底下透上來）
    const cg = g.createRadialGradient(cx, y + T * 1.04, 0, cx, y + T * 1.04, T * 0.6);
    cg.addColorStop(0, css(mixc(sat, WHITE, 0.62), 0.85)); cg.addColorStop(0.6, css(mixc(sat, WHITE, 0.4), 0.3)); cg.addColorStop(1, css(sat, 0));
    g.fillStyle = cg; g.fillRect(x, y + T * 0.4, T, T * 0.6);
    g.restore();
    // 內圈亮邊：左上白、右下帶顏色的亮光（玻璃的折射邊）
    const ins = S * 0.024;
    rr(g, x + ins, y + ins, T - ins * 2, T - ins * 2, rad * 0.9);
    const rim = g.createLinearGradient(x, y, x + T, y + T);
    rim.addColorStop(0, 'rgba(255,255,255,0.95)'); rim.addColorStop(0.4, 'rgba(255,255,255,0.18)');
    rim.addColorStop(0.7, 'rgba(255,255,255,0.06)'); rim.addColorStop(1, css(mixc(sat, WHITE, 0.72), 0.9));
    g.lineWidth = Math.max(1, S * 0.03); g.strokeStyle = rim; g.stroke();
    // 外框：深色細線，輪廓清楚
    rr(g, x, y, T, T, rad);
    g.lineWidth = Math.max(1, S * 0.022); g.strokeStyle = css(mixc(saturate(col, 0.5), BLACK, 0.52), 0.9); g.stroke();
    if (special === 'wrap') {
      // 糖果紙：一圈白點點
      rr(g, x + T * 0.09, y + T * 0.09, T * 0.82, T * 0.82, rad * 0.7);
      g.save();
      g.setLineDash([0.001, T * 0.135]); g.lineCap = 'round';
      g.lineWidth = T * 0.075; g.strokeStyle = 'rgba(255,255,255,0.92)'; g.stroke();
      g.restore();
    }
  }
  // 玩具上面的玻璃反光：上半部一片弧形亮面 + 亮點，讓玩具看起來在玻璃裡面
  function paintGlassOverlay(g, cx, cy, S) {
    const T = S * TILE, x = cx - T / 2, y = cy - T / 2, rad = T * 0.3;
    g.save();
    rr(g, x, y, T, T, rad); g.clip();
    g.beginPath();
    g.moveTo(x, y + T * 0.44);
    g.bezierCurveTo(x + T * 0.28, y + T * 0.33, x + T * 0.72, y + T * 0.33, x + T, y + T * 0.4);
    g.lineTo(x + T, y); g.lineTo(x, y); g.closePath();
    const hg = g.createLinearGradient(0, y, 0, y + T * 0.44);
    hg.addColorStop(0, 'rgba(255,255,255,0.5)'); hg.addColorStop(0.55, 'rgba(255,255,255,0.16)'); hg.addColorStop(1, 'rgba(255,255,255,0.02)');
    g.fillStyle = hg; g.fill();
    g.restore();
    g.beginPath(); g.arc(x + T * 0.2, y + T * 0.17, T * 0.052, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,255,255,0.98)'; g.fill();
    g.beginPath(); g.arc(x + T * 0.31, y + T * 0.12, T * 0.024, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,255,255,0.9)'; g.fill();
    // 右下小小的反光
    g.beginPath(); g.ellipse(x + T * 0.8, y + T * 0.82, T * 0.07, T * 0.03, -0.6, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,255,255,0.5)'; g.fill();
  }
  // 條紋糖果兩側的箭頭：金色玻璃（上亮下深）+ 外發光 + 亮點，像寶石，不是平面的白色三角形
  function arrowTips(cx, cy, S, dir) {
    const T = S * TILE, a = T * 0.19, off = T * 0.5 + a * 0.2;
    return (dir === 'h' ? [[-1, 0], [1, 0]] : [[0, -1], [0, 1]]).map(([dx, dy]) => {
      const tx = cx + dx * off, ty = cy + dy * off, bx = tx - dx * a * 1.2, by = ty - dy * a * 1.2, px = -dy, py = dx;
      return { a, tri: [[tx, ty], [bx + px * a, by + py * a], [bx - px * a, by - py * a]] };
    });
  }
  function paintArrows(g, cx, cy, S, dir) {
    g.lineJoin = 'round';
    for (const { a, tri } of arrowTips(cx, cy, S, dir)) {
      const path = () => { g.beginPath(); roundedPoly(g, tri, a * 0.3); };
      const ys = tri.map(p => p[1]), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const mx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3, my = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
      g.save();
      g.shadowColor = 'rgba(255,190,30,0.95)'; g.shadowBlur = S * 0.1;
      path(); g.fillStyle = '#ffc928'; g.fill();
      g.restore();
      const body = g.createLinearGradient(0, y0, 0, y1);
      body.addColorStop(0, '#fffbe2'); body.addColorStop(0.42, '#ffd845'); body.addColorStop(1, '#f08400');
      path(); g.fillStyle = body; g.fill();
      g.lineWidth = Math.max(1, S * 0.024); g.strokeStyle = '#a24a06'; g.stroke();
      // 上半部的玻璃亮面
      g.save();
      path(); g.clip();
      const sh = g.createLinearGradient(0, my - a * 0.7, 0, my + a * 0.1);
      sh.addColorStop(0, 'rgba(255,255,255,0.95)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
      g.beginPath(); g.ellipse(mx, my - a * 0.3, a * 0.55, a * 0.3, 0, 0, Math.PI * 2); g.fillStyle = sh; g.fill();
      g.restore();
    }
  }
  // 包裝糖兩側的糖果紙（改版 2026-11：從跟方塊同色的小耳朵改成白色大耳朵，露在糖果外面約格寬三成，橘色細邊）
  function paintWrapEnds(g, cx, cy, S, col) {
    const edge = '#ff7a12', fold = 'rgba(235,160,195,0.75)';
    g.lineJoin = 'round'; g.lineCap = 'round';
    for (const s of [-1, 1]) {
      const x0 = cx + s * S * 0.3, xn = cx + s * S * 0.45, x1 = cx + s * S * 0.67, h = S * 0.3, nk = S * 0.085;
      const ear = () => {
        g.beginPath();
        g.moveTo(x0, cy - nk * 1.2);
        g.lineTo(xn, cy - nk);
        g.quadraticCurveTo(lerp(xn, x1, 0.4), cy - nk * 1.3, x1, cy - h);
        g.quadraticCurveTo(x1 - s * S * 0.07, cy - h * 0.3, x1 - s * S * 0.03, cy);
        g.quadraticCurveTo(x1 - s * S * 0.07, cy + h * 0.3, x1, cy + h);
        g.quadraticCurveTo(lerp(xn, x1, 0.4), cy + nk * 1.3, xn, cy + nk);
        g.lineTo(x0, cy + nk * 1.2);
        g.closePath();
      };
      // 橘色的柔光（在深色盤面上把白耳朵框出來）
      g.save();
      g.shadowColor = 'rgba(255,140,40,0.9)'; g.shadowBlur = S * 0.05;
      ear(); g.fillStyle = '#fff'; g.fill();
      g.restore();
      // 白色的紙：上面亮、下面帶一點粉，看得出是捏起來的
      const gr = g.createLinearGradient(0, cy - h, 0, cy + h);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.55, '#fff6fa'); gr.addColorStop(1, '#f6dce8');
      ear(); g.fillStyle = gr; g.fill();
      g.lineWidth = S * 0.026; g.strokeStyle = edge; g.stroke();
      // 皺褶：從結往外散開
      g.lineWidth = S * 0.016; g.strokeStyle = fold;
      for (const k of [-0.62, -0.22, 0.22, 0.62]) {
        g.beginPath(); g.moveTo(lerp(xn, x1, 0.18), cy + k * nk); g.lineTo(lerp(xn, x1, 0.86), cy + k * h * 0.92); g.stroke();
      }
      // 結：白色小方塊，橘邊
      rr(g, xn - S * 0.04, cy - S * 0.12, S * 0.08, S * 0.24, S * 0.035);
      g.fillStyle = '#fff'; g.fill();
      g.lineWidth = S * 0.022; g.strokeStyle = edge; g.stroke();
    }
  }
  function paintCellophane(g, cx, cy, S) {
    const T = S * TILE, x = cx - T / 2, y = cy - T / 2;
    g.save();
    rr(g, x, y, T, T, T * 0.27); g.clip();
    g.translate(cx, cy); g.rotate(-0.7);
    const gr = g.createLinearGradient(0, -T * 0.32, 0, -T * 0.08);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.32)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(-T, -T * 0.32, T * 2, T * 0.24);
    g.restore();
  }
  // ---- 方塊底座（衣櫃）：果凍（預設，paintCandy）/ 透明扭蛋球 / 酥脆餅乾 / 花瓣 ----
  // 底座的外形（條紋的亮帶、包裝的白點圈要沿著它走）
  function bodyPath(g, kind, cx, cy, R) {
    const f = look.frame;
    if (!f || f === 'jelly') { candyPath(g, shapeOf(kind), cx, cy, R); return; }
    g.beginPath();
    if (f === 'cookie') {
      const N = 72;
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2, r0 = R * (1 + 0.04 * Math.cos(a * 14));
        if (i) g.lineTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); else g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      }
      g.closePath();
    } else if (f === 'petal') {
      for (let k = 0; k < 6; k++) {
        const a = k * Math.PI / 3 - Math.PI / 2, x = cx + Math.cos(a) * R * 0.56, y = cy + Math.sin(a) * R * 0.56;
        g.moveTo(x + R * 0.44, y); g.arc(x, y, R * 0.44, 0, Math.PI * 2);
      }
      g.moveTo(cx + R * 0.62, cy); g.arc(cx, cy, R * 0.62, 0, Math.PI * 2);
    } else {
      g.arc(cx, cy, R, 0, Math.PI * 2);
    }
  }
  function paintAltBase(g, kind, cx, cy, S, col, special) {
    const f = look.frame, R = S * CANDY_R * 1.02, shc = BOARD_THEME.shadow || [110, 60, 140];
    const sat = saturate(col, 0.25), dark = saturate(col, 0.4), deep = mixc(dark, BLACK, 0.5);
    // 落影（主題的顏色）
    g.save();
    g.shadowColor = css(shc, 0.4); g.shadowBlur = S * 0.1; g.shadowOffsetX = S * 0.045; g.shadowOffsetY = S * 0.085;
    bodyPath(g, kind, cx, cy, R); g.fillStyle = css(deep); g.fill();
    g.restore();
    if (f === 'capsule') {
      // 透明扭蛋球：下半顆是糖果色的殼、上半顆是透明的罩子（玩偶在裡面），中間一圈白色的接縫
      const sh = g.createRadialGradient(cx - R * 0.3, cy + R * 0.1, R * 0.1, cx, cy + R * 0.2, R * 1.1);
      sh.addColorStop(0, css(mixc(sat, WHITE, 0.45))); sh.addColorStop(0.6, css(sat)); sh.addColorStop(1, css(mixc(dark, BLACK, 0.25)));
      g.save();
      g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.clip();
      g.fillStyle = css(mixc(sat, WHITE, 0.82), 0.55); g.fillRect(cx - R, cy - R, R * 2, R * 2);     // 上半：霧霧的透明罩
      g.fillStyle = sh; g.fillRect(cx - R, cy + R * 0.02, R * 2, R);                               // 下半：糖果色的殼
      if (special === 'h' || special === 'v') { g.fillStyle = 'rgba(255,255,255,0.8)'; paintStripes(g, cx - R, cy - R, R * 2, special); }
      const seam = g.createLinearGradient(0, cy - R * 0.05, 0, cy + R * 0.1);
      seam.addColorStop(0, '#ffffff'); seam.addColorStop(1, '#d9dbe8');
      g.fillStyle = seam; g.fillRect(cx - R, cy - R * 0.04, R * 2, R * 0.12);
      g.restore();
      g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2);
      g.lineWidth = R * 0.06; g.strokeStyle = css(mixc(dark, BLACK, 0.3), 0.7); g.stroke();
    } else if (f === 'cookie') {
      // 酥脆餅乾：烤得金黃的圓餅乾（下面一點厚度）、表面小洞，一圈糖果色的糖霜（一眼看得出顏色）
      g.save(); g.translate(0, S * 0.035); bodyPath(g, kind, cx, cy, R); g.fillStyle = '#9a5a1c'; g.fill(); g.restore();
      const cg = g.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.1, cx, cy, R * 1.05);
      cg.addColorStop(0, '#f9dba4'); cg.addColorStop(0.6, '#e4aa5c'); cg.addColorStop(1, '#b8742c');
      bodyPath(g, kind, cx, cy, R); g.fillStyle = cg; g.fill();
      g.lineWidth = R * 0.05; g.strokeStyle = '#9a5a1c'; g.stroke();
      const rnd = mulberry(77 + kind);
      g.fillStyle = 'rgba(130,70,18,0.75)';
      for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2 + rnd() * 0.3, rr0 = R * (0.86 + rnd() * 0.06); g.beginPath(); g.arc(cx + Math.cos(a) * rr0, cy + Math.sin(a) * rr0, R * 0.035, 0, Math.PI * 2); g.fill(); }
      g.beginPath(); g.arc(cx, cy, R * 0.72, 0, Math.PI * 2);
      const ig = g.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
      ig.addColorStop(0, css(mixc(sat, WHITE, 0.5))); ig.addColorStop(1, css(sat));
      g.fillStyle = ig; g.fill();
      g.lineWidth = R * 0.05; g.strokeStyle = css(mixc(dark, BLACK, 0.25), 0.8); g.stroke();
      if (special === 'h' || special === 'v') {
        g.save(); g.beginPath(); g.arc(cx, cy, R * 0.72, 0, Math.PI * 2); g.clip();
        g.fillStyle = 'rgba(255,255,255,0.85)'; paintStripes(g, cx - R, cy - R, R * 2, special); g.restore();
      }
    } else {
      // 花瓣：六片圓圓的花瓣（糖果色的淡色版）+ 白白的花心
      g.lineWidth = R * 0.05;
      for (let k = 0; k < 6; k++) {
        const a = k * Math.PI / 3 - Math.PI / 2, x = cx + Math.cos(a) * R * 0.56, y = cy + Math.sin(a) * R * 0.56;
        const pg = g.createRadialGradient(x - R * 0.1, y - R * 0.12, R * 0.05, x, y, R * 0.46);
        pg.addColorStop(0, css(mixc(sat, WHITE, 0.6))); pg.addColorStop(1, css(sat));
        g.beginPath(); g.arc(x, y, R * 0.44, 0, Math.PI * 2); g.fillStyle = pg; g.fill();
        g.strokeStyle = css(mixc(dark, BLACK, 0.3), 0.75); g.stroke();
      }
      g.beginPath(); g.arc(cx, cy, R * 0.62, 0, Math.PI * 2);
      g.fillStyle = css(mixc(sat, WHITE, 0.72)); g.fill();
      g.strokeStyle = css(mixc(dark, BLACK, 0.2), 0.6); g.stroke();
      if (special === 'h' || special === 'v') {
        g.save(); bodyPath(g, kind, cx, cy, R); g.clip();
        g.fillStyle = 'rgba(255,255,255,0.75)'; paintStripes(g, cx - R, cy - R, R * 2, special); g.restore();
      }
    }
    if (special === 'wrap') paintWrapFrame(g, k => { g.beginPath(); g.arc(cx, cy, R * k, 0, Math.PI * 2); }, R);
  }
  // 蓋在玩偶上面的反光
  function paintAltGloss(g, kind, cx, cy, S) {
    const f = look.frame, R = S * CANDY_R * 1.02;
    if (f === 'capsule') {
      // 球面反光罩住玩偶：左上一大片弧形亮面、上緣一條亮邊、右下一小塊反光
      g.save();
      g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.clip();
      g.translate(cx - R * 0.28, cy - R * 0.5); g.rotate(-0.5);
      const hg = g.createLinearGradient(0, -R * 0.35, 0, R * 0.3);
      hg.addColorStop(0, 'rgba(255,255,255,0.75)'); hg.addColorStop(0.6, 'rgba(255,255,255,0.18)'); hg.addColorStop(1, 'rgba(255,255,255,0)');
      g.beginPath(); g.ellipse(0, 0, R * 0.72, R * 0.34, 0, 0, Math.PI * 2); g.fillStyle = hg; g.fill();
      g.restore();
      g.beginPath(); g.arc(cx, cy, R * 0.92, Math.PI * 1.08, Math.PI * 1.75);
      g.lineWidth = R * 0.06; g.lineCap = 'round'; g.strokeStyle = 'rgba(255,255,255,0.85)'; g.stroke();
      g.beginPath(); g.arc(cx, cy, R * 0.9, Math.PI * 0.15, Math.PI * 0.4);
      g.lineWidth = R * 0.045; g.strokeStyle = 'rgba(255,255,255,0.5)'; g.stroke();
      g.lineCap = 'butt';
      g.beginPath(); g.arc(cx - R * 0.52, cy - R * 0.55, R * 0.07, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
    } else if (f === 'cookie') {
      g.fillStyle = 'rgba(255,255,255,0.85)';
      for (const [x, y, r0] of [[-0.6, -0.55, 0.05], [-0.42, -0.74, 0.03], [0.62, 0.5, 0.03]]) { g.beginPath(); g.arc(cx + x * R, cy + y * R, r0 * R, 0, Math.PI * 2); g.fill(); }
    } else {
      g.beginPath(); g.ellipse(cx - R * 0.1, cy - R * 0.86, R * 0.2, R * 0.1, -0.3, 0, Math.PI * 2);
      g.fillStyle = 'rgba(255,255,255,0.7)'; g.fill();
      g.beginPath(); g.arc(cx - R * 0.55, cy - R * 0.5, R * 0.05, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
    }
  }
  function buildTile(kind, special, S) {
    const P = Math.ceil(S * PAD), cx = P / 2, cy = P / 2, col = kindColor(kind);
    const base = makeCanvas(P, P), bg = base.getContext('2d');
    if (special === 'wrap') paintWrapEnds(bg, cx, cy, S, col);
    if (look.frame === 'jelly' || !look.frame) paintCandy(bg, kind, cx, cy, S, col, special);
    else paintAltBase(bg, kind, cx, cy, S, col, special);
    let top = null;
    if (special === 'h' || special === 'v' || special === 'wrap') {
      top = makeCanvas(P, P);
      const tg = top.getContext('2d');
      if (special === 'wrap') paintCellophane(tg, cx, cy, S);
      else paintArrows(tg, cx, cy, S, special);
    }
    const full = makeCanvas(P, P), fg = full.getContext('2d');
    fg.drawImage(base, 0, 0);
    // 玩具幾乎塞滿糖果（照玩具實際的輪廓算大小，置中）
    const L = toyLayout(kind, special, S), tx = cx + L.dx, ty = cy + L.dy;
    let toy = null;
    if (special === 'fish') {
      // 飛天玩偶：玩偶另外存一張（畫的時候上下飄、飛出去的時候也用這張；翅膀在 drawPieceAt 畫）
      toy = makeCanvas(P, P);
      paintSprite(toy.getContext('2d'), kind, tx, ty, L.box);
      paintAccessory(toy.getContext('2d'), kind, tx, ty, L.box);
      fg.drawImage(toy, 0, 0);
    } else {
      paintSprite(fg, kind, tx, ty, L.box);
      paintAccessory(fg, kind, tx, ty, L.box);
    }
    if (special === 'h' || special === 'v') {
      const R = S * CANDY_R;
      paintToyStripes(fg, kind, tx, ty, L.box, cx - R, cy - R, R * 2, special);
    }
    // 玻璃反光蓋在玩具上面；選取時（轉圈 / 彈跳）也要蓋，所以合併進 top
    const gloss = makeCanvas(P, P);
    if (look.frame === 'jelly' || !look.frame) paintCandyGloss(gloss.getContext('2d'), kind, cx, cy, S);
    else paintAltGloss(gloss.getContext('2d'), kind, cx, cy, S);
    if (top) top.getContext('2d').drawImage(gloss, 0, 0);
    else top = gloss;
    fg.drawImage(top, 0, 0);
    return { full, base, top, toy, P };
  }
  // 三寶排成扇形（左右兩隻在後面、往外歪，中間那隻在前面），每隻一圈金光 + 往右下的影子；彩色炸彈和「三寶合體！」口號共用
  const fanCache = new Map();
  function trioFan(S) {
    let c = fanCache.get(S);
    if (c) return c;
    const P = Math.ceil(S * PAD), cx = P / 2, cy = P / 2;
    const kindOf = id => pieces.findIndex(p => p.id === id);
    const L = [['egg', -0.19, -0.07, 0.42, -0.34], ['dog', 0.19, -0.07, 0.42, 0.34], ['sloth', 0, 0.07, 0.5, 0]];  // id, x, y, 大小（格）, 傾斜
    const ims = L.map(([id]) => { const k = kindOf(id); return k >= 0 ? toyImage(k) : null; });
    if (ims.some(im => !im)) return null;
    c = makeCanvas(P, P);
    const g = c.getContext('2d');
    L.forEach(([, x, y, b, rot], i) => {
      const box = Math.round(S * b), src = scaled(ims[i], box);
      const gold = silhouette(src, '#ffd84a'), sh = silhouette(src, 'rgb(60,24,100)');
      g.save();
      g.translate(cx + x * S, cy + y * S); g.rotate(rot);
      g.globalAlpha = 0.09;
      for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) g.drawImage(sh, -box / 2 + box * 0.03 + dx * box * 0.01, -box / 2 + box * 0.06 + dy * box * 0.01);
      for (const [r, a] of [[box * 0.07, 0.2], [box * 0.04, 0.5]]) {
        g.globalAlpha = a;
        for (let k = 0; k < 16; k++) { const t = k / 16 * Math.PI * 2; g.drawImage(gold, -box / 2 + Math.cos(t) * r, -box / 2 + Math.sin(t) * r); }
      }
      g.globalAlpha = 1;
      g.drawImage(src, -box / 2, -box / 2);
      g.restore();
    });
    fanCache.set(S, c);
    return c;
  }
  // 彩色炸彈（改版 2026-11，照草稿）：深巧克力色的球、上面撒彩色糖粒（會慢慢轉），白圈 + 粉紅外圈，上面是扇形的三寶。
  // 盤面上唯一沒有角色顏色的方塊。以前是七彩漩渦球 + 金框（備份 tag backup/live-before-redesign-2026-11-23 裡有）
  function buildBomb(S) {
    const P = Math.ceil(S * PAD), cx = P / 2, cy = P / 2, R = S * 0.35;
    const under = makeCanvas(P, P), ug = under.getContext('2d');
    ug.save();
    ug.shadowColor = 'rgba(36,8,64,0.55)'; ug.shadowBlur = S * 0.08; ug.shadowOffsetX = S * 0.03; ug.shadowOffsetY = S * 0.06;
    ug.beginPath(); ug.arc(cx, cy, R * 1.24, 0, Math.PI * 2); ug.fillStyle = '#b8306f'; ug.fill();
    ug.restore();
    // 會轉的部分：巧克力球（中心對稱的深淺，轉起來看不出來）+ 糖粒
    const orb = makeCanvas(P, P), og = orb.getContext('2d');
    const cg = og.createRadialGradient(cx, cy, 0, cx, cy, R);
    cg.addColorStop(0, '#6e4129'); cg.addColorStop(0.7, '#56301c'); cg.addColorStop(1, '#3b2014');
    og.beginPath(); og.arc(cx, cy, R, 0, Math.PI * 2); og.fillStyle = cg; og.fill();
    {
      const rnd = mulberry(5150), cols = ['#ff3fb0', '#18c25a', '#ffc81a', '#4fb4ff', '#ffffff', '#ff8a2a'];
      og.lineCap = 'round';
      for (let i = 0; i < 26; i++) {
        const d = R * 0.86 * Math.sqrt((i + 0.5) / 26), a = i * 2.39996 + rnd() * 0.5;
        const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d, c = cols[i % cols.length];
        if (i % 3 === 2) {
          og.beginPath(); og.arc(x, y, R * 0.06, 0, Math.PI * 2); og.fillStyle = c; og.fill();
        } else {
          const r = rnd() * Math.PI, l = R * 0.11;
          og.beginPath(); og.moveTo(x - Math.cos(r) * l, y - Math.sin(r) * l); og.lineTo(x + Math.cos(r) * l, y + Math.sin(r) * l);
          og.lineWidth = R * 0.085; og.strokeStyle = c; og.stroke();
        }
      }
    }
    // 不轉的部分：球的明暗（左上亮、右下暗）、白圈、粉紅外圈、反光
    const top = makeCanvas(P, P), tg = top.getContext('2d');
    {
      const lg = tg.createRadialGradient(cx - R * 0.3, cy - R * 0.4, R * 0.05, cx, cy, R);
      lg.addColorStop(0, 'rgba(255,225,200,0.3)'); lg.addColorStop(0.5, 'rgba(255,225,200,0)'); lg.addColorStop(0.8, 'rgba(20,6,2,0.05)'); lg.addColorStop(1, 'rgba(20,6,2,0.4)');
      tg.beginPath(); tg.arc(cx, cy, R, 0, Math.PI * 2); tg.fillStyle = lg; tg.fill();
      // 粉紅外圈
      tg.beginPath(); tg.arc(cx, cy, R * 1.24, 0, Math.PI * 2); tg.arc(cx, cy, R * 1.08, 0, Math.PI * 2, true);
      const pg = tg.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
      pg.addColorStop(0, '#ffb3d6'); pg.addColorStop(0.4, '#ff5aa8'); pg.addColorStop(1, '#c92f78');
      tg.fillStyle = pg; tg.fill('evenodd');
      // 白圈
      tg.beginPath(); tg.arc(cx, cy, R * 1.09, 0, Math.PI * 2); tg.arc(cx, cy, R * 0.99, 0, Math.PI * 2, true);
      tg.fillStyle = '#fff'; tg.fill('evenodd');
      tg.beginPath(); tg.arc(cx, cy, R * 0.99, 0, Math.PI * 2);
      tg.lineWidth = Math.max(1, S * 0.012); tg.strokeStyle = 'rgba(60,25,10,0.55)'; tg.stroke();
      tg.beginPath(); tg.arc(cx, cy, R * 1.24, 0, Math.PI * 2);
      tg.lineWidth = Math.max(1, S * 0.014); tg.strokeStyle = 'rgba(130,20,70,0.7)'; tg.stroke();
      tg.beginPath(); tg.arc(cx, cy, R * 1.17, Math.PI * 0.9, Math.PI * 1.6);
      tg.lineWidth = Math.max(1, S * 0.018); tg.lineCap = 'round'; tg.strokeStyle = 'rgba(255,255,255,0.8)'; tg.stroke();
      // 左上的月牙反光和亮點
      tg.save();
      tg.beginPath(); tg.arc(cx, cy, R * 0.99, 0, Math.PI * 2); tg.clip();
      tg.translate(cx - R * 0.36, cy - R * 0.5); tg.rotate(-0.62);
      const gl = tg.createLinearGradient(0, -R * 0.36, 0, R * 0.26);
      gl.addColorStop(0, 'rgba(255,255,255,0.55)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
      tg.beginPath(); tg.ellipse(0, 0, R * 0.62, R * 0.26, 0, 0, Math.PI * 2); tg.fillStyle = gl; tg.fill();
      tg.restore();
    }
    // 三寶（扇形）；圖還沒載好就用三顆小球
    let trio = trioFan(S);
    if (!trio) {
      trio = makeCanvas(P, P);
      const pg = trio.getContext('2d');
      for (let i = 0; i < 3; i++) {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / 3, bx = cx + Math.cos(a) * R * 0.38, by = cy + Math.sin(a) * R * 0.38;
        const col = kindColor(Math.min(i, Math.max(0, pieces.length - 1)));
        pg.beginPath(); pg.arc(bx, by, R * 0.3, 0, Math.PI * 2);
        pg.fillStyle = '#fff'; pg.fill();
        pg.beginPath(); pg.arc(bx, by, R * 0.24, 0, Math.PI * 2);
        pg.fillStyle = css(saturate(col, 0.5)); pg.fill();
      }
    }
    return { under, orb, top, trio, P };
  }
  function getTile(kind, special) {
    const S = Math.max(4, Math.round(cs * dpr));
    if (S !== cacheS) { tileCache.clear(); fanCache.clear(); cacheS = S; jellyCache = []; rimCache = []; glowImg = null; }
    const key = special === 'bomb' || kind < 0 ? 'bomb' : kind + '|' + special;
    let e = tileCache.get(key);
    if (!e) {
      e = key === 'bomb' ? buildBomb(S) : buildTile(kind, special || 'none', S);
      tileCache.set(key, e);
    }
    return e;
  }
  // 碎開特效用的碎片：把整顆方塊（含玩具）切成 7 片不規則楔形，每種方塊只切一次
  function getShards(kind, special) {
    const e = getTile(kind, special);
    if (e.shards || !e.full) return e.shards || null;
    const P = e.P, S = P / PAD, n = 7, rnd = mulberry(4099 + kind * 131 + (special || '').length * 17);
    const cx = P / 2 + (rnd() - 0.5) * S * 0.16, cy = P / 2 + (rnd() - 0.5) * S * 0.16, R = P * 0.75;
    const ang = [];
    for (let i = 0; i < n; i++) ang.push((i + 0.25 + rnd() * 0.5) / n * Math.PI * 2);
    const half = S * TILE / 2, lo = P / 2 - half - 2, hi = P / 2 + half + 2;
    const out = [];
    for (let i = 0; i < n; i++) {
      const a0 = ang[i], a1 = ang[(i + 1) % n] + (i === n - 1 ? Math.PI * 2 : 0), am = (a0 + a1) / 2;
      const poly = [[cx, cy], [cx + Math.cos(a0) * R, cy + Math.sin(a0) * R], [cx + Math.cos(am) * R * 1.1, cy + Math.sin(am) * R * 1.1],
        [cx + Math.cos(a1) * R, cy + Math.sin(a1) * R]];
      // 外框只要方塊範圍內的部分
      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      for (const [x, y] of poly) { bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y); }
      bx0 = Math.max(lo, Math.floor(bx0)); by0 = Math.max(lo, Math.floor(by0)); bx1 = Math.min(hi, Math.ceil(bx1)); by1 = Math.min(hi, Math.ceil(by1));
      const w = Math.max(1, bx1 - bx0), h = Math.max(1, by1 - by0);
      const c = makeCanvas(w, h), g = c.getContext('2d');
      g.translate(-bx0, -by0);
      g.beginPath(); poly.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.clip();
      g.drawImage(e.full, 0, 0);
      // 切口亮一點，看起來像糖果碎片的斷面
      g.lineWidth = Math.max(1, S * 0.03); g.strokeStyle = 'rgba(255,255,255,0.55)'; g.stroke();
      const mx = (bx0 + bx1) / 2 - P / 2, my = (by0 + by1) / 2 - P / 2, L = Math.hypot(mx, my) || 1;
      out.push({ c, ox: mx / S, oy: my / S, w: w / S, h: h / S, dx: mx / L, dy: my / L });
    }
    e.shards = out;
    return out;
  }
  function shatter(x, y, kind, special, t, power = 1) {
    if (kind < 0) return;
    const sh = getShards(kind, special);
    if (!sh) return;
    for (const d of sh) {
      const v = (1.7 + Math.random() * 1.6) * power;
      emit({ type: 3, img: d.c, x: x + d.ox, y: y + d.oy, vx: d.dx * v + (Math.random() - 0.5) * 0.9, vy: d.dy * v - 2.0 * power,
        g: 8.5, drag: 0.8, t0: t, life: 820 + Math.random() * 300, w: d.w, h: d.h, rot: 0, vr: (Math.random() - 0.5) * 10 });
    }
  }
  function getGlow() {
    if (glowImg) return glowImg;
    const s = Math.max(16, Math.round(cs * dpr * 1.6)), c = makeCanvas(s, s), g = c.getContext('2d'), h = s / 2;
    const rg = g.createRadialGradient(h, h, 0, h, h, h);
    rg.addColorStop(0, 'rgba(255,255,240,1)'); rg.addColorStop(0.38, 'rgba(255,240,170,0.75)');
    rg.addColorStop(0.65, 'rgba(255,190,230,0.35)'); rg.addColorStop(1, 'rgba(255,190,230,0)');
    g.fillStyle = rg; g.fillRect(0, 0, s, s);
    glowImg = c;
    return c;
  }
  // 飄落的小羽毛（白色、淡藍邊）
  let featherImg = null;
  function getFeather() {
    if (featherImg) return featherImg;
    const n = 48, c = makeCanvas(n, n), g = c.getContext('2d');
    g.translate(n / 2, n / 2); g.rotate(-0.6);
    g.beginPath(); g.ellipse(0, 0, n * 0.42, n * 0.15, 0, 0, Math.PI * 2);
    const fg = g.createLinearGradient(-n * 0.4, 0, n * 0.4, 0);
    fg.addColorStop(0, 'rgba(255,255,255,0.95)'); fg.addColorStop(1, 'rgba(214,234,255,0.9)');
    g.fillStyle = fg; g.fill();
    g.lineWidth = 1.2; g.strokeStyle = 'rgba(140,170,230,0.7)'; g.stroke();
    g.beginPath(); g.moveTo(-n * 0.44, 0); g.lineTo(n * 0.38, 0); g.strokeStyle = 'rgba(150,180,235,0.8)'; g.stroke();
    featherImg = c;
    return c;
  }
  function getStar() {
    if (starImg) return starImg;
    const s = 64, c = makeCanvas(s, s), g = c.getContext('2d'), h = s / 2;
    const rg = g.createRadialGradient(h, h, 0, h, h, h);
    rg.addColorStop(0, 'rgba(255,255,255,0.95)'); rg.addColorStop(0.22, 'rgba(255,248,210,0.45)'); rg.addColorStop(1, 'rgba(255,240,200,0)');
    g.fillStyle = rg; g.fillRect(0, 0, s, s);
    g.beginPath();
    g.moveTo(h, 2); g.quadraticCurveTo(h, h, s - 2, h); g.quadraticCurveTo(h, h, h, s - 2);
    g.quadraticCurveTo(h, h, 2, h); g.quadraticCurveTo(h, h, h, 2);
    g.fillStyle = '#fff'; g.fill();
    starImg = c;
    return c;
  }
  function getFluff(col) {
    const key = col.join(',');
    let c = fluffCache.get(key);
    if (c) return c;
    const s = 48, h = s / 2;
    c = makeCanvas(s, s);
    const g = c.getContext('2d'), rg = g.createRadialGradient(h * 0.85, h * 0.8, 0, h, h, h);
    rg.addColorStop(0, css(mixc(col, WHITE, 0.75))); rg.addColorStop(0.5, css(saturate(col, 0.4), 0.95));
    rg.addColorStop(0.8, css(saturate(col, 0.4), 0.55)); rg.addColorStop(1, css(col, 0));
    g.fillStyle = rg; g.fillRect(0, 0, s, s);
    fluffCache.set(key, c);
    return c;
  }
  // 果凍：透亮的冰藍水晶（不再是粉紅色，跟底座、背景都分得開）。
  //   單層：透亮的青藍色半透明結晶 + 細細的亮冰邊；雙層：厚實的深冰藍 + 兩層高光 + 斜斜的結晶反光
  function getJelly(level) {
    if (jellyCache[level]) return jellyCache[level];
    const S = Math.max(4, Math.round(cs * dpr)), c = makeCanvas(S, S), g = c.getContext('2d');
    const two = level >= 2, i = S * 0.03, w = S - 2 * i, rad = S * 0.16;
    const gr = g.createLinearGradient(0, i, 0, i + w);
    if (two) { gr.addColorStop(0, 'rgba(110,200,255,0.9)'); gr.addColorStop(1, 'rgba(24,104,210,0.92)'); }
    else { gr.addColorStop(0, 'rgba(170,238,255,0.62)'); gr.addColorStop(1, 'rgba(70,190,240,0.58)'); }
    rr(g, i, i, w, w, rad); g.fillStyle = gr; g.fill();
    // 斜斜的結晶反光（兩道），只在格子裡面
    g.save();
    rr(g, i, i, w, w, rad); g.clip();
    g.fillStyle = two ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.26)';
    for (const [x0, wd] of two ? [[0.08, 0.14], [0.34, 0.07], [0.62, 0.05]] : [[0.12, 0.12], [0.44, 0.06]]) {
      g.beginPath(); g.moveTo(i + w * x0, i + w); g.lineTo(i + w * (x0 + wd), i + w); g.lineTo(i + w * (x0 + wd + 0.5), i); g.lineTo(i + w * (x0 + 0.5), i); g.closePath(); g.fill();
    }
    // 上緣一條亮面（雙層再多一條，看起來比較厚）
    g.fillStyle = 'rgba(255,255,255,0.5)';
    rr(g, i + w * 0.08, i + w * 0.05, w * 0.84, w * 0.12, w * 0.06); g.fill();
    if (two) { g.fillStyle = 'rgba(255,255,255,0.28)'; rr(g, i + w * 0.12, i + w * 0.22, w * 0.76, w * 0.07, w * 0.035); g.fill(); }
    g.restore();
    rr(g, i, i, w, w, rad);
    g.lineWidth = S * (two ? 0.05 : 0.035); g.strokeStyle = two ? 'rgba(200,240,255,0.95)' : 'rgba(225,250,255,0.9)'; g.stroke();
    if (two) { rr(g, i + S * 0.07, i + S * 0.07, w - S * 0.14, w - S * 0.14, rad * 0.7); g.lineWidth = S * 0.022; g.strokeStyle = 'rgba(190,235,255,0.75)'; g.stroke(); }
    jellyCache[level] = c;
    return c;
  }
  // 果凍外框：畫在方塊上面一圈發亮的冰藍邊，方塊蓋住果凍時也看得出哪幾格還有果凍（雙層 = 深冰藍雙框）
  function getJellyRim(level) {
    if (rimCache[level]) return rimCache[level];
    const S = Math.max(4, Math.round(cs * dpr)), c = makeCanvas(S, S), g = c.getContext('2d');
    const two = level >= 2, inset = S * 0.05, w = S - 2 * inset, rad = S * 0.2;
    const col = two ? [40, 150, 255] : [120, 225, 255];
    g.save();
    g.shadowColor = css(col, 0.9); g.shadowBlur = S * 0.06;
    rr(g, inset, inset, w, w, rad);
    g.lineWidth = S * (two ? 0.07 : 0.05); g.strokeStyle = css(col, 0.95); g.stroke();
    g.restore();
    rr(g, inset, inset, w, w, rad);
    g.lineWidth = S * 0.018; g.strokeStyle = 'rgba(255,255,255,0.85)'; g.stroke();
    if (two) {
      const i2 = S * 0.11;
      rr(g, i2, i2, S - 2 * i2, S - 2 * i2, rad * 0.75);
      g.lineWidth = S * 0.028; g.strokeStyle = css(col, 0.85); g.stroke();
    }
    // 左上角的冰晶亮點
    g.beginPath(); g.arc(inset + rad * 0.55, inset + rad * 0.55, S * 0.026, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,255,255,0.95)'; g.fill();
    rimCache[level] = c;
    return c;
  }
  // 碎冰（敲掉一層果凍時噴出來的冰晶碎片）
  let iceImg = null;
  function getIceShard() {
    if (iceImg) return iceImg;
    const n = 32, c = makeCanvas(n, n), g = c.getContext('2d');
    g.beginPath(); g.moveTo(n * 0.5, n * 0.05); g.lineTo(n * 0.9, n * 0.45); g.lineTo(n * 0.55, n * 0.95); g.lineTo(n * 0.12, n * 0.6); g.closePath();
    const gr = g.createLinearGradient(0, 0, n, n);
    gr.addColorStop(0, 'rgba(235,252,255,0.98)'); gr.addColorStop(1, 'rgba(90,200,255,0.9)');
    g.fillStyle = gr; g.fill(); g.lineWidth = 1.5; g.strokeStyle = 'rgba(40,140,220,0.9)'; g.stroke();
    g.beginPath(); g.moveTo(n * 0.5, n * 0.05); g.lineTo(n * 0.55, n * 0.95); g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 1; g.stroke();
    iceImg = c;
    return c;
  }
  function iceBurst(x, y, t) {
    const sh = getIceShard();
    for (let i = 0; i < 7; i++) {
      const a = Math.random() * Math.PI * 2, v = 2.2 + Math.random() * 2.2;
      emit({ type: 1, img: sh, x: x + Math.cos(a) * 0.2, y: y + Math.sin(a) * 0.2, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1.6, g: 9, drag: 1.6, t0: t,
        life: 420 + Math.random() * 220, size: 0.2 + Math.random() * 0.14, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 12 });
    }
    sparkle(x, y, 3, t, 0.3);
  }
  function drawJellyRims(t) {
    for (let r = 0; r < rows; r++) {
      const jr = jelly[r];
      if (!jr) continue;
      for (let c = 0; c < cols; c++) {
        const lv = jr[c] | 0;
        if (lv <= 0 || !mask[r][c]) continue;
        const jf = jellyFx.get(r * 1024 + c);
        let s = 1;
        if (jf) { const p = (t - jf.t0) / 420; if (p < 1) s = 1 + 0.13 * Math.sin(p * Math.PI * 3) * (1 - p); }
        const x = ox + (c + 0.5) * cs, y = oy + (r + 0.5) * cs, z = cs * s;
        ctx.drawImage(getJellyRim(Math.min(2, lv)), x - z / 2, y - z / 2, z, z);
      }
    }
  }
  // 平面底板：深紫色圓角底板 + 深淺交錯的方格，沒有外框、厚度和毛玻璃
  function buildFlatBg() {
    const fl = BOARD_THEME.flat, S = cs * dpr, m = Math.round(MARGIN * S);
    const Wd = Math.ceil(cols * S + 2 * m), Hd = Math.ceil(rows * S + 2 * m);
    const on = (r, c) => r >= 0 && c >= 0 && r < rows && c < cols && mask[r][c];
    const corners = (r, c, rad) => {
      const u = on(r - 1, c), d = on(r + 1, c), l = on(r, c - 1), ri = on(r, c + 1);
      return [!u && !l ? rad : 0, !u && !ri ? rad : 0, !d && !ri ? rad : 0, !d && !l ? rad : 0];
    };
    const base = makeCanvas(Wd, Hd), bq = base.getContext('2d');
    const rad = S * 0.28, crad = Math.max(0, rad - m);
    bq.fillStyle = fl.base;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (!mask[r][c]) continue;
      rr4(bq, m + c * S - m, m + r * S - m, S + 2 * m, S + 2 * m, ...corners(r, c, rad));
      bq.fill();
    }
    const c = makeCanvas(Wd, Hd), g = c.getContext('2d');
    g.drawImage(base, 0, 0);
    for (let r = 0; r < rows; r++) for (let c2 = 0; c2 < cols; c2++) {
      if (!mask[r][c2]) continue;
      rr4(g, m + c2 * S, m + r * S, S, S, ...corners(r, c2, crad));
      g.fillStyle = (r + c2) % 2 ? fl.cellB : fl.cellA;
      g.fill();
    }
    const shade = makeCanvas(Wd, Hd), sg = shade.getContext('2d');
    sg.drawImage(base, 0, 0);
    sg.globalCompositeOperation = 'source-in';
    sg.fillStyle = 'rgb(40,12,70)'; sg.fillRect(0, 0, Wd, Hd);
    bgCache = { c, shade, x: ox - m / dpr, y: oy - m / dpr, w: Wd / dpr, h: Hd / dpr };
    const p = new Path2D();
    for (let r = 0; r < rows; r++) for (let c2 = 0; c2 < cols; c2++) {
      if (mask[r][c2]) p.rect(ox + c2 * cs - 0.5, oy + r * cs - 0.5, cs + 1, cs + 1);
    }
    clipPath = p;
  }
  function buildBg() {
    bgCache = null; clipPath = null;
    if (!rows || !cols || !W) return;
    if (BOARD_THEME.flat) { buildFlatBg(); return; }
    const S = cs * dpr, m = MARGIN * S;
    // 快取畫布比盤面大一點：左右留給投影、下面留給盤子的厚度和投影
    const sideX = Math.round(S * 0.14), below = Math.round(S * FRAME_B);
    const X0 = m + sideX, Y0 = m;                        // 第 0 格左上角在快取畫布裡的位置
    const Wd = Math.ceil(cols * S + 2 * m + 2 * sideX), Hd = Math.ceil(rows * S + 2 * m + below);
    const on = (r, c) => r >= 0 && c >= 0 && r < rows && c < cols && mask[r][c];
    const shape = (expand, radius, dy = 0) => {
      const t = makeCanvas(Wd, Hd), g = t.getContext('2d');
      g.fillStyle = '#fff';
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        if (!mask[r][c]) continue;
        const u = on(r - 1, c), d = on(r + 1, c), l = on(r, c - 1), ri = on(r, c + 1);
        rr4(g, X0 + c * S - expand, Y0 + r * S - expand + dy, S + 2 * expand, S + 2 * expand,
          !u && !l ? radius : 0, !u && !ri ? radius : 0, !d && !ri ? radius : 0, !d && !l ? radius : 0);
        g.fill();
      }
      return t;
    };
    const c = makeCanvas(Wd, Hd), g = c.getContext('2d');
    const FO = 0.22, FI = 0.06;                          // 外框外緣 / 內緣往外擴多少（格）
    const outer = shape(S * FO, S * 0.36), inner = shape(S * FI, S * 0.24);
    const ring = (o, i) => { const t = makeCanvas(Wd, Hd), q = t.getContext('2d'); q.drawImage(o, 0, 0); q.globalCompositeOperation = 'destination-out'; q.drawImage(i, 0, 0); return t; };
    const paint = (msk, style, dy = 0) => {
      const t = makeCanvas(Wd, Hd), q = t.getContext('2d');
      q.drawImage(msk, 0, dy);
      q.globalCompositeOperation = 'source-in';
      q.fillStyle = typeof style === 'function' ? style(q) : style; q.fillRect(0, 0, Wd, Hd);
      return t;
    };
    // 漸層照盤子本身的上下緣算（不是照快取畫布），上亮下暗
    const top = Y0 - S * FO, btm = Y0 + rows * S + S * FO;
    const vgrad = (stops, y0 = top, y1 = btm) => q => { const gr = q.createLinearGradient(0, y0, 0, y1); stops.forEach(([o, col]) => gr.addColorStop(o, col)); return gr; };
    const thick = Math.max(2, Math.round(S * 0.1));
    // 整個盤子壓在背景上的投影（暖暖的淡紫玫瑰色，不是灰黑）+ 外圈一層柔柔的白粉光（盤子像微微發光）
    const th = BOARD_THEME, fr = th.frame || FRAME_CREAM;
    g.save();
    g.shadowColor = fr.glow; g.shadowBlur = S * 0.34;
    g.drawImage(paint(outer, fr.base, thick), 0, 0);
    g.shadowColor = fr.drop; g.shadowBlur = S * 0.18; g.shadowOffsetY = S * 0.09;
    g.drawImage(paint(outer, fr.dropBase, thick), 0, 0);
    g.restore();
    // 盤子的厚度：下緣露出一圈焦糖玫瑰色的側面（實心色塊，只有一點點上下明暗）
    g.drawImage(paint(outer, vgrad([[0, fr.side[0]], [0.6, fr.side[1]], [1, fr.side[2]]], btm - S * 0.4, btm + thick), thick), 0, 0);
    g.save(); g.globalCompositeOperation = 'destination-out'; g.drawImage(inner, 0, 0); g.restore();
    // 外框：乾淨的奶油色實心塊面 —— 上緣一條很細的亮邊、下緣淡淡的暗（不再是發光的塑膠管）
    g.drawImage(paint(ring(outer, inner), vgrad([[0, fr.ring[0]], [0.5, fr.ring[1]], [1, fr.ring[2]]])), 0, 0);
    g.drawImage(paint(ring(outer, shape(S * (FO - 0.016), S * 0.35)), vgrad([[0, 'rgba(255,255,255,0.9)'], [0.08, 'rgba(255,255,255,0)']])), 0, 0);
    g.drawImage(paint(ring(outer, shape(S * (FO - 0.05), S * 0.32)), vgrad([[0, css(fr.ringShade, 0)], [0.8, css(fr.ringShade, 0)], [1, css(fr.ringShade, 0.35)]])), 0, 0);
    // 內緣一圈細細的暗邊：盤面看起來是嵌進外框裡
    g.drawImage(paint(ring(shape(S * (FI + 0.022), S * 0.26), inner), fr.innerEdge), 0, 0);
    // 盤面：半透明的淺色毛玻璃（奶白 → 淡薰衣草），深灰、白色的玩偶都看得清楚。
    // 不用 CSS 的 backdrop-filter：背景在動時每一幀都要重算模糊，手機會燙；改成「霧面奶白」，看起來一樣、不耗電
    g.drawImage(paint(inner, vgrad(th.glass)), 0, 0);
    const glass = makeCanvas(Wd, Hd), gq = glass.getContext('2d');
    const gx = X0 + cols * S / 2, gy = Y0 + rows * S * 0.3, gR = Math.max(cols, rows) * S * 0.7;
    const cg = gq.createRadialGradient(gx, gy, 0, gx, gy, gR);
    cg.addColorStop(0, th.glow[0]); cg.addColorStop(1, th.glow[1]);
    gq.fillStyle = cg; gq.fillRect(0, 0, Wd, Hd);
    if (th.deco === 'stars') {
      // 星空：滿滿的小星點 + 幾顆四角星（固定的亂數，每次一樣）
      const rnd = mulberry(rows * 131 + cols * 17), n = rows * cols * 3;
      for (let i = 0; i < n; i++) {
        const x = X0 + rnd() * cols * S, y = Y0 + rnd() * rows * S, r0 = S * (0.008 + rnd() * 0.018);
        gq.beginPath(); gq.arc(x, y, r0, 0, Math.PI * 2); gq.fillStyle = `rgba(255,255,255,${(0.35 + rnd() * 0.6).toFixed(2)})`; gq.fill();
      }
      for (let i = 0; i < rows * cols / 4; i++) {
        const x = X0 + rnd() * cols * S, y = Y0 + rnd() * rows * S, a = S * (0.05 + rnd() * 0.06);
        gq.beginPath(); gq.moveTo(x, y - a); gq.quadraticCurveTo(x, y, x + a, y); gq.quadraticCurveTo(x, y, x, y + a);
        gq.quadraticCurveTo(x, y, x - a, y); gq.quadraticCurveTo(x, y, x, y - a);
        gq.fillStyle = i % 3 ? 'rgba(255,255,255,0.85)' : 'rgba(255,230,150,0.9)'; gq.fill();
      }
    }
    gq.globalCompositeOperation = 'destination-in'; gq.drawImage(inner, 0, 0);
    g.drawImage(glass, 0, 0);
    // 格子：一格一格淺淺的圓角凹槽，粉白 / 淡薰衣草交錯；沒有框線、也沒有星光（不要在縫裡搶戲）。
    // 光從左上來：左上的內壁有一點淡紫的影子、右下的內壁受光（白）；糖果往右下的落影就落在槽底
    const cells = makeCanvas(Wd, Hd), q = cells.getContext('2d');
    const gap = S * 0.03, crad = S * 0.17, cw = S - gap * 2, big = S * 0.4;
    for (let r = 0; r < rows; r++) for (let c2 = 0; c2 < cols; c2++) {
      if (!mask[r][c2]) continue;
      const x = X0 + c2 * S + gap, y = Y0 + r * S + gap;
      rr(q, x, y, cw, cw, crad);
      q.fillStyle = (r + c2) % 2 ? th.cellA : th.cellB;
      q.fill();
      if (th.grid) { q.lineWidth = Math.max(1, S * 0.012); q.strokeStyle = th.grid; q.stroke(); }
      if (th.pattern === 'gingham') {
        // 紅白格子布：橫直各兩條半透明的紅帶，交叉的地方自然比較深
        q.save();
        rr(q, x, y, cw, cw, crad); q.clip();
        q.fillStyle = 'rgba(236,72,92,0.32)';
        const bw = cw / 4;
        for (const k of [0.125, 0.625]) { q.fillRect(x, y + cw * k, cw, bw); q.fillRect(x + cw * k, y, bw, cw); }
        q.restore();
      }
      // 內壁：比槽大一圈、中間挖空的框，往右下 / 左上投影 —— 框本身在槽外面被裁掉，只有影子落進槽裡
      q.save();
      rr(q, x, y, cw, cw, crad); q.clip();
      q.beginPath(); q.rect(x - big, y - big, cw + big * 2, cw + big * 2); rrSub(q, x, y, cw, cw, crad);
      q.fillStyle = '#000';
      q.shadowColor = th.wallDark; q.shadowBlur = S * 0.07; q.shadowOffsetX = S * 0.026; q.shadowOffsetY = S * 0.04;
      q.fill('evenodd');
      q.shadowColor = th.wallLit; q.shadowBlur = S * 0.05; q.shadowOffsetX = -S * 0.018; q.shadowOffsetY = -S * 0.026;
      q.fill('evenodd');
      q.restore();
    }
    // 外框投在盤面上緣的影子（淡淡的玫瑰紫，不是黑）：盤面像凹進盤子裡
    q.drawImage(paint(ring(inner, shape(S * 0.06, S * 0.24, S * 0.12)), th.rimShadow), 0, 0);
    q.drawImage(paint(ring(inner, shape(S * 0.06, S * 0.24, S * 0.05)), th.rimShadow), 0, 0);
    // 外框內緣的內陰影 + 一圈微微的白光（毛玻璃的邊）
    q.drawImage(paint(ring(inner, shape(S * 0.02, S * 0.24)), 'rgba(255,255,255,0.55)'), 0, 0);
    q.globalCompositeOperation = 'destination-in';
    q.drawImage(inner, 0, 0);
    q.globalCompositeOperation = 'source-over';
    g.drawImage(cells, 0, 0);
    if (th.deco === 'bulbs' || th.deco === 'berries') {
      // 外框上的裝飾：沿著盤面外緣，每一格的外側邊中間放一顆（任何形狀的盤面都貼著框走）
      const mid = S * (FO + FI) / 2;
      let k = 0;
      for (let r = 0; r < rows; r++) for (let c2 = 0; c2 < cols; c2++) {
        if (!mask[r][c2]) continue;
        const cx2 = X0 + (c2 + 0.5) * S, cy2 = Y0 + (r + 0.5) * S;
        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          if (on(r + dr, c2 + dc)) continue;
          const x = cx2 + dc * (S / 2 + mid), y = cy2 + dr * (S / 2 + mid);
          if (th.deco === 'bulbs') {
            const warm = (k++ % 2) === 0, rad = S * 0.075;
            g.save();
            g.shadowColor = warm ? 'rgba(255,230,120,0.95)' : 'rgba(255,255,255,0.95)'; g.shadowBlur = S * 0.12;
            const bg2 = g.createRadialGradient(x - rad * 0.3, y - rad * 0.3, 0, x, y, rad);
            bg2.addColorStop(0, '#fff'); bg2.addColorStop(0.6, warm ? '#ffe98a' : '#fff4fb'); bg2.addColorStop(1, warm ? '#f5b800' : '#ffb6da');
            g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fillStyle = bg2; g.fill();
            g.restore();
          } else if ((k++ % 3) === 0) {
            // 小草莓
            const z = S * 0.12;
            g.save(); g.translate(x, y);
            g.beginPath(); g.moveTo(0, -z * 0.55); g.bezierCurveTo(z * 0.9, -z * 0.75, z * 0.75, z * 0.45, 0, z * 0.8);
            g.bezierCurveTo(-z * 0.75, z * 0.45, -z * 0.9, -z * 0.75, 0, -z * 0.55);
            g.fillStyle = '#ff4d6a'; g.fill(); g.lineWidth = Math.max(1, S * 0.012); g.strokeStyle = '#b8243e'; g.stroke();
            g.fillStyle = '#fff3a8';
            for (const [px, py] of [[-0.25, 0], [0.22, -0.05], [0, 0.3], [-0.1, -0.25]]) { g.beginPath(); g.arc(px * z, py * z, z * 0.06, 0, Math.PI * 2); g.fill(); }
            g.beginPath(); g.moveTo(-z * 0.4, -z * 0.6); g.lineTo(0, -z * 0.35); g.lineTo(z * 0.4, -z * 0.6); g.lineTo(0, -z * 0.85); g.closePath();
            g.fillStyle = '#4cbf6a'; g.fill();
            g.restore();
          }
        }
      }
    }
    // 橫幅出現時用的暗色遮罩：和盤面外框同形狀（不會在盤面外畫出一個方框）
    const shade = makeCanvas(Wd, Hd), sg = shade.getContext('2d');
    sg.drawImage(outer, 0, 0);
    sg.globalCompositeOperation = 'source-in';
    sg.fillStyle = 'rgb(40,12,70)'; sg.fillRect(0, 0, Wd, Hd);
    bgCache = { c, shade, x: ox - MARGIN * cs - sideX / dpr, y: oy - MARGIN * cs, w: Wd / dpr, h: Hd / dpr };
    // 掉落方塊只畫在格子裡（新方塊從盤面上緣「長」出來）
    const p = new Path2D();
    for (let r = 0; r < rows; r++) for (let c2 = 0; c2 < cols; c2++) {
      if (mask[r][c2]) p.rect(ox + c2 * cs - 0.5, oy + r * cs - 0.5, cs + 1, cs + 1);
    }
    clipPath = p;
  }

  // ================= 版面 =================
  function geom() {
    if (!rows || !cols || !W) return;
    let size = Math.min(W / (cols + 2 * MARGIN), H / (rows + 2 * MARGIN + FRAME_B));
    cs = Math.max(4, Math.floor(size * dpr) / dpr);
    let r0 = rows, r1 = -1, c0 = cols, c1 = -1;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (mask[r][c]) { r0 = Math.min(r0, r); r1 = Math.max(r1, r); c0 = Math.min(c0, c); c1 = Math.max(c1, c); }
    }
    if (r1 < 0) { r0 = 0; r1 = rows - 1; c0 = 0; c1 = cols - 1; }
    ox = Math.round(((W - (c1 - c0 + 1) * cs) / 2 - c0 * cs) * dpr) / dpr;
    oy = Math.round(((H - (r1 - r0 + 1 + FRAME_B) * cs) / 2 - r0 * cs) * dpr) / dpr;   // 下面留給盤子的厚度和投影
    buildBg();
  }
  function layout() {
    if (destroyed) return;
    // 用排版尺寸（不含 transform）：切換畫面時 .screen 有 scale(1.03) 的過場，這時量 getBoundingClientRect
    // 會大 3%，過場結束後 ResizeObserver 也不會再通知，整個盤面就一直被縮放重取樣（變糊）
    let w = canvas.clientWidth, h = canvas.clientHeight;
    if (!(w > 0 && h > 0)) { const rect = canvas.getBoundingClientRect(); w = rect.width; h = rect.height; }
    if (w < 4 || h < 4) return;           // 還看不見
    const d = Math.min(MAX_DPR, Math.max(1, window.devicePixelRatio || 1));
    const pw = Math.round(w * d), ph = Math.round(h * d);
    // 防呆：畫布若沒有 CSS 尺寸（大小由 width 屬性決定），先把目前大小寫進 style，避免越長越大
    if (!canvas.style.width && Math.abs(w - canvas.width) < 1 && Math.abs(h - canvas.height) < 1 && pw !== canvas.width) {
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    }
    const changed = canvas.width !== pw || canvas.height !== ph || w !== W || h !== H || d !== dpr;
    if (canvas.width !== pw) canvas.width = pw;
    if (canvas.height !== ph) canvas.height = ph;
    W = w; H = h; dpr = d;
    if (changed || !bgCache) { geom(); if (changed && rows) prewarm(); }
    draw(now());
    requestDraw();
  }

  // ================= 快取的光暈 / 星星 / 光束 =================
  // 白色光暈（閃光用）：固定大小，畫的時候縮放
  function getFlash() {
    if (flashImg) return flashImg;
    const s = 128, c = makeCanvas(s, s), g = c.getContext('2d'), h = s / 2;
    const rg = g.createRadialGradient(h, h, 0, h, h, h);
    rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.35, 'rgba(255,252,235,0.7)');
    rg.addColorStop(0.7, 'rgba(255,240,215,0.18)'); rg.addColorStop(1, 'rgba(255,240,215,0)');
    g.fillStyle = rg; g.fillRect(0, 0, s, s);
    flashImg = c;
    return c;
  }
  // 帶顏色的光暈（衝擊波中心、閃電源頭）
  function getGlowCol(col) {
    const key = col[0] * 65536 + col[1] * 256 + col[2];
    let c = glowColCache.get(key);
    if (c) return c;
    const s = 128, h = s / 2;
    c = makeCanvas(s, s);
    const g = c.getContext('2d'), rg = g.createRadialGradient(h, h, 0, h, h, h);
    rg.addColorStop(0, 'rgba(255,255,255,0.95)'); rg.addColorStop(0.45, css(mixc(col, WHITE, 0.3), 0.5)); rg.addColorStop(1, css(col, 0));
    g.fillStyle = rg; g.fillRect(0, 0, s, s);
    glowColCache.set(key, c);
    return c;
  }
  // 方塊顏色的小星星（消除時的閃粉）
  function getStarCol(col) {
    const key = col[0] * 65536 + col[1] * 256 + col[2];
    let c = starColCache.get(key);
    if (c) return c;
    const base = getStar(), s = base.width;
    c = makeCanvas(s, s);
    const g = c.getContext('2d');
    g.drawImage(base, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = css(saturate(mixc(col, WHITE, 0.15), 0.6), 0.8); g.fillRect(0, 0, s, s);
    g.globalCompositeOperation = 'lighter';
    g.drawImage(base, s * 0.25, s * 0.25, s * 0.5, s * 0.5);     // 白色亮心
    starColCache.set(key, c);
    return c;
  }
  // 條紋光束的橫切面（h：橫的光束，漸層在垂直方向；v 反過來），畫的時候拉長
  function getBeam(col, dir) {
    const key = dir + col.join(',');
    let c = beamCache.get(key);
    if (c) return c;
    const L = 64, Wd = 4, h = dir === 'h';
    c = h ? makeCanvas(Wd, L) : makeCanvas(L, Wd);
    const g = c.getContext('2d');
    const gr = h ? g.createLinearGradient(0, 0, 0, L) : g.createLinearGradient(0, 0, L, 0);
    const cc = mixc(col, WHITE, 0.25);
    gr.addColorStop(0, css(cc, 0)); gr.addColorStop(0.3, css(cc, 0.6)); gr.addColorStop(0.5, 'rgba(255,255,255,1)');
    gr.addColorStop(0.7, css(cc, 0.6)); gr.addColorStop(1, css(cc, 0));
    g.fillStyle = gr; g.fillRect(0, 0, c.width, c.height);
    beamCache.set(key, c);
    return c;
  }
  // 方塊的白色剪影（消除瞬間的白光）
  function tileWhite(e) {
    if (e.white) return e.white;
    const src = e.full, c = makeCanvas(src.width, src.height), g = c.getContext('2d');
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    e.white = c;
    return c;
  }

  // ================= 預熱 =================
  // 第一次出現條紋 / 包裝 / 炸彈 / 連鎖字時才畫圖、上傳到 GPU 會卡一下；盤面閒著（等玩家出手）時先做好。
  // 每次最多做約 6ms，用 setTimeout 分批，不會擋住輸入。
  let warmQ = [], warmTimer = 0;
  function prewarm() {
    clearTimeout(warmTimer);
    warmQ = [];
    if (!rows || !cols || !W) return;
    const kinds = new Set();
    for (const v of visuals.values()) if (v.kind >= 0) kinds.add(v.kind);
    // 先做最常用到的：每次消除都會用的白光、粒子、連鎖字，再來才是特殊方塊
    warmQ.push(getFlash, getGlow, getStar);
    for (const k of kinds) warmQ.push(() => [tileWhite(getTile(k, 'none')), getStarCol(kindColor(k)), getFluff(kindColor(k))]);
    for (let lv = 2; lv <= 5; lv++) warmQ.push(() => wordSprite(cascadeSlogan(lv).text, lv).c);
    for (const sp of ['h', 'v', 'wrap']) for (const k of kinds) warmQ.push(() => getTile(k, sp).full);
    warmQ.push(() => { const e = getTile(-1, 'bomb'); return [e.under, e.orb, e.top, e.trio]; });
    warmTimer = setTimeout(pumpWarm, 250);
  }
  function pumpWarm() {
    warmTimer = 0;
    if (destroyed || !warmQ.length) return;
    if (busyCount > 0 || paused) { warmTimer = setTimeout(pumpWarm, 200); return; }
    const t0 = now();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 0.01;
    while (warmQ.length && now() - t0 < 6) {
      const f = warmQ.shift();
      try {
        const out = f();
        for (const img of Array.isArray(out) ? out : [out]) if (img && img.width) ctx.drawImage(img, 0, 0, 1, 1);
      } catch (e) { /* 預熱失敗沒關係，用到時再畫 */ }
    }
    ctx.restore();
    requestDraw();       // 下一幀整張重畫，蓋掉那幾個看不見的點
    if (warmQ.length) warmTimer = setTimeout(pumpWarm, 40);
  }

  // ================= 盤面同步 =================
  function make2D(r, c, v) { return Array.from({ length: r }, () => new Array(c).fill(v)); }
  function newVisual(p, r, c) {
    return { id: p.id, kind: p.kind, special: p.special || 'none', block: p.block || null, hp: p.hp | 0, r, c, mv: null,
      landT: -1e9, landAmp: 0, popT: -1e9, hideUntil: 0, morph: null, phase: Math.random() * Math.PI * 2 };
  }
  function cellV(q) { return q && cellMap[q.r] ? cellMap[q.r][q.c] || null : null; }
  function readMask(m, R, C) {
    const out = make2D(R, C, true);
    if (!m) return out;
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
      const row = m[r];
      if (row == null) continue;
      const v = typeof row === 'string' ? row[c] : row[c];
      out[r][c] = typeof v === 'string' ? v !== '.' : v !== false && v !== 0 && v != null;
    }
    return out;
  }
  function readJelly(j, R, C) {
    const out = make2D(R, C, 0);
    if (!j) return out;
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
      const row = j[r];
      if (row == null) continue;
      const v = row[c];
      out[r][c] = typeof v === 'string' ? (v === '.' ? 0 : parseInt(v, 10) || 0) : (v | 0);
    }
    return out;
  }
  // 動畫還在跑、而且終點就是這一格：保留（掉到一半的方塊繼續掉）；其他情況直接放到格子上
  function mvEndsAt(m, r, c) { return m && Math.abs(m.x1 - c) < 1e-6 && Math.abs(m.y1 - r) < 1e-6; }
  function syncBoard(grid, jel, lk) {
    if (!Array.isArray(grid) || !grid.length) return;
    const R = grid.length, C = (grid[0] || []).length;
    if (R !== rows || C !== cols) {
      rows = R; cols = C; mask = make2D(R, C, true); jelly = make2D(R, C, 0); locks = make2D(R, C, 0); geom();
    }
    if (Array.isArray(lk)) locks = lk.map(row => row.slice());
    const nv = new Map();
    cellMap = make2D(rows, cols, null);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const p = grid[r] && grid[r][c];
      if (!p) continue;
      let v = visuals.get(p.id);
      if (!v || nv.has(p.id)) v = newVisual(p, r, c);
      if (!mvEndsAt(v.mv, r, c)) v.mv = null;
      if (v.morph && (v.kind !== p.kind || v.special !== (p.special || 'none'))) v.morph = null;
      v.kind = p.kind; v.special = p.special || 'none'; v.block = p.block || null; v.hp = p.hp | 0; v.r = r; v.c = c;
      nv.set(p.id, v);
      cellMap[r][c] = v;
    }
    visuals = nv;
    if (jel) jelly = readJelly(jel, rows, cols);
  }
  function setBoard(snap) {
    if (destroyed) return;
    gen++;
    abortWaits();
    sched = []; ghosts = []; fx = []; parts = []; texts = []; praises = []; word = null; shakes = []; surpriseUsed = false;
    jellyFx.clear(); selected = null; hintPair = null; dragState = null;
    locks = []; exitCells = []; portalList = []; beltList = [];
    if (!snap || !snap.grid) { rows = 0; cols = 0; visuals = new Map(); cellMap = []; bgCache = null; requestDraw(); return; }
    const R = snap.rows || snap.grid.length, C = snap.cols || (snap.grid[0] || []).length;
    rows = R; cols = C;
    mask = readMask(snap.mask, R, C);
    jelly = readJelly(snap.jelly, R, C);
    locks = Array.isArray(snap.lock) ? snap.lock.map(row => (row || []).slice()) : make2D(R, C, 0);
    if (Array.isArray(snap.exits)) for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) if (snap.exits[r] && snap.exits[r][c]) exitCells.push({ r, c });
    if (Array.isArray(snap.portals)) portalList = snap.portals.filter(q => q && q.from && q.to).map(q => ({ from: { ...q.from }, to: { ...q.to } }));
    if (Array.isArray(snap.belts)) beltList = snap.belts.filter(b => Array.isArray(b) && b.length > 1).map(b => b.map(q => ({ r: q.r | 0, c: q.c | 0 })));
    visuals = new Map();
    syncBoard(snap.grid, null);
    if (!W) layout(); else geom();
    requestDraw();
    prewarm();
  }

  // ================= 時間 / 排程 =================
  function wait(ms) {
    requestDraw();
    return new Promise(res => {
      const w = { res, id: 0 };
      w.id = setTimeout(() => { waits.delete(w); res(); }, Math.max(0, ms));
      waits.add(w);
    });
  }
  function abortWaits() {
    for (const w of waits) { clearTimeout(w.id); w.res(); }
    waits.clear();
  }
  function at(t, fn) { sched.push({ t, fn }); requestDraw(); }
  function runSched(t) {
    if (!sched.length) return;
    let due = null;
    for (const e of sched) if (e.t <= t) (due || (due = [])).push(e);
    if (!due) return;
    sched = sched.filter(e => e.t > t);
    due.sort((a, b) => a.t - b.t);
    for (const e of due) { try { e.fn(e.t); } catch (err) { console.error('[renderer]', err); } }
  }
  function flushSched() {
    const all = sched;
    sched = [];
    all.sort((a, b) => a.t - b.t);
    for (const e of all) { try { e.fn(e.t); } catch (err) { console.error('[renderer]', err); } }
  }
  function shake(mag, dur, t0 = now()) { shakes.push({ mag, dur, t0 }); }
  // 音效 / 震動提示：delay 毫秒之後發生（音效那邊會照 AudioContext 的時鐘排好，和畫面對齊）
  function cue(name, delay = 0, data = null) {
    const o = curOpts;
    if (!o || typeof o.onCue !== 'function') return;
    try { o.onCue(name, Object.assign({ delay: Math.max(0, delay) }, data)); } catch (e) { console.error('[renderer] onCue', e); }
  }

  // ================= 粒子 =================
  function emit(p) {
    if (parts.length >= MAX_PARTS) parts.splice(0, parts.length - MAX_PARTS + 1);
    parts.push(p);
  }
  // 小愛心（方塊顏色，左上一點亮光）
  const heartCache = new Map();
  function getHeart(col) {
    const key = col.join(',');
    let c = heartCache.get(key);
    if (c) return c;
    const n = 48, h = n / 2;
    c = makeCanvas(n, n);
    const g = c.getContext('2d'), k = saturate(mixc(col, WHITE, 0.1), 0.5);
    candyPath(g, 'heart', h, h, n * 0.42);
    const hg = g.createLinearGradient(0, n * 0.1, 0, n * 0.9);
    hg.addColorStop(0, css(mixc(k, WHITE, 0.45))); hg.addColorStop(1, css(mixc(k, BLACK, 0.08)));
    g.fillStyle = hg; g.fill();
    g.lineWidth = n * 0.06; g.strokeStyle = 'rgba(255,255,255,0.95)'; g.stroke();
    g.beginPath(); g.ellipse(h - n * 0.14, h - n * 0.12, n * 0.08, n * 0.05, -0.6, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,255,255,0.9)'; g.fill();
    heartCache.set(key, c);
    return c;
  }
  // 細碎閃粉（很小的四角星）
  let glitterImg = null;
  function getGlitter() {
    if (glitterImg) return glitterImg;
    const n = 24, h = n / 2, c = makeCanvas(n, n), g = c.getContext('2d');
    g.beginPath();
    g.moveTo(h, 1); g.quadraticCurveTo(h, h, n - 1, h); g.quadraticCurveTo(h, h, h, n - 1); g.quadraticCurveTo(h, h, 1, h); g.quadraticCurveTo(h, h, h, 1);
    g.fillStyle = '#fff6c8'; g.fill();
    g.lineWidth = 1; g.strokeStyle = 'rgba(230,150,40,0.85)'; g.stroke();
    glitterImg = c;
    return c;
  }
  // 消除爆開的粒子（帶重力、慢慢淡出）：方塊顏色的棉花團 + 蓬鬆白棉花球 + 圓潤星星 + 小愛心 + 細碎閃粉。
  // 粒子造型（衣櫃的「消除特效」）照 particleSkin 換
  let particleSkin = 'default';
  function burst(x, y, col, n, t, { speed = 3.4, stars = 2, up = 0.8 } = {}) {
    const skin = PARTICLE_SKINS[particleSkin] || PARTICLE_SKINS.default;
    skin(x, y, col, n, t, speed, stars, up);
  }
  // 櫻花花瓣、彩虹泡泡、金粉亮片
  let petalImg = null;
  function getPetal() {
    if (petalImg) return petalImg;
    const n = 40, c = makeCanvas(n, n), g = c.getContext('2d');
    g.translate(n / 2, n / 2);
    g.beginPath(); g.moveTo(0, -n * 0.42);
    g.bezierCurveTo(n * 0.36, -n * 0.3, n * 0.3, n * 0.3, 0, n * 0.42);
    g.bezierCurveTo(-n * 0.3, n * 0.3, -n * 0.36, -n * 0.3, 0, -n * 0.42);
    const pg = g.createLinearGradient(0, -n * 0.4, 0, n * 0.4);
    pg.addColorStop(0, '#fff0f6'); pg.addColorStop(0.5, '#ffc1d9'); pg.addColorStop(1, '#ff8fb8');
    g.fillStyle = pg; g.fill(); g.lineWidth = 1.5; g.strokeStyle = 'rgba(230,100,150,0.7)'; g.stroke();
    g.beginPath(); g.moveTo(-n * 0.06, -n * 0.42); g.lineTo(0, -n * 0.32); g.lineTo(n * 0.06, -n * 0.42); g.fillStyle = '#fff'; g.fill();
    petalImg = c;
    return c;
  }
  const bubbleCache = new Map();
  function getBubble(hue) {
    hue = Math.round(hue / 30) * 30 % 360;
    let c = bubbleCache.get(hue);
    if (c) return c;
    const n = 48, h = n / 2;
    c = makeCanvas(n, n);
    const g = c.getContext('2d'), rg = g.createRadialGradient(h, h, h * 0.55, h, h, h * 0.95);
    rg.addColorStop(0, `hsla(${hue},100%,85%,0.08)`); rg.addColorStop(0.8, `hsla(${hue},95%,70%,0.55)`); rg.addColorStop(1, `hsla(${(hue + 60) % 360},95%,70%,0)`);
    g.beginPath(); g.arc(h, h, h * 0.92, 0, Math.PI * 2); g.fillStyle = rg; g.fill();
    g.lineWidth = 3; g.strokeStyle = `hsla(${hue},92%,58%,0.95)`; g.stroke();
    g.beginPath(); g.ellipse(h - h * 0.32, h - h * 0.36, h * 0.2, h * 0.11, -0.7, 0, Math.PI * 2); g.fillStyle = 'rgba(255,255,255,0.9)'; g.fill();
    bubbleCache.set(hue, c);
    return c;
  }
  let sequinImg = null;
  function getSequin() {
    if (sequinImg) return sequinImg;
    const n = 32, h = n / 2, c = makeCanvas(n, n), g = c.getContext('2d');
    g.beginPath();
    for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; const x = h + Math.cos(a) * h * 0.85, y = h + Math.sin(a) * h * 0.85; if (k) g.lineTo(x, y); else g.moveTo(x, y); }
    g.closePath();
    const sg = g.createLinearGradient(0, 0, n, n);
    sg.addColorStop(0, '#fff8c8'); sg.addColorStop(0.45, '#ffd23c'); sg.addColorStop(1, '#c88200');
    g.fillStyle = sg; g.fill(); g.lineWidth = 1.5; g.strokeStyle = '#8a5200'; g.stroke();
    g.beginPath(); g.arc(h - h * 0.25, h - h * 0.25, h * 0.16, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
    sequinImg = c;
    return c;
  }
  const PARTICLE_SKINS = {
    // 櫻花花瓣雨：粉紅花瓣往外散開、慢慢旋轉飄落 + 一點粉色棉花
    sakura(x, y, col, n, t, speed) {
      const pt = getPetal(), fl = getFluff([255, 190, 215]);
      for (let i = 0; i < n + 2; i++) {
        const a = Math.random() * Math.PI * 2, v = speed * (0.4 + Math.random() * 0.6);
        emit({ type: 1, img: pt, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1.2, g: 2.2, drag: 2.6, t0: t,
          life: 700 + Math.random() * 400, size: 0.26 + Math.random() * 0.14, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 7 });
      }
      for (let i = 0; i < Math.ceil(n / 3); i++) {
        const a = Math.random() * Math.PI * 2, v = speed * (0.4 + Math.random() * 0.6);
        emit({ type: 0, img: fl, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.6, g: 5, drag: 2.4, t0: t, life: 380 + Math.random() * 200, size: 0.14 + Math.random() * 0.1 });
      }
    },
    // 彩虹愛心泡泡：各種顏色的透明泡泡往上飄 + 小愛心
    bubbles(x, y, col, n, t, speed) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, v = speed * (0.3 + Math.random() * 0.5);
        emit({ type: 1, img: getBubble(Math.random() * 360), x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1.5, g: -1.6, drag: 2.2, t0: t,
          life: 650 + Math.random() * 350, size: 0.22 + Math.random() * 0.22 });
      }
      const hc = getHeart(col);
      for (let i = 0; i < (n >= 6 ? 3 : 1); i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, v = speed * (0.5 + Math.random() * 0.4);
        emit({ type: 1, img: hc, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1, g: 1.5, drag: 2.2, t0: t,
          life: 600 + Math.random() * 260, size: 0.26 + Math.random() * 0.1, rot: (Math.random() - 0.5) * 0.6, vr: (Math.random() - 0.5) * 3 });
      }
    },
    // 奢華金粉亮片：金色亮片翻轉著噴出來、重重地落下，加上閃閃發亮的金粉
    gold(x, y, col, n, t, speed, stars) {
      const sq = getSequin(), gl = getGlitter(), st = getStarCol(SPARK_GOLD);
      for (let i = 0; i < n + 2; i++) {
        const a = Math.random() * Math.PI * 2, v = speed * (0.5 + Math.random() * 0.8);
        emit({ type: 1, img: sq, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1.4, g: 9, drag: 2, t0: t,
          life: 520 + Math.random() * 300, size: 0.16 + Math.random() * 0.12, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 12 });
      }
      for (let i = 0; i < 5; i++) {
        const a = Math.random() * Math.PI * 2, v = speed * (0.6 + Math.random() * 0.9);
        emit({ type: 1, img: gl, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.8, g: 5, drag: 3, t0: t + Math.random() * 80, life: 420 + Math.random() * 260, size: 0.14 + Math.random() * 0.1 });
      }
      for (let i = 0; i < stars; i++) {
        const a = Math.random() * Math.PI * 2, v = speed * (0.35 + Math.random() * 0.6);
        emit({ type: 1, img: st, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.5, g: 2.5, drag: 2.8, t0: t, life: 420 + Math.random() * 280, size: 0.3 + Math.random() * 0.2 });
      }
    },
    default(x, y, col, n, t, speed, stars, up) {
      const fl = getFluff(col), cotton = getFluff([255, 248, 252]), sc = getStarCol(col);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, v = speed * (0.45 + Math.random() * 0.75);
        emit({ type: 0, img: i % 3 === 2 ? cotton : fl, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - up, g: 7, drag: 2.4, t0: t,
          life: 380 + Math.random() * 260, size: (i % 3 === 2 ? 0.17 : 0.14) + Math.random() * 0.14 });
      }
      for (let i = 0; i < stars; i++) {
        const a = Math.random() * Math.PI * 2, v = speed * (0.35 + Math.random() * 0.6);
        emit({ type: 1, img: sc, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - up * 0.6, g: 2.5, drag: 2.8, t0: t,
          life: 420 + Math.random() * 280, size: 0.3 + Math.random() * 0.2 });
      }
      if (n >= 4) {
        const hc = getHeart(col);
        for (let i = 0; i < (n >= 8 ? 2 : 1); i++) {
          const a = -Math.PI / 2 + (Math.random() - 0.5) * 2, v = speed * (0.5 + Math.random() * 0.4);
          emit({ type: 1, img: hc, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - up, g: 4.5, drag: 2.2, t0: t,
            life: 520 + Math.random() * 240, size: 0.26 + Math.random() * 0.1, rot: (Math.random() - 0.5) * 0.6, vr: (Math.random() - 0.5) * 3 });
        }
      }
      const gl = getGlitter();
      for (let i = 0; i < Math.min(4, Math.ceil(n / 2)); i++) {
        const a = Math.random() * Math.PI * 2, v = speed * (0.6 + Math.random() * 0.9);
        emit({ type: 1, img: gl, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - up * 0.5, g: 5, drag: 3, t0: t + Math.random() * 60,
          life: 360 + Math.random() * 260, size: 0.12 + Math.random() * 0.1 });
      }
    },
  };
  function sparkle(x, y, n, t, spread = 0.5) {
    const st = getStarCol(SPARK_GOLD);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = 1 + Math.random() * 2.4;
      emit({ type: 1, img: st, x: x + Math.cos(a) * spread * Math.random(), y: y + Math.sin(a) * spread * Math.random(),
        vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.6, g: 1.5, drag: 3, t0: t + Math.random() * 90,
        life: 380 + Math.random() * 320, size: 0.25 + Math.random() * 0.28 });
    }
  }

  // ================= 事件動畫 =================
  // 每個 anim* 回傳的 Promise 在「下一個事件可以開始」的時候 resolve，不是等畫面全部播完
  async function animSwap(ev, back, next) {
    const t = now();
    const bad = !back && next && next.t === 'swapBack';
    const dur = back ? SWAP_BACK_MS : bad ? SWAP_BAD_MS : SWAP_MS;
    const va = cellV(ev.a), vb = cellV(ev.b);
    const pairs = [[va, ev.b, true], [vb, ev.a, false]];
    for (const [v, to, main] of pairs) {
      if (!v || !to) continue;
      const cur = evalVisual(v, t);
      v.mv = { x0: cur.x, y0: cur.y, x1: to.c, y1: to.r, t0: t, dur,
        ease: back ? easeSwapBack : bad ? easeOutCubic : main ? easeSwap : easeOutCubic,
        lift: main ? (back ? 0.06 : 0.16) : -0.06, top: main };
    }
    dragState = null;
    if (back) cue('invalid');
    else cue('swap', 0, { bad: !!bad });
    // 成功的交換：回彈快結束時就開始爆（爆的那一下剛好落在停穩的瞬間）
    await wait(back ? dur + 8 : bad ? dur : dur - 18);
    if (back) {
      const tt = now();
      for (const v of [va, vb]) if (v) { v.landT = tt; v.landAmp = 0.1; }
    }
  }

  async function animTransform(ev) {
    const cells = (ev.cells || []).filter(Boolean);
    const n = cells.length;
    if (!n) return;
    const stagger = Math.min(55, 420 / n), t = now();
    cells.forEach((cl, i) => at(t + i * stagger, tt => {
      const p = cl.piece;
      if (!p) return;
      const old = cellV(cl);
      let v = old && old.id === p.id ? old : null;
      if (old && !v) visuals.delete(old.id);
      if (!v) { v = visuals.get(p.id) || newVisual(p, cl.r, cl.c); visuals.set(p.id, v); }
      v.kind = p.kind; v.special = p.special || 'none'; v.r = cl.r; v.c = cl.c; v.mv = null; v.popT = tt;
      v.morph = null; v.hideUntil = 0;
      if (cellMap[cl.r]) cellMap[cl.r][cl.c] = v;
      fx.push({ type: 'flash', x: cl.c + 0.5, y: cl.r + 0.5, t0: tt, dur: 300, R: 0.95 });
      burst(cl.c + 0.5, cl.r + 0.5, kindColor(p.kind), 4, tt, { speed: 2.2, stars: 3 });
    }));
    // 過關後剩下的步數一步一步變特效：play(events, { sugarStep }) 每步至少停 sugarStep 毫秒，看得清楚一顆一顆變
    const hold = ev.sugar && curOpts && curOpts.sugarStep > 220 ? curOpts.sugarStep : 220;
    await wait((n - 1) * stagger + hold);
    flushSched();
  }

  // 每個效果什麼時候碰到某一格（毫秒），-1 = 碰不到
  function bombStagger(n) { return Math.min(30, 420 / Math.max(1, n)); }
  function travel(e, r, c) {
    switch (e.fx) {
      case 'line':
        if (e.dir === 'h') return r === e.r ? Math.abs(c - e.c) * LINE_MS : -1;
        return c === e.c ? Math.abs(r - e.r) * LINE_MS : -1;
      case 'blast': {
        const d = Math.max(Math.abs(r - e.r), Math.abs(c - e.c));
        return d <= (e.radius == null ? 1 : e.radius) ? d * BLAST_MS : -1;
      }
      case 'bomb': {
        const ts = e.targets || [];
        const i = ts.findIndex(q => q && q.r === r && q.c === c);
        return i < 0 ? -1 : BOMB_FIRST + i * bombStagger(ts.length);
      }
      case 'board': return Math.hypot(r - (rows - 1) / 2, c - (cols - 1) / 2) * BOARD_MS;
      case 'fish': return e.to && r === e.to.r && c === e.to.c ? fishMs(e) : -1;
    }
    return -1;
  }

  // 兩個特殊方塊合體：先吸在一起、放大、震動（條紋 + 包裝放大到 3 倍），再發動
  const CHARGE = { 'h+wrap': [320, 3], 'v+wrap': [320, 3], 'wrap+wrap': [280, 2.6], 'h+h': [190, 2], 'h+v': [190, 2], 'v+v': [190, 2],
    'bomb+bomb': [300, 2.6], 'bomb+h': [240, 2.2], 'bomb+v': [240, 2.2], 'bomb+wrap': [260, 2.4], 'bomb+fish': [240, 2.2],
    'fish+h': [220, 2.2], 'fish+v': [220, 2.2], 'fish+wrap': [240, 2.4], 'fish+fish': [200, 2] };
  async function animClear(ev) {
    const removed = (ev.removed || []).filter(Boolean), effects = (ev.effects || []).filter(Boolean);
    const comboPair = (ev.cascade | 0) <= 1 ? removed.filter(it => it.cause === 'combo' && it.piece && it.piece.special && it.piece.special !== 'none') : [];
    let charge = null;
    if (comboPair.length >= 2 && effects.length) {
      const key2 = comboPair.slice(0, 2).map(it => it.piece.special).sort().join('+'), c = CHARGE[key2];
      if (c) {
        const ctr = effects.find(e => e.fx !== 'board' && e.r != null) || comboPair[1];
        charge = { dur: c[0], S: c[1], at: { r: ctr.r, c: ctr.c }, ids: new Set(comboPair.slice(0, 2).map(it => it.piece.id)), t: now() };
        shake(2.2, c[0], charge.t);
        cue('combo', 0);
      }
    }
    const t0 = now() + (charge ? charge.dur : 0);
    const groups = (ev.groups || []).filter(g => g && Array.isArray(g.cells)), created = (ev.created || []).filter(Boolean);
    const cascade = Math.max(1, ev.cascade | 0);
    const key = (r, c) => r * 1024 + c;
    const remAt = new Map();
    for (const it of removed) remAt.set(key(it.r, it.c), it);

    // --- 好幾組消除時一組接一組爆（36ms），音高一組比一組高 ---
    const matchT = new Map();
    const seqCells = g => g.cells.slice().sort((a, b) => (a.r - b.r) || (a.c - b.c));   // 沿著那一排的順序
    groups.forEach((g, i) => {
      seqCells(g).forEach((q, j) => {
        const k = key(q.r, q.c), tm = i * GROUP_STAGGER + j * POP_SEQ;
        if (!matchT.has(k) || matchT.get(k) > tm) matchT.set(k, tm);
      });
    });

    // --- 效果的啟動時間：被別的效果波及的特殊方塊，等波及到了才發動 ---
    const E = effects.map(e => ({ e, r: e.r, c: e.c, start: Infinity, board: e.fx === 'board' }));
    for (const x of E) {
      const it = x.board ? null : remAt.get(key(x.r, x.c));
      if (x.board || !it || it.cause === 'match' || it.cause === 'combo') x.start = x.board ? 0 : (matchT.get(key(x.r, x.c)) || 0);
    }
    for (let iter = 0; iter < 10; iter++) {
      let changed = false;
      for (const x of E) {
        if (x.start === 0) continue;
        let best = x.start;
        for (const y of E) {
          if (y === x || y.start === Infinity) continue;
          const tr = travel(y.e, x.r, x.c);
          if (tr >= 0 && y.start + tr + CHAIN_MS < best) best = y.start + tr + CHAIN_MS;
        }
        if (best < x.start) { x.start = best; changed = true; }
      }
      if (!changed) break;
    }
    for (const x of E) if (x.start === Infinity) x.start = 0;

    // --- 每顆被消掉的方塊什麼時候爆 ---
    const remT = new Map();
    // 被打到的時間：配對的那一刻、效果掃到的那一刻；旁邊的配對（糖霜 / 巧克力 / 甘草）跟著鄰格一起
    const hitAt = (r, c, cause) => {
      const k = key(r, c);
      let tm = cause === 'match' || cause === 'any' ? (matchT.has(k) ? matchT.get(k) : Infinity) : Infinity;
      for (const x of E) {
        const tr = travel(x.e, r, c);
        if (tr >= 0) tm = Math.min(tm, x.start + tr);
      }
      if (tm === Infinity && (cause === 'near' || cause === 'any'))
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = key(r + dr, c + dc); if (matchT.has(n)) tm = Math.min(tm, matchT.get(n) + 40); }
      return tm === Infinity ? 0 : tm;
    };
    for (const it of removed) remT.set(key(it.r, it.c), hitAt(it.r, it.c, it.cause));
    const unlocks = (ev.unlocks || []).filter(Boolean), bhits = (ev.blockerHits || []).filter(Boolean);
    for (const q of unlocks) remT.set(key(q.r, q.c), Math.max(remT.get(key(q.r, q.c)) || 0, hitAt(q.r, q.c, 'any')));
    for (const q of bhits) remT.set(key(q.r, q.c), Math.max(remT.get(key(q.r, q.c)) || 0, hitAt(q.r, q.c, 'any')));
    for (const x of E) {     // 彩色炸彈本身等閃電放完才消失
      if (x.e.fx !== 'bomb') continue;
      const n = (x.e.targets || []).length, k = key(x.r, x.c);
      if (remAt.has(k)) remT.set(k, Math.max(remT.get(k), x.start + BOMB_FIRST + n * bombStagger(n) + 50));
    }
    let maxT = 0;
    for (const v of remT.values()) maxT = Math.max(maxT, v);
    for (const x of E) maxT = Math.max(maxT, x.start);
    const f = maxT > CLEAR_CAP ? CLEAR_CAP / maxT : 1;
    const tOf = (r, c) => (remT.get(key(r, c)) || 0) * f;

    // --- 合成特殊方塊的那一組，會先往新方塊的位置吸過去 ---
    const mergeTo = new Map();
    for (const cr of created) {
      for (const g of groups) {
        if (!g.cells.some(q => q.r === cr.r && q.c === cr.c)) continue;
        for (const q of g.cells) if (q.r !== cr.r || q.c !== cr.c) mergeTo.set(key(q.r, q.c), cr);
      }
    }

    // --- 方塊變成「殘影」播放消失動畫（位置用畫面上目前的位置）---
    let lastPop = 0;
    const heavy = removed.length > 24;
    for (const it of removed) {
      const v = (it.piece && visuals.get(it.piece.id)) || cellV(it);
      const p = it.piece || v;
      if (!p) continue;
      let gx = it.c, gy = it.r, phase = 0;
      if (v) {
        const st = evalVisual(v, t0);
        if (Math.abs(st.x - it.c) + Math.abs(st.y - it.r) > 0.12) { gx = st.x; gy = st.y; }
        phase = v.phase;
        visuals.delete(v.id);
        if (cellMap[it.r] && cellMap[it.r][it.c] === v) cellMap[it.r][it.c] = null;
      }
      const k = key(it.r, it.c);
      const m = it.cause === 'match' ? mergeTo.get(k) : null;
      const tm = tOf(it.r, it.c);
      const ch = charge && it.piece && charge.ids.has(it.piece.id) ? { t: charge.t, dur: charge.dur, S: charge.S, x: charge.at.c, y: charge.at.r } : null;
      ghosts.push({ kind: p.kind, special: p.special || 'none', block: p.block || null, hp: p.hp | 0, x: gx, y: gy, t0: t0 + tm,
        dur: m ? MERGE_MS : POP_MS, to: m ? { x: m.c, y: m.r } : null, fired: false, heavy, phase, charge: ch });
      if (p.block) cue(p.block === 'frost' ? 'frost' : p.block === 'choco' ? 'choco' : p.block === 'alarm' ? 'alarmoff' : p.block === 'shell' ? 'shell' : 'swirl', tm + POP_HIT, { r: it.r, c: it.c });
      lastPop = Math.max(lastPop, tm);
    }

    // --- 告訴 main.js 每一顆 / 每一格果凍什麼時候爆（收集目標要從那裡飛到上面的目標圖示）---
    for (const it of removed) {
      const p = it.piece;
      if (p && p.kind >= 0) cue('gone', tOf(it.r, it.c) + POP_HIT, { r: it.r, c: it.c, kind: p.kind });
    }
    for (const jh of ev.jellyHits || []) if (jh) cue('jellyhit', tOf(jh.r, jh.c) + POP_HIT, { r: jh.r, c: jh.c });

    // --- 鐵籠子打開：籠子裂成兩半飛走，玩偶留在原地；保鮮膜拆開也一樣，裡面的特殊方塊留著 ---
    for (const q of unlocks) {
      const tm = tOf(q.r, q.c), gift = !!q.gift;
      at(t0 + tm, tt => {
        if (locks[q.r]) locks[q.r][q.c] = 0;
        fx.push({ type: 'cagebreak', spr: gift ? 'wrap' : 'cage', r: q.r, c: q.c, t0: tt, dur: 560 });
        crumbs(q.c + 0.5, q.r + 0.5, gift ? 'wrap' : 'cage', 1, tt, 7);
        sparkle(q.c + 0.5, q.r + 0.5, gift ? 8 : 5, tt, 0.35);
        const v = cellV(q);
        if (v) { v.landT = tt; v.landAmp = gift ? 0.18 : 0.12; }
      });
      cue(gift ? 'gift' : 'cage', tm, { r: q.r, c: q.c });
    }
    // --- 多層糖霜 / 硬殼掉一層：碎屑 + 壓扁回彈，換成少一層的樣子 ---
    for (const q of bhits) {
      const tm = tOf(q.r, q.c);
      at(t0 + tm, tt => {
        const v = cellV(q);
        crumbs(q.c + 0.5, q.r + 0.5, q.block === 'shell' ? 'shell' : 'frost', (q.left | 0) + 1, tt, 10);
        if (v) { v.hp = q.left | 0; v.landT = tt; v.landAmp = 0.16; }
      });
      cue(q.block === 'shell' ? 'shell' : 'frost', tm, { r: q.r, c: q.c });
    }

    // --- 特效 ---
    for (const x of E) {
      const st = x.start * f, at0 = t0 + st, e = x.e;
      const src = x.board ? null : remAt.get(key(x.r, x.c));
      const sk = src && src.piece ? src.piece.kind : -1;
      const col = sk >= 0 ? kindColor(sk) : [255, 226, 140];
      if (e.fx === 'line') {
        const h = e.dir !== 'v';
        fx.push({ type: 'beam', dir: h ? 'h' : 'v', r: e.r, c: e.c, t0: at0, dur: 420, col, lim: Array.isArray(e.reach) ? e.reach : null,
          sweep: Math.max(1, (h ? cols : rows)) * LINE_MS * f });
        fx.push({ type: 'flash', x: e.c + 0.5, y: e.r + 0.5, t0: at0, dur: 260, R: 1.25 });
        shake(2.5, 200, at0);
        cue('stripe', st, { dir: e.dir });
      } else if (e.fx === 'blast') {
        const rad = e.radius == null ? 1 : e.radius;
        fx.push({ type: 'ring', x: e.c + 0.5, y: e.r + 0.5, R: rad + 0.9, t0: at0, dur: 420, col });
        shake(3.5 + 1.5 * (rad - 1), 260, at0);
        at(at0, tt => sparkle(e.c + 0.5, e.r + 0.5, 8 + rad * 4, tt, rad));
        cue('wrap', st, { radius: rad });
      } else if (e.fx === 'bomb') {
        const ts = (e.targets || []).filter(Boolean);
        const stg = bombStagger(ts.length) * f;
        fx.push({ type: 'bolts', x: e.c + 0.5, y: e.r + 0.5, targets: ts.map(q => ({ x: q.c + 0.5, y: q.r + 0.5 })),
          t0: at0, first: BOMB_FIRST * f, stagger: stg, end: at0 + BOMB_FIRST * f + ts.length * stg + 220 });
        shake(4, 380, at0);
        cue('bomb', st, { n: ts.length });
      } else if (e.fx === 'fish' && e.to) {
        const dur = fishMs(e) * f, x1 = e.to.c + 0.5, y1 = e.to.r + 0.5;
        fx.push({ type: 'wingfly', kind: sk, x0: e.c + 0.5, y0: e.r + 0.5, x1, y1, t0: at0, dur, carry: e.carry || null,
          seed: (e.to.r * 31 + e.to.c * 7 + e.r) % 2 ? 1 : -1, lastEmit: 0 });
        // 俯衝撞到目標：一圈可愛的爆炸光波 + 閃光 + 星星，盤面輕輕一震
        at(at0 + dur, tt => {
          fx.push({ type: 'ring', x: x1, y: y1, R: 1.5, t0: tt, dur: 460, col: RING_GOLD });
          fx.push({ type: 'pring', x: x1, y: y1, t0: tt + 60, dur: 380, col: RING_BLUE, R: 1.3 });
          fx.push({ type: 'flash', x: x1, y: y1, t0: tt, dur: 300, R: 1.3 });
          sparkle(x1, y1, 10, tt, 0.35);
          shake(3, 200, tt);
        });
        cue('fish', st, { carry: e.carry || null, dur });
      } else if (e.fx === 'board') {
        fx.push({ type: 'boardfx', t0: at0, dur: 800 });
        shake(9, 560, at0);
        cue('board', st);
      }
    }
    if (!charge && removed.some(r => r.cause === 'combo')) cue('combo', 0);

    // --- 消除音效：每一顆碎開的那一刻「咔啦」一聲（殘影放大變白之後才碎：POP_MS 的 30%），音一顆比一顆高 ---
    groups.forEach((g, i) => {
      seqCells(g).forEach((q, j) => {
        const tm = (remT.has(key(q.r, q.c)) ? tOf(q.r, q.c) : (i * GROUP_STAGGER + j * POP_SEQ) * f) + POP_HIT;
        cue('pop', tm, { cascade, group: i, idx: j, size: g.cells.length, shape: g.shape });
      });
    });

    // --- 新的特殊方塊：狀態馬上放好（下一次掉落可能就要移動它），畫面到時間才變身 ---
    for (const cr of created) {
      if (!cr.piece) continue;
      const k = key(cr.r, cr.c), p = cr.piece;
      let merged = false;
      for (const v of mergeTo.values()) if (v === cr) { merged = true; break; }
      let tm = merged ? (matchT.get(k) || 0) * f + MERGE_MS - 10 : 90;
      if (remT.has(k)) tm = Math.max(tm, tOf(cr.r, cr.c) + 110);
      const old = cellV(cr);
      const keep = old && old.id === p.id ? old : null;
      if (old && !keep) visuals.delete(old.id);
      const v = keep || visuals.get(p.id) || newVisual(p, cr.r, cr.c);
      if (keep) { v.morph = { kind: keep.kind, special: keep.special, until: t0 + tm }; v.hideUntil = 0; }
      else { v.morph = null; v.hideUntil = t0 + tm; }
      v.kind = p.kind; v.special = p.special || 'none'; v.r = cr.r; v.c = cr.c; v.mv = null; v.popT = t0 + tm;
      visuals.set(p.id, v);
      if (cellMap[cr.r]) cellMap[cr.r][cr.c] = v;
      at(t0 + tm, tt => {
        fx.push({ type: 'flash', x: cr.c + 0.5, y: cr.r + 0.5, t0: tt, dur: 360, R: 1.4 });
        fx.push({ type: 'pring', x: cr.c + 0.5, y: cr.r + 0.5, t0: tt, dur: 320, col: kindColor(p.kind), R: 0.95 });
        sparkle(cr.c + 0.5, cr.r + 0.5, 10, tt, 0.3);
      });
      cue('special', tm, { special: p.special });
      shake(p.special === 'bomb' ? 4.5 : 3, 210, t0 + tm);     // 四消 / 五消 / L、T：做出特殊方塊的那一下也震一下
    }

    // --- 果凍 ---
    for (const jh of ev.jellyHits || []) {
      if (!jh) continue;
      at(t0 + tOf(jh.r, jh.c), tt => {
        if (!jelly[jh.r]) return;
        const from = jelly[jh.r][jh.c] || 0, left = Math.min(from, jh.left | 0);
        jelly[jh.r][jh.c] = left;
        if (left < from) jellyFx.set(key(jh.r, jh.c), { t0: tt, from });
        iceBurst(jh.c + 0.5, jh.r + 0.5, tt);                      // 清脆的碎冰
      });
    }

    // --- 飄分 ---
    // 同一次消除裡上下左右相鄰的分數（例如配對分數和底下每格果凍的 +100）合成一個，放在它們中間；
    // 不然相鄰兩格的「+700」「+420」會黏成看起來像「+700420」的錯誤大數字。出現時 addText 再避開還在飄的分數。
    const pts = (ev.points || []).filter(pt => pt && Number.isFinite(pt.value));
    const ptAt = new Map(pts.map((pt, i) => [key(pt.r, pt.c), i]));
    const kindAt = pt => {
      const it = remAt.get(key(pt.r, pt.c));
      let kind = it && it.piece ? it.piece.kind : -1;
      if (kind < 0) {
        const g = groups.find(gg => gg.cells.some(q => q.r === pt.r && q.c === pt.c));
        if (g) kind = g.kind;
      }
      return kind;
    };
    const seen = new Set();
    for (let i = 0; i < pts.length; i++) {
      if (seen.has(i)) continue;
      const comp = [i];
      seen.add(i);
      for (let j = 0; j < comp.length; j++) {
        const q = pts[comp[j]];
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const n = ptAt.get(key(q.r + dr, q.c + dc));
          if (n !== undefined && !seen.has(n)) { seen.add(n); comp.push(n); }
        }
      }
      let value = 0, sr = 0, sc = 0, tm = Infinity, top = null;
      for (const n of comp) {
        const q = pts[n];
        value += q.value; sr += q.r; sc += q.c;
        tm = Math.min(tm, tOf(q.r, q.c));
        if (!top || q.value > top.value) top = q;
      }
      const kind = kindAt(top);
      const x = sc / comp.length + 0.5, y = sr / comp.length + 0.5;
      at(t0 + Math.min(520, tm) + 70, tt => addText('+' + value, x, y, tt,
        kind >= 0 ? kindColor(kind) : [255, 170, 60], value >= 200));
    }

    // 口號（js/slogans.js）：連鎖第 2/3/4/5+ 步；組合技；很大的一步偶爾來一張照片驚喜（每關最多一次）
    const isCombo = removed.some(it => it.cause === 'combo') || effects.some(e => e.fx === 'board');
    if (cascade <= 1) moveVoiced = false;                       // 新的一步
    const canSpeak = lvl => lvl >= 3 && !moveVoiced && now() - lastVoiceAt >= VOICE_GAP;
    if (cascade >= 4 && !surpriseUsed && SLOGANS.surprise.length && Math.random() < 0.4) {
      surpriseUsed = true;
      const sl = SLOGANS.surprise[Math.floor(Math.random() * SLOGANS.surprise.length)];
      showWord(sl.text, 5, sl, canSpeak(5));
    } else if (cascade >= 2) {
      const sl = cascadeSlogan(cascade);
      if (sl) showWord(sl.text, cascade, sl, canSpeak(cascade));
    } else if (isCombo) {
      showWord(SLOGANS.combo.text, 4, SLOGANS.combo, canSpeak(4));
    }
    if (cascade >= 2) cue('chime', 40, { level: cascade + 1 });   // 每次跳口號都叮咚一下
    // 稱讚字：在消除的地方彈出來（2 連消以上、或特殊組合），連越多字越大、越華麗
    if (cascade >= 2 || isCombo) {
      let sx = 0, sy = 0;
      for (const it of removed) { sx += it.c; sy += it.r; }
      const n = removed.length || 1;
      addPraise(Math.max(cascade, isCombo ? 4 : 2), removed.length ? sx / n + 0.5 : cols / 2, removed.length ? sy / n + 0.5 : rows / 2, t0 + 140);
    }
    if (cascade >= 2) shake(Math.min(5, 2.8 + 0.55 * (cascade - 2)), 230, t0 + 40);   // 2 連消以上：盤面微微一震（3~5px）
    // 最後一顆開始爆之後一下下就讓上面的方塊開始掉（爆的動畫在背景收尾）
    await wait(t0 + lastPop + POP_LEAD - now());
  }

  // 掉落中的方塊：位置、速度（重力加速度：v += g·dt）。有 pts 的是沿著折線走（斜向滑落），用走過的距離算位置
  function fallState(m, t) {
    const dt = t - m.t0, g = m.g || G_FALL;
    if (m.pts) {
      const len = m.len;
      if (dt <= 0) return { s: 0, vel: 0, done: false, ...along(m, 0) };
      if (dt >= m.dur) return { s: len, vel: 0, done: true, ...along(m, len) };
      const d = m.v0 * dt + 0.5 * g * dt * dt;
      return { s: d, vel: m.v0 + g * dt, done: false, ...along(m, d) };
    }
    if (dt <= 0) return { y: m.y0, vel: 0, done: false };
    if (dt >= m.dur) return { y: m.y1, vel: 0, done: true };
    return { y: m.y0 + m.v0 * dt + 0.5 * g * dt * dt, vel: m.v0 + g * dt, done: false };
  }
  function polyline(pts) {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + (pts[i].jump ? 0 : Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)));
    return { pts, cum, len: cum[cum.length - 1] };
  }
  function along(m, d) {
    const { pts, cum } = m;
    if (d <= 0) return { x: pts[0].x, y: pts[0].y };
    for (let i = 1; i < pts.length; i++) {
      if (d <= cum[i]) { const k = (d - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]); return { x: lerp(pts[i - 1].x, pts[i].x, k), y: lerp(pts[i - 1].y, pts[i].y, k) }; }
    }
    const q = pts[pts.length - 1];
    return { x: q.x, y: q.y };
  }
  function fallDur(dist, v0, g = G_FALL) { return dist <= 0 ? 1 : (-v0 + Math.sqrt(v0 * v0 + 2 * g * dist)) / g; }
  function topCell(c) { for (let r = 0; r < rows; r++) if (mask[r] && mask[r][c]) return r; return 0; }

  async function animFall(ev, next) {
    const t = now();
    const seq = ++fallSeq;
    // play(events, { slowFall: k })：慢 k 倍播掉落（教學小卡的傳送門要看清楚從哪裡掉出來）；k < 1 是快一點（過關後的剩餘步數獎勵）
    const slow = curOpts && curOpts.slowFall > 0 ? clamp(curOpts.slowFall, 0.5, 4) : 1;
    const g = G_FALL / (slow * slow), v0f = V0_FALL / slow;
    const items = [];
    for (const m of ev.moves || []) {
      if (!m || !m.from || !m.to) continue;
      const v = visuals.get(m.id) || cellV(m.from);
      if (v) items.push({ v, to: m.to, spawn: -1, path: m.path || null });
    }
    for (const s2 of ev.spawns || []) {
      if (!s2 || !s2.piece || !s2.to) continue;
      const v = newVisual(s2.piece, s2.to.r, s2.to.c);
      visuals.set(s2.piece.id, v);
      const j = s2.from && s2.from.r < 0 ? -1 - s2.from.r : 0;
      items.push({ v, to: s2.to, spawn: j, path: s2.path || null, col: s2.from ? s2.from.c : s2.to.c });
    }
    // 同一欄由下往上，每顆晚一點點出發；每欄再有一點點不同（看起來比較自然）
    const byCol = new Map();
    for (const it of items) {
      const c = it.col != null ? it.col : it.to.c;
      let l = byCol.get(c);
      if (!l) byCol.set(c, l = []);
      l.push(it);
    }
    let endAll = t + 30, firstLand = Infinity;
    const lands = [];
    for (const [c, list] of byCol) {
      list.sort((a, b) => b.to.r - a.to.r);
      const jit = ((c * 7919 + seq * 104729) % 97) / 97 * COL_JITTER;
      const top = topCell(c);
      list.forEach((it, k) => {
        const v = it.v;
        let x0, y0, vel, delay;
        const m = v.mv;
        if (it.spawn >= 0) {
          x0 = it.path ? it.path[0].c : c; y0 = it.path ? it.path[0].r : top - 1 - it.spawn;
          vel = v0f; delay = (jit + Math.min(STAGGER_MAX, k * STAGGER_ROW)) * slow;
        } else if (m && m.fall && t < m.t0 + m.dur) {
          // 還在掉：接著目前的位置和速度繼續
          const fs = fallState(m, t), cur = evalVisual(v, t);
          x0 = cur.x; y0 = cur.y; vel = Math.max(v0f, fs.vel); delay = t < m.t0 ? m.t0 - t : 0;
        } else {
          const cur = evalVisual(v, t);
          x0 = cur.x; y0 = cur.y; vel = v0f; delay = (jit + Math.min(STAGGER_MAX, k * STAGGER_ROW)) * slow;
        }
        let mv;
        if (it.path) {
          // 斜向滑落：從目前的位置沿著引擎給的折線走（第一點換成畫面上的位置）
          const pts = [{ x: x0, y: y0 }];
          const rest = it.spawn >= 0 ? it.path.slice(1) : it.path.slice(1);
          if (it.spawn < 0) { const p0 = it.path[0]; if (Math.abs(p0.c - x0) + Math.abs(p0.r - y0) > 0.01) pts.push({ x: p0.c, y: p0.r }); }
          for (const q of rest) {
            if (q.warp) {
              // 傳送門：從入口那一格往下掉出去（盤面外被裁掉），再從出口那一格的上面掉進來
              const a = pts[pts.length - 1];
              pts.push({ x: a.x, y: a.y + 1.05 });
              pts.push({ x: q.c, y: q.r - 1.05, jump: true });
            }
            pts.push({ x: q.c, y: q.r });
          }
          const pl = polyline(pts);
          if (pl.len <= 0.001) { v.mv = null; return; }
          const dur = fallDur(pl.len, vel, g);
          mv = { fall: true, ...pl, x1: it.to.c, y1: it.to.r, t0: t + delay, dur, v0: vel, g, clip: true };
        } else {
          const dist = it.to.r - y0;
          if (dist <= 0.001) { v.mv = null; return; }
          const dur = fallDur(dist, vel, g);
          mv = { fall: true, x0: it.to.c, y0, x1: it.to.c, y1: it.to.r, t0: t + delay, dur, v0: vel, g, clip: true };
        }
        v.mv = mv;
        v.landT = mv.t0 + mv.dur;
        v.landAmp = clamp((vel + g * mv.dur) * 2.6 * slow, 0.07, 0.16);     // 掉越高越 Q（最多 1.16 / 0.84；掉落放慢後係數 2.2 → 2.6，Q 的程度不變）
        endAll = Math.max(endAll, v.landT);
        firstLand = Math.min(firstLand, v.landT);
        lands.push({ t: v.landT, r: it.to.r, c: it.to.c });
      });
    }
    // 每顆落地都「喀」一聲（像糖果敲在一起，脆脆的）；同一時間落地的合成一聲，最多 16 聲
    lands.sort((a, b) => a.t - b.t);
    let lastT = -1, nLand = 0;
    for (const L of lands) {
      if (L.t - lastT < 22) continue;
      lastT = L.t;
      cue('land', L.t - t, { r: L.r, c: L.c, k: nLand });
      if (++nLand >= 16) break;
    }
    // 還在掉（上一次掉落沒被這次接手）的方塊也算進去
    for (const v of visuals.values()) if (v.mv && v.mv.fall && v.landT > endAll) endAll = v.landT;
    let end = endAll;
    if (next && next.t === 'clear') {
      // 下一輪連鎖：只等會被消掉 / 變身的那幾格落地
      const cells = [];
      for (const it of next.removed || []) if (it) cells.push(it);
      for (const it of next.created || []) if (it) cells.push(it);
      for (const g of next.groups || []) for (const q of (g && g.cells) || []) cells.push(q);
      let endInv = t;
      const board = ev.board;
      for (const q of cells) {
        const p = board && board[q.r] && board[q.r][q.c];
        const v = p ? visuals.get(p.id) : cellV(q);
        if (v && v.mv && v.mv.fall) endInv = Math.max(endInv, v.landT);
      }
      // play(events, { landHold })：過關後的特效連爆不用每段停那麼久（main.js 的剩餘步數獎勵）
      const hold = curOpts && curOpts.landHold != null ? curOpts.landHold : LAND_HOLD;
      if (cells.length) end = Math.min(endAll, endInv + hold);
    }
    await wait(end - now());
  }

  async function animShuffle(ev) {
    // 先講清楚為什麼要洗牌（整個盤面都沒有可以消的了），橫幅留著，漩渦接著轉
    const sl = SLOGANS.shuffle || {};
    if (sl.text) { banner(sl.text, { sub: sl.sub || '', duration: 1500 }); await wait(650); }
    const t = now(), dur = 620, cx = (cols - 1) / 2, cy = (rows - 1) / 2;
    for (const m of ev.moves || []) {
      if (!m || !m.from || !m.to) continue;
      const v = visuals.get(m.id) || cellV(m.from);
      if (!v) continue;
      const a0 = Math.atan2(m.from.r - cy, m.from.c - cx), r0 = Math.hypot(m.from.r - cy, m.from.c - cx);
      const a1 = Math.atan2(m.to.r - cy, m.to.c - cx), r1 = Math.hypot(m.to.r - cy, m.to.c - cx);
      let da = a1 - a0;
      while (da < 0) da += Math.PI * 2;
      da += Math.PI * 2;
      const np = m.piece;
      v.mv = { t0: t, dur, x1: m.to.c, y1: m.to.r, path: p => {
        // 最後手段的洗牌會換種類：在漩渦中間（方塊最小的時候）換圖
        if (np && p >= 0.5 && (v.kind !== np.kind || v.special !== (np.special || 'none'))) { v.kind = np.kind; v.special = np.special || 'none'; }
        const e = easeInOutCubic(p), k = Math.sin(Math.PI * p), rad = lerp(r0, r1, e) * (1 - 0.72 * k), ang = a0 + da * e;
        return { x: cx + Math.cos(ang) * rad, y: cy + Math.sin(ang) * rad, s: 1 - 0.32 * k };
      } };
    }
    fx.push({ type: 'swirl', t0: t, dur });
    const st = getStar();
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2, v = 2.5 + Math.random() * 2;
      emit({ type: 1, img: st, x: cx + 0.5, y: cy + 0.5, vx: Math.cos(a) * v - Math.sin(a) * 3, vy: Math.sin(a) * v + Math.cos(a) * 3,
        g: 0, drag: 1.6, t0: t + 160 + Math.random() * 220, life: 520, size: 0.3 + Math.random() * 0.25 });
    }
    cue('shuffle');
    await wait(dur + 15);
  }

  // 輸送帶走一格：帶子上的方塊一起滑到下一格；頭尾不相鄰的帶子，最後一顆從尾巴縮小鑽出去，再從頭冒出來
  function beltEnds(q) {
    for (const b of beltList) {
      const n = b.length, a = b[n - 1], z = b[0];
      if (a.r === q.r && a.c === q.c) return { out: { r: a.r - b[n - 2].r, c: a.c - b[n - 2].c }, inn: { r: b[1].r - z.r, c: b[1].c - z.c } };
    }
    return { out: { r: 0, c: 0 }, inn: { r: 0, c: 0 } };
  }
  async function animBelt(ev) {
    const t = now(), dur = 380;
    for (const m of ev.moves || []) {
      if (!m || !m.from || !m.to) continue;
      const v = visuals.get(m.id) || cellV(m.from);
      if (!v) continue;
      const f = m.from, q = m.to;
      if (m.warp) {
        const d = beltEnds(f);
        v.mv = { t0: t, dur, x1: q.c, y1: q.r, clip: true, path: u => {
          if (u < 0.5) { const k = u * 2; return { x: f.c + d.out.c * 0.5 * k, y: f.r + d.out.r * 0.5 * k, s: 1 - 0.88 * k }; }
          const k = (u - 0.5) * 2;
          return { x: q.c - d.inn.c * 0.5 * (1 - k), y: q.r - d.inn.r * 0.5 * (1 - k), s: 0.12 + 0.88 * k };
        } };
      } else {
        v.mv = { t0: t, dur, x1: q.c, y1: q.r, path: u => { const e = easeInOutCubic(u); return { x: lerp(f.c, q.c, e), y: lerp(f.r, q.r, e), s: 1 }; } };
      }
    }
    cue('belt');
    await wait(dur + 10);
  }

  // 龍龍走到出口（2026-11 改成破殼）：蛋殼左右搖一搖 →「喀」破殼、殼片噴出去 → 變大隻 → 往上飛
  // （main.js 接著讓牠從飛到的位置沿弧線飛到上面的目標圖示；dinoout 的 dy 是往上飛了幾格）
  const HATCH_WOB = 420, HATCH_GROW = 430, HATCH_RISE = 360, HATCH_UP = 1.25;
  async function animExit(ev) {
    const t = now(), total = HATCH_WOB + HATCH_GROW + HATCH_RISE;
    let i = 0;
    for (const q of ev.cells || []) {
      if (!q) continue;
      const v = (q.piece && visuals.get(q.piece.id)) || cellV(q), t1 = t + i * 140, tc = t1 + HATCH_WOB;
      i++;
      if (v) {
        v.hatchT = tc;
        v.mv = { t0: t1, dur: total, x1: q.c, y1: q.r, top: true, path: u => {
          const ms = u * total;
          if (ms < HATCH_WOB) {                       // 搖蛋：越搖越大力
            const k = ms / HATCH_WOB;
            return { x: q.c + Math.sin(ms / 34) * 0.07 * (0.35 + 0.65 * k), y: q.r, s: 1 + 0.05 * k };
          }
          if (ms < HATCH_WOB + HATCH_GROW) {          // 破殼：一下子變大隻（彈一下），身體往上浮
            const k = (ms - HATCH_WOB) / HATCH_GROW;
            return { x: q.c, y: q.r - 0.25 * easeOutCubic(k), s: 1 + 0.6 * easeOutBack(k, 2.4) };
          }
          const k = (ms - HATCH_WOB - HATCH_GROW) / HATCH_RISE;   // 往上飛，慢慢縮回原本大小
          return { x: q.c, y: q.r - 0.25 - (HATCH_UP - 0.25) * easeInCubic(k), s: 1.6 - 0.5 * k };
        } };
        at(t1 + total, () => { visuals.delete(v.id); if (cellMap[q.r] && cellMap[q.r][q.c] === v) cellMap[q.r][q.c] = null; });
      }
      at(tc, tt => {
        // 殼片：奶油色和綠點點的碎片往上噴、往下掉
        for (let k = 0; k < 12; k++) {
          const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.8, sp = 2.2 + Math.random() * 2.6;
          emit({ type: 1, img: getCrumb(k % 4 === 0 ? '#8fe3b0' : k % 2 ? '#fbf3e1' : '#f1e2c2'), x: q.c + 0.5 + Math.cos(a) * 0.22, y: q.r + 0.6 + Math.sin(a) * 0.12,
            vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2.4, g: 11, drag: 1.1, t0: tt, life: 560 + Math.random() * 300, size: 0.2 + Math.random() * 0.13, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 12 });
        }
        fx.push({ type: 'flash', x: q.c + 0.5, y: q.r + 0.5, t0: tt, dur: 320, R: 1.1 });
        fx.push({ type: 'ring', x: q.c + 0.5, y: q.r + 0.5, R: 1.5, t0: tt, dur: 520, col: DINO_GLOW });
        sparkle(q.c + 0.5, q.r + 0.4, 14, tt, 0.5);
        addText('破殼！', q.c + 0.5, q.r - 0.2, tt + 60, DINO_GLOW, true);
      });
      cue('hatch', t1 - t, { r: q.r, c: q.c, crack: HATCH_WOB });
      cue('dino', tc - t + 90, { r: q.r, c: q.c });
      cue('dinoout', t1 - t + total - 60, { r: q.r, c: q.c, dy: -HATCH_UP });
    }
    await wait(Math.max(460, (i - 1) * 140 + total - 40));
  }
  // 巧克力蔓延：一團巧克力從旁邊那格長過去，把那一格的玩偶吃掉
  async function animSpread(ev) {
    const t = now(), f = ev.from, q = ev.to, p = ev.piece;
    if (!f || !q || !p) return;
    const old = (ev.was && visuals.get(ev.was.id)) || cellV(q);
    if (old) {
      visuals.delete(old.id);
      if (cellMap[q.r] && cellMap[q.r][q.c] === old) cellMap[q.r][q.c] = null;
      ghosts.push({ kind: old.kind, special: old.special, x: q.c, y: q.r, t0: t + 80, dur: 420, melt: true, phase: old.phase, fired: true });
    }
    const v = newVisual(p, q.r, q.c);
    // 巧克力壺噴出來的：壺彈一下，巧克力畫一道弧線飛過去
    const far = Math.abs(f.r - q.r) + Math.abs(f.c - q.c) > 1, pot = cellV(f);
    if (pot && pot.block === 'pot') {
      pot.landT = t; pot.landAmp = 0.18;
      // 11/23：壺亮一圈，讓人知道巧克力是從這裡來的（盤上的巧克力打光時也會補一塊）
      fx.push({ type: 'ring', x: f.c + 0.5, y: f.r + 0.5, R: 1.25, t0: t, dur: 460, col: POT_GLOW });
    }
    const arc = far || (pot && pot.block === 'pot') ? 0.7 : 0;
    v.mv = { t0: t, dur: far ? 560 : 480, x1: q.c, y1: q.r, path: u => {
      const e = Math.min(1, easeOutBack(u, 2));
      return { x: lerp(f.c, q.c, e), y: lerp(f.r, q.r, e) - arc * Math.sin(Math.PI * Math.min(1, u)), s: 0.4 + 0.6 * Math.min(1.06, easeOutBack(u, 2)) };
    } };
    visuals.set(p.id, v);
    if (cellMap[q.r]) cellMap[q.r][q.c] = v;
    at(t + 400, tt => { crumbs(q.c + 0.5, q.r + 0.5, 'choco', 1, tt, 6); v.landT = tt; v.landAmp = 0.12; });
    cue('spread', 0, { r: q.r, c: q.c });
    await wait(560);
  }

  // 鬧鐘倒數一格：數字換掉、彈一下
  async function animTick(ev) {
    const t = now();
    let hot = false;
    for (const q of ev.cells || []) {
      const v = q && cellV(q);
      if (!v) continue;
      v.hp = q.hp | 0; v.landT = t; v.landAmp = q.hp <= 3 ? 0.2 : 0.12;
      if (q.hp <= 3) hot = true;
    }
    cue(hot ? 'tickhot' : 'tick', 0);
    await wait(170);
  }
  // 鬧鐘數到 0：爆開（紅圈、碎片、「-3步」），那一格空出來
  async function animAlarm(ev) {
    const t = now();
    let i = 0;
    for (const q of ev.cells || []) {
      if (!q) continue;
      const v = (q.piece && visuals.get(q.piece.id)) || cellV(q), t1 = t + i * 120;
      i++;
      if (v) { visuals.delete(v.id); if (cellMap[q.r] && cellMap[q.r][q.c] === v) cellMap[q.r][q.c] = null; }
      ghosts.push({ kind: -7, special: 'none', block: 'alarm', hp: 0, x: q.c, y: q.r, t0: t1, dur: POP_MS + 80, to: null, fired: false, heavy: false, phase: v ? v.phase : 0, charge: null });
      at(t1, tt => {
        fx.push({ type: 'ring', x: q.c + 0.5, y: q.r + 0.5, R: 1.6, t0: tt, dur: 520, col: ALARM_RED });
        sparkle(q.c + 0.5, q.r + 0.5, 8, tt, 0.45);
        addText('-3步', q.c + 0.5, q.r + 0.1, tt + 100, ALARM_RED, true);
      });
      shake(3, 320, t1);
      cue('alarm', t1 - t, { r: q.r, c: q.c });
    }
    await wait(Math.max(560, (i - 1) * 120 + 560));
  }

  function animateEvent(ev, next) {
    switch (ev && ev.t) {
      case 'tick': return animTick(ev);
      case 'alarm': return animAlarm(ev);
      case 'exit': return animExit(ev);
      case 'spread': return animSpread(ev);
      case 'swap': return animSwap(ev, false, next);
      case 'swapBack': return animSwap(ev, true, next);
      case 'transform': return animTransform(ev);
      case 'clear': return animClear(ev, next);
      case 'fall': return animFall(ev, next);
      case 'shuffle': return animShuffle(ev);
      case 'belt': return animBelt(ev);
      default: return null;
    }
  }

  async function runEvents(events, opts, myGen) {
    if (myGen !== gen || destroyed) return;
    selected = null; hintPair = null;
    for (let i = 0; i < events.length; i++) {
      const ev = events[i], next = events[i + 1] || null;
      if (myGen !== gen || destroyed) return;
      if (opts && typeof opts.onEvent === 'function') {
        try { opts.onEvent(ev); } catch (e) { console.error('[renderer] onEvent', e); }
      }
      curOpts = opts;
      try { await animateEvent(ev, next); } catch (e) { console.error('[renderer]', e); }
      curOpts = null;
      if (myGen !== gen || destroyed) return;
      try { if (ev && ev.board) syncBoard(ev.board, ev.jelly, ev.lock); } catch (e) { console.error('[renderer] sync', e); }
      requestDraw();
    }
  }

  function play(events, opts = {}) {
    const myGen = gen;
    const list = Array.isArray(events) ? events.slice() : [];
    busyCount++;
    const p = queue
      .then(() => runEvents(list, opts || {}, myGen))
      .catch(e => console.error('[renderer]', e))
      .finally(() => { busyCount = Math.max(0, busyCount - 1); requestDraw(); });
    queue = p;
    return p;
  }

  // ================= 文字（先畫成小圖，之後每幀只貼圖）=================
  function scratchCtx() {
    if (!scratch) scratch = makeCanvas(4, 4).getContext('2d');
    return scratch;
  }
  // size：CSS px。回傳 { c, w, h }，w / h 是 CSS px
  // ext：立體厚度的顏色（跟 HUD 的字一樣）：最外圈的描邊往右下複製幾層，像糖果字被擠出來的側面（光從左上來），約字高的 13%
  function textSprite(text, size, fill, outline, outer, shadow, ext) {
    const k = dpr, sc = scratchCtx();
    sc.font = `900 ${Math.max(6, size * k)}px ${FONT}`;
    const mw = sc.measureText(text).width / k;
    const depth = ext ? size * 0.075 : 0;          // 厚度：字高的 7.5%（以前 13%，手機上像多一份錯開的字）
    const pad = size * (outer ? 0.36 : 0.28) + (shadow ? size * 0.22 : 0) + depth;
    const w = mw + pad * 2, h = size * 1.25 + pad * 2;
    const c = makeCanvas(w * k, h * k), g = c.getContext('2d');
    g.scale(k, k);
    g.font = `900 ${Math.max(6, size)}px ${FONT}`;
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    const x = w / 2, y = h / 2;
    const fs = typeof fill === 'function' ? fill(g, size) : fill;
    const ow = size * (outer ? 0.24 : 0.15);    // 最外圈描邊的粗細（細一點，字的筆畫和數字的洞才不會被填滿）
    // 陰影不用 shadowBlur（很貴）：往右下偏的半透明粗描邊，兩層疊出柔和的邊
    if (shadow) {
      g.strokeStyle = 'rgba(50,10,80,0.18)'; g.lineWidth = ow + size * 0.16; g.strokeText(text, x + depth + size * 0.04, y + depth + size * 0.1);
      g.strokeStyle = 'rgba(50,10,80,0.3)'; g.lineWidth = ow + size * 0.04; g.strokeText(text, x + depth + size * 0.03, y + depth + size * 0.07);
    }
    if (ext) {
      const n = Math.max(2, Math.ceil(depth * k / 0.8));     // 每層錯開不到 1 個像素，側面才是連續的
      g.strokeStyle = ext; g.fillStyle = ext; g.lineWidth = ow;
      for (let i = n; i >= 1; i--) {
        const d = depth * i / n;
        g.strokeText(text, x + d * 0.15, y + d); g.fillText(text, x + d * 0.15, y + d);
      }
    }
    if (outer) { g.lineWidth = ow; g.strokeStyle = outer; g.strokeText(text, x, y); }
    g.lineWidth = size * (outer ? 0.12 : 0.15); g.strokeStyle = outline; g.strokeText(text, x, y);
    // 字面加胖：描邊一半畫在字裡面，會把字吃瘦；用字面的顏色再描一圈，把字撐回來、再胖一點
    // （只有數字和符號胖很多；中文筆畫多，只補回一點點，不然「關」「蛋」會糊成一團）
    g.lineWidth = size * (/^[\d\s+\-×.,%/!！]+$/.test(text) ? 0.04 : 0.015); g.strokeStyle = fs; g.strokeText(text, x, y);
    g.fillStyle = fs; g.fillText(text, x, y);
    return { c, w, h };
  }
  function drawSprite(sp, x, y, s) {
    if (!sp) return;
    const w = sp.w * s, h = sp.h * s;
    ctx.drawImage(sp.c, x - w / 2, y - h / 2, w, h);
  }
  // 口號旁邊的玩具圖：toy = 方塊 id（從旋轉序列隨機挑一格，角度每次不同）或 'trio'；img = 直接用那張圖
  const sloganImgs = new Map();
  function sloganPic(sl) {
    if (!sl) return null;
    if (sl.img) {
      let im = sloganImgs.get(sl.img);
      if (!im) { im = new Image(); im.decoding = 'async'; im.src = sl.img; sloganImgs.set(sl.img, im); }
      return { img: im, frame: -1 };
    }
    if (!sl.toy) return null;
    if (sl.toy === 'trio') {
      // 扇形的三寶（和彩色炸彈同一張），裁掉四周的空白，口號旁邊才放得夠大
      const S2 = Math.max(4, Math.round(cs * dpr * 1.6)), fan = trioFan(S2);
      if (fan) {
        const w = Math.round(S2 * 0.96), h = Math.round(S2 * 0.78), c = makeCanvas(w, h);
        c.getContext('2d').drawImage(fan, (fan.width - w) / 2, (fan.height - h) / 2 + S2 * 0.02, w, h, 0, 0, w, h);
        c.src = 'trio-fan|' + S2;            // photoSprite 用 src 當快取的 key
        return { img: c, frame: -1 };
      }
    }
    const e = imgsFor(sl.toy);
    // 24 格轉一圈：只挑正面附近 ±75°（第 19…23、0…5 格），每次角度不同又看得到臉
    if (sl.toy !== 'trio' && usable(e.spin)) return { img: e.spin, frame: (19 + Math.floor(Math.random() * 11)) % 24 };
    return e.sprite ? { img: e.sprite, frame: -1 } : null;
  }
  // 照片貼紙沒有白邊：先做一張帶淡粉光暈和右下影子的小圖（每張照片、每種大小做一次），疊在盤面上才分得出來
  const photoCache = new Map();
  function photoSprite(img, d) {
    const key = img.src + '|' + Math.round(d) + '|' + dpr;
    let sp = photoCache.get(key);
    if (sp) return sp;
    const ar = natW(img) / Math.max(1, natH(img));
    const w = ar >= 1 ? d : d * ar, h = ar >= 1 ? d / ar : d, pad = d * 0.12, k = dpr;
    const c = makeCanvas((w + pad * 2) * k, (h + pad * 2) * k), g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    // shadowBlur / shadowOffset 不跟著 scale 走，自己乘 k。順序：右下的影子 → 外圈粉紅光 → 貼著輪廓的白光（疊兩次比較實）
    const pass = (col, blur, dx, dy) => {
      g.shadowColor = col; g.shadowBlur = d * blur * k; g.shadowOffsetX = d * dx * k; g.shadowOffsetY = d * dy * k;
      g.drawImage(img, pad * k, pad * k, w * k, h * k);
    };
    pass('rgba(44,16,96,0.45)', 0.05, 0.02, 0.045);
    pass('rgba(255,150,220,0.8)', 0.1, 0, 0);
    pass('rgba(255,246,253,1)', 0.03, 0, 0);
    pass('rgba(255,246,253,1)', 0.03, 0, 0);
    sp = { c, w: w + pad * 2, h: h + pad * 2 };
    if (photoCache.size > 8) photoCache.clear();
    photoCache.set(key, sp);
    return sp;
  }
  function showWord(text, level, sl, speak = false) {
    if (!text || quiet) return;
    word = { text, level, t0: now(), dur: 1150, sp: null, size: 0, pic: sloganPic(sl), tilt: (Math.random() - 0.5) * 0.5 };
    if (speak && sl && sl.voice) { cue('voice', 60, { id: sl.voice }); lastVoiceAt = now(); moveVoiced = true; }
    requestDraw();
  }
  function banner(text, { sub = '', duration = 1600 } = {}) {
    busyCount++;
    const p = bannerQueue.then(() => new Promise(res => {
      if (destroyed) { res(); return; }
      const b = { text: String(text == null ? '' : text), sub: sub ? String(sub) : '', t0: now(),
        dur: Math.max(500, +duration || 1600), res, timer: 0, sp: null, key: '' };
      banners.push(b);
      b.timer = setTimeout(() => { banners = banners.filter(x => x !== b); requestDraw(); res(); }, b.dur);
      requestDraw();
    })).finally(() => { busyCount = Math.max(0, busyCount - 1); requestDraw(); });
    bannerQueue = p.catch(() => {});
    return p;
  }

  // ================= 輸入相關 =================
  function cellAt(clientX, clientY) {
    if (!rows || !cs) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const x = (clientX - rect.left) * (W ? W / rect.width : 1), y = (clientY - rect.top) * (H ? H / rect.height : 1);
    const c = Math.floor((x - ox) / cs), r = Math.floor((y - oy) / cs);
    if (r < 0 || c < 0 || r >= rows || c >= cols || !mask[r][c]) return null;
    return { r, c };
  }
  function select(cell) {
    selected = cell ? { r: cell.r, c: cell.c, t0: now() } : null;
    requestDraw();
  }
  function hint(a, b) {
    hintPair = a && b ? { a: { r: a.r, c: a.c }, b: { r: b.r, c: b.c }, t0: now() } : null;
    requestDraw();
  }
  function drag(cell, dx = 0, dy = 0) {
    const t = now();
    if (!cell || (!dx && !dy)) {
      if (dragState && !dragState.rel) {
        const o = dragOffset(t);
        dragState = { id: dragState.id, dx: o.x, dy: o.y, rel: t };
      }
      requestDraw();
      return;
    }
    const v = cellV(cell);
    if (!v) { dragState = null; return; }
    dragState = { id: v.id, dx: clamp(+dx || 0, -0.35, 0.35), dy: clamp(+dy || 0, -0.35, 0.35), rel: 0 };
    requestDraw();
  }
  function dragOffset(t) {
    if (!dragState) return { x: 0, y: 0 };
    if (!dragState.rel) return { x: dragState.dx, y: dragState.dy };
    const p = (t - dragState.rel) / 160;
    if (p >= 1) return { x: 0, y: 0 };
    const k = (1 - p) * (1 - p) * Math.cos(p * Math.PI * 1.4);
    return { x: dragState.dx * k, y: dragState.dy * k };
  }

  // ================= 繪製 =================
  function evalVisual(v, t) {
    let x = v.c, y = v.r, s = 1, sx = 1, sy = 1, falling = false, top = false, hl = 0;
    const m = v.mv;
    if (m) {
      if (m.fall) {
        const fs = fallState(m, t);
        if (m.pts) { x = fs.x; y = fs.y; } else { x = m.x1; y = fs.y; }
        if (!fs.done) {
          falling = true;
          const k = Math.min(0.11, fs.vel * 1.5);        // 掉得快時拉長一點
          sy *= 1 + k; sx *= 1 - k * 0.5;
        }
      } else {
        const p = clamp01((t - m.t0) / m.dur);
        if (m.path) {
          if (p >= 1) { x = m.x1; y = m.y1; } else { const q = m.path(p); x = q.x; y = q.y; if (q.s) s *= q.s; }
        } else {
          const e = p >= 1 ? 1 : m.ease ? m.ease(p) : p;
          x = lerp(m.x0, m.x1, e); y = lerp(m.y0, m.y1, e);
        }
        if (p < 1) {
          if (m.lift) s *= 1 + m.lift * Math.sin(Math.PI * Math.min(1, p * 1.15));
          falling = !!m.clip; top = !!m.top;
        }
      }
    }
    if (t >= v.landT) {
      const p = (t - v.landT) / LAND_MS;
      if (p < 1) {
        const k = Math.exp(-2.6 * p) * Math.cos(p * Math.PI * 2.5);
        sy *= 1 - v.landAmp * k; sx *= 1 + v.landAmp * k;
      }
    }
    if (t >= v.popT) { const p = (t - v.popT) / POPIN_MS; if (p < 1) s *= popCurve(p); }
    if (v.special === 'wrap') s *= 1 + 0.07 * Math.sin(t / 230 + v.phase);      // 包裝炸彈：明顯的呼吸縮放
    if (dragState && dragState.id === v.id) {
      const o = dragOffset(t);
      x += o.x; y += o.y; top = true; s *= 1.06;
      if (dragState.rel && t - dragState.rel > 160) dragState = null;
    }
    if (hintPair && !m) {
      const { a, b } = hintPair;
      const isA = v.r === a.r && v.c === a.c, isB = v.r === b.r && v.c === b.c;
      if (isA || isB) {
        const age = t - hintPair.t0, w = Math.pow(Math.max(0, Math.sin(age / 190)), 2);
        const dx = (b.c - a.c) * (isA ? 1 : -1), dy = (b.r - a.r) * (isA ? 1 : -1);
        x += dx * 0.1 * w; y += dy * 0.1 * w; s *= 1 + 0.07 * w; hl = 0.35 + 0.65 * w;
      }
    }
    return { x, y, s, sx, sy, falling, top, hl };
  }

  const BOMB_GLOW = [255, 110, 180];
  function drawBomb(cx, cy, s, t, phase, spinRate = 1) {
    s *= 1 + 0.055 * Math.sin(t / 260 + phase);                  // 脈動呼吸縮放
    const e = getTile(-1, 'bomb'), P = e.P / dpr * s;
    {
      // 外圈一圈會轉的光環（一段一段、一明一暗；改版 2026-11：彩虹改成粉紅 / 白，跟粉紅外圈同一套）
      const k = 0.5 + 0.5 * Math.sin(t / 200 + phase), R = cs * 0.55 * s, n = 12, ga0 = ctx.globalAlpha;
      ctx.lineWidth = cs * 0.05 * s; ctx.lineCap = 'round';
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2 + t / 700 + phase;
        ctx.beginPath(); ctx.arc(cx, cy, R, a0, a0 + (Math.PI * 2 / n) * 0.62);
        ctx.strokeStyle = i % 2 ? `rgba(255,255,255,${((0.4 + 0.45 * k) * ga0).toFixed(3)})` : `rgba(255,90,168,${((0.45 + 0.45 * k) * ga0).toFixed(3)})`; ctx.stroke();
      }
      ctx.lineCap = 'butt';
    }
    {
      // 外圈的金光一明一暗（和條紋糖果的箭頭同一套）
      const k = 0.5 + 0.5 * Math.sin(t / 300 + phase), z = cs * (1.25 + 0.1 * k) * s, ga = ctx.globalAlpha;
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = ga * (0.28 + 0.26 * k);
      ctx.drawImage(getGlowCol(BOMB_GLOW), cx - z / 2, cy - z / 2, z, z);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = ga;
    }
    ctx.drawImage(e.under, cx - P / 2, cy - P / 2, P, P);
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate((t / 1400) * spinRate + phase);
    ctx.drawImage(e.orb, -P / 2, -P / 2, P, P);
    ctx.restore();
    ctx.drawImage(e.top, cx - P / 2, cy - P / 2, P, P);
    ctx.drawImage(e.trio, cx - P / 2, cy - P / 2, P, P);
    // 閃閃
    const star = getStar();
    const op = ctx.globalCompositeOperation, ga = ctx.globalAlpha;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const a = t / 900 + phase + (i * Math.PI * 2) / 3, tw = Math.max(0, Math.sin(t / 210 + i * 2.1 + phase));
      if (tw < 0.05) continue;
      const rr2 = cs * 0.4 * s, sz = cs * 0.34 * tw * s;
      ctx.globalAlpha = tw * ga;
      ctx.drawImage(star, cx + Math.cos(a) * rr2 - sz / 2, cy + Math.sin(a) * rr2 - sz / 2, sz, sz);
    }
    ctx.globalCompositeOperation = op; ctx.globalAlpha = ga;
  }

  // ---- 特殊方塊的待機動畫（一眼看得出是什麼）----
  // 霓虹光暈：方塊顏色的柔光，畫在方塊後面（淺色盤面上用一般疊色，不用加亮）
  const neonCache = new Map();
  function getNeon(col) {
    const key = col.join(',');
    let c = neonCache.get(key);
    if (c) return c;
    const n = 96, h = n / 2, k = mixc(saturate(col, 0.7), WHITE, 0.15);
    c = makeCanvas(n, n);
    const g = c.getContext('2d'), rg = g.createRadialGradient(h, h, 0, h, h, h);
    rg.addColorStop(0, css(k, 0.7)); rg.addColorStop(0.55, css(k, 0.55)); rg.addColorStop(0.78, css(k, 0.22)); rg.addColorStop(1, css(k, 0));
    g.fillStyle = rg; g.fillRect(0, 0, n, n);
    neonCache.set(key, c);
    return c;
  }
  // 掃過糖果的亮帶（橫切面的漸層，畫的時候拉長）
  let sheenImg = null;
  function getSheen() {
    if (sheenImg) return sheenImg;
    const c = makeCanvas(64, 4), g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 64, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.42, 'rgba(255,255,255,0.55)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.95)');
    gr.addColorStop(0.58, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 4);
    sheenImg = c;
    return c;
  }
  // 翅膀（右邊那一片，根部在左下）：半透明、微微發光的白色小天使翅膀，三層圓圓的羽毛，羽尖帶一點淡藍
  let wingImg = null, wingKey = '';
  function getWing() {
    const n = Math.max(16, Math.round(cs * dpr * 0.8)), k = n + '|' + dpr;
    if (wingImg && wingKey === k) return wingImg;
    const c = makeCanvas(n, n), g = c.getContext('2d');
    const rx = n * 0.12, ry = n * 0.72;                           // 根部
    const feathers = [                                            // 角度（往右上張開）、長度、寬度
      [-0.95, 0.62, 0.2], [-0.62, 0.74, 0.21], [-0.3, 0.8, 0.2], [0.02, 0.74, 0.18], [0.32, 0.6, 0.16],
    ];
    const paintSet = (fill, stroke, lw, scale = 1) => {
      for (const [a, L, wd] of feathers) {
        g.save();
        g.translate(rx, ry); g.rotate(a - 0.25);
        g.beginPath();
        g.ellipse(n * L * 0.5 * scale, 0, n * L * 0.5 * scale, n * wd * 0.5 * scale, 0, 0, Math.PI * 2);
        g.fillStyle = fill; g.fill();
        if (stroke) { g.lineWidth = lw; g.strokeStyle = stroke; g.stroke(); }
        g.restore();
      }
    };
    g.save();
    g.shadowColor = 'rgba(170,215,255,0.95)'; g.shadowBlur = n * 0.08;
    paintSet('rgba(214,236,255,0.9)', null, 0, 1.04);              // 外圈淡藍的光
    g.restore();
    const fg = g.createLinearGradient(rx, ry, n, 0);
    fg.addColorStop(0, 'rgba(255,255,255,0.98)'); fg.addColorStop(0.65, 'rgba(250,252,255,0.95)'); fg.addColorStop(1, 'rgba(206,230,255,0.92)');
    paintSet(fg, 'rgba(130,155,220,0.8)', Math.max(1, n * 0.02));
    // 羽毛中間的羽軸（細細的淡藍線）＋ 根部一團亮光
    g.strokeStyle = 'rgba(160,185,235,0.5)'; g.lineWidth = Math.max(1, n * 0.012); g.lineCap = 'round';
    for (const [a, L] of feathers) {
      g.beginPath(); g.moveTo(rx, ry);
      g.lineTo(rx + Math.cos(a - 0.25) * n * L * 0.78, ry + Math.sin(a - 0.25) * n * L * 0.78); g.stroke();
    }
    const rg = g.createRadialGradient(rx, ry, 0, rx, ry, n * 0.22);
    rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.fillRect(0, 0, n, n);
    wingImg = c; wingKey = k;
    return c;
  }
  // 一對翅膀：根部在 (cx ± gap, cy)，flap 0..1（0 = 收起、1 = 往上張開）
  function drawWings(cx, cy, size, gap, flap, alpha = 1) {
    const img = getWing(), ga = ctx.globalAlpha, a = -0.15 - 0.55 * flap;
    ctx.globalAlpha = ga * alpha;
    for (const d of [-1, 1]) {
      ctx.save();
      ctx.translate(cx + d * gap, cy);
      ctx.scale(d, 1);
      ctx.rotate(a);
      ctx.drawImage(img, -size * 0.12, -size * 0.72, size, size);
      ctx.restore();
    }
    ctx.globalAlpha = ga;
  }
  const RING_GOLD = [255, 205, 70], RING_BLUE = [140, 205, 255];
  // ================= 盤面機關 =================
  function blockSprite(type, hp = 1) {
    const S = Math.max(8, Math.round(cs * dpr));
    if (S !== blockS) { blockCache.clear(); blockS = S; }
    const key = type + hp;
    let c = blockCache.get(key);
    if (!c) {
      c = makeCanvas(S, S);
      const g = c.getContext('2d');
      if (type === 'frost') paintFrost(g, S, hp);
      else if (type === 'choco') paintChoco(g, S);
      else if (type === 'licorice') paintSwirl(g, S);
      else if (type === 'cage') paintCage(g, S);
      else if (type === 'alarm') paintAlarm(g, S, hp);
      else if (type === 'shell') paintShell(g, S, hp);
      else if (type === 'pot') paintPot(g, S);
      else if (type === 'wrap') paintWrap(g, S);
      else if (type === 'exit') paintExitArrow(g, S);
      blockCache.set(key, c);
    }
    return c;
  }
  // 龍龍：原本那隻恐龍玩偶的實拍照片（main.js 載成 images 的 'dino'），細白邊
  function dinoSprite() {
    const S = Math.max(8, Math.round(cs * dpr));
    if (S !== blockS) { blockCache.clear(); blockS = S; }
    let c = blockCache.get('dino');
    if (c) return c;
    const all = imgsFor('dino'), im = usable(all.clean) ? all.clean : usable(all.sprite) ? all.sprite : null;
    if (!im) return null;
    c = outlined(vivid(scaled(im, Math.round(S * 0.9))));
    blockCache.set('dino', c);
    return c;
  }
  // 龍龍的蛋（2026-11：還沒救出來的龍龍是蛋裡的龍寶寶）：back = 蛋殼內側（在龍龍後面），front = 下半顆蛋殼（蓋在龍龍前面，上緣是鋸齒裂口）
  function dinoEgg() {
    const S = Math.max(8, Math.round(cs * dpr));
    if (S !== blockS) { blockCache.clear(); blockS = S; }
    let c = blockCache.get('egg');
    if (c) return c;
    const n = Math.round(S * 0.92), ex = n / 2, ey = n * 0.57, rx = n * 0.37, ry = n * 0.41;
    const egg = g => { g.beginPath(); g.ellipse(ex, ey, rx, ry, 0, 0, Math.PI * 2); };
    const zigPts = y => { const pts = [], N = 8; for (let i = 0; i <= N; i++) pts.push([n * i / N, y + (i % 2 ? -1 : 1) * n * 0.05]); return pts; };
    const below = (g, y) => { g.beginPath(); g.moveTo(0, n); for (const [x, yy] of zigPts(y)) g.lineTo(x, yy); g.lineTo(n, n); g.closePath(); };
    const ink = '#b8996b';
    const back = makeCanvas(n, n), gb = back.getContext('2d');
    gb.save(); below(gb, n * 0.44); gb.clip(); egg(gb);
    const ig = gb.createLinearGradient(0, n * 0.4, 0, n);
    ig.addColorStop(0, '#eadcbc'); ig.addColorStop(1, '#c9b48d');
    gb.fillStyle = ig; gb.fill(); gb.lineWidth = n * 0.03; gb.strokeStyle = ink; gb.stroke(); gb.restore();
    const front = makeCanvas(n, n), gf = front.getContext('2d');
    gf.save(); below(gf, n * 0.53); gf.clip(); egg(gf);
    const fg = gf.createRadialGradient(ex - rx * 0.4, ey - ry * 0.05, n * 0.03, ex, ey, ry * 1.1);
    fg.addColorStop(0, '#ffffff'); fg.addColorStop(0.55, '#fbf3e1'); fg.addColorStop(1, '#e6d2a8');
    gf.fillStyle = fg; gf.fill();
    gf.save(); egg(gf); gf.clip();
    for (const [x, y, r, col] of [[0.3, 0.7, 0.07, '#8fe3b0'], [0.6, 0.83, 0.09, '#6fd69c'], [0.72, 0.64, 0.055, '#8fe3b0'], [0.44, 0.9, 0.05, '#6fd69c'], [0.5, 0.66, 0.04, '#6fd69c']]) {
      gf.beginPath(); gf.arc(n * x, n * y, n * r, 0, Math.PI * 2); gf.fillStyle = col; gf.fill();
    }
    gf.restore();
    egg(gf); gf.lineWidth = n * 0.035; gf.strokeStyle = ink; gf.stroke();
    gf.restore();
    gf.save(); egg(gf); gf.clip();
    gf.beginPath(); zigPts(n * 0.53).forEach(([x, y], i) => (i ? gf.lineTo(x, y) : gf.moveTo(x, y)));
    gf.lineWidth = n * 0.035; gf.lineJoin = 'round'; gf.strokeStyle = ink; gf.stroke();
    gf.restore();
    c = { back, front };
    blockCache.set('egg', c);
    return c;
  }
  function getCrumb(hex) {
    let c = crumbCache.get(hex);
    if (c) return c;
    const n = 20;
    c = makeCanvas(n, n);
    const g = c.getContext('2d');
    g.beginPath(); g.moveTo(n * 0.2, n * 0.35); g.lineTo(n * 0.6, n * 0.12); g.lineTo(n * 0.9, n * 0.5); g.lineTo(n * 0.55, n * 0.9); g.lineTo(n * 0.15, n * 0.7); g.closePath();
    g.fillStyle = hex; g.fill(); g.lineWidth = 1.2; g.strokeStyle = 'rgba(40,20,30,0.45)'; g.stroke();
    crumbCache.set(hex, c);
    return c;
  }
  // 碎屑（糖霜 / 巧克力 / 甘草 / 籠子的碎片）往外噴、往下掉
  function crumbs(x, y, type, hp, t, n = 9) {
    const cols = (CRUMBS[type] || CRUMBS.frost)(hp);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = 1.6 + Math.random() * 2.3;
      emit({ type: 1, img: getCrumb(cols[i % cols.length]), x: x + Math.cos(a) * 0.25, y: y + Math.sin(a) * 0.2, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 2.3,
        g: 10, drag: 1.2, t0: t, life: 480 + Math.random() * 260, size: 0.17 + Math.random() * 0.12, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 10 });
    }
  }
  // 一顆機關（糖霜 / 巧克力 / 甘草 / 龍龍）：s 縮放、sx / sy 壓扁（以底部為準）
  function drawBlock(block, hp, cx, cy, s, sx, sy, t, phase, white = 0, hatchT = 0) {
    const ga = ctx.globalAlpha, w = cs * s * sx, h = cs * s * sy, dy = (1 - sy) * cs * s * 0.5;
    if (block === 'dino') {
      // 綠色的光一明一暗；東張西望（每隔幾秒轉頭）、輕輕彈跳。還沒救出來時坐在蛋殼裡（只露出上半身），
      // 到出口破殼之後（hatchT）殼不見、身體變回原本大小（animExit 再把牠放大、往上飛）
      const hatched = hatchT > 0 && t >= hatchT;
      const k = 0.5 + 0.5 * Math.sin(t / 420 + phase), z = cs * (1.3 + 0.1 * k) * s;
      ctx.globalAlpha = ga * (hatched ? 0.7 : 0.32 + 0.25 * k);
      ctx.drawImage(getGlowCol(DINO_GLOW), cx - z / 2, cy - z / 2, z, z);
      ctx.globalAlpha = ga;
      const img = dinoSprite(), turn = Math.tanh(Math.sin(t / 1300 + phase * 3) * 4);
      const bob = Math.abs(Math.sin(t / 380 + phase)) * cs * 0.045 * s;
      if (!img) {
        ctx.beginPath(); ctx.arc(cx, cy + dy, cs * 0.36 * s, 0, Math.PI * 2); ctx.fillStyle = '#5fd8a8'; ctx.fill();
        return;
      }
      // 蛋殼（一眼看出牠不是普通的玩偶）：內側墊在後面、下半顆蓋在前面
      const egg = hatched ? null : dinoEgg(), E = cs * 0.92 * s;
      if (egg) ctx.drawImage(egg.back, cx - E / 2, cy + dy - E / 2, E, E);
      ctx.save();
      ctx.translate(cx, cy + dy - bob - (egg ? cs * 0.08 * s : 0));
      ctx.rotate(0.06 * Math.sin(t / 700 + phase));
      ctx.scale((turn >= 0 ? 1 : -1) * (0.35 + 0.65 * Math.abs(turn)), 1);
      const kz = egg ? 0.76 : 0.9, bw = cs * kz * s * sx, bh = cs * kz * s * sy;
      ctx.drawImage(img, -bw / 2, -bh * 0.54, bw, bh);
      ctx.restore();
      if (egg) ctx.drawImage(egg.front, cx - E / 2, cy + dy - E / 2, E, E);
    } else if (block === 'alarm') {
      // 鬧鐘：平常偶爾歪一下頭；剩 3 步以下一陣一陣地抖（以底部為軸）
      const u = ((t / 900 + phase * 0.31) % 1 + 1) % 1;
      const a = hp <= 3 ? (u < 0.4 ? Math.sin(t / 32) * 0.16 : 0) : Math.sin(t / 1100 + phase) * 0.05;
      ctx.save();
      ctx.translate(cx, cy + h / 2);
      ctx.rotate(a);
      ctx.drawImage(blockSprite('alarm', hp), -w / 2, -h, w, h);
      ctx.restore();
    } else if (block === 'licorice') {
      ctx.save();
      ctx.translate(cx, cy + dy);
      ctx.rotate(t / 2600 + phase);
      ctx.drawImage(blockSprite('licorice'), -w / 2, -h / 2, w, h);
      ctx.restore();
    } else {
      ctx.drawImage(blockSprite(block, hp), cx - w / 2, cy - h / 2 + dy, w, h);
      if (block === 'choco') {
        // 巧克力表面偶爾冒一個泡泡，冒大了「啵」破掉
        const u = ((t / 2300 + phase * 0.37) % 1 + 1) % 1;
        if (u < 0.34) {
          const q = u / 0.34, bx = cx + Math.sin(phase * 5.1) * cs * 0.2 * s, by = cy + dy + Math.cos(phase * 3.3) * cs * 0.18 * s;
          const br = cs * 0.075 * s * (q < 0.85 ? q / 0.85 : 1 + (q - 0.85) * 2);
          ctx.globalAlpha = ga * (q < 0.85 ? 0.9 : ((1 - q) / 0.15) * 0.9);
          ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fillStyle = '#7a4322'; ctx.fill();
          ctx.lineWidth = cs * 0.012; ctx.strokeStyle = 'rgba(255,220,190,0.6)'; ctx.stroke();
          ctx.beginPath(); ctx.arc(bx - br * 0.3, by - br * 0.3, br * 0.28, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,240,225,0.8)'; ctx.fill();
          ctx.globalAlpha = ga;
        }
      }
    }
    if (white > 0.01) {
      const z = cs * 1.3 * s;
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = ga * white;
      ctx.drawImage(getFlash(), cx - z / 2, cy - z / 2, z, z);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = ga;
    }
  }
  // 鐵籠子蓋在被關的玩偶上面、保鮮膜（2）包著特殊方塊；偶爾閃一下光
  function drawLocks(t) {
    if (!locks.length) return;
    let cage = null, wrap = null;
    for (let r = 0; r < rows; r++) {
      const lr = locks[r];
      if (!lr) continue;
      for (let c = 0; c < cols; c++) {
        if (!lr[c]) continue;
        const spr = lr[c] === 2 ? (wrap = wrap || blockSprite('wrap')) : (cage = cage || blockSprite('cage'));
        const x = ox + c * cs, y = oy + r * cs;
        ctx.drawImage(spr, x, y, cs, cs);
        const u = ((t / 3400 + r * 0.37 + c * 0.61) % 1 + 1) % 1;
        if (u < 0.1) {
          const q = Math.sin(Math.PI * u / 0.1), sz = cs * 0.38 * q;
          ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.85 * q;
          ctx.drawImage(getStarCol(WHITE), x + cs * 0.24 - sz / 2, y + cs * 0.2 - sz / 2, sz, sz);
          ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
        }
      }
    }
  }
  // 龍龍出口：那一格下緣一個上下輕輕跳的綠色箭頭
  function drawExits(t) {
    if (!exitCells.length) return;
    const spr = blockSprite('exit'), z = cs * 0.42, b = Math.sin(t / 260) * cs * 0.05;
    for (const q of exitCells) {
      const x = ox + (q.c + 0.5) * cs, y = oy + (q.r + 1) * cs + b;
      ctx.drawImage(spr, x - z / 2, y - z * 0.3, z, z);
    }
  }
  // 傳送門：入口在那一格的下緣（光點往裡面轉），出口在另一格的上緣（光點往外轉），一對一個顏色
  function drawPortals(t) {
    portalList.forEach((q, i) => {
      const col = parseColor(PORTAL_COLORS[i % PORTAL_COLORS.length]);
      portalRing(q.from.c + 0.5, q.from.r + 1, col, t, 1, i);
      portalRing(q.to.c + 0.5, q.to.r, col, t, -1, i);
    });
  }
  function portalRing(gx, gy, col, t, dir, i) {
    const x = ox + gx * cs, y = oy + gy * cs, rx = cs * 0.44, ry = cs * 0.13, k = 0.5 + 0.5 * Math.sin(t / 300 + i);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.35 + 0.3 * k;
    const z = cs * 1.15;
    ctx.drawImage(getGlowCol(col), x - z / 2, y - z * 0.32, z, z * 0.64);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(14,8,40,0.88)'; ctx.fill();
    ctx.lineWidth = cs * 0.065; ctx.strokeStyle = css(col, 1); ctx.stroke();
    ctx.lineWidth = cs * 0.02; ctx.strokeStyle = css(WHITE, 0.85); ctx.stroke();
    ctx.fillStyle = css(mixc(col, WHITE, 0.55), 0.95);
    for (let j = 0; j < 6; j++) {
      const u = ((t / 900 + j / 6) % 1 + 1) % 1, f = dir > 0 ? 1 - u : u;      // 入口往中間縮、出口往外擴
      const a = t / 380 * dir + j * 1.047 + i;
      ctx.globalAlpha = Math.sin(Math.PI * u);
      ctx.beginPath(); ctx.arc(x + Math.cos(a) * rx * 0.85 * f, y + Math.sin(a) * ry * 0.85 * f, cs * 0.028, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawPieceAt(kind, special, cx, cy, s, sx, sy, t, phase, white = 0) {
    if (special === 'bomb' || kind < 0) {
      drawBomb(cx, cy, s * Math.sqrt(sx * sy), t, phase);
      if (white > 0.01) {
        const z = cs * 1.3 * s, ga = ctx.globalAlpha;
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = ga * white;
        ctx.drawImage(getFlash(), cx - z / 2, cy - z / 2, z, z);
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = ga;
      }
      return;
    }
    const e = getTile(kind, special), P = e.P / dpr;
    const w = P * s * sx, h = P * s * sy, dy = (1 - sy) * cs * TILE * s * 0.5;
    const ga = ctx.globalAlpha, col = kindColor(kind);
    const striped = special === 'h' || special === 'v';
    if (striped) {
      // 會呼吸的外光暈（方塊顏色混白，草稿：條紋外面一圈白光）
      const k = 0.5 + 0.5 * Math.sin(t / 380 + phase), z = cs * (1.32 + 0.14 * k) * s;
      ctx.globalAlpha = ga * (0.42 + 0.4 * k);
      ctx.drawImage(getNeon(mixc(col, WHITE, 0.45)), cx - z / 2, cy + dy - z / 2, z, z);
      ctx.globalAlpha = ga;
    }
    if (special === 'wrap') {
      // 外面一圈會呼吸的金光（改版 2026-11：取代以前的細光環）
      const k = 0.5 + 0.5 * Math.sin(t / 420 + phase), z = cs * (1.42 + 0.2 * k) * s;
      ctx.globalAlpha = ga * (0.55 + 0.45 * k);
      ctx.drawImage(getNeon(RING_GOLD), cx - z / 2, cy + dy - z / 2, z, z);
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = ga * (0.12 + 0.22 * k);
      ctx.drawImage(getGlowCol(GOLD), cx - z / 2, cy + dy - z / 2, z, z);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = ga;
    }
    if (special === 'fish') {
      // 飛天玩偶：底座周圍一圈金 / 淺藍的星光環（在糖果下面）+ 背後一對會拍動的翅膀
      const k = 0.5 + 0.5 * Math.sin(t / 300 + phase), z = cs * (1.34 + 0.08 * k) * s;
      ctx.globalAlpha = ga * (0.5 + 0.3 * k);
      ctx.drawImage(getNeon(k > 0.5 ? RING_GOLD : RING_BLUE), cx - z / 2, cy + dy - z / 2 + cs * 0.06 * s, z, z);
      ctx.globalAlpha = ga;
      const flap = 0.5 + 0.5 * Math.sin(t / 150 + phase);
      drawWings(cx, cy + dy - cs * 0.08 * s, cs * 0.66 * s, cs * 0.26 * s, flap, 0.95);
      // 糖果底座 → 懸浮的玩偶（上下飄）→ 玻璃反光
      const hy = -cs * 0.055 * s * (0.5 + 0.5 * Math.sin(t / 340 + phase));
      ctx.drawImage(e.base, cx - w / 2, cy - h / 2 + dy, w, h);
      if (e.toy) ctx.drawImage(e.toy, cx - w / 2, cy - h / 2 + dy + hy, w, h);
      if (e.top) ctx.drawImage(e.top, cx - w / 2, cy - h / 2 + dy, w, h);
    } else {
      ctx.drawImage(e.full, cx - w / 2, cy - h / 2 + dy, w, h);
    }
    if (striped) {
      const R = cs * CANDY_R * s, hz = special === 'h';
      // 1. 持續流動的亮帶：沿著條紋的方向一道白光掃過（只在糖果裡面）
      const u = ((t / 820 + phase * 0.3) % 1 + 1) % 1, pos = (u * 2 - 1) * R * 1.5;
      ctx.save();
      bodyPath(ctx, kind, cx, cy + dy, R * 1.02); ctx.clip();
      ctx.globalAlpha = ga * 0.75;
      const sh = getSheen(), bw = R * 0.9;
      if (hz) { ctx.translate(cx + pos, cy + dy); ctx.rotate(0.35); ctx.drawImage(sh, -bw / 2, -R * 1.4, bw, R * 2.8); }
      else { ctx.translate(cx, cy + dy + pos); ctx.rotate(Math.PI / 2 + 0.35); ctx.drawImage(sh, -bw / 2, -R * 1.4, bw, R * 2.8); }
      ctx.restore();
      ctx.globalAlpha = ga;
      // 2. 金色箭頭的光一明一暗
      const k = 0.5 + 0.5 * Math.sin(t / 260 + phase), gl = getGlowCol(GOLD), z = cs * 0.5 * s, off = cs * 0.38 * s;
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = ga * (0.18 + 0.32 * k);
      for (const d of [-1, 1]) {
        const x = cx + (hz ? d * off : 0), y = cy + dy + (hz ? 0 : d * off);
        ctx.drawImage(gl, x - z / 2, y - z / 2, z, z);
      }
      ctx.globalCompositeOperation = 'source-over';
      // 3. 方向提示：箭頭外面兩顆小光點一直往外跑、淡掉（橫的往左右、直的往上下）
      const star = getStarCol(GOLD);
      for (let i = 0; i < 2; i++) {
        const q = ((t / 700 + phase + i * 0.5) % 1 + 1) % 1, o = cs * (0.5 + 0.32 * q) * s, sz = cs * 0.26 * (1 - q * 0.5) * s;
        ctx.globalAlpha = ga * (1 - q) * 0.95;
        for (const d of [-1, 1]) {
          const x = cx + (hz ? d * o : 0), y = cy + dy + (hz ? 0 : d * o);
          ctx.drawImage(star, x - sz / 2, y - sz / 2, sz, sz);
        }
      }
      ctx.globalAlpha = ga;
    }
    if (special === 'wrap' || special === 'fish') {
      // 繞著轉的小星星（包裝：金色 4 顆；飛天玩偶：金 / 淺藍交錯 5 顆，一閃一閃）
      const n = special === 'wrap' ? 4 : 5, rad = cs * (special === 'wrap' ? 0.58 : 0.52) * s;
      for (let i = 0; i < n; i++) {
        const a = t / (special === 'wrap' ? 650 : 900) + phase + (i * Math.PI * 2) / n;
        const tw = 0.55 + 0.45 * Math.sin(t / 170 + i * 1.9 + phase), sz = cs * 0.24 * tw * s;
        const star = getStarCol(special === 'wrap' || i % 2 ? RING_GOLD : RING_BLUE);
        ctx.globalAlpha = ga * (0.5 + 0.5 * tw);
        ctx.drawImage(star, cx + Math.cos(a) * rad - sz / 2, cy + dy + Math.sin(a) * rad * (special === 'fish' ? 0.55 : 1) + (special === 'fish' ? cs * 0.18 * s : 0) - sz / 2, sz, sz);
      }
      ctx.globalAlpha = ga;
    }
    if (white > 0.01) {
      ctx.globalAlpha = ga * white;
      ctx.drawImage(tileWhite(e), cx - w / 2, cy - h / 2 + dy, w, h);
      ctx.globalAlpha = ga;
    }
  }

  function drawVisual(v, st, t) {
    if (v.hideUntil && t < v.hideUntil) return;
    const cx = ox + (st.x + 0.5) * cs, cy = oy + (st.y + 0.5) * cs;
    if (st.hl > 0) {
      const g = getGlow(), gs = cs * 1.45;
      ctx.globalAlpha = 0.75 * st.hl;
      ctx.drawImage(g, cx - gs / 2, cy - gs / 2, gs, gs);
      ctx.globalAlpha = 1;
    }
    if (v.block) { drawBlock(v.block, v.hp, cx, cy, st.s, st.sx, st.sy, t, v.phase, 0, v.hatchT || 0); return; }
    let kind = v.kind, special = v.special;
    if (v.morph) {
      if (t < v.morph.until) { kind = v.morph.kind; special = v.morph.special; } else v.morph = null;
    }
    drawPieceAt(kind, special, cx, cy, st.s, st.sx, st.sy, t, v.phase);
  }

  function drawSelected(v, st, t) {
    const cx = ox + (st.x + 0.5) * cs, cy = oy + (st.y + 0.5) * cs, age = t - selected.t0;
    const pulse = 0.5 + 0.5 * Math.sin(age / 160);
    const g = getGlow(), gs = cs * (1.6 + 0.14 * pulse);
    ctx.globalAlpha = Math.min(1, age / 90) * (0.6 + 0.4 * pulse);
    ctx.drawImage(g, cx - gs / 2, cy - gs / 2, gs, gs);
    ctx.globalAlpha = 1;
    // 按下去：先輕輕一壓，再彈大（立刻有反應）
    const s = st.s * (age < 60 ? lerp(1, 0.94, age / 60) : age < 220 ? lerp(0.94, 1.12, easeOutBack((age - 60) / 160, 3)) : 1.12 + 0.025 * Math.sin(age / 130));
    // 俏皮的左右輕晃：剛選到時晃大一點、慢慢收小，之後一直輕輕擺
    const rot = age < 520 ? 0.1 * Math.sin(age / 42) * (1 - age / 520) : 0.03 * Math.sin((age - 520) / 240);
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(rot); ctx.translate(-cx, -cy);
    try { drawSelectedBody(v, cx, cy, s, t, age); } finally { ctx.restore(); }
  }
  function drawSelectedBody(v, cx, cy, s, t, age) {
    if (v.block) { drawBlock(v.block, v.hp, cx, cy, s, 1, 1, t, v.phase); return; }
    if (v.special === 'bomb' || v.kind < 0) { drawBomb(cx, cy, s, t, v.phase, 3); return; }
    if (v.special === 'fish') drawWings(cx, cy - cs * 0.08 * s, cs * 0.66 * s, cs * 0.26 * s, 0.5 + 0.5 * Math.sin(age / 90), 1);   // 選著的飛天玩偶翅膀拍快一點
    const e = getTile(v.kind, v.special), P = e.P / dpr * s;
    const info = pieceInfo(v.kind), imgs = imgsFor(info.id), spin = usable(imgs.spinClean) ? imgs.spinClean : imgs.spin, sprite = usable(imgs.clean) ? imgs.clean : imgs.sprite, spinScale = imgs.spinScale;
    // 跟盤面上的玩具一樣大、一樣的位置（再乘上選取時的放大 s）
    const L = toyLayout(v.kind, v.special, Math.max(4, Math.round(cs * dpr)));
    const box = L.box / dpr * s, tx = cx + L.dx / dpr * s, ty = cy + L.dy / dpr * s;
    if (usable(spin)) {
      ctx.drawImage(e.base, cx - P / 2, cy - P / 2, P, P);
      // spinScale（manifest）：旋轉序列裡玩具比靜態圖小多少，放大回來讓大小一致
      const fw = natW(spin) / 6, fh = natH(spin) / 4, i = Math.floor(age / 50) % 24;
      const sb = box / clamp(+spinScale || 1, 0.5, 2);
      ctx.drawImage(outlined(vivid(spin), 6, 4), (i % 6) * fw, Math.floor(i / 6) * fh, fw, fh, tx - sb / 2, ty - sb / 2, sb, sb);
      const acc = accOverlay(v.kind, L.box);
      if (acc) { const an = acc.n / dpr * s; ctx.drawImage(acc.c, tx - an / 2, ty - an / 2, an, an); }
      if (e.top) ctx.drawImage(e.top, cx - P / 2, cy - P / 2, P, P);
    } else if (usable(sprite)) {
      // 沒有旋轉序列（照片方塊）：原地彈跳，落地壓扁、跳起拉長（彈跳豬特別彈）
      ctx.drawImage(e.base, cx - P / 2, cy - P / 2, P, P);
      const sc = outlined(vivid(scaled(sprite, Math.round(L.box * 1.12))));
      const amp = info.id === 'moodeng' ? 1.45 : 1;
      const ph = (age % 560) / 560, hop = Math.sin(ph * Math.PI);
      const land = Math.exp(-Math.min(ph, 1 - ph) * 14);         // 碰到地面附近 → 1
      const sx = 1 + 0.16 * amp * land - 0.05 * hop, sy = 1 - 0.15 * amp * land + 0.07 * hop;
      ctx.save();
      ctx.translate(tx, ty + box / 2 - hop * cs * 0.13 * amp);
      ctx.scale(sx, sy);
      ctx.drawImage(sc, -box / 2, -box, box, box);
      const acc = accOverlay(v.kind, L.box);
      if (acc) { const an = acc.n / dpr * s; ctx.drawImage(acc.c, -an / 2, -box / 2 - an / 2, an, an); }
      ctx.restore();
      if (e.top) ctx.drawImage(e.top, cx - P / 2, cy - P / 2, P, P);
    } else {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(0.12 * Math.sin(age / 150));
      ctx.drawImage(e.full, -P / 2, -P / 2, P, P);
      ctx.restore();
    }
  }

  // 輸送帶：畫在果凍上面、方塊下面。一條半透明的帶子沿著格子中心連起來，小箭頭往前跑（方塊之間的縫看得到）；
  // 頭尾不相鄰的帶子，兩端各延伸半格，尾巴的箭頭往外跑、頭的箭頭從外面跑進來
  function beltChevron(x, y, dx, dy, z) {
    const px = -dy * z * 0.62, py = dx * z * 0.62, bx = dx * z * 0.42, by = dy * z * 0.42;
    ctx.beginPath();
    ctx.moveTo(x - bx + px, y - by + py); ctx.lineTo(x + bx, y + by); ctx.lineTo(x - bx - px, y - by - py);
    ctx.stroke();
  }
  function drawBelts(t) {
    if (!beltList.length) return;
    const w = cs * 0.86, ph = (t / 760) % 1;
    ctx.save();
    if (clipPath) ctx.clip(clipPath);
    ctx.lineJoin = 'round';
    for (const b of beltList) {
      const n = b.length, a = b[n - 1], h = b[0], loop = Math.abs(a.r - h.r) + Math.abs(a.c - h.c) === 1;
      const X = q => ox + (q.c + 0.5) * cs, Y = q => oy + (q.r + 0.5) * cs;
      const dIn = { r: b[1].r - h.r, c: b[1].c - h.c }, dOut = { r: a.r - b[n - 2].r, c: a.c - b[n - 2].c };
      ctx.beginPath();
      if (loop) { ctx.moveTo(X(h), Y(h)); for (let i = 1; i < n; i++) ctx.lineTo(X(b[i]), Y(b[i])); ctx.closePath(); }
      else {
        ctx.moveTo(X(h) - dIn.c * cs * 0.5, Y(h) - dIn.r * cs * 0.5);
        for (let i = 0; i < n; i++) ctx.lineTo(X(b[i]), Y(b[i]));
        ctx.lineTo(X(a) + dOut.c * cs * 0.5, Y(a) + dOut.r * cs * 0.5);
      }
      ctx.lineCap = loop ? 'round' : 'butt';
      ctx.lineWidth = w + cs * 0.08; ctx.strokeStyle = 'rgba(92,48,20,0.5)'; ctx.stroke();
      ctx.lineWidth = w; ctx.strokeStyle = 'rgba(255,206,140,0.28)'; ctx.stroke();
      ctx.lineWidth = cs * 0.025; ctx.strokeStyle = 'rgba(255,236,205,0.45)'; ctx.setLineDash([cs * 0.09, cs * 0.09]);
      ctx.lineDashOffset = -ph * cs * 0.18 * 4; ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0;
    }
    ctx.restore();
  }
  // 輸送帶上層：果凍外框會蓋到方塊之間的縫，所以軌道邊線和箭頭在方塊、果凍框、籠子之後再畫一次。
  // 邊線貼著格子邊；箭頭只在兩格交界附近出現，不會壓到毛絨玩具的臉
  function drawBeltsTop(t) {
    if (!beltList.length) return;
    const e = cs * 0.46, H = cs * 0.5, z = cs * 0.19, ph = (t / 760) % 1;
    const DIRS = [[-1, 0], [0, 1], [1, 0], [0, -1]];
    ctx.save();
    if (clipPath) ctx.clip(clipPath);
    ctx.lineCap = 'butt'; ctx.lineWidth = cs * 0.045; ctx.strokeStyle = 'rgba(92,48,20,0.6)';
    ctx.beginPath();
    for (const b of beltList) {
      const n = b.length, a = b[n - 1], h = b[0], loop = Math.abs(a.r - h.r) + Math.abs(a.c - h.c) === 1;
      for (let i = 0; i < n; i++) {
        const q = b[i], open = [false, false, false, false];
        const link = (dr, dc) => { for (let k = 0; k < 4; k++) if (DIRS[k][0] === dr && DIRS[k][1] === dc) open[k] = true; };
        const prev = i > 0 ? b[i - 1] : (loop ? a : null), next = i < n - 1 ? b[i + 1] : (loop ? h : null);
        if (prev) link(prev.r - q.r, prev.c - q.c); else link(q.r - b[1].r, q.c - b[1].c);
        if (next) link(next.r - q.r, next.c - q.c); else link(q.r - b[n - 2].r, q.c - b[n - 2].c);
        const cx = ox + (q.c + 0.5) * cs, cy = oy + (q.r + 0.5) * cs;
        for (let k = 0; k < 4; k++) {
          const [dr, dc] = DIRS[k], kl = (k + 3) % 4, kr = (k + 1) % 4;
          // 沿著這一邊走的方向（順時針）：從左鄰邊到右鄰邊
          const tr = DIRS[kr][0], tc = DIRS[kr][1];
          const sL = open[kl] ? H : e, sR = open[kr] ? H : e;
          if (!open[k]) {
            const mx = cx + dc * e, my = cy + dr * e;
            ctx.moveTo(mx - tc * sL, my - tr * sL); ctx.lineTo(mx + tc * sR, my + tr * sR);
          } else if (open[kr]) {
            // 轉彎內角：兩邊都通，補一個小 L
            ctx.moveTo(cx + dc * H + tc * e, cy + dr * H + tr * e);
            ctx.lineTo(cx + dc * e + tc * e, cy + dr * e + tr * e);
            ctx.lineTo(cx + dc * e + tc * H, cy + dr * e + tr * H);
          }
        }
      }
    }
    ctx.stroke();
    // 箭頭：每一段兩個往前跑，只在兩格交界附近亮起來
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = cs * 0.065; ctx.strokeStyle = '#fff';
    const X = q => ox + (q.c + 0.5) * cs, Y = q => oy + (q.r + 0.5) * cs;
    for (const b of beltList) {
      const n = b.length, a = b[n - 1], h = b[0], loop = Math.abs(a.r - h.r) + Math.abs(a.c - h.c) === 1;
      const dIn = { r: b[1].r - h.r, c: b[1].c - h.c }, dOut = { r: a.r - b[n - 2].r, c: a.c - b[n - 2].c };
      const segs = [];
      for (let i = 0; i < n - 1; i++) segs.push([b[i], b[i + 1], 0, 1]);
      if (loop) segs.push([a, h, 0, 1]);
      else {
        segs.push([a, { r: a.r + dOut.r, c: a.c + dOut.c }, 0, 0.5]);
        segs.push([{ r: h.r - dIn.r, c: h.c - dIn.c }, h, 0.5, 1]);
      }
      for (const [p, q, lo, hi] of segs) {
        const dx = q.c - p.c, dy = q.r - p.r;
        for (let j = 0; j < 2; j++) {
          const u = (ph + j * 0.5) % 1, d = Math.abs(u - 0.5);
          if (u < lo || u > hi || d > 0.2) continue;
          ctx.globalAlpha = 0.95 * (1 - d / 0.2);
          beltChevron(lerp(X(p), X(q), u), lerp(Y(p), Y(q), u), dx, dy, z);
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawJelly(t) {
    for (let r = 0; r < rows; r++) {
      const jr = jelly[r];
      if (!jr) continue;
      for (let c = 0; c < cols; c++) {
        if (!mask[r][c]) continue;
        const lv = jr[c] | 0, jf = jellyFx.size ? jellyFx.get(r * 1024 + c) : null;
        let s = 1;
        const x = ox + (c + 0.5) * cs, y = oy + (r + 0.5) * cs;
        if (jf) {
          const p = (t - jf.t0) / 420;
          if (p >= 1) jellyFx.delete(r * 1024 + c);
          else {
            s = 1 + 0.13 * Math.sin(p * Math.PI * 3) * (1 - p);
            if (jf.from > lv) {   // 被打掉的那一層：放大淡出
              const img = getJelly(Math.min(2, jf.from)), z = cs * (1 + 0.35 * p);
              ctx.globalAlpha = 1 - p;
              ctx.drawImage(img, x - z / 2, y - z / 2, z, z);
              ctx.globalAlpha = 1;
            }
          }
        }
        if (lv <= 0) continue;
        const img = getJelly(Math.min(2, lv)), z = cs * s;
        ctx.drawImage(img, x - z / 2, y - z / 2, z, z);
      }
    }
  }

  const fallCols = [];
  function drawPieces(t) {
    const sel = selected ? cellV(selected) : null;
    let selSt = null;
    const falling = [], tops = [], late = [], still = [];
    for (const v of visuals.values()) {
      const st = evalVisual(v, t);
      if (v === sel && !v.mv) { selSt = st; continue; }
      if (st.falling) falling.push([v, st]);
      else if (st.top) tops.push([v, st]);
      else if (v.special === 'wrap' || v.special === 'fish') late.push([v, st]);   // 糖果紙兩端 / 翅膀要蓋在鄰居上面
      else still.push([v, st]);
    }
    // 由上往下、由左往右畫：糖果往右下的落影只會落在盤面上，不會蓋到鄰居
    const byPos = (a, b) => a[1].y - b[1].y || a[1].x - b[1].x;
    still.sort(byPos); late.sort(byPos);
    for (const [v, st] of still) drawVisual(v, st, t);
    for (const [v, st] of late) drawVisual(v, st, t);
    drawJellyRims(t);
    drawLocks(t);
    drawBeltsTop(t);
    if (falling.length) {
      // 同一欄掉落中的方塊不重疊（後面掉得比較快的會「頂」在前面那顆上面）
      for (let c = 0; c < cols; c++) fallCols[c] = null;
      for (const it of falling) {
        const m = it[0].mv;
        if (!m || !m.fall || m.pts) continue;
        const c = m.x1 | 0;
        if (c < 0 || c >= cols) continue;
        (fallCols[c] || (fallCols[c] = [])).push(it);
      }
      for (let c = 0; c < cols; c++) {
        const l = fallCols[c];
        if (!l || l.length < 2) continue;
        l.sort((a, b) => b[0].mv.y1 - a[0].mv.y1);
        for (let i = 1; i < l.length; i++) {
          const lim = l[i - 1][1].y - 1;
          if (l[i][1].y > lim) l[i][1].y = lim;
        }
      }
      ctx.save();
      if (clipPath) ctx.clip(clipPath);
      for (const [v, st] of falling) drawVisual(v, st, t);
      ctx.restore();
    }
    for (const [v, st] of tops) drawVisual(v, st, t);
    drawExits(t);
    drawPortals(t);
    if (selSt) drawSelected(sel, selSt, t);
  }

  function drawGhosts(t) {
    let w = 0;
    for (const g of ghosts) {
      const p = (t - g.t0) / g.dur;
      if (p >= 1) continue;
      ghosts[w++] = g;
      const cx0 = ox + (g.x + 0.5) * cs, cy0 = oy + (g.y + 0.5) * cs;
      if (p < 0 && g.charge && t >= g.charge.t) {
        // 合體蓄力：往中心吸過去、越來越大、一直抖、越來越白
        const q = clamp01((t - g.charge.t) / g.charge.dur), e = easeInCubic(q), jig = cs * 0.06 * q;
        const x = lerp(cx0, ox + (g.charge.x + 0.5) * cs, easeOutCubic(Math.min(1, q * 1.6))) + (Math.random() - 0.5) * jig * 2;
        const y = lerp(cy0, oy + (g.charge.y + 0.5) * cs, easeOutCubic(Math.min(1, q * 1.6))) + (Math.random() - 0.5) * jig * 2;
        const z = cs * (1.2 + g.charge.S * 0.8 * e);
        ctx.globalAlpha = 0.5 * q;
        ctx.drawImage(getGlowCol(GOLD), x - z / 2, y - z / 2, z, z);
        ctx.globalAlpha = 1;
        drawPieceAt(g.kind, g.special, x, y, 1 + (g.charge.S - 1) * e, 1, 1, t, g.phase, 0.6 * e);
        continue;
      }
      if (p < 0) {
        if (g.block) drawBlock(g.block, g.hp, cx0, cy0, 1, 1, 1, t, g.phase);
        else drawPieceAt(g.kind, g.special, cx0, cy0, 1, 1, 1, t, g.phase);
        continue;
      }
      if (g.melt) {
        // 被巧克力吃掉：縮小、變成巧克力色
        const e = easeInCubic(p), sc = 1 - 0.75 * e;
        ctx.globalAlpha = 1 - p * p;
        drawPieceAt(g.kind, g.special, cx0, cy0, sc, 1, 1, t, g.phase);
        ctx.globalAlpha = Math.min(1, p * 1.6) * (1 - p * p);
        const z = cs * sc;
        ctx.drawImage(blockSprite('choco'), cx0 - z / 2, cy0 - z / 2, z, z);
        ctx.globalAlpha = 1;
        continue;
      }
      if (!g.fired && g.charge) { g.x = g.charge.x; g.y = g.charge.y; g.charge = null; }
      if (!g.fired && g.block) {
        g.fired = true;
        crumbs(g.x + 0.5, g.y + 0.5, g.block, g.hp, g.t0 + POP_HIT, 12);
        fx.push({ type: 'flash', x: g.x + 0.5, y: g.y + 0.5, t0: g.t0, dur: 200, R: 0.8 });
      }
      if (g.block) {
        const q = POP_HIT / g.dur;
        const sc = p < q ? 1 + 0.15 * easeOutCubic(p / q) : 1.15 * (1 - easeInCubic((p - q) / (1 - q)));
        if (sc > 0.01) { ctx.globalAlpha = p < 0.6 ? 1 : 1 - (p - 0.6) / 0.4; drawBlock(g.block, g.hp, cx0, cy0, sc, 1, 1, t, g.phase, p < q ? 0.5 * p / q : 0); ctx.globalAlpha = 1; }
        continue;
      }
      if (!g.fired) {
        g.fired = true;
        const col = g.kind >= 0 ? kindColor(g.kind) : kindColor(Math.floor(Math.random() * Math.max(1, pieces.length)));
        if (g.to) sparkle(g.x + 0.5, g.y + 0.5, 1, g.t0, 0.2);
        else {
          g.shatterAt = g.t0 + POP_HIT;
          burst(g.x + 0.5, g.y + 0.5, col, g.heavy ? 5 : 9, g.shatterAt, { stars: g.heavy ? 2 : 5, speed: g.special !== 'none' ? 3.8 : 3 });
          shatter(g.x + 0.5, g.y + 0.5, g.kind, g.special, g.shatterAt, g.special !== 'none' ? 1.3 : 1);
          fx.push({ type: 'flash', x: g.x + 0.5, y: g.y + 0.5, t0: g.t0, dur: 200, R: 0.8 });
          if (!g.heavy) fx.push({ type: 'pring', x: g.x + 0.5, y: g.y + 0.5, t0: g.t0, dur: 230, col, R: 0.7 });
        }
      }
      let x = cx0, y = cy0, s, a, wh;
      if (g.to) {
        const e = easeInCubic(p);
        x = lerp(cx0, ox + (g.to.x + 0.5) * cs, e); y = lerp(cy0, oy + (g.to.y + 0.5) * cs, e);
        s = 1 - 0.45 * e; a = 1 - p * p * 0.6; wh = 0.55 * Math.sin(Math.PI * Math.min(1, p * 1.4));
      } else {
        // 一下子放大 + 變白（「啵」），接著整顆碎開（碎片粒子接手）
        if (g.shatterAt && t >= g.shatterAt && g.kind >= 0) continue;
        const q = POP_HIT / g.dur;
        if (p < q) { const u = easeOutCubic(p / q); s = 1 + 0.2 * u; wh = 0.92 * u; }
        else { const u = (p - q) / (1 - q); s = 1.2 * (1 - u * u * (3 - 2 * u)); wh = 0.8 * (1 - u) * (1 - u); }
        a = p < 0.55 ? 1 : 1 - (p - 0.55) / 0.45;
      }
      if (s <= 0.01) continue;
      ctx.globalAlpha = clamp01(a);
      drawPieceAt(g.kind, g.special, x, y, s, 1, 1, t, g.phase, wh);
      ctx.globalAlpha = 1;
    }
    ghosts.length = w;
  }

  function boltPts(x0, y0, x1, y1, seed) {
    const rnd = mulberry(seed);
    let pts = [[x0, y0], [x1, y1]], disp = Math.hypot(x1 - x0, y1 - y0) * 0.2;
    for (let k = 0; k < 4; k++) {
      const np = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
        const nx = -(by - ay), ny = bx - ax, L = Math.hypot(nx, ny) || 1, o = (rnd() * 2 - 1) * disp;
        np.push([(ax + bx) / 2 + (nx / L) * o, (ay + by) / 2 + (ny / L) * o], [bx, by]);
      }
      pts = np; disp *= 0.55;
    }
    return pts;
  }
  function strokePts(pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
  }

  const BOLT_PINK = [255, 170, 240];
  function drawFx(t) {
    if (!fx.length) return;
    let w = 0;
    const star = getStar(), flash = getFlash();
    ctx.globalCompositeOperation = 'lighter';
    for (const f of fx) {
      const endT = f.end != null ? f.end : f.t0 + f.dur;
      if (t >= endT) continue;
      fx[w++] = f;
      if (t < f.t0) continue;
      const p = f.end != null ? (t - f.t0) / (f.end - f.t0) : (t - f.t0) / f.dur;
      if (f.type === 'flash') {
        const x = ox + f.x * cs, y = oy + f.y * cs, R = cs * f.R * (0.6 + 0.6 * easeOutCubic(p));
        ctx.globalAlpha = 0.95 * (1 - p) * (1 - p);
        ctx.drawImage(flash, x - R, y - R, R * 2, R * 2);
      } else if (f.type === 'pring') {
        // 消除時的光圈：從方塊邊緣往外擴散
        const x = ox + f.x * cs, y = oy + f.y * cs, e = easeOutCubic(p), R = cs * (0.36 + f.R * 0.55 * e);
        ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2);
        ctx.lineWidth = cs * 0.09 * (1 - p) + 0.5; ctx.strokeStyle = css(mixc(f.col, WHITE, 0.5), 0.75 * (1 - p)); ctx.stroke();
      } else if (f.type === 'beam') {
        const cx = ox + (f.c + 0.5) * cs, cy = oy + (f.r + 0.5) * cs, h = f.dir === 'h';
        const span = (h ? cols : rows) * cs;
        const sweepP = clamp01((t - f.t0) / Math.max(1, f.sweep));
        const reach = (span + cs) * easeOutCubic(sweepP);
        const hold = f.sweep / f.dur;
        const grow = Math.sin(Math.min(1, p / 0.12) * Math.PI / 2), fade = p > hold ? 1 - easeInCubic((p - hold) / (1 - hold)) : 1;
        const th = cs * (0.2 + 0.45 * grow) * fade;
        let lo = h ? ox - cs * 0.2 : oy - cs * 0.2, hi = h ? ox + cols * cs + cs * 0.2 : oy + rows * cs + cs * 0.2;
        if (f.lim) {      // 被甘草漩渦糖擋住：光束停在那一格
          const base = h ? ox : oy;
          lo = Math.max(lo, base + f.lim[0] * cs); hi = Math.min(hi, base + (f.lim[1] + 1) * cs);
        }
        const c0 = h ? cx : cy, a0 = Math.max(lo, c0 - reach), a1 = Math.min(hi, c0 + reach);
        ctx.globalAlpha = fade;
        const img = getBeam(f.col, h ? 'h' : 'v');
        if (h) ctx.drawImage(img, a0, cy - th * 1.8, a1 - a0, th * 3.6); else ctx.drawImage(img, cx - th * 1.8, a0, th * 3.6, a1 - a0);
        ctx.fillStyle = '#fff';
        ctx.globalAlpha = 0.9 * fade;
        if (h) ctx.fillRect(a0, cy - th * 0.2, a1 - a0, th * 0.4); else ctx.fillRect(cx - th * 0.2, a0, th * 0.4, a1 - a0);
        if (sweepP < 1 || p < hold + 0.1) {
          const sz = cs * 1.25, al = sweepP < 1 ? 1 : clamp01(1 - (p - hold) / 0.1);
          ctx.globalAlpha = al;
          for (const q of [a0, a1]) {
            if (h) ctx.drawImage(star, q - sz / 2, cy - sz / 2, sz, sz); else ctx.drawImage(star, cx - sz / 2, q - sz / 2, sz, sz);
          }
        }
      } else if (f.type === 'cagebreak') {
        // 籠子從中間裂開，左右兩半往外翻、往下掉
        const spr = blockSprite(f.spr || 'cage'), S2 = spr.width, x = ox + (f.c + 0.5) * cs, y = oy + (f.r + 0.5) * cs, e = easeOutCubic(p);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1 - p * p;
        for (const d of [-1, 1]) {
          ctx.save();
          ctx.translate(x + d * cs * 0.5 * e, y - cs * 0.3 * Math.sin(Math.PI * Math.min(1, p * 1.4)) + cs * 0.7 * p * p);
          ctx.rotate(d * 0.9 * e);
          ctx.drawImage(spr, d < 0 ? 0 : S2 / 2, 0, S2 / 2, S2, d < 0 ? -cs / 2 : 0, -cs / 2, cs / 2, cs);
          ctx.restore();
        }
        ctx.globalCompositeOperation = 'lighter';
      } else if (f.type === 'ring') {
        const x = ox + f.x * cs, y = oy + f.y * cs, e = easeOutCubic(p), R = cs * (0.3 + f.R * e);
        if (p < 0.4) {
          const fr = cs * f.R * 1.9 * (0.6 + 0.4 * e);
          ctx.globalAlpha = 1 - p / 0.4;
          ctx.drawImage(getGlowCol(f.col), x - fr / 2, y - fr / 2, fr, fr);
        }
        ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2);
        ctx.lineWidth = cs * 0.5 * (1 - p) + 1; ctx.strokeStyle = css(mixc(f.col, WHITE, 0.2), 0.7 * (1 - p)); ctx.stroke();
        ctx.lineWidth = cs * 0.14 * (1 - p) + 0.5; ctx.strokeStyle = css(WHITE, 0.95 * (1 - p)); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, R * 0.7, 0, Math.PI * 2);
        ctx.lineWidth = cs * 0.08 * (1 - p); ctx.strokeStyle = css(WHITE, 0.5 * (1 - p)); ctx.stroke();
      } else if (f.type === 'bolts') {
        const sx = ox + f.x * cs, sy = oy + f.y * cs;
        const tail = Math.min(1, (f.end - t) / 220);
        const og = cs * (1.8 + 0.5 * Math.sin(t / 40));
        ctx.globalAlpha = tail;
        ctx.drawImage(getGlowCol(BOLT_PINK), sx - og / 2, sy - og / 2, og, og);
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        const seedT = Math.floor(t / 55);
        for (let i = 0; i < f.targets.length; i++) {
          const q = f.targets[i];
          const st = f.t0 + f.first * 0.6 + i * f.stagger;
          if (t < st) continue;
          const tx = ox + q.x * cs, ty = oy + q.y * cs, life = t - st;
          const grow = clamp01(life / 60), ex = lerp(sx, tx, grow), ey = lerp(sy, ty, grow);
          const pts = boltPts(sx, sy, ex, ey, seedT * 131 + i * 977);
          const hue = (i * 47 + t / 6) % 360;
          ctx.globalAlpha = 1;
          ctx.strokeStyle = `hsla(${hue | 0},100%,68%,${(0.55 * tail).toFixed(3)})`; ctx.lineWidth = cs * 0.14; strokePts(pts);
          ctx.strokeStyle = css(WHITE, 0.95 * tail); ctx.lineWidth = cs * 0.045; strokePts(pts);
          if (life < 240 && grow >= 1) {
            const fr = cs * 1.4;
            ctx.globalAlpha = 1 - life / 240;
            ctx.drawImage(flash, tx - fr / 2, ty - fr / 2, fr, fr);
          }
        }
      } else if (f.type === 'wingfly') {
        // 長翅膀的玩偶放大飛離盤面：先往上飛一段優雅的弧線，再俯衝撞進目標格；身後拖著星塵和羽毛
        const u = easeInOutSine(clamp01(p));
        const x0 = ox + f.x0 * cs, y0 = oy + f.y0 * cs, x1 = ox + f.x1 * cs, y1 = oy + f.y1 * cs;
        const top = oy - MARGIN * cs * 0.6 + cs * 0.6;                    // 不要飛出畫布上緣
        const ay = Math.max(top, Math.min(y0, y1) - cs * 2.3), side = Math.min(cs * 1.4, Math.abs(x1 - x0) * 0.4 + cs * 0.6) * f.seed;
        const c1x = x0 + side, c1y = ay, c2x = x1 - side * 0.35, c2y = ay - cs * 0.2;
        const bz = (k, a0, a1, a2, a3) => { const m = 1 - k; return m * m * m * a0 + 3 * m * m * k * a1 + 3 * m * k * k * a2 + k * k * k * a3; };
        const x = bz(u, x0, c1x, c2x, x1), y = bz(u, y0, c1y, c2y, y1);
        const nx = bz(Math.min(1, u + 0.02), x0, c1x, c2x, x1), ny = bz(Math.min(1, u + 0.02), y0, c1y, c2y, y1);
        const tilt = clamp(Math.atan2(ny - y, nx - x) * 0.25, -0.5, 0.5) + (nx < x ? -0.05 : 0.05);
        // 星塵 + 羽毛（每 40ms 灑一次，跟著當下的位置）
        if (t - f.lastEmit > 40 && p < 0.97) {
          f.lastEmit = t;
          const gx = (x - ox) / cs, gy = (y - oy) / cs;
          for (let i = 0; i < 2; i++) {
            emit({ type: 1, img: getStarCol(i ? RING_BLUE : RING_GOLD), x: gx + (Math.random() - 0.5) * 0.3, y: gy + (Math.random() - 0.5) * 0.3,
              vx: (Math.random() - 0.5) * 0.8, vy: Math.random() * 0.6, g: 1.2, drag: 2.5, t0: t, life: 420 + Math.random() * 200, size: 0.22 + Math.random() * 0.16 });
          }
          if (Math.random() < 0.45) emit({ type: 1, img: getFeather(), x: gx, y: gy, vx: (Math.random() - 0.5) * 1.2, vy: -0.2, g: 0.9, drag: 2.2, t0: t,
            life: 700 + Math.random() * 300, size: 0.34 + Math.random() * 0.12, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 5 });
        }
        const grow = Math.sin(Math.PI * Math.min(1, u * 1.1));
        const sz = cs * (1.1 + 0.55 * grow);
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
        // 身後一圈柔光
        const gz = sz * 1.5;
        ctx.globalAlpha = 0.55;
        ctx.drawImage(getNeon(RING_BLUE), x - gz / 2, y - gz / 2, gz, gz);
        ctx.globalAlpha = 1;
        ctx.save(); ctx.translate(x, y); ctx.rotate(tilt);
        drawWings(0, -sz * 0.12, sz * 0.72, sz * 0.2, 0.5 + 0.5 * Math.sin(t / 55), 1);       // 飛的時候拍很快
        const e2 = f.kind >= 0 ? getTile(f.kind, 'fish') : null;
        if (e2 && e2.toy) { const P2 = e2.P / dpr * (sz / cs); ctx.drawImage(e2.toy, -P2 / 2, -P2 / 2, P2, P2); }
        ctx.restore();
        ctx.globalCompositeOperation = 'lighter';
      } else if (f.type === 'boardfx') {
        const bx = ox, by = oy, bw = cols * cs, bh = rows * cs, cx = bx + bw / 2, cy = by + bh / 2;
        ctx.globalAlpha = 1;
        if (p < 0.5) {
          ctx.fillStyle = css(WHITE, 0.75 * Math.pow(1 - p / 0.5, 2));
          ctx.fillRect(bx - cs * 0.3, by - cs * 0.3, bw + cs * 0.6, bh + cs * 0.6);
        }
        const R = Math.hypot(bw, bh) * 0.6 * easeOutCubic(p), n = 18;
        ctx.lineWidth = cs * 0.5 * (1 - p) + 1;
        for (let i = 0; i < n; i++) {
          ctx.beginPath(); ctx.arc(cx, cy, R, (i / n) * Math.PI * 2 + t / 300, ((i + 1) / n) * Math.PI * 2 + t / 300);
          ctx.strokeStyle = `hsla(${(i / n) * 360},100%,68%,${(0.8 * (1 - p)).toFixed(3)})`; ctx.stroke();
        }
      } else if (f.type === 'swirl') {
        const cx = ox + (cols / 2) * cs, cy = oy + (rows / 2) * cs, k = Math.sin(Math.PI * p);
        const R = cs * 3.6 * k;
        ctx.globalAlpha = 0.6 * k;
        ctx.drawImage(flash, cx - R / 2, cy - R / 2, R, R);
      }
    }
    fx.length = w;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawParticles(t) {
    if (!parts.length) return;
    let w = 0, stars = 0;
    for (const p of parts) {
      const age = (t - p.t0) / p.life;
      if (age >= 1) continue;
      parts[w++] = p;
      if (age < 0) continue;
      if (p.type === 3) {
        const s3 = (t - p.t0) / 1000, k3 = p.drag, f3 = k3 ? (1 - Math.exp(-k3 * s3)) / k3 : s3;
        const x3 = ox + (p.x + p.vx * f3) * cs, y3 = oy + (p.y + p.vy * f3 + 0.5 * p.g * s3 * s3) * cs;
        const z3 = 1 - age * 0.35, w3 = p.w * cs * z3, h3 = p.h * cs * z3;
        ctx.globalAlpha = age < 0.55 ? 1 : 1 - (age - 0.55) / 0.45;
        ctx.save(); ctx.translate(x3, y3); ctx.rotate(p.rot + p.vr * s3);
        ctx.drawImage(p.img, -w3 / 2, -h3 / 2, w3, h3);
        ctx.restore();
        continue;
      }
      if (p.type !== 0) { stars++; continue; }
      const s = (t - p.t0) / 1000, k = p.drag, fd = k ? (1 - Math.exp(-k * s)) / k : s;
      const x = ox + (p.x + p.vx * fd) * cs, y = oy + (p.y + p.vy * fd + 0.5 * p.g * s * s) * cs;
      const z = p.size * cs * (1 - age * 0.45);
      ctx.globalAlpha = age < 0.6 ? 1 : 1 - (age - 0.6) / 0.4;
      ctx.drawImage(p.img, x - z, y - z, z * 2, z * 2);
    }
    parts.length = w;
    if (stars) {
      // 星星 / 閃粉：淺色盤面上不用「加亮」混色（白底上加亮會看不見），一般疊上去；p.add 的才加亮（光點）
      for (const p of parts) {
        if (p.type === 0 || p.type === 3) continue;
        const age = (t - p.t0) / p.life;
        if (age < 0 || age >= 1) continue;
        const s = (t - p.t0) / 1000, k = p.drag, fd = k ? (1 - Math.exp(-k * s)) / k : s;
        const x = ox + (p.x + p.vx * fd) * cs, y = oy + (p.y + p.vy * fd + 0.5 * p.g * s * s) * cs;
        const z = p.size * cs * (0.6 + 0.4 * Math.sin(age * Math.PI));
        ctx.globalCompositeOperation = p.add ? 'lighter' : 'source-over';
        ctx.globalAlpha = age < 0.6 ? 1 : 1 - (age - 0.6) / 0.4;
        if (p.rot != null) {
          ctx.save(); ctx.translate(x, y); ctx.rotate(p.rot + (p.vr || 0) * s);
          ctx.drawImage(p.img, -z / 2, -z / 2, z, z);
          ctx.restore();
        } else ctx.drawImage(p.img, x - z / 2, y - z / 2, z, z);
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;
  }

  // ---- 飄分 ----
  // 位置用格：從 (x, y) 往上飄 TEXT_RISE 格，剛出現時先彈大再縮回（textScale）。textPos() 把整段軌跡收在
  // 畫布裡（第 0 列、最左右兩欄的分數不會被畫布邊緣切掉）；放的時候和畫的時候用同一個函式，
  // 所以 addText 能預先算出兩個分數之後會不會疊在一起。
  const TEXT_DUR = 950, TEXT_RISE = 0.85, TEXT_GAP = 0.06, TEXT_MAXS = 1.15;
  // 依序嘗試的位移（格）：原位、上、下、左右、再遠一點
  const TEXT_TRY = [[0, 0], [0, -0.5], [0, 0.5], [0.6, 0], [-0.6, 0], [0.6, -0.5], [-0.6, -0.5],
    [0, -1], [0, 1], [0.6, 0.5], [-0.6, 0.5], [1.2, 0], [-1.2, 0], [0, -1.5], [0, 1.5]];
  const textFont = f => (f.big ? 0.56 : 0.44);       // 字級 / 格
  const textScale = p => (p < 0.14 ? lerp(0.4, TEXT_MAXS, easeOutCubic(p / 0.14)) : p < 0.24 ? lerp(TEXT_MAXS, 1, (p - 0.14) / 0.1) : 1);
  function textPos(f, t) {
    const p = clamp01((t - f.t0) / f.dur), e = easeOutCubic(p), s = textScale(p);
    let x = f.x, y = f.y - TEXT_RISE * e;
    if (cs > 0 && W > 0 && H > 0) {
      const k = Math.max(1, s), pad = 2 / cs, hw = (f.w * k) / 2 + pad, hh = (f.h * k) / 2 + pad;
      const x0 = -ox / cs + hw, x1 = (W - ox) / cs - hw, y0 = -oy / cs + hh, y1 = (H - oy) / cs - hh;
      x = x1 > x0 ? clamp(x, x0, x1) : (x0 + x1) / 2;
      // 起點先收進畫布，再把上飄距離縮短到剛好碰到上緣（曲線不變，只是飄得比較少）
      const sy = y1 > y0 ? clamp(f.y, y0, y1) : (y0 + y1) / 2;
      y = sy - Math.min(TEXT_RISE, Math.max(0, sy - y0)) * e;
    }
    return { x, y, s };
  }
  // 兩個分數在都還清楚可見（淡到 1/3 以前）的期間，外框最多重疊多少格（0 = 不重疊）
  function textsOverlap(a, b) {
    // 起點離很遠就不用逐格時間檢查（收進畫布最多只會移動不到半格）
    if (Math.abs(a.x - b.x) > (a.w + b.w) * 0.6 + 0.5 || Math.abs(a.y - b.y) > TEXT_RISE + (a.h + b.h) * 0.6 + 0.5) return 0;
    const end = Math.min(a.t0 + a.dur * 0.9, b.t0 + b.dur * 0.9);
    let worst = 0;
    for (let t = Math.max(a.t0, b.t0); t <= end; t += 30) {
      const pa = textPos(a, t), pb = textPos(b, t);
      const dx = (a.w * pa.s + b.w * pb.s) / 2 + TEXT_GAP - Math.abs(pa.x - pb.x);
      const dy = (a.h * pa.s + b.h * pb.s) / 2 + TEXT_GAP - Math.abs(pa.y - pb.y);
      if (dx > 0 && dy > 0) worst = Math.max(worst, Math.min(dx, dy));
    }
    return worst;
  }
  function addText(text, x, y, t0, col, big) {
    if (quiet) return null;
    const f = { text, x, y, t0, dur: TEXT_DUR, col, big, w: 0, h: 0, sp: null, spCs: 0 };
    // 外框大小（格）：用實際字型量，加上描邊（小字級的字框會略高一點，多留 0.04）
    let wr = 0.62 * text.length, hr = 0.78;
    try {
      const sc = scratchCtx();
      sc.font = `900 100px ${FONT}`;
      const m = sc.measureText(text);
      if (m.width > 0) wr = m.width / 100;
      const mh = (m.actualBoundingBoxAscent || 0) + (m.actualBoundingBoxDescent || 0);
      if (mh > 0) hr = mh / 100 + 0.04;
    } catch (err) { /* 量不到就用估計值 */ }
    const fs = textFont(f);
    f.w = (wr + 0.22) * fs; f.h = (hr + 0.22) * fs;
    // 避開還在飄的分數：照 TEXT_TRY 的順序找第一個完全不重疊的位置，找不到就取重疊最少的
    const live = texts.filter(o => o.t0 + o.dur * 0.9 > t0);
    if (live.length) {
      let best = null;
      for (const [dx, dy] of TEXT_TRY) {
        f.x = x + dx; f.y = y + dy;
        let s = 0;
        for (const o of live) { s += textsOverlap(f, o); if (best && s >= best.s) break; }
        if (!best || s < best.s - 1e-6) best = { s, x: f.x, y: f.y };
        if (s <= 0) break;
      }
      f.x = best.x; f.y = best.y;
    }
    texts.push(f);
    requestDraw();
    return f;
  }

  function drawTexts(t) {
    let w = 0;
    for (const f of texts) {
      const p = (t - f.t0) / f.dur;
      if (p >= 1) continue;
      texts[w++] = f;
      if (p < 0) continue;
      if (!f.sp || f.spCs !== cs) {
        const oc = saturate(f.col, 0.5);
        f.sp = textSprite(f.text, cs * textFont(f) * TEXT_MAXS, '#fff', css(mixc(oc, BLACK, 0.42)), null, false, css(mixc(oc, BLACK, 0.7)));
        f.spCs = cs;
      }
      const q = textPos(f, t);
      ctx.globalAlpha = p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3;
      drawSprite(f.sp, ox + q.x * cs, oy + q.y * cs, q.s / TEXT_MAXS);
    }
    texts.length = w;
    ctx.globalAlpha = 1;
  }

  // ---- 稱讚字（在消除的地方彈出來，Q 彈地放大、晃一晃、往上飄、淡掉）----
  const PRAISE = { 2: ['超可愛!', '軟綿綿!'], 3: ['好Q彈!', '甜滋滋!'], 4: ['大爆發!', '超厲害!'], 5: ['神操作!', '無敵可愛!'] };
  let praises = [];
  function addPraise(level, x, y, t0) {
    if (quiet) return;
    const lv = clamp(Math.round(level), 2, 5), list = PRAISE[lv];
    praises.push({ text: list[Math.floor(Math.random() * list.length)], lv, x, y, t0, dur: 1050, sp: null, spCs: 0, tilt: (Math.random() - 0.5) * 0.3 });
    if (praises.length > 3) praises.shift();
    if (lv >= 4) at(t0, tt => sparkle(x, y, 4 + lv * 2, tt, 0.6));
    requestDraw();
  }
  function drawPraises(t) {
    let w = 0;
    for (const f of praises) {
      const p = (t - f.t0) / f.dur;
      if (p >= 1) continue;
      praises[w++] = f;
      if (p < 0) continue;
      if (!f.sp || f.spCs !== cs) {
        const pal = WORD_PAL[f.lv - 2], size = cs * (0.6 + 0.13 * (f.lv - 2));
        f.sp = textSprite(f.text, size, (g, sz) => {
          const w0 = g.canvas.width / dpr / 2, h0 = g.canvas.height / dpr / 2;
          const gr = g.createLinearGradient(w0, h0 - sz / 2, w0, h0 + sz / 2);
          gr.addColorStop(0, pal[0]); gr.addColorStop(0.5, pal[1]); gr.addColorStop(1, pal[2]);
          return gr;
        }, '#fff', css(PLUM), true, css(PLUM_D));
        f.spCs = cs;
      }
      const pin = clamp01(p / 0.2), sc = easeOutBack(pin, 3.2) * (1 + (p > 0.2 ? 0.04 * Math.sin((p - 0.2) * 18) * (1 - p) : 0));
      const half = f.sp.w / cs / 2, x = clamp(f.x, half, Math.max(half, cols - half)), y = Math.max(0.5, f.y - 0.2 - 0.7 * easeOutCubic(p));
      ctx.save();
      ctx.translate(ox + x * cs, oy + y * cs);
      ctx.rotate(f.tilt + 0.08 * Math.sin(p * 14) * (1 - p));
      ctx.globalAlpha = p < 0.72 ? 1 : 1 - (p - 0.72) / 0.28;
      drawSprite(f.sp, 0, 0, Math.max(0.001, sc));
      ctx.restore();
    }
    praises.length = w;
    ctx.globalAlpha = 1;
  }

  const WORD_PAL = [['#fff8b0', '#ffc23d', '#ff7a59'], ['#fff3fb', '#ff9ad1', '#ff4f9a'], ['#f3ecff', '#c49bff', '#8a5cff'], ['#fffbe0', '#ffd23d', '#ff4fa3']];
  function drawWord(t) {
    if (!word) return;
    const p = (t - word.t0) / word.dur;
    if (p >= 1) { word = null; return; }
    const bw = cols * cs, cx = ox + bw / 2, cy = oy + rows * cs * 0.4;
    const pin = clamp01((t - word.t0) / 280), pout = clamp01((t - word.t0 - word.dur + 250) / 250);
    if (!word.sp || word.spCs !== cs) word.sp = wordSprite(word.text, word.level), word.spCs = cs;
    let sc = easeOutBack(pin, 2.4) * (1 + 0.15 * pout);
    // 玩具圖放在字的左邊，一起置中；太寬就一起縮小
    const pic = word.pic && usable(word.pic.img) ? word.pic : null;
    const iw = pic ? cs * 2.5 : 0, gap = pic ? -cs * 0.35 : 0;
    const total = iw + gap + word.sp.w;
    const fit = Math.min(1, (bw * 0.98) / total);
    const left = -total * fit / 2;
    ctx.save();
    ctx.translate(cx, cy - pout * cs * 0.6);
    ctx.rotate(-0.07 + 0.03 * Math.sin((t - word.t0) / 120) * (1 - pin));
    ctx.globalAlpha = 1 - pout;
    if (pic) {
      // 圖比字晚一點點彈出來，搖一下
      const ppin = clamp01((t - word.t0 - 60) / 300), ps = easeOutBack(ppin, 3) * fit * (1 + 0.15 * pout);
      ctx.save();
      ctx.translate(left + iw * fit / 2, 0);
      ctx.rotate(word.tilt + 0.12 * Math.sin((t - word.t0) / 110) * (1 - ppin * 0.6));
      const img = pic.img, d = iw * ps;
      if (pic.frame >= 0) {
        const fw = natW(img) / 6, fh = natH(img) / 4, i = pic.frame;
        if (d > 0) ctx.drawImage(img, (i % 6) * fw, Math.floor(i / 6) * fh, fw, fh, -d / 2, -d / 2, d, d);
      } else if (d > 0) {
        drawSprite(photoSprite(img, iw * fit), 0, 0, d / (iw * fit));
      }
      ctx.restore();
    }
    drawSprite(word.sp, left + (iw + gap) * fit + word.sp.w * fit / 2, 0, Math.max(0.001, sc * fit));
    ctx.restore();
  }
  // 連鎖字的小圖：同一個字、同樣大小只畫一次
  const wordCache = new Map();
  function wordSprite(text, level) {
    const bw = cols * cs, key = text + '|' + cs + '|' + dpr + '|' + bw;
    let sp = wordCache.get(key);
    if (sp) return sp;
    {
      let size = cs * (1.05 + 0.08 * (Math.min(5, level) - 2));
      const sc = scratchCtx();
      sc.font = `900 ${size}px ${FONT}`;
      const mw = sc.measureText(text).width;
      if (mw > bw * 0.92) size *= (bw * 0.92) / mw;
      const pal = WORD_PAL[Math.min(3, Math.max(0, level - 2))];
      // 漸層的座標以字的中心為原點：textSprite 會在 (w/2, h/2) 畫字，所以先位移
      sp = textSprite(text, size, (g, s) => {
        const w0 = g.canvas.width / dpr / 2, h0 = g.canvas.height / dpr / 2;
        const gr = g.createLinearGradient(w0, h0 - s / 2, w0, h0 + s / 2);
        gr.addColorStop(0, pal[0]); gr.addColorStop(0.5, pal[1]); gr.addColorStop(1, pal[2]);
        return gr;
      }, '#fff', css(PLUM), true, css(PLUM_D));
    }
    if (wordCache.size > 16) wordCache.clear();
    wordCache.set(key, sp);
    return sp;
  }

  function drawBanners(t) {
    if (!banners.length) return;
    const b = banners[banners.length - 1];
    const bw = cols ? cols * cs : W, cx = cols ? ox + bw / 2 : W / 2, cy = rows ? oy + rows * cs / 2 : H / 2;
    const unit = cols ? cs : Math.min(W, H) / 9;
    const pin = clamp01((t - b.t0) / 340), pout = clamp01((t - b.t0 - b.dur + 320) / 320);
    const vis = easeOutCubic(pin) * (1 - easeInCubic(pout));
    const maxW = Math.min(W * 0.92, bw * 1.05);
    const key = unit.toFixed(2) + '|' + maxW.toFixed(1) + '|' + dpr;
    if (!b.sp || b.key !== key) {
      let size = unit * 1.15;
      const sc = scratchCtx();
      sc.font = `900 ${size}px ${FONT}`;
      const mw = sc.measureText(b.text).width;
      if (mw > maxW) size *= maxW / mw;
      b.sp = textSprite(b.text, size, (g, s) => {
        const w0 = g.canvas.width / dpr / 2, h0 = g.canvas.height / dpr / 2;
        const gr = g.createLinearGradient(w0, h0 - s / 2, w0, h0 + s / 2);
        gr.addColorStop(0, '#fffdf0'); gr.addColorStop(0.55, '#fff0a8'); gr.addColorStop(1, '#ffc94d');
        return gr;
      }, '#fff', css(PLUM), true, css(PLUM_D));
      b.subSp = null;
      if (b.sub) {
        let ss = unit * 0.46;
        sc.font = `900 ${ss}px ${FONT}`;
        const sw = sc.measureText(b.sub).width;
        if (sw > maxW) ss *= maxW / sw;
        b.subSp = textSprite(b.sub, ss, '#fff', css(PLUM), null, false, css(PLUM_D));
      }
      b.key = key;
    }
    ctx.save();
    if (bgCache && bgCache.shade) {
      ctx.globalAlpha = 0.34 * vis;
      ctx.drawImage(bgCache.shade, bgCache.x, bgCache.y, bgCache.w, bgCache.h);
      ctx.globalAlpha = 1;
    }
    const bh = unit * (b.sub ? 2.5 : 1.9);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(Math.max(0.001, easeOutCubic(pin)), 1 - 0.3 * pout);
    ctx.globalAlpha = 1 - pout;
    const rg = ctx.createLinearGradient(-W / 2, 0, W / 2, 0);
    rg.addColorStop(0, 'rgba(255,120,190,0)'); rg.addColorStop(0.15, 'rgba(255,120,190,0.92)');
    rg.addColorStop(0.5, 'rgba(196,120,255,0.95)'); rg.addColorStop(0.85, 'rgba(255,120,190,0.92)'); rg.addColorStop(1, 'rgba(255,120,190,0)');
    ctx.fillStyle = rg; ctx.fillRect(-W / 2, -bh / 2, W, bh);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillRect(-W / 2, -bh / 2, W, Math.max(1.5, unit * 0.05));
    ctx.fillRect(-W / 2, bh / 2 - Math.max(1.5, unit * 0.05), W, Math.max(1.5, unit * 0.05));
    ctx.restore();
    const ty = cy - (b.sub ? unit * 0.32 : 0);
    const sc = easeOutBack(clamp01((t - b.t0 - 80) / 360), 2.2) * (1 + 0.25 * pout);
    ctx.translate(cx, ty);
    ctx.scale(Math.max(0.001, sc), Math.max(0.001, sc));
    ctx.globalAlpha = 1 - pout;
    drawSprite(b.sp, 0, 0, 1);
    if (b.subSp) drawSprite(b.subSp, 0, unit * 0.95, 1);
    ctx.restore();
  }

  function draw(t) {
    if (destroyed) return;
    runSched(t);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (rows && cols && W) {
      let sx = 0, sy = 0;
      if (shakes.length) {
        let w = 0;
        for (const s of shakes) {
          const p = (t - s.t0) / s.dur;
          if (p >= 1) continue;
          shakes[w++] = s;
          if (p < 0) continue;
          const a = s.mag * (1 - p) * (1 - p);
          sx += (Math.random() * 2 - 1) * a; sy += (Math.random() * 2 - 1) * a;
        }
        shakes.length = w;
      }
      ctx.setTransform(dpr, 0, 0, dpr, sx * dpr, sy * dpr);
      if (bgCache) ctx.drawImage(bgCache.c, bgCache.x, bgCache.y, bgCache.w, bgCache.h);
      drawJelly(t);
      drawBelts(t);
      drawPieces(t);
      drawGhosts(t);
      drawFx(t);
      drawParticles(t);
      drawTexts(t);
      drawPraises(t);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawWord(t);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBanners(t);
  }

  // ================= 主迴圈 =================
  function moving(t) {
    if (sched.length || ghosts.length || fx.length || parts.length || texts.length || praises.length || word || banners.length || shakes.length || dragState || jellyFx.size) return true;
    for (const v of visuals.values()) {
      const m = v.mv;
      if (m && t < m.t0 + m.dur + 20) return true;
      if (t - v.landT < LAND_MS + 20 || t - v.popT < POPIN_MS + 20) return true;
      if ((v.morph && t < v.morph.until + 20) || (v.hideUntil && t < v.hideUntil + 20)) return true;
    }
    return false;
  }
  function ambient() {
    if (selected || hintPair || exitCells.length || portalList.length || beltList.length) return true;
    for (const v of visuals.values()) if (v.special !== 'none' || v.kind < 0) return true;
    return false;
  }
  // 只有待機動畫（特殊方塊在閃、提示在晃，沒有東西在移動）：中後段盤面上幾乎隨時都有特殊方塊，等於一直在畫，
  // 所以只畫約 15fps（慢慢的閃爍看不出差別），而且兩張之間不要每個 vsync 都醒來：用 setTimeout 等到下一張該畫的時候再掛 rAF。
  // 手指選著方塊時是在操作，維持約 30fps 比較順
  const AMB_MS = 66, SEL_MS = 31;
  let ambTimer = 0;
  // 每幀最多畫一次：畫的途中有人呼叫 requestDraw()（加飄分、排程…）不會再多掛一個 rAF
  function frame() {
    raf = 0;
    if (destroyed || paused) return;
    const t = now();
    inFrame = true;
    let act = false, amb = false, gap = AMB_MS;
    try {
      act = moving(t);
      amb = !act && ambient();
      gap = selected ? SEL_MS : AMB_MS;
      if (!(amb && t - lastDraw < gap)) { lastDraw = t; draw(t); }
    } catch (e) {
      console.error('[renderer] draw', e);
    } finally {
      inFrame = false;
    }
    if (raf || destroyed || paused) return;
    if (act || busyCount > 0 || moving(now())) raf = requestAnimationFrame(frame);
    else if (amb && !ambTimer) ambTimer = setTimeout(() => { ambTimer = 0; requestDraw(); }, Math.max(0, lastDraw + gap - now() - 8));
  }
  function requestDraw() {
    if (ambTimer) { clearTimeout(ambTimer); ambTimer = 0; }
    if (!raf && !inFrame && !destroyed && !paused && typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(frame);
  }
  // 畫面藏起來時停掉迴圈；play() 的等待用 setTimeout，所以動畫流程照樣會走完（只是不畫）
  function pause() {
    if (destroyed || paused) return;
    paused = true;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (ambTimer) { clearTimeout(ambTimer); ambTimer = 0; }
  }
  function resume() {
    if (destroyed) return;
    paused = false;
    layout();          // 有尺寸時會立刻重畫並接回迴圈
    requestDraw();
  }

  // ================= 生命週期 =================
  let ro = null;
  const onResize = () => layout();
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => layout());
    ro.observe(canvas);
  }
  window.addEventListener('resize', onResize);

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    gen++;
    abortWaits();
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (ambTimer) { clearTimeout(ambTimer); ambTimer = 0; }
    clearTimeout(warmTimer); warmQ = [];
    if (ro) ro.disconnect();
    window.removeEventListener('resize', onResize);
    for (const b of banners) { clearTimeout(b.timer); b.res(); }
    banners = []; ghosts = []; fx = []; parts = []; texts = []; sched = [];
    tileCache.clear(); fanCache.clear(); fluffCache.clear(); starColCache.clear(); glowColCache.clear(); beamCache.clear(); blockCache.clear(); crumbCache.clear();
  }

  // 衣櫃的外觀：{ hat, fx, frame, theme }（沒給的不變）。換了就把方塊圖、盤面重畫
  function setLook(l) {
    if (!l || destroyed) return;
    const next = { ...look, ...l };
    const tiles = next.hat !== look.hat || next.frame !== look.frame || next.theme !== look.theme;
    const theme = next.theme !== look.theme;
    look = next;
    particleSkin = PARTICLE_SKINS[look.fx] ? look.fx : 'default';
    BOARD_THEME = BOARD_THEMES[look.theme] || BOARD_THEMES.macaron;
    themeGeom();
    if (look.hat && look.hat !== 'none') accImg(look.hat);
    if (tiles) { tileCache.clear(); accCache.clear(); }
    if (theme) geom();
    if (tiles && rows) prewarm();
    requestDraw();
  }
  // 衣櫃預覽：在某一格放一次消除的特效（粒子 + 閃光），不改盤面
  function demoBurst(r, c) {
    const v = cellV({ r, c }), t = now();
    if (!v) return;
    const col = v.kind >= 0 ? kindColor(v.kind) : [255, 214, 120];
    fx.push({ type: 'flash', x: c + 0.5, y: r + 0.5, t0: t, dur: 260, R: 1 });
    fx.push({ type: 'pring', x: c + 0.5, y: r + 0.5, t0: t, dur: 260, col, R: 0.8 });
    burst(c + 0.5, r + 0.5, col, 9, t, { stars: 5, speed: 3.2 });
    v.popT = t + 120;
    requestDraw();
  }
  // 某一格在畫面上的位置（CSS px，視窗座標）：main.js 讓收集目標從這裡飛到上面的目標圖示
  function cellRect(r, c) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !W) return null;
    const k = rect.width / W;
    return { x: rect.left + (ox + (c + 0.5) * cs) * k, y: rect.top + (oy + (r + 0.5) * cs) * k, size: cs * k };
  }
  const R = {
    setBoard, layout, cellAt, select, drag, hint, play, banner, destroy, pause, resume, cellRect, setLook, demoBurst,
    get busy() { return busyCount > 0; },
    get paused() { return paused; },
  };
  // 測試用（非正式 API）
  Object.defineProperty(R, '_debug', { enumerable: false, value: () => ({
    rows, cols, cs, ox, oy, dpr, W, H, visuals: visuals.size, ghosts: ghosts.length, fx: fx.length,
    parts: parts.length, texts: texts.length, sched: sched.length, busy: busyCount, raf: !!raf, paused,
    grid: cellMap.map(row => row.map(v => (v ? v.id : null))),
    kinds: cellMap.map(row => row.map(v => (v ? v.kind + '|' + v.special : null))),
    moving: [...visuals.values()].filter(v => v.mv && now() < v.mv.t0 + v.mv.dur).length,
    warm: warmQ.length, words: wordCache.size,
    fits: Object.fromEntries([...fitCache].map(([k, f]) => [pieceInfo(k).id, { box: +f.box.toFixed(3), dx: +f.dx.toFixed(3), dy: +f.dy.toFixed(3) }])),
    offCell: [...visuals.values()].filter(v => { const st = evalVisual(v, now()); return Math.abs(st.x - v.c) > 0.02 || Math.abs(st.y - v.r) > 0.02; }).length,
  }) });
  // 測試用：直接跳一個口號（截圖檢查口號旁的照片）
  Object.defineProperty(R, '_word', { enumerable: false, value: (text, level, sl) => showWord(text, level, sl) });
  layout();
  return R;
}
