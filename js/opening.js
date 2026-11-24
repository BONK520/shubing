// 開頭動畫（約 7.5 秒）：蛋蛋碼頭沿著路往上滑 → 拉遠成整座島 → 「薯餅蛋蛋島」一個字一個字彈進來、三隻娃娃跳一下
// → 標題後面的立體雲脹大蓋滿畫面，再往四周散開，露出封面。
// 要不要播是 index.html <head> 裡的小程式決定的（window.__opPlay）；這裡只負責畫和播，跟主程式的載入同時進行。
// 不放聲音；點一下或按任何鍵就跳過。只用 transform / opacity 動畫，地圖只畫前 22 關（3 站）。
import { mapArtHTML, mapSignsHTML, mapStations, stationAt, islandMiniHTML, prefixIds } from './mapart.js?v=20261124u';

const KEY = 'shubing-op';
const today = () => { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
function readOp() { try { return JSON.parse(localStorage.getItem(KEY) || 'null') || {}; } catch (e) { return {}; } }
function writeOp(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { /* 無痕模式：不記，下次照樣播 */ } }
// 設定裡的「每次都播開頭動畫」（預設關）
export function getOpAlways() { return !!readOp().always; }
export function setOpAlways(v) { const o = readOp(); o.always = !!v; writeOp(o); }

// 跟 main.js 地圖同一條路（nodePos / smoothPath），只是自己算，不等主程式
const GAP = 116, TOP = 150, BOT = 110, N = 22;
const nodeXY = (i, H) => ({ x: 50 + 27 * Math.sin(i * 1.05 + 0.4), y: H - BOT - i * GAP });
function smooth(pts) {
  let d = `M${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    d += ` C${(p1.x + (p2.x - p0.x) / 6).toFixed(2)} ${(p1.y + (p2.y - p0.y) / 6).toFixed(1)} ${(p2.x - (p3.x - p1.x) / 6).toFixed(2)} ${(p2.y - (p3.y - p1.y) / 6).toFixed(1)} ${p2.x.toFixed(2)} ${p2.y.toFixed(1)}`;
  }
  return d;
}
// 某個高度的底色（橫向寬螢幕時，地圖兩邊用這個顏色補滿）
const hex = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
function colorAt(st, y) {
  const r = stationAt(st, y), f = Math.max(0, Math.min(1, (r.bottom - y) / (r.bottom - r.top)));
  const s = r.stops; let k = 0;
  while (k < s.length - 2 && s[k + 1][0] < f) k++;
  const [o0, c0] = s[k], [o1, c1] = s[k + 1], t = o1 > o0 ? Math.max(0, Math.min(1, (f - o0) / (o1 - o0))) : 0;
  const a = hex(c0), b = hex(c1);
  return 'rgb(' + a.map((v, j) => Math.round(v + (b[j] - v) * t)).join(',') + ')';
}

const T1 = 3000, T2 = 1900, T3 = 1500, T4 = 1200;           // 四段的長度（毫秒）
const S2 = T1, S3 = T1 + T2, S4 = S3 + T3, END = S4 + T4;    // 每段開始的時間
const SEA = '#8fd3ef';
const TRIO = ['dog', 'sloth', 'egg'];                         // 皮蛋、薯餅、蛋黃哥（跟封面同三隻）

let root = null, anims = [], bgAnims = [], timers = [], done = false;
const later = (ms, fn) => timers.push(setTimeout(fn, ms));
const anim = (node, kf, o) => { const a = node.animate(kf, Object.assign({ fill: 'both' }, o)); anims.push(a); return a; };

function finish(fade) {
  if (done) return; done = true;
  timers.forEach(clearTimeout); timers = [];
  window.removeEventListener('pointerdown', onSkip, true);
  window.removeEventListener('keydown', onSkip, true);
  document.documentElement.classList.remove('op-playing');
  const r = root; root = null;
  const kill = () => { anims.forEach(a => { try { a.cancel(); } catch (e) {} }); anims = []; if (r) r.remove(); };
  if (fade && r) {
    // 淡出的時候還擋著點擊，跳過的那一下才不會按到封面的按鈕
    r.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: 'ease-out', fill: 'forwards' }).finished.then(kill, kill);
    setTimeout(kill, 600);
  } else kill();
  window.dispatchEvent(new Event('opening-end'));
}
function onSkip(e) {
  if (e.type === 'keydown') { e.preventDefault(); e.stopPropagation(); }
  finish(true);
}

function start() {
  const html = document.documentElement;
  window.__opStarted = true;
  const o = readOp(); o.d = today(); writeOp(o);              // 記今天播過了
  const vw = innerWidth, vh = innerHeight;
  const app = document.getElementById('app');
  const W = Math.round((app && app.clientWidth) || Math.min(vw, 520));
  const H = TOP + (N - 1) * GAP + BOT;
  const st = mapStations(N, H);

  root = document.createElement('div');
  root.className = 'op';
  root.setAttribute('aria-hidden', 'true');
  // 第 1 段：前 22 關的地圖（碼頭 → 毛毛村 → 果樹林），整條往下移，看起來像鏡頭往上滑
  const pts = Array.from({ length: N }, (_, i) => nodeXY(i, H));
  const road = smooth(pts);
  const paths = [['road-shadow', 12], ['road-side', 7], ['road-edge', 0], ['road', 0], ['road-hi', -5], ['road-dots', 0], ['road-dots-hi', -1.6]]
    .map(([c, dy]) => `<path class="${c}" d="${road}"${dy ? ` transform="translate(0 ${dy})"` : ''}/>`).join('');
  const nodes = pts.map((p, i) => `<span class="node op-node" style="left:${p.x}%;top:${p.y}px"><span class="num">${i + 1}</span></span>`).join('');
  root.innerHTML =
    `<div class="op-stage" style="width:${W}px;margin-left:${-W / 2}px"><div class="op-strip" style="height:${H}px">`
    + `<div class="map-art">${prefixIds(mapArtHTML(W, N, H), 'op-')}</div>`
    + `<svg class="map-path" viewBox="0 0 100 ${H}" preserveAspectRatio="none" style="height:${H}px">${paths}</svg>`
    + mapSignsHTML(N, H, N + 1) + nodes + `</div></div>`
    + `<div class="op-island">${islandMiniHTML(vw, vh, 'oi-', N)}</div>`
    + `<div class="op-title"></div><div class="op-white"></div><div class="op-burst"></div>`
    + `<span class="op-skip">略過</span>`;
  document.body.appendChild(root);
  html.classList.add('op-playing');
  html.classList.remove('op-pending');

  const strip = root.querySelector('.op-strip'), stage = root.querySelector('.op-stage'), island = root.querySelector('.op-island');
  const ease1 = 'cubic-bezier(.42,0,.36,1)';
  // 鏡頭往上滑（路在碼頭先停一下下，再慢慢加速、到果樹林慢下來）
  anim(strip, [{ transform: `translate3d(0,${vh - H}px,0)` }, { transform: 'translate3d(0,0,0)' }], { duration: T1, easing: ease1 });
  // 寬螢幕兩邊的底色跟著畫面中間那一站變
  const bg = [];
  for (let k = 0; k <= 12; k++) { const p = k / 12; bg.push({ offset: p, backgroundColor: colorAt(st, vh / 2 + (H - vh) * (1 - p)) }); }
  // 同一個元素有兩段動畫時，後面那段只用 forwards（用 both 的話，等待的時候會蓋掉前一段）
  bgAnims.push(anim(root, bg, { duration: T1, easing: ease1 }));
  bgAnims.push(anim(root, [{ backgroundColor: bg[12].backgroundColor }, { backgroundColor: SEA }], { delay: S2, duration: 700, fill: 'forwards' }));
  // 第 2 段：地圖縮小淡掉，整座島從近拉到遠
  anim(stage, [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(.55)', opacity: 0 }], { delay: S2, duration: 650, easing: 'ease-in' });
  anim(island, [{ transform: 'scale(2.6)', opacity: 0 }, { transform: 'scale(2.1)', opacity: 1, offset: .25 }, { transform: 'scale(1)', opacity: 1 }],
    { delay: S2 + 150, duration: T2 - 150, easing: 'cubic-bezier(.3,.1,.25,1)' });

  later(S3 - 120, () => titleSeg(vw, vh));
  later(END, () => finish(false));
  window.addEventListener('pointerdown', onSkip, true);
  window.addEventListener('keydown', onSkip, true);
}

// 第 3、4 段：標題要跟封面上的標題疊在同一個位置，雲散開時才接得起來，所以到這時候才量封面標題的位置
function titleSeg(vw, vh) {
  if (!root) return;
  const box = root.querySelector('.op-title'), white = root.querySelector('.op-white'), burst = root.querySelector('.op-burst');
  const src = document.querySelector('#scr-title .logo');
  const r = src ? src.getBoundingClientRect() : { left: vw * .1, top: vh * .14, width: vw * .8, height: vw * .25 };
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  // 標題後面的立體雲
  const cw = Math.min(vw * .98, r.width * 1.3), ch = cw * .525;
  const cloud = document.createElement('div');
  cloud.className = 'op-cloud';
  Object.assign(cloud.style, { width: cw + 'px', height: ch + 'px', left: (cx - cw / 2) + 'px', top: (cy - ch * .56) + 'px' });
  box.appendChild(cloud);
  // 標題：複製封面上那一個（同樣的字、顏色、大小）
  let logo = null;
  if (src) {
    logo = src.cloneNode(true);
    logo.removeAttribute('id');
    logo.classList.add('op-logo');
    Object.assign(logo.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', fontSize: getComputedStyle(src).fontSize });
    box.appendChild(logo);
  }
  // 三隻娃娃站在標題下面
  const sz = Math.round(Math.min(78, vw * .19));
  const trio = document.createElement('div');
  trio.className = 'op-trio';
  Object.assign(trio.style, { left: cx + 'px', top: Math.min(vh - sz - 40, r.top + r.height + 18) + 'px' });
  trio.innerHTML = TRIO.map(id => `<img src="assets/sprites/${id}_n.png" alt="" draggable="false" style="width:${sz}px;height:${sz}px">`).join('');
  box.appendChild(trio);

  const t0 = 120;
  anim(cloud, [{ transform: 'scale(.2)', opacity: 0 }, { transform: 'scale(1.08)', opacity: 1, offset: .65 }, { transform: 'scale(1)', opacity: 1 }], { delay: t0, duration: 420, easing: 'ease-out' });
  if (logo) logo.querySelectorAll('.ch').forEach((c, i) => {
    const rot = `rotate(${getComputedStyle(c).getPropertyValue('--rot').trim() || '0deg'})`;   // 每個字本來就歪一點，彈的時候也要保留
    anim(c, [{ transform: `${rot} translateY(-.5em) scale(.2)`, opacity: 0 }, { transform: `${rot} translateY(.05em) scale(1.22)`, opacity: 1, offset: .6 }, { transform: rot, opacity: 1 }],
      { delay: t0 + 220 + i * 95, duration: 380, easing: 'ease-out' });
  });
  trio.querySelectorAll('img').forEach((im, i) => {
    anim(im, [{ transform: 'translateY(30%) scale(.6)', opacity: 0 }, { transform: 'translateY(0) scale(1)', opacity: 1, offset: .3 }, { transform: 'translateY(-34%) scale(1.04,.96)', offset: .62 }, { transform: 'translateY(0) scale(1)', opacity: 1 }],
      { delay: t0 + 760 + i * 110, duration: 520, easing: 'ease-out' });
  });

  // 第 4 段：雲脹大蓋滿畫面
  const d4 = S4 - S3 + 120;
  // 雲一邊脹大一邊往畫面中間移，才蓋得到下半部（只在原地放大的話，雲的平底會在畫面中間留一條直線）
  const dy = vh / 2 - cy;
  const big = 1.3 * Math.max((vh / 2) / (ch * .44), vw / cw);
  anim(cloud, [{ transform: 'translate(0,0) scale(1)' }, { transform: `translate(0,${dy}px) scale(${big})` }], { delay: d4, duration: 460, easing: 'cubic-bezier(.45,0,.55,1)', fill: 'forwards' });
  // 雲底下再接一朵倒過來的雲，脹大時下緣是一球一球的圓弧，不會是一條直線
  const under = document.createElement('i');
  cloud.appendChild(under);
  anim(under, [{ opacity: 0 }, { opacity: 1 }], { delay: d4, duration: 120 });
  [logo, trio].forEach(n => n && anim(n, [{ opacity: 1 }, { opacity: 0 }], { delay: d4 + 180, duration: 200 }));
  anim(white, [{ opacity: 0 }, { opacity: 1 }], { delay: d4 + 250, duration: 210, easing: 'ease-in' });
  // 蓋滿之後：底下的地圖和島拿掉、露出封面，九朵雲往四周散開、白色慢慢退掉
  const d5 = d4 + 460;
  later(d5, () => {                                           // titleSeg 本身在 S3-120 才開始，這裡只算從現在起的時間
    if (!root) return;
    root.classList.add('op-reveal');
    bgAnims.forEach(a => a.cancel()); bgAnims = [];
    [root.querySelector('.op-stage'), root.querySelector('.op-island'), cloud].forEach(n => n && (n.style.visibility = 'hidden'));
    const pw = Math.max(vw * .8, 240), ph = pw * .525;
    for (let i = 0; i < 9; i++) {
      const gx = i % 3 - 1, gy = Math.floor(i / 3) - 1;
      const x = vw / 2 + gx * vw * .36, y = vh / 2 + gy * vh * .34;
      const p = document.createElement('i');
      Object.assign(p.style, { width: pw + 'px', height: ph + 'px', left: (x - pw / 2) + 'px', top: (y - ph / 2) + 'px' });
      burst.appendChild(p);
      const dx = (gx || (i % 2 ? .25 : -.25)) * vw * .75, dy = (gy || (i % 2 ? -.2 : .2)) * vh * .6;
      anim(p, [{ transform: 'scale(1.7)', opacity: 1 }, { transform: `translate(${dx}px,${dy}px) scale(2.3)`, opacity: 0 }],
        { duration: 600 + (i % 3) * 40, easing: 'cubic-bezier(.2,.6,.35,1)' });
    }
    anim(white, [{ opacity: 1 }, { opacity: 0 }], { duration: 380, easing: 'ease-out' });
  });
}

if (window.__opPlay && !window.__opLate) {
  try { start(); } catch (e) { console.warn('開頭動畫沒有播', e); document.documentElement.classList.remove('op-pending'); finish(false); }
}
