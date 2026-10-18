// 毛絨消消樂：Canvas 2D 盤面渲染、動畫、粒子、橫幅（docs/SPEC.md §6）
// 所有位置都用「格」做單位（r、c 可以是小數），畫的時候才換成像素，所以 layout() 隨時可以呼叫。
// 每個引擎事件播完後都會用事件附帶的 board 重新同步，畫面永遠不會和引擎不一致。

const FONT = '"Baloo 2", "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", system-ui, sans-serif';
const WORDS = ['', '', '好棒！', '太甜了！', '超可愛！', '毛茸茸爆發！'];
const MAX_DPR = 2.5;      // 手機上限，兼顧清晰和效能
const MARGIN = 0.3;       // 盤面四周保留（格）
const PAD = 1.42;         // 方塊快取畫布邊長 / 格（留給陰影、糖果紙兩端）
const TILE = 0.88;        // 圓角方塊邊長 / 格
const SPR = 0.95;         // 貼紙圖框 / 格（貼紙本身約占 84%）
const SPR_WRAP = 0.8;
const MAX_PARTS = 520;
const G_FALL = 0.000082;  // 掉落重力（格 / ms²）

const WHITE = [255, 255, 255], BLACK = [0, 0, 0], PLUM = [74, 34, 112];
const now = () => performance.now();
const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
const easeInCubic = t => t * t * t;
const easeInQuad = t => t * t;
const easeInOutCubic = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutBack = (t, s = 1.70158) => { const u = t - 1; return 1 + (s + 1) * u * u * u + s * u * u; };
const easeSwapBack = t => easeOutBack(t, 2.6);
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
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
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
  let word = null;                  // 連鎖字
  let banners = [];
  let shakes = [];
  let sched = [];                   // 定時動作 { t, fn }
  const jellyFx = new Map();        // key -> { t0, from }
  let selected = null, hintPair = null, dragState = null;
  // ---- 流程 ----
  let gen = 0, busyCount = 0, destroyed = false;
  let queue = Promise.resolve(), bannerQueue = Promise.resolve();
  const waits = new Set();
  let raf = 0, lastDraw = 0;
  // ---- 快取 ----
  const tileCache = new Map();
  let cacheS = 0;
  let bgCache = null, clipPath = null, jellyCache = [], rimCache = [], glowImg = null, starImg = null;
  const fluffCache = new Map();
  const spriteCache = new WeakMap();
  const watched = new WeakSet();
  const colorMemo = new Map();

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
  function paintSprite(g, kind, cx, cy, box) {
    const info = pieceInfo(kind), im = imgsFor(info.id).sprite;
    if (usable(im)) { g.drawImage(scaled(im, box), cx - Math.round(box) / 2, cy - Math.round(box) / 2); return; }
    paintFallback(g, info, cx, cy, box);
  }
  function paintStripes(g, x, y, T, dir) {
    const n = 4, band = T * 0.105, step = T / n;
    for (let i = 0; i < n; i++) {
      const o = step * (i + 0.5) - band / 2;
      if (dir === 'h') g.fillRect(x - T, y + o, T * 3, band);
      else g.fillRect(x + o, y - T, band, T * 3);
    }
  }
  function paintTileBody(g, cx, cy, S, col, special) {
    const T = S * TILE, x = cx - T / 2, y = cy - T / 2, rad = T * 0.27;
    const sat = saturate(col, 0.25);
    // 陰影
    g.save();
    g.shadowColor = 'rgba(36,8,64,0.42)'; g.shadowBlur = S * 0.07; g.shadowOffsetY = S * 0.05;
    rr(g, x, y, T, T, rad); g.fillStyle = css(mixc(sat, BLACK, 0.25)); g.fill();
    g.restore();
    // 本體漸層
    const gr = g.createLinearGradient(0, y, 0, y + T);
    gr.addColorStop(0, css(mixc(col, WHITE, 0.5)));
    gr.addColorStop(0.42, css(sat));
    gr.addColorStop(1, css(mixc(saturate(col, 0.45), BLACK, 0.16)));
    rr(g, x, y, T, T, rad); g.fillStyle = gr; g.fill();
    g.save();
    rr(g, x, y, T, T, rad); g.clip();
    if (special === 'h' || special === 'v') {
      g.fillStyle = 'rgba(255,255,255,0.82)';
      paintStripes(g, x, y, T, special);
    }
    // 底部內陰影，讓方塊像軟軟的果凍
    const sh = g.createLinearGradient(0, y + T * 0.6, 0, y + T);
    sh.addColorStop(0, 'rgba(60,10,90,0)'); sh.addColorStop(1, 'rgba(60,10,90,0.18)');
    g.fillStyle = sh; g.fillRect(x, y + T * 0.6, T, T * 0.4);
    // 上方亮面
    const gx = x + T * 0.12, gy = y + T * 0.06, gw = T * 0.76, gh = T * 0.4;
    const gg = g.createLinearGradient(0, gy, 0, gy + gh);
    gg.addColorStop(0, 'rgba(255,255,255,0.78)'); gg.addColorStop(1, 'rgba(255,255,255,0.03)');
    rr(g, gx, gy, gw, gh, gh * 0.5); g.fillStyle = gg; g.fill();
    g.restore();
    // 外框
    rr(g, x, y, T, T, rad);
    g.lineWidth = Math.max(1, S * 0.03); g.strokeStyle = css(mixc(saturate(col, 0.4), BLACK, 0.34), 0.9); g.stroke();
    rr(g, x + S * 0.035, y + S * 0.035, T - S * 0.07, T - S * 0.07, rad * 0.8);
    g.lineWidth = Math.max(1, S * 0.018); g.strokeStyle = 'rgba(255,255,255,0.5)'; g.stroke();
    if (special === 'wrap') {
      // 糖果紙：一圈白點點
      rr(g, x + T * 0.09, y + T * 0.09, T * 0.82, T * 0.82, rad * 0.7);
      g.save();
      g.setLineDash([0.001, T * 0.135]); g.lineCap = 'round';
      g.lineWidth = T * 0.075; g.strokeStyle = 'rgba(255,255,255,0.92)'; g.stroke();
      g.restore();
    }
    // 小亮點
    g.beginPath(); g.arc(x + T * 0.2, y + T * 0.19, T * 0.045, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,255,255,0.95)'; g.fill();
  }
  function paintArrows(g, cx, cy, S, dir, col) {
    const T = S * TILE, a = T * 0.17, off = T * 0.5 + a * 0.3;
    const dark = css(mixc(saturate(col, 0.4), BLACK, 0.5));
    const pts = dir === 'h' ? [[-1, 0], [1, 0]] : [[0, -1], [0, 1]];
    g.lineJoin = 'round';
    for (const [dx, dy] of pts) {
      const tx = cx + dx * off, ty = cy + dy * off, bx = tx - dx * a, by = ty - dy * a, px = -dy, py = dx;
      g.beginPath();
      g.moveTo(tx, ty);
      g.lineTo(bx + px * a * 0.85, by + py * a * 0.85);
      g.lineTo(bx - px * a * 0.85, by - py * a * 0.85);
      g.closePath();
      g.lineWidth = S * 0.045; g.strokeStyle = dark; g.stroke();
      g.fillStyle = '#fff'; g.fill();
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
    paintTileBody(bg, cx, cy, S, col, special);
    let top = null;
    if (special === 'h' || special === 'v' || special === 'wrap') {
      top = makeCanvas(P, P);
      const tg = top.getContext('2d');
      if (special === 'wrap') paintCellophane(tg, cx, cy, S);
      else paintArrows(tg, cx, cy, S, special, col);
    }
    const full = makeCanvas(P, P), fg = full.getContext('2d');
    fg.drawImage(base, 0, 0);
    const box = Math.round(S * (special === 'wrap' ? SPR_WRAP : SPR));
    if (special === 'h' || special === 'v') {
      // 玩具本身也印上條紋
      const tmp = makeCanvas(box, box), tg = tmp.getContext('2d');
      paintSprite(tg, kind, box / 2, box / 2, box);
      tg.globalCompositeOperation = 'source-atop';
      tg.fillStyle = 'rgba(255,255,255,0.3)';
      const T = S * TILE;
      tg.translate(box / 2 - cx, box / 2 - cy);
      paintStripes(tg, cx - T / 2, cy - T / 2, T, special);
      fg.drawImage(tmp, Math.round(cx - box / 2), Math.round(cy - box / 2));
    } else {
      paintSprite(fg, kind, cx, cy, box);
    }
    if (top) fg.drawImage(top, 0, 0);
    return { full, base, top, P };
  }
  function buildBomb(S) {
    const P = Math.ceil(S * PAD), cx = P / 2, cy = P / 2, R = S * 0.42;
    const under = makeCanvas(P, P), ug = under.getContext('2d');
    ug.save();
    ug.shadowColor = 'rgba(36,8,64,0.5)'; ug.shadowBlur = S * 0.08; ug.shadowOffsetY = S * 0.05;
    ug.beginPath(); ug.arc(cx, cy, R, 0, Math.PI * 2); ug.fillStyle = '#6a3aa8'; ug.fill();
    ug.restore();
    const orb = makeCanvas(P, P), og = orb.getContext('2d');
    const n = 30;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1.08) / n) * Math.PI * 2;
      og.beginPath(); og.moveTo(cx, cy); og.arc(cx, cy, R, a0, a1); og.closePath();
      og.fillStyle = `hsl(${(i / n) * 360},95%,66%)`; og.fill();
    }
    const rg = og.createRadialGradient(cx, cy, 0, cx, cy, R);
    rg.addColorStop(0, 'rgba(255,255,255,0.9)'); rg.addColorStop(0.42, 'rgba(255,255,255,0.3)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    og.beginPath(); og.arc(cx, cy, R, 0, Math.PI * 2); og.fillStyle = rg; og.fill();
    const top = makeCanvas(P, P), tg = top.getContext('2d');
    const rim = tg.createRadialGradient(cx - R * 0.25, cy - R * 0.3, R * 0.2, cx, cy, R);
    rim.addColorStop(0, 'rgba(255,255,255,0)'); rim.addColorStop(0.72, 'rgba(255,255,255,0)'); rim.addColorStop(1, 'rgba(70,20,120,0.5)');
    tg.beginPath(); tg.arc(cx, cy, R, 0, Math.PI * 2); tg.fillStyle = rim; tg.fill();
    tg.save();
    tg.translate(cx - R * 0.3, cy - R * 0.45); tg.rotate(-0.55); tg.scale(1, 0.55);
    const gl = tg.createLinearGradient(0, -R * 0.38, 0, R * 0.38);
    gl.addColorStop(0, 'rgba(255,255,255,0.9)'); gl.addColorStop(1, 'rgba(255,255,255,0.08)');
    tg.beginPath(); tg.arc(0, 0, R * 0.38, 0, Math.PI * 2); tg.fillStyle = gl; tg.fill();
    tg.restore();
    tg.beginPath(); tg.arc(cx, cy, R, 0, Math.PI * 2);
    tg.lineWidth = S * 0.035; tg.strokeStyle = 'rgba(255,255,255,0.95)'; tg.stroke();
    tg.beginPath(); tg.arc(cx, cy, R + S * 0.03, 0, Math.PI * 2);
    tg.lineWidth = S * 0.02; tg.strokeStyle = 'rgba(80,30,130,0.7)'; tg.stroke();
    // 三寶合照
    const trio = makeCanvas(P, P), pg = trio.getContext('2d');
    const im = imgsFor('trio').sprite;
    if (usable(im)) {
      const box = Math.round(S * 1.22);
      pg.drawImage(scaled(im, box), Math.round(cx - box / 2), Math.round(cy - box / 2 + S * 0.03));
    } else {
      // 沒有合照：三顆小球
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
    if (S !== cacheS) { tileCache.clear(); cacheS = S; jellyCache = []; rimCache = []; glowImg = null; }
    const key = special === 'bomb' || kind < 0 ? 'bomb' : kind + '|' + special;
    let e = tileCache.get(key);
    if (!e) {
      e = key === 'bomb' ? buildBomb(S) : buildTile(kind, special || 'none', S);
      tileCache.set(key, e);
    }
    return e;
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
    const Wd = Math.ceil(cols * S + 2 * m), Hd = Math.ceil(rows * S + 2 * m);
    const shape = (expand, radius) => {
      const t = makeCanvas(Wd, Hd), g = t.getContext('2d');
      g.fillStyle = '#fff';
      const on = (r, c) => r >= 0 && c >= 0 && r < rows && c < cols && mask[r][c];
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        if (!mask[r][c]) continue;
        const u = on(r - 1, c), d = on(r + 1, c), l = on(r, c - 1), ri = on(r, c + 1);
        rr4(g, m + c * S - expand, m + r * S - expand, S + 2 * expand, S + 2 * expand,
          !u && !l ? radius : 0, !u && !ri ? radius : 0, !d && !ri ? radius : 0, !d && !l ? radius : 0);
        g.fill();
      }
      return t;
    };
    const c = makeCanvas(Wd, Hd), g = c.getContext('2d');
    const outer = shape(S * 0.2, S * 0.36), inner = shape(S * 0.09, S * 0.24);
    // 白色外框 + 柔和陰影
    g.save();
    g.shadowColor = 'rgba(50,10,90,0.35)'; g.shadowBlur = S * 0.22; g.shadowOffsetY = S * 0.08;
    g.globalAlpha = 0.72; g.drawImage(outer, 0, 0);
    g.restore();
    g.globalCompositeOperation = 'destination-out'; g.drawImage(inner, 0, 0);
    g.globalCompositeOperation = 'source-over';
    // 半透明面板
    const tint = makeCanvas(Wd, Hd), tg = tint.getContext('2d');
    tg.drawImage(inner, 0, 0);
    tg.globalCompositeOperation = 'source-in';
    const pg = tg.createLinearGradient(0, 0, 0, Hd);
    pg.addColorStop(0, 'rgba(92,58,160,0.66)'); pg.addColorStop(1, 'rgba(62,36,122,0.74)');
    tg.fillStyle = pg; tg.fillRect(0, 0, Wd, Hd);
    g.drawImage(tint, 0, 0);
    // 棋盤格
    for (let r = 0; r < rows; r++) for (let c2 = 0; c2 < cols; c2++) {
      if (!mask[r][c2]) continue;
      g.fillStyle = (r + c2) % 2 ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.16)';
      const x = Math.round(m + c2 * S), y = Math.round(m + r * S);
      g.fillRect(x, y, Math.round(m + (c2 + 1) * S) - x, Math.round(m + (r + 1) * S) - y);
    }
    // 橫幅出現時用的暗色遮罩：和盤面外框同形狀（不會在盤面外畫出一個方框）
    const shade = makeCanvas(Wd, Hd), sg = shade.getContext('2d');
    sg.drawImage(outer, 0, 0);
    sg.globalCompositeOperation = 'source-in';
    sg.fillStyle = 'rgb(40,12,70)'; sg.fillRect(0, 0, Wd, Hd);
    bgCache = { c, shade, x: ox - MARGIN * cs, y: oy - MARGIN * cs, w: Wd / dpr, h: Hd / dpr };
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
    let size = Math.min(W / (cols + 2 * MARGIN), H / (rows + 2 * MARGIN));
    cs = Math.max(4, Math.floor(size * dpr) / dpr);
    let r0 = rows, r1 = -1, c0 = cols, c1 = -1;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (mask[r][c]) { r0 = Math.min(r0, r); r1 = Math.max(r1, r); c0 = Math.min(c0, c); c1 = Math.max(c1, c); }
    }
    if (r1 < 0) { r0 = 0; r1 = rows - 1; c0 = 0; c1 = cols - 1; }
    ox = Math.round(((W - (c1 - c0 + 1) * cs) / 2 - c0 * cs) * dpr) / dpr;
    oy = Math.round(((H - (r1 - r0 + 1) * cs) / 2 - r0 * cs) * dpr) / dpr;
    buildBg();
  }
  function layout() {
    if (destroyed) return;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width, h = rect.height;
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
    if (changed || !bgCache) geom();
    draw(now());
    requestDraw();
  }

  // ================= 盤面同步 =================
  function make2D(r, c, v) { return Array.from({ length: r }, () => new Array(c).fill(v)); }
  function newVisual(p, r, c) {
    return { id: p.id, kind: p.kind, special: p.special || 'none', r, c, mv: null,
      landT: -1e9, landAmp: 0, popT: -1e9, phase: Math.random() * Math.PI * 2 };
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
      v.kind = p.kind; v.special = p.special || 'none'; v.r = r; v.c = c; v.mv = null;
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
    sched = []; ghosts = []; fx = []; parts = []; texts = []; word = null; shakes = [];
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

  // ================= 粒子 =================
  function emit(p) {
    if (parts.length >= MAX_PARTS) parts.splice(0, parts.length - MAX_PARTS + 1);
    parts.push(p);
  }
  function burst(x, y, col, n, t, { speed = 3.2, stars = 2, up = 0.8 } = {}) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = speed * (0.45 + Math.random() * 0.75);
      emit({ type: 0, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - up, g: 7, drag: 2.2, t0: t,
        life: 480 + Math.random() * 320, size: 0.16 + Math.random() * 0.16, col });
    }
    for (let i = 0; i < stars; i++) {
      const a = Math.random() * Math.PI * 2, v = speed * (0.3 + Math.random() * 0.6);
      emit({ type: 1, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - up * 0.6, g: 2.5, drag: 2.6, t0: t,
        life: 520 + Math.random() * 300, size: 0.32 + Math.random() * 0.22 });
    }
  }
  function sparkle(x, y, n, t, spread = 0.5) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = 1 + Math.random() * 2.4;
      emit({ type: 1, x: x + Math.cos(a) * spread * Math.random(), y: y + Math.sin(a) * spread * Math.random(),
        vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.6, g: 1.5, drag: 3, t0: t + Math.random() * 120,
        life: 420 + Math.random() * 380, size: 0.25 + Math.random() * 0.3 });
    }
  }

  // ================= 事件動畫 =================
  async function animSwap(ev, back) {
    const t = now(), dur = back ? 300 : 170;
    const va = cellV(ev.a), vb = cellV(ev.b);
    const pairs = [[va, ev.b, true], [vb, ev.a, false]];
    for (const [v, to, main] of pairs) {
      if (!v || !to) continue;
      const cur = evalVisual(v, t);
      v.mv = { x0: cur.x, y0: cur.y, x1: to.c, y1: to.r, t0: t, dur, ease: back ? easeSwapBack : easeInOutCubic,
        lift: main ? (back ? 0.08 : 0.14) : -0.05, top: main };
    }
    dragState = null;
    await wait(dur + 12);
    if (back) {
      const tt = now();
      for (const v of [va, vb]) if (v) { v.landT = tt; v.landAmp = 0.12; }
    }
  }

  async function animTransform(ev) {
    const cells = (ev.cells || []).filter(Boolean);
    const n = cells.length;
    if (!n) return;
    const stagger = Math.min(85, 620 / n), t = now();
    cells.forEach((cl, i) => at(t + i * stagger, tt => {
      const p = cl.piece;
      if (!p) return;
      const old = cellV(cl);
      let v = old && old.id === p.id ? old : null;
      if (old && !v) visuals.delete(old.id);
      if (!v) { v = visuals.get(p.id) || newVisual(p, cl.r, cl.c); visuals.set(p.id, v); }
      v.kind = p.kind; v.special = p.special || 'none'; v.r = cl.r; v.c = cl.c; v.mv = null; v.popT = tt;
      if (cellMap[cl.r]) cellMap[cl.r][cl.c] = v;
      fx.push({ type: 'flash', x: cl.c + 0.5, y: cl.r + 0.5, t0: tt, dur: 360, R: 0.95 });
      burst(cl.c + 0.5, cl.r + 0.5, kindColor(p.kind), 5, tt, { speed: 2.2, stars: 3 });
    }));
    await wait((n - 1) * stagger + 320);
    flushSched();
  }

  // 每個效果什麼時候碰到某一格（毫秒），-1 = 碰不到
  function bombStagger(n) { return Math.min(42, 520 / Math.max(1, n)); }
  function travel(e, r, c) {
    switch (e.fx) {
      case 'line':
        if (e.dir === 'h') return r === e.r ? Math.abs(c - e.c) * 32 : -1;
        return c === e.c ? Math.abs(r - e.r) * 32 : -1;
      case 'blast': {
        const d = Math.max(Math.abs(r - e.r), Math.abs(c - e.c));
        return d <= (e.radius == null ? 1 : e.radius) ? d * 55 : -1;
      }
      case 'bomb': {
        const ts = e.targets || [];
        const i = ts.findIndex(q => q && q.r === r && q.c === c);
        return i < 0 ? -1 : 110 + i * bombStagger(ts.length);
      }
      case 'board': return Math.hypot(r - (rows - 1) / 2, c - (cols - 1) / 2) * 42;
    }
    return -1;
  }

  async function animClear(ev) {
    const t0 = now();
    const removed = (ev.removed || []).filter(Boolean), effects = (ev.effects || []).filter(Boolean);
    const groups = (ev.groups || []).filter(Boolean), created = (ev.created || []).filter(Boolean);
    const key = (r, c) => r * 1024 + c;
    const remAt = new Map();
    for (const it of removed) remAt.set(key(it.r, it.c), it);

    // --- 效果的啟動時間：被別的效果波及的特殊方塊，等波及到了才發動 ---
    const E = effects.map(e => ({ e, r: e.r, c: e.c, start: Infinity, board: e.fx === 'board' }));
    for (const x of E) {
      const it = x.board ? null : remAt.get(key(x.r, x.c));
      if (x.board || !it || it.cause === 'match' || it.cause === 'combo') x.start = 0;
    }
    for (let iter = 0; iter < 10; iter++) {
      let changed = false;
      for (const x of E) {
        if (x.start === 0) continue;
        let best = x.start;
        for (const y of E) {
          if (y === x || y.start === Infinity) continue;
          const tr = travel(y.e, x.r, x.c);
          if (tr >= 0 && y.start + tr + 40 < best) best = y.start + tr + 40;
        }
        if (best < x.start) { x.start = best; changed = true; }
      }
      if (!changed) break;
    }
    for (const x of E) if (x.start === Infinity) x.start = 0;

    // --- 每顆被消掉的方塊什麼時候爆 ---
    const remT = new Map();
    for (const it of removed) {
      let tm = it.cause === 'match' ? 0 : Infinity;
      for (const x of E) {
        const tr = travel(x.e, it.r, it.c);
        if (tr >= 0) tm = Math.min(tm, x.start + tr);
      }
      remT.set(key(it.r, it.c), tm === Infinity ? 0 : tm);
    }
    for (const x of E) {     // 彩色炸彈本身等閃電放完才消失
      if (x.e.fx !== 'bomb') continue;
      const n = (x.e.targets || []).length, k = key(x.r, x.c);
      if (remAt.has(k)) remT.set(k, Math.max(remT.get(k), x.start + 110 + n * bombStagger(n) + 80));
    }
    let maxT = 0;
    for (const v of remT.values()) maxT = Math.max(maxT, v);
    for (const x of E) maxT = Math.max(maxT, x.start);
    const f = maxT > 800 ? 800 / maxT : 1;
    const tOf = (r, c) => (remT.get(key(r, c)) || 0) * f;

    // --- 合成特殊方塊的那一組，會先往新方塊的位置吸過去 ---
    const mergeTo = new Map();
    for (const cr of created) {
      for (const g of groups) {
        if (!g.cells || !g.cells.some(q => q.r === cr.r && q.c === cr.c)) continue;
        for (const q of g.cells) if (q.r !== cr.r || q.c !== cr.c) mergeTo.set(key(q.r, q.c), cr);
      }
    }

    // --- 方塊變成「殘影」播放消失動畫 ---
    let end = t0 + 260;
    const heavy = removed.length > 24;
    for (const it of removed) {
      const v = (it.piece && visuals.get(it.piece.id)) || cellV(it);
      const p = it.piece || v;
      if (!p) continue;
      if (v) {
        visuals.delete(v.id);
        if (cellMap[it.r] && cellMap[it.r][it.c] === v) cellMap[it.r][it.c] = null;
      }
      const k = key(it.r, it.c);
      const m = it.cause === 'match' ? mergeTo.get(k) : null;
      const g = { kind: p.kind, special: p.special || 'none', x: it.c, y: it.r, t0: t0 + tOf(it.r, it.c),
        dur: m ? 190 : 270, to: m ? { x: m.c, y: m.r } : null, burst: false, heavy, phase: v ? v.phase : 0 };
      ghosts.push(g);
      end = Math.max(end, g.t0 + g.dur * 0.8);
    }

    // --- 特效 ---
    for (const x of E) {
      const st = t0 + x.start * f, e = x.e;
      const src = x.board ? null : remAt.get(key(x.r, x.c));
      const sk = src && src.piece ? src.piece.kind : -1;
      const col = sk >= 0 ? kindColor(sk) : [255, 226, 140];
      if (e.fx === 'line') {
        fx.push({ type: 'beam', dir: e.dir === 'v' ? 'v' : 'h', r: e.r, c: e.c, t0: st, dur: 560, col });
        shake(3.5, 260, st);
        end = Math.max(end, st + 300);
      } else if (e.fx === 'blast') {
        const rad = e.radius == null ? 1 : e.radius;
        fx.push({ type: 'ring', x: e.c + 0.5, y: e.r + 0.5, R: rad + 0.9, t0: st, dur: 540, col });
        shake(5 + 2.5 * (rad - 1), 360, st);
        at(st, tt => sparkle(e.c + 0.5, e.r + 0.5, 10 + rad * 4, tt, rad));
        end = Math.max(end, st + 320);
      } else if (e.fx === 'bomb') {
        const ts = (e.targets || []).filter(Boolean);
        const stg = bombStagger(ts.length) * f;
        fx.push({ type: 'bolts', x: e.c + 0.5, y: e.r + 0.5, targets: ts.map(q => ({ x: q.c + 0.5, y: q.r + 0.5 })),
          t0: st, stagger: stg, end: st + 110 * f + ts.length * stg + 260 });
        shake(6, 520, st);
        end = Math.max(end, st + 110 * f + ts.length * stg + 120);
      } else if (e.fx === 'board') {
        fx.push({ type: 'boardfx', t0: st, dur: 1000 });
        shake(14, 760, st);
        end = Math.max(end, st + 420);
      }
    }

    // --- 新的特殊方塊 ---
    for (const cr of created) {
      if (!cr.piece) continue;
      const k = key(cr.r, cr.c);
      let tm = 0;
      for (const v of mergeTo.values()) if (v === cr) { tm = 185; break; }
      if (remT.has(k)) tm = Math.max(tm, tOf(cr.r, cr.c) + 140);
      tm = Math.max(tm, 120);
      at(t0 + tm, tt => {
        const p = cr.piece;
        const old = cellV(cr);
        if (old && old.id !== p.id) visuals.delete(old.id);
        const v = (old && old.id === p.id ? old : null) || visuals.get(p.id) || newVisual(p, cr.r, cr.c);
        v.kind = p.kind; v.special = p.special || 'none'; v.r = cr.r; v.c = cr.c; v.mv = null; v.popT = tt;
        visuals.set(p.id, v);
        if (cellMap[cr.r]) cellMap[cr.r][cr.c] = v;
        fx.push({ type: 'flash', x: cr.c + 0.5, y: cr.r + 0.5, t0: tt, dur: 420, R: 1.3 });
        sparkle(cr.c + 0.5, cr.r + 0.5, 10, tt, 0.3);
        shake(2.5, 200, tt);
      });
      end = Math.max(end, t0 + tm + 170);
    }

    // --- 果凍 ---
    for (const jh of ev.jellyHits || []) {
      if (!jh) continue;
      at(t0 + tOf(jh.r, jh.c), tt => {
        if (!jelly[jh.r]) return;
        const from = jelly[jh.r][jh.c] || 0;
        jelly[jh.r][jh.c] = jh.left | 0;
        jellyFx.set(key(jh.r, jh.c), { t0: tt, from });
        burst(jh.c + 0.5, jh.r + 0.5, [255, 120, 190], 6, tt, { speed: 2.6, stars: 0, up: 1.4 });
      });
    }

    // --- 飄分 ---
    for (const pt of ev.points || []) {
      if (!pt) continue;
      const it = remAt.get(key(pt.r, pt.c));
      let kind = it && it.piece ? it.piece.kind : -1;
      if (kind < 0) {
        const g = groups.find(gg => gg.cells && gg.cells.some(q => q.r === pt.r && q.c === pt.c));
        if (g) kind = g.kind;
      }
      at(t0 + Math.min(520, tOf(pt.r, pt.c)) + 80, tt => {
        texts.push({ text: '+' + pt.value, x: pt.c + 0.5, y: pt.r + 0.5, t0: tt, dur: 1000,
          col: kind >= 0 ? kindColor(kind) : [255, 170, 60], big: pt.value >= 200 });
      });
    }

    if ((ev.cascade | 0) >= 2) showWord(WORDS[Math.min(5, ev.cascade | 0)], ev.cascade | 0);
    await wait(end - now());
    flushSched();
  }

  async function animFall(ev) {
    const t = now();
    let end = t + 60;
    const mk = (v, from, to) => {
      const d = Math.hypot(to.r - from.r, to.c - from.c);
      const dur = Math.sqrt((2 * Math.max(0.25, d)) / G_FALL);
      v.mv = { x0: from.c, y0: from.r, x1: to.c, y1: to.r, t0: t, dur, ease: easeInQuad, clip: true };
      v.landT = t + dur; v.landAmp = Math.min(0.24, 0.08 + d * 0.035);
      end = Math.max(end, t + dur);
    };
    for (const m of ev.moves || []) {
      if (!m || !m.from || !m.to) continue;
      const v = visuals.get(m.id) || cellV(m.from);
      if (v) mk(v, m.from, m.to);
    }
    for (const s of ev.spawns || []) {
      if (!s || !s.piece || !s.to) continue;
      const v = newVisual(s.piece, s.to.r, s.to.c);
      visuals.set(s.piece.id, v);
      mk(v, s.from || { r: s.to.r - rows, c: s.to.c }, s.to);
    }
    await wait(end - now() + 25);
  }

  async function animShuffle(ev) {
    const t = now(), dur = 920, cx = (cols - 1) / 2, cy = (rows - 1) / 2;
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
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2, v = 2.5 + Math.random() * 2;
      emit({ type: 1, x: cx + 0.5, y: cy + 0.5, vx: Math.cos(a) * v - Math.sin(a) * 3, vy: Math.sin(a) * v + Math.cos(a) * 3,
        g: 0, drag: 1.6, t0: t + 250 + Math.random() * 300, life: 600, size: 0.3 + Math.random() * 0.25 });
    }
    await wait(dur + 20);
  }

  function animateEvent(ev) {
    switch (ev && ev.t) {
      case 'swap': return animSwap(ev, false);
      case 'swapBack': return animSwap(ev, true);
      case 'transform': return animTransform(ev);
      case 'clear': return animClear(ev);
      case 'fall': return animFall(ev);
      case 'shuffle': return animShuffle(ev);
      default: return null;
    }
  }

  async function runEvents(events, opts, myGen) {
    if (myGen !== gen || destroyed) return;
    selected = null; hintPair = null;
    for (const ev of events) {
      if (myGen !== gen || destroyed) return;
      if (opts && typeof opts.onEvent === 'function') {
        try { opts.onEvent(ev); } catch (e) { console.error('[renderer] onEvent', e); }
      }
      try { await animateEvent(ev); } catch (e) { console.error('[renderer]', e); }
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
      .then(() => runEvents(list, opts, myGen))
      .catch(e => console.error('[renderer]', e))
      .finally(() => { busyCount = Math.max(0, busyCount - 1); requestDraw(); });
    queue = p;
    return p;
  }

  // ================= 文字 =================
  function showWord(text, level) {
    if (!text) return;
    word = { text, level, t0: now(), dur: 1150 };
    requestDraw();
  }
  function banner(text, { sub = '', duration = 1600 } = {}) {
    busyCount++;
    const p = bannerQueue.then(() => new Promise(res => {
      if (destroyed) { res(); return; }
      const b = { text: String(text == null ? '' : text), sub: sub ? String(sub) : '', t0: now(),
        dur: Math.max(500, +duration || 1600), res, timer: 0 };
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
    const p = (t - dragState.rel) / 180;
    if (p >= 1) return { x: 0, y: 0 };
    const k = (1 - p) * (1 - p) * Math.cos(p * Math.PI * 1.4);
    return { x: dragState.dx * k, y: dragState.dy * k };
  }

  // ================= 繪製 =================
  function evalVisual(v, t) {
    let x = v.c, y = v.r, s = 1, sx = 1, sy = 1, rot = 0, falling = false, top = false, hl = 0;
    const m = v.mv;
    if (m) {
      const p = clamp01((t - m.t0) / m.dur);
      if (m.path) {
        if (p >= 1) { x = m.x1; y = m.y1; } else { const q = m.path(p); x = q.x; y = q.y; if (q.s) s *= q.s; }
      } else {
        const e = p >= 1 ? 1 : m.ease ? m.ease(p) : p;
        x = lerp(m.x0, m.x1, e); y = lerp(m.y0, m.y1, e);
      }
      if (p < 1) {
        if (m.lift) s *= 1 + m.lift * Math.sin(Math.PI * p);
        falling = !!m.clip; top = !!m.top;
      }
    }
    if (t >= v.landT) {
      const p = (t - v.landT) / 280;
      if (p < 1) {
        const k = Math.exp(-4.2 * p) * Math.cos(p * Math.PI * 2.6);
        sy *= 1 - v.landAmp * k; sx *= 1 + v.landAmp * 0.75 * k;
      }
    }
    if (t >= v.popT) { const p = (t - v.popT) / 440; if (p < 1) s *= popCurve(p); }
    if (v.special === 'wrap') s *= 1 + 0.045 * Math.sin(t / 230 + v.phase);
    if (dragState && dragState.id === v.id) {
      const o = dragOffset(t);
      x += o.x; y += o.y; top = true; s *= 1.06;
      if (dragState.rel && t - dragState.rel > 180) dragState = null;
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
    return { x, y, s, sx, sy, rot, falling, top, hl };
  }

  function drawBomb(cx, cy, s, t, phase, spinRate = 1) {
    const e = getTile(-1, 'bomb'), P = e.P / dpr * s;
    ctx.drawImage(e.under, cx - P / 2, cy - P / 2, P, P);
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate((t / 650) * spinRate + phase);
    ctx.drawImage(e.orb, -P / 2, -P / 2, P, P);
    ctx.restore();
    ctx.drawImage(e.top, cx - P / 2, cy - P / 2, P, P);
    ctx.drawImage(e.trio, cx - P / 2, cy - P / 2, P, P);
    // 閃閃
    const star = getStar();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const a = t / 900 + phase + (i * Math.PI * 2) / 3, tw = Math.max(0, Math.sin(t / 210 + i * 2.1 + phase));
      if (tw < 0.05) continue;
      const rr2 = cs * 0.4 * s, sz = cs * 0.34 * tw * s;
      ctx.globalAlpha = tw;
      ctx.drawImage(star, cx + Math.cos(a) * rr2 - sz / 2, cy + Math.sin(a) * rr2 - sz / 2, sz, sz);
    }
    ctx.restore();
  }

  function drawPieceAt(kind, special, cx, cy, s, sx, sy, t, phase) {
    if (special === 'bomb' || kind < 0) { drawBomb(cx, cy, s * Math.sqrt(sx * sy), t, phase); return; }
    const e = getTile(kind, special), P = e.P / dpr;
    const w = P * s * sx, h = P * s * sy, dy = (1 - sy) * cs * TILE * s * 0.5;
    ctx.drawImage(e.full, cx - w / 2, cy - h / 2 + dy, w, h);
  }

  function drawVisual(v, st, t) {
    const cx = ox + (st.x + 0.5) * cs, cy = oy + (st.y + 0.5) * cs;
    if (st.hl > 0) {
      const g = getGlow(), gs = cs * 1.45;
      ctx.globalAlpha = 0.75 * st.hl;
      ctx.drawImage(g, cx - gs / 2, cy - gs / 2, gs, gs);
      ctx.globalAlpha = 1;
    }
    drawPieceAt(v.kind, v.special, cx, cy, st.s, st.sx, st.sy, t, v.phase);
  }

  function drawSelected(v, st, t) {
    const cx = ox + (st.x + 0.5) * cs, cy = oy + (st.y + 0.5) * cs, age = t - selected.t0;
    const pulse = 0.5 + 0.5 * Math.sin(age / 160);
    const g = getGlow(), gs = cs * (1.6 + 0.14 * pulse);
    ctx.globalAlpha = 0.6 + 0.4 * pulse;
    ctx.drawImage(g, cx - gs / 2, cy - gs / 2, gs, gs);
    ctx.globalAlpha = 1;
    const s = st.s * (age < 300 ? lerp(1, 1.12, easeOutBack(age / 300, 3)) : 1.12 + 0.025 * Math.sin(age / 130));
    if (v.special === 'bomb' || v.kind < 0) { drawBomb(cx, cy, s, t, v.phase, 3); return; }
    const e = getTile(v.kind, v.special), P = e.P / dpr * s;
    const info = pieceInfo(v.kind), { spin, sprite, spinScale } = imgsFor(info.id);
    const box = cs * (v.special === 'wrap' ? SPR_WRAP : SPR) * s;
    if (usable(spin)) {
      ctx.drawImage(e.base, cx - P / 2, cy - P / 2, P, P);
      // spinScale（manifest）：旋轉序列裡玩具比靜態圖小多少，放大回來讓大小一致
      const fw = natW(spin) / 6, fh = natH(spin) / 4, i = Math.floor(age / 50) % 24;
      const sb = box / clamp(+spinScale || 1, 0.5, 2);
      ctx.drawImage(spin, (i % 6) * fw, Math.floor(i / 6) * fh, fw, fh, cx - sb / 2, cy - sb / 2, sb, sb);
      if (e.top) ctx.drawImage(e.top, cx - P / 2, cy - P / 2, P, P);
    } else if (usable(sprite)) {
      // 沒有旋轉序列：靜態圖輕輕搖擺
      ctx.drawImage(e.base, cx - P / 2, cy - P / 2, P, P);
      const sc = scaled(sprite, Math.round((box / s) * dpr * 1.12));
      ctx.save();
      ctx.translate(cx, cy - Math.abs(Math.sin(age / 210)) * cs * 0.06);
      ctx.rotate(0.16 * Math.sin(age / 150));
      ctx.drawImage(sc, -box / 2, -box / 2, box, box);
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
        const lv = jr[c] | 0, jf = jellyFx.get(r * 1024 + c);
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

  function drawPieces(t) {
    const sel = selected ? cellV(selected) : null;
    let selSt = null;
    const falling = [], tops = [], late = [];
    for (const v of visuals.values()) {
      const st = evalVisual(v, t);
      if (v === sel && !v.mv) { selSt = st; continue; }
      if (st.falling) falling.push([v, st]);
      else if (st.top) tops.push([v, st]);
      else if (v.special === 'wrap') late.push([v, st]);   // 糖果紙兩端要蓋在鄰居上面
      else drawVisual(v, st, t);
    }
    for (const [v, st] of late) drawVisual(v, st, t);
    drawJellyRims(t);
    if (falling.length) {
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
      if (!g.burst) {
        g.burst = true;
        const col = g.kind >= 0 ? kindColor(g.kind) : kindColor(Math.floor(Math.random() * Math.max(1, pieces.length)));
        if (g.to) sparkle(g.x + 0.5, g.y + 0.5, 1, g.t0, 0.2);
        else {
          burst(g.x + 0.5, g.y + 0.5, col, g.heavy ? 4 : 8, g.t0, { stars: g.heavy ? 1 : 2, speed: g.special !== 'none' ? 4.2 : 3.2 });
          fx.push({ type: 'flash', x: g.x + 0.5, y: g.y + 0.5, t0: g.t0, dur: 240, R: 0.75 });
        }
      }
      let x = cx0, y = cy0, s, a;
      if (g.to) {
        const e = easeInCubic(p);
        x = lerp(cx0, ox + (g.to.x + 0.5) * cs, e); y = lerp(cy0, oy + (g.to.y + 0.5) * cs, e);
        s = 1 - 0.4 * e; a = 1 - p * p;
      } else {
        s = p < 0.28 ? 1 + 0.26 * (p / 0.28) : 1.26 * (1 - easeInCubic((p - 0.28) / 0.72));
        a = p < 0.55 ? 1 : 1 - (p - 0.55) / 0.45;
      }
      if (s <= 0.01) continue;
      ctx.globalAlpha = clamp01(a);
      drawPieceAt(g.kind, g.special, x, y, s, 1, 1, t, g.phase);
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

  function drawFx(t) {
    let w = 0;
    const star = getStar();
    for (const f of fx) {
      const endT = f.end != null ? f.end : f.t0 + f.dur;
      if (t >= endT) continue;
      fx[w++] = f;
      if (t < f.t0) continue;
      const p = f.end != null ? (t - f.t0) / (f.end - f.t0) : (t - f.t0) / f.dur;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      if (f.type === 'flash') {
        const x = ox + f.x * cs, y = oy + f.y * cs, R = cs * f.R * (0.55 + 0.7 * easeOutCubic(p));
        const rg = ctx.createRadialGradient(x, y, 0, x, y, R);
        rg.addColorStop(0, `rgba(255,255,255,${0.85 * (1 - p)})`); rg.addColorStop(0.5, `rgba(255,240,200,${0.4 * (1 - p)})`);
        rg.addColorStop(1, 'rgba(255,240,200,0)');
        ctx.fillStyle = rg; ctx.fillRect(x - R, y - R, R * 2, R * 2);
      } else if (f.type === 'beam') {
        const cx = ox + (f.c + 0.5) * cs, cy = oy + (f.r + 0.5) * cs, h = f.dir === 'h';
        const span = (h ? cols : rows) * cs, reach = (span + cs) * easeOutCubic(clamp01(p / 0.42));
        const grow = Math.sin(Math.min(1, p / 0.18) * Math.PI / 2), fade = p > 0.42 ? 1 - easeInCubic((p - 0.42) / 0.58) : 1;
        const th = cs * (0.18 + 0.42 * grow) * fade;
        const lo = h ? ox - cs * 0.2 : oy - cs * 0.2, hi = h ? ox + cols * cs + cs * 0.2 : oy + rows * cs + cs * 0.2;
        const c0 = h ? cx : cy, a0 = Math.max(lo, c0 - reach), a1 = Math.min(hi, c0 + reach);
        const col = mixc(f.col, WHITE, 0.25);
        const gr = h ? ctx.createLinearGradient(0, cy - th * 1.8, 0, cy + th * 1.8) : ctx.createLinearGradient(cx - th * 1.8, 0, cx + th * 1.8, 0);
        gr.addColorStop(0, css(col, 0)); gr.addColorStop(0.3, css(col, 0.55 * fade)); gr.addColorStop(0.5, `rgba(255,255,255,${0.95 * fade})`);
        gr.addColorStop(0.7, css(col, 0.55 * fade)); gr.addColorStop(1, css(col, 0));
        ctx.fillStyle = gr;
        if (h) ctx.fillRect(a0, cy - th * 1.8, a1 - a0, th * 3.6); else ctx.fillRect(cx - th * 1.8, a0, th * 3.6, a1 - a0);
        ctx.fillStyle = `rgba(255,255,255,${0.9 * fade})`;
        if (h) ctx.fillRect(a0, cy - th * 0.22, a1 - a0, th * 0.44); else ctx.fillRect(cx - th * 0.22, a0, th * 0.44, a1 - a0);
        if (p < 0.55) {
          const sz = cs * (1.3 - p), al = 1 - p / 0.55;
          ctx.globalAlpha = al;
          for (const q of [a0, a1]) {
            if (h) ctx.drawImage(star, q - sz / 2, cy - sz / 2, sz, sz); else ctx.drawImage(star, cx - sz / 2, q - sz / 2, sz, sz);
          }
        }
      } else if (f.type === 'ring') {
        const x = ox + f.x * cs, y = oy + f.y * cs, e = easeOutCubic(p), R = cs * (0.3 + f.R * e);
        if (p < 0.4) {
          const fr = cs * f.R * 0.95, rg = ctx.createRadialGradient(x, y, 0, x, y, fr), a = 1 - p / 0.4;
          rg.addColorStop(0, `rgba(255,255,255,${0.9 * a})`); rg.addColorStop(0.6, css(mixc(f.col, WHITE, 0.3), 0.4 * a));
          rg.addColorStop(1, css(f.col, 0));
          ctx.fillStyle = rg; ctx.fillRect(x - fr, y - fr, fr * 2, fr * 2);
        }
        ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2);
        ctx.lineWidth = cs * 0.5 * (1 - p) + 1; ctx.strokeStyle = css(mixc(f.col, WHITE, 0.2), 0.7 * (1 - p)); ctx.stroke();
        ctx.lineWidth = cs * 0.14 * (1 - p) + 0.5; ctx.strokeStyle = `rgba(255,255,255,${0.95 * (1 - p)})`; ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, R * 0.7, 0, Math.PI * 2);
        ctx.lineWidth = cs * 0.08 * (1 - p); ctx.strokeStyle = `rgba(255,255,255,${0.5 * (1 - p)})`; ctx.stroke();
      } else if (f.type === 'bolts') {
        const sx = ox + f.x * cs, sy = oy + f.y * cs;
        const tail = Math.min(1, (f.end - t) / 220);
        const og = cs * (0.9 + 0.25 * Math.sin(t / 40)), rg = ctx.createRadialGradient(sx, sy, 0, sx, sy, og);
        rg.addColorStop(0, `rgba(255,255,255,${0.9 * tail})`); rg.addColorStop(0.4, `rgba(255,200,255,${0.45 * tail})`); rg.addColorStop(1, 'rgba(255,200,255,0)');
        ctx.fillStyle = rg; ctx.fillRect(sx - og, sy - og, og * 2, og * 2);
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        const seedT = Math.floor(t / 55);
        f.targets.forEach((q, i) => {
          const st = f.t0 + 60 + i * f.stagger;
          if (t < st) return;
          const tx = ox + q.x * cs, ty = oy + q.y * cs, life = t - st;
          const grow = clamp01(life / 70), ex = lerp(sx, tx, grow), ey = lerp(sy, ty, grow);
          const pts = boltPts(sx, sy, ex, ey, seedT * 131 + i * 977);
          const hue = (i * 47 + t / 6) % 360;
          ctx.strokeStyle = `hsla(${hue},100%,68%,${0.55 * tail})`; ctx.lineWidth = cs * 0.14; strokePts(pts);
          ctx.strokeStyle = `rgba(255,255,255,${0.95 * tail})`; ctx.lineWidth = cs * 0.045; strokePts(pts);
          if (life < 260 && grow >= 1) {
            const a = 1 - life / 260, fr = cs * 0.75, g2 = ctx.createRadialGradient(tx, ty, 0, tx, ty, fr);
            g2.addColorStop(0, `rgba(255,255,255,${a})`); g2.addColorStop(1, `hsla(${hue},100%,70%,0)`);
            ctx.fillStyle = g2; ctx.fillRect(tx - fr, ty - fr, fr * 2, fr * 2);
          }
        });
      } else if (f.type === 'boardfx') {
        const bx = ox, by = oy, bw = cols * cs, bh = rows * cs, cx = bx + bw / 2, cy = by + bh / 2;
        if (p < 0.5) {
          ctx.fillStyle = `rgba(255,255,255,${0.75 * Math.pow(1 - p / 0.5, 2)})`;
          ctx.fillRect(bx - cs * 0.3, by - cs * 0.3, bw + cs * 0.6, bh + cs * 0.6);
        }
        const R = Math.hypot(bw, bh) * 0.6 * easeOutCubic(p), n = 18;
        ctx.lineWidth = cs * 0.5 * (1 - p) + 1;
        for (let i = 0; i < n; i++) {
          ctx.beginPath(); ctx.arc(cx, cy, R, (i / n) * Math.PI * 2 + t / 300, ((i + 1) / n) * Math.PI * 2 + t / 300);
          ctx.strokeStyle = `hsla(${(i / n) * 360},100%,68%,${0.8 * (1 - p)})`; ctx.stroke();
        }
      } else if (f.type === 'swirl') {
        const cx = ox + (cols / 2) * cs, cy = oy + (rows / 2) * cs, k = Math.sin(Math.PI * p);
        const R = cs * 1.8 * k, rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R + 1);
        rg.addColorStop(0, `rgba(255,255,255,${0.55 * k})`); rg.addColorStop(1, 'rgba(255,220,255,0)');
        ctx.fillStyle = rg; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
      }
      ctx.restore();
    }
    fx.length = w;
  }

  function drawParticles(t) {
    if (!parts.length) return;
    const star = getStar();
    let w = 0;
    for (const p of parts) {
      const age = (t - p.t0) / p.life;
      if (age >= 1) continue;
      parts[w++] = p;
      if (age < 0) continue;
      const s = (t - p.t0) / 1000, k = p.drag, fd = k ? (1 - Math.exp(-k * s)) / k : s;
      const x = ox + (p.x + p.vx * fd) * cs, y = oy + (p.y + p.vy * fd + 0.5 * p.g * s * s) * cs;
      const a = age < 0.6 ? 1 : 1 - (age - 0.6) / 0.4;
      if (p.type === 0) {
        const z = p.size * cs * (1 - age * 0.45);
        ctx.globalAlpha = a;
        ctx.drawImage(getFluff(p.col), x - z, y - z, z * 2, z * 2);
      } else {
        const z = p.size * cs * (0.6 + 0.4 * Math.sin(age * Math.PI));
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = a;
        ctx.drawImage(star, x - z / 2, y - z / 2, z, z);
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    parts.length = w;
    ctx.globalAlpha = 1;
  }

  function strokeFillText(text, x, y, size, fill, outline, outer) {
    ctx.font = `900 ${Math.max(6, size)}px ${FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    if (outer) { ctx.lineWidth = size * 0.34; ctx.strokeStyle = outer; ctx.strokeText(text, x, y); }
    ctx.lineWidth = size * (outer ? 0.17 : 0.22); ctx.strokeStyle = outline; ctx.strokeText(text, x, y);
    ctx.fillStyle = fill; ctx.fillText(text, x, y);
  }

  function drawTexts(t) {
    let w = 0;
    for (const f of texts) {
      const p = (t - f.t0) / f.dur;
      if (p >= 1) continue;
      texts[w++] = f;
      if (p < 0) continue;
      const sc = p < 0.14 ? lerp(0.4, 1.15, easeOutCubic(p / 0.14)) : p < 0.24 ? lerp(1.15, 1, (p - 0.14) / 0.1) : 1;
      const x = ox + f.x * cs, y = oy + (f.y - 0.85 * easeOutCubic(p)) * cs;
      ctx.globalAlpha = p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3;
      strokeFillText(f.text, x, y, cs * (f.big ? 0.56 : 0.44) * sc, '#fff', css(mixc(saturate(f.col, 0.5), BLACK, 0.42)));
    }
    texts.length = w;
    ctx.globalAlpha = 1;
  }

  function drawWord(t) {
    if (!word) return;
    const p = (t - word.t0) / word.dur;
    if (p >= 1) { word = null; return; }
    const bw = cols * cs, cx = ox + bw / 2, cy = oy + rows * cs * 0.4;
    const pin = clamp01((t - word.t0) / 300), pout = clamp01((t - word.t0 - word.dur + 260) / 260);
    let size = cs * (1.05 + 0.08 * (word.level - 2));
    ctx.font = `900 ${size}px ${FONT}`;
    const mw = ctx.measureText(word.text).width;
    if (mw > bw * 0.92) size *= (bw * 0.92) / mw;
    const sc = easeOutBack(pin, 2.4) * (1 + 0.15 * pout);
    ctx.save();
    ctx.translate(cx, cy - pout * cs * 0.6);
    ctx.rotate(-0.07 + 0.03 * Math.sin((t - word.t0) / 120) * (1 - pin));
    ctx.scale(sc, sc);
    ctx.globalAlpha = 1 - pout;
    const gr = ctx.createLinearGradient(0, -size / 2, 0, size / 2);
    const pal = [['#fff8b0', '#ffc23d', '#ff7a59'], ['#fff3fb', '#ff9ad1', '#ff4f9a'], ['#f3ecff', '#c49bff', '#8a5cff'], ['#fffbe0', '#ffd23d', '#ff4fa3']][Math.min(3, Math.max(0, word.level - 2))];
    gr.addColorStop(0, pal[0]); gr.addColorStop(0.5, pal[1]); gr.addColorStop(1, pal[2]);
    ctx.shadowColor = 'rgba(50,10,80,0.45)'; ctx.shadowBlur = size * 0.15; ctx.shadowOffsetY = size * 0.08;
    strokeFillText(word.text, 0, 0, size, gr, '#fff', css(PLUM));
    ctx.restore();
  }

  function drawBanners(t) {
    if (!banners.length) return;
    const b = banners[banners.length - 1];
    const bw = cols ? cols * cs : W, cx = cols ? ox + bw / 2 : W / 2, cy = rows ? oy + rows * cs / 2 : H / 2;
    const unit = cols ? cs : Math.min(W, H) / 9;
    const pin = clamp01((t - b.t0) / 340), pout = clamp01((t - b.t0 - b.dur + 320) / 320);
    const vis = easeOutCubic(pin) * (1 - easeInCubic(pout));
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
    let size = unit * 1.15;
    ctx.font = `900 ${size}px ${FONT}`;
    const mw = ctx.measureText(b.text).width, maxW = Math.min(W * 0.92, bw * 1.05);
    if (mw > maxW) size *= maxW / mw;
    const sc = easeOutBack(clamp01((t - b.t0 - 80) / 360), 2.2) * (1 + 0.25 * pout);
    ctx.translate(cx, ty);
    ctx.scale(Math.max(0.001, sc), Math.max(0.001, sc));
    ctx.globalAlpha = 1 - pout;
    const gr = ctx.createLinearGradient(0, -size / 2, 0, size / 2);
    gr.addColorStop(0, '#fffdf0'); gr.addColorStop(0.55, '#fff0a8'); gr.addColorStop(1, '#ffc94d');
    ctx.shadowColor = 'rgba(50,10,80,0.5)'; ctx.shadowBlur = size * 0.18; ctx.shadowOffsetY = size * 0.08;
    strokeFillText(b.text, 0, 0, size, gr, '#fff', css(PLUM));
    if (b.sub) {
      ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      let ss = unit * 0.46;
      ctx.font = `900 ${ss}px ${FONT}`;
      const sw = ctx.measureText(b.sub).width;
      if (sw > maxW) ss *= maxW / sw;
      strokeFillText(b.sub, 0, unit * 0.95, ss, '#fff', css(PLUM));
    }
    ctx.restore();
  }

  function draw(t) {
    if (destroyed) return;
    runSched(t);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
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
      if (v.mv && t < v.mv.t0 + v.mv.dur + 20) return true;
      if (t - v.landT < 300 || t - v.popT < 460) return true;
    }
    return false;
  }
  function ambient() {
    if (selected || hintPair) return true;
    for (const v of visuals.values()) if (v.special === 'wrap' || v.special === 'bomb' || v.kind < 0) return true;
    return false;
  }
  function frame() {
    raf = 0;
    if (destroyed) return;
    const t = now(), act = moving(t), amb = !act && ambient();
    if (amb && t - lastDraw < 31) { raf = requestAnimationFrame(frame); return; }   // 只有待機動畫：約 30fps
    lastDraw = t;
    draw(t);
    if (act || amb || busyCount > 0) raf = requestAnimationFrame(frame);
  }
  function requestDraw() {
    if (!raf && !destroyed && typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(frame);
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
    if (ro) ro.disconnect();
    window.removeEventListener('resize', onResize);
    for (const b of banners) { clearTimeout(b.timer); b.res(); }
    banners = []; ghosts = []; fx = []; parts = []; texts = []; sched = [];
    tileCache.clear(); fluffCache.clear();
  }

  const R = {
    setBoard, layout, cellAt, select, drag, hint, play, banner, destroy,
    get busy() { return busyCount > 0; },
  };
  // 測試用（非正式 API）
  Object.defineProperty(R, '_debug', { enumerable: false, value: () => ({
    rows, cols, cs, ox, oy, dpr, W, H, visuals: visuals.size, ghosts: ghosts.length, fx: fx.length,
    parts: parts.length, texts: texts.length, sched: sched.length, busy: busyCount, raf: !!raf,
    grid: cellMap.map(row => row.map(v => (v ? v.id : null))),
  }) });
  layout();
  return R;
}
