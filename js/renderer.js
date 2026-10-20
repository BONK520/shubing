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
//                     'combo' 'special'(special) 'land' 'chime'(level) 'shuffle'
//   R.pause()   停掉 requestAnimationFrame 迴圈（遊戲畫面被藏起來時用，例如回到地圖 / 標題），
//               選取、提示、特殊方塊的待機動畫都不再每幀重畫。play() / banner() 照常計時完成，不會卡住。
//   R.resume()  恢復迴圈並立刻重畫一次（期間尺寸若有變也會重新排版）。兩者都可以重複呼叫。
//   R.paused    目前是否暫停（唯讀）。

import { SLOGANS, cascadeSlogan } from './slogans.js';

// 數字用胖數字 PlushNum（只有數字和符號，style.css 的 unicode-range），其他字是源泉圓體
const FONT = '"PlushNum", "GenSenRounded", "Baloo 2", "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", system-ui, sans-serif';
const MAX_DPR = 2;        // 手機上限：再高肉眼幾乎看不出差別，填色量卻多很多
const MARGIN = 0.25;      // 盤面四周保留（格）：放得下有厚度的盤子外框
const FRAME_B = 0.34;     // 盤面下面再多留（格）：盤子的厚度和投影
const PAD = 1.42;         // 方塊快取畫布邊長 / 格（留給陰影、糖果紙兩端）
const TILE = 0.88;        // 圓角方塊邊長 / 格
const MAX_PARTS = 900;

// ---- 節奏（毫秒）----
const SWAP_MS = 200;      // 成功交換（主動的那顆有一點點回彈）
const SWAP_BAD_MS = 150;  // 不成立的交換：過去
const SWAP_BACK_MS = 170; //                 彈回來
const POP_MS = 380;       // 消除：放大 + 白光 → 碎開
const POP_LEAD = 300;     // 最後一顆開始爆之後多久就開始掉落（讓碎開看得清楚）
const GROUP_STAGGER = 36; // 同一步裡好幾組消除：一組接一組爆，音高一組比一組高
const POP_SEQ = 55;       // 同一組裡一顆接一顆爆（「啵、啵、啵」）
const MERGE_MS = 140;     // 合成特殊方塊：同組的方塊吸過去
const POPIN_MS = 340;     // 新特殊方塊 / 變身的彈出
const LAND_MS = 270;      // 落地壓扁回彈
const LAND_HOLD = 100;     // 下一輪連鎖：方塊落地後多久爆
const G_FALL = 0.00005;   // 掉落重力（格 / ms²）：一格約 0.13 秒、整欄約 0.45 秒（參考 Candy Crush 類遊戲：約 0.1 秒 / 格）
const V0_FALL = 0.004;    // 掉落初速（格 / ms）
const STAGGER_ROW = 60, STAGGER_MAX = 360, COL_JITTER = 30;   // 同一欄一顆接一顆落下（間隔約 0.06 秒），像瀑布
// 特效傳到某格要多久
const LINE_MS = 28, BLAST_MS = 55, BOARD_MS = 36, CHAIN_MS = 38, BOMB_FIRST = 110, CLEAR_CAP = 800;

const WHITE = [255, 255, 255], BLACK = [0, 0, 0], PLUM = [74, 34, 112], PLUM_D = [40, 12, 78], GOLD = [255, 196, 40];
const now = () => performance.now();
const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
const easeInCubic = t => t * t * t;
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
const HEART = (() => {
  const a = 0.47, b = -0.33, r = 0.5, t = 0.72, rt = 0.18, f = 0.1;
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
      const w = R * 0.84, h = R;
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
    case 'bean': g.ellipse(cx, cy, R * 1.0, R * 0.74, -0.38, 0, Math.PI * 2); break;
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

export function createRenderer(canvas, { pieces = [], images = new Map() } = {}) {
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
  let banners = [];
  let shakes = [];
  let sched = [];                   // 定時動作 { t, fn }
  const jellyFx = new Map();        // key -> { t0, from }
  let selected = null, hintPair = null, dragState = null;
  let fallSeq = 0;
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
    const src = vivid(scaled(im, box)), pad = Math.ceil(box * 0.16), W = src.width + pad * 2;
    c = makeCanvas(W, W);
    const g = c.getContext('2d'), col = kindColor(kind);
    // 外圍柔光：糖果色的亮色版（不是白色、也不是一條硬線），兩圈位置疊出往外淡掉的光（淡淡的就好，太亮玩具會像浮在糖果上）
    const glow = silhouette(src, css(mixc(saturate(col, 0.35), WHITE, 0.4)));
    for (const [rr2, a] of [[box * 0.045, 0.05], [box * 0.024, 0.1]]) {
      g.globalAlpha = a;
      for (let k = 0; k < 16; k++) { const t = k / 16 * Math.PI * 2; g.drawImage(glow, pad + Math.cos(t) * rr2, pad + Math.sin(t) * rr2); }
    }
    g.globalAlpha = 1;
    // 落影：糖果色的深色版，往右下偏（光從左上來）。兩層：範圍大、很柔的影子（玩具像陷進糖果的凹槽裡）+ 貼著邊緣的接觸影
    // 柔邊用 shadowBlur（不用 ctx.filter，Safari 也一樣）：玩具圖畫在原位、影子往右下偏，圖本身等一下會被玩具蓋住
    const shc = mixc(saturate(col, 0.5), [34, 16, 84], 0.74);
    for (const [ox2, oy2, blur, a] of [[0.022, 0.075, 0.1, 0.55], [0.012, 0.034, 0.032, 0.42]]) {
      g.save();
      g.shadowColor = css(shc, a); g.shadowBlur = box * blur; g.shadowOffsetX = box * ox2; g.shadowOffsetY = box * oy2;
      g.drawImage(src, pad, pad);
      g.restore();
    }
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
  // 玩具要多大：在小畫布上把糖果和玩具疊起來量，找「蓋住糖果約 70%、超出糖果外框不到 3%」的最大尺寸
  // （外圈要留一圈果凍色，才一眼看得出是什麼顏色）
  // （每種糖果形狀不一樣、每隻玩具的輪廓也不一樣，所以用量的；換玩具圖也會自動算）
  const FIT_N = 80, FIT_COVER = 0.7, FIT_OUT = 0.03;
  const shapeMasks = new Map(), fitCache = new Map();
  let fitG = null;
  function fitCtx() {
    if (!fitG) { const c = makeCanvas(FIT_N * 1.5, FIT_N * 1.5); fitG = c.getContext('2d', { willReadFrequently: true }); }
    return fitG;
  }
  // face：糖果有顏色的那一面（算蓋住多少）
  // rim：連深色外框，凹進去的地方（愛心上面的凹口、花瓣之間）也補滿 —— 玩具蓋在那裡看起來是「在糖果前面」，不算超出
  function shapeMask(shape) {
    let m = shapeMasks.get(shape);
    if (m) return m;
    const g = fitCtx(), P = g.canvas.width, read = scale => {
      g.clearRect(0, 0, P, P);
      candyPath(g, shape, P / 2, P / 2, FIT_N * CANDY_R * scale); g.fillStyle = '#000'; g.fill();
      const d = g.getImageData(0, 0, P, P).data, px = new Uint8Array(P * P);
      for (let i = 0; i < px.length; i++) if (d[i * 4 + 3] > 127) px[i] = 1;
      return px;
    };
    const face = read(1), raw = read(1.06), rim = new Uint8Array(P * P);
    for (let y = 0; y < P; y++) {                         // 每一列：最左到最右補滿
      let a = -1, b = -1;
      for (let x = 0; x < P; x++) if (raw[y * P + x]) { if (a < 0) a = x; b = x; }
      for (let x = a; a >= 0 && x <= b; x++) rim[y * P + x] = 1;
    }
    for (let x = 0; x < P; x++) {                         // 每一行：最上到最下補滿
      let a = -1, b = -1;
      for (let y = 0; y < P; y++) if (raw[y * P + x]) { if (a < 0) a = y; b = y; }
      for (let y = a; a >= 0 && y <= b; y++) rim[y * P + x] = 1;
    }
    let area = 0;
    for (let i = 0; i < face.length; i++) area += face[i];
    m = { face, rim, area: Math.max(1, area) };
    shapeMasks.set(shape, m);
    return m;
  }
  function measureFit(im, m, box, dx, dy) {
    const g = fitCtx(), P = g.canvas.width, w = natW(im), h = natH(im), k = box / Math.max(w, h);
    g.clearRect(0, 0, P, P);
    g.drawImage(im, P / 2 + dx - w * k / 2, P / 2 + dy - h * k / 2, w * k, h * k);
    const d = g.getImageData(0, 0, P, P).data;
    let toy = 0, onFace = 0, onRim = 0;
    for (let i = 0, j = 3; i < m.face.length; i++, j += 4) if (d[j] > 127) { toy++; onFace += m.face[i]; onRim += m.rim[i]; }
    return { cover: onFace / m.area, out: toy ? (toy - onRim) / toy : 0 };
  }
  // 回傳以「格」為單位的 { box, dx, dy }
  function toyFit(kind, im) {
    let f = fitCache.get(kind);
    if (f && f.im === im) return f;
    const b = toyBounds(im), cx0 = 0.5 - (b.x0 + b.x1) / 2, cy0 = 0.5 - (b.y0 + b.y1) / 2;
    let best = { box: 0.72, dx: cx0 * 0.72, dy: cy0 * 0.72 };
    try {
      const m = shapeMask(shapeOf(kind));
      // 往上 / 往下挪一點，看哪裡放得最大（愛心上寬下尖，玩具放高一點才放得大）
      for (const shift of [0, -0.03, 0.03, -0.06, -0.09]) {
        let lo = 0.4, hi = 1.3;
        for (let it = 0; it < 8; it++) {
          const mid = (lo + hi) / 2, r = measureFit(im, m, mid * FIT_N, cx0 * mid * FIT_N, (cy0 * mid + shift) * FIT_N);
          if (r.cover <= FIT_COVER && r.out <= FIT_OUT) lo = mid; else hi = mid;
        }
        if (shift === 0 || lo > best.box + 0.01) best = { box: lo, dx: cx0 * lo, dy: cy0 * lo + shift };
      }
    } catch (e) { /* 讀不到像素：用預設大小 */ }
    f = { im, ...best };
    fitCache.set(kind, f);
    return f;
  }
  // 玩具在糖果裡的大小和位置（像素）
  function toyLayout(kind, special, S) {
    const k = special === 'wrap' ? 0.84 : 1, im = toyImage(kind);
    if (!im) return { box: Math.round(S * 0.72 * k), dx: 0, dy: 0 };
    const f = toyFit(kind, im);
    return { box: Math.round(S * f.box * k), dx: f.dx * S * k, dy: f.dy * S * k };
  }
  // 條紋糖果：玩具身上也印淡淡的條紋（只印在玩具上，不印在影子上）
  function paintToyStripes(g, kind, tx, ty, box, x, y, T, dir) {
    const im = toyImage(kind);
    if (!im) return;
    const c = makeCanvas(box, box), q = c.getContext('2d');
    q.fillStyle = 'rgba(255,255,255,0.32)';
    q.translate(box / 2 - tx, box / 2 - ty);
    paintStripes(q, x, y, T, dir);
    q.setTransform(1, 0, 0, 1, 0, 0);
    q.globalCompositeOperation = 'destination-in';
    q.drawImage(scaled(im, box), 0, 0);
    g.drawImage(c, tx - box / 2, ty - box / 2);
  }
  function paintStripes(g, x, y, T, dir) {
    const n = 4, band = T * 0.105, step = T / n;
    for (let i = 0; i < n; i++) {
      const o = step * (i + 0.5) - band / 2;
      if (dir === 'h') g.fillRect(x - T, y + o, T * 3, band);
      else g.fillRect(x + o, y - T, band, T * 3);
    }
  }
  const SHAPE_OF = { dog: 'ball', sloth: 'square', egg: 'egg', dino: 'flower', nyanko: 'hex', moodeng: 'bean', snoopy: 'heart' };   // 顏色在 pieces.js
  const SHAPE_CYCLE = ['ball', 'square', 'egg', 'flower', 'hex', 'bean', 'heart'];
  function shapeOf(kind) { const id = pieceInfo(kind).id; return SHAPE_OF[id] || SHAPE_CYCLE[((kind % 7) + 7) % 7]; }
  const CANDY_R = 0.45;     // 糖果半徑 / 格
  // 立體糖果（像 Candy Crush）：光從左上來 → 左上亮、右下暗；壓在盤面上的落影；玩具在裡面，上面再蓋反光
  function paintCandy(g, kind, cx, cy, S, col, special) {
    const shape = shapeOf(kind), R = S * CANDY_R;
    const sat = saturate(col, 0.12), dark = saturate(col, 0.3);
    const deep = mixc(dark, BLACK, 0.55), deeper = mixc(dark, [26, 10, 64], 0.7);
    // 落影：很深的藍黑色、半透明，往右下壓在格子的凹槽裡（範圍大、很柔）；再一圈貼著底部的接觸陰影，糖果才有重量、不像浮在上面
    g.save();
    g.shadowColor = 'rgba(6,6,32,0.6)'; g.shadowBlur = S * 0.1; g.shadowOffsetX = S * 0.055; g.shadowOffsetY = S * 0.09;
    candyPath(g, shape, cx, cy, R * 1.04); g.fillStyle = css(deep); g.fill();
    g.restore();
    g.save();
    g.shadowColor = 'rgba(4,4,24,0.6)'; g.shadowBlur = S * 0.03; g.shadowOffsetX = S * 0.018; g.shadowOffsetY = S * 0.04;
    candyPath(g, shape, cx, cy, R * 1.05); g.fillStyle = css(deep); g.fill();
    g.restore();
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
    if (special === 'h' || special === 'v') {
      g.fillStyle = 'rgba(255,255,255,0.86)';
      paintStripes(g, cx - R, cy - R, R * 2, special);
    }
    // 暗部：右下角淡淡地深一點（用自己顏色的深色版，不是灰黑）
    const dg = g.createLinearGradient(cx - R * 0.6, cy - R * 0.7, cx + R * 0.8, cy + R);
    dg.addColorStop(0, css(deeper, 0)); dg.addColorStop(0.55, css(deeper, 0)); dg.addColorStop(1, css(deeper, 0.32));
    g.fillStyle = dg; g.fillRect(cx - R * 1.3, cy - R * 1.3, R * 2.6, R * 2.6);
    // 透光：光從玻璃底部透上來，下半部裡面亮一團（不碰到邊，邊緣保持暗）
    const cg = g.createRadialGradient(cx + R * 0.05, cy + R * 0.58, 0, cx + R * 0.05, cy + R * 0.58, R * 0.5);
    cg.addColorStop(0, css(mixc(sat, WHITE, 0.55), 0.55)); cg.addColorStop(1, css(sat, 0));
    g.fillStyle = cg; g.fillRect(cx - R, cy, R * 2, R * 1.3);
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
    if (shape === 'heart') {
      // 愛心軟糖：貼著外緣一圈發光的粉白邊（左上最亮、右下淡一點），邊緣看起來膨膨的、很圓潤
      const pk = mixc(sat, WHITE, 0.72), pg = g.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
      pg.addColorStop(0, css(pk, 0.95)); pg.addColorStop(0.55, css(pk, 0.6)); pg.addColorStop(1, css(pk, 0.28));
      g.save();
      g.shadowColor = css(pk, 0.9); g.shadowBlur = R * 0.16;
      candyPath(g, shape, cx, cy, R * 0.9);
      g.lineWidth = R * 0.055; g.strokeStyle = pg; g.stroke();
      g.restore();
    }
    // 最外緣一圈暗邊（輪廓清楚）：右下深、左上淡
    candyPath(g, shape, cx, cy, R);
    const eg = g.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    eg.addColorStop(0, css(deeper, 0.18)); eg.addColorStop(0.5, css(deeper, 0.35)); eg.addColorStop(1, css(deeper, 0.75));
    g.lineWidth = R * 0.07; g.strokeStyle = eg; g.stroke();
    g.restore();
    if (special === 'wrap') {
      candyPath(g, shape, cx, cy, R * 0.86);
      g.save();
      g.setLineDash([0.001, R * 0.3]); g.lineCap = 'round';
      g.lineWidth = R * 0.16; g.strokeStyle = 'rgba(255,255,255,0.92)'; g.stroke();
      g.restore();
    }
  }
  function paintCandyGloss(g, kind, cx, cy, S) {
    const shape = shapeOf(kind), R = S * CANDY_R, col = kindColor(kind);
    // 左上的月牙形反光：只在果凍邊那一圈（中間挖掉到 0.8 倍），不會橫過玩具的臉
    const hl = makeCanvas(g.canvas.width, g.canvas.height), q = hl.getContext('2d');
    q.save();
    candyPath(q, shape, cx, cy, R); q.clip();
    q.translate(cx - R * 0.34, cy - R * 0.5); q.rotate(-0.62);
    const hg = q.createLinearGradient(0, -R * 0.4, 0, R * 0.32);
    hg.addColorStop(0, 'rgba(255,255,255,0.8)'); hg.addColorStop(0.5, 'rgba(255,255,255,0.32)'); hg.addColorStop(1, 'rgba(255,255,255,0)');
    q.beginPath(); q.ellipse(0, 0, R * 0.78, R * 0.4, 0, 0, Math.PI * 2); q.fillStyle = hg; q.fill();
    if (shape === 'heart') {
      // 愛心的兩個瓣各一塊順著圓弧的反光（右瓣背光、淡一點），看起來像膨起來的軟糖
      q.setTransform(1, 0, 0, 1, 0, 0);
      const H = HEART, ly = cy + (H.b + H.dy) * R;
      for (const [sx, a] of [[-1, 0.8], [1, 0.45]]) {
        q.save();
        q.translate(cx + sx * (H.a + H.r * 0.44) * R, ly - H.r * 0.44 * R); q.rotate(sx * 0.785);
        const lg2 = q.createLinearGradient(0, -R * 0.12, 0, R * 0.1);
        lg2.addColorStop(0, `rgba(255,255,255,${a})`); lg2.addColorStop(1, 'rgba(255,255,255,0)');
        q.beginPath(); q.ellipse(0, 0, R * 0.25, R * 0.11, 0, 0, Math.PI * 2); q.fillStyle = lg2; q.fill();
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
    rl.addColorStop(0, css(lc, 0)); rl.addColorStop(0.7, css(lc, 0)); rl.addColorStop(1, css(lc, 0.45));
    g.lineWidth = R * 0.06; g.strokeStyle = rl; g.stroke();
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
  function paintWrapEnds(g, cx, cy, S, col) {
    const T = S * TILE;
    const light = mixc(col, WHITE, 0.35), dark = css(mixc(saturate(col, 0.4), BLACK, 0.38));
    g.lineJoin = 'round';
    for (const s of [-1, 1]) {
      const x0 = cx + s * T * 0.4, x1 = cx + s * T * 0.76;
      g.beginPath();
      g.moveTo(x0, cy - T * 0.1);
      g.quadraticCurveTo(lerp(x0, x1, 0.55), cy - T * 0.14, x1, cy - T * 0.36);
      g.quadraticCurveTo(x1 - s * T * 0.1, cy, x1, cy + T * 0.36);
      g.quadraticCurveTo(lerp(x0, x1, 0.55), cy + T * 0.14, x0, cy + T * 0.1);
      g.closePath();
      const gr = g.createLinearGradient(0, cy - T * 0.34, 0, cy + T * 0.34);
      gr.addColorStop(0, css(mixc(light, WHITE, 0.4))); gr.addColorStop(0.5, css(light)); gr.addColorStop(1, css(saturate(col, 0.3)));
      g.fillStyle = gr; g.fill();
      g.lineWidth = S * 0.03; g.strokeStyle = dark; g.stroke();
      // 皺褶
      g.lineWidth = S * 0.018; g.strokeStyle = 'rgba(255,255,255,0.8)';
      for (const k of [-0.2, 0, 0.2]) {
        g.beginPath(); g.moveTo(lerp(x0, x1, 0.25), cy + k * T * 0.2); g.lineTo(lerp(x0, x1, 0.9), cy + k * T * 1.15); g.stroke();
      }
      // 結
      rr(g, cx + s * T * 0.46 - T * 0.05, cy - T * 0.13, T * 0.1, T * 0.26, T * 0.04);
      g.fillStyle = css(saturate(mixc(col, BLACK, 0.08), 0.5)); g.fill();
      g.lineWidth = S * 0.025; g.strokeStyle = dark; g.stroke();
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
  function buildTile(kind, special, S) {
    const P = Math.ceil(S * PAD), cx = P / 2, cy = P / 2, col = kindColor(kind);
    const base = makeCanvas(P, P), bg = base.getContext('2d');
    if (special === 'wrap') paintWrapEnds(bg, cx, cy, S, col);
    paintCandy(bg, kind, cx, cy, S, col, special);
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
    paintSprite(fg, kind, tx, ty, L.box);
    if (special === 'h' || special === 'v') {
      const R = S * CANDY_R;
      paintToyStripes(fg, kind, tx, ty, L.box, cx - R, cy - R, R * 2, special);
    }
    // 玻璃反光蓋在玩具上面；選取時（轉圈 / 彈跳）也要蓋，所以合併進 top
    const gloss = makeCanvas(P, P);
    paintCandyGloss(gloss.getContext('2d'), kind, cx, cy, S);
    if (top) top.getContext('2d').drawImage(gloss, 0, 0);
    else top = gloss;
    fg.drawImage(top, 0, 0);
    return { full, base, top, P };
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
  // 彩色炸彈：會轉的七彩漩渦球 + 金色寶石框 + 玻璃反光，上面是扇形的三寶；外面一圈金光（drawBomb 裡一明一暗）
  function buildBomb(S) {
    const P = Math.ceil(S * PAD), cx = P / 2, cy = P / 2, R = S * 0.39;
    const under = makeCanvas(P, P), ug = under.getContext('2d');
    ug.save();
    ug.shadowColor = 'rgba(36,8,64,0.55)'; ug.shadowBlur = S * 0.08; ug.shadowOffsetX = S * 0.03; ug.shadowOffsetY = S * 0.06;
    ug.beginPath(); ug.arc(cx, cy, R * 1.13, 0, Math.PI * 2); ug.fillStyle = '#8a5410'; ug.fill();
    ug.restore();
    // 七彩漩渦（整張會轉）：彩虹扇形 + 白色的漩渦臂 + 中間亮、邊緣暗（球的體積）
    const orb = makeCanvas(P, P), og = orb.getContext('2d');
    const n = 36;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1.08) / n) * Math.PI * 2;
      og.beginPath(); og.moveTo(cx, cy); og.arc(cx, cy, R, a0, a1); og.closePath();
      og.fillStyle = `hsl(${(i / n) * 360},96%,62%)`; og.fill();
    }
    og.save();
    og.beginPath(); og.arc(cx, cy, R, 0, Math.PI * 2); og.clip();
    og.lineCap = 'round';
    for (let k = 0; k < 6; k++) {
      const a0 = (k / 6) * Math.PI * 2;
      og.beginPath();
      for (let j = 0; j <= 20; j++) {
        const f = j / 20, r = R * f * 1.05, a = a0 + f * 2.2;
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        if (j) og.lineTo(x, y); else og.moveTo(x, y);
      }
      og.lineWidth = R * 0.16; og.strokeStyle = 'rgba(255,255,255,0.22)'; og.stroke();
      og.lineWidth = R * 0.05; og.strokeStyle = 'rgba(255,255,255,0.4)'; og.stroke();
    }
    og.restore();
    const rg = og.createRadialGradient(cx, cy, 0, cx, cy, R);
    rg.addColorStop(0, 'rgba(255,255,255,0.75)'); rg.addColorStop(0.35, 'rgba(255,255,255,0.18)'); rg.addColorStop(0.72, 'rgba(255,255,255,0)');
    rg.addColorStop(1, 'rgba(70,20,120,0.3)');
    og.beginPath(); og.arc(cx, cy, R, 0, Math.PI * 2); og.fillStyle = rg; og.fill();
    // 不轉的部分：金色寶石框（左上亮、右下深）、內側亮線、左上月牙反光和亮點
    const top = makeCanvas(P, P), tg = top.getContext('2d');
    tg.beginPath(); tg.arc(cx, cy, R * 1.13, 0, Math.PI * 2); tg.arc(cx, cy, R * 0.97, 0, Math.PI * 2, true);
    const gg = tg.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    gg.addColorStop(0, '#fff6c2'); gg.addColorStop(0.3, '#ffd84a'); gg.addColorStop(0.65, '#f0a81c'); gg.addColorStop(1, '#a8640a');
    tg.fillStyle = gg; tg.fill('evenodd');
    tg.beginPath(); tg.arc(cx, cy, R * 1.05, Math.PI * 0.85, Math.PI * 1.65);
    tg.lineWidth = Math.max(1, S * 0.022); tg.lineCap = 'round'; tg.strokeStyle = 'rgba(255,255,255,0.85)'; tg.stroke();
    tg.beginPath(); tg.arc(cx, cy, R * 0.97, 0, Math.PI * 2);
    tg.lineWidth = Math.max(1, S * 0.014); tg.strokeStyle = 'rgba(120,60,10,0.6)'; tg.stroke();
    tg.beginPath(); tg.arc(cx, cy, R * 1.13, 0, Math.PI * 2);
    tg.lineWidth = Math.max(1, S * 0.016); tg.strokeStyle = 'rgba(100,50,10,0.75)'; tg.stroke();
    tg.save();
    tg.beginPath(); tg.arc(cx, cy, R * 0.97, 0, Math.PI * 2); tg.clip();
    tg.translate(cx - R * 0.36, cy - R * 0.5); tg.rotate(-0.62);
    const gl = tg.createLinearGradient(0, -R * 0.36, 0, R * 0.26);
    gl.addColorStop(0, 'rgba(255,255,255,0.75)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
    tg.beginPath(); tg.ellipse(0, 0, R * 0.66, R * 0.3, 0, 0, Math.PI * 2); tg.fillStyle = gl; tg.fill();
    tg.restore();
    tg.beginPath(); tg.arc(cx - R * 0.78, cy - R * 0.62, R * 0.08, 0, Math.PI * 2); tg.fillStyle = 'rgba(255,255,255,0.95)'; tg.fill();
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
  function getJelly(level) {
    if (jellyCache[level]) return jellyCache[level];
    // 果凍：整格大小，方塊之間的縫會露出一片粉紅色；兩層更深
    const S = Math.max(4, Math.round(cs * dpr)), c = makeCanvas(S, S), g = c.getContext('2d');
    const i = S * 0.012, w = S - 2 * i, rad = S * 0.18;
    const base = level >= 2 ? [214, 48, 140] : [255, 124, 192];
    const gr = g.createLinearGradient(0, i, 0, i + w);
    gr.addColorStop(0, css(mixc(base, WHITE, 0.4), level >= 2 ? 0.95 : 0.85));
    gr.addColorStop(1, css(base, level >= 2 ? 0.95 : 0.8));
    rr(g, i, i, w, w, rad); g.fillStyle = gr; g.fill();
    g.lineWidth = S * 0.05; g.strokeStyle = css(mixc(base, WHITE, 0.6), 0.95); g.stroke();
    rr(g, i + w * 0.08, i + w * 0.05, w * 0.84, w * 0.22, w * 0.11);
    g.fillStyle = 'rgba(255,255,255,0.45)'; g.fill();
    for (const [bx, by, br] of [[0.1, 0.88, 0.04], [0.9, 0.86, 0.03], [0.5, 0.95, 0.025]]) {
      g.beginPath(); g.arc(i + w * bx, i + w * by, w * br, 0, Math.PI * 2);
      g.fillStyle = 'rgba(255,255,255,0.7)'; g.fill();
    }
    jellyCache[level] = c;
    return c;
  }
  // 果凍外框：畫在方塊上面一圈發亮的粉紅邊，方塊蓋住果凍時也看得出哪幾格還有果凍（兩層 = 深桃紅雙框）
  function getJellyRim(level) {
    if (rimCache[level]) return rimCache[level];
    const S = Math.max(4, Math.round(cs * dpr)), c = makeCanvas(S, S), g = c.getContext('2d');
    const two = level >= 2, inset = S * 0.05, w = S - 2 * inset, rad = S * 0.22;
    const col = two ? [214, 40, 140] : [255, 92, 176];
    g.save();
    g.shadowColor = css(col, 0.9); g.shadowBlur = S * 0.07;
    rr(g, inset, inset, w, w, rad);
    g.lineWidth = S * (two ? 0.085 : 0.07); g.strokeStyle = css(col, 0.95); g.stroke();
    g.restore();
    rr(g, inset, inset, w, w, rad);
    g.lineWidth = S * 0.022; g.strokeStyle = 'rgba(255,255,255,0.75)'; g.stroke();
    if (two) {
      const i2 = S * 0.12;
      rr(g, i2, i2, S - 2 * i2, S - 2 * i2, rad * 0.75);
      g.lineWidth = S * 0.03; g.strokeStyle = css(col, 0.85); g.stroke();
    }
    // 左上角的小亮點
    g.beginPath(); g.arc(inset + rad * 0.55, inset + rad * 0.55, S * 0.028, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,255,255,0.95)'; g.fill();
    rimCache[level] = c;
    return c;
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
  function buildBg() {
    bgCache = null; clipPath = null;
    if (!rows || !cols || !W) return;
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
    // 整個盤子壓在背景上的投影（暖暖的深玫瑰色，不是灰黑）
    g.save();
    g.shadowColor = 'rgba(96,40,62,0.3)'; g.shadowBlur = S * 0.16; g.shadowOffsetY = S * 0.08;
    g.drawImage(paint(outer, '#c98f86', thick), 0, 0);
    g.restore();
    // 盤子的厚度：下緣露出一圈焦糖玫瑰色的側面（實心色塊，只有一點點上下明暗）
    g.drawImage(paint(outer, vgrad([[0, '#ecc3b4'], [0.6, '#dba597'], [1, '#c4877d']], btm - S * 0.4, btm + thick), thick), 0, 0);
    g.save(); g.globalCompositeOperation = 'destination-out'; g.drawImage(inner, 0, 0); g.restore();
    // 外框：乾淨的奶油色實心塊面 —— 上緣一條很細的亮邊、下緣淡淡的暗（不再是發光的塑膠管）
    g.drawImage(paint(ring(outer, inner), vgrad([[0, '#fff7ec'], [0.5, '#fcecdc'], [1, '#f2d8c4']])), 0, 0);
    g.drawImage(paint(ring(outer, shape(S * (FO - 0.016), S * 0.35)), vgrad([[0, 'rgba(255,255,255,0.9)'], [0.08, 'rgba(255,255,255,0)']])), 0, 0);
    g.drawImage(paint(ring(outer, shape(S * (FO - 0.05), S * 0.32)), vgrad([[0, 'rgba(190,120,110,0)'], [0.8, 'rgba(190,120,110,0)'], [1, 'rgba(190,120,110,0.35)']])), 0, 0);
    // 內緣一圈細細的暗邊：盤面看起來是嵌進外框裡
    g.drawImage(paint(ring(shape(S * (FI + 0.022), S * 0.26), inner), 'rgba(150,96,90,0.35)'), 0, 0);
    // 盤面：安靜的深藍色半透明玻璃（像 Candy Crush 的深色凹槽），亮色的糖果放上去才會像寶石一樣跳出來；中間一點點柔光
    g.drawImage(paint(inner, vgrad([[0, 'rgba(42,48,108,0.9)'], [1, 'rgba(30,34,84,0.93)']])), 0, 0);
    const glass = makeCanvas(Wd, Hd), gq = glass.getContext('2d');
    const gx = X0 + cols * S / 2, gy = Y0 + rows * S * 0.42, gR = Math.max(cols, rows) * S * 0.6;
    const cg = gq.createRadialGradient(gx, gy, 0, gx, gy, gR);
    cg.addColorStop(0, 'rgba(150,170,255,0.12)'); cg.addColorStop(1, 'rgba(150,170,255,0)');
    gq.fillStyle = cg; gq.fillRect(0, 0, Wd, Hd);
    gq.globalCompositeOperation = 'destination-in'; gq.drawImage(inner, 0, 0);
    g.drawImage(glass, 0, 0);
    // 格子：一格一格淺淺的圓角凹槽，深色上面再深一點 / 亮一點的棋盤格；沒有框線、也沒有星光（不要在縫裡搶戲）。
    // 光從左上來：左上的內壁有影子、右下的內壁受一點光；糖果往右下的落影就落在槽底
    const cells = makeCanvas(Wd, Hd), q = cells.getContext('2d');
    const gap = S * 0.03, crad = S * 0.17, cw = S - gap * 2, big = S * 0.4;
    for (let r = 0; r < rows; r++) for (let c2 = 0; c2 < cols; c2++) {
      if (!mask[r][c2]) continue;
      const x = X0 + c2 * S + gap, y = Y0 + r * S + gap;
      rr(q, x, y, cw, cw, crad);
      q.fillStyle = (r + c2) % 2 ? 'rgba(255,255,255,0.06)' : 'rgba(150,160,255,0.035)';
      q.fill();
      // 內壁：比槽大一圈、中間挖空的框，往右下 / 左上投影 —— 框本身在槽外面被裁掉，只有影子落進槽裡
      q.save();
      rr(q, x, y, cw, cw, crad); q.clip();
      q.beginPath(); q.rect(x - big, y - big, cw + big * 2, cw + big * 2); rrSub(q, x, y, cw, cw, crad);
      q.fillStyle = '#000';
      q.shadowColor = 'rgba(6,8,36,0.6)'; q.shadowBlur = S * 0.07; q.shadowOffsetX = S * 0.026; q.shadowOffsetY = S * 0.04;
      q.fill('evenodd');
      q.shadowColor = 'rgba(190,200,255,0.14)'; q.shadowBlur = S * 0.05; q.shadowOffsetX = -S * 0.018; q.shadowOffsetY = -S * 0.026;
      q.fill('evenodd');
      q.restore();
    }
    // 外框投在盤面上緣的影子：盤面像凹進盤子裡
    q.drawImage(paint(ring(inner, shape(S * 0.06, S * 0.24, S * 0.12)), 'rgba(8,6,36,0.22)'), 0, 0);
    q.drawImage(paint(ring(inner, shape(S * 0.06, S * 0.24, S * 0.05)), 'rgba(8,6,36,0.22)'), 0, 0);
    q.globalCompositeOperation = 'destination-in';
    q.drawImage(inner, 0, 0);
    q.globalCompositeOperation = 'source-over';
    g.drawImage(cells, 0, 0);
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
    return { id: p.id, kind: p.kind, special: p.special || 'none', r, c, mv: null,
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
  function syncBoard(grid, jel) {
    if (!Array.isArray(grid) || !grid.length) return;
    const R = grid.length, C = (grid[0] || []).length;
    if (R !== rows || C !== cols) {
      rows = R; cols = C; mask = make2D(R, C, true); jelly = make2D(R, C, 0); geom();
    }
    const nv = new Map();
    cellMap = make2D(rows, cols, null);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const p = grid[r] && grid[r][c];
      if (!p) continue;
      let v = visuals.get(p.id);
      if (!v || nv.has(p.id)) v = newVisual(p, r, c);
      if (!mvEndsAt(v.mv, r, c)) v.mv = null;
      if (v.morph && (v.kind !== p.kind || v.special !== (p.special || 'none'))) v.morph = null;
      v.kind = p.kind; v.special = p.special || 'none'; v.r = r; v.c = c;
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
    sched = []; ghosts = []; fx = []; parts = []; texts = []; word = null; shakes = []; surpriseUsed = false;
    jellyFx.clear(); selected = null; hintPair = null; dragState = null;
    if (!snap || !snap.grid) { rows = 0; cols = 0; visuals = new Map(); cellMap = []; bgCache = null; requestDraw(); return; }
    const R = snap.rows || snap.grid.length, C = snap.cols || (snap.grid[0] || []).length;
    rows = R; cols = C;
    mask = readMask(snap.mask, R, C);
    jelly = readJelly(snap.jelly, R, C);
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
  function burst(x, y, col, n, t, { speed = 3.4, stars = 2, up = 0.8 } = {}) {
    const fl = getFluff(col), sc = getStarCol(col);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = speed * (0.45 + Math.random() * 0.75);
      emit({ type: 0, img: fl, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - up, g: 7, drag: 2.4, t0: t,
        life: 380 + Math.random() * 260, size: 0.14 + Math.random() * 0.14 });
    }
    for (let i = 0; i < stars; i++) {
      const a = Math.random() * Math.PI * 2, v = speed * (0.35 + Math.random() * 0.6);
      emit({ type: 1, img: sc, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - up * 0.6, g: 2.5, drag: 2.8, t0: t,
        life: 420 + Math.random() * 280, size: 0.3 + Math.random() * 0.2 });
    }
  }
  function sparkle(x, y, n, t, spread = 0.5) {
    const st = getStar();
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
    await wait((n - 1) * stagger + 220);
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
    }
    return -1;
  }

  async function animClear(ev) {
    const t0 = now();
    const removed = (ev.removed || []).filter(Boolean), effects = (ev.effects || []).filter(Boolean);
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
    for (const it of removed) {
      const k = key(it.r, it.c);
      let tm = it.cause === 'match' ? (matchT.get(k) || 0) : Infinity;
      for (const x of E) {
        const tr = travel(x.e, it.r, it.c);
        if (tr >= 0) tm = Math.min(tm, x.start + tr);
      }
      remT.set(k, tm === Infinity ? 0 : tm);
    }
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
      ghosts.push({ kind: p.kind, special: p.special || 'none', x: gx, y: gy, t0: t0 + tm,
        dur: m ? MERGE_MS : POP_MS, to: m ? { x: m.c, y: m.r } : null, fired: false, heavy, phase });
      lastPop = Math.max(lastPop, tm);
    }

    // --- 特效 ---
    for (const x of E) {
      const st = x.start * f, at0 = t0 + st, e = x.e;
      const src = x.board ? null : remAt.get(key(x.r, x.c));
      const sk = src && src.piece ? src.piece.kind : -1;
      const col = sk >= 0 ? kindColor(sk) : [255, 226, 140];
      if (e.fx === 'line') {
        const h = e.dir !== 'v';
        fx.push({ type: 'beam', dir: h ? 'h' : 'v', r: e.r, c: e.c, t0: at0, dur: 420, col,
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
      } else if (e.fx === 'board') {
        fx.push({ type: 'boardfx', t0: at0, dur: 800 });
        shake(9, 560, at0);
        cue('board', st);
      }
    }
    if (removed.some(r => r.cause === 'combo')) cue('combo', 0);

    // --- 消除音效：每一顆碎開的那一刻「咔啦」一聲（殘影放大變白之後才碎：POP_MS 的 30%），音一顆比一顆高 ---
    groups.forEach((g, i) => {
      seqCells(g).forEach((q, j) => {
        const tm = (remT.has(key(q.r, q.c)) ? tOf(q.r, q.c) : (i * GROUP_STAGGER + j * POP_SEQ) * f) + POP_MS * 0.3;
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
    }

    // --- 果凍 ---
    for (const jh of ev.jellyHits || []) {
      if (!jh) continue;
      at(t0 + tOf(jh.r, jh.c), tt => {
        if (!jelly[jh.r]) return;
        const from = jelly[jh.r][jh.c] || 0, left = Math.min(from, jh.left | 0);
        jelly[jh.r][jh.c] = left;
        if (left < from) jellyFx.set(key(jh.r, jh.c), { t0: tt, from });
        burst(jh.c + 0.5, jh.r + 0.5, [255, 120, 190], 5, tt, { speed: 2.6, stars: 0, up: 1.4 });
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
    if (cascade >= 4 && !surpriseUsed && SLOGANS.surprise.length && Math.random() < 0.4) {
      surpriseUsed = true;
      const sl = SLOGANS.surprise[Math.floor(Math.random() * SLOGANS.surprise.length)];
      showWord(sl.text, 5, sl);
    } else if (cascade >= 2) {
      const sl = cascadeSlogan(cascade);
      if (sl) showWord(sl.text, cascade, sl);
    } else if (isCombo) {
      showWord(SLOGANS.combo.text, 4, SLOGANS.combo);
    }
    if (cascade >= 2) cue('chime', 40, { level: cascade + 1 });   // 每次跳口號都叮咚一下
    if (cascade >= 4) shake(1.8 + 0.4 * Math.min(4, cascade - 4), 220, t0 + 40);
    // 最後一顆開始爆之後一下下就讓上面的方塊開始掉（爆的動畫在背景收尾）
    await wait(t0 + lastPop + POP_LEAD - now());
  }

  // 掉落中的方塊：位置、速度
  function fallState(m, t) {
    const dt = t - m.t0;
    if (dt <= 0) return { y: m.y0, vel: 0, done: false };
    if (dt >= m.dur) return { y: m.y1, vel: 0, done: true };
    return { y: m.y0 + m.v0 * dt + 0.5 * G_FALL * dt * dt, vel: m.v0 + G_FALL * dt, done: false };
  }
  function fallDur(dist, v0) { return dist <= 0 ? 1 : (-v0 + Math.sqrt(v0 * v0 + 2 * G_FALL * dist)) / G_FALL; }
  function topCell(c) { for (let r = 0; r < rows; r++) if (mask[r] && mask[r][c]) return r; return 0; }

  async function animFall(ev, next) {
    const t = now();
    const seq = ++fallSeq;
    const items = [];
    for (const m of ev.moves || []) {
      if (!m || !m.from || !m.to) continue;
      const v = visuals.get(m.id) || cellV(m.from);
      if (v) items.push({ v, to: m.to, spawn: -1 });
    }
    for (const s of ev.spawns || []) {
      if (!s || !s.piece || !s.to) continue;
      const v = newVisual(s.piece, s.to.r, s.to.c);
      visuals.set(s.piece.id, v);
      const j = s.from && s.from.r < 0 ? -1 - s.from.r : 0;
      items.push({ v, to: s.to, spawn: j });
    }
    // 同一欄由下往上，每顆晚一點點出發；每欄再有一點點不同（看起來比較自然）
    const byCol = new Map();
    for (const it of items) {
      let l = byCol.get(it.to.c);
      if (!l) byCol.set(it.to.c, l = []);
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
        let y0, vel, delay;
        const m = v.mv;
        if (it.spawn >= 0) { y0 = top - 1 - it.spawn; vel = V0_FALL; delay = jit + Math.min(STAGGER_MAX, k * STAGGER_ROW); }
        else if (m && m.fall && t < m.t0 + m.dur) {
          // 還在掉：接著目前的位置和速度繼續
          const fs = fallState(m, t);
          y0 = fs.y; vel = Math.max(V0_FALL, fs.vel); delay = t < m.t0 ? m.t0 - t : 0;
        } else {
          const cur = evalVisual(v, t);
          y0 = cur.y; vel = V0_FALL; delay = jit + Math.min(STAGGER_MAX, k * STAGGER_ROW);
        }
        const dist = it.to.r - y0;
        if (dist <= 0.001) { v.mv = null; return; }
        const dur = fallDur(dist, vel);
        v.mv = { fall: true, x0: it.to.c, y0, x1: it.to.c, y1: it.to.r, t0: t + delay, dur, v0: vel, clip: true };
        v.landT = t + delay + dur;
        v.landAmp = clamp((vel + G_FALL * dur) * 2.4, 0.07, 0.2);
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
      if (cells.length) end = Math.min(endAll, endInv + LAND_HOLD);
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

  function animateEvent(ev, next) {
    switch (ev && ev.t) {
      case 'swap': return animSwap(ev, false, next);
      case 'swapBack': return animSwap(ev, true, next);
      case 'transform': return animTransform(ev);
      case 'clear': return animClear(ev, next);
      case 'fall': return animFall(ev, next);
      case 'shuffle': return animShuffle(ev);
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
      try { if (ev && ev.board) syncBoard(ev.board, ev.jelly); } catch (e) { console.error('[renderer] sync', e); }
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
  // ext：立體厚度的顏色（跟 HUD 的字一樣）：最外圈的描邊往右下複製幾層，像糖果字被擠出來的側面（光從左上來）
  function textSprite(text, size, fill, outline, outer, shadow, ext) {
    const k = dpr, sc = scratchCtx();
    sc.font = `900 ${Math.max(6, size * k)}px ${FONT}`;
    const mw = sc.measureText(text).width / k;
    const depth = ext ? size * 0.09 : 0;
    const pad = size * (outer ? 0.36 : 0.28) + (shadow ? size * 0.22 : 0) + depth;
    const w = mw + pad * 2, h = size * 1.25 + pad * 2;
    const c = makeCanvas(w * k, h * k), g = c.getContext('2d');
    g.scale(k, k);
    g.font = `900 ${Math.max(6, size)}px ${FONT}`;
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    const x = w / 2, y = h / 2;
    const fs = typeof fill === 'function' ? fill(g, size) : fill;
    const ow = size * (outer ? 0.34 : 0.22);    // 最外圈描邊的粗細
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
        g.strokeText(text, x + d * 0.6, y + d); g.fillText(text, x + d * 0.6, y + d);
      }
    }
    if (outer) { g.lineWidth = ow; g.strokeStyle = outer; g.strokeText(text, x, y); }
    g.lineWidth = size * (outer ? 0.17 : 0.22); g.strokeStyle = outline; g.strokeText(text, x, y);
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
  function showWord(text, level, sl) {
    if (!text) return;
    word = { text, level, t0: now(), dur: 1150, sp: null, size: 0, pic: sloganPic(sl), tilt: (Math.random() - 0.5) * 0.5 };
    if (sl && sl.voice) cue('voice', 60, { id: sl.voice });
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
        x = m.x1; y = fs.y;
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
        const k = Math.exp(-4.6 * p) * Math.cos(p * Math.PI * 2.5);
        sy *= 1 - v.landAmp * k; sx *= 1 + v.landAmp * 0.7 * k;
      }
    }
    if (t >= v.popT) { const p = (t - v.popT) / POPIN_MS; if (p < 1) s *= popCurve(p); }
    if (v.special === 'wrap') s *= 1 + 0.045 * Math.sin(t / 230 + v.phase);
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

  function drawBomb(cx, cy, s, t, phase, spinRate = 1) {
    const e = getTile(-1, 'bomb'), P = e.P / dpr * s;
    {
      // 外圈的金光一明一暗（和條紋糖果的箭頭同一套）
      const k = 0.5 + 0.5 * Math.sin(t / 300 + phase), z = cs * (1.25 + 0.1 * k) * s, ga = ctx.globalAlpha;
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = ga * (0.32 + 0.3 * k);
      ctx.drawImage(getGlowCol(GOLD), cx - z / 2, cy - z / 2, z, z);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = ga;
    }
    ctx.drawImage(e.under, cx - P / 2, cy - P / 2, P, P);
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate((t / 650) * spinRate + phase);
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
    ctx.drawImage(e.full, cx - w / 2, cy - h / 2 + dy, w, h);
    if (special === 'h' || special === 'v') {
      // 金色箭頭的光一明一暗（待機動畫）
      const k = 0.5 + 0.5 * Math.sin(t / 260 + phase), gl = getGlowCol(GOLD), z = cs * 0.5 * s, off = cs * 0.38 * s;
      const ga = ctx.globalAlpha;
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = ga * (0.12 + 0.3 * k);
      for (const d of [-1, 1]) {
        const x = cx + (special === 'h' ? d * off : 0), y = cy + dy + (special === 'v' ? d * off : 0);
        ctx.drawImage(gl, x - z / 2, y - z / 2, z, z);
      }
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = ga;
    }
    if (white > 0.01) {
      const ga = ctx.globalAlpha;
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
    if (v.special === 'bomb' || v.kind < 0) { drawBomb(cx, cy, s, t, v.phase, 3); return; }
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
      ctx.drawImage(vivid(spin), (i % 6) * fw, Math.floor(i / 6) * fh, fw, fh, tx - sb / 2, ty - sb / 2, sb, sb);
      if (e.top) ctx.drawImage(e.top, cx - P / 2, cy - P / 2, P, P);
    } else if (usable(sprite)) {
      // 沒有旋轉序列（照片方塊）：原地彈跳，落地壓扁、跳起拉長（彈跳豬特別彈）
      ctx.drawImage(e.base, cx - P / 2, cy - P / 2, P, P);
      const sc = vivid(scaled(sprite, Math.round(L.box * 1.12)));
      const amp = info.id === 'moodeng' ? 1.45 : 1;
      const ph = (age % 560) / 560, hop = Math.sin(ph * Math.PI);
      const land = Math.exp(-Math.min(ph, 1 - ph) * 14);         // 碰到地面附近 → 1
      const sx = 1 + 0.16 * amp * land - 0.05 * hop, sy = 1 - 0.15 * amp * land + 0.07 * hop;
      ctx.save();
      ctx.translate(tx, ty + box / 2 - hop * cs * 0.13 * amp);
      ctx.scale(sx, sy);
      ctx.drawImage(sc, -box / 2, -box, box, box);
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
      else if (v.special === 'wrap') late.push([v, st]);   // 糖果紙兩端要蓋在鄰居上面
      else still.push([v, st]);
    }
    // 由上往下、由左往右畫：糖果往右下的落影只會落在盤面上，不會蓋到鄰居
    const byPos = (a, b) => a[1].y - b[1].y || a[1].x - b[1].x;
    still.sort(byPos); late.sort(byPos);
    for (const [v, st] of still) drawVisual(v, st, t);
    for (const [v, st] of late) drawVisual(v, st, t);
    drawJellyRims(t);
    if (falling.length) {
      // 同一欄掉落中的方塊不重疊（後面掉得比較快的會「頂」在前面那顆上面）
      for (let c = 0; c < cols; c++) fallCols[c] = null;
      for (const it of falling) {
        const m = it[0].mv;
        if (!m || !m.fall) continue;
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
    if (selSt) drawSelected(sel, selSt, t);
  }

  function drawGhosts(t) {
    let w = 0;
    for (const g of ghosts) {
      const p = (t - g.t0) / g.dur;
      if (p >= 1) continue;
      ghosts[w++] = g;
      const cx0 = ox + (g.x + 0.5) * cs, cy0 = oy + (g.y + 0.5) * cs;
      if (p < 0) { drawPieceAt(g.kind, g.special, cx0, cy0, 1, 1, 1, t, g.phase); continue; }
      if (!g.fired) {
        g.fired = true;
        const col = g.kind >= 0 ? kindColor(g.kind) : kindColor(Math.floor(Math.random() * Math.max(1, pieces.length)));
        if (g.to) sparkle(g.x + 0.5, g.y + 0.5, 1, g.t0, 0.2);
        else {
          g.shatterAt = g.t0 + g.dur * 0.3;
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
        const q = 0.3;
        if (p < q) { const u = easeOutCubic(p / q); s = 1 + 0.2 * u; wh = 0.8 * u; }
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
        const lo = h ? ox - cs * 0.2 : oy - cs * 0.2, hi = h ? ox + cols * cs + cs * 0.2 : oy + rows * cs + cs * 0.2;
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
      ctx.globalCompositeOperation = 'lighter';
      for (const p of parts) {
        if (p.type === 0 || p.type === 3) continue;
        const age = (t - p.t0) / p.life;
        if (age < 0 || age >= 1) continue;
        const s = (t - p.t0) / 1000, k = p.drag, fd = k ? (1 - Math.exp(-k * s)) / k : s;
        const x = ox + (p.x + p.vx * fd) * cs, y = oy + (p.y + p.vy * fd + 0.5 * p.g * s * s) * cs;
        const z = p.size * cs * (0.6 + 0.4 * Math.sin(age * Math.PI));
        ctx.globalAlpha = age < 0.6 ? 1 : 1 - (age - 0.6) / 0.4;
        ctx.drawImage(p.img, x - z / 2, y - z / 2, z, z);
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
      drawPieces(t);
      drawGhosts(t);
      drawFx(t);
      drawParticles(t);
      drawTexts(t);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawWord(t);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBanners(t);
  }

  // ================= 主迴圈 =================
  function moving(t) {
    if (sched.length || ghosts.length || fx.length || parts.length || texts.length || word || banners.length || shakes.length || dragState || jellyFx.size) return true;
    for (const v of visuals.values()) {
      const m = v.mv;
      if (m && t < m.t0 + m.dur + 20) return true;
      if (t - v.landT < LAND_MS + 20 || t - v.popT < POPIN_MS + 20) return true;
      if ((v.morph && t < v.morph.until + 20) || (v.hideUntil && t < v.hideUntil + 20)) return true;
    }
    return false;
  }
  function ambient() {
    if (selected || hintPair) return true;
    for (const v of visuals.values()) if (v.special !== 'none' || v.kind < 0) return true;
    return false;
  }
  // 每幀最多畫一次：畫的途中有人呼叫 requestDraw()（加飄分、排程…）不會再多掛一個 rAF
  function frame() {
    raf = 0;
    if (destroyed || paused) return;
    const t = now();
    inFrame = true;
    let act = false, amb = false;
    try {
      act = moving(t);
      amb = !act && ambient();
      if (!(amb && t - lastDraw < 31)) { lastDraw = t; draw(t); }   // 只有待機動畫：約 30fps
    } catch (e) {
      console.error('[renderer] draw', e);
    } finally {
      inFrame = false;
    }
    if (!raf && !destroyed && !paused && (act || amb || busyCount > 0 || moving(now()))) raf = requestAnimationFrame(frame);
  }
  function requestDraw() {
    if (!raf && !inFrame && !destroyed && !paused && typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(frame);
  }
  // 畫面藏起來時停掉迴圈；play() 的等待用 setTimeout，所以動畫流程照樣會走完（只是不畫）
  function pause() {
    if (destroyed || paused) return;
    paused = true;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
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
    clearTimeout(warmTimer); warmQ = [];
    if (ro) ro.disconnect();
    window.removeEventListener('resize', onResize);
    for (const b of banners) { clearTimeout(b.timer); b.res(); }
    banners = []; ghosts = []; fx = []; parts = []; texts = []; sched = [];
    tileCache.clear(); fanCache.clear(); fluffCache.clear(); starColCache.clear(); glowColCache.clear(); beamCache.clear();
  }

  const R = {
    setBoard, layout, cellAt, select, drag, hint, play, banner, destroy, pause, resume,
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
