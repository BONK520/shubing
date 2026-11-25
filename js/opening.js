// 開頭動畫（375×812 約 15 秒）：
// 1. 從碼頭沿著路慢慢捲到最上面一站，關卡捲到畫面 58% 那條線時一顆一顆亮起來，三隻小鳥飛過；底色跟著畫面中間那一站慢慢混色
// 2. 地圖慢慢拉遠、淡掉，露出海上的小島（帆船、海鷗、跳魚、燈塔），島上的角色和小屋一個個長出來，小泡泡往上飄
// 3. 標題的五顆蛋搖一搖、裂開、字跳出來，旁邊冒四角星；字跳完三隻娃娃才出場，各自表演
// 4. 標題後面的立體雲脹大蓋滿畫面，九朵雲一朵一朵在原地縮小淡掉，露出封面
// 減暈（工作單13、23）：捲動最快每秒 0.37 個螢幕高（不比工作單13那版快），底色每次換色至少 1 秒，同一時間只有一種縮放，雲不往外爆開。
// 要不要播是 index.html <head> 裡的小程式決定的（window.__opPlay；減少動態效果不播）；這裡只負責畫和播，跟主程式的載入同時進行。
// 不放聲音；點一下或按任何鍵就跳過。只用 transform / opacity / 背景色動畫，地圖只畫前 22 關（3 站）。
import { mapArtHTML, mapSignsHTML, mapStations, stationAt, islandMiniHTML, prefixIds } from './mapart.js?v=20261124zu';

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
// 某個高度的底色（橫向寬螢幕時，地圖兩邊用這個顏色補滿；拉遠時也看得到）
const hex = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
function rgbAt(st, y) {
  const r = stationAt(st, y), f = Math.max(0, Math.min(1, (r.bottom - y) / (r.bottom - r.top)));
  const s = r.stops; let k = 0;
  while (k < s.length - 2 && s[k + 1][0] < f) k++;
  const [o0, c0] = s[k], [o1, c1] = s[k + 1], t = o1 > o0 ? Math.max(0, Math.min(1, (f - o0) / (o1 - o0))) : 0;
  const a = hex(c0), b = hex(c1);
  return a.map((v, j) => v + (b[j] - v) * t);
}
const css = c => 'rgb(' + c.map(v => Math.round(v)).join(',') + ')';

// 捲動曲線 cubic-bezier(.3,.3,.6,1)：一開始就在動、慢慢停下來
const EASE1 = 'cubic-bezier(.3,.3,.6,1)';
const bx = s => 3 * (1 - s) * (1 - s) * s * .3 + 3 * (1 - s) * s * s * .6 + s * s * s;
const by = s => 3 * (1 - s) * (1 - s) * s * .3 + 3 * (1 - s) * s * s * 1 + s * s * s;
const solve = (f, v) => { let lo = 0, hi = 1; for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (f(m) < v) lo = m; else hi = m; } return (lo + hi) / 2; };
const ease1 = t => by(solve(bx, t));              // 時間比例 → 捲動進度
const bezT = e => bx(solve(by, e));               // 捲動進度 → 時間比例
// 曲線最陡的地方是平均速度的幾倍（約 1.43）
const PEAK = (() => { let m = 0; for (let k = 0; k < 400; k++) { const s0 = k / 400, s1 = (k + 1) / 400; m = Math.max(m, (by(s1) - by(s0)) / (bx(s1) - bx(s0))); } return m; })();
const MAXV = .37;                                 // 最快每秒幾個螢幕高（工作單23 上限 0.38，留一點餘裕）
const MIX = 1000;                                 // 底色換色至少花多久（毫秒；工作單23 下限 800）

const T2 = 1800, T4 = 1800;                       // 第 2 段（拉遠，最短）、第 4 段（雲蓋滿＋啵掉）
const HOLD = 1200;                                // 島完全出現後至少停多久才接標題（工作單30）
const t0 = 120;                                   // 第 3 段裡，雲出現的時間
// 第 3 段：五顆蛋孵完（最後一顆的字 t0+200+4*110+720 開始跳、360ms 跳完）三隻才出場，各自表演完再接第 4 段
const HATCH_END = t0 + 200 + 4 * 110 + 720 + 360;
const TS = HATCH_END - (t0 + 700);                // 三隻比樣張晚多久出場
const TRIO_END = t0 + 1250 + TS + 900;            // 最晚演完的是薯餅搖一搖
const T3 = Math.max(1200, TRIO_END - 270);
const SEA = '#8fd3ef';
const TRIO = ['dog', 'sloth', 'egg'];             // 皮蛋、薯餅、蛋黃哥（跟封面同三隻）
const SVGNS = 'http://www.w3.org/2000/svg';

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

// ---- 地圖拉遠時，小島四周的海 ----
// 遠方小島、燈塔、浪花畫在地圖下面（地圖縮小淡掉才露出來）；帆船、海鷗、跳魚畫在小島上面
function seaUnderHTML(vw, vh) {
  const P = (x, y) => [Math.round(vw * x), Math.round(vh * y)];
  let s = `<svg class="op-sea" viewBox="0 0 ${vw} ${vh}" preserveAspectRatio="none"><defs><radialGradient id="op-lh"><stop offset="0" stop-color="#fff7c2" stop-opacity=".95"/><stop offset="1" stop-color="#fff7c2" stop-opacity="0"/></radialGradient></defs>`;
  // 遠方的小島（淺海圈、沙、草、一棵小椰子樹）
  const islet = (x, y, r, tree) => {
    let g = `<g transform="translate(${x} ${y})"><ellipse rx="${r + 9}" ry="${(r + 9) * .42}" fill="#b8e6f4"/><ellipse rx="${r}" ry="${r * .4}" fill="#fbe3b4"/><ellipse cy="${-r * .06}" rx="${r * .72}" ry="${r * .26}" fill="#cdeeb4"/>`;
    if (tree) g += `<path d="M${-r * .2} ${-r * .08}q2 -14 -1 -24" stroke="#b9875a" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M${-r * .2 - 1} ${-r * .08 - 24}c-8 -4 -14 0 -15 5M${-r * .2 - 1} ${-r * .08 - 24}c8 -5 14 -1 15 4M${-r * .2 - 1} ${-r * .08 - 24}c-3 -7 2 -11 6 -11" stroke="#6fbf73" stroke-width="3.2" fill="none" stroke-linecap="round"/>`;
    return g + `</g>`;
  };
  let [x, y] = P(.2, .075); s += islet(x, y, 26, true);
  [x, y] = P(.9, .12); s += islet(x, y, 13, false);
  [x, y] = P(.79, .935); s += islet(x, y, 30, false);
  // 燈塔（在右下的小島上），光慢慢明暗
  s += `<g transform="translate(${x + 8} ${y - 4})"><circle class="op-lhglow" cy="-30" r="22" fill="url(#op-lh)"/><path d="M-6 0L-4 -26H4L6 0Z" fill="#fff"/><path d="M-5.4 -8H5.4M-4.6 -18H4.6" stroke="#ff8fa3" stroke-width="4"/><rect x="-5" y="-33" width="10" height="7" rx="2" fill="#ffe27a"/><path d="M-6 -33L0 -40L6 -33Z" fill="#ff8fa3"/></g>`;
  // 浪花：白色小弧線，輪流淡入淡出
  [[.06, .04], [.52, .035], [.95, .05], [.42, .1], [.05, .96], [.38, .975], [.6, .93], [.96, .97], [.04, .5], [.97, .42], [.03, .3], [.97, .7]].forEach(([a, b], k) => {
    const [wx, wy] = P(a, b);
    s += `<path class="op-wave" style="animation-delay:${-(k * 370) % 2400}ms" d="M${wx - 9} ${wy}q4.5 -4 9 0q4.5 -4 9 0" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>`;
  });
  return s + `</svg>`;
}
function seaLife(vw, vh, S2, pull, island) {
  const svg = island.querySelector('svg');
  // 小島整張縮成 .84、四周空出海面：拿掉鋪滿的海色，讓底下的海景透出來；overflow 打開，3D 雲才不會被切平
  const bgRect = svg && [...svg.children].find(n => n.tagName === 'rect' && n.getAttribute('fill') === SEA);
  if (bgRect) bgRect.remove();
  // 橫向螢幕高度不夠、44 站的色帶會太細，就不縮（左右本來就空很多，海上的小東西碰不到島）
  if (svg) { svg.style.transform = vw > vh ? 'none' : 'scale(.84)'; svg.style.overflow = 'visible'; }
  const sea = root.querySelector('.op-sea'), over = root.querySelector('.op-seaover');
  anim(sea, [{ opacity: 0 }, { opacity: 1 }], { delay: S2 + (pull ? 0 : 150), duration: 700, easing: 'ease-out' });
  anim(over, [{ opacity: 0 }, { opacity: 1 }], { delay: S2 + 250, duration: 600, easing: 'ease-out' });
  const add = (h, x, y) => { const d = document.createElement('div'); d.className = 'op-thing'; d.innerHTML = h; over.appendChild(d); const v = d.firstChild; d.style.left = (x - (+v.getAttribute('width') || 0) / 2) + 'px'; d.style.top = (y - (+v.getAttribute('height') || 0) / 2) + 'px'; return d; };
  // 兩艘帆船：慢慢漂、上下浮
  const sail = (hull, sail2) => `<svg viewBox="-22 -36 44 44" width="40" height="40"><path d="M-18 -8H18L12 2H-12Z" fill="${hull}"/><path d="M-16 -6.5H16" stroke="#fff" stroke-width="2" stroke-linecap="round"/><path d="M0 -8V-34" stroke="#a5657f" stroke-width="2"/><path d="M2 -33L16 -11H2Z" fill="#fff"/><path d="M-2 -29L-12 -11H-2Z" fill="${sail2}"/></svg>`;
  [[sail('#ffb36b', '#ffe9d1'), .1, .9, 26, 5200], [sail('#ff8fb8', '#ffe9f1'), .66, .045, -22, 6000]].forEach(([h, a, b, dx, dur], k) => {
    const d = add(h, vw * a, vh * b), inner = d.firstChild;
    anim(d, [{ transform: 'translateX(0)' }, { transform: `translateX(${dx}px)` }], { delay: S2, duration: dur, easing: 'ease-in-out' });
    anim(inner, [{ transform: 'translateY(-2px) rotate(-3deg)' }, { transform: 'translateY(2px) rotate(3deg)' }], { duration: 1300 + k * 200, direction: 'alternate', iterations: Infinity, easing: 'ease-in-out' });
  });
  // 兩隻海鷗：慢慢從右邊飛到左邊
  [[.035, 200, 1], [.075, 650, .75]].forEach(([b, d, sc], k) => {
    const g = document.createElement('div'); g.className = 'op-bird op-gull';
    g.innerHTML = `<svg viewBox="0 0 24 12" width="${Math.round(26 * sc)}" height="${Math.round(13 * sc)}"><g><path d="M1 7 Q6 1 12 7 Q18 1 23 7"/></g></svg>`;
    g.style.top = (vh * b) + 'px'; over.appendChild(g);
    anim(g, [{ transform: `translate(${vw + 30}px,0)` }, { transform: `translate(${vw * .5}px,8px)`, offset: .5 }, { transform: 'translate(-40px,2px)' }], { delay: S2 + d, duration: 3600 + k * 400, easing: 'linear' });
    anim(g.querySelector('g'), [{ transform: 'scaleY(1)' }, { transform: 'scaleY(-.5)' }], { duration: 320, direction: 'alternate', iterations: Infinity, easing: 'ease-in-out' });
  });
  // 小魚跳出水面，落下有一圈水花
  [[.42, .945, 900], [.88, .3, 1700]].forEach(([a, b, t]) => {
    const x = vw * a, y = vh * b;
    const fish = add(`<svg viewBox="-12 -7 24 14" width="20" height="12"><path d="M-8 0q6 -7 14 0q-8 7 -14 0Z" fill="#ff9f6b"/><path d="M-8 0l-4 -4v8Z" fill="#ff9f6b"/><circle cx="3" cy="-1" r="1.2" fill="#3b2f45"/></svg>`, x, y);
    const ringSvg = '<svg viewBox="-14 -5 28 10" width="28" height="10"><ellipse rx="12" ry="3.5" fill="none" stroke="#fff" stroke-width="2"/></svg>';
    const ring = add(ringSvg, x + 22, y + 4);
    const at = S2 + (pull ? 400 : 0) + t;
    anim(fish, [{ transform: 'translate(0,6px) rotate(-50deg)', opacity: 0 }, { opacity: 1, offset: .12 }, { transform: 'translate(11px,-22px) rotate(0deg)', offset: .5 }, { transform: 'translate(22px,6px) rotate(50deg)', opacity: 1, offset: .9 }, { transform: 'translate(22px,10px) rotate(50deg)', opacity: 0 }], { delay: at, duration: 820, easing: 'linear' });
    anim(ring, [{ transform: 'scale(.3)', opacity: 0 }, { transform: 'scale(.4)', opacity: .9, offset: .1 }, { transform: 'scale(1.5)', opacity: 0 }], { delay: at + 700, duration: 600, easing: 'ease-out' });
    const r0 = add(ringSvg, x, y + 4);
    anim(r0, [{ transform: 'scale(.3)', opacity: 0 }, { transform: 'scale(.4)', opacity: .8, offset: .1 }, { transform: 'scale(1.3)', opacity: 0 }], { delay: at + 40, duration: 520, easing: 'ease-out' });
  });
}

// 底色：每 50ms 取一次畫面中間那一點的顏色，再前後各平均 MIX/2，站和站之間的換色就至少花 MIX 毫秒；每 100ms 一個關鍵影格、線性混色
function bgFrames(st, H, vh, D, T1) {
  const step = 50, n = Math.ceil(T1 / step), half = Math.round(MIX / 2 / step);
  const raw = [];
  for (let k = 0; k <= n; k++) raw.push(rgbAt(st, H - vh / 2 - D * ease1(Math.min(1, k * step / T1))));
  const avg = k => { const s = [0, 0, 0]; let c = 0; for (let j = k - half; j <= k + half; j++) { const v = raw[Math.max(0, Math.min(n, j))]; s[0] += v[0]; s[1] += v[1]; s[2] += v[2]; c++; } return s.map(v => v / c); };
  const kf = [];
  for (let k = 0; k <= n; k += 2) kf.push({ offset: Math.min(1, k * step / T1), backgroundColor: css(avg(k)) });
  if (kf[kf.length - 1].offset < 1) kf.push({ offset: 1, backgroundColor: css(avg(n)) });
  return kf;
}

function start() {
  const html = document.documentElement;
  window.__opStarted = true;
  const o = readOp(); o.d = today(); writeOp(o);              // 記今天播過了
  const vw = innerWidth, vh = innerHeight;
  // ?intro=1 在減少動態效果下也會播：這時候地圖不拉遠（不縮放），浪和燈塔不動（CSS）
  const rm = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const PULL = !rm, PD = PULL ? 500 : 0;
  const app = document.getElementById('app');
  const W = Math.round((app && app.clientWidth) || Math.min(vw, 520));
  const H = TOP + (N - 1) * GAP + BOT;
  const st = mapStations(N, H);
  // 第 1 段：從最底下的碼頭往上捲，最多 0.8 個螢幕高（約五、六顆關卡）；時間由距離和速度上限倒算（約 3 秒）
  const D = Math.min(Math.max(0, H - vh), Math.round(vh * .8));
  const T1 = Math.max(3000, Math.round(PEAK * D / (MAXV * vh) * 1000));
  const S2 = T1;

  root = document.createElement('div');
  root.className = 'op';
  root.setAttribute('aria-hidden', 'true');
  const pts = Array.from({ length: N }, (_, i) => nodeXY(i, H));
  const road = smooth(pts);
  const paths = [['road-shadow', 12], ['road-side', 7], ['road-edge', 0], ['road', 0], ['road-hi', -5], ['road-dots', 0], ['road-dots-hi', -1.6]]
    .map(([c, dy]) => `<path class="${c}" d="${road}"${dy ? ` transform="translate(0 ${dy})"` : ''}/>`).join('');
  // 關卡一開始都是鎖住的灰色，捲到線上才亮
  const nodes = pts.map((p, i) => `<span class="node op-node locked" style="left:${p.x}%;top:${p.y}px"><span class="num">${i + 1}</span></span>`).join('');
  root.innerHTML = seaUnderHTML(vw, vh)
    + `<div class="op-stage" style="width:${W}px;margin-left:${-W / 2}px"><div class="op-strip" style="height:${H}px">`
    + `<div class="map-art">${prefixIds(mapArtHTML(W, N, H), 'op-')}</div>`
    + `<svg class="map-path" viewBox="0 0 100 ${H}" preserveAspectRatio="none" style="height:${H}px">${paths}</svg>`
    + mapSignsHTML(N, H, N + 1) + nodes + `</div></div>`
    + `<div class="op-island">${islandMiniHTML(vw, vh, 'oi-')}</div>`
    + `<div class="op-seaover"></div>`
    + `<div class="op-fx"></div><div class="op-title"></div><div class="op-white"></div><div class="op-burst"></div>`
    + `<span class="op-skip">略過</span>`;
  document.body.appendChild(root);
  html.classList.add('op-playing');
  html.classList.remove('op-pending');

  const strip = root.querySelector('.op-strip'), stage = root.querySelector('.op-stage'), island = root.querySelector('.op-island'), fx = root.querySelector('.op-fx');
  anim(strip, [{ transform: `translate3d(0,${vh - H}px,0)` }, { transform: `translate3d(0,${vh - H + D}px,0)` }], { duration: T1, easing: EASE1 });
  // 同一個元素有兩段動畫時，後面那段只用 forwards（用 both 的話，等待的時候會蓋掉前一段）
  const bg = bgFrames(st, H, vh, D, T1);
  bgAnims.push(anim(root, bg, { duration: T1, easing: 'linear' }));
  bgAnims.push(anim(root, [{ backgroundColor: bg[bg.length - 1].backgroundColor }, { backgroundColor: SEA }], { delay: S2, duration: MIX, easing: 'ease-in-out', fill: 'forwards' }));

  // 關卡捲到畫面 58% 那條線時亮起來；一開始就在線下面的，每 150ms 亮一顆
  const line = vh * .58;
  root.querySelectorAll('.op-node').forEach((nd, i) => {
    const y0 = vh - BOT - GAP * i;
    let at;
    if (y0 >= line) at = 200 + i * 150;
    else { const e = D > 0 ? (line - y0) / D : 2; if (e > 1) return; at = bezT(e) * T1; }
    later(at, () => {
      nd.classList.remove('locked');
      anim(nd, [{ transform: 'translate(-50%,-50%) scale(1)' }, { transform: 'translate(-50%,-50%) scale(1.18)', offset: .45 }, { transform: 'translate(-50%,-50%) scale(1)' }], { duration: 360, easing: 'ease-out', fill: 'none' });
      const ring = document.createElement('i'); ring.className = 'op-ring'; nd.appendChild(ring);
      anim(ring, [{ transform: 'scale(.7)', opacity: .9 }, { transform: 'scale(1.9)', opacity: 0 }], { duration: 520, easing: 'ease-out' });
    });
  });
  // 三隻小鳥從左邊慢慢飛到右邊（只畫線條）
  [[.13, 300, 1], [.2, 520, .8], [.09, 900, .65]].forEach(([y, d, s], k) => {
    const b = document.createElement('div'); b.className = 'op-bird';
    b.innerHTML = `<svg viewBox="0 0 24 12" width="${Math.round(30 * s)}" height="${Math.round(15 * s)}"><g><path d="M1 7 Q6 1 12 7 Q18 1 23 7"/></g></svg>`;
    b.style.top = (vh * y) + 'px';
    fx.appendChild(b);
    anim(b, [{ transform: 'translate(-40px,0)' }, { transform: `translate(${vw * .5}px,-14px)`, offset: .5 }, { transform: `translate(${vw + 40}px,-6px)` }], { delay: d, duration: 2600 + k * 200, easing: 'linear' });
    anim(b.querySelector('g'), [{ transform: 'scaleY(1)' }, { transform: 'scaleY(-.6)' }], { duration: 260, direction: 'alternate', iterations: Infinity, easing: 'ease-in-out' });
  });
  // 小泡泡：地圖淡掉、小島出現那段慢慢往上飄
  for (let k = 0; k < 8; k++) {
    const p = document.createElement('i'); p.className = 'op-bub';
    const s = 10 + (k * 7) % 13;
    Object.assign(p.style, { width: s + 'px', height: s + 'px', left: (8 + (k * 37) % 84) + '%', top: (vh * (.62 + (k % 3) * .1)) + 'px' });
    fx.appendChild(p);
    anim(p, [{ transform: 'translateY(0)', opacity: 0 }, { opacity: .85, offset: .25 }, { transform: `translateY(${-140 - (k % 4) * 25}px)`, opacity: 0 }], { delay: S2 + 100 + k * 110, duration: 1700, easing: 'ease-out' });
  }

  // 第 2 段：地圖慢慢縮小拉遠、淡掉（減少動態效果時只淡掉），露出海上的小島
  if (PULL) anim(stage, [{ transform: 'scale(1)', opacity: 1 }, { opacity: 1, offset: .35 }, { transform: 'scale(.58)', opacity: 0 }], { delay: S2, duration: 950, easing: 'ease-in-out' });
  else anim(stage, [{ opacity: 1 }, { opacity: 0 }], { delay: S2, duration: 500, easing: 'ease-in-out' });
  seaLife(vw, vh, S2, PULL, island);
  // 小島只淡入、不放大縮小（同一時間只有一種縮放）
  if (PULL) anim(island, [{ opacity: 0 }, { opacity: 1 }], { delay: S2 + 300, duration: 700, easing: 'ease-out' });
  else anim(island, [{ opacity: 0 }, { opacity: 1 }], { delay: S2 + 100, duration: 400, easing: 'ease-out' });
  // 島上的角色和小屋（SVG 裡 scale(0.42) 的那些）從下往上一個個從底部長出來，白色圓點跟著冒出來，小船上下浮
  // shown＝島完全出現的時間（淡入完、物件和圓點都長完）；停 HOLD 毫秒才接標題
  let shown = S2 + (PULL ? 1000 : 500);
  const svg = island.querySelector('svg');
  if (svg) {
    const wrap = g => { const w = document.createElementNS(SVGNS, 'g'); g.parentNode.insertBefore(w, g); w.appendChild(g); return w; };
    const spots = [...svg.querySelectorAll('g')].filter(g => /scale\(0\.42\)/.test(g.getAttribute('transform') || ''));
    const yOf = g => { const m = /translate\(([\d.]+)[ ,]([\d.]+)\)/.exec(g.getAttribute('transform')); return m ? +m[2] : 0; };
    // 全島有 44 站，一個接一個長的話要好幾秒；改成整排在 GROW 毫秒內由下往上長完
    const GROW = 700, gap = (n, max) => n > 1 ? Math.min(max, GROW / (n - 1)) : 0;
    const dg = gap(spots.length, 140);
    spots.sort((a, b) => yOf(b) - yOf(a)).forEach((g, k) => {
      const w = wrap(g); w.style.transformBox = 'fill-box'; w.style.transformOrigin = '50% 100%';
      const at = S2 + PD + 300 + k * dg;
      anim(w, [{ transform: 'scale(0)' }, { transform: 'scale(1.15)', offset: .6 }, { transform: 'scale(1)' }], { delay: at, duration: 420, easing: 'ease-out' });
      shown = Math.max(shown, at + 420);
    });
    const dots = [...svg.querySelectorAll('circle[stroke="#fff"]')], dc = gap(dots.length, 120);
    dots.sort((a, b) => b.getAttribute('cy') - a.getAttribute('cy')).forEach((c, k) => {
      c.style.transformBox = 'fill-box'; c.style.transformOrigin = '50% 50%';
      const at = S2 + PD + 600 + k * dc;
      anim(c, [{ transform: 'scale(0)' }, { transform: 'scale(1.6)', offset: .6 }, { transform: 'scale(1)' }], { delay: at, duration: 360, easing: 'ease-out' });
      shown = Math.max(shown, at + 360);
    });
    const boat = [...svg.querySelectorAll('g')].find(g => /scale\(0\.5\)/.test(g.getAttribute('transform') || ''));
    if (boat) anim(wrap(boat), [{ transform: 'translateY(-3px)' }, { transform: 'translateY(3px)' }], { duration: 1100, direction: 'alternate', iterations: Infinity, easing: 'ease-in-out' });
  }

  const S3 = Math.max(S2 + T2, shown + HOLD), S4 = S3 + T3, END = S4 + T4, T2r = S3 - S2;
  later(S3 - 120, () => titleSeg(vw, vh, S3, S4));
  later(END, () => finish(false));
  window.addEventListener('pointerdown', onSkip, true);
  window.addEventListener('keydown', onSkip, true);
  window.__opTimes = { T1, T2: T2r, T3, T4, S2, S3, S4, END, D, shown };   // 量測用
}

export function star4(size) {
  return `<svg viewBox="-10 -10 20 20" width="${size}" height="${size}"><path d="M0 -9 Q1.4 -1.4 9 0 Q1.4 1.4 0 9 Q-1.4 1.4 -9 0 Q-1.4 -1.4 0 -9Z"/></svg>`;
}

// 第 3、4 段：標題要跟封面上的標題疊在同一個位置，雲散開時才接得起來，所以到這時候才量封面標題的位置
function titleSeg(vw, vh, S3, S4) {
  if (!root) return;
  const box = root.querySelector('.op-title'), white = root.querySelector('.op-white'), burst = root.querySelector('.op-burst');
  const src = document.querySelector('#scr-title .logo');
  const r = src ? src.getBoundingClientRect() : { left: vw * .1, top: vh * .14, width: vw * .8, height: vw * .25 };
  // 雲照五顆蛋實際佔的範圍算，不是整個標題列（.eggs 是 flex，寬度等於整列）
  const er = src ? [...src.querySelectorAll('.egg')].map(e => e.getBoundingClientRect()) : [];
  const eb = er.length ? (() => { const L = Math.min(...er.map(q => q.left)), T = Math.min(...er.map(q => q.top)); return { left: L, top: T, width: Math.max(...er.map(q => q.right)) - L, height: Math.max(...er.map(q => q.bottom)) - T }; })() : r;
  const cx = eb.left + eb.width / 2, cy = eb.top + eb.height / 2;
  // 標題後面的立體雲
  const cw = Math.min(vw * .98, eb.width * 1.3), ch = cw * .525;
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
    Object.assign(logo.style, { left: r.left + 'px', top: r.top + 'px', right: 'auto', width: r.width + 'px' });
    box.appendChild(logo);
  }
  // 每顆蛋本來就有高低和歪斜（封面上的 eggbob 這時候是暫停的），孵完要停在封面那顆蛋現在的位置，雲散開時才接得起來
  const srcEggs = src ? [...src.querySelectorAll('.egg')] : [];
  const eggs = logo ? [...logo.querySelectorAll('.egg')] : [];
  const eggM = srcEggs.map(e => { const t = getComputedStyle(e).transform; return t && t !== 'none' ? t : ''; });
  eggs.forEach(e => { e.style.animation = 'none'; });
  // 三隻娃娃站在標題下面
  const sz = Math.round(Math.min(78, vw * .19));
  const trio = document.createElement('div');
  trio.className = 'op-trio';
  Object.assign(trio.style, { left: cx + 'px', top: Math.min(vh - sz - 40, r.top + r.height + 18) + 'px' });
  trio.innerHTML = TRIO.map(id => `<span class="op-tw"><img src="assets/sprites/${id}_n.png" alt="" draggable="false" style="width:${sz}px;height:${sz}px"></span>`).join('');
  box.appendChild(trio);
  const imgs = [...trio.querySelectorAll('img')], tws = [...trio.querySelectorAll('.op-tw')];
  const fades = [logo, trio].filter(Boolean);

  anim(cloud, [{ transform: 'scale(.85)', opacity: 0 }, { transform: 'scale(1.04)', opacity: 1, offset: .6 }, { transform: 'scale(1)', opacity: 1 }], { delay: t0, duration: 500, easing: 'ease-out' });
  // 五顆蛋：先出現、搖一搖，蛋殼裂開飛出三片，字再跳出來
  eggs.forEach((e, i) => {
    const M = eggM[i] || 'translateY(0)';
    const base = t0 + 200 + i * 110;
    const ch0 = e.textContent; e.textContent = '';
    const b = document.createElement('b'); b.className = 'op-ch'; b.textContent = ch0; e.appendChild(b);
    anim(e, [{ transform: `${M} scale(.6)`, opacity: 0 }, { transform: `${M} scale(1)`, opacity: 1 }], { delay: base, duration: 300, easing: 'ease-out' });
    anim(e, [{ transform: `${M} rotate(0deg)` }, { transform: `${M} rotate(8deg)`, offset: .25 }, { transform: `${M} rotate(-8deg)`, offset: .6 }, { transform: `${M} rotate(0deg)` }],
      { delay: base + 300, duration: 420, easing: 'ease-in-out', fill: 'forwards' });
    anim(b, [{ transform: 'scale(0)', opacity: 0 }, { transform: 'scale(1.25)', opacity: 1, offset: .6 }, { transform: 'scale(1)', opacity: 1 }], { delay: base + 720, duration: 360, easing: 'ease-out' });
    [[-1, -.6], [1, -.8], [.2, -1.1]].forEach(([dx, dy], k) => {
      const c = document.createElement('i'); c.className = 'op-shell'; e.appendChild(c);
      const dist = 20 + k * 5;
      anim(c, [{ transform: 'translate(-50%,-50%) rotate(0deg) scale(1)', opacity: 1 }, { transform: `translate(calc(-50% + ${dx * dist}px),calc(-50% + ${dy * dist}px)) rotate(${dx * 90}deg) scale(.6)`, opacity: 0 }],
        { delay: base + 720, duration: 380, easing: 'ease-out' });
    });
  });
  // 三隻：字都跳完才輪流出場，皮蛋轉一圈（遊戲裡的轉身圖）、薯餅左右搖、蛋黃哥跳兩下
  imgs.forEach((im, i) => anim(im, [{ transform: 'translateY(20%) scale(.9)', opacity: 0 }, { transform: 'translateY(0) scale(1)', opacity: 1 }], { delay: t0 + 700 + TS + i * 90, duration: 300, easing: 'ease-out' }));
  if (tws[0]) {
    const d = document.createElement('i'); d.className = 'op-spin';
    Object.assign(d.style, { width: sz + 'px', height: sz + 'px', backgroundImage: 'url(assets/sprites/dog_spin_n.webp)' });
    tws[0].appendChild(d);
    const kf = []; for (let f = 0; f < 24; f++) kf.push({ backgroundPosition: `${(f % 6) * 20}% ${Math.floor(f / 6) * 100 / 3}%`, easing: 'steps(1,end)' });
    kf.push({ backgroundPosition: '0% 0%' });
    anim(d, kf, { delay: t0 + 1200 + TS, duration: 900, fill: 'none' });
    anim(d, [{ opacity: 1 }, { opacity: 1 }], { delay: t0 + 1200 + TS, duration: 900, fill: 'none' });
    anim(imgs[0], [{ visibility: 'hidden' }, { visibility: 'hidden' }], { delay: t0 + 1200 + TS, duration: 900, fill: 'none' });
  }
  if (imgs[1]) {
    imgs[1].style.transformOrigin = '50% 100%';
    anim(imgs[1], [{ transform: 'rotate(0)' }, { transform: 'rotate(-10deg)', offset: .2 }, { transform: 'rotate(10deg)', offset: .5 }, { transform: 'rotate(-6deg)', offset: .78 }, { transform: 'rotate(0)' }],
      { delay: t0 + 1250 + TS, duration: 900, easing: 'ease-in-out', fill: 'none', composite: 'add' });
  }
  if (imgs[2]) {
    anim(imgs[2], [{ transform: 'translateY(0)' }, { transform: 'translateY(-26%) scale(.96,1.04)', offset: .22 }, { transform: 'translateY(0) scale(1.06,.94)', offset: .45 },
      { transform: 'translateY(-18%)', offset: .7 }, { transform: 'translateY(0)' }], { delay: t0 + 1300 + TS, duration: 700, easing: 'ease-in-out', fill: 'none', composite: 'add' });
  }
  // 標題旁邊冒幾顆四角星
  [[-.48, -.35, 22], [.5, -.42, 18], [-.55, .3, 14], [.56, .22, 20], [-.15, -.62, 13], [.2, .58, 15]].forEach(([fx, fy, s], k) => {
    const w = document.createElement('i'); w.className = 'op-star'; w.innerHTML = star4(s);
    Object.assign(w.style, { left: (cx + fx * cw - s / 2) + 'px', top: (cy + fy * ch - s / 2) + 'px' });
    box.appendChild(w); fades.push(w);
    anim(w, [{ transform: 'scale(0) rotate(0deg)', opacity: 1 }, { transform: 'scale(1) rotate(45deg)', opacity: 1, offset: .45 }, { transform: 'scale(0) rotate(90deg)', opacity: 1 }],
      { delay: t0 + 600 + k * 170, duration: 640, easing: 'ease-in-out' });
  });

  // 第 4 段：雲慢慢脹大蓋滿畫面（700ms）
  const d4 = S4 - S3 + 120, SWELL = 700;
  // 雲一邊脹大一邊往畫面中間移，才蓋得到下半部（只在原地放大的話，雲的平底會在畫面中間留一條直線）
  const dy = vh / 2 - cy;
  const big = 1.3 * Math.max((vh / 2) / (ch * .44), vw / cw);
  anim(cloud, [{ transform: 'translate(0,0) scale(1)' }, { transform: `translate(0,${dy}px) scale(${big})` }], { delay: d4, duration: SWELL, easing: 'ease-in-out', fill: 'forwards' });
  // 雲底下再接一朵倒過來的雲，脹大時下緣是一球一球的圓弧，不會是一條直線
  const under = document.createElement('i');
  cloud.appendChild(under);
  anim(under, [{ opacity: 0 }, { opacity: 1 }], { delay: d4, duration: 200 });
  fades.forEach(n => anim(n, [{ opacity: 1 }, { opacity: 0 }], { delay: d4 + 250, duration: 300, fill: 'forwards', composite: 'replace' }));
  anim(white, [{ opacity: 0 }, { opacity: 1 }], { delay: d4 + 380, duration: SWELL - 380, easing: 'ease-in' });
  // 蓋滿之後：底下的地圖、海和島拿掉、露出封面，九朵雲從中間開始一朵一朵在原地脹一點再淡掉（不往外飛），白色 500ms 退掉
  const d5 = d4 + SWELL;
  later(d5, () => {                                           // titleSeg 本身在 S3-120 才開始，這裡只算從現在起的時間
    if (!root) return;
    root.classList.add('op-reveal');
    bgAnims.forEach(a => a.cancel()); bgAnims = [];
    ['.op-stage', '.op-island', '.op-fx', '.op-sea', '.op-seaover'].map(q => root.querySelector(q)).concat(cloud).forEach(n => n && (n.style.visibility = 'hidden'));
    const pw = Math.max(vw * .8, 240) * 1.7, ph = pw * .525;   // 一開始就是蓋滿的大小
    const order = [4, 0, 8, 2, 6, 1, 7, 3, 5];
    for (let i = 0; i < 9; i++) {
      const gx = i % 3 - 1, gy = Math.floor(i / 3) - 1;
      const x = vw / 2 + gx * vw * .36, y = vh / 2 + gy * vh * .34;
      const p = document.createElement('i');
      Object.assign(p.style, { width: pw + 'px', height: ph + 'px', left: (x - pw / 2) + 'px', top: (y - ph / 2) + 'px' });
      burst.appendChild(p);
      const k = order.indexOf(i);
      anim(p, [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1.12)', opacity: 1, offset: .45 }, { transform: 'scale(1.12)', opacity: 0 }],
        { delay: 60 + k * 85, duration: 360, easing: 'ease-out' });
    }
    anim(white, [{ opacity: 1 }, { opacity: 0 }], { duration: 500, easing: 'ease-out' });
  });
}

if (window.__opPlay && !window.__opLate) {
  try { start(); } catch (e) { console.warn('開頭動畫沒有播', e); document.documentElement.classList.remove('op-pending'); finish(false); }
}
