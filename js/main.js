// 毛絨消消樂 — 主程式：畫面流程、HUD、輸入、存檔、音效對應（SPEC §7）
import { PIECES, TRIO, spritePath, spinPath } from './pieces.js';

window.__plushBooted = true;

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = n => Math.round(n).toLocaleString('en-US');
const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const SVGNS = 'http://www.w3.org/2000/svg';
const SCANNED = PIECES.filter(p => p.scan);
const TITLE_TOYS = (SCANNED.length >= 3 ? SCANNED : PIECES).slice(0, 3);

// ---------- 存檔 ----------
const SAVE_KEY = 'plushcrush.v1';
const save = loadSave();
function loadSave() {
  const def = { unlocked: 1, stars: {}, best: {}, muted: false, music: true };
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return def;
    const s = JSON.parse(raw) || {};
    const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
    return {
      unlocked: Number.isFinite(s.unlocked) && s.unlocked >= 1 ? Math.floor(s.unlocked) : 1,
      stars: obj(s.stars),
      best: obj(s.best),
      muted: !!s.muted,
      music: s.music !== false,
    };
  } catch (e) {
    return def;
  }
}
function writeSave() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* 無痕模式等：照玩 */ }
}

// ---------- 模組 ----------
let createEngine, createRenderer, LEVELS, audio;
const silentAudio = { unlock() {}, play() {}, setMuted() {}, setMusic() {}, get muted() { return true; }, get music() { return false; } };

async function loadModules() {
  const names = ['engine', 'renderer', 'levels', 'audio'];
  const res = await Promise.allSettled(names.map(n => import(`./${n}.js`)));
  const fail = [];
  const mod = i => (res[i].status === 'fulfilled' ? res[i].value : (fail.push(names[i] + '.js'), console.error(res[i].reason), null));
  const eng = mod(0), ren = mod(1), lev = mod(2);
  const aud = res[3].status === 'fulfilled' ? res[3].value : null;
  if (!aud) console.warn('audio.js 載入失敗，改成無聲模式', res[3].reason);
  createEngine = eng && eng.createEngine;
  createRenderer = ren && ren.createRenderer;
  LEVELS = lev && lev.LEVELS;
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
  const total = PIECES.length * 2 + 1;
  const track = p => p.then(v => { done++; onProgress(done / total); return v; });
  for (const p of PIECES) {
    const entry = { sprite: null, spin: null };
    images.set(p.id, entry);
    jobs.push(track(loadImg(spritePath(p.id))).then(im => { entry.sprite = im; }));
    jobs.push(track(loadImg(spinPath(p.id))).then(im => { entry.spin = im; }));
  }
  const trio = { sprite: null, spin: null };
  images.set(TRIO.id, trio);
  jobs.push(track(loadImg(spritePath(TRIO.id))).then(im => { trio.sprite = im; }));
  await Promise.all(jobs);
}

// 玩具小圖（DOM）：有圖用圖，沒有就畫圓形＋名字第一個字
function toyEl(p, fs) {
  const im = images.get(p.id) && images.get(p.id).sprite;
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
const pieceById = id => PIECES.find(p => p.id === id);
const kindOf = id => PIECES.findIndex(p => p.id === id);
function starSvg(cls = '') {
  const s = document.createElementNS(SVGNS, 'svg');
  if (cls) s.setAttribute('class', cls);
  const u = document.createElementNS(SVGNS, 'use');
  u.setAttribute('href', '#i-star');
  s.appendChild(u);
  return s;
}
function jellyIcon(sm) { const d = document.createElement('span'); d.className = 'jelly-ic' + (sm ? ' sm' : ''); return d; }
function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
function restartAnim(node, cls) { node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls); }

// ---------- 畫面切換 ----------
let screen = 'loading';
function show(name) {
  for (const s of $$('.screen')) s.classList.toggle('active', s.id === 'scr-' + name);
  screen = name;
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
  // 鍵盤使用者才自動把焦點移進去（觸控 / 滑鼠不需要焦點框）
  const f = m.querySelector('.btn.green, .btn');
  if (f && usingKeyboard) setTimeout(() => { try { f.focus({ preventScroll: true }); } catch (e) {} }, 60);
}
function closeModal(id) {
  const m = document.getElementById(id);
  if (!m.classList.contains('open')) return;
  m.classList.remove('open');
  m.setAttribute('aria-hidden', 'true');
  if (usingKeyboard && lastFocus && lastFocus.focus) { try { lastFocus.focus({ preventScroll: true }); } catch (e) {} }
}
const isOpen = id => document.getElementById(id).classList.contains('open');
function closeAllModals() { for (const m of $$('.modal.open')) closeModal(m.id); }

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
    b.setAttribute('aria-label', p.name);
    b.appendChild(el('span', 'shadow'));
    const face = el('span', 'face');
    face.appendChild(toyEl(p, 48));
    b.appendChild(face);
    const spin = images.get(p.id) && images.get(p.id).spin;
    if (spin) {
      const sp = el('span', 'spinner');
      sp.style.backgroundImage = `url("${spin.src}")`;
      b.appendChild(sp);
    }
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
  const g = lvl.goal || {};
  const b = el('span', 'badge');
  if (g.type === 'collect') {
    const id = Object.keys(g.items || {})[0];
    const p = pieceById(id);
    if (p) b.appendChild(toyEl(p, 12));
  } else if (g.type === 'jelly') {
    b.classList.add('jelly');
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
  mk('road-shadow', full, 5);
  mk('road', full);
  mk('road-dots', full);
  if (cur > 0) { mk('road-done', done); mk('road-dots-done', done); }
  inner.appendChild(svg);

  // 裝飾
  const decoKinds = ['cloudy', 'lolly', 'toy', 'sweet'];
  for (let i = 0; i < n; i++) {
    if (i % 2 === 1) continue;
    const p = pts[i];
    const side = p.x > 50 ? -1 : 1;
    const kind = decoKinds[(i / 2) % decoKinds.length];
    const d = el('span', 'map-island ' + kind);
    d.style.left = clamp(p.x + side * 34, 9, 91) + '%';
    d.style.top = (p.y - MAP_GAP * 0.45) + 'px';
    if (kind === 'toy') {
      const toy = PIECES[(i / 2) % PIECES.length];
      d.appendChild(toyEl(toy, 22));
      d.style.animationDelay = (-i * 0.7) + 's';
    }
    inner.appendChild(d);
  }

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
      b.innerHTML = '<svg class="lock"><use href="#i-lock"/></svg>';
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

  // 頭像標記站在目前關卡上
  const marker = el('span', 'map-marker');
  marker.appendChild(toyEl(TITLE_TOYS[0], 26));
  const mp = pts[cur];
  marker.style.left = mp.x + '%';
  marker.style.top = (mp.y - 90) + 'px';
  inner.appendChild(marker);

  const end = el('span', 'map-end', '更多關卡製作中…');
  end.style.top = (MAP_TOP * 0.42) + 'px';
  inner.appendChild(end);

  // 星星總數
  const total = LEVELS.reduce((s, l) => s + (Number(save.stars[l.id]) || 0), 0);
  $('#map-stars').textContent = total;
  $('#map-stars-max').textContent = '/ ' + n * 3;
  return pts;
}
function showMap({ pop = -1, thenOpen = -1 } = {}) {
  const pts = buildMap(pop);
  show('map');
  const sc = $('#map-scroll');
  const cur = currentIndex();
  const target = idx => clamp(pts[idx].y - sc.clientHeight * 0.58, 0, sc.scrollHeight);
  if (pop > 0) {
    sc.scrollTop = target(pop - 1);
    requestAnimationFrame(() => sc.scrollTo({ top: target(pop), behavior: 'smooth' }));
  } else {
    sc.scrollTop = target(cur);
  }
  if (thenOpen >= 0) setTimeout(() => { if (screen === 'map') openStartCard(thenOpen); }, 750);
}

// ---------- 目標文字 ----------
function scoreTarget(lvl) { return (lvl.goal && lvl.goal.target) || (lvl.stars && lvl.stars[0]) || 0; }
function goalText(lvl) {
  const g = lvl.goal || {};
  if (g.type === 'collect') {
    return '收集 ' + Object.entries(g.items || {}).map(([id, n]) => `${(pieceById(id) || { name: id }).name} ×${n}`).join('、');
  }
  if (g.type === 'jelly') return '把果凍全部清掉！';
  return `拿到 ${fmt(scoreTarget(lvl))} 分`;
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
      const gb = el('div', 'gb');
      const ic = el('span', 'ic'); ic.appendChild(toyEl(p, 30));
      gb.appendChild(ic); gb.appendChild(el('b', '', '×' + n));
      g.appendChild(gb);
    }
  } else if (goal.type === 'jelly') {
    const gb = el('div', 'gb');
    const ic = el('span', 'ic'); ic.appendChild(jellyIcon());
    gb.appendChild(ic); gb.appendChild(el('b', '', '果凍'));
    g.appendChild(gb);
  } else {
    const gb = el('div', 'gb');
    const ic = el('span', 'ic'); ic.appendChild(starSvg());
    gb.appendChild(ic); gb.appendChild(el('b', '', fmt(scoreTarget(lvl))));
    g.appendChild(gb);
  }
  $('#ms-goal-text').textContent = goalText(lvl);
  $('#ms-moves').textContent = lvl.moves;
  const hint = lvl.hint || '';
  $('#ms-hint-box').hidden = !hint;
  $('#ms-hint').textContent = hint;
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
  engine = createEngine(opts);

  movesLeft = dispMoves = level.moves;
  dispScore = shownScore = 0;
  liveCleared = {};
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

  $('#hud-level').textContent = idx + 1;
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
  await R.banner(`第 ${idx + 1} 關`, { sub: goalText(level), duration: 1500 });
  if (token !== session) return;
  state = 'play';
  scheduleHint();
}

function leaveToMap(opts) {
  session++;
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
      r.gi.setAttribute('aria-label', `${p.name} 還差 ${n}`);
    }
  } else if (g.type === 'jelly') {
    mkItem(jellyIcon(), 'jelly');
  } else {
    const r = mkItem(starSvg(), 'score');
    r.gi.classList.add('score-goal');
  }
  // 星星門檻位置
  const s = level.stars || [1, 2, 3];
  const top = s[2] || s[s.length - 1] || 1;
  $$('.sb-star').forEach((st, i) => { st.style.setProperty('--p', clamp((s[i] || top) / top * 100, 8, 100) + '%'); st.classList.remove('on'); });
  renderGoal(true);
}
function clearedOf(k) { return liveCleared[k] || 0; }
function renderGoal(init = false) {
  for (const r of goalRefs) {
    let txt, done = false;
    if (r.kind === 'collect') {
      const left = Math.max(0, r.need - clearedOf(r.k));
      txt = String(left); done = left === 0;
    } else if (r.kind === 'jelly') {
      txt = String(Math.max(0, jellyLive)); done = jellyLive <= 0;
    } else {
      const t = scoreTarget(level);
      txt = fmt(t); done = shownScore >= t;
    }
    if (r.last !== txt) {
      r.cnt.textContent = txt;
      if (!init && r.kind !== 'score') restartAnim(r.gi.querySelector('.ic'), 'bump');
      r.last = txt;
    }
    r.gi.classList.toggle('done', done);
  }
}
function renderMoves() {
  $('#hud-moves').textContent = Math.max(0, dispMoves);
  $('#hud-moves-box').classList.toggle('low', state !== 'ending' && dispMoves <= 5 && dispMoves > 0);
}
let scoreRaf = 0;
function renderScore(instant = false) {
  if (instant) { shownScore = dispScore; paintScore(); return; }
  if (scoreRaf) return;
  const step = () => {
    const diff = dispScore - shownScore;
    if (Math.abs(diff) < 1) { shownScore = dispScore; paintScore(); scoreRaf = 0; return; }
    shownScore += diff * 0.18 + Math.sign(diff) * 0.5;
    paintScore();
    scoreRaf = requestAnimationFrame(step);
  };
  scoreRaf = requestAnimationFrame(step);
}
function paintScore() {
  $('#hud-score').textContent = fmt(shownScore);
  const s = level ? level.stars || [] : [];
  const top = s[2] || 1;
  $('#starbar-fill').style.width = clamp(shownScore / top * 100, 0, 100) + '%';
  $$('.sb-star').forEach((st, i) => {
    const on = s[i] != null && shownScore >= s[i];
    if (on && !st.classList.contains('on')) { st.classList.add('on'); if (state === 'play' || state === 'ending') audio.play('star', { n: i + 1 }); }
    else if (!on) st.classList.remove('on');
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
  if (moving || R.busy || ptr || $('.modal.open')) { scheduleHint(); return; }
  const h = engine.findHint();
  if (h) R.hint(h.a, h.b);
}
function clearHint() {
  clearTimeout(hintTimer);
  if (R) R.hint(null);
}

// ---------- 事件 → 音效 / HUD ----------
function onEvent(ev, token) {
  if (token !== session || !ev) return;
  switch (ev.t) {
    case 'swap': audio.play('swap'); break;
    case 'swapBack': audio.play('invalid'); break;
    case 'transform':
      if (sugarMode) {
        audio.play('sugar');
        dispMoves = Math.max(0, dispMoves - ((ev.cells && ev.cells.length) || 1));
        renderMoves();
      } else {
        audio.play('combo');
      }
      break;
    case 'clear': {
      const cascade = Math.max(1, ev.cascade || 1);
      audio.play('match', { cascade });
      const fx = new Set((ev.effects || []).map(e => e.fx));
      if (fx.has('line')) audio.play('stripe');
      if (fx.has('blast')) audio.play('wrap');
      if (fx.has('bomb') || fx.has('board')) audio.play('bomb');
      const removed = ev.removed || [];
      if (removed.some(r => r.cause === 'combo')) audio.play('combo');
      if (ev.created && ev.created.length) audio.play('special');
      for (const r of removed) {
        const k = r.piece ? r.piece.kind : -1;
        if (k >= 0) liveCleared[k] = (liveCleared[k] || 0) + 1;
      }
      if (ev.jelly) jellyLive = sumJelly(ev.jelly, jellyCountsLayers);
      dispScore += ev.gained || 0;
      renderScore();
      renderGoal();
      if (cascade >= 2 || fx.size || (ev.created && ev.created.length)) cheer();
      break;
    }
    case 'fall': audio.play('land'); break;
    case 'shuffle': audio.play('shuffle'); toast('沒有步可以走了，洗牌！'); break;
  }
}

function syncFromEngine() {
  const st = engine.stats || {};
  if (st.cleared) {
    liveCleared = {};
    for (const k in st.cleared) liveCleared[k] = st.cleared[k];
  }
  if (typeof st.jellyLeft === 'number') jellyLive = st.jellyLeft;
  dispScore = engine.score;
  renderScore();
  renderGoal();
}

function goalMet() {
  if (debugWin) return true;
  const g = level.goal || {};
  if (g.type === 'collect') return Object.entries(g.items || {}).every(([id, n]) => (engine.stats.cleared[kindOf(id)] || 0) >= n);
  if (g.type === 'jelly') return engine.stats.jellyLeft <= 0;
  return engine.score >= scoreTarget(level);
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
  if (!res || !res.ok) {
    try { await R.play((res && res.events) || [], { onEvent: ev => onEvent(ev, token) }); } catch (e) { console.error(e); }
    if (token === session) { moving = false; scheduleHint(); }
    return;
  }
  movesLeft--;
  dispMoves = movesLeft;
  renderMoves();
  try {
    await R.play(res.events, { onEvent: ev => onEvent(ev, token) });
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

canvas.addEventListener('pointerdown', e => {
  if (state !== 'play' || moving || !R || R.busy) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  if (ptr) return;
  e.preventDefault();
  const cell = R.cellAt(e.clientX, e.clientY);
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
  const cs = cellSize();
  const dx = (e.clientX - ptr.x) / cs, dy = (e.clientY - ptr.y) / cs;
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (Math.max(ax, ay) > 0.08) ptr.moved = true;
  if (Math.max(ax, ay) >= 0.3) {
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
async function winFlow() {
  const token = session;
  state = 'ending';
  clearHint();
  selected = null;
  R.select(null);
  $('#btn-pause').disabled = true;
  renderMoves();
  audio.play('win');
  $('#cheer').classList.add('party');
  const left = movesLeft;
  await R.banner('毛絨狂歡！', left > 0 ? { sub: '剩下的步數變成條紋方塊！', duration: 1700 } : { duration: 1500 });
  if (token !== session) return;
  if (left > 0) {
    sugarMode = true;
    try {
      const res = engine.sugarCrush(left);
      await R.play((res && res.events) || [], { onEvent: ev => onEvent(ev, token) });
    } catch (e) { console.error(e); }
    sugarMode = false;
    if (token !== session) return;
  }
  movesLeft = dispMoves = 0;
  renderMoves();
  syncFromEngine();
  const score = engine.score;
  const thr = level.stars || [];
  const stars = clamp(thr.filter(s => score >= s).length, 1, 3);
  const id = level.id;
  const prevBest = Number(save.best[id]) || 0;
  const newBest = score > prevBest;
  if (newBest) save.best[id] = score;
  save.stars[id] = Math.max(Number(save.stars[id]) || 0, stars);
  const firstClear = save.unlocked < levelIdx + 2;
  save.unlocked = Math.max(save.unlocked, Math.min(levelIdx + 2, LEVELS.length + 1));
  writeSave();
  state = 'won';
  await sleep(450);
  if (token !== session) return;
  showWin(stars, score, newBest && prevBest > 0, prevBest, firstClear);
}

let winTimers = [];
function showWin(stars, score, newBest, best, firstClear) {
  winTimers.forEach(clearTimeout);
  winTimers = [];
  const last = levelIdx >= LEVELS.length - 1;
  $('#mw-title').textContent = stars === 3 ? '太完美了！' : '過關！';
  const bs = $$('#mw-stars .bs');
  bs.forEach(s => s.classList.remove('on'));
  $('#mw-stars').setAttribute('aria-label', `得到 ${stars} 顆星`);
  $('#mw-score').textContent = '0';
  $('#mw-best').hidden = !newBest;
  $('#mw-best-line').textContent = !newBest && best > 0 ? `最高分 ${fmt(Math.max(best, score))}` : '';
  $('#mw-next').hidden = last;
  $('#mw-next').dataset.first = firstClear ? '1' : '';
  const toys = $('#mw-toys');
  toys.innerHTML = '';
  TITLE_TOYS.forEach((p, k) => { const d = el('span', 'mt'); d.style.setProperty('--k', k); d.appendChild(toyEl(p, 26)); toys.appendChild(d); });
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
    $('#mw-score').textContent = fmt(score * (1 - Math.pow(1 - f, 3)));
    if (f < 1 && isOpen('m-win')) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
function confetti() {
  const box = $('#confetti');
  box.innerHTML = '';
  const colors = ['#ff5fa8', '#ffd23f', '#6fe39a', '#6cc8ff', '#b98cff', '#ff9a3c', '#ffffff'];
  for (let i = 0; i < 46; i++) {
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
  clearHint();
  selected = null;
  R.select(null);
  $('#cheer').classList.add('sad');
  audio.play('lose');
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
  } else {
    txt.textContent = `還差 ${fmt(Math.max(0, scoreTarget(level) - engine.score))} 分就過關了！`;
  }
  const toys = $('#ml-toys');
  toys.innerHTML = '';
  TITLE_TOYS.forEach((p, k) => { const d = el('span', 'mt'); d.style.setProperty('--k', k); d.appendChild(toyEl(p, 26)); toys.appendChild(d); });
  openModal('m-lose');
}

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
  openModal('m-settings');
}

// ---------- 綁定按鈕 ----------
function bindUI() {
  $('#btn-start').addEventListener('click', () => showMap());
  $('#map-back').addEventListener('click', () => show('title'));
  for (const b of $$('[data-open-settings]')) b.addEventListener('click', openSettings);
  $('#btn-pause').addEventListener('click', () => { if (state === 'play' || state === 'intro') openSettings(); });
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
  $('#ml-retry').addEventListener('click', () => startLevel(levelIdx));
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
    if (isOpen('m-settings')) closeModal('m-settings');
    else if (isOpen('m-start')) closeModal('m-start');
    else if (screen === 'game' && (state === 'play' || state === 'intro')) openSettings();
  });
  // iOS：擋住雙指縮放
  document.addEventListener('gesturestart', e => e.preventDefault());
  document.addEventListener('dblclick', e => e.preventDefault());

  const onResize = () => { if (screen === 'game') sizeBoard(); };
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
  };
}

// ---------- 開機 ----------
async function boot() {
  setProgress(0.03);
  const modP = loadModules();
  const imgP = loadImages(f => setProgress(0.08 + f * 0.9));
  const [fail] = await Promise.all([modP, imgP]);
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
  buildTitle();
  bindUI();
  syncToggles();
  if (DEBUG) installDebug();
  setProgress(1);
  await sleep(250);
  show('title');
  const lv = parseInt(params.get('level'), 10);
  if (DEBUG && lv >= 1 && lv <= LEVELS.length) startLevel(lv - 1);
}

boot();
