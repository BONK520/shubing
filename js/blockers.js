// 毛絨消消樂 — 盤面機關的圖（鐵籠子、多層糖霜、巧克力、甘草漩渦糖、龍龍出口箭頭、傳送門顏色）
// 全部用 canvas 畫（不用額外的圖檔）。每個 paint 函式畫在 S×S 的畫布上（S = 一格的裝置像素），
// renderer.js 畫一次就快取起來；main.js 也拿它們畫目標圖示 / 新機關教學小卡。

const rr = (g, x, y, w, h, r) => {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
};

// ---------------- 鐵籠子：銀色的框 + 三根直的鐵條 + 底下一個金色小鎖頭（蓋在玩偶上面，玩偶看得到）----------------
export function paintCage(g, S) {
  const m = S * 0.075, w = S - 2 * m, r = S * 0.2;
  const xs = [0.32, 0.5, 0.68].map(k => k * S);
  const y0 = m + S * 0.02, y1 = S - m - S * 0.02;
  g.lineCap = 'round'; g.lineJoin = 'round';
  // 深色的底邊（在深色盤面、淺色玩偶上都看得清楚）
  g.strokeStyle = 'rgba(14,18,40,0.6)';
  g.lineWidth = S * 0.115; rr(g, m, m, w, w, r); g.stroke();
  g.lineWidth = S * 0.085;
  for (const x of xs) { g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y1); g.stroke(); }
  // 金屬：左上亮、右下暗
  const met = g.createLinearGradient(0, 0, S, S);
  met.addColorStop(0, '#ffffff'); met.addColorStop(0.3, '#dfe6ef'); met.addColorStop(0.62, '#9aa6b8'); met.addColorStop(1, '#5f6a7c');
  g.strokeStyle = met;
  g.lineWidth = S * 0.072; rr(g, m, m, w, w, r); g.stroke();
  g.lineWidth = S * 0.05;
  for (const x of xs) { g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y1); g.stroke(); }
  // 鐵條上的亮線
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = S * 0.016;
  for (const x of xs) { g.beginPath(); g.moveTo(x - S * 0.012, y0 + S * 0.05); g.lineTo(x - S * 0.012, y1 - S * 0.12); g.stroke(); }
  g.beginPath(); g.arc(m + r, m + r, r - S * 0.012, Math.PI * 1.08, Math.PI * 1.45); g.stroke();
  // 鉚釘
  for (const x of xs) for (const y of [m, S - m]) {
    const rv = S * 0.04, rg = g.createRadialGradient(x - rv * 0.3, y - rv * 0.3, rv * 0.1, x, y, rv);
    rg.addColorStop(0, '#ffffff'); rg.addColorStop(0.5, '#c6cfdb'); rg.addColorStop(1, '#58637a');
    g.fillStyle = rg; g.beginPath(); g.arc(x, y, rv, 0, Math.PI * 2); g.fill();
  }
  // 小鎖頭（下緣正中間）
  const lw = S * 0.25, lh = S * 0.19, lx = S / 2 - lw / 2, ly = S - m - lh * 0.55;
  g.lineWidth = S * 0.045; g.strokeStyle = 'rgba(14,18,40,0.6)';
  g.beginPath(); g.arc(S / 2, ly, lw * 0.3, Math.PI, 0); g.stroke();
  g.lineWidth = S * 0.03; g.strokeStyle = '#d9e0ea';
  g.beginPath(); g.arc(S / 2, ly, lw * 0.3, Math.PI, 0); g.stroke();
  const gold = g.createLinearGradient(0, ly, 0, ly + lh);
  gold.addColorStop(0, '#fff1a6'); gold.addColorStop(0.45, '#ffc83a'); gold.addColorStop(1, '#c98410');
  rr(g, lx, ly, lw, lh, S * 0.05);
  g.fillStyle = gold; g.fill();
  g.lineWidth = S * 0.018; g.strokeStyle = '#7a4a06'; g.stroke();
  g.fillStyle = '#5a3405';
  g.beginPath(); g.arc(S / 2, ly + lh * 0.42, S * 0.025, 0, Math.PI * 2); g.fill();
  g.fillRect(S / 2 - S * 0.011, ly + lh * 0.42, S * 0.022, lh * 0.33);
}

// ---------------- 多層糖霜：一層一層疊起來的小蛋糕（1 層香草、2 層 + 草莓、3 層 + 芋頭），上面一層白色奶油和彩色糖珠 ----------------
export const FROST_LAYERS = ['#ffd49a', '#ff9ec6', '#b99cff'];
const FROST_DARK = ['#d79a4c', '#e2659a', '#8565e0'];
export function paintFrost(g, S, hp) {
  hp = Math.max(1, Math.min(3, hp | 0));
  const m = S * 0.05, w = S - 2 * m, top = m + S * 0.16, H = S - m - top;
  // 投影
  g.fillStyle = 'rgba(10,8,30,0.35)';
  rr(g, m + S * 0.015, m + S * 0.04, w, w, S * 0.2); g.fill();
  // 每一層蛋糕
  g.save();
  rr(g, m, m, w, w, S * 0.2); g.clip();
  const sh = H / hp;
  for (let i = 0; i < hp; i++) {
    const y = S - m - (i + 1) * sh;
    const gr = g.createLinearGradient(0, y, 0, y + sh);
    gr.addColorStop(0, FROST_LAYERS[i]); gr.addColorStop(1, FROST_DARK[i]);
    g.fillStyle = gr; g.fillRect(m, y - 1, w, sh + 2);
    // 夾心的奶油線（波浪）
    if (i > 0 || hp === 1) {
      g.fillStyle = '#fffaf2';
      g.beginPath();
      const yy = y + sh - S * 0.035;
      g.moveTo(m, yy);
      for (let k = 0; k <= 8; k++) g.quadraticCurveTo(m + (k + 0.5) * w / 8, yy + (k % 2 ? -1 : 1) * S * 0.022, m + (k + 1) * w / 8, yy);
      g.lineTo(m + w, yy + S * 0.03); g.lineTo(m, yy + S * 0.03); g.closePath(); g.fill();
    }
  }
  // 最上面的白奶油（往下滴）
  g.fillStyle = '#fffdf8';
  g.beginPath();
  g.moveTo(m, m);
  g.lineTo(m + w, m);
  const base = top + S * 0.03;
  g.lineTo(m + w, base);
  const drips = [[0.86, 0.1], [0.68, 0.17], [0.5, 0.06], [0.32, 0.2], [0.14, 0.09]];
  let px = m + w;
  for (const [k, d] of drips) {
    const x = m + k * w, r = S * 0.055;
    g.quadraticCurveTo((px + x) / 2, base + S * 0.02, x + r, base);
    g.lineTo(x + r, base + d * S); g.arc(x, base + d * S, r, 0, Math.PI); g.lineTo(x - r, base);
    px = x - r;
  }
  g.quadraticCurveTo((px + m) / 2, base + S * 0.02, m, base);
  g.closePath(); g.fill();
  g.restore();
  // 外框 + 左上的亮光
  rr(g, m, m, w, w, S * 0.2);
  g.lineWidth = S * 0.03; g.strokeStyle = 'rgba(70,30,60,0.55)'; g.stroke();
  g.lineWidth = S * 0.018; g.strokeStyle = 'rgba(255,255,255,0.7)';
  g.beginPath(); g.arc(m + S * 0.2, m + S * 0.2, S * 0.14, Math.PI * 1.05, Math.PI * 1.48); g.stroke();
  // 糖珠
  const sp = ['#ff5a7a', '#3fc4ff', '#ffd23a', '#6be07a', '#b07aff'];
  const dots = [[0.24, 0.1], [0.42, 0.075], [0.6, 0.11], [0.78, 0.08], [0.33, 0.15], [0.7, 0.16]];
  dots.forEach(([kx, ky], i) => {
    g.save(); g.translate(m + kx * w, m + ky * S + S * 0.02); g.rotate(i * 1.1);
    g.fillStyle = sp[i % sp.length]; rr(g, -S * 0.03, -S * 0.012, S * 0.06, S * 0.024, S * 0.012); g.fill();
    g.restore();
  });
  // 層數的小圓點（左下角，2 層以上才有）：一眼看出還要敲幾下
  if (hp >= 2) {
    for (let i = 0; i < hp; i++) {
      const x = m + S * 0.13 + i * S * 0.1, y = S - m - S * 0.1;
      g.beginPath(); g.arc(x, y, S * 0.04, 0, Math.PI * 2);
      g.fillStyle = '#ffffff'; g.fill();
      g.lineWidth = S * 0.014; g.strokeStyle = 'rgba(70,30,60,0.6)'; g.stroke();
    }
  }
}

// ---------------- 巧克力：一塊 2×2 的巧克力磚，有凸起的格子、光澤和一滴往下流的巧克力 ----------------
export function paintChoco(g, S) {
  const m = S * 0.05, w = S - 2 * m, r = S * 0.16;
  g.fillStyle = 'rgba(10,8,30,0.35)';
  rr(g, m + S * 0.015, m + S * 0.04, w, w, r); g.fill();
  const body = g.createLinearGradient(0, m, 0, S - m);
  body.addColorStop(0, '#8a4f2b'); body.addColorStop(1, '#4a240f');
  rr(g, m, m, w, w, r); g.fillStyle = body; g.fill();
  // 四塊凸起的格子
  const gap = S * 0.05, cw = (w - gap * 3) / 2;
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
    const x = m + gap + j * (cw + gap), y = m + gap + i * (cw + gap);
    rr(g, x, y, cw, cw, S * 0.06);
    const gr = g.createLinearGradient(x, y, x + cw, y + cw);
    gr.addColorStop(0, '#a5653c'); gr.addColorStop(0.5, '#7a4322'); gr.addColorStop(1, '#552a11');
    g.fillStyle = gr; g.fill();
    g.lineWidth = S * 0.014; g.strokeStyle = 'rgba(255,214,170,0.35)';
    g.beginPath(); g.moveTo(x + S * 0.03, y + cw - S * 0.04); g.lineTo(x + S * 0.03, y + S * 0.03); g.lineTo(x + cw - S * 0.04, y + S * 0.03); g.stroke();
  }
  // 光澤
  g.save();
  rr(g, m, m, w, w, r); g.clip();
  const gl = g.createLinearGradient(m, m, m + w * 0.6, m + w * 0.6);
  gl.addColorStop(0, 'rgba(255,240,220,0.42)'); gl.addColorStop(0.5, 'rgba(255,240,220,0.06)'); gl.addColorStop(1, 'rgba(255,240,220,0)');
  g.fillStyle = gl; g.fillRect(m, m, w, w * 0.6);
  g.restore();
  // 往下滴的一滴
  g.fillStyle = '#5a2c12';
  g.beginPath(); g.moveTo(S * 0.58, S - m - S * 0.02); g.quadraticCurveTo(S * 0.62, S - m + S * 0.06, S * 0.66, S - m - S * 0.02); g.fill();
  g.beginPath(); g.arc(S * 0.62, S - m + S * 0.04, S * 0.03, 0, Math.PI * 2); g.fill();
  rr(g, m, m, w, w, r);
  g.lineWidth = S * 0.026; g.strokeStyle = 'rgba(40,14,4,0.8)'; g.stroke();
}

// ---------------- 甘草漩渦糖：黑色圓糖 + 紫紅色的漩渦紋 + 亮亮的反光 ----------------
export function paintSwirl(g, S) {
  const cx = S / 2, cy = S / 2, R = S * 0.39;
  g.fillStyle = 'rgba(10,8,30,0.4)';
  g.beginPath(); g.ellipse(cx + S * 0.015, cy + S * 0.05, R, R * 0.96, 0, 0, Math.PI * 2); g.fill();
  const body = g.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
  body.addColorStop(0, '#5a4566'); body.addColorStop(0.55, '#2a1f33'); body.addColorStop(1, '#100a16');
  g.fillStyle = body; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
  // 漩渦
  g.lineCap = 'round';
  const spiral = (col, lw, off) => {
    g.strokeStyle = col; g.lineWidth = lw;
    g.beginPath();
    for (let a = 0; a <= Math.PI * 5.2; a += 0.08) {
      const rad = (a / (Math.PI * 5.2)) * R * 0.86, x = cx + Math.cos(a + off) * rad, y = cy + Math.sin(a + off) * rad;
      if (a === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
  };
  spiral('#0a0610', S * 0.075, 0);
  spiral('#c0479a', S * 0.04, 0);
  spiral('rgba(255,170,230,0.55)', S * 0.014, -0.06);
  g.lineWidth = S * 0.022; g.strokeStyle = 'rgba(0,0,0,0.7)';
  g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = S * 0.03;
  g.beginPath(); g.arc(cx, cy, R * 0.78, Math.PI * 1.1, Math.PI * 1.42); g.stroke();
}

// ---------------- 鬧鐘：紅色圓鐘 + 頭上兩個金色鈴鐺，錶面上是還剩幾步（hp）；剩 3 步以下數字變紅 ----------------
const NUM_FONT = '"PlushNum", "GenSenRounded", "Baloo 2", "PingFang TC", system-ui, sans-serif';
export function paintAlarm(g, S, hp = 9) {
  const cx = S / 2, cy = S * 0.54, R = S * 0.33, hot = hp <= 3;
  g.fillStyle = 'rgba(10,8,30,0.35)';
  g.beginPath(); g.ellipse(cx + S * 0.01, cy + R + S * 0.05, R * 0.95, S * 0.06, 0, 0, Math.PI * 2); g.fill();
  // 小腳
  g.fillStyle = '#6a1f35';
  for (const sx of [-1, 1]) {
    g.beginPath(); g.ellipse(cx + sx * R * 0.62, cy + R * 0.98, S * 0.06, S * 0.035, sx * 0.5, 0, Math.PI * 2); g.fill();
  }
  // 鈴鐺和中間的小槌子
  g.lineWidth = S * 0.035; g.strokeStyle = '#6a1f35'; g.lineCap = 'round';
  g.beginPath(); g.moveTo(cx, cy - R * 1.02); g.lineTo(cx, cy - R * 1.22); g.stroke();
  for (const sx of [-1, 1]) {
    const bx = cx + sx * R * 0.68, by = cy - R * 0.86;
    g.save(); g.translate(bx, by); g.rotate(sx * 0.55);
    const bg = g.createRadialGradient(-S * 0.03, -S * 0.04, S * 0.01, 0, 0, S * 0.13);
    bg.addColorStop(0, '#fff3b0'); bg.addColorStop(0.5, '#ffc93a'); bg.addColorStop(1, '#d98a00');
    g.fillStyle = bg;
    g.beginPath(); g.arc(0, 0, S * 0.12, Math.PI, 0); g.lineTo(S * 0.12, S * 0.02); g.lineTo(-S * 0.12, S * 0.02); g.closePath(); g.fill();
    g.lineWidth = S * 0.022; g.strokeStyle = '#7a4a00'; g.stroke();
    g.restore();
  }
  // 鐘身
  const body = g.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R * 1.05);
  body.addColorStop(0, '#ff9ab0'); body.addColorStop(0.55, '#ff4f78'); body.addColorStop(1, '#c4224d');
  g.fillStyle = body; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
  g.lineWidth = S * 0.03; g.strokeStyle = '#6a1f35'; g.stroke();
  // 錶面和刻度
  const F = R * 0.76;
  const face = g.createRadialGradient(cx - F * 0.3, cy - F * 0.3, F * 0.1, cx, cy, F);
  face.addColorStop(0, '#ffffff'); face.addColorStop(1, hot ? '#ffd6df' : '#fff1e6');
  g.fillStyle = face; g.beginPath(); g.arc(cx, cy, F, 0, Math.PI * 2); g.fill();
  g.lineWidth = S * 0.016; g.strokeStyle = 'rgba(106,31,53,0.45)'; g.stroke();
  g.fillStyle = 'rgba(106,31,53,0.5)';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.beginPath(); g.arc(cx + Math.cos(a) * F * 0.84, cy + Math.sin(a) * F * 0.84, S * (i % 3 ? 0.01 : 0.016), 0, Math.PI * 2); g.fill();
  }
  // 還剩幾步
  const txt = String(Math.max(0, hp | 0));
  g.font = `900 ${Math.round(S * (txt.length > 1 ? 0.3 : 0.36))}px ${NUM_FONT}`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineJoin = 'round'; g.lineWidth = S * 0.04; g.strokeStyle = '#ffffff';
  g.strokeText(txt, cx, cy + S * 0.012);
  g.fillStyle = hot ? '#e8173f' : '#5a2440';
  g.fillText(txt, cx, cy + S * 0.012);
  // 左上的亮光
  g.lineWidth = S * 0.025; g.strokeStyle = 'rgba(255,255,255,0.8)';
  g.beginPath(); g.arc(cx, cy, R * 0.9, Math.PI * 1.08, Math.PI * 1.38); g.stroke();
}

// ---------------- 龍龍出口：綠色往下的箭頭（S = 箭頭大小）----------------
export function paintExitArrow(g, S) {
  const pts = [[0.5, 0.92], [0.94, 0.42], [0.68, 0.42], [0.68, 0.08], [0.32, 0.08], [0.32, 0.42], [0.06, 0.42]].map(([x, y]) => [x * S, y * S]);
  const path = () => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); };
  g.lineJoin = 'round';
  path(); g.lineWidth = S * 0.14; g.strokeStyle = '#0b5a2a'; g.stroke();
  const gr = g.createLinearGradient(0, 0, 0, S);
  gr.addColorStop(0, '#b8ff9a'); gr.addColorStop(0.5, '#4fe06e'); gr.addColorStop(1, '#16a84a');
  path(); g.fillStyle = gr; g.fill();
  g.lineWidth = S * 0.05; g.strokeStyle = '#ffffff'; g.stroke();
}

// 傳送門一對一個顏色（入口在那一格的下緣、出口在另一格的上緣）
export const PORTAL_COLORS = ['#38d9ff', '#ff5ad6', '#ffd23a', '#7dff6a'];

// 碎屑的顏色
export const CRUMBS = {
  frost: hp => [FROST_LAYERS[Math.max(0, Math.min(2, hp - 1))], '#fffdf8', '#ffe6f0'],
  choco: () => ['#8a4f2b', '#5a2c12', '#c48a5c'],
  licorice: () => ['#2a1f33', '#c0479a', '#5a4566'],
  alarm: () => ['#ff4f78', '#ffc93a', '#ffffff'],
  cage: () => ['#ffffff', '#c6cfdb', '#ffd24a'],
};

// 傳送門（教學小卡用）：上面一個入口、下面一個出口，中間一顆玩偶色的小球穿過去
export function paintPortalIcon(g, S, hex = PORTAL_COLORS[0]) {
  const ring = (y, a) => {
    g.save(); g.globalAlpha = a;
    const gl = g.createRadialGradient(S / 2, y, S * 0.02, S / 2, y, S * 0.45);
    gl.addColorStop(0, hex); gl.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gl; g.fillRect(0, y - S * 0.25, S, S * 0.5);
    g.restore();
    g.beginPath(); g.ellipse(S / 2, y, S * 0.38, S * 0.11, 0, 0, Math.PI * 2);
    g.fillStyle = 'rgba(14,8,40,0.9)'; g.fill();
    g.lineWidth = S * 0.06; g.strokeStyle = hex; g.stroke();
    g.lineWidth = S * 0.02; g.strokeStyle = 'rgba(255,255,255,0.9)'; g.stroke();
  };
  ring(S * 0.3, 0.6);
  ring(S * 0.78, 0.6);
  // 往下的小箭頭
  g.fillStyle = '#ffffff';
  for (const y of [S * 0.44, S * 0.56]) { g.beginPath(); g.moveTo(S * 0.42, y); g.lineTo(S * 0.58, y); g.lineTo(S / 2, y + S * 0.07); g.closePath(); g.fill(); }
}

// ---------------- 訂單目標的小圖：條紋方塊 / 包裝糖 / 彩色炸彈 / 飛天玩偶；組合 = 兩個疊在一起 ----------------
const ORDER_COL = { stripe: ['#ffb3d4', '#ff5f9e'], wrap: ['#ffe28a', '#ff9f1c'], fish: ['#b8f0ff', '#3fb6ff'] };
function paintOrderOne(g, S, what) {
  const cx = S / 2, cy = S / 2;
  if (what === 'bomb') {
    const R = S * 0.36;
    const body = g.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
    body.addColorStop(0, '#6b4b2e'); body.addColorStop(1, '#2b170b');
    g.fillStyle = body; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
    const dots = ['#ff4d6d', '#ffd23a', '#4fe06e', '#38d9ff', '#b26bff', '#ff9f1c'];
    for (let i = 0; i < 12; i++) {
      const a = i * 2.4, rad = R * (0.25 + 0.55 * ((i * 37) % 10) / 10);
      g.fillStyle = dots[i % dots.length];
      g.beginPath(); g.arc(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, S * 0.045, 0, Math.PI * 2); g.fill();
    }
    g.lineWidth = S * 0.03; g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
    return;
  }
  const [hi, lo] = ORDER_COL[what] || ORDER_COL.stripe;
  const w = S * 0.6, x = cx - w / 2, y = cy - w / 2;
  if (what === 'wrap') {
    // 糖果紙的兩端
    g.fillStyle = lo;
    for (const d of [-1, 1]) {
      g.beginPath(); g.moveTo(cx + d * w * 0.42, cy); g.lineTo(cx + d * S * 0.48, cy - S * 0.17); g.lineTo(cx + d * S * 0.48, cy + S * 0.17); g.closePath(); g.fill();
    }
  }
  if (what === 'fish') {
    g.fillStyle = '#ffffff';
    for (const d of [-1, 1]) { g.beginPath(); g.ellipse(cx + d * w * 0.55, cy - S * 0.1, S * 0.15, S * 0.08, d * -0.5, 0, Math.PI * 2); g.fill(); }
  }
  const gr = g.createLinearGradient(0, y, 0, y + w);
  gr.addColorStop(0, hi); gr.addColorStop(1, lo);
  rr(g, x, y, w, w, S * 0.14); g.fillStyle = gr; g.fill();
  if (what === 'stripe') {
    g.save(); rr(g, x, y, w, w, S * 0.14); g.clip();
    g.fillStyle = 'rgba(255,255,255,0.92)';
    for (let i = 0; i < 3; i++) g.fillRect(x, y + w * (0.18 + i * 0.27), w, w * 0.11);
    g.restore();
  }
  if (what === 'wrap') {
    g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = S * 0.035;
    rr(g, x + S * 0.06, y + S * 0.06, w - S * 0.12, w - S * 0.12, S * 0.1); g.stroke();
  }
  g.lineWidth = S * 0.03; g.strokeStyle = 'rgba(60,20,40,0.55)';
  rr(g, x, y, w, w, S * 0.14); g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.beginPath(); g.ellipse(x + w * 0.3, y + w * 0.22, w * 0.14, w * 0.07, -0.5, 0, Math.PI * 2); g.fill();
}
export function paintOrder(g, S, what) {
  if (what === 'combo' || what.includes('+')) {
    const [a, b] = what === 'combo' ? ['stripe', 'wrap'] : what.split('+');
    g.save(); g.translate(-S * 0.14, -S * 0.1); g.scale(0.78, 0.78); g.translate(S * 0.06, S * 0.06); paintOrderOne(g, S, a); g.restore();
    g.save(); g.translate(S * 0.24, S * 0.26); g.scale(0.72, 0.72); paintOrderOne(g, S, b); g.restore();
    // 中間的閃光
    g.fillStyle = '#fff6a8'; g.strokeStyle = '#ff9f1c'; g.lineWidth = S * 0.02;
    g.beginPath();
    for (let i = 0; i < 8; i++) { const a2 = i * Math.PI / 4, r2 = i % 2 ? S * 0.05 : S * 0.13; g.lineTo(S * 0.55 + Math.cos(a2) * r2, S * 0.45 + Math.sin(a2) * r2); }
    g.closePath(); g.fill(); g.stroke();
    return;
  }
  paintOrderOne(g, S, what);
}

// DOM 用的小圖（目標圖示、教學小卡）：type = 'cage' | 'frost' | 'frost2' | 'frost3' | 'choco' | 'swirl' | 'exit' | 'portal' | 'o-<訂單>'
export function blockerCanvas(type, px) {
  const c = document.createElement('canvas');
  c.width = c.height = Math.max(8, Math.round(px));
  const g = c.getContext('2d'), S = c.width;
  if (type === 'cage') {
    // 籠子裡放一顆淡淡的圓，看得出是「關住一隻玩偶」
    const gr = g.createRadialGradient(S * 0.45, S * 0.42, S * 0.05, S / 2, S / 2, S * 0.4);
    gr.addColorStop(0, '#ffe3f0'); gr.addColorStop(1, '#ff8fbf');
    g.fillStyle = gr; g.beginPath(); g.arc(S / 2, S / 2, S * 0.34, 0, Math.PI * 2); g.fill();
    paintCage(g, S);
  } else if (type.startsWith('frost')) paintFrost(g, S, +(type.slice(5) || 1));
  else if (type === 'choco') paintChoco(g, S);
  else if (type === 'swirl') paintSwirl(g, S);
  else if (type === 'alarm') paintAlarm(g, S, 9);
  else if (type === 'exit') paintExitArrow(g, S);
  else if (type === 'portal') paintPortalIcon(g, S);
  else if (type.startsWith('o-')) paintOrder(g, S, type.slice(2));
  return c;
}
