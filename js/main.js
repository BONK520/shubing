// 薯餅蛋蛋島 — 主程式：畫面流程、HUD、輸入、存檔、音效對應（SPEC §7）
import { PIECES, TRIO, spritePath, spinPath } from './pieces.js?v=20261123g';
import { SLOGANS } from './slogans.js?v=20261123g';
import { createCloset, CATEGORIES, ITEMS, CHESTS, iconSvg, svgUrl, totalStars } from './cosmetics.js?v=20261123g';
import { blockerCanvas } from './blockers.js?v=20261123g';
import { mapArtHTML, mapSignsHTML, mapStations, stationAt } from './mapart.js?v=20261123g';
// 模組的版本參數：上面和 renderer.js 裡的 import 字串要跟這個一樣（同一個檔案用不同網址會被載成兩份）
const MOD_V = '?v=20261123g';

window.__plushBooted = true;

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// 千分位（toLocaleString 很慢，分數跑動時每幀都會呼叫）
const fmt = n => { const s = String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ','); return n < 0 ? '-' + s : s; };
const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const SVGNS = 'http://www.w3.org/2000/svg';
const SCANNED = PIECES.filter(p => p.scan);
const TITLE_TOYS = (SCANNED.length >= 3 ? SCANNED : PIECES).slice(0, 3);

// ---------- 存檔 ----------
// 沒登入：存在 SAVE_KEY（這台裝置的「訪客」存檔，跟以前一樣）。
// 登入（雲端存檔，js/cloud.js）：每個帳號一份，這台裝置上的副本存在 SAVE_KEY + '.u.' + uid（離線也能玩），
// 有變動就（等一下下）寫到雲端；換手機登入同一個帳號就接著玩。音效 / 音樂開關跟著裝置走，換帳號不會變。
const SAVE_KEY = 'plushcrush.v1';
const BST0 = { hammer: 3, swap: 3, ufo: 2, moves5: 1 };      // 第一次玩送的道具
let saveKey = SAVE_KEY;
const save = loadSave(SAVE_KEY) || normSave(null);
// 進度的欄位（同步到雲端的就是這些）：unlocked 開到第幾關、stars / best 每關的星星和最高分、boosters 道具、t 最後一次進度改變的時間
function normSave(s) {
  s = s && typeof s === 'object' ? s : {};
  const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const nums = o => Object.fromEntries(Object.entries(obj(o)).filter(([, v]) => Number.isFinite(Number(v))).map(([k, v]) => [k, Math.max(0, Number(v))]));
  return {
    unlocked: Number.isFinite(s.unlocked) && s.unlocked >= 1 ? Math.floor(s.unlocked) : 1,
    stars: nums(s.stars),
    best: nums(s.best),
    muted: !!s.muted,
    music: s.music !== false,
    boosters: Object.fromEntries(Object.keys(BST0).map(k => [k, Number.isFinite(obj(s.boosters)[k]) ? Math.max(0, Math.floor(s.boosters[k])) : BST0[k]])),
    t: Number.isFinite(s.t) ? s.t : 0,
    seen: Array.isArray(s.seen) ? s.seen.filter(x => typeof x === 'string').slice(0, 20) : [],   // 看過教學小卡的機關（這台裝置）
  };
}
function loadSave(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? normSave(JSON.parse(raw)) : null;
  } catch (e) {
    return null;
  }
}
const progressOf = s => ({ v: 1, unlocked: s.unlocked, stars: s.stars, best: s.best, boosters: s.boosters, t: s.t || 0 });
const hasProgress = s => !!s && (s.unlocked > 1 || Object.keys(s.stars).length > 0);
let lastProgress = JSON.stringify({ ...progressOf(save), t: 0 });
function writeSave() {
  const p = JSON.stringify({ ...progressOf(save), t: 0 });
  if (p !== lastProgress) { lastProgress = p; save.t = Date.now(); }   // 只有進度變了才算「更新」（開關音效不算）
  try { localStorage.setItem(saveKey, JSON.stringify(save)); } catch (e) { /* 無痕模式等：照玩 */ }
  if (account) schedulePush();
}
// 兩份存檔合在一起：開到的關卡、每關的星星和最高分都取比較好的；道具照「比較新的那份」（不然兩台手機一合就變兩倍）
function mergeSave(a, b) {
  if (!a) return b;
  if (!b) return a;
  const newer = (b.t || 0) > (a.t || 0) ? b : a;
  const out = normSave({ ...newer, unlocked: Math.max(a.unlocked, b.unlocked), t: Math.max(a.t || 0, b.t || 0) });
  for (const k of ['stars', 'best']) {
    out[k] = { ...a[k] };
    for (const [id, v] of Object.entries(b[k])) out[k][id] = Math.max(Number(out[k][id]) || 0, Number(v) || 0);
  }
  return out;
}
// 換成另一份存檔（save 是 const 物件，很多地方直接拿去用，所以就地換內容）；音效 / 音樂開關保留這台裝置的
function applySave(s) {
  const keep = { muted: save.muted, music: save.music, seen: save.seen };
  for (const k of Object.keys(save)) delete save[k];
  Object.assign(save, normSave(s), keep);
  lastProgress = JSON.stringify({ ...progressOf(save), t: 0 });
}

// ---------- 雲端存檔（帳號） ----------
// 沒設定 js/cloud-config.js 時整段不作用、畫面上也不會出現登入按鈕。
let cloud = null, account = null, syncState = 'off', lastPushed = '', pushTimer = 0, askGuestMerge = false;
async function initCloud() {
  let cfg = null;
  try { cfg = (await import('./cloud-config.js' + MOD_V)).FIREBASE_CONFIG; } catch (e) { /* 沒有設定檔 */ }
  const emu = DEBUG && params.has('emu');      // 測試：連本機的 Firebase 模擬器（tests/ 和 docs/CLOUD_SAVE.md）
  if (emu) cfg = { apiKey: 'demo-key', authDomain: 'demo-plush.firebaseapp.com', projectId: 'demo-plush', appId: 'demo' };   // 測試永遠用假專案，不碰真的存檔
  if (!cfg) return;
  try { cloud = (await import('./cloud.js' + MOD_V)).createCloud(cfg, { emulator: emu }); } catch (e) { console.warn('[cloud]', e); return; }
  document.documentElement.classList.add('has-cloud');
  syncState = 'guest';
  renderAccount();
  let q = Promise.resolve();          // 登入狀態的變化一個一個處理（快速登入又登出也不會打架）
  cloud.onUser(u => { q = q.then(() => switchAccount(u)).catch(e => console.error('[cloud]', e)); });
  cloud.ready.catch(() => { syncState = 'off'; document.documentElement.classList.remove('has-cloud'); renderAccount(); });
  window.addEventListener('online', () => { if (account) pushCloud(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && account && pushTimer) pushCloud(); });
}
async function switchAccount(u) {
  const uid = u ? u.uid : null;
  if ((account ? account.uid : null) === uid) { account = u; renderAccount(); return; }
  clearTimeout(pushTimer); pushTimer = 0;
  if (!u) {                                  // 登出 → 回到這台裝置的訪客存檔
    account = null; saveKey = SAVE_KEY; lastPushed = '';
    applySave(loadSave(SAVE_KEY));
    setSync('guest');
    refreshAfterSwitch();
    return;
  }
  account = u; saveKey = SAVE_KEY + '.u.' + uid; lastPushed = '';
  const explicit = askGuestMerge;          // 剛按了「登入」（不是重新整理後自動恢復登入）
  setSync('syncing');
  let remote = null, online = true;
  try { const d = await cloud.load(); remote = d ? normSave(d) : null; } catch (e) { online = false; console.warn('[cloud] 讀取失敗', e); }
  if (!account || account.uid !== uid) return;            // 讀的時候又換人了
  // 雲端的 + 這台裝置上這個帳號的副本（可能有離線時玩、還沒傳上去的進度）
  let merged = mergeSave(remote, loadSave(saveKey)) || normSave(null);
  // 剛按「登入」、這台裝置上又有沒登入時玩的進度：問要不要帶進帳號（帶進去之後訪客存檔清空，下一個人登入不會又拿到）
  const guest = loadSave(SAVE_KEY);
  if (askGuestMerge && hasProgress(guest)) {
    if (await askMerge(guest, u)) {
      merged = mergeSave(merged, guest);
      try { localStorage.setItem(SAVE_KEY, JSON.stringify({ ...normSave(null), muted: save.muted, music: save.music })); } catch (e) { /* ignore */ }
      if (!account || account.uid !== uid) return;
    }
  }
  askGuestMerge = false;
  applySave(merged);
  try { localStorage.setItem(saveKey, JSON.stringify(save)); } catch (e) { /* ignore */ }
  if (remote) lastPushed = JSON.stringify(progressOf(remote));
  refreshAfterSwitch();
  if (online) pushCloud(); else setSync('offline');
  if (explicit) toast(online ? `歡迎，${u.name}！進度會存到雲端` : `歡迎，${u.name}！現在離線，連上網路會自動存到雲端`, 2200);
}
function schedulePush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushCloud, 1500);      // 連續好幾個變動（過關：星星、最高分、道具）合成一次
  if (syncState !== 'offline') setSync('syncing');
}
async function pushCloud() {
  clearTimeout(pushTimer); pushTimer = 0;
  if (!cloud || !account) return;
  const uid = account.uid, data = progressOf(save), json = JSON.stringify(data);
  if (json === lastPushed) { setSync('synced'); return; }
  setSync('syncing');
  try {
    await cloud.save(data, uid);                // cloud.js 會確認目前登入的還是這個人，才寫
    if (!account || account.uid !== uid) return;
    lastPushed = json;
    setSync(JSON.stringify(progressOf(save)) === json ? 'synced' : 'syncing');
  } catch (e) {
    console.warn('[cloud] 寫入失敗，連上網路或下次存檔時再試', e);
    if (account && account.uid === uid) setSync('offline');
  }
}
function setSync(s) { syncState = s; renderAccount(); }
function refreshAfterSwitch() {
  if (LEVELS && save.unlocked > LEVELS.length + 1) save.unlocked = LEVELS.length + 1;
  closet.load(closetKey());
  applyLook();
  renderClosetBtn();
  renderAccount();
  if (screen === 'map') buildMap();
  if (screen === 'game') renderBoosters();
}

// ---------- 模組 ----------
let createEngine, createRenderer, LEVELS, audio, levMod = {};
const silentAudio = { unlock() {}, play() {}, setMuted() {}, setMusic() {}, setScene() {}, get muted() { return true; }, get music() { return false; } };

async function loadModules() {
  const names = ['engine', 'renderer', 'levels', 'audio'];
  const res = await Promise.allSettled(names.map(n => import(`./${n}.js${MOD_V}`)));
  const fail = [];
  const mod = i => (res[i].status === 'fulfilled' ? res[i].value : (fail.push(names[i] + '.js'), console.error(res[i].reason), null));
  const eng = mod(0), ren = mod(1), lev = mod(2);
  const aud = res[3].status === 'fulfilled' ? res[3].value : null;
  if (!aud) console.warn('audio.js 載入失敗，改成無聲模式', res[3].reason);
  createEngine = eng && eng.createEngine;
  createRenderer = ren && ren.createRenderer;
  LEVELS = lev && lev.LEVELS;
  levMod = lev || {};
  audio = (aud && (aud.audio || aud.default)) || silentAudio;
  if (eng && typeof createEngine !== 'function') fail.push('engine.js（沒有 createEngine）');
  if (ren && typeof createRenderer !== 'function') fail.push('renderer.js（沒有 createRenderer）');
  if (lev && !(Array.isArray(LEVELS) && LEVELS.length)) fail.push('levels.js（沒有 LEVELS）');
  return fail;
}

// ---------- 圖片 ----------
const images = new Map();
function loadImg(src, timeout = 12000) {
  return new Promise(resolve => {
    const img = new Image();
    let done = false;
    const fin = ok => { if (!done) { done = true; resolve(ok ? img : null); } };
    img.onload = () => fin(img.naturalWidth > 0);
    img.onerror = () => fin(false);
    img.decoding = 'async';
    img.src = src;
    setTimeout(() => fin(false), timeout);
  });
}
async function loadImages(onProgress) {
  const jobs = [];
  let done = 0;
  const total = PIECES.length * 2 + PIECES.filter(p => !p.photo).length * 2 + 3;
  const track = p => p.then(v => { done++; onProgress(done / total); return v; });
  for (const p of PIECES) {
    const entry = { sprite: null, spin: null };
    images.set(p.id, entry);
    jobs.push(track(loadImg(spritePath(p.id))).then(im => { entry.sprite = im; }));
    if (!p.photo) jobs.push(track(loadImg(spinPath(p.id))).then(im => { entry.spin = im; }));   // 照片方塊沒有旋轉序列
    // 盤面用的沒白邊版本（放進糖果裡，陰影和發光邊由 renderer 畫）
    jobs.push(track(loadImg(`assets/sprites/${p.id}_n.png`)).then(im => { entry.clean = im; }));
    if (!p.photo) jobs.push(track(loadImg(`assets/sprites/${p.id}_spin_n.webp`)).then(im => { entry.spinClean = im; }));
  }
  // 龍龍（「救出龍龍」關卡的主角）：原本那隻恐龍玩偶的實拍照片
  const dino = { sprite: null, clean: null };
  images.set('dino', dino);
  jobs.push(track(loadImg('assets/sprites/dino.png')).then(im => { dino.sprite = im; }));
  jobs.push(track(loadImg('assets/sprites/dino_n.png')).then(im => { dino.clean = im; }));
  const trio = { sprite: null, spin: null };
  images.set(TRIO.id, trio);
  jobs.push(track(loadImg(spritePath(TRIO.id))).then(im => { trio.sprite = im; }));   // 圖還沒載好時的備用；彩色炸彈和口號用三隻各自的圖排成扇形（renderer 的 trioFan）
  // manifest 的 spinScale = 旋轉序列第 0 格相對靜態圖的大小；畫旋轉時放大回來，選取時才不會突然變小
  // manifest 可有可無：跟圖片一樣有時限（8 秒就放棄），請求卡住也不會讓載入畫面停在 98%
  const mac = typeof AbortController === 'function' ? new AbortController() : null;
  let mto = 0;
  const manifest = fetch('assets/manifest.json', mac ? { signal: mac.signal } : undefined).then(r => (r.ok ? r.json() : null)).then(m => {
    for (const e of (m && m.pieces) || []) {
      const entry = e && images.get(e.id);
      if (entry && Number.isFinite(e.spinScale) && e.spinScale > 0.4 && e.spinScale < 2.5) entry.spinScale = e.spinScale;
    }
  }).catch(() => {});
  jobs.push(Promise.race([manifest, new Promise(res => { mto = setTimeout(() => { if (mac) mac.abort(); res(); }, 8000); })])
    .finally(() => clearTimeout(mto)));
  await Promise.all(jobs);
}

// 玩具小圖（DOM）：有圖用圖（沒白邊的「遊戲光」版本，發光和影子由 CSS 依場景加），沒有就畫圓形＋名字第一個字
function toyImg(p) {
  const e = images.get(p.id);
  return e ? e.clean || e.sprite : null;
}
function toyEl(p, fs) {
  const im = toyImg(p);
  if (im) {
    const img = document.createElement('img');
    img.src = im.src; img.alt = ''; img.draggable = false;
    return img;
  }
  const d = document.createElement('span');
  d.className = 'toy-fallback';
  d.style.background = p.color;
  if (fs) d.style.setProperty('--fs', fs + 'px');
  d.textContent = p.name[0];
  return d;
}
// 圖裡玩具底下空了多少（0–1）：讓玩具的腳剛好踩在展示台 / 關卡上，不會浮在半空
const footCache = new Map();
function toyFoot(im) {
  if (!im) return 0;
  let f = footCache.get(im.src);
  if (f != null) return f;
  f = 0;
  try {
    const n = 64, c = document.createElement('canvas');
    c.width = c.height = n;
    const g = c.getContext('2d');
    g.drawImage(im, 0, 0, n, n);
    const a = g.getImageData(0, 0, n, n).data;
    let y1 = -1;
    for (let y = n - 1; y >= 0 && y1 < 0; y--) for (let x = 0; x < n; x++) if (a[(y * n + x) * 4 + 3] > 60) { y1 = y; break; }
    if (y1 >= 0) f = (n - 1 - y1) / n;
  } catch (e) { /* 讀不到像素就當作沒有空白 */ }
  footCache.set(im.src, f);
  return f;
}
// 玩具的代表色（pieces.js）調亮 / 調暗，給展示台、發光用
function tint(hex, t) {
  const n = parseInt(String(hex).replace('#', ''), 16) || 0xcccccc;
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255], m = t > 0 ? 255 : 0, k = Math.abs(t);
  return `rgb(${c.map(v => Math.round(v + (m - v) * k)).join(',')})`;
}
function setToyColors(elm, hex) {
  elm.style.setProperty('--pc', hex);
  elm.style.setProperty('--pc-ll', tint(hex, 0.8));
  elm.style.setProperty('--pc-l', tint(hex, 0.45));
  elm.style.setProperty('--pc-d', tint(hex, -0.28));
  elm.style.setProperty('--pc-dd', tint(hex, -0.52));
}
const pieceById = id => PIECES.find(p => p.id === id);
const kindOf = id => PIECES.findIndex(p => p.id === id);
function starSvg(cls = '') {
  const s = document.createElementNS(SVGNS, 'svg');
  if (cls) s.setAttribute('class', cls);
  const u = document.createElementNS(SVGNS, 'use');
  u.setAttribute('href', '#i-star');
  s.appendChild(u);
  const hi = document.createElementNS(SVGNS, 'use');     // 金色星星左上的反光（CSS 只在亮起來的星星上顯示）
  hi.setAttribute('href', '#i-star-hi'); hi.setAttribute('class', 'hi');
  s.appendChild(hi);
  return s;
}
function jellyIcon(sm) { const d = document.createElement('span'); d.className = 'jelly-ic' + (sm ? ' sm' : ''); return d; }
// 機關的小圖（目標圖示、開始卡、教學小卡）：js/blockers.js 畫一次存成圖片網址
const blockerUrls = {};
function blockerImg(type) {
  const img = document.createElement('img');
  img.alt = ''; img.draggable = false;
  try { img.src = blockerUrls[type] || (blockerUrls[type] = blockerCanvas(type, 96).toDataURL()); } catch (e) { /* 畫不出來就空白 */ }
  return img;
}
function dinoImg() {
  const e = images.get('dino'), im = e && (e.clean || e.sprite);
  const img = document.createElement('img');
  img.alt = ''; img.draggable = false;
  if (im) img.src = im.src;
  return img;
}
// 目標的一個部分（levels.js goalParts）→ 圖示
const PART_ICON = { dino: () => dinoImg(), frost: () => blockerImg('frost2'), choco: () => blockerImg('choco'), cage: () => blockerImg('cage') };
const PART_NAME = { dino: '龍龍', frost: '糖霜', choco: '巧克力', cage: '鐵籠子' };
const goalPartsOf = lvl => (levMod.goalParts ? levMod.goalParts(lvl) : [{ kind: 'score' }]);

// ---------- 新機關教學小卡 ----------
// 第一次遇到某種機關時，開始前先跳一張小卡（圖示 + 一句話），點一下就開始。看過的記在 save.seen（這台裝置）
const INTRO = {
  jelly: { name: '冰果凍', text: '在冰塊上面配對，把所有冰果凍敲碎！', icon: () => jellyIcon() },
  dino: { name: '龍龍', text: '消掉龍龍下面的玩偶，送牠到綠色箭頭出口！', icon: () => dinoImg(), ribbon: '新朋友！' },
  cage: { name: '鐵籠子', text: '被關住的玩偶不能動，和牠同色配對或用特效就能打開！', icon: () => blockerImg('cage') },
  frost: { name: '多層糖霜', text: '在旁邊配對就能敲掉一層，最多有三層喔！', icon: () => blockerImg('frost3') },
  choco: { name: '巧克力', text: '每一步都要清掉一點巧克力，不然它會越長越大！', icon: () => blockerImg('choco') },
  lic: { name: '甘草漩渦糖', text: '不能配對，要在旁邊消掉；它還會擋住條紋的光！', icon: () => blockerImg('swirl') },
  portal: { name: '傳送門', text: '從這個門掉下去，會從同顏色的門掉出來！', icon: () => blockerImg('portal') },
};
function levelMechs(lvl) {
  const out = new Set();
  if (lvl.jelly && lvl.jelly.some(row => /[12]/.test(row))) out.add('jelly');
  const obs = (lvl.obstacles || []).join('');
  if (obs.includes('L')) out.add('cage');
  if (/[123]/.test(obs)) out.add('frost');
  if (obs.includes('C')) out.add('choco');
  if (obs.includes('S') || lvl.licorice) out.add('lic');
  if (obs.includes('D') || goalPartsOf(lvl).some(p => p.kind === 'dino')) out.add('dino');
  if (lvl.portals && lvl.portals.length) out.add('portal');
  return Object.keys(INTRO).filter(k => out.has(k));
}
async function showIntros(lvl, token) {
  for (const k of levelMechs(lvl)) {
    if (save.seen.includes(k)) continue;
    const it = INTRO[k];
    $('#mi-ribbon').textContent = it.ribbon || '新機關！';
    const ic = $('#mi-icon');
    ic.innerHTML = '';
    ic.appendChild(it.icon());
    $('#mi-title').textContent = it.name;
    $('#mi-text').textContent = softWrap(it.text);
    openModal('m-intro');
    audio.play('chime', { level: 3 });
    await new Promise(res => {
      const m = $('#m-intro');
      const done = () => { m.removeEventListener('click', done); clearInterval(chk); res(); };
      const chk = setInterval(() => { if (token !== session || !isOpen('m-intro')) done(); }, 200);
      setTimeout(() => m.addEventListener('click', done), 350);     // 剛跳出來的那一下不算（避免連點直接跳過）
    });
    closeModal('m-intro');
    if (token !== session) return;
    save.seen.push(k);
    writeSave();
    await sleep(120);
  }
}
function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
// 立體數字：字面上亮下暗的漸層是 ::after 用 attr(data-t) 疊一份同樣的字（text-shadow 的描邊會蓋掉 background-clip 的漸層），
// 所以數字要同時寫進 data-t（CSS 在「遊戲感的字」那段）
function setNum(e, txt) { if (!e) return; txt = String(txt); e.textContent = txt; e.dataset.t = txt; }
function numEl(tag, txt) { const e = el(tag); setNum(e, txt); return e; }
// 重播 CSS 動畫：拿掉 class，隔兩幀再加回去（不用 offsetWidth 強迫同步排版，盤面動畫時不會卡一下）
function restartAnim(node, cls) {
  if (!node) return;
  node.classList.remove(cls);
  const tok = (node._ra = (node._ra || 0) + 1);
  requestAnimationFrame(() => requestAnimationFrame(() => { if (node._ra === tok) node.classList.add(cls); }));
}

// ---------- 畫面切換 ----------
let screen = 'loading';
let parkTimer = 0;
function show(name) {
  for (const s of $$('.screen')) s.classList.toggle('active', s.id === 'scr-' + name);
  screen = name;
  document.documentElement.dataset.screen = name;   // CSS：遊戲畫面時背景的泡泡、雲停住（省電）
  // 背景音樂：首頁、地圖播同一首；關卡一關一首（單數關、雙數關各一首），重新開始不換歌（audio.js 會淡入淡出）
  try { if (audio && audio.setScene) audio.setScene(name === 'game' ? 'level' : 'home', levelIdx + 1); } catch (e) { /* ignore */ }
  // 離開遊戲畫面：清掉盤面的選取、提示和方塊。選取框、包裝糖、彩色炸彈的待機動畫會讓 renderer 一直重畫，
  // 畫布看不到了也照跑（耗電）。startLevel 每次都會重新 setBoard，所以清掉是安全的。
  clearTimeout(parkTimer);
  if (name !== 'game' && R) {
    R.select(null);
    R.hint(null);
    parkTimer = setTimeout(() => { if (screen !== 'game' && R) R.setBoard(null); }, 400);   // 等遊戲畫面淡出（.35s）再清
  }
}

// ---------- 背景漂浮光點 ----------
// 約每秒 10 次把光點往上移一點點、左右晃、一閃一閃（飄得很慢，看起來和每秒 60 張一樣順，但背景不用一直合成）。
// 分頁藏起來、有對話框時停住；系統設定「減少動態」時只留淡淡的靜止光點
const motes = [];
let moteTimer = 0;
function initMotes() {
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  for (const m of $$('.sky .mote')) {
    if (reduce) { m.style.opacity = '.25'; continue; }
    motes.push({ el: m, sp: 5 + Math.random() * 6, ph: Math.random() * 6.283, tw: 2.4 + Math.random() * 1.8, off: Math.random() });
  }
  if (motes.length) tickMotes();
}
function tickMotes() {
  moteTimer = 0;
  if (document.hidden || document.documentElement.dataset.modal) { moteTimer = setTimeout(tickMotes, 500); return; }
  const t = performance.now() / 1000, span = Math.max(300, window.innerHeight * 0.7), edge = span * 0.12;
  for (const m of motes) {
    const y = (t * m.sp + m.off * span) % span;             // 往上飄了多少 px（一輪 span，循環）
    const fade = Math.min(1, y / edge, (span - y) / edge);  // 兩端淡入淡出，循環接回去時看不出來
    const op = fade * (0.12 + 0.43 * (0.5 + 0.5 * Math.sin(t * 6.283 / m.tw + m.ph)));
    m.el.style.transform = `translate(${(Math.sin(t * 0.35 + m.ph) * 14).toFixed(1)}px, ${(-y).toFixed(1)}px)`;
    m.el.style.opacity = op.toFixed(2);
  }
  moteTimer = setTimeout(tickMotes, 100);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && motes.length && !moteTimer) tickMotes(); });

// ---------- 玩偶衣櫃（三星外觀獎勵，js/cosmetics.js）----------
// 衣櫃存在這台裝置的 localStorage，每個帳號一份（key 跟著存檔走）；造型幣、星星照存檔裡的關卡星星算
const closet = createCloset();
const closetKey = () => saveKey + '.closet';
let clR = null, clCat = 'hat', tryOn = {};
// 預覽用的小盤面：3 × 4，七種玩偶都有，再放一顆條紋和一隻飛天玩偶
const CL_GRID = [[[1], [0], [2], [3]], [[6], [5, 'h'], [4], [1, 'fish']], [[2], [6], [0], [5]]];
function applyLook() {
  const l = closet.look(save.stars);
  if (R && R.setLook) R.setLook(l);
  if (clR) clR.setLook(previewLook());
}
function previewLook() {
  const l = closet.look(save.stars);
  for (const [cat, id] of Object.entries(tryOn)) l[cat] = id.split('.')[1];
  return l;
}
function renderClosetBtn() {
  const coins = closet.coins(save.stars), ready = closet.readyChests(save.stars).length > 0;
  setNum($('#cf-coins'), coins);
  $('#cf-dot').hidden = !ready;
  $('#btn-closet').classList.toggle('ready', ready);
}
function coinEl(big) { return el('i', 'coin' + (big ? ' big' : '')); }
function openCloset() {
  tryOn = {};
  renderCloset();
  openModal('m-closet');
  if (!clR) {
    try { clR = createRenderer($('#cl-board'), { pieces: PIECES, images }); } catch (e) { console.error(e); clR = null; }
  }
  if (clR) {
    let id = 1;
    const grid = CL_GRID.map(row => row.map(([kind, sp]) => ({ id: id++, kind: Math.min(kind, PIECES.length - 1), special: sp || 'none' })));
    clR.resume();
    clR.setBoard({ rows: grid.length, cols: grid[0].length, grid });
    clR.setLook(previewLook());
    setTimeout(() => { if (clR && isOpen('m-closet')) clR.layout(); }, 420);    // 卡片彈出來的動畫結束後再量一次大小
  }
}
// 捲到寶箱區。直式是 .cl-scroll 在捲；手機橫放時整個 #m-closet 在捲，所以往上找第一個真的捲得動的那層
function scrollToChests(smooth = true) {
  const sec = $('#cl-chest-sec');
  if (!sec) return;
  let sc = sec.parentElement;
  while (sc && sc !== document.body) {
    const oy = getComputedStyle(sc).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && sc.scrollHeight > sc.clientHeight + 1) break;
    sc = sc.parentElement;
  }
  if (!sc || sc === document.body) return;
  const top = sec.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 6;
  try { sc.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' }); } catch (e) { sc.scrollTop = top; }
}
function closetClosed() {
  tryOn = {};
  $('#cl-pop').hidden = true;
  if (clR) { clR.setBoard(null); clR.pause(); }
  applyLook();
  renderClosetBtn();
}
// 試試消除特效：預覽盤面上連續爆三下
function closetDemo() {
  if (!clR) return;
  audio.play('pop', { cascade: 1 });
  [[0, 1], [1, 2], [2, 0]].forEach(([r, c], i) => setTimeout(() => { if (clR && isOpen('m-closet')) { clR.demoBurst(r, c); audio.play('pop', { cascade: i + 1 }); } }, i * 220));
}
function unlockText(it) {
  const u = it.unlock;
  if (!u) return '';
  if (u.coins) return `${u.coins} 枚兌換`;
  if (u.stars) return `★ ${u.stars} 解鎖`;
  if (u.chest != null) return `寶箱 ★${CHESTS[u.chest].stars}`;
  return '';
}
function renderCloset() {
  const stars = save.stars, coins = closet.coins(stars);
  setNum($('#cl-coins'), coins);
  setNum($('#cl-stars'), totalStars(stars));
  $('#cl-stars-max').textContent = '/ ' + (LEVELS ? LEVELS.length * 3 : 0);
  // 分類頁籤
  const tabs = $('#cl-tabs');
  tabs.innerHTML = '';
  for (const c of CATEGORIES) {
    const b = el('button', 'cl-tab' + (c.id === clCat ? ' on' : ''));
    b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', c.id === clCat ? 'true' : 'false');
    b.textContent = c.name;
    b.addEventListener('click', () => { if (clCat === c.id) return; clCat = c.id; audio.play('tap'); renderCloset(); });
    tabs.appendChild(b);
  }
  // 這一類的外觀
  const grid = $('#cl-grid');
  grid.innerHTML = '';
  const equipped = closet.look(stars)[clCat];
  for (const it of ITEMS.filter(x => x.cat === clCat)) {
    const unlocked = closet.isUnlocked(it, stars), on = unlocked && it.id.split('.')[1] === equipped && !tryOn[clCat];
    const trying = tryOn[clCat] === it.id;
    const can = !unlocked && closet.canBuy(it, stars);
    const b = el('button', 'cl-item' + (on ? ' on' : '') + (unlocked ? '' : ' locked') + (can ? ' can' : '') + (trying ? ' trying' : ''));
    b.type = 'button';
    const pic = el('span', 'ci-pic' + (it.cat === 'hat' ? ' hat' : ''));
    const img = new Image(); img.alt = ''; img.src = svgUrl(iconSvg(it.id)); img.draggable = false;
    pic.appendChild(img);
    if (!unlocked) { const lk = el('span', 'ci-lock'); lk.innerHTML = '<svg><use href="#i-lock"/></svg>'; pic.appendChild(lk); }
    b.appendChild(pic);
    b.appendChild(el('span', 'ci-name', it.name));
    const stt = el('span', 'ci-state');
    if (on) stt.textContent = '穿著中';
    else if (unlocked) stt.textContent = trying ? '試穿中' : '點一下穿上';
    else if (it.unlock.coins) { stt.appendChild(coinEl()); stt.appendChild(document.createTextNode(trying && can ? `${it.unlock.coins} 再點一下兌換` : unlockText(it))); }
    else stt.textContent = unlockText(it);
    b.appendChild(stt);
    b.addEventListener('click', () => onClosetItem(it));
    grid.appendChild(b);
  }
  $('#cl-try').hidden = !Object.keys(tryOn).length;
  // 寶箱：有可以開的，衣櫃最上面放一條提示，點了捲到寶箱區
  const readyN = closet.readyChests(stars).length;
  const rb = $('#cl-ready');
  rb.hidden = !readyN;
  rb.textContent = readyN ? `有 ${readyN} 個寶箱可以開 ↓` : '';
  const box = $('#cl-chests');
  box.innerHTML = '';
  CHESTS.forEach((ch, i) => {
    const stt = closet.chestState(i, stars);
    const b = el('button', 'cl-chest ' + stt);
    b.type = 'button';
    b.setAttribute('aria-label', `寶箱：星星 ${ch.stars} 顆（${stt === 'open' ? '開過了' : stt === 'ready' ? '可以開了' : '還沒到'}）`);
    b.appendChild(el('span', 'cc-box'));
    b.appendChild(el('span', 'cc-need', `★${ch.stars}`));
    if (stt === 'ready') b.addEventListener('click', () => openChest(i));
    else b.addEventListener('click', () => toast(stt === 'open' ? `開過了：${ch.name}` : `星星總數到 ${ch.stars} 顆就能開：${ch.name}`, 1700));
    box.appendChild(b);
  });
}
function onClosetItem(it) {
  const stars = save.stars;
  if (closet.isUnlocked(it, stars)) {
    closet.equip(it, stars);
    delete tryOn[it.cat];
    audio.play('select');
    applyLook(); renderCloset(); renderClosetBtn();
    if (it.cat === 'fx') setTimeout(closetDemo, 120);
    return;
  }
  const u = it.unlock || {};
  if (u.coins && tryOn[it.cat] === it.id && closet.canBuy(it, stars)) {
    // 第二下：兌換 + 穿上
    closet.buy(it, stars);
    closet.equip(it, stars);
    delete tryOn[it.cat];
    audio.play('special');
    toast(`兌換成功！穿上「${it.name}」`, 1600);
    applyLook(); renderCloset(); renderClosetBtn();
    return;
  }
  // 沒解鎖：先試穿（預覽盤面上看得到），告訴玩家怎麼拿
  tryOn[it.cat] = it.id;
  audio.play('tap');
  if (clR) clR.setLook(previewLook());
  if (it.cat === 'fx') setTimeout(closetDemo, 120);
  const need = u.coins ? u.coins - closet.coins(stars) : 0;
  if (u.coins) toast(need > 0 ? `試穿中～還差 ${need} 枚三星造型幣，去拿三星吧！` : `試穿中～再點一下，用 ${u.coins} 枚造型幣兌換`, 2000);
  else if (u.stars) toast(`試穿中～星星總數到 ${u.stars} 顆就會解鎖（現在 ${totalStars(stars)} 顆）`, 2000);
  else if (u.chest != null) toast(`試穿中～星星總數 ${CHESTS[u.chest].stars} 顆的寶箱開得到`, 2000);
  renderCloset();
}
// 開寶箱：寶箱抖一抖 → 蓋子彈開 → 獎勵一個一個跳出來；開到的外觀直接穿上
function openChest(i) {
  const res = closet.openChest(i, save.stars);
  if (!res) return;
  const pop = $('#cl-pop'), items = $('#cp-items'), chest = $('#cp-chest');
  items.innerHTML = '';
  for (const it of res.items) {
    const d = el('span', 'cp-item');
    const img = new Image(); img.alt = ''; img.src = svgUrl(iconSvg(it.id));
    d.appendChild(img); d.appendChild(el('small', '', it.name));
    items.appendChild(d);
    closet.equip(it, save.stars);
  }
  if (res.coins) {
    const d = el('span', 'cp-item coins');
    d.appendChild(coinEl(true)); d.appendChild(el('small', '', `造型幣 +${res.coins}`));
    items.appendChild(d);
  }
  $('#cp-text').textContent = `打開了「${CHESTS[i].name}」！`;
  pop.hidden = false;
  restartAnim(chest, 'opening');
  restartAnim(items, 'reveal');
  audio.play('chime', { level: 6 });
  setTimeout(() => audio.play('win'), 450);
  applyLook(); renderClosetBtn();
}

// ---------- 對話框 ----------
let lastFocus = null;
let usingKeyboard = false;
document.addEventListener('keydown', e => { if (e.key === 'Tab' || e.key === 'Enter' || e.key === ' ') usingKeyboard = true; }, true);
document.addEventListener('pointerdown', () => { usingKeyboard = false; }, true);
function openModal(id) {
  const m = document.getElementById(id);
  lastFocus = document.activeElement;
  m.classList.add('open');
  m.setAttribute('aria-hidden', 'false');
  document.documentElement.dataset.modal = '1';     // CSS：有對話框（模糊遮罩）時背景的漂浮光點停住
  // 對話框蓋住盤面時，盤面不用重畫（待機動畫在模糊的遮罩後面看不清楚；後面每一幀都在變的話，模糊也得每一幀重算）。
  // renderer 暫停時 play() 的流程照樣用 setTimeout 走完，只是不畫；關掉最後一個對話框再接回來
  if (R) R.pause();
  // 鍵盤使用者才自動把焦點移進去（觸控 / 滑鼠不需要焦點框）
  const f = m.querySelector('.btn.green, .btn');
  if (f && usingKeyboard) setTimeout(() => { try { f.focus({ preventScroll: true }); } catch (e) {} }, 60);
}
function closeModal(id) {
  const m = document.getElementById(id);
  if (!m.classList.contains('open')) return;
  m.classList.remove('open');
  m.setAttribute('aria-hidden', 'true');
  if (id === 'm-merge' && mergeAnswer) mergeAnswer(false);
  if (id === 'm-closet') closetClosed();
  if (!document.querySelector('.modal.open')) { delete document.documentElement.dataset.modal; if (R) R.resume(); }
  if (usingKeyboard && lastFocus && lastFocus.focus) { try { lastFocus.focus({ preventScroll: true }); } catch (e) {} }
}
const isOpen = id => document.getElementById(id).classList.contains('open');
// 「帶進帳號？」不跟著換畫面關掉（它在等玩家回答，換帳號的流程停在那裡）
function closeAllModals() { for (const m of $$('.modal.open')) if (m.id !== 'm-merge') closeModal(m.id); }

let toastTimer = 0;
function toast(text, ms = 1500) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------- 載入 ----------
function setProgress(f) {
  const pct = Math.round(clamp(f, 0, 1) * 100);
  $('#load-fill').style.width = pct + '%';
  $('.loadbar').setAttribute('aria-valuenow', String(pct));
}

// ---------- 標題 ----------
function buildTitle() {
  const box = $('#title-toys');
  box.innerHTML = '';
  TITLE_TOYS.forEach((p, k) => {
    const b = el('button', 'ttoy');
    b.style.setProperty('--k', k);
    setToyColors(b, p.color);              // 展示台用玩具的代表色（跟盤面上的糖果同色）
    b.setAttribute('aria-label', p.name);
    b.appendChild(el('span', 'ped'));      // 3D 展示台（不跟著跳）
    b.appendChild(el('span', 'shadow'));   // 腳下的接觸陰影
    const lift = el('span', 'lift');       // 跳的是這一層
    lift.style.setProperty('--foot', toyFoot(toyImg(p)).toFixed(3));
    const face = el('span', 'face');
    face.appendChild(toyEl(p, 48));
    lift.appendChild(face);
    const e = images.get(p.id) || {}, spin = e.spinClean || e.spin;
    if (spin) {
      const sp = el('span', 'spinner');
      sp.style.backgroundImage = `url("${spin.src}")`;
      const ss = e.spinScale;
      if (ss && ss !== 1) sp.style.transform = `scale(${(1 / ss).toFixed(3)})`;
      lift.appendChild(sp);
    }
    b.appendChild(lift);
    b.addEventListener('click', () => {
      audio.play('select');
      restartAnim(b, 'boing');
      if (spin) {
        b.classList.remove('spinning'); void b.offsetWidth; b.classList.add('spinning');
        clearTimeout(b._t); b._t = setTimeout(() => b.classList.remove('spinning'), 1050);
      } else {
        restartAnim(b, 'wobble');
      }
    });
    b.addEventListener('animationend', e => { if (e.animationName === 'boing') b.classList.remove('boing'); if (e.animationName === 'wobble') b.classList.remove('wobble'); });
    box.appendChild(b);
  });
}

// ---------- 關卡地圖 ----------
const MAP_GAP = 116, MAP_TOP = 150, MAP_BOTTOM = 110;
let mapNodes = [];
let mapSt = [], mapArtKey = '', mapArtStr = '';   // 目前畫的各站範圍、背景快取（寬度|關卡數）
function isUnlocked(i) { return i < save.unlocked; }
function currentIndex() { return clamp(save.unlocked, 1, LEVELS.length) - 1; }
function nodePos(i, n, H) {
  return { x: 50 + 27 * Math.sin(i * 1.05 + 0.4), y: H - MAP_BOTTOM - i * MAP_GAP };
}
function smoothPath(pts) {
  if (!pts.length) return '';
  let d = `M${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C${c1.x.toFixed(2)} ${c1.y.toFixed(1)} ${c2.x.toFixed(2)} ${c2.y.toFixed(1)} ${p2.x.toFixed(2)} ${p2.y.toFixed(1)}`;
  }
  return d;
}
function goalBadge(lvl) {
  const g0 = lvl.goal || {};
  // 王關（好幾個目標）：照第一個目標顯示
  const first = g0.type === 'mix' ? goalPartsOf(lvl)[0] : null;
  const g = first && first.kind === 'collect' ? { type: 'collect', items: { [first.id]: first.need } }
    : first && first.kind === 'jelly' ? { type: 'jelly' } : g0;
  const b = el('span', 'badge');
  if (g.type === 'collect') {
    const id = Object.keys(g.items || {})[0];
    const p = pieceById(id);
    if (p) {
      // 要收集的玩具：裝在和果凍 / 分數同一套的小圓徽章裡（外圈是那隻玩具的糖果色），玩具稍微探出圓框
      b.classList.add('toy');
      setToyColors(b, p.color);
      b.appendChild(toyEl(p, 12));
    }
  } else if (g.type === 'jelly') {
    b.classList.add('jelly');
  } else if (PART_ICON[(goalPartsOf(lvl)[0] || {}).kind]) {
    // 機關關卡：第一個目標的小圖（龍龍 / 糖霜 / 巧克力 / 籠子）
    b.classList.add('toy', 'mech');
    setToyColors(b, '#9fe8c0');
    b.appendChild(PART_ICON[goalPartsOf(lvl)[0].kind]());
  } else {
    b.classList.add('score');
    b.appendChild(starSvg());
  }
  return b;
}
function buildMap(popIndex = -1) {
  const inner = $('#map-inner');
  inner.innerHTML = '';
  const n = LEVELS.length;
  const H = MAP_TOP + (n - 1) * MAP_GAP + MAP_BOTTOM;
  inner.style.height = H + 'px';
  const pts = LEVELS.map((_, i) => nodePos(i, n, H));
  const cur = currentIndex();

  // 24 站的風景墊在最底下（寬度一樣就用上次畫好的）
  const art = el('div', 'map-art');
  art.innerHTML = mapArt(inner, n, H);
  inner.appendChild(art);
  mapSt = mapStations(n, H);

  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('class', 'map-path');
  svg.setAttribute('viewBox', `0 0 100 ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.style.height = H + 'px';
  const full = smoothPath(pts);
  const done = smoothPath(pts.slice(0, cur + 1));
  const mk = (cls, d, dy = 0) => {
    const p = document.createElementNS(SVGNS, 'path');
    p.setAttribute('class', cls); p.setAttribute('d', d);
    if (dy) p.setAttribute('transform', `translate(0 ${dy})`);
    svg.appendChild(p);
  };
  // 立體的糖果軌道：投影 → 側面厚度 → 路面 → 上緣受光的亮面 → 一顆顆有反光的糖珠
  mk('road-shadow', full, 12);
  mk('road-side', full, 7);
  mk('road-edge', full);
  mk('road', full);
  mk('road-hi', full, -5);
  if (cur > 0) { mk('road-done-side', done, 7); mk('road-done', done); mk('road-done-hi', done, -4); }
  mk('road-dots', full);
  mk('road-dots-hi', full, -1.6);
  if (cur > 0) { mk('road-dots-done', done); mk('road-dots-done-hi', done, -1.6); }
  inner.appendChild(svg);

  // 站牌和駐站娃娃（還沒走到的站，娃娃是灰色的）
  inner.insertAdjacentHTML('beforeend', mapSignsHTML(n, H, save.unlocked));

  // 關卡按鈕
  mapNodes = [];
  LEVELS.forEach((lvl, i) => {
    const p = pts[i];
    const unlocked = isUnlocked(i);
    const stars = Number(save.stars[lvl.id]) || 0;
    const b = el('button', 'node');
    b.style.left = p.x + '%';
    b.style.top = p.y + 'px';
    if (!unlocked) {
      b.classList.add('locked');
      b.setAttribute('aria-label', `第 ${i + 1} 關（還沒解鎖）`);
      // 鎖住的關卡也顯示關卡編號（灰色），鎖頭當角落小徽章
      b.appendChild(el('span', 'num', String(i + 1)));
      b.insertAdjacentHTML('beforeend', '<span class="lock-badge" aria-hidden="true"><svg class="lock"><use href="#i-lock"/></svg></span>');
      b.addEventListener('click', () => { audio.play('invalid'); toast('先過前面的關卡喔！', 1200); });
    } else {
      b.classList.add(i === cur && stars === 0 ? 'current' : 'done');
      if (i === cur && stars === 0 && i === popIndex) b.classList.add('unlock-pop');
      b.setAttribute('aria-label', `第 ${i + 1} 關，${stars} 顆星`);
      b.appendChild(el('span', 'num', String(i + 1)));
      const st = el('span', 'nstars');
      for (let k = 0; k < 3; k++) st.appendChild(starSvg(k < stars ? 'on' : ''));
      b.appendChild(st);
      b.appendChild(goalBadge(lvl));
      b.addEventListener('click', () => openStartCard(i));
    }
    inner.appendChild(b);
    mapNodes.push(b);
  });

  // 頭像放在底部固定列（以前站在目前關卡旁邊，第 1 關時會跟衣櫃擠在一起）；目前關卡改用放大＋光暈標出來
  const ava = $('#dk-ava');
  if (ava) ava.replaceChildren(toyEl(TITLE_TOYS[1] || TITLE_TOYS[0], 22));   // 中間那隻（薯餅）當頭像

  const end = el('span', 'map-end', '更多關卡製作中…');
  end.style.top = (MAP_TOP * 0.42) + 'px';
  inner.appendChild(end);

  // 星星總數
  const total = LEVELS.reduce((s, l) => s + (Number(save.stars[l.id]) || 0), 0);
  setNum($('#map-stars'), total);
  $('#map-stars-max').textContent = '/ ' + n * 3;
  return pts;
}
// 地圖背景：只跟地圖寬度和關卡數有關，同一個寬度畫一次就好
function mapArt(inner, n, H) {
  const W = Math.round(inner.clientWidth) || 375, key = W + '|' + n;
  if (key !== mapArtKey) { mapArtKey = key; mapArtStr = mapArtHTML(W, n, H); }
  return mapArtStr;
}
// 換了寬度（轉向、視窗變大變小）才重畫背景；路、關卡、站牌都是用 % 排的，不用動
function refreshMapArt() {
  const inner = $('#map-inner'), art = inner && $('.map-art', inner);
  if (!art) return;
  const W = Math.round(inner.clientWidth);
  if (!W || Math.abs(W - (parseInt(mapArtKey, 10) || 0)) <= 2) return;
  const n = LEVELS.length;
  art.innerHTML = mapArt(inner, n, MAP_TOP + (n - 1) * MAP_GAP + MAP_BOTTOM);
}
// 右上角顯示畫面中間是哪一站
function updateMapHere() {
  const pill = $('#map-here'), sc = $('#map-scroll');
  if (!pill || !sc || !mapSt.length) return;
  const r = stationAt(mapSt, sc.scrollTop + sc.clientHeight / 2);
  if (pill.dataset.k === r.k + '|' + r.to) return;
  pill.dataset.k = r.k + '|' + r.to;
  pill.innerHTML = `第${r.k}站・${r.name}<small>第${r.from}～${r.to}關</small>`;
}
// 地圖捲到某個高度的關卡：讓它停在可視範圍偏下（約 58% 的位置）
function mapTarget(y) { const sc = $('#map-scroll'); return clamp(y - sc.clientHeight * 0.58, 0, sc.scrollHeight); }
function scrollMapToCurrent() {
  const node = mapNodes[currentIndex()];
  if (node) $('#map-scroll').scrollTo({ top: mapTarget(parseFloat(node.style.top) || 0), behavior: 'smooth' });
}
function showMap({ pop = -1, thenOpen = -1 } = {}) {
  const pts = buildMap(pop);
  renderClosetBtn();
  show('map');
  const sc = $('#map-scroll');
  const cur = currentIndex();
  const target = idx => mapTarget(pts[idx].y);
  if (pop > 0) {
    sc.scrollTop = target(pop - 1);
    requestAnimationFrame(() => sc.scrollTo({ top: target(pop), behavior: 'smooth' }));
  } else {
    sc.scrollTop = target(cur);
  }
  updateMapHere();
  if (thenOpen >= 0) setTimeout(() => { if (screen === 'map') openStartCard(thenOpen); }, 750);
}

// ---------- 目標文字 ----------
function scoreTarget(lvl) { return (lvl.goal && lvl.goal.target) || (lvl.stars && lvl.stars[0]) || 0; }
// Candy Crush 規則（levels.js 的 isScoreLevel / passScore / starsFor；這裡只是備用）
const isScoreLevel = lvl => (levMod.isScoreLevel ? levMod.isScoreLevel(lvl) : !['collect', 'jelly'].includes(lvl && lvl.goal && lvl.goal.type));
const passScore = lvl => (levMod.passScore ? levMod.passScore(lvl) : scoreTarget(lvl));
const starsFor = (lvl, score) => (levMod.starsFor ? levMod.starsFor(lvl, score) : clamp(((lvl && lvl.stars) || []).filter(t => score >= t).length, 1, 3));
function goalText(lvl) {
  const g = lvl.goal || {};
  if (g.type === 'collect') {
    // 名字和數量之間用不斷行空格（ ）：關卡開始的橫幅換行時，名字和數量不會被拆開
    return '收集 ' + Object.entries(g.items || {}).map(([id, n]) => `${(pieceById(id) || { name: id }).name} ×${n}`).join('、');
  }
  if (g.type === 'jelly') return '把果凍全部清掉！';
  if (['dino', 'clear', 'mix'].includes(g.type)) {
    const out = [];
    for (const part of goalPartsOf(lvl)) {
      if (part.kind === 'collect') out.push(`收集 ${(pieceById(part.id) || { name: part.id }).name} ×${part.need}`);
      else if (part.kind === 'jelly') out.push('清掉全部果凍');
      else if (part.kind === 'dino') out.push(`救出 ${part.need} 隻龍龍`);
      else if (part.kind === 'frost') out.push('敲掉全部糖霜');
      else if (part.kind === 'choco') out.push('清光巧克力');
      else if (part.kind === 'cage') out.push('打開全部鐵籠子');
    }
    return out.join('、') + '！';
  }
  return `拿到 ${fmt(scoreTarget(lvl))} 分`;
}

// ---------- 中文換行 ----------
// 提示泡泡是 keep-all（中文只在標點後換行），可是一句話最後一段太長時，句尾的「～」「！」會自己掉到下一行。
// 用 Intl.Segmenter 斷詞，在詞跟詞之間放零寬空格（可以換行的地方）；角色名字和遊戲用語不拆開，句尾標點黏住前一個字。
const KEEP_WORDS = ['毛絨', '果凍', '甜甜圈', '包裝糖', '彩色炸彈', '條紋方塊', '變出', '正中間', '飛天玩偶', '長翅膀',
  '龍龍', '鐵籠子', '糖霜', '巧克力', '甘草糖', '漩渦糖', '傳送門', '出口'];
const NO_LINE_START = /^[，、。！？～：；）」』…]/;
const zhSeg = (() => {
  try {
    const s = new Intl.Segmenter('zh-TW', { granularity: 'word' });
    return [...s.segment('彩色炸彈')].length <= 2 ? s : null;   // 沒有中文詞典的環境會一字一段，那就不用（維持 keep-all）
  } catch (e) { return null; }
})();
function softWrap(text) {
  if (!zhSeg || !text) return text;
  let out = '', prevWord = false;
  for (const { segment, isWordLike } of zhSeg.segment(text)) {
    if (isWordLike) { out += (prevWord ? '​' : '') + segment; prevWord = true; }
    else { out += (NO_LINE_START.test(segment) ? '⁠' : '') + segment; prevWord = false; }
  }
  for (const w of [...PIECES.map(p => p.name), ...KEEP_WORDS]) {
    if (w.length > 1) out = out.replace(new RegExp([...w].join('​?'), 'g'), w);
  }
  return out;
}

// ---------- 關卡開始卡 ----------
let cardLevel = -1;
function openStartCard(i) {
  const lvl = LEVELS[i];
  cardLevel = i;
  $('#ms-title').textContent = `第 ${i + 1} 關`;
  const stars = Number(save.stars[lvl.id]) || 0;
  const st = $('#ms-stars');
  st.innerHTML = '';
  for (let k = 0; k < 3; k++) st.appendChild(starSvg(k < stars ? 'on' : ''));
  const g = $('#ms-goal');
  g.innerHTML = '';
  const goal = lvl.goal || {};
  if (goal.type === 'collect') {
    for (const [id, n] of Object.entries(goal.items || {})) {
      const p = pieceById(id);
      if (!p) continue;
      const gb = el('div', 'gb toy');          // 跟上方的目標一樣站在糖果色的泡泡上（CSS）
      setToyColors(gb, p.color);
      const ic = el('span', 'ic'); ic.appendChild(toyEl(p, 30));
      gb.appendChild(ic); gb.appendChild(numEl('b', '×' + n));
      g.appendChild(gb);
    }
  } else if (goal.type === 'jelly') {
    const gb = el('div', 'gb');
    const ic = el('span', 'ic'); ic.appendChild(jellyIcon());
    gb.appendChild(ic); gb.appendChild(numEl('b', '果凍'));
    g.appendChild(gb);
  } else if (['dino', 'clear', 'mix'].includes(goal.type)) {
    for (const part of goalPartsOf(lvl)) {
      const gb = el('div', 'gb');
      const ic = el('span', 'ic');
      if (part.kind === 'collect') {
        const p = pieceById(part.id);
        if (!p) continue;
        gb.classList.add('toy'); setToyColors(gb, p.color);
        ic.appendChild(toyEl(p, 30));
        gb.appendChild(ic); gb.appendChild(numEl('b', '×' + part.need));
      } else if (part.kind === 'jelly') {
        ic.appendChild(jellyIcon());
        gb.appendChild(ic); gb.appendChild(numEl('b', '果凍'));
      } else {
        ic.appendChild(PART_ICON[part.kind]());
        gb.appendChild(ic); gb.appendChild(numEl('b', part.kind === 'dino' ? '×' + part.need : PART_NAME[part.kind]));
      }
      g.appendChild(gb);
    }
  } else {
    const gb = el('div', 'gb');
    const ic = el('span', 'ic'); ic.appendChild(starSvg());
    gb.appendChild(ic); gb.appendChild(numEl('b', fmt(scoreTarget(lvl))));
    g.appendChild(gb);
  }
  // 目標只寫一次：一到兩個目標時數字放大、放在圖示右邊（.row）；三個以上維持上下排，不然窄螢幕放不下
  g.setAttribute('aria-label', '目標：' + goalText(lvl));
  g.classList.toggle('row', g.children.length <= 2);
  g.classList.toggle('many', g.children.length > 3); // 四、五個目標：窄螢幕也要能換行
  setNum($('#ms-moves'), lvl.moves);
  const hint = lvl.hint || '';
  $('#ms-hint-box').hidden = !hint;
  $('#ms-hint').textContent = softWrap(hint);
  const av = $('#ms-avatar');
  av.innerHTML = '';
  av.appendChild(toyEl(TITLE_TOYS[i % TITLE_TOYS.length], 24));
  openModal('m-start');
}

// ---------- 遊戲狀態 ----------
let R = null;            // renderer
let engine = null;
let level = null, levelIdx = 0;
let state = 'idle';      // idle | intro | play | ending | won | lost
let session = 0;         // 換關 / 離開時 +1，舊的非同步流程看到就停
let movesLeft = 0, dispMoves = 0;
let dispScore = 0, shownScore = 0;
let liveCleared = {};
let jellyLive = 0, jellyCountsLayers = true;
// 機關目標的即時數字：救出的龍龍、還剩的糖霜層數 / 巧克力 / 鐵籠子（跟著每一步的事件更新）
let mechLive = { dino: 0, frost: 0, choco: 0, cage: 0 };
function countBlocks(board, lock) {
  const o = { frost: 0, choco: 0 };
  let cage = 0;
  for (const row of board || []) for (const p of row || []) if (p && p.block) { if (p.block === 'frost') o.frost += p.hp | 0; else if (p.block === 'choco') o.choco++; }
  for (const row of lock || []) for (const v of row || []) if (v) cage++;
  return { ...o, cage };
}
let selected = null;
let moving = false;
let sugarMode = false;
let debugWin = false;
let hintTimer = 0;
let goalRefs = [];
let lowWarned = false;
const attempts = {};

const canvas = $('#board');

function waitIdle(max = 9000) {
  return new Promise(res => {
    const t0 = performance.now();
    (function chk() {
      if (!R || !R.busy || performance.now() - t0 > max) res();
      else setTimeout(chk, 50);
    })();
  });
}

function boardDims(lvl) {
  const m = lvl.mask || lvl.jelly;
  if (Array.isArray(m) && m.length) return { rows: m.length, cols: Math.max(...m.map(r => r.length)) };
  return { rows: lvl.rows || 8, cols: lvl.cols || 8 };
}

function sumJelly(j, layers) {
  let n = 0;
  if (!Array.isArray(j)) return 0;
  for (const row of j) for (const v of row || []) if (v > 0) n += layers ? v : 1;
  return n;
}

async function startLevel(idx) {
  sugarBonus = 0;
  boosterMode = null; boosterFirst = null; renderBoosters();
  closeAllModals();
  session++;
  const token = session;
  state = 'idle';
  clearHint();
  await waitIdle();
  if (token !== session) return;

  levelIdx = idx;
  level = LEVELS[idx];
  attempts[idx] = (attempts[idx] == null ? 0 : attempts[idx] + 1);
  const baseSeed = Number.isFinite(level.seed) ? level.seed : 1 + idx;
  const seed = attempts[idx] === 0 ? baseSeed : ((baseSeed * 2654435761) ^ (attempts[idx] * 40503)) >>> 0;
  const kinds = (level.kinds || PIECES.slice(0, 5).map(p => p.id)).map(kindOf).filter(k => k >= 0);
  const dims = boardDims(level);
  const opts = { rows: dims.rows, cols: dims.cols, kinds, mask: level.mask || null, jelly: level.jelly || null, seed };
  if (level.antiCascade != null) opts.antiCascade = level.antiCascade;
  if (level.goal && level.goal.type === 'collect') {      // 飛天玩偶優先飛去目標還要收集的毛絨
    opts.collect = {};
    for (const [id, n] of Object.entries(level.goal.items || {})) { const k = kindOf(id); if (k >= 0) opts.collect[k] = n; }
  }
  if (levMod.mechOpts) Object.assign(opts, levMod.mechOpts(level));     // 盤面機關
  engine = createEngine(opts);

  movesLeft = dispMoves = level.moves;
  dispScore = shownScore = 0;
  liveCleared = {};
  resetFlights();
  selected = null;
  moving = false;
  sugarMode = false;
  debugWin = false;
  lowWarned = false;
  const snap = engine.snapshot();
  const layers = sumJelly(snap.jelly, true), cells = sumJelly(snap.jelly, false);
  const statJ = engine.stats ? engine.stats.jellyLeft : layers;
  jellyCountsLayers = statJ === layers || layers === cells;
  jellyLive = statJ;
  const st0 = engine.stats || {};
  mechLive = { dino: st0.dinosOut | 0, frost: st0.frostLeft | 0, choco: st0.chocoLeft | 0, cage: st0.locksLeft | 0 };

  setNum($('#hud-level'), idx + 1);
  buildGoal();
  renderMoves();
  renderScore(true);
  resetCheer();
  $('#btn-pause').disabled = false;

  show('game');
  R.select(null);
  R.hint(null);
  R.setBoard(snap);
  sizeBoard();
  requestAnimationFrame(() => { if (token === session) sizeBoard(); });

  state = 'intro';
  await sleep(380);
  if (token !== session) return;
  await showIntros(level, token);
  if (token !== session) return;
  await R.banner(`第 ${idx + 1} 關`, { sub: goalText(level), duration: 1500 });
  if (token !== session) return;
  state = 'play';
  scheduleHint();
  try { cellSize(); } catch (e) { /* 第一次拖曳時再量 */ }   // 先量好格子大小，第一次拖曳不用等
}

function leaveToMap(opts) {
  session++;
  resetFlights();
  state = 'idle';
  clearHint();
  closeAllModals();
  waitIdle(4000).then(() => showMap(opts));
}

// ---------- 盤面大小 ----------
let cellPx = 0;
let cellCenters = null;
function sizeBoard() {
  if (!R) return;
  const wrap = $('#board-wrap');
  const W = wrap.clientWidth, H = wrap.clientHeight;
  if (W < 10 || H < 10) return;
  const rows = (engine && engine.rows) || 8, cols = (engine && engine.cols) || 8;
  let w = W, h = W * rows / cols;
  if (h > H) { h = H; w = H * cols / rows; }
  canvas.style.width = Math.floor(w) + 'px';
  canvas.style.height = Math.floor(h) + 'px';
  try { R.layout(); } catch (e) { console.error(e); }
  cellPx = 0;
  cellCenters = null;
}
// 從 renderer.cellAt 量出格子大小（拖曳門檻要用）
function measureCell() {
  const rect = canvas.getBoundingClientRect();
  const rows = engine.rows, cols = engine.cols;
  const fallback = Math.min(rect.width / cols, rect.height / rows) || 40;
  const widths = [];
  for (const fy of [0.31, 0.5, 0.69]) {
    const y = rect.top + rect.height * fy;
    let prev, start = null;
    for (let x = Math.floor(rect.left); x <= rect.right; x++) {
      const c = R.cellAt(x, y);
      const key = c ? c.c : null;
      if (prev === undefined) { prev = key; start = key != null ? x : null; continue; }
      if (key !== prev) {
        if (prev != null && key != null && start != null) widths.push(x - start);
        start = key != null ? x : null;
        prev = key;
      }
    }
  }
  if (!widths.length) return fallback;
  widths.sort((a, b) => a - b);
  return widths[widths.length >> 1] || fallback;
}
function cellSize() { if (!cellPx) cellPx = measureCell(); return cellPx; }
// 測試用：每一格在畫面上的中心點
function computeCenters() {
  const rect = canvas.getBoundingClientRect();
  const acc = {};
  for (let y = rect.top + 1; y < rect.bottom; y += 3) {
    for (let x = rect.left + 1; x < rect.right; x += 3) {
      const c = R.cellAt(x, y);
      if (!c) continue;
      const k = c.r + ',' + c.c;
      const a = acc[k] || (acc[k] = { x: 0, y: 0, n: 0 });
      a.x += x; a.y += y; a.n++;
    }
  }
  const out = {};
  for (const k in acc) out[k] = { x: acc[k].x / acc[k].n, y: acc[k].y / acc[k].n };
  return out;
}

// ---------- HUD ----------
function buildGoal() {
  const box = $('#hud-goal');
  box.innerHTML = '';
  goalRefs = [];
  const g = level.goal || {};
  const mkItem = (icon, kind) => {
    const gi = el('div', 'gi');
    const ic = el('span', 'ic');
    ic.appendChild(icon);
    gi.appendChild(ic);
    const lft = el('small', 'lft');          // 數字上面的小字（改版 2026-11）
    lft.textContent = kind === 'score' ? '目標' : '還差';
    lft.setAttribute('aria-hidden', 'true');
    gi.appendChild(lft);
    const cnt = el('span', 'cnt');
    gi.appendChild(cnt);
    gi.appendChild(el('span', 'check'));
    box.appendChild(gi);
    const ref = { gi, cnt, kind, last: null };
    goalRefs.push(ref);
    return ref;
  };
  if (g.type === 'collect') {
    for (const [id, n] of Object.entries(g.items || {})) {
      const p = pieceById(id);
      if (!p) continue;
      const r = mkItem(toyEl(p, 20), 'collect');
      r.k = kindOf(id); r.need = n;
      r.gi.classList.add('toy');            // 站在自己糖果色的泡泡上（CSS）
      setToyColors(r.gi, p.color);
      r.gi.setAttribute('aria-label', `${p.name} 還差 ${n}`);
    }
  } else if (g.type === 'jelly') {
    mkItem(jellyIcon(), 'jelly');
  } else if (['dino', 'clear', 'mix'].includes(g.type)) {
    for (const part of goalPartsOf(level)) {
      if (part.kind === 'collect') {
        const p = pieceById(part.id);
        if (!p) continue;
        const r = mkItem(toyEl(p, 20), 'collect');
        r.k = kindOf(part.id); r.need = part.need;
        r.gi.classList.add('toy');
        setToyColors(r.gi, p.color);
      } else if (part.kind === 'jelly') mkItem(jellyIcon(), 'jelly');
      else {
        const r = mkItem(PART_ICON[part.kind](), part.kind);
        r.need = part.need || 0;
        r.gi.setAttribute('aria-label', PART_NAME[part.kind]);
      }
    }
  } else {
    const r = mkItem(starSvg(), 'score');
    r.gi.classList.add('score-goal');
  }
  box.dataset.n = goalRefs.length;          // 三種目標時圖示小一點才排得下
  box.parentElement.toggleAttribute('data-many', goalRefs.length >= 3);   // 三個以上：數字變成徽章，「還差」只寫一次在左上角（CSS）
  // 星星的位置固定在條子的 1/3、2/3 和尾端（條子照門檻分段走，見 starBarPct）
  $$('.sb-star').forEach((st, i) => { st.style.setProperty('--p', STAR_AT[i] + '%'); st.classList.remove('on'); });
  hud.on = hudEls().stars.map(() => false);
  hud.text = ''; hud.width = '';
  renderGoal(true);
}
function clearedOf(k) { return liveCleared[k] || 0; }
function renderGoal(init = false) {
  for (const r of goalRefs) {
    let txt, done = false;
    if (r.kind === 'collect') {
      // 還在飛向圖示的那幾顆先不扣（飛到了才扣，數字「ㄉㄨㄞ」一下）
      const left = Math.max(0, r.need - clearedOf(r.k) + (flyIn[r.k] || 0));
      txt = String(left); done = left === 0;
    } else if (r.kind === 'jelly') {
      const left = Math.max(0, jellyLive + flyJelly);
      txt = String(left); done = left <= 0;
    } else if (r.kind === 'dino') {
      const left = Math.max(0, r.need - mechLive.dino + flyDino);      // 飛到圖示了才扣
      txt = String(left); done = left <= 0;
    } else if (r.kind === 'frost' || r.kind === 'choco' || r.kind === 'cage') {
      const left = Math.max(0, mechLive[r.kind]);
      txt = String(left); done = left <= 0;
    } else {
      const t = scoreTarget(level);
      txt = fmt(t); done = shownScore >= t;
    }
    if (r.last !== txt) {
      setNum(r.cnt, txt);
      if (!init && r.kind !== 'score') { restartAnim(r.gi.querySelector('.ic'), 'boing'); restartAnim(r.cnt, 'boing'); }
      r.last = txt;
    }
    r.gi.classList.toggle('done', done);
  }
}
function renderMoves() {
  setNum($('#hud-moves'), Math.max(0, dispMoves));
  $('#hud-moves-box').classList.toggle('low', state !== 'ending' && dispMoves <= 5 && dispMoves > 0);
}
// 分數往上跑：每幀只改一個數字（文字有變才寫），星星條的寬度只在目標分數改變時設一次，由 CSS transition 補間
let scoreRaf = 0;
const hud = { score: null, fill: null, stars: null, text: '', width: '', on: [] };
function hudEls() {
  if (!hud.score || !hud.score.isConnected) {
    hud.score = $('#hud-score'); hud.fill = $('#starbar-fill'); hud.stars = $$('.sb-star');
    hud.on = hud.stars.map(st => st.classList.contains('on'));
  }
  return hud;
}
// 星星條只改「怎麼顯示」：一星的刻度放在約 1/3，前段拉開，前幾步就看得到條子在漲。
// 0 → 一星門檻走到 33.3%，一星 → 二星走到 66.6%，二星 → 三星走到 97%，超過三星再補滿到 100%。
// 星星亮不亮還是照 paintScore 裡的分數門檻判斷，這裡不動
const STAR_AT = [33.3, 66.6, 97];
function starBarPct(score, s) {
  const a = Math.max(1, s[0] || 1), b = Math.max(a + 1, s[1] || a * 2), c = Math.max(b + 1, s[2] || b * 1.5);
  if (score <= 0) return 0;
  if (score < a) return STAR_AT[0] * score / a;
  if (score < b) return STAR_AT[0] + (STAR_AT[1] - STAR_AT[0]) * (score - a) / (b - a);
  if (score < c) return STAR_AT[1] + (STAR_AT[2] - STAR_AT[1]) * (score - b) / (c - b);
  return Math.min(100, STAR_AT[2] + (100 - STAR_AT[2]) * (score - c) / (c - b));
}
function renderScore(instant = false) {
  const h = hudEls();
  const s = level ? level.stars || [] : [];
  const w = clamp(starBarPct(dispScore, s), 0, 100).toFixed(1) + '%';
  if (instant) { shownScore = dispScore; if (h.fill) h.fill.style.width = w; h.width = w; paintScore(); return; }
  if (w !== h.width) { h.width = w; if (h.fill) h.fill.style.width = w; }
  if (scoreRaf) return;
  const step = () => {
    const diff = dispScore - shownScore;
    if (Math.abs(diff) < 1) { shownScore = dispScore; paintScore(); scoreRaf = 0; return; }
    shownScore += diff * 0.2 + Math.sign(diff) * 0.5;
    paintScore();
    scoreRaf = requestAnimationFrame(step);
  };
  scoreRaf = requestAnimationFrame(step);
}
function paintScore() {
  const h = hudEls();
  const txt = fmt(shownScore);
  if (txt !== h.text && h.score) { setNum(h.score, txt); h.score.dataset.len = txt.length; h.text = txt; }   // 位數多的時候 CSS 把字縮小
  const s = level ? level.stars || [] : [];
  h.stars.forEach((st, i) => {
    const on = s[i] != null && shownScore >= s[i];
    if (on === h.on[i]) return;
    h.on[i] = on;
    if (on) { st.classList.add('on'); if (state === 'play' || state === 'ending') audio.play('star', { n: i + 1 }); }
    else st.classList.remove('on');
  });
  if (goalRefs.length && goalRefs[0].kind === 'score') renderGoal();
}

// ---------- 加油團 ----------
function resetCheer() {
  const box = $('#cheer');
  box.className = 'cheer';
  if (!box.children.length) {
    TITLE_TOYS.forEach((p, k) => {
      const d = el('span', 'ct');
      d.style.setProperty('--k', k);
      d.appendChild(toyEl(p, 24));
      d.addEventListener('animationend', e => { if (e.animationName === 'cheerJump') d.classList.remove('jump'); });
      box.appendChild(d);
    });
  }
}
function cheer() {
  const box = $('#cheer');
  if (box.classList.contains('party') || box.classList.contains('sad')) return;
  for (const d of box.children) restartAnim(d, 'jump');
}

// ---------- 提示 ----------
function scheduleHint() {
  clearTimeout(hintTimer);
  hintTimer = setTimeout(showHint, 5000);
}
function showHint() {
  if (state !== 'play') return;
  if (moving || R.busy || ptr || boosterMode || $('.modal.open')) { scheduleHint(); return; }
  const h = engine.findHint();
  if (h) R.hint(h.a, h.b);
}
function clearHint() {
  clearTimeout(hintTimer);
  if (R) R.hint(null);
}

// ---------- 震動 ----------
// 手機（Android Chrome）上消除 / 特殊方塊時輕輕震一下；iOS Safari 沒有 navigator.vibrate，就不震。跟著「音效」開關。
let lastBuzz = 0;
function buzz(pattern, minGap = 70) {
  if (save.muted || typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;   // 還沒碰過螢幕：瀏覽器不准震
  const t = performance.now();
  if (t - lastBuzz < minGap) return;
  lastBuzz = t;
  try { navigator.vibrate(pattern); } catch (e) { /* 不支援就算了 */ }
}
const buzzLater = (delay, pattern, minGap) => { if (delay > 8) setTimeout(() => buzz(pattern, minGap), delay); else buzz(pattern, minGap); };

// ---------- 畫面時間點 → 音效 / 震動（renderer 告訴我們「幾毫秒後」爆、掃、炸，音效照那個時間排好）----------
const CUE_SOUND = { voice: 'voice', swap: 'swap', invalid: 'invalid', pop: 'pop', stripe: 'stripe', wrap: 'wrap', bomb: 'bomb', board: 'board',
  combo: 'combo', special: 'special', land: 'land', chime: 'chime', shuffle: 'shuffle', fish: 'fish',
  cage: 'cage', frost: 'frost', choco: 'choco', swirl: 'swirl', spread: 'spread', dino: 'dino' };
function onCue(name, data, token) {
  if (token !== session) return;
  const snd = CUE_SOUND[name];
  if (snd) audio.play(snd, data);
  const d = (data && data.delay) || 0;
  if (name === 'gone' || name === 'jellyhit' || name === 'dinoout') { launchFlight(name, data, token); return; }
  switch (name) {
    case 'pop': buzzLater(d, 10, 80); break;
    case 'special': buzzLater(d, 12, 60); break;
    case 'stripe': case 'wrap': case 'fish': buzzLater(d, 16, 60); break;
    case 'bomb': case 'board': case 'combo': buzzLater(d, [18, 40, 18], 60); break;
    case 'cage': case 'frost': case 'choco': buzzLater(d, 12, 60); break;
    case 'dino': buzzLater(d, [12, 30, 12], 80); break;
  }
}

// ---------- 收集目標的弧線飛行 ----------
// 消掉關卡目標（玩偶 / 果凍）時，一顆發光的小玩偶沿著彎彎的貝茲曲線從那一格飛到上面的目標圖示；
// 飛到了才扣數字，圖示和數字「ㄉㄨㄞ」一下、閃出星芒。onEvent 先把這一步要飛的數量記成一批（batch），
// renderer 在每一顆爆開的那一刻送 'gone' / 'jellyhit'，從這一批領一個名額起飛。沒領完的 3 秒後自動結清，數字不會卡住。
let flyIn = {}, flyJelly = 0, flyDino = 0, flyBatches = [], flyLive = 0, flyLayer = null;
const FLY_MAX = 12;                 // 同時最多幾顆在飛（超過的直接算到）
function resetFlights() {
  for (const b of flyBatches) clearTimeout(b.timer);
  flyBatches = []; flyIn = {}; flyJelly = 0; flyDino = 0; flyLive = 0;
  if (flyLayer) flyLayer.textContent = '';
}
function queueFlights(before, jellyBefore, dinoBefore = mechLive.dino) {
  const b = { k: {}, jelly: 0, dino: 0, timer: 0 };
  let any = false;
  for (const r of goalRefs) {
    if (r.kind === 'collect') {
      const was = before[r.k] || 0, now = clearedOf(r.k), n = Math.min(now - was, Math.max(0, r.need - was));
      if (n > 0) { b.k[r.k] = n; flyIn[r.k] = (flyIn[r.k] || 0) + n; any = true; }
    } else if (r.kind === 'jelly') {
      const n = Math.max(0, jellyBefore - jellyLive);
      if (n > 0) { b.jelly = n; flyJelly += n; any = true; }
    } else if (r.kind === 'dino') {
      const n = Math.min(mechLive.dino - dinoBefore, Math.max(0, r.need - dinoBefore));
      if (n > 0) { b.dino = n; flyDino += n; any = true; }
    }
  }
  if (!any) return;
  b.timer = setTimeout(() => settleBatch(b), 3000);
  flyBatches.push(b);
}
function settleBatch(b) {
  clearTimeout(b.timer);
  for (const k in b.k) { flyIn[k] = Math.max(0, (flyIn[k] || 0) - b.k[k]); b.k[k] = 0; }
  if (b.jelly) { flyJelly = Math.max(0, flyJelly - b.jelly); b.jelly = 0; }
  if (b.dino) { flyDino = Math.max(0, flyDino - b.dino); b.dino = 0; }
  flyBatches = flyBatches.filter(x => x !== b);
  renderGoal();
}
function launchFlight(name, data, token) {
  const jelly = name === 'jellyhit', dino = name === 'dinoout', kind = data.kind;
  const b = flyBatches.find(x => (dino ? x.dino > 0 : jelly ? x.jelly > 0 : x.k[kind] > 0));
  if (!b) return;
  if (dino) b.dino--; else if (jelly) b.jelly--; else b.k[kind]--;
  const ref = goalRefs.find(r => (dino ? r.kind === 'dino' : jelly ? r.kind === 'jelly' : r.kind === 'collect' && r.k === kind));
  const arrive = () => {
    if (token !== session) return;
    if (dino) flyDino = Math.max(0, flyDino - 1);
    else if (jelly) flyJelly = Math.max(0, flyJelly - 1); else flyIn[kind] = Math.max(0, (flyIn[kind] || 0) - 1);
    if (b.jelly <= 0 && b.dino <= 0 && Object.values(b.k).every(v => v <= 0)) { clearTimeout(b.timer); flyBatches = flyBatches.filter(x => x !== b); }
    renderGoal();
    if (ref) starBurst(ref.gi.querySelector('.ic'));
  };
  setTimeout(() => {
    if (token !== session) return;
    const from = R && R.cellRect ? R.cellRect(data.r, data.c) : null;
    if (!ref || !from || flyLive >= FLY_MAX || document.hidden) { arrive(); return; }
    flyLive++;
    flyToGoal(dino ? 'dino' : jelly ? null : PIECES[kind], from, ref.gi.querySelector('.ic'), () => { flyLive = Math.max(0, flyLive - 1); arrive(); });
  }, Math.max(0, data.delay || 0));
}
function flyToGoal(p, from, icon, done) {
  if (!flyLayer) { flyLayer = el('div', 'fly-layer'); flyLayer.setAttribute('aria-hidden', 'true'); document.body.appendChild(flyLayer); }
  const to = icon.getBoundingClientRect();
  const ex = to.left + to.width / 2, ey = to.top + to.height / 2, sx = from.x, sy = from.y;
  const sz = Math.max(24, Math.round(from.size * 0.92));
  const f = el('div', 'flyer' + (p === 'dino' ? ' dino' : p ? '' : ' jelly'));
  f.style.width = f.style.height = sz + 'px';
  f.appendChild(p === 'dino' ? dinoImg() : p ? toyEl(p, 14) : jellyIcon());
  flyLayer.appendChild(f);
  // 二次貝茲曲線：控制點往旁邊、往上拉，飛起來是一道彎彎的弧
  const dist = Math.hypot(ex - sx, ey - sy), side = (sx < ex ? -1 : 1) * Math.min(110, 40 + Math.abs(ex - sx) * 0.45);
  const cx = (sx + ex) / 2 + side, cy = Math.min(sy, ey) - 60 - dist * 0.08;
  const N = 18, frames = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N, m = 1 - u;
    const x = m * m * sx + 2 * m * u * cx + u * u * ex, y = m * m * sy + 2 * m * u * cy + u * u * ey;
    const sc = (1 + 0.38 * Math.sin(Math.PI * Math.min(1, u * 1.2))) * (1 - 0.42 * u * u);
    frames.push({ offset: u, transform: `translate(${(x - sz / 2).toFixed(1)}px, ${(y - sz / 2).toFixed(1)}px) scale(${sc.toFixed(3)}) rotate(${(Math.sin(u * 9) * 14 * (1 - u)).toFixed(1)}deg)` });
  }
  const dur = clamp(520 + dist * 0.45, 560, 900);
  let finished = false;
  const end = () => { if (finished) return; finished = true; f.remove(); done(); };
  try {
    const a = f.animate(frames, { duration: dur, easing: 'cubic-bezier(.42,0,.6,1)', fill: 'forwards' });
    a.onfinish = end; a.oncancel = end;
  } catch (e) { end(); return; }
  setTimeout(end, dur + 400);      // 保險：動畫事件沒來也會結束
}
// 飛到了：圖示閃出一圈星芒 +「叮」
function starBurst(icon) {
  if (!icon) return;
  audio.play('collect', { step: 0 });
  const s = el('span', 'star-burst');
  for (let i = 0; i < 8; i++) { const r = el('i'); r.style.setProperty('--a', (i * 45) + 'deg'); s.appendChild(r); }
  icon.appendChild(s);
  setTimeout(() => s.remove(), 560);
}

// ---------- 事件 → HUD ----------
function onEvent(ev, token) {
  if (token !== session || !ev) return;
  switch (ev.t) {
    case 'transform':
      if (ev.gained) { dispScore += ev.gained; renderScore(); }
      if (sugarMode) {
        audio.play('sugar');
        dispMoves = Math.max(0, dispMoves - ((ev.cells && ev.cells.length) || 1));
        renderMoves();
      } else {
        audio.play('combo');
      }
      break;
    case 'clear': {
      // 音效和震動由 onCue 照畫面時間播；這裡只更新分數和目標
      const cascade = Math.max(1, ev.cascade || 1);
      const fx = new Set((ev.effects || []).map(e => e.fx));
      const removed = ev.removed || [];
      const before = { ...liveCleared }, jellyBefore = jellyLive;
      for (const r of removed) {
        const k = r.piece ? r.piece.kind : -1;
        if (k >= 0) liveCleared[k] = (liveCleared[k] || 0) + 1;
      }
      if (ev.jelly) jellyLive = sumJelly(ev.jelly, jellyCountsLayers);
      if (ev.board) Object.assign(mechLive, countBlocks(ev.board, ev.lock));
      queueFlights(before, jellyBefore);
      dispScore += ev.gained || 0;
      renderScore();
      renderGoal();
      if (cascade >= 2 || fx.size || (ev.created && ev.created.length)) cheer();
      break;
    }
    case 'exit': {
      // 龍龍走到出口：飛到上面的目標圖示才扣數字
      const dinoBefore = mechLive.dino;
      mechLive.dino += (ev.cells || []).length;
      queueFlights({ ...liveCleared }, jellyLive, dinoBefore);
      break;
    }
    case 'spread':
      if (ev.board) Object.assign(mechLive, countBlocks(ev.board, ev.lock));
      renderGoal();
      break;
    case 'shuffle': break;   // 「沒有可以消的了！」橫幅由 renderer 的洗牌動畫顯示
  }
}

function syncFromEngine() {
  const st = engine.stats || {};
  if (st.cleared) {
    liveCleared = {};
    for (const k in st.cleared) liveCleared[k] = st.cleared[k];
  }
  if (typeof st.jellyLeft === 'number') jellyLive = st.jellyLeft;
  mechLive = { dino: st.dinosOut | 0, frost: st.frostLeft | 0, choco: st.chocoLeft | 0, cage: st.locksLeft | 0 };
  dispScore = engine.score;
  renderScore();
  renderGoal();
}

function goalMet() {
  if (debugWin) return true;
  if (levMod.goalDone) return levMod.goalDone(level, engine.stats, engine.score, kindOf);
  const g = level.goal || {};
  if (g.type === 'collect') return Object.entries(g.items || {}).every(([id, n]) => (engine.stats.cleared[kindOf(id)] || 0) >= n);
  if (g.type === 'jelly') return engine.stats.jellyLeft <= 0;
  return engine.score >= scoreTarget(level);     // 分數關：到了目標就過關，剩下的步數變成超級糖果
}

// ---------- 道具（不算步數） ----------
const BOOSTER_TIP = { hammer: '點一顆方塊，用棒棒糖槌敲掉它', swap: '點兩顆相鄰的方塊，直接交換' };
const BOOSTER_NAME = { hammer: '🍭 槌子', swap: '✋ 交換', ufo: '🛸 空投', moves5: '＋5 步' };
let boosterMode = null, boosterFirst = null, lastRewards = [];
function renderBoosters() {
  for (const b of $$('.bst')) {
    const k = b.dataset.b, n = save.boosters[k] || 0;
    b.querySelector('.bc').textContent = n;
    b.classList.toggle('empty', n <= 0);
    b.classList.toggle('on', boosterMode === k);
  }
  const tip = $('#booster-tip');
  if (tip) {
    tip.hidden = !boosterMode || !BOOSTER_TIP[boosterMode];
    tip.textContent = boosterMode === 'swap' && boosterFirst ? '再點旁邊那一顆' : (BOOSTER_TIP[boosterMode] || '');
  }
}
function setBoosterMode(k) {
  boosterMode = k; boosterFirst = null;
  if (R) R.select(null);
  clearHint();
  renderBoosters();
  if (!k) scheduleHint();
}
const boosterReady = () => state === 'play' && !moving && !!R && !R.busy;
function onBoosterClick(k) {
  if (!boosterReady()) return;
  if ((save.boosters[k] || 0) <= 0) { toast('這個道具用完了，過關就能拿到更多！'); return; }
  audio.play('select');
  if (boosterMode === k) { setBoosterMode(null); return; }
  if (k === 'ufo') { setBoosterMode(null); useBooster('ufo', () => engine.airDrop(3)); return; }
  setBoosterMode(k);
}
async function useBooster(k, fn) {
  if (!boosterReady()) return;
  const token = session;
  moving = true;
  clearHint(); selected = null; R.select(null);
  let res;
  try { res = fn(); } catch (e) { console.error(e); moving = false; return; }
  if (!res || !res.ok) { moving = false; setBoosterMode(null); return; }
  save.boosters[k] = Math.max(0, (save.boosters[k] || 0) - 1);
  writeSave();
  boosterMode = null; boosterFirst = null; renderBoosters();
  try { await R.play(res.events, { onEvent: ev => onEvent(ev, token), onCue: (n, d) => onCue(n, d, token) }); }
  catch (e) { console.error(e); if (token === session) R.setBoard(engine.snapshot()); }
  if (token !== session) return;
  moving = false;
  syncFromEngine();
  if (state !== 'play') return;
  if (goalMet()) { winFlow(); return; }
  scheduleHint();
}
// 棒棒糖槌敲下去的動畫（畫在格子上方）
function hammerFx(cell) {
  try {
    if (!cellCenters) cellCenters = computeCenters();
    const p = cellCenters[cell.r + ',' + cell.c];
    if (!p) return;
    const d = el('div', 'hammer-fx');
    d.textContent = '🍭';
    d.style.left = p.x + 'px'; d.style.top = p.y + 'px';
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 500);
  } catch (e) { /* 動畫失敗不影響遊戲 */ }
}
// 過關獎勵：每次過關 1 個隨機道具；第一次拿到三星再送 ＋5 步
function grantRewards(stars, prevStars) {
  const got = [];
  const pick = ['hammer', 'swap', 'ufo'][Math.floor(Math.random() * 3)];
  got.push(pick);
  if (stars === 3 && prevStars < 3) got.push('moves5');
  for (const k of got) save.boosters[k] = (save.boosters[k] || 0) + 1;
  writeSave();
  return got;
}

// ---------- 交換 ----------
async function doSwap(a, b) {
  if (state !== 'play' || moving || R.busy) return;
  const token = session;
  moving = true;
  clearHint();
  selected = null;
  R.select(null);
  let res;
  try {
    res = engine.swap(a, b);
  } catch (e) {
    console.error(e);
    moving = false;
    return;
  }
  const opts = { onEvent: ev => onEvent(ev, token), onCue: (n, d) => onCue(n, d, token) };
  if (!res || !res.ok) {
    try { await R.play((res && res.events) || [], opts); } catch (e) { console.error(e); }
    if (token === session) { moving = false; scheduleHint(); }
    return;
  }
  movesLeft--;
  dispMoves = movesLeft;
  renderMoves();
  try {
    await R.play(res.events, opts);
  } catch (e) {
    console.error(e);
    if (token === session) R.setBoard(engine.snapshot());
  }
  if (token !== session) return;
  moving = false;
  syncFromEngine();
  afterMove();
}

function afterMove() {
  if (state !== 'play') return;
  if (goalMet()) { winFlow(); return; }
  if (movesLeft <= 0) { loseFlow(); return; }
  if (movesLeft === 5 && !lowWarned) { lowWarned = true; toast('只剩 5 步了！', 1300); }
  scheduleHint();
}

// ---------- 輸入 ----------
let ptr = null;
const same = (a, b) => a && b && a.r === b.r && a.c === b.c;
function hasPiece(c) { return c && engine.isCell(c.r, c.c) && !!engine.cell(c.r, c.c); }
function setDrag(cell, dx, dy) { if (typeof R.drag === 'function' && cell) { try { R.drag(cell, dx, dy); } catch (e) {} } }

// 拖曳門檻：手指滑過 1/4 格就交換（不用放開）
const SWAP_DRAG = 0.25;
canvas.addEventListener('pointerdown', e => {
  if (state !== 'play' || !R) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  if (ptr) return;
  e.preventDefault();
  const cell = R.cellAt(e.clientX, e.clientY);
  if (boosterMode) {
    if (moving || R.busy || !hasPiece(cell)) return;
    if (boosterMode === 'hammer') {
      const c0 = cell;
      boosterMode = 'busy'; renderBoosters();
      hammerFx(c0);
      setTimeout(() => { boosterMode = null; useBooster('hammer', () => engine.smash(c0)); }, 260);
      return;
    }
    if (boosterMode === 'swap') {
      if (boosterFirst && !same(boosterFirst, cell) && engine.isAdjacent(boosterFirst, cell)) {
        const a = boosterFirst;
        useBooster('swap', () => engine.freeSwap(a, cell));
      } else {
        boosterFirst = same(boosterFirst, cell) ? null : cell;
        R.select(boosterFirst);
        audio.play('select');
        renderBoosters();
      }
    }
    return;
  }
  if (moving || R.busy) {
    // 盤面還在動：先記住手指的起點，停下來的那一刻起就照這個起點判斷拖曳（提早開始滑也接得住）
    if (cell) {
      try { canvas.setPointerCapture(e.pointerId); } catch (er) {}
      ptr = { id: e.pointerId, cell, x: e.clientX, y: e.clientY, wasSelected: false, consumed: false, moved: false, early: true };
    }
    return;
  }
  clearHint();
  scheduleHint();
  if (!hasPiece(cell)) {
    if (selected) { selected = null; R.select(null); }
    return;
  }
  try { canvas.setPointerCapture(e.pointerId); } catch (er) {}
  if (selected && !same(selected, cell) && engine.isAdjacent(selected, cell)) {
    const a = selected;
    ptr = { id: e.pointerId, consumed: true };
    doSwap(a, cell);
    return;
  }
  const wasSelected = same(selected, cell);
  if (!wasSelected) {
    selected = cell;
    R.select(cell);
    audio.play('select');
  }
  ptr = { id: e.pointerId, cell, x: e.clientX, y: e.clientY, wasSelected, consumed: false, moved: false };
});
canvas.addEventListener('pointermove', e => {
  if (!ptr || ptr.id !== e.pointerId || ptr.consumed) return;
  if (state !== 'play' || moving || R.busy) return;
  if (ptr.early && !hasPiece(ptr.cell)) { ptr.consumed = true; return; }
  const cs = cellSize();
  const dx = (e.clientX - ptr.x) / cs, dy = (e.clientY - ptr.y) / cs;
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (Math.max(ax, ay) > 0.08) ptr.moved = true;
  if (Math.max(ax, ay) >= SWAP_DRAG) {
    const t = ax >= ay ? { r: ptr.cell.r, c: ptr.cell.c + Math.sign(dx) } : { r: ptr.cell.r + Math.sign(dy), c: ptr.cell.c };
    if (hasPiece(t)) {
      ptr.consumed = true;
      setDrag(ptr.cell, 0, 0);
      doSwap(ptr.cell, t);
      return;
    }
  }
  if (ax >= ay) setDrag(ptr.cell, clamp(dx, -0.35, 0.35), 0);
  else setDrag(ptr.cell, 0, clamp(dy, -0.35, 0.35));
});
function endPointer(e, cancel) {
  if (!ptr || ptr.id !== e.pointerId) return;
  if (!ptr.consumed) {
    setDrag(ptr.cell, 0, 0);
    if (!cancel && ptr.wasSelected && !ptr.moved && state === 'play') { selected = null; R.select(null); }
  }
  ptr = null;
}
canvas.addEventListener('pointerup', e => endPointer(e, false));
canvas.addEventListener('pointercancel', e => endPointer(e, true));
canvas.addEventListener('lostpointercapture', e => endPointer(e, true));
canvas.addEventListener('contextmenu', e => e.preventDefault());

// ---------- 過關 / 失敗 ----------
// 分數關步數用完：盤面上剩下的特殊方塊全部引爆（Candy Crush 也是這樣），夠分就過關
async function endScoreLevel() {
  const token = session;
  state = 'ending';
  closeModal('m-settings');
  clearHint();
  selected = null;
  R.select(null);
  try {
    const res = engine.sugarCrush(0);
    if (res && res.events && res.events.length) {
      sugarMode = true;
      await R.play(res.events, { onEvent: ev => onEvent(ev, token), onCue: (n, d) => onCue(n, d, token) });
      sugarMode = false;
    }
  } catch (e) { console.error(e); sugarMode = false; }
  if (token !== session) return;
  syncFromEngine();
  state = 'play';
  if (engine.score >= passScore(level)) winFlow(); else loseFlow();
}
// 過關紀錄：目標一達成就先存（之後就算中途離開也不會白過關），Sugar Crush 結束後再用最終分數更新一次
function recordWin(score) {
  const id = level.id;
  const stars = starsFor(level, score);
  if (score > (Number(save.best[id]) || 0)) save.best[id] = score;
  save.stars[id] = Math.max(Number(save.stars[id]) || 0, stars);
  save.unlocked = Math.max(save.unlocked, Math.min(levelIdx + 2, LEVELS.length + 1));
  writeSave();
  return stars;
}

async function winFlow() {
  const token = session;
  state = 'ending';
  closeModal('m-settings');
  clearHint();
  selected = null;
  R.select(null);
  $('#btn-pause').disabled = true;
  const prevBest = Number(save.best[level.id]) || 0;
  const prevStars = Number(save.stars[level.id]) || 0;
  const firstClear = save.unlocked < levelIdx + 2;
  boosterMode = null; boosterFirst = null; renderBoosters();
  // 目標關：完成目標至少 1 顆星（分數不夠就先補到 1 星門檻，Candy Crush 也是這樣）
  if (!isScoreLevel(level) && engine.score < passScore(level) && typeof engine.addScore === 'function') {
    engine.addScore(passScore(level) - engine.score);
    syncFromEngine();
  }
  recordWin(engine.score);
  renderMoves();
  audio.play('win');
  $('#cheer').classList.add('party');
  const left = movesLeft;
  sugarBonus = left * 3000;
  if (left > 0 && SLOGANS.sugar.voice) audio.play('voice', { id: SLOGANS.sugar.voice, delay: 150 });
  await R.banner(left > 0 ? SLOGANS.sugar.text : SLOGANS.win.text,
    left > 0 ? { sub: `剩下 ${left} 步 × 3,000 分！`, duration: 1700 } : { duration: 1300 });
  if (token !== session) return;
  if (left > 0) {
    sugarMode = true;
    try {
      const res = engine.sugarCrush(left);
      await R.play((res && res.events) || [], { onEvent: ev => onEvent(ev, token), onCue: (n, d) => onCue(n, d, token) });
    } catch (e) { console.error(e); }
    sugarMode = false;
    if (token !== session) return;
  }
  movesLeft = dispMoves = 0;
  renderMoves();
  syncFromEngine();
  const score = engine.score;
  const stars = recordWin(score);
  lastRewards = grantRewards(stars, prevStars);
  renderBoosters();
  const newBest = score > prevBest;
  state = 'won';
  await sleep(450);
  if (token !== session) return;
  showWin(stars, score, newBest && prevBest > 0, prevBest, firstClear, stars === 3 && prevStars < 3);
}

let winTimers = [];
let sugarBonus = 0;
const WIN_PHOTOS = ['assets/deco/sloth_orange.webp', 'assets/deco/snoopy_sloth.webp', 'assets/deco/sloth_pig.webp', 'assets/deco/group.webp'];
function setPhoto(id, src) {
  const im = document.getElementById(id);
  if (!im) return;
  im.classList.remove('broken');
  im.src = src;
}
function showWin(stars, score, newBest, best, firstClear, newThree = false) {
  winTimers.forEach(clearTimeout);
  winTimers = [];
  // 三星：卡片整張閃金光；第一次拿到這關的三星 → 送 1 枚三星造型幣
  const card = $('#m-win .win-card'), ready = closet.readyChests(save.stars).length;
  card.classList.toggle('three', stars === 3);
  // 改版 2026-11：原本造型幣是一張獨立的大卡片，一出現整張過關卡太高、頂端的緞帶被切掉。
  // 改成跟獲得的道具排在同一排小膠囊；造型幣先佔好位置（看不見），星星亮完才翻進來，卡片高度不會突然變。
  const rw = $('#mw-reward');
  rw.innerHTML = '';
  const chip = (cls, txt) => { const c = el('span', cls); c.append(txt); return c; };
  let coinChip = null;
  if (lastRewards.length || newThree) {
    rw.appendChild(chip('rw-lbl', '獲得'));
    lastRewards.forEach(k => rw.appendChild(chip('rw-chip', BOOSTER_NAME[k] + ' ×1')));
    if (newThree) { coinChip = chip('rw-chip rw-coin wait', '三星造型幣 +1'); coinChip.prepend(coinEl()); rw.appendChild(coinChip); }
  }
  rw.hidden = !rw.childElementCount;
  // 原本卡片上「去衣櫃幫玩偶換裝吧！」「有三星豪華寶箱可以開了！」那行，改成「玩偶衣櫃」按鈕上的提示：
  // 有寶箱可以開 → 紅點＋「開寶箱」小標籤＋按鈕輕輕發光；剛拿到造型幣 → 金幣翻進來後按鈕跳一下
  const cbtn = $('#mw-closet');
  $('#mw-closet-dot').hidden = !ready;
  $('#mw-closet-tag').hidden = !ready;
  cbtn.classList.toggle('ready', !!ready);
  cbtn.classList.remove('nudge');
  cbtn.setAttribute('aria-label', ready ? '玩偶衣櫃，有三星豪華寶箱可以開' : '玩偶衣櫃');
  renderClosetBtn();
  if (coinChip) {
    winTimers.push(setTimeout(() => {
      if (!isOpen('m-win')) return;
      coinChip.classList.remove('wait'); restartAnim(coinChip, 'show');
      restartAnim(cbtn, 'nudge');
      audio.play('special'); audio.play('collect', { step: 4, delay: 120 });
      confetti(true);
    }, 500 + 3 * 420 + 300));
  }
  const last = levelIdx >= LEVELS.length - 1;
  $('#mw-title').textContent = stars === 3 ? SLOGANS.win3.text : SLOGANS.win.text;
  if (stars === 3 && SLOGANS.win3.voice) audio.play('voice', { id: SLOGANS.win3.voice, delay: 1500 });
  setPhoto('mw-photo', WIN_PHOTOS[Math.floor(Math.random() * WIN_PHOTOS.length)]);
  const bs = $$('#mw-stars .bs');
  bs.forEach(s => s.classList.remove('on'));
  $('#mw-stars').setAttribute('aria-label', `得到 ${stars} 顆星`);
  setNum($('#mw-score'), 0);
  $('#mw-best').hidden = !newBest;
  const bonusLine = sugarBonus > 0 ? `剩餘步數獎勵 +${fmt(sugarBonus)}` : '';
  $('#mw-best-line').textContent = [bonusLine, !newBest && best > 0 ? `最高分 ${fmt(Math.max(best, score))}` : ''].filter(Boolean).join('　');
  $('#mw-next').hidden = last;
  $('#mw-next').dataset.first = firstClear ? '1' : '';
  const toys = $('#mw-toys');
  toys.innerHTML = '';
  TITLE_TOYS.forEach((p, k) => { const d = el('span', 'mt'); d.style.setProperty('--k', k); d.appendChild(toyEl(p, 26)); toys.appendChild(d); });
  // 讓出高度：有獲得道具時三隻玩偶縮小；連造型幣都有（最擠的時候）就整排拿掉
  toys.classList.toggle('small', !rw.hidden);
  toys.hidden = !!coinChip;
  $('#mw-body').classList.toggle('no-toys', !!coinChip);
  $('#mw-body').scrollTop = 0;
  if (last) $('#mw-title').textContent = '全部過關！';
  openModal('m-win');
  confetti();
  for (let k = 0; k < stars; k++) {
    winTimers.push(setTimeout(() => { bs[k].classList.add('on'); audio.play('star', { n: k + 1 }); }, 500 + k * 420));
  }
  // 分數跑上去
  const t0 = performance.now() + 250, dur = 1000;
  const tick = now => {
    const f = clamp((now - t0) / dur, 0, 1);
    setNum($('#mw-score'), fmt(score * (1 - Math.pow(1 - f, 3))));
    if (f < 1 && isOpen('m-win')) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
function confetti(gold = false) {
  const box = $('#confetti');
  if (!gold) box.innerHTML = '';
  const colors = gold ? ['#ffd23f', '#ffe98a', '#ffb800', '#fff6c8', '#ffffff'] : ['#ff5fa8', '#ffd23f', '#6fe39a', '#6cc8ff', '#b98cff', '#ff9a3c', '#ffffff'];
  for (let i = 0; i < (gold ? 36 : 46); i++) {
    const c = document.createElement('i');
    c.style.left = (Math.random() * 100) + '%';
    c.style.background = colors[i % colors.length];
    c.style.setProperty('--dx', ((Math.random() - 0.5) * 160).toFixed(0) + 'px');
    c.style.setProperty('--r', ((Math.random() - 0.5) * 1440).toFixed(0) + 'deg');
    c.style.setProperty('--d', (2.2 + Math.random() * 1.8).toFixed(2) + 's');
    c.style.setProperty('--dl', (Math.random() * 0.9).toFixed(2) + 's');
    if (i % 3 === 0) { c.style.width = '8px'; c.style.height = '8px'; c.style.borderRadius = '50%'; }
    box.appendChild(c);
  }
}

async function loseFlow() {
  const token = session;
  state = 'lost';
  closeModal('m-settings');
  clearHint();
  selected = null;
  R.select(null);
  $('#cheer').classList.add('sad');
  audio.play('lose');
  $('#ml-title').textContent = '步數用完了';
  const more = $('#ml-more');
  if (more) { const n = save.boosters.moves5 || 0; more.hidden = n <= 0; $('#ml-more-n').textContent = n; }
  setPhoto('ml-photo', SLOGANS.lose.img);
  await sleep(650);
  if (token !== session) return;
  const txt = $('#ml-text');
  txt.innerHTML = '';
  const g = level.goal || {};
  if (g.type === 'collect') {
    txt.appendChild(document.createTextNode('還差一點點：'));
    txt.appendChild(document.createElement('br'));
    for (const [id, n] of Object.entries(g.items || {})) {
      const left = Math.max(0, n - (engine.stats.cleared[kindOf(id)] || 0));
      if (!left) continue;
      const p = pieceById(id);
      const row = el('span', 'row');
      row.appendChild(toyEl(p, 14));
      row.appendChild(document.createTextNode(`×${left}`));
      txt.appendChild(row);
    }
  } else if (g.type === 'jelly') {
    txt.textContent = `還剩 ${Math.max(0, engine.stats.jellyLeft)} 塊果凍沒清掉`;
  } else if (['dino', 'clear', 'mix'].includes(g.type) && levMod.partLeft) {
    txt.appendChild(document.createTextNode('還差一點點：'));
    txt.appendChild(document.createElement('br'));
    for (const part of goalPartsOf(level)) {
      const left = levMod.partLeft(part, engine.stats, kindOf);
      if (!left) continue;
      const row = el('span', 'row');
      if (part.kind === 'collect') { const p = pieceById(part.id); if (p) row.appendChild(toyEl(p, 14)); }
      else if (part.kind === 'jelly') row.appendChild(jellyIcon(true));
      else row.appendChild(PART_ICON[part.kind]());
      row.appendChild(document.createTextNode(`×${left}`));
      txt.appendChild(row);
    }
  } else {
    txt.textContent = `還差 ${fmt(Math.max(0, scoreTarget(level) - engine.score))} 分就過關了！`;
  }
  const sl = el('span', 'lose-slogan');
  sl.textContent = SLOGANS.lose.text;
  txt.appendChild(document.createElement('br'));
  txt.appendChild(sl);
  const toys = $('#ml-toys');
  toys.innerHTML = '';
  TITLE_TOYS.forEach((p, k) => { const d = el('span', 'mt'); d.style.setProperty('--k', k); d.appendChild(toyEl(p, 26)); toys.appendChild(d); });
  openModal('m-lose');
}

// ---------- 帳號（雲端存檔）的畫面 ----------
const SYNC_TEXT = {
  guest: '登入後，換手機也能接著玩',
  syncing: '同步中…',
  synced: '已存到雲端 ✓',
  offline: '離線中，連上網路會自動存到雲端',
};
// 頭像：名字的第一個字；沒登入是一朵雲
function paintAvatar(box) {
  box.textContent = '';
  if (account) {
    box.textContent = Array.from(account.name || '?')[0] || '?';
  } else {
    const s = document.createElementNS(SVGNS, 'svg'), u = document.createElementNS(SVGNS, 'use');
    u.setAttribute('href', '#i-cloud'); s.appendChild(u); box.appendChild(s);
  }
}
function renderAccount() {
  const on = !!cloud && syncState !== 'off';
  const chip = $('#acct-chip'), box = $('#acct-box');
  if (!chip || !box) return;
  chip.hidden = !on; box.hidden = !on;
  if (!on) return;
  chip.classList.toggle('in', !!account);
  paintAvatar($('.acct-av', chip));
  $('.acct-nm', chip).textContent = account ? account.name : '登入存檔';
  chip.setAttribute('aria-label', account ? `帳號：${account.name}（打開設定）` : '登入雲端存檔');
  paintAvatar($('.acct-av', box));
  $('#acct-name').textContent = account ? account.name : '雲端存檔';
  $('#acct-sub').textContent = account ? (SYNC_TEXT[syncState] || '') : SYNC_TEXT.guest;
  box.dataset.sync = account ? syncState : 'guest';
  $('#acct-btns').hidden = !!account;
  $('#acct-out').hidden = !account;
}
// ---------- 帳號名稱＋密碼（不用 email） ----------
let lgMode = 'in';             // 'in' 登入、'up' 開新帳號
function setLoginMode(mode) {
  lgMode = mode;
  const up = mode === 'up', bt = $('#lg-submit .bt');
  $('#lg-title').textContent = up ? '開新帳號' : '登入帳號';
  bt.textContent = bt.dataset.t = up ? '開帳號' : '登入';
  $('#lg-pass2-row').hidden = !up;
  $('#lg-pass').autocomplete = up ? 'new-password' : 'current-password';
  $('#lg-switch').textContent = up ? '已經有帳號了？直接登入' : '還沒有帳號？開一個新的';
  $('#lg-err').textContent = '';
}
function openLogin(mode = 'in') {
  if (!cloud) return;
  setLoginMode(mode);
  $('#lg-pass').value = $('#lg-pass2').value = '';
  openModal('m-login');
}
function loginError(e) {
  const c = (e && e.code) || '';
  if (c === 'cloud/bad-name') return e.hint;
  if (c === 'auth/invalid-credential' || c === 'auth/invalid-login-credentials' || c === 'auth/wrong-password' || c === 'auth/user-not-found') return '名字或密碼不對（英文不分大小寫）';
  if (c === 'auth/email-already-in-use') return '這個名字已經有人用了，換一個吧';
  if (c === 'auth/weak-password') return '密碼至少要 6 個字';
  if (c === 'auth/too-many-requests') return '試太多次了，等幾分鐘再試';
  if (c === 'auth/network-request-failed') return '連不上網路，晚點再試';
  if (c === 'auth/operation-not-allowed') return '帳號密碼登入還沒開放（Firebase 後台要打開「電子郵件/密碼」）';
  if (c === 'auth/user-disabled') return '這個帳號被停用了';
  if (c === 'cloud/not-ready') return '雲端存檔還在準備，等一下再按一次';
  return '沒有成功，請再試一次';
}
async function submitLogin(e) {
  e.preventDefault();
  if (!cloud) return;
  const err = $('#lg-err'), btn = $('#lg-submit'), name = $('#lg-name').value, pass = $('#lg-pass').value;
  err.textContent = '';
  const chk = cloud.checkName(name);
  if (chk.error) { err.textContent = chk.error; return; }
  if (pass.length < 6) { err.textContent = '密碼至少要 6 個字'; return; }
  if (lgMode === 'up' && pass !== $('#lg-pass2').value) { err.textContent = '兩次輸入的密碼不一樣'; return; }
  if (btn.disabled) return;
  btn.disabled = true;
  askGuestMerge = true;                    // 這台裝置有訪客進度的話會問要不要帶進帳號（成功後 onUser → switchAccount 接手，歡迎訊息在那裡）
  try {
    await (lgMode === 'up' ? cloud.signUpWithName(name, pass) : cloud.signInWithName(name, pass));
    $('#lg-pass').value = $('#lg-pass2').value = '';
    closeModal('m-login');
  } catch (ex) {
    askGuestMerge = false;
    err.textContent = loginError(ex);
    if (!/^(auth\/(invalid|wrong|user-not|email-already|weak)|cloud\/)/.test((ex && ex.code) || '')) console.warn('[cloud] 帳號密碼登入失敗', ex);
  } finally {
    btn.disabled = false;
  }
}
async function signOut() {
  if (!cloud || !account) return;
  if (pushTimer || syncState !== 'synced') await pushCloud();     // 先把還沒傳上去的進度傳上去
  try { await cloud.signOut(); toast('已登出，換回這台裝置的存檔'); } catch (e) { toast('登出沒有成功，請再試一次'); }
}
// 這台裝置上有沒登入時玩的進度：問要不要帶進剛登入的帳號
function askMerge(guest, u) {
  const stars = Object.values(guest.stars).reduce((a, b) => a + (Number(b) || 0), 0);
  const lv = Math.max(1, Math.min(guest.unlocked - 1, LEVELS ? LEVELS.length : guest.unlocked));
  $('#mm-text').textContent = `這台裝置上還沒登入時，已經過了 ${lv} 關、拿到 ${stars} 顆星。要把這些進度帶進「${u.name}」的帳號嗎？帶進去之後，這台裝置的訪客進度會清空。`;
  return new Promise(res => {
    let settled = false;
    const done = v => {
      if (settled) return;
      settled = true; mergeAnswer = null;
      $('#mm-yes').onclick = $('#mm-no').onclick = null;
      closeModal('m-merge');
      res(v);
    };
    mergeAnswer = done;                         // 被別的方式關掉（Esc 之類）就當作「不用」，換帳號的流程才不會卡住
    $('#mm-yes').onclick = () => done(true);
    $('#mm-no').onclick = () => done(false);
    openModal('m-merge');
  });
}
let mergeAnswer = null;

// ---------- 設定 ----------
function syncToggles() {
  $('#tg-sound').setAttribute('aria-pressed', String(!save.muted));
  $('#tg-music').setAttribute('aria-pressed', String(!!save.music));
}
function openSettings() {
  const inGame = screen === 'game' && (state === 'play' || state === 'intro');
  const m = $('#m-settings');
  m.classList.toggle('in-game', inGame);
  $('#set-title').textContent = inGame ? '暫停' : '設定';
  $('#set-close').textContent = inGame ? '繼續' : '好了';
  syncToggles();
  renderAccount();
  openModal('m-settings');
}

// ---------- 綁定按鈕 ----------
function bindUI() {
  $('#btn-start').addEventListener('click', () => showMap());
  $('#map-back').addEventListener('click', () => show('title'));
  $('#map-scroll').addEventListener('scroll', updateMapHere, { passive: true });
  for (const b of $$('[data-open-settings]')) b.addEventListener('click', openSettings);
  // 一步還在結算（掉落、連鎖）時不能暫停，免得過關／失敗的流程跑在暫停選單後面
  const canPause = () => (state === 'play' && !moving && !(R && R.busy)) || state === 'intro';
  $('#btn-pause').addEventListener('click', () => { if (canPause()) openSettings(); });
  $('#ms-play').addEventListener('click', () => { if (cardLevel >= 0) startLevel(cardLevel); });
  for (const b of $$('[data-close]')) b.addEventListener('click', () => closeModal(b.closest('.modal').id));
  // 點背景關閉（只限開始卡和設定）
  for (const id of ['m-start', 'm-settings']) {
    const m = document.getElementById(id);
    m.addEventListener('click', e => { if (e.target === m) closeModal(id); });
  }
  $('#tg-sound').addEventListener('click', () => {
    save.muted = !save.muted;
    audio.setMuted(save.muted);
    writeSave(); syncToggles();
    audio.play('tap');
  });
  $('#tg-music').addEventListener('click', () => {
    save.music = !save.music;
    audio.setMusic(save.music);
    writeSave(); syncToggles();
  });
  $('#set-close').addEventListener('click', () => closeModal('m-settings'));
  $('#acct-chip').addEventListener('click', openSettings);
  $('#acct-pw').addEventListener('click', () => openLogin('in'));
  $('#lg-form').addEventListener('submit', submitLogin);
  $('#lg-switch').addEventListener('click', () => setLoginMode(lgMode === 'up' ? 'in' : 'up'));
  $('#lg-show').addEventListener('change', e => { const t = e.target.checked ? 'text' : 'password'; $('#lg-pass').type = t; $('#lg-pass2').type = t; });
  $('#acct-out').addEventListener('click', signOut);
  $('#set-map').addEventListener('click', () => leaveToMap());
  $('#set-restart').addEventListener('click', () => startLevel(levelIdx));
  $('#mw-next').addEventListener('click', () => {
    const next = levelIdx + 1;
    const first = $('#mw-next').dataset.first === '1';
    session++; state = 'idle'; closeAllModals();
    waitIdle(4000).then(() => showMap({ pop: first ? next : -1, thenOpen: next }));
  });
  $('#mw-retry').addEventListener('click', () => startLevel(levelIdx));
  $('#mw-map').addEventListener('click', () => leaveToMap());
  $('#btn-closet').addEventListener('click', () => { audio.play('tap'); openCloset(); });
  $('#dk-me').addEventListener('click', () => { audio.play('tap'); scrollMapToCurrent(); });
  $('#mw-closet').addEventListener('click', () => { audio.play('tap'); openCloset(); });
  $('#cl-demo').addEventListener('click', closetDemo);
  $('#cl-ready').addEventListener('click', () => { audio.play('tap'); scrollToChests(); });
  $('#cp-ok').addEventListener('click', () => { $('#cl-pop').hidden = true; renderCloset(); });
  $('#ml-retry').addEventListener('click', () => startLevel(levelIdx));
  $('#ml-more').addEventListener('click', () => {
    if (state !== 'lost' || (save.boosters.moves5 || 0) <= 0) return;
    save.boosters.moves5--; writeSave(); renderBoosters();
    closeModal('m-lose');
    $('#cheer').classList.remove('sad');
    movesLeft += 5; dispMoves = movesLeft; renderMoves();
    state = 'play'; lowWarned = false;
    toast('再給你 5 步，加油！');
    scheduleHint();
  });
  for (const b of $$('.bst')) b.addEventListener('click', () => onBoosterClick(b.dataset.b));
  $('#ml-map').addEventListener('click', () => leaveToMap());

  // 每個按鈕都有小小的點擊聲
  document.addEventListener('click', e => {
    const b = e.target.closest('button, a.btn');
    if (!b || b.classList.contains('ttoy') || b.classList.contains('toggle') || b.classList.contains('locked')) return;
    audio.play('tap');
  });
  // 第一次手勢解鎖音訊（之後每次也呼叫，iOS 從背景回來需要再喚醒）
  const unlock = () => { try { audio.unlock(); } catch (e) {} };
  document.addEventListener('pointerdown', unlock, { capture: true, passive: true });
  document.addEventListener('keydown', unlock, { capture: true });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (boosterMode && boosterMode !== 'busy') { setBoosterMode(null); return; }
    if (isOpen('m-login')) closeModal('m-login');
    else if (isOpen('m-settings')) closeModal('m-settings');
    else if (isOpen('m-start')) closeModal('m-start');
    else if (screen === 'game' && canPause()) openSettings();
  });
  // iOS：擋住雙指縮放
  document.addEventListener('gesturestart', e => e.preventDefault());
  document.addEventListener('dblclick', e => e.preventDefault());

  const onResize = () => { if (screen === 'game') sizeBoard(); else if (screen === 'map') { refreshMapArt(); updateMapHere(); } };
  window.addEventListener('resize', onResize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => setTimeout(onResize, 250));
}

// ---------- 測試掛勾（?debug=1） ----------
function installDebug() {
  const dbg = $('#btn-dbg-win');
  dbg.hidden = false;
  dbg.addEventListener('click', () => window.__game.quickWin());
  window.__game = {
    get engine() { return engine; },
    get renderer() { return R; },
    get state() { return state; },
    get screen() { return screen; },
    get level() { return level; },
    get levelIdx() { return levelIdx; },
    get movesLeft() { return movesLeft; },
    get selected() { return selected; },
    // 可以接受輸入了嗎（測試腳本用：state === 'play' 且沒有動畫在跑）
    get idle() { return state === 'play' && !moving && !!R && !R.busy && !ptr && !$('.modal.open'); },
    levels: LEVELS,
    save,
    startLevel,
    openStartCard,
    showMap,
    quickWin() {
      debugWin = true;
      if (state === 'play' && !moving && !R.busy) winFlow();
    },
    setMoves(n) { movesLeft = dispMoves = n; renderMoves(); },
    unlockAll() { save.unlocked = LEVELS.length; writeSave(); if (screen === 'map') buildMap(); },
    cellCenter(r, c) {
      if (!cellCenters) cellCenters = computeCenters();
      return cellCenters[r + ',' + c] || null;
    },
    cellSize: () => cellSize(),
    // 雲端存檔（測試用）
    get cloud() { return cloud; },
    get account() { return account; },
    get syncState() { return syncState; },
    get saveKey() { return saveKey; },
    pushCloud,
  };
}

// ---------- 開機 ----------
async function boot() {
  initMotes();
  setProgress(0.03);
  const modP = loadModules();
  const imgP = loadImages(f => setProgress(0.08 + f * 0.9));
  // 圓體字和胖數字先載好（畫布上的口號、分數會快取成圖，太晚載入就會用到備用字型）；最多等 3 秒
  const fontP = (document.fonts && document.fonts.load)
    ? Promise.race([Promise.all(['700 20px GenSenRounded', '900 20px GenSenRounded', '900 20px PlushNum'].map(f => document.fonts.load(f, '薯餅0'))).catch(() => {}), sleep(3000)])
    : Promise.resolve();
  const [fail] = await Promise.all([modP, imgP, fontP]);
  if (fail.length) {
    $('#load-text').innerHTML = `載入失敗了 QQ<br><small>${fail.join('、')} 有問題，請重新整理再試一次。</small>`;
    document.documentElement.classList.add('load-failed');
    return;
  }
  if (save.unlocked > LEVELS.length + 1) save.unlocked = LEVELS.length + 1;
  try {
    R = createRenderer(canvas, { pieces: PIECES, images });
  } catch (e) {
    console.error(e);
    $('#load-text').innerHTML = '載入失敗了 QQ<br><small>畫盤面的程式出錯了，請重新整理。</small>';
    return;
  }
  try { audio.setMuted(save.muted); audio.setMusic(save.music); } catch (e) {}
  closet.load(closetKey());
  applyLook();
  renderClosetBtn();
  buildTitle();
  bindUI();
  syncToggles();
  if (DEBUG) installDebug();
  initCloud();          // 不等它：SDK 在背景載，登入狀態恢復後才換成那個帳號的存檔
  setProgress(1);
  await sleep(250);
  show('title');
  const lv = parseInt(params.get('level'), 10);
  if (DEBUG && lv >= 1 && lv <= LEVELS.length) startLevel(lv - 1);
}

boot();
