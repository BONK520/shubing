// 薯餅蛋蛋島 — 主程式：畫面流程、HUD、輸入、存檔、音效對應（SPEC §7）
import { PIECES, TRIO, spritePath, spinPath } from './pieces.js?v=20261124v';
import { SLOGANS } from './slogans.js?v=20261124v';
import { createCloset, CATEGORIES, ITEMS, CHESTS, iconSvg, svgUrl, totalStars, setLevels, outfitSvg, ringData, ringDecoSvg } from './cosmetics.js?v=20261124v';
import { blockerCanvas } from './blockers.js?v=20261124v';
import { mapArtHTML, mapSignsHTML, mapStations, stationAt, coverArtHTML, islandMiniHTML, spotHTML } from './mapart.js?v=20261124v';
import { getOpAlways, setOpAlways } from './opening.js?v=20261124v';
import { DEMO, demoEngine, demoSegs } from './demos.js?v=20261124v';
import { STORY } from './story.js?v=20261124v';
// 模組的版本參數：上面和 renderer.js 裡的 import 字串要跟這個一樣（同一個檔案用不同網址會被載成兩份）
const MOD_V = '?v=20261124v';

window.__plushBooted = true;

// 出錯的線索（11/23 工作單8）：最後一個沒接住的錯誤存在這台裝置（shubing.lastError），不上傳到任何地方。
// 設定最下面只顯示版本；網址加 ?debug=1 才看得到錯誤內容
function noteError(msg, src, line, col) {
  try {
    const at = (() => { try { return { screen, level: level ? level.id : null, step: stepNo }; } catch (e) { return {}; } })();   // 還沒初始化完就出錯時拿不到
    localStorage.setItem('shubing.lastError', JSON.stringify({
      msg: String(msg).slice(0, 300), src: String(src || '').replace(location.origin, '').slice(0, 160),
      line: line | 0, col: col | 0, ...at, v: MOD_V.slice(1), t: Date.now(),
    }));
  } catch (e) { /* 無痕模式等 */ }
}
window.addEventListener('error', e => { if (e && e.message) noteError(e.message, e.filename, e.lineno, e.colno); });
window.addEventListener('unhandledrejection', e => {
  const r = e && e.reason;
  const stack = r && r.stack ? String(r.stack).split('\n').slice(1, 3).map(x => x.trim()).join(' | ') : '';
  noteError('Promise：' + (r && r.message ? r.message : String(r)), stack, 0, 0);
});

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
    seen: Array.isArray(s.seen) ? s.seen.filter(x => typeof x === 'string').slice(0, 120) : [],   // 看過教學小卡的機關（這台裝置）。小卡有21種，留空間給之後新增的
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
  window.addEventListener('online', () => { if (account) { pushCloud(); if (!friendsOn) initFriends(account.uid); } });
  document.addEventListener('visibilitychange', () => { if (document.hidden && account && pushTimer) pushCloud(); });
}
async function switchAccount(u) {
  const uid = u ? u.uid : null;
  if ((account ? account.uid : null) === uid) { account = u; renderAccount(); return; }
  clearTimeout(pushTimer); pushTimer = 0;
  const prevKey = saveKey, wasUser = !!account;
  if (!u) {                                  // 登出 → 回到這台裝置的訪客存檔
    clearInProgress(prevKey);                // 換帳號：上一個帳號玩到一半的關不留
    account = null; saveKey = SAVE_KEY; lastPushed = '';
    initFriends(null);
    applySave(loadSave(SAVE_KEY));
    setSync('guest');
    refreshAfterSwitch();
    return;
  }
  account = u; saveKey = SAVE_KEY + '.u.' + uid; lastPushed = '';
  initFriends(null);                       // 上一個人的好友排行榜先收起來，讀完存檔再換這個人的
  const explicit = askGuestMerge;          // 剛按了「登入」（不是重新整理後自動恢復登入）
  if (explicit || wasUser) clearInProgress(prevKey);   // 自己換帳號才清；重新整理後自動恢復登入時，訪客那份不動
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
  if (online) { pushCloud(); initFriends(uid); } else setSync('offline');
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
    publishProfile();                           // 排行榜上的星星和最高分也跟著更新（沒開好友排行榜就不做事）
  } catch (e) {
    console.warn('[cloud] 寫入失敗，連上網路或下次存檔時再試', e);
    if (account && account.uid === uid) setSync('offline');
  }
}
function setSync(s) { syncState = s; renderAccount(); }
function refreshAfterSwitch() {
  if (LEVELS && save.unlocked > LEVELS.length + 1) save.unlocked = LEVELS.length + 1;
  loadCloset();
  applyLook();
  renderClosetBtn();
  renderAccount();
  if (screen === 'map') { buildMap(); buildScrubber(); setTimeout(offerResume, 350); }   // 換成這個帳號後，看這個帳號有沒有玩到一半的關
  if (screen === 'game') renderBoosters();
}

// ---------- 好友排行榜（js/cloud.js 的 players/{uid}；規則在 firestore.rules） ----------
// 登入後才有。先試讀一次自己的公開資料：規則還沒部署（被擋）或連不上 → 入口不出現，遊戲照玩、不跳錯誤。
// 排行榜上的人 = 我加的好友 + 把我加成好友的人（只要一方輸入好友碼，兩邊都看得到）。別人的資料一律當純文字顯示
let friendsOn = false, friendsTry = 0, board = [], boardAt = 0, boardLoading = null, lastPublished = '';
function setFriendsOn(on) {
  friendsOn = on;
  document.documentElement.classList.toggle('has-friends', on);
  const b = $('#map-friends');
  if (b) b.hidden = !on;
  if (!on) { board = []; boardAt = 0; if (isOpen('m-friends')) closeModal('m-friends'); }
  const ms = $('#ms-friends');
  if (ms && !on) ms.hidden = true;
}
const friendsQuiet = (what, e) => console.info(`[friends] ${what}（好友排行榜先藏起來，遊戲照玩）`, (e && e.code) || e);
async function initFriends(uid) {
  const tryId = ++friendsTry;
  setFriendsOn(false);
  lastPublished = '';
  if (!uid || !cloud) return;
  try {
    await cloud.player(uid);                    // 規則沒部署：permission-denied
    if (tryId !== friendsTry || !account || account.uid !== uid) return;
    setFriendsOn(true);
    await publishProfile();
    loadBoard(true);
  } catch (e) {
    if (tryId === friendsTry) friendsQuiet('讀不到排行榜', e);
  }
}
// 只算現在有的關卡（跟地圖下方的星星總數一樣；舊版或測試留下的關卡編號不算）
const levelIds = () => LEVELS ? LEVELS.map(l => String(l.id)) : Object.keys(save.stars);
const sumStars = () => levelIds().reduce((s, id) => s + Math.max(0, Math.min(3, Number(save.stars[id]) || 0)), 0);
function myProfile() {
  const best = {};
  for (const id of levelIds()) { const v = Number(save.best[id]); if (v > 0) best[id] = Math.round(v); }
  return { code: cloud.friendCode(account.uid), name: Array.from(String(account.name || '玩家')).slice(0, 12).join(''), stars: Math.min(3000, sumStars()), best };
}
// 寫自己的公開資料（星星、每關最高分）。沒變就不寫；addUid：順便加好友（失敗時丟出去，讓「加好友」顯示錯誤）
async function publishProfile(addUid) {
  if (!friendsOn || !account) return;
  const uid = account.uid, p = myProfile(), key = JSON.stringify(p);
  if (!addUid && key === lastPublished) return;
  try {
    await cloud.publish({ ...p, t: Date.now() }, uid, addUid);
    if (account && account.uid === uid) lastPublished = key;
  } catch (e) {
    if (addUid) throw e;
    friendsQuiet('分數沒寫上排行榜，下次存檔再試', e);
    if (e && e.code === 'permission-denied') setFriendsOn(false);
  }
}
// 別人的公開資料：只留看得懂的欄位，名字最多 12 個字
function cleanPlayer(p) {
  if (!p || typeof p.uid !== 'string') return null;
  const name = Array.from(String(p.name || '').normalize('NFKC').replace(/\s+/g, ' ').trim()).slice(0, 12).join('') || '玩家';
  const best = {};
  if (p.best && typeof p.best === 'object') {
    for (const [k, v] of Object.entries(p.best)) { const n = Math.round(Number(v)); if (Number.isFinite(n) && n > 0) best[k] = n; }
  }
  return { uid: p.uid, name, stars: Math.max(0, Math.min(3000, Math.round(Number(p.stars) || 0))), best };
}
// 讀排行榜（一分鐘內讀過就用上次的；force 一定重讀）
function loadBoard(force = false) {
  if (!friendsOn || !account) return Promise.resolve(board);
  if (boardLoading) return boardLoading;
  if (!force && Date.now() - boardAt < 60000) return Promise.resolve(board);
  const uid = account.uid;
  const job = (async () => {
    const me = await cloud.player(uid);
    const ids = Array.isArray(me && me.friends) ? me.friends.filter(x => typeof x === 'string' && x !== uid).slice(0, 50) : [];
    const [mine, them] = await Promise.all([
      Promise.all(ids.map(id => cloud.player(id).catch(() => null))),
      cloud.addedMe().catch(() => []),
    ]);
    if (!account || account.uid !== uid || !friendsOn) return board;
    const byId = new Map();
    for (const p of [...mine, ...them]) { const c = cleanPlayer(p); if (c && c.uid !== uid && !byId.has(c.uid)) byId.set(c.uid, c); }
    board = [...byId.values()];
    boardAt = Date.now();
    return board;
  })().catch(e => {
    friendsQuiet('排行榜讀取失敗', e);
    if (e && e.code === 'permission-denied') setFriendsOn(false);
    return board;
  }).finally(() => { if (boardLoading === job) boardLoading = null; });
  boardLoading = job;
  return job;
}
function renderBoard() {
  const list = $('#fr-list');
  if (!list || !account) return;
  const me = { uid: account.uid, name: Array.from(String(account.name || '玩家')).slice(0, 12).join(''), stars: sumStars(), me: true };
  const rows = [me, ...board].sort((a, b) => b.stars - a.stars || (a.me ? -1 : b.me ? 1 : a.name.localeCompare(b.name)));
  list.replaceChildren();
  let rank = 0, prev = -1;
  rows.forEach((p, i) => {
    if (p.stars !== prev) { rank = i + 1; prev = p.stars; }      // 星星一樣多 → 同一名
    const li = el('li', 'fr-row' + (p.me ? ' me' : ''));
    li.dataset.rank = rank;
    const rk = el('span', 'fr-rank'); rk.textContent = rank;
    const av = el('span', 'acct-av fr-av'); av.textContent = Array.from(p.name)[0] || '?';
    const nm = el('span', 'fr-nm'); nm.textContent = p.name;
    if (p.me) nm.appendChild(el('small', '', '（我）'));
    const st = el('span', 'fr-st'); st.appendChild(starSvg('on')); st.appendChild(numEl('b', fmt(p.stars)));
    li.append(rk, av, nm, st);
    list.appendChild(li);
  });
  $('#fr-empty').hidden = board.length > 0;
}
function openFriends() {
  if (!friendsOn || !account) return;
  $('#fr-mycode').textContent = cloud.friendCode(account.uid);
  $('#fr-err').textContent = '';
  $('#fr-input').value = '';
  renderBoard();
  openModal('m-friends');
  loadBoard(true).then(() => { if (isOpen('m-friends')) renderBoard(); });
}
async function copyCode() {
  if (!account) return;
  const code = cloud.friendCode(account.uid);
  try { await navigator.clipboard.writeText(code); toast('好友碼複製好了，貼給朋友吧'); }
  catch (e) { toast('我的好友碼：' + code, 2600); }
}
let frBusy = false;
async function submitFriend(e) {
  e.preventDefault();
  if (frBusy || !friendsOn || !account) return;
  const err = $('#fr-err'), btn = $('#fr-submit');
  const code = String($('#fr-input').value || '').normalize('NFKC').toUpperCase().replace(/[\s-]/g, '');
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) { err.textContent = '好友碼是 6 個英文字母和數字'; return; }
  if (code === cloud.friendCode(account.uid)) { err.textContent = '這是你自己的好友碼喔'; return; }
  const uid = account.uid;
  frBusy = true; btn.disabled = true; err.textContent = '';
  try {
    const found = (await cloud.findCode(code)).map(cleanPlayer).filter(p => p && p.uid !== uid);
    if (!found.length) { err.textContent = '找不到這個好友碼，請朋友先登入遊戲一次'; return; }
    const f = found[0];
    await publishProfile(f.uid);
    if (!account || account.uid !== uid) return;
    if (boardLoading) await boardLoading;
    await loadBoard(true);
    if (isOpen('m-friends')) { renderBoard(); $('#fr-input').value = ''; }
    audio.play('tap');
    toast(`加好友了：${f.name}`, 2000);
  } catch (ex) {
    friendsQuiet('加好友失敗', ex);
    err.textContent = navigator.onLine === false ? '現在離線，連上網路再試一次' : '沒加成功，等一下再試一次';
  } finally {
    frBusy = false; btn.disabled = false;
  }
}
// 關卡卡片：這一關的最高分（自己＋好友最多三個人）
function renderCardFriends(i) {
  const box = $('#ms-friends');
  if (!box) return;
  const lvl = LEVELS[i], id = lvl ? String(lvl.id) : '';
  // 自己玩過就一定列出來（沒登入也看得到），再加上好友裡分數最高的三個人，照分數排；同分時自己排前面
  const friends = friendsOn ? board.map(p => ({ name: p.name, s: p.best[id] || 0 })).filter(r => r.s > 0).sort((a, b) => b.s - a.s).slice(0, 3) : [];
  const mine = Math.round(Number(save.best[id]) || 0);
  const rows = mine > 0 ? [...friends, { name: '我', s: mine, me: true }].sort((a, b) => b.s - a.s || (a.me ? -1 : b.me ? 1 : 0)) : friends;
  box.replaceChildren();
  box.hidden = !rows.length;
  if (!rows.length) return;
  box.appendChild(el('span', 'msf-lbl', '最高分'));
  for (const r of rows) {
    const one = el('span', 'msf-one' + (r.me ? ' me' : ''));
    const n = el('i'); n.textContent = r.name;
    one.append(n, numEl('b', fmt(r.s)));
    box.appendChild(one);
  }
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
const PART_ICON = { dino: () => dinoImg(), frost: () => blockerImg('frost2'), choco: () => blockerImg('choco'), cage: () => blockerImg('cage'), shell: () => blockerImg('shell2'),
  gate: () => blockerImg('gate'), balloon: () => blockerImg('balloon'), jar: () => blockerImg('jar'), egg: () => blockerImg('surprise'), lantern: () => blockerImg('lantern'), bake: () => blockerImg('oven') };
const PART_NAME = { dino: '龍龍', frost: '糖霜', choco: '巧克力', cage: '鐵籠子', shell: '硬殼',
  gate: '票閘', balloon: '熱氣球', jar: '蜂蜜罐', egg: '驚喜蛋', lantern: '燈籠', bake: '烤點心' };
// 用好幾個「部分」來顯示的目標類型（goalParts）
const PART_GOALS = ['dino', 'clear', 'order', 'chocoGot', 'bake', 'mix'];
// 訂單：做出哪一種特殊方塊 / 打出哪一種組合
const ORDER_NAME = { stripe: '條紋方塊', wrap: '包裝糖', bomb: '彩色炸彈', fish: '飛天玩偶', combo: '特殊組合' };
const SHORT_NAME = { stripe: '條紋', wrap: '包裝糖', bomb: '彩色炸彈', fish: '飛天玩偶' };
const orderName = w => ORDER_NAME[w] || w.split('+').map(x => SHORT_NAME[x] || x).join('＋');
function partIcon(part) {
  if (part.kind === 'order') return blockerImg('o-' + part.what);
  if (part.kind === 'chocoGot') return blockerImg('choco');
  return PART_ICON[part.kind] ? PART_ICON[part.kind]() : starSvg();
}
const hasPartIcon = part => !!part && (!!PART_ICON[part.kind] || part.kind === 'order' || part.kind === 'chocoGot');
const partName = part => (part.kind === 'order' ? orderName(part.what) : part.kind === 'chocoGot' ? '巧克力' : PART_NAME[part.kind] || '');
const goalPartsOf = lvl => (levMod.goalParts ? levMod.goalParts(lvl) : [{ kind: 'score' }]);

// ---------- 新機關教學小卡 ----------
// 第一次遇到某種機關時，開始前先跳一張小卡（圖示 + 一句話），點一下就開始。看過的記在 save.seen（這台裝置）
const INTRO = {
  jelly: { name: '冰果凍', text: '在冰塊上面配對，把所有冰果凍敲碎！', icon: () => jellyIcon(), demo: 'jelly' },
  dino: { name: '龍龍', text: '消掉龍龍下面的玩偶，送牠到綠色箭頭出口！', icon: () => dinoImg(), ribbon: '新朋友！', demo: 'dino' },
  cage: { name: '鐵籠子', text: '被關住的玩偶不能動，和牠同色配對或用特效就能打開！', icon: () => blockerImg('cage'), demo: 'cage' },
  frost: { name: '多層糖霜', text: '在旁邊配對就能敲掉一層，最多有三層喔！', icon: () => blockerImg('frost3'), demo: 'frost' },
  choco: { name: '巧克力', text: '每一步都要清掉一點巧克力，不然它會越長越大！', icon: () => blockerImg('choco'), demo: 'choco' },
  lic: { name: '甘草漩渦糖', text: '不能配對，要在旁邊消掉；它還會擋住條紋的光！', icon: () => blockerImg('swirl'), demo: 'lic' },
  portal: { name: '傳送門', text: '從這個門掉下去，會從同顏色的門掉出來！', icon: () => blockerImg('portal'), demo: 'portal' },
  alarm: { name: '鬧鐘', text: '每走一步，鬧鐘就少一格；數到0會爆開，扣掉3步！在旁邊配對或用特效就能拆掉。', icon: () => blockerImg('alarm'), demo: 'alarm' },
  shell: { name: '硬殼', text: '一般配對打不掉，要用條紋、包裝糖這些特殊方塊才打得開！兩個圓點的要打兩下。', icon: () => blockerImg('shell2'), demo: 'shell' },
  pot: { name: '巧克力壺', text: '巧克力壺打不掉。沒打到巧克力、或盤上的巧克力被打光時，它會再噴出新的。', icon: () => blockerImg('pot'), demo: 'pot' },
  gift: { name: '保鮮膜', text: '包在保鮮膜裡的是特殊方塊！在旁邊配對就能拆開，拆開後換一下就能用。', icon: () => blockerImg('wrap'), demo: 'gift' },
  belt: { name: '輸送帶', text: '每走一步，帶子上的方塊都會往箭頭方向跑一格！', icon: () => blockerImg('belt'), demo: 'belt' },
  order: { name: '特殊方塊訂單', text: '照上面的訂單做出特殊方塊：四個連成一排是條紋，L形或T形是包裝糖！', icon: () => blockerImg('o-stripe'), ribbon: '新目標！', demo: 'order' },
  // 有 demo 的小卡，圖示位置放示意動畫（introDemo，資料在 js/demos.js）。以後加新機關，這裡和 DEMO 要一起加
  // 玩到一半點目標列的圖示（有小卡的目標）、或暫停選單的「這關的機關」也能再看一次
  combo: { name: '特殊組合', text: '把兩個特殊方塊換在一起，就會一起爆開！條紋、包裝糖、彩色炸彈、飛天玩偶都可以。', icon: () => blockerImg('o-combo'), ribbon: '新目標！', demo: 'combo' },
  bomb: { name: '彩色炸彈', text: '五個一樣的連成一直線，就會變成彩色炸彈！L形、T形不算喔。', icon: () => blockerImg('o-bomb'), ribbon: '新目標！', demo: 'bomb' },
  // 工作單9 新機關（第131關起）
  gate: { name: '票閘', text: '消掉帶車票的玩偶，車票會飛到最近的票閘；票閘打開時會留下一個條紋方塊！', icon: () => blockerImg('gate'), demo: 'gate' },
  balloon: { name: '熱氣球', text: '每走一步，熱氣球就往上飄一格；飄出最上面就算收集到！', icon: () => blockerImg('balloon'), demo: 'balloon' },
  jar: { name: '蜂蜜罐', text: '在罐子旁邊消掉罐子上畫的那種玩偶，就會裝進去；裝滿會爆開一圈！', icon: () => blockerImg('jar'), demo: 'jar' },
  egg: { name: '驚喜蛋', text: '在蛋旁邊配對三次，蛋就會孵出一個特殊方塊！', icon: () => blockerImg('surprise'), demo: 'egg' },
  lantern: { name: '燈籠串', text: '同一條線上的燈籠是一串，在其中一顆旁邊配對，整串一起點亮！', icon: () => blockerImg('lantern'), demo: 'lantern' },
  oven: { name: '烤箱', text: '在烤箱旁邊配對會加一把火，三把火就烤好一盤，還會往十字方向打出去！', icon: () => blockerImg('oven'), ribbon: '新目標！', demo: 'oven' },
};
// 訂單目標對到哪張小卡：組合（combo、'a+b'）→ combo，彩色炸彈 → bomb，條紋、包裝糖、飛天玩偶 → order
const introOfOrder = what => (what === 'combo' || String(what).includes('+') ? 'combo' : what === 'bomb' ? 'bomb' : 'order');
function levelMechs(lvl) {
  const out = new Set();
  if (lvl.jelly && lvl.jelly.some(row => /[12]/.test(row))) out.add('jelly');
  const obs = (lvl.obstacles || []).join('');
  if (obs.includes('L')) out.add('cage');
  if (/[123]/.test(obs)) out.add('frost');
  if (obs.includes('C')) out.add('choco');
  if (obs.includes('S') || lvl.licorice) out.add('lic');
  if (obs.includes('D') || goalPartsOf(lvl).some(p => p.kind === 'dino')) out.add('dino');
  if (obs.includes('A') || lvl.alarm) out.add('alarm');
  if (/[XY]/.test(obs)) out.add('shell');
  if (obs.includes('P')) out.add('pot');
  if (/[-|WB]/.test(obs)) out.add('gift');
  if (lvl.portals && lvl.portals.length) out.add('portal');
  if (lvl.belts && lvl.belts.length) out.add('belt');
  if (/[GQT]/.test(obs) || lvl.tickets) out.add('gate');
  if (obs.includes('O')) out.add('balloon');
  if (/[a-d]/.test(obs)) out.add('jar');
  if (obs.includes('U')) out.add('egg');
  if (/[m-p]/.test(obs)) out.add('lantern');
  if (obs.includes('K') || goalPartsOf(lvl).some(p => p.kind === 'bake')) out.add('oven');
  for (const p of goalPartsOf(lvl)) if (p.kind === 'order') out.add(introOfOrder(p.what));
  return Object.keys(INTRO).filter(k => out.has(k));
}
// ---------- 教學小卡的示意動畫（11/23 工作單4、工作單11） ----------
// 用真的引擎和另一個盤面繪製器，在 5×5 的小盤面照 js/demos.js 的 DEMO 一步一步演：
// 兩顆發亮 → 手指拖過去互換 → 爆開（或彈回來）→ 打 ✕／✓、目標數字跟著變 → 下一步 → 淡出，換下一個種子重來。
// 一輪：一步的約 3.4 秒，兩步的約 5.3～6.5 秒（都不超過 7 秒）。以後加新機關，INTRO 和 DEMO（js/demos.js）要一起加
let demoR = null, demoCv = null;
// 盤面繪製器和 canvas 只有一份，誰最後開的誰用：舊小卡晚到的 stop() 不能把新小卡的盤面拿掉
let demoOwner = 0;
const MARK_SVG = {
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>',
  ok: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 12.5l4.2 4.2L18.5 7.8"/></svg>',
};
function introDemo(kind, host) {
  const segs = demoSegs(DEMO[kind]);
  if (!segs.length || typeof createEngine !== 'function' || typeof createRenderer !== 'function') return null;
  if (segs.some(d => d.kinds.some(k => k >= PIECES.length))) return null;
  if (!demoCv) { demoCv = document.createElement('canvas'); demoCv.className = 'idemo-cv'; }
  if (!demoR) {
    try { demoR = createRenderer(demoCv, { pieces: PIECES, images, quiet: true }); } catch (e) { console.error(e); demoR = null; return null; }
  }
  const still = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const R2 = demoR, cv = demoCv, multi = segs.length > 1;
  const me = ++demoOwner;
  const newEng = (d, seed) => demoEngine(createEngine, d, seed);
  // 目標小牌子：跟遊戲上方的目標列一樣。訂單、龍龍是「圖示＋名字＋0/1」，其他目標是「圖示＋還差＋數字」；不是目標的機關不放。
  // 兩段的（特殊方塊訂單）每段一個牌子，演到哪一段換哪一個
  const chipIcon = name => (name === 'jelly' ? jellyIcon() : name === 'dino' ? dinoImg() : blockerImg(name));
  const chips = segs.map(d => {
    if (!d.chip) return null;
    const node = el('div', 'idemo-chip' + (still && multi ? ' sm' : ''));
    node.appendChild(chipIcon(d.chip.icon));
    node.appendChild(el('span', 'nm')).textContent = d.chip.order ? d.chip.name : '還差';
    const num = el('b');
    node.appendChild(num);
    return { node, num, c: d.chip };
  });
  const chipTxt = (ch, v) => (ch.c.order ? v + '/1' : String(v));
  const isDone = (ch, v) => (ch.c.order ? v >= 1 : v <= 0);
  const setChip = (ch, v, prev) => {
    if (!ch) return;
    ch.num.textContent = chipTxt(ch, v);
    ch.node.classList.toggle('done', isDone(ch, v));
    ch.node.classList.toggle('up', prev != null && !ch.c.order && v > prev);   // 巧克力長大：數字變多，紅一下
    if (prev != null && v !== prev) restartAnim(ch.node, 'pop');
  };
  const wrap = el('div', 'idemo' + (still ? ' still' : ''));
  host.classList.add('demo');
  host.appendChild(wrap);
  let gen = 0;
  const live = g => g === gen && demoOwner === me;
  const wait = (ms, g) => new Promise(res => setTimeout(() => res(live(g)), ms));
  // 某一格的中心和大小（佔盤面寬高的百分比），手指、光圈、✕✓ 用；盤面要先 layout 過
  const cellPct = (r, c) => {
    const cr = R2.cellRect(r, c), rect = cv.getBoundingClientRect();
    if (!cr || !rect.width) return null;
    return { x: (cr.x - rect.left) / rect.width * 100, y: (cr.y - rect.top) / rect.height * 100, s: cr.size / rect.width * 100 };
  };
  const putAt = (node, p) => { if (!p) return; node.style.left = p.x + '%'; node.style.top = p.y + '%'; node.style.setProperty('--s', p.s + '%'); };
  // ✕ 灰色＝這樣不行，✓ 綠色＝這樣可以；放在那一格的右上角，不蓋住機關
  const mkMark = (t, p) => { const m = el('i', 'idemo-mark ' + t, MARK_SVG[t] || ''); putAt(m, p); return m; };
  const markCell = (st, evs) => {
    if (!st.mark) return null;
    if (st.mark.at === 'spread') { const e = evs.find(v => v.t === 'spread'); return e ? e.to : null; }
    return st.mark.at;
  };
  const playOpts = d => (d.slowFall ? { slowFall: d.slowFall } : {});
  // 輸送帶那一排的發亮框和箭頭（箭頭朝帶子前進的方向）；位置也是百分比，盤面要先 layout 過
  const laneBox = d => {
    const path = d.opts && d.opts.belts && d.opts.belts[0];
    if (!path || path.length < 2) return null;
    const ps = path.map(q => cellPct(q[0], q[1]));
    if (ps.some(p => !p)) return null;
    const s = ps[0].s, xs = ps.map(p => p.x), ys = ps.map(p => p.y);
    const dr = path[1][0] - path[0][0], dc = path[1][1] - path[0][1];
    return { x: Math.min(...xs) - s / 2, y: Math.min(...ys) - s / 2, w: Math.max(...xs) - Math.min(...xs) + s, h: Math.max(...ys) - Math.min(...ys) + s,
      rot: dc > 0 ? 0 : dc < 0 ? 180 : dr > 0 ? 90 : -90 };
  };
  const mkLane = b => {
    const ln = el('i', 'idemo-lane', '<svg viewBox="0 0 40 24" aria-hidden="true"><path d="M6 4l8 8-8 8M20 4l8 8-8 8"/></svg>');
    ln.style.left = b.x + '%'; ln.style.top = b.y + '%'; ln.style.width = b.w + '%'; ln.style.height = b.h + '%';
    ln.style.setProperty('--rot', b.rot + 'deg');
    return ln;
  };

  // ---- 一般：循環播放 ----
  let board = null, finger = null, chipOn = null;
  if (!still) {
    board = el('div', 'idemo-board');
    board.appendChild(cv);
    finger = el('i', 'idemo-finger');
    board.appendChild(finger);
    wrap.appendChild(board);
    chipOn = chips.find(Boolean) || null;
    if (chipOn) wrap.appendChild(chipOn.node);
  }
  const showChip = ch => { if (ch && chipOn && ch !== chipOn) { chipOn.node.replaceWith(ch.node); chipOn = ch; } };
  const marks = () => board.querySelectorAll('.idemo-mark');
  async function loop(g) {
    let round = 0;
    while (live(g)) {
      const k = round++;
      for (let si = 0; si < segs.length; si++) {
        const d = segs[si], ch = chips[si], steps = d.steps;
        const eng = newEng(d, d.seeds[k % d.seeds.length]);
        board.classList.remove('out');
        for (const m of board.querySelectorAll('.idemo-mark, .idemo-lane')) m.remove();
        showChip(ch);
        let val = ch ? ch.c.val(eng.stats) : null;
        if (ch) ch.node.classList.remove('pop');
        setChip(ch, val, null);
        R2.setBoard(eng.snapshot());
        R2.layout();
        const lb = laneBox(d), lane = lb ? mkLane(lb) : null;
        if (lane) board.insertBefore(lane, finger);
        for (let i = 0; i < steps.length; i++) {
          const st = steps[i];
          for (const m of marks()) m.classList.add('gone');      // 上一步的 ✕ 淡掉
          if (lane) {                                              // 輸送帶：帶子那排和箭頭先亮 0.7 秒
            lane.classList.add('on');
            if (!await wait(700, g)) return;
          }
          R2.hint(st.a, st.b);                                     // 兩顆發亮、跳一跳（第一步 0.6 秒，之後 0.4 秒）
          if (!await wait(i ? 400 : 600, g)) return;
          R2.hint(null);
          if (lane) lane.classList.remove('on');
          for (const m of marks()) m.remove();
          const pa = cellPct(st.a.r, st.a.c), pb = cellPct(st.b.r, st.b.c);
          finger.classList.remove('go');
          putAt(finger, pa);
          finger.classList.add('on');                              // 手指按住一顆，拖到旁邊那顆（約 0.6 秒）
          if (!await wait(180, g)) return;
          finger.classList.add('go');
          putAt(finger, pb);
          const dx = st.b.c - st.a.c, dy = st.b.r - st.a.r;
          for (let j = 1; j <= 5; j++) {
            R2.drag(st.a, dx * 0.35 * j / 5, dy * 0.35 * j / 5);
            if (!await wait(80, g)) { R2.drag(null); return; }
          }
          R2.drag(null);
          finger.classList.remove('on');
          const res = eng.swap(st.a, st.b);
          if (!res || (!res.ok && !st.bounce)) { console.warn('[introDemo] 換不動', kind, si + 1, i + 1); return; }
          const opts = playOpts(d);
          // 帶子走的那一下再亮一次
          const onBelt = ev => { if (lane && ev && ev.t === 'belt') restartAnim(lane, 'flash'); };
          if (st.hit) {
            // 特殊組合、彩色炸彈：看到爆的那一下就算做到，不用等後面的掉落
            let saw = false, onHit = null;
            const hitP = new Promise(r => { onHit = r; });
            opts.onEvent = ev => { onBelt(ev); if (!saw && ev && ev.cnt && st.hit(ev.cnt)) { saw = true; onHit(); } };
            const playing = R2.play(res.events, opts);
            await Promise.race([hitP, playing]);
            if (!live(g)) return;
            if (!await wait(850, g)) return;                      // 看完爆炸才算數
            if (i < steps.length - 1) { await playing; if (!live(g)) return; }
          } else {
            opts.onEvent = onBelt;
            await R2.play(res.events, opts);
            if (!live(g)) return;
          }
          if (ch) { const v = ch.c.val(eng.stats); setChip(ch, v, val); val = v; }
          const mc = markCell(st, res.events);
          if (mc) board.appendChild(mkMark(st.mark.t, cellPct(mc.r, mc.c)));
          // 停一下讓人看清楚；打 ✕ 的那一步停久一點，免得還沒看到就換下一步
          if (!await wait(i < steps.length - 1 ? (st.mark && st.mark.t === 'x' ? 900 : 650) : 800, g)) return;
        }
        board.classList.add('out');                                // 淡出，換下一段或下一輪（換一個種子）
        if (!await wait(400, g)) return;
        R2.setBoard(null);                                         // 停掉還沒播完的掉落
      }
    }
  }

  // ---- 減少動態：兩張靜態圖，中間一個箭頭，目標寫成「1 → 2 → 1」 ----
  // 一步的：換之前（兩顆光圈＋手指）→ 換之後；兩步的：第一步的結果（✕）→ 第二步的結果（✓）；
  // 兩段的（特殊方塊訂單）：第一段的結果 → 第二段的結果，牌子各放在自己那張下面
  function stills() {
    const row = el('div', 'idemo-frames');
    const f1 = el('div', 'idemo-board sm'), f2 = el('div', 'idemo-board sm');
    const arrow = el('span', 'idemo-arrow');
    arrow.textContent = '→';
    arrow.setAttribute('aria-hidden', 'true');
    if (multi) {
      const col = (f, ch) => { const c = el('div', 'idemo-col'); c.appendChild(f); if (ch) c.appendChild(ch.node); return c; };
      row.append(col(f1, chips[0]), arrow, col(f2, chips[1]));
    } else row.append(f1, arrow, f2);
    wrap.appendChild(row);
    if (!multi && chips[0]) wrap.appendChild(chips[0].node);
    f1.appendChild(cv);
    const shot = () => { try { return cv.toDataURL(); } catch (e) { return ''; } };
    const isSp = (b, q) => { const p = b && b[q.r] && b[q.r][q.c]; return !!(p && p.special && p.special !== 'none'); };
    const frames = [];                                           // { src, put: [[node, cell]], beam?, lane? }
    const vals = [];                                             // 每一段的牌子數字：[[開頭, 第一步後, …], …]
    // 換完之後的那一張：要停在哪個事件、圈哪一格
    const after = (d, st, evs, draw) => {
      let ev = evs[evs.length - 1], at = d.ringAt || st.b;
      const f = { put: [] };
      if (d.still === 'combo') ev = evs[0];                      // 剛換完、還沒爆的那一刻，上面再疊一個十字光
      else if (d.still === 'ring') { const e2 = evs.find(e => isSp(e.board, st.b)); if (e2) { ev = e2; at = st.b; } }   // 剛做出來的特殊方塊
      else if (d.still === 'exit') { const q = d.opts.portals[0]; at = { r: q[2], c: q[3] }; }   // 傳送門：圈出口
      else if (d.still === 'dino') {                             // 龍龍站上出口、還沒走的那一刻，圈出口
        const i = evs.findIndex(e => e.t === 'exit');
        if (i > 0) ev = evs[i - 1];
        const q = i >= 0 && evs[i].cells && evs[i].cells[0];
        if (q) at = { r: q.r, c: q.c };
      } else if (d.still === 'belt') { ev = evs.find(e => e.t === 'belt') || ev; at = null; f.lane = true; }   // 帶子走完一格，那一排發亮
      f.src = ev ? draw(ev) : '';
      if (d.still === 'combo') f.beam = { at: st.b, dirs: ['h', 'v'] };
      else if (at) f.put.push([el('i', 'idemo-ring big'), at]);
      const mc = markCell(st, evs);
      if (mc) f.put.push([mkMark(st.mark.t, null), mc]);
      if (f.lane) f.lane = laneBox(d);
      return f;
    };
    segs.forEach((d, si) => {
      const ch = chips[si], steps = d.steps;
      const eng = newEng(d, d.seeds[0]);
      const snap0 = eng.snapshot();
      const draw = ev => { R2.setBoard(ev ? { ...snap0, grid: ev.board, jelly: ev.jelly || snap0.jelly, lock: ev.lock || snap0.lock } : snap0); R2.layout(); return shot(); };
      const v = ch ? [ch.c.val(eng.stats)] : [];
      vals.push(v);
      if (!multi && steps.length === 1) {
        const st = steps[0];
        const f = { src: draw(null), put: [] };
        for (const c of [st.a, st.b]) f.put.push([el('i', 'idemo-ring'), c]);
        f.put.push([el('i', 'idemo-finger on still'), st.a]);
        frames.push(f);
        const res = eng.swap(st.a, st.b);
        if (ch) v.push(ch.c.val(eng.stats));
        frames.push(after(d, st, (res && res.events) || [], draw));
      } else if (multi) {
        // 每一段只放最後一步的結果
        let res = null;
        for (const st of steps) { res = eng.swap(st.a, st.b); if (ch) v.push(ch.c.val(eng.stats)); }
        frames.push(after(d, steps[steps.length - 1], (res && res.events) || [], draw));
      } else {
        for (const st of steps) {
          const res = eng.swap(st.a, st.b);
          const evs = (res && res.events) || [];
          if (ch) v.push(ch.c.val(eng.stats));
          const ev = (st.stillAt === 'clear' && evs.find(e => e.t === 'clear')) || evs[evs.length - 1];
          const f = { src: ev ? draw(ev) : '', put: [] };
          const mc = markCell(st, evs);
          if (mc) f.put.push([mkMark(st.mark.t, null), mc]);
          if (st.stillBeam) f.beam = { at: st.b, dirs: [st.stillBeam] };   // 條紋掃過的那一排，空格上面疊一道光
          frames.push(f);
        }
      }
    });
    // 位置要在盤面還在的時候量
    for (const f of frames) for (const it of f.put) it[2] = cellPct(it[1].r, it[1].c);
    for (const f of frames) if (f.beam) f.beam.p = cellPct(f.beam.at.r, f.beam.at.c);
    R2.setBoard(null);
    R2.pause();
    cv.remove();
    [f1, f2].forEach((fr, i) => {
      const f = frames[i];
      if (!f) return;
      if (f.src) { const im = new Image(); im.alt = ''; im.draggable = false; im.src = f.src; fr.appendChild(im); }
      if (f.lane) fr.appendChild(mkLane(f.lane)).classList.add('on');
      for (const [node, , p] of f.put) { putAt(node, p); fr.appendChild(node); }
      const b = f.beam && f.beam.p;
      if (!b) return;
      // 光條：特殊組合是三排三列（寬 3 格），條紋是一排（寬 1 格）
      const w = (f.beam.dirs.length > 1 ? 3 : 1.1) * b.s + '%';
      for (const dir of f.beam.dirs) {
        const ln = el('i', 'idemo-beam ' + dir);
        if (dir === 'h') ln.style.top = b.y + '%'; else ln.style.left = b.x + '%';
        ln.style.setProperty('--s', w);
        fr.appendChild(ln);
      }
    });
    chips.forEach((ch, si) => {
      if (!ch) return;
      const v = vals[si];
      // 一段的寫成「3 → 0」；兩段的牌子放在各自那張下面，只寫結果
      ch.num.textContent = multi ? chipTxt(ch, v[v.length - 1]) : v.map(x => chipTxt(ch, x)).join(' → ');
      ch.node.classList.toggle('done', isDone(ch, v[v.length - 1]));
    });
  }

  return {
    start() {
      const g = ++gen;
      R2.resume();
      try { R2.setLook(closet.look(save.stars)); } catch (e) { /* 衣櫃外觀拿不到就用預設 */ }
      if (still) { try { stills(); } catch (e) { console.error(e); } return; }
      loop(g).catch(e => console.error(e));
    },
    stop() {
      gen++;
      if (demoOwner !== me) return;                              // 已經有新的小卡在用盤面了
      R2.setBoard(null);
      R2.pause();
      cv.remove();
      host.classList.remove('demo');
    },
  };
}
// 打開一張教學小卡，點一下或 alive() 變 false 就關掉。關卡開始前（showIntros）和玩到一半點目標圖示（reopenIntro）都用這個
async function openIntroCard(k, alive) {
  const it = INTRO[k];
  if (!it) return;
  $('#mi-ribbon').textContent = it.ribbon || '新機關！';
  const ic = $('#mi-icon');
  ic.innerHTML = '';
  ic.classList.remove('demo');
  const demo = it.demo ? introDemo(it.demo, ic) : null;
  if (!demo) ic.appendChild(it.icon());
  ic.parentElement.classList.toggle('has-demo', !!demo);   // 手機橫放時示意動畫放左邊、字放右邊（style.css）
  $('#mi-title').textContent = it.name;
  $('#mi-text').textContent = softWrap(it.text);
  openModal('m-intro');
  if (demo) demo.start();
  audio.play('chime', { level: 3 });
  await new Promise(res => {
    const m = $('#m-intro');
    const done = () => { m.removeEventListener('click', done); clearInterval(chk); res(); };
    const chk = setInterval(() => { if (!alive() || !isOpen('m-intro')) done(); }, 200);
    setTimeout(() => m.addEventListener('click', done), 350);     // 剛跳出來的那一下不算（避免連點直接跳過）；動畫不用看完一輪
  });
  if (demo) demo.stop();
  closeModal('m-intro');
}
// 玩到一半點目標列有小卡的圖示：再看一次小卡。不動盤面、步數、分數，也不再記一次看過
function reopenIntro(k) {
  if (state !== 'play' || moving || (R && R.busy) || document.querySelector('.modal.open')) return;
  const token = session;
  openIntroCard(k, () => token === session);
}
async function showIntros(lvl, token) {
  for (const k of levelMechs(lvl)) {
    if (save.seen.includes(k)) continue;
    await openIntroCard(k, () => token === session);
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
  if (name === 'title' && coverDirty) { clearTimeout(coverTimer); coverTimer = setTimeout(buildCover, 550); }   // 等封面縮放動畫（.5s）做完再量
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
let clR = null, clCat = 'outfit', tryOn = {};
let closetExtra = false;   // 以前開過的寶箱這次多了東西：下次打開衣櫃跳一次提示
function loadCloset() {
  closet.load(closetKey());
  if (closet.initSeen(save.stars)) closetExtra = true;
}
const AVA_CATS = ['outfit', 'ring'];   // 這兩類穿在薯餅頭像上，預覽改成放大的頭像
// 預覽用的小盤面：3 × 4，七種玩偶都有，再放一顆條紋和一隻飛天玩偶
const CL_GRID = [[[1], [0], [2], [3]], [[6], [5, 'h'], [4], [1, 'fish']], [[2], [6], [0], [5]]];
function applyLook() {
  const l = closet.look(save.stars);
  if (R && R.setLook) R.setLook(l);
  if (clR) clR.setLook(previewLook());
  renderMeAvatar();
  renderClosetAva();
}
// 薯餅頭像：外圈 → 白底圓盤 → 薯餅（披風在後、帽子衣服在前）→ 稍微超出圓圈的外圈裝飾
// 大小跟著 host 的 --s 變（左下角 52px、衣櫃預覽放大版）
function svgImg(svg, cls) {
  const img = new Image(); img.alt = ''; img.draggable = false; img.className = cls; img.src = svgUrl(svg);
  return img;
}
function avatarToy(outfit) {
  const toy = el('span', 'av-toy');
  const back = outfitSvg(outfit, 'back'), front = outfitSvg(outfit, 'front');
  if (back) toy.appendChild(svgImg(back, 'av-out'));
  const t = toyEl(TITLE_TOYS[1] || TITLE_TOYS[0], 22);
  t.classList.add('av-sloth');
  toy.appendChild(t);
  if (front) toy.appendChild(svgImg(front, 'av-out'));
  return toy;
}
function renderAvatar(host, look) {
  if (!host) return;
  const r = ringData(look.ring);
  const ring = el('span', 'av-ring');
  ring.style.background = r.ring;
  ring.style.setProperty('--ring-sh', r.sh);
  const parts = [ring, el('span', 'av-disc'), avatarToy(look.outfit)];
  const deco = ringDecoSvg(look.ring);
  if (deco) parts.push(svgImg(deco, 'av-deco'));
  host.replaceChildren(...parts);
}
function renderMeAvatar() { renderAvatar($('#dk-me'), closet.look(save.stars)); }
function renderClosetAva() {
  const box = $('#cl-ava');
  if (!box || !isOpen('m-closet')) return;
  const ava = AVA_CATS.includes(clCat);
  box.hidden = !ava;
  $('#cl-board').hidden = ava;
  $('#cl-demo').hidden = ava;
  if (ava) renderAvatar($('#cl-ava-me'), previewLook());
}
function previewLook() {
  const l = closet.look(save.stars);
  for (const [cat, id] of Object.entries(tryOn)) l[cat] = id.split('.')[1];
  return l;
}
function renderClosetBtn() {
  const coins = closet.coins(save.stars), ready = closet.readyChests(save.stars).length > 0;
  setNum($('#cf-coins'), coins);
  $('#cf-dot').hidden = !(ready || closet.hasNew(save.stars));   // 寶箱可以開，或拿到還沒點過的新東西
  $('#btn-closet').classList.toggle('ready', ready);
}
function coinEl(big) { return el('i', 'coin' + (big ? ' big' : '')); }
function openCloset() {
  tryOn = {};
  renderCloset();
  openModal('m-closet');
  renderClosetAva();
  if (closetExtra) { closetExtra = false; setTimeout(() => toast('寶箱裡多了新東西！', 1800), 380); }
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
  if (u.station) return `走到第 ${u.station} 關`;
  if (u.allClear) return '全部關卡過關';
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
    const b = el('button', 'cl-tab' + (c.id === clCat ? ' on' : '') + (closet.hasNew(stars, c.id) ? ' new' : ''));
    b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', c.id === clCat ? 'true' : 'false');
    b.textContent = c.name;
    b.addEventListener('click', () => { if (clCat === c.id) return; clCat = c.id; audio.play('tap'); renderCloset(); renderClosetAva(); });
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
    if (it.cat === 'outfit') pic.appendChild(avatarToy(it.id));   // 薯餅造型：直接看薯餅穿起來的樣子
    else { const img = new Image(); img.alt = ''; img.src = svgUrl(iconSvg(it.id)); img.draggable = false; pic.appendChild(img); }
    if (closet.isNew(it, stars)) b.appendChild(el('span', 'ci-new', '新'));
    if (!unlocked) { const lk = el('span', 'ci-lock'); lk.innerHTML = '<svg><use href="#i-lock"/></svg>'; pic.appendChild(lk); }
    b.appendChild(pic);
    b.appendChild(el('span', 'ci-name', it.name));
    const stt = el('span', 'ci-state');
    if (on) stt.textContent = '穿著中';
    else if (unlocked) stt.textContent = trying ? '試穿中' : '點一下穿上';
    else if (it.unlock.coins) { stt.appendChild(coinEl()); stt.appendChild(document.createTextNode(trying && can ? `再點兌換` : unlockText(it))); }
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
  closet.markSeen(it.id);
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
  else if (u.station) toast(`試穿中～走到第 ${u.station} 關就送`, 2000);
  else if (u.allClear) toast(`試穿中～全部 ${LEVELS ? LEVELS.length : ''} 關都過關就送`, 2000);
  renderCloset();
  renderClosetAva();
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
    closet.markSeen(it.id);   // 開箱時已經看到、也直接穿上了
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

// ---------- 封面背景 ----------
// A（預設）：第 1 站蛋蛋碼頭，上面草地、中間沙灘、下面海；沙灘和海的高度照雲台、按鈕量到的位置畫，物件避開標題和按鈕。
// B（?cover=b）：開頭動畫第 2 段那張整座島的縮圖，模糊、變淡。開頭動畫最後雲散開時看到的就是這一張。
const COVER_B = document.documentElement.classList.contains('cover-b');
let coverKey = '', coverDirty = false, coverTimer = 0;
function buildCover() {
  const bg = $('#cover-bg'), deco = $('#cv-deco'), title = $('#scr-title');
  if (!bg || !title || !title.classList.contains('active')) { coverDirty = true; return; }
  coverDirty = false;
  const W = innerWidth, H = innerHeight;
  const rc = n => { if (!n) return null; const r = n.getBoundingClientRect(); return r.width || r.height ? r : null; };
  // 沙灘上的玩具合照、雲後探頭的娃娃：中間空間夠才放
  if (deco) {
    const d = rc(deco), s = d ? Math.min(1.05, .8 * d.height / 94) : 0;
    const html = d && d.height >= 90 && s >= .65
      ? spotHTML(['ph', 'group'], `left:30%;top:92%;width:100px;height:94px;--s:${s.toFixed(2)}`, 0)
        + spotHTML(['pk', 'moodeng', 'piggy', 'nyanko'], `left:72%;top:92%;width:122px;height:76px;--s:${Math.min(s, 1.15).toFixed(2)}`, 1)
      : '';
    if (deco.dataset.k !== html.length + ':' + (d ? Math.round(d.height) : 0)) { deco.innerHTML = html; deco.dataset.k = html.length + ':' + (d ? Math.round(d.height) : 0); }
  }
  const head = rc($('#scr-title .title-head')), gear = rc($('#scr-title .topbar .icon-btn')), toys = rc($('#title-toys'));
  // 載入條和按鈕在同一格（載入時按鈕只是看不見），所以載入前後量到的一樣，載完不用整張重畫
  const start = rc($('#btn-start')), ar = rc($('#btn-ar')), dd = deco && deco.innerHTML ? rc(deco) : null;
  const key = [W, H, COVER_B, head, gear, toys, start, ar, dd].map(r => r && r.top !== undefined ? [r.left, r.top, r.right, r.bottom].map(Math.round).join(',') : String(r)).join('|');
  if (key === coverKey) return;
  coverKey = key;
  let sandY = toys ? toys.top + toys.height * .3 : H * .55;
  if (dd) sandY = Math.min(sandY, dd.top + dd.height * .45);
  const seaY = Math.min(H - 30, Math.max(sandY + 60, start ? start.top - 6 : H * .8));
  // 背景上的兩朵雲：左邊一朵在標題下面、右邊一朵在上面
  const cw = Math.round(Math.min(W * .3, 150)), chh = Math.round(cw * .525);
  const clouds = [[-cw * .32, head ? head.bottom - chh * .2 : H * .3], [W - cw * .68, Math.max(gear ? gear.bottom + 8 : 0, H * .05)]];
  const pad = (r, p, sx = 0) => r && [r.left - p + r.width * sx, r.top - p, r.right + p - r.width * sx, r.bottom + p];
  const lw = start ? Math.max(0, (Math.min(W * .8, 300) - start.width) / 2) : 0;   // 載入條比按鈕寬一點
  const act = start && [start.left - lw - 4, start.top - 4, start.right + lw + 4, start.bottom + 4];
  const avoid = [pad(head, 6), pad(gear, 4), act, pad(ar, 4), pad(toys, 0, .12)]
    .concat(clouds.map(([x, y]) => [x, y, x + cw, y + chh])).filter(Boolean);
  bg.innerHTML = (COVER_B ? islandMiniHTML(W, H, 'cb-', LEVELS ? LEVELS.length : 0) : coverArtHTML(W, H, { sandY, seaY, avoid }, 'cv-'))
    + clouds.map(([x, y], j) => `<i class="cv-cloud" style="left:${Math.round(x)}px;top:${Math.round(y)}px;width:${cw}px;height:${chh}px;animation-delay:${-j * 9}s"></i>`).join('');
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
// 頂部按鈕列浮在地圖上（地圖畫到螢幕最上緣），地圖最上面多留按鈕列的高度（含瀏海），最後一關和「製作中」的牌子才不會被蓋住
function mapTopOf() { const tb = $('#scr-map .topbar'); return MAP_TOP + Math.round((tb && tb.offsetHeight) || 64); }
let mapNodes = [];
let mapSt = [], mapArtKey = '', mapArtStr = '';   // 目前畫的各站範圍、背景快取（寬度|關卡數|高度）
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
  } else if (hasPartIcon(goalPartsOf(lvl)[0])) {
    // 機關關卡：第一個目標的小圖（龍龍 / 糖霜 / 巧克力 / 籠子 / 訂單）
    b.classList.add('toy', 'mech');
    setToyColors(b, '#9fe8c0');
    b.appendChild(partIcon(goalPartsOf(lvl)[0]));
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
  const top = mapTopOf();
  const H = top + (n - 1) * MAP_GAP + MAP_BOTTOM;
  inner.style.height = H + 'px';
  const pts = LEVELS.map((_, i) => nodePos(i, n, H));
  const cur = currentIndex();

  // 每一站的風景墊在最底下（寬度一樣就用上次畫好的）
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
      b.addEventListener('click', () => openLevel(i));
    }
    inner.appendChild(b);
    mapNodes.push(b);
  });

  // 頭像放在底部固定列（以前站在目前關卡旁邊，第 1 關時會跟衣櫃擠在一起）；目前關卡改用放大＋光暈標出來
  renderMeAvatar();   // 中間那隻（薯餅）當頭像，穿著衣櫃裡選的造型和外圈

  // 最後一站後面的「待續」路牌：跟著目前最後一關走，之後加站不用改這裡
  const end = el('span', 'map-end');
  end.append(el('b', '', '待續'), el('small', '', '新關卡製作中…'));
  end.style.top = (top - MAP_TOP * 0.58) + 'px';   // 按鈕列下面一點（和最後一關的距離跟以前一樣）
  inner.appendChild(end);

  // 星星總數
  const total = LEVELS.reduce((s, l) => s + (Number(save.stars[l.id]) || 0), 0);
  setNum($('#map-stars'), total);
  $('#map-stars-max').textContent = '/ ' + n * 3;
  return pts;
}
// 地圖背景：只跟地圖寬度和關卡數有關，同一個寬度畫一次就好
function mapArt(inner, n, H) {
  const W = Math.round(inner.clientWidth) || 375, key = W + '|' + n + '|' + H;
  if (key !== mapArtKey) { mapArtKey = key; mapArtStr = mapArtHTML(W, n, H); }
  return mapArtStr;
}
// 換了寬度（轉向、視窗變大變小）才重畫背景；路、關卡、站牌都是用 % 排的，不用動
function refreshMapArt() {
  const inner = $('#map-inner'), art = inner && $('.map-art', inner);
  if (!art) return;
  const W = Math.round(inner.clientWidth);
  if (!W || Math.abs(W - (parseInt(mapArtKey, 10) || 0)) <= 2) return;
  art.innerHTML = mapArt(inner, LEVELS.length, parseFloat(inner.style.height));   // 高度照這次排好的地圖
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
// ---------- 快速捲動條（工作單10）----------
// 條上的位置直接對到 scrollTop：最上面（0%）＝地圖最上面＝最新的關卡，最下面（100%）＝第 1 關
const scrub = { drag: false, raf: 0, want: -1, fade: 0, k: '', h: 0 };
const scrubMax = sc => Math.max(1, sc.scrollHeight - sc.clientHeight);
// 地圖上某個高度移到畫面正中間時，圓鈕在條上的位置（0～1）
const scrubFrac = (sc, y) => clamp((y - sc.clientHeight / 2) / scrubMax(sc), 0, 1);
// 畫面中間是第幾關（0 起算）
function levelAtY(y) {
  const y0 = mapNodes[0] ? parseFloat(mapNodes[0].style.top) : 0;
  return clamp(Math.round((y0 - y) / MAP_GAP), 0, LEVELS.length - 1);
}
// 這一站的糖果色：取那一站背景中段的顏色，加飽和、壓暗一點，白色軌道上看得清楚；顏色太淡（雪地之類）就用粉紅
const stColorCache = new Map();
function stationColor(r) {
  if (stColorCache.has(r.name)) return stColorCache.get(r.name);
  let out = '#ff5fa8';
  const st = r.stops || [], hex = st.length ? st[Math.floor(st.length / 2)][1] : '';
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  if (m) {
    const [R0, G0, B0] = [1, 2, 3].map(i => parseInt(m[i], 16) / 255);
    const mx = Math.max(R0, G0, B0), mn = Math.min(R0, G0, B0), d = mx - mn, l = (mx + mn) / 2;
    const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    if (sat > 0.12 && d > 0.04) {
      let h = mx === R0 ? ((G0 - B0) / d) % 6 : mx === G0 ? (B0 - R0) / d + 2 : (R0 - G0) / d + 4;
      h = Math.round((h * 60 + 360) % 360);
      out = `hsl(${h} ${Math.round(clamp(sat * 100 + 25, 60, 88))}% ${h > 40 && h < 75 ? 42 : 52}%)`;
    }
  }
  stColorCache.set(r.name, out);
  return out;
}
// 地圖重排、轉向、關卡變多時重算：每一站的圓點、目前關卡的星星
function buildScrubber() {
  const sc = $('#map-scroll'), box = $('#map-scrub'), dots = $('#scb-dots'), track = $('#scb-track');
  if (!sc || !box || !mapSt.length || !sc.clientHeight) return;
  scrub.h = track.clientHeight;
  const reached = clamp(save.unlocked, 1, LEVELS.length);
  dots.replaceChildren(...mapSt.map(r => {
    const d = el('i', r.from <= reached ? 'on' : '');
    d.style.top = (scrubFrac(sc, (r.top + r.bottom) / 2) * 100).toFixed(2) + '%';
    return d;
  }));
  const node = mapNodes[currentIndex()];
  $('#scb-me').style.top = (scrubFrac(sc, node ? parseFloat(node.style.top) : 0) * 100).toFixed(2) + '%';
  box.setAttribute('aria-valuemax', String(LEVELS.length));
  scrub.k = '';
  updateScrubber();
}
function updateScrubber() {
  const sc = $('#map-scroll'), box = $('#map-scrub');
  if (!box || !mapSt.length || !sc.clientHeight) return;
  if (!scrub.h) scrub.h = $('#scb-track').clientHeight;
  const y = clamp(sc.scrollTop / scrubMax(sc), 0, 1) * scrub.h;
  $('#scb-knob').style.transform = `translateY(${y.toFixed(1)}px)`;
  const mid = sc.scrollTop + sc.clientHeight / 2;
  const r = stationAt(mapSt, mid), lv = levelAtY(mid) + 1;
  if (box.getAttribute('aria-valuenow') !== String(lv)) {
    box.setAttribute('aria-valuenow', String(lv));
    box.setAttribute('aria-valuetext', `第${lv}關，第${r.k}站・${r.name}`);
  }
  const bub = $('#scb-bubble');
  if (scrub.k !== r.k + '|' + r.to) {
    scrub.k = r.k + '|' + r.to;
    box.style.setProperty('--sc', stationColor(r));
    bub.innerHTML = `第${r.k}站・${r.name}<small>第${r.from}～${r.to}關</small>`;
  }
  // 泡泡跟著圓鈕，上下不超出軌道
  const bh = bub.offsetHeight || 44;
  bub.style.transform = `translateY(${clamp(y - bh / 2, -6, Math.max(-6, scrub.h - bh + 6)).toFixed(1)}px)`;
}
// 捲動或按著時變清楚，放開 1.5 秒後變淡（不會完全藏起來）
function wakeScrub() {
  const box = $('#map-scrub');
  if (!box) return;
  box.classList.add('live');
  clearTimeout(scrub.fade);
  if (!scrub.drag) scrub.fade = setTimeout(() => box.classList.remove('live'), 1500);
}
function onMapScroll() { updateMapHere(); updateScrubber(); wakeScrub(); }
// 手指在條上的位置 → scrollTop（同一幀只寫一次，不用平滑捲動）
function scrubTo(clientY) {
  const sc = $('#map-scroll'), tr = $('#scb-track').getBoundingClientRect();
  if (!tr.height) return;
  scrub.want = Math.round(clamp((clientY - tr.top) / tr.height, 0, 1) * scrubMax(sc));
  if (!scrub.raf) scrub.raf = requestAnimationFrame(() => { scrub.raf = 0; if (scrub.want >= 0) sc.scrollTop = scrub.want; });
}
// 畫面中間移到某一站的正中間
function scrollToStation(r) {
  const sc = $('#map-scroll');
  sc.scrollTop = clamp((r.top + r.bottom) / 2 - sc.clientHeight / 2, 0, scrubMax(sc));
}
function bindScrubber() {
  const box = $('#map-scrub');
  box.addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    e.preventDefault();
    scrub.drag = true;
    try { box.setPointerCapture(e.pointerId); } catch (err) {}
    box.classList.add('drag');
    wakeScrub();
    updateScrubber();
    scrubTo(e.clientY);
  });
  box.addEventListener('pointermove', e => { if (scrub.drag) scrubTo(e.clientY); });
  const end = () => {
    if (!scrub.drag) return;
    scrub.drag = false;
    box.classList.remove('drag');
    wakeScrub();
  };
  box.addEventListener('pointerup', end);
  box.addEventListener('pointercancel', end);
  box.addEventListener('lostpointercapture', end);
  box.addEventListener('click', e => e.stopPropagation());
  // 鍵盤：上下鍵一次一站（上＝往後面的關卡），Home＝第 1 關、End＝最新的關卡
  box.addEventListener('keydown', e => {
    const sc = $('#map-scroll');
    if (!mapSt.length) return;
    const r = stationAt(mapSt, sc.scrollTop + sc.clientHeight / 2);
    let t = null;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight' || e.key === 'PageUp') t = mapSt[Math.min(r.k, mapSt.length - 1)];
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'PageDown') t = mapSt[Math.max(r.k - 2, 0)];
    else if (e.key === 'Home') t = mapSt[0];
    else if (e.key === 'End') t = mapSt[mapSt.length - 1];
    if (!t) return;
    e.preventDefault();
    scrollToStation(t);
    wakeScrub();
  });
}

// ---------- 站點清單（工作單10）：點右上角的站名打開 ----------
function openStations() {
  const sc = $('#map-scroll'), list = $('#sl-list');
  if (!mapSt.length) return;
  const here = stationAt(mapSt, sc.scrollTop + sc.clientHeight / 2);
  const reached = clamp(save.unlocked, 1, LEVELS.length), meLv = currentIndex() + 1;
  let hereRow = null;
  list.replaceChildren(...mapSt.map(r => {
    const got = LEVELS.slice(r.from - 1, r.to).reduce((s, l) => s + (Number(save.stars[l.id]) || 0), 0);
    const max = (r.to - r.from + 1) * 3, locked = r.from > reached, me = meLv >= r.from && meLv <= r.to;
    const li = el('li');
    const b = el('button', 'sl-row' + (locked ? ' locked' : '') + (r === here ? ' here' : ''));
    b.type = 'button';
    b.setAttribute('aria-label', `第${r.k}站，${r.name}，第${r.from}到${r.to}關，${got} 顆星${locked ? '，還沒走到' : ''}${me ? '，目前的關卡在這一站' : ''}`);
    b.innerHTML = `<span class="sl-k">${r.k}</span><span class="sl-nm">${r.name}${me ? '<span class="sl-me">目前</span>' : ''}<small>第${r.from}～${r.to}關</small></span>`
      + `<span class="sl-st"><svg><use href="#i-star"/></svg><b>${got}</b><small>/${max}</small></span>`;
    b.addEventListener('click', () => { audio.play('tap'); closeModal('m-stations'); scrollToStation(r); });
    li.appendChild(b);
    if (r === here) hereRow = li;
    return li;
  }));
  openModal('m-stations');
  if (hereRow) list.scrollTop = Math.max(0, hereRow.offsetTop - list.clientHeight / 2 + hereRow.offsetHeight / 2);
}
function scrollMapToCurrentNow() {
  const node = mapNodes[currentIndex()];
  if (node) $('#map-scroll').scrollTop = mapTarget(parseFloat(node.style.top) || 0);
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
  buildScrubber();
  if (thenOpen >= 0) setTimeout(() => { if (screen === 'map') openLevel(thenOpen); }, 750);
  else setTimeout(offerResume, 450);       // 剛剛有玩到一半的關（網頁被重新載入）：問要不要接著玩
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
  if (PART_GOALS.includes(g.type)) {
    const out = [];
    for (const part of goalPartsOf(lvl)) {
      if (part.kind === 'collect') out.push(`收集 ${(pieceById(part.id) || { name: part.id }).name} ×${part.need}`);
      else if (part.kind === 'jelly') out.push('清掉全部果凍');
      else if (part.kind === 'dino') out.push(`救出 ${part.need} 隻龍龍`);
      else if (part.kind === 'frost') out.push('敲掉全部糖霜');
      else if (part.kind === 'choco') out.push('清光巧克力');
      else if (part.kind === 'cage') out.push('打開全部鐵籠子');
      else if (part.kind === 'shell') out.push('打破全部硬殼');
      else if (part.kind === 'gate') out.push('打開全部票閘');
      else if (part.kind === 'balloon') out.push('放走全部熱氣球');
      else if (part.kind === 'jar') out.push('裝滿全部蜂蜜罐');
      else if (part.kind === 'egg') out.push('孵出全部驚喜蛋');
      else if (part.kind === 'lantern') out.push('點亮全部燈籠');
      else if (part.kind === 'bake') out.push(`烤 ${part.need} 次點心`);
      else if (part.kind === 'order') {
        const sp = ['stripe', 'wrap', 'bomb', 'fish'].includes(part.what);
        out.push(sp ? `做出 ${part.need} 個${orderName(part.what)}` : `打出 ${part.need} 次${orderName(part.what)}`);
      } else if (part.kind === 'chocoGot') out.push(`打掉 ${part.need} 塊巧克力`);
    }
    return out.join('、') + '！';
  }
  return `拿到 ${fmt(scoreTarget(lvl))} 分`;
}

// ---------- 中文換行 ----------
// 提示泡泡是 keep-all（中文只在標點後換行），可是一句話最後一段太長時，句尾的「～」「！」會自己掉到下一行。
// 用 Intl.Segmenter 斷詞，在詞跟詞之間放零寬空格（可以換行的地方）；角色名字和遊戲用語不拆開，句尾標點黏住前一個字。
const KEEP_WORDS = ['毛絨', '果凍', '甜甜圈', '包裝糖', '彩色炸彈', '條紋方塊', '變出', '正中間', '飛天玩偶', '長翅膀',
  '龍龍', '鐵籠子', '糖霜', '巧克力', '打光', '甘草糖', '漩渦糖', '傳送門', '出口', '特殊方塊', '特殊組合', '訂單', '王關'];
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
// ---------- 劇情（js/story.js）：在地圖上點一站的第一關，第一次先跳這一站的小故事，看完再開關卡卡片 ----------
const STORY_DONE = from => 'story:' + from;           // 看過了記在 save.seen（跟教學小卡一樣，只存在這台裝置）
let storyBusy = false;
function openLevel(i) {
  const st = STORY.find(x => x.from === i + 1);
  if (!st || save.seen.includes(STORY_DONE(st.from)) || storyBusy) { if (!storyBusy) openStartCard(i); return; }
  storyBusy = true;
  showStory(st).then(() => {
    storyBusy = false;
    save.seen.push(STORY_DONE(st.from));
    writeSave();
    if (screen === 'map') openStartCard(i);
  });
}
async function showStory(st) {
  const station = LEVELS ? mapStations(LEVELS.length, 0).find(x => x.from === st.from) : null;
  $('#st-ribbon').textContent = station ? `第 ${station.k} 站` : '新的一站';
  $('#st-place').textContent = station ? station.name : '';
  const box = $('#st-lines');
  box.replaceChildren();
  st.lines.forEach(([who, text], k) => {
    const p = pieceById(who), line = el('div', 'st-line' + (k % 2 ? ' r' : ''));
    line.style.setProperty('--k', k);
    const av = el('span', 'st-av');
    if (p) { av.appendChild(toyEl(p, 20)); av.appendChild(el('b', '', '')).textContent = p.name; }
    const say = el('p', 'st-say');
    say.textContent = softWrap(text);
    line.append(av, say);
    box.appendChild(line);
  });
  openModal('m-story');
  audio.play('chime', { level: 3 });
  await new Promise(res => {
    const m = $('#m-story');
    const done = () => { m.removeEventListener('click', done); clearInterval(chk); res(); };
    const chk = setInterval(() => { if (!isOpen('m-story')) done(); }, 200);
    setTimeout(() => m.addEventListener('click', done), 450);     // 剛跳出來的那一下不算（避免連點直接跳過）
  });
  closeModal('m-story');
}

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
  } else if (PART_GOALS.includes(goal.type)) {
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
        ic.appendChild(partIcon(part));
        gb.appendChild(ic); gb.appendChild(numEl('b', part.need ? '×' + part.need : partName(part)));
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
  renderCardFriends(i);
  if (friendsOn) loadBoard().then(() => { if (cardLevel === i && isOpen('m-start')) renderCardFriends(i); });
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
let mechLive = { dino: 0, frost: 0, choco: 0, cage: 0, shell: 0, gate: 0, balloon: 0, jar: 0, egg: 0, lantern: 0 };
// 第 131 關起的機關（票閘、熱氣球、蜂蜜罐、驚喜蛋、燈籠串）也算「還剩幾個」
const mechOf = st => ({ dino: st.dinosOut | 0, frost: st.frostLeft | 0, choco: st.chocoLeft | 0, cage: st.locksLeft | 0, shell: st.shellLeft | 0,
  gate: st.gateLeft | 0, balloon: st.balloonLeft | 0, jar: st.jarLeft | 0, egg: st.eggLeft | 0, lantern: st.lanternLeft | 0 });
const MECH_KINDS = ['frost', 'choco', 'cage', 'shell', 'gate', 'balloon', 'jar', 'egg', 'lantern'];
// 訂單 / 收集巧克力的即時數字（engine 每個事件帶的 ev.cnt）
let liveCnt = { made: {}, combos: {}, comboCount: 0, chocoGot: 0, prog: {} };
const cntOf = st => ({ made: { ...(st.made || {}) }, combos: { ...(st.combos || {}) }, comboCount: st.comboCount | 0, chocoGot: st.chocoGot | 0, prog: { ...(st.prog || {}) } });
function countBlocks(board, lock) {
  const o = { frost: 0, choco: 0, shell: 0, gate: 0, balloon: 0, jar: 0, egg: 0 };
  const strings = new Set();
  let cage = 0;
  for (const row of board || []) for (const p of row || []) if (p && p.block) {
    if (p.block === 'frost') o.frost += p.hp | 0; else if (p.block === 'shell') o.shell += p.hp | 0; else if (p.block === 'choco') o.choco++;
    else if (p.block === 'gate') o.gate++; else if (p.block === 'balloon') o.balloon++; else if (p.block === 'jar') o.jar++;
    else if (p.block === 'surprise') o.egg++; else if (p.block === 'lantern') strings.add(p.hp);
  }
  for (const row of lock || []) for (const v of row || []) if (v) cage++;
  return { ...o, cage, lantern: strings.size };
}
let selected = null;
let moving = false;
let sugarMode = false, sugarStepN = 0;
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

// 這一關這次用的亂數種子：第一次玩用關卡的 seed，重來一次換一個
function seedOf(lvl, idx, attempt) {
  const baseSeed = Number.isFinite(lvl.seed) ? lvl.seed : 1 + idx;
  return attempt === 0 ? baseSeed : ((baseSeed * 2654435761) ^ (attempt * 40503)) >>> 0;
}
// 開引擎用的設定（盤面大小、毛絨種類、果凍、機關…）
function levelOpts(lvl, seed) {
  const kinds = (lvl.kinds || PIECES.slice(0, 5).map(p => p.id)).map(kindOf).filter(k => k >= 0);
  const dims = boardDims(lvl);
  const opts = { rows: dims.rows, cols: dims.cols, kinds, mask: lvl.mask || null, jelly: lvl.jelly || null, seed };
  if (lvl.antiCascade != null) opts.antiCascade = lvl.antiCascade;
  if (lvl.goal && lvl.goal.type === 'collect') {      // 飛天玩偶優先飛去目標還要收集的毛絨
    opts.collect = {};
    for (const [id, n] of Object.entries(lvl.goal.items || {})) { const k = kindOf(id); if (k >= 0) opts.collect[k] = n; }
  }
  if (levMod.mechOpts) Object.assign(opts, levMod.mechOpts(lvl));     // 盤面機關
  return opts;
}

// ---------- 玩到一半的存檔（11/23 工作單8） ----------
// 手機把背景分頁收掉、記憶體不夠時，瀏覽器會把網頁整個重新載入，回來就變成封面。
// 每一步停下來就把這關的盤面存在這台裝置（一個帳號一份），重新載入後問要不要接著玩。
// 不放進 save、不上雲端；過關、失敗、從暫停離開、換帳號、超過 24 小時、關卡設定改過，就不留。
const IP_MAX_AGE = 24 * 3600 * 1000;
const LIVE_KEY = 'shubing.live', INT_KEY = 'shubing.lastInterrupt', ERR_KEY = 'shubing.lastError';
const ipKey = (k = saveKey) => k + '.inprogress';
let stepNo = 0, curSeed = 0, liveRec = null, resumeOffered = '', pendingResume = null;
// 關卡設定的指紋：seed、步數、盤面、機關、目標有任何改動，舊的存檔就不能用
function levelSig(lvl, idx) {
  const s = JSON.stringify([lvl.id, seedOf(lvl, idx, 0), lvl.moves, lvl.goal || null, levelOpts(lvl, 0)]);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36) + '.' + s.length;
}
function saveInProgress() {
  if (!engine || !level || state !== 'play' || typeof engine.exportState !== 'function') return;
  try {
    const t = Date.now();
    const rec = { v: 1, id: level.id, idx: levelIdx, attempt: attempts[levelIdx] | 0, seed: curSeed, sig: levelSig(level, levelIdx),
      movesLeft, lowWarned, step: stepNo, score: engine.score, t, eng: engine.exportState() };
    localStorage.setItem(ipKey(), JSON.stringify(rec));
    liveRec = { n: levelIdx + 1, id: level.id, step: stepNo, movesLeft, t, hid: (liveRec && document.hidden && liveRec.hid) || 0 };
    localStorage.setItem(LIVE_KEY, JSON.stringify(liveRec));
  } catch (e) { /* 無痕模式、空間滿了：照玩，只是不能接著玩 */ }
}
function clearInProgress(k = saveKey) {
  liveRec = null;
  try { localStorage.removeItem(ipKey(k)); localStorage.removeItem(LIVE_KEY); } catch (e) { /* ignore */ }
}
// 讀出還能用的中途存檔（不能用的直接丟掉）
function readInProgress() {
  let rec = null;
  try { const raw = localStorage.getItem(ipKey()); rec = raw ? JSON.parse(raw) : null; } catch (e) { rec = null; }
  if (!rec || typeof rec !== 'object') return null;
  const drop = () => { try { localStorage.removeItem(ipKey()); } catch (e) { /* ignore */ } return null; };
  const L = LEVELS && Number.isInteger(rec.idx) ? LEVELS[rec.idx] : null;
  if (rec.v !== 1 || !L || L.id !== rec.id) return drop();
  if (!(Date.now() - rec.t < IP_MAX_AGE)) return drop();
  if (rec.idx + 1 > save.unlocked) return drop();                 // 這份存檔還沒開到這關（換過帳號之類）
  if (rec.sig !== levelSig(L, rec.idx)) return drop();             // 關卡改過了
  if (!(rec.movesLeft > 0) || !rec.eng) return drop();
  try { if (!createEngine(levelOpts(L, rec.seed)).restore(rec.eng)) return drop(); } catch (e) { return drop(); }
  return rec;
}
// 地圖出現時：有還沒玩完的關，跳小卡問要不要接著玩（每個帳號、每次開網頁只問一次）
function offerResume() {
  if (screen !== 'map' || resumeOffered === saveKey || !LEVELS || document.querySelector('.modal.open')) return;
  resumeOffered = saveKey;
  const rec = readInProgress();
  if (!rec) return;
  pendingResume = rec;
  const txt = $('#mr-text');
  txt.textContent = '剛剛的';
  const n = el('span', 'nw');
  n.textContent = `第${rec.idx + 1}關還沒玩完，`;     // 375 寬時不讓「還沒／玩完」拆開
  txt.append(n, document.createElement('br'), '要接著玩嗎？');
  $('#mr-sub').textContent = `還有 ${rec.movesLeft} 步・${fmt(rec.score | 0)} 分`;
  openModal('m-resume');
}
// 上一次是不是玩到一半就被關掉／重新載入：記下來（只存在這台裝置，設定最下面 ?debug=1 才看得到）
function noteInterrupt() {
  try {
    const raw = localStorage.getItem(LIVE_KEY);
    if (!raw) return;
    localStorage.removeItem(LIVE_KEY);
    localStorage.setItem(INT_KEY, JSON.stringify({ ...JSON.parse(raw), at: Date.now() }));
  } catch (e) { /* ignore */ }
}
function noteLive(extra) {
  if (!liveRec) return;
  Object.assign(liveRec, extra);
  try { localStorage.setItem(LIVE_KEY, JSON.stringify(liveRec)); } catch (e) { /* ignore */ }
}
// hid：切到背景的時間（回到前景清掉）；gone：網頁正常關掉／重新整理。兩個都沒有 = 畫面開著的時候被收掉
document.addEventListener('visibilitychange', () => noteLive({ hid: document.hidden ? Date.now() : 0 }));
window.addEventListener('pagehide', () => noteLive({ gone: Date.now() }));
window.addEventListener('pageshow', e => { if (e.persisted && liveRec) noteLive({ gone: 0, hid: 0 }); });

async function startLevel(idx, resume = null) {
  sugarBonus = 0;
  stopFireworks();
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
  if (!resume) clearInProgress();
  attempts[idx] = resume ? resume.attempt | 0 : (attempts[idx] == null ? 0 : attempts[idx] + 1);
  const seed = resume ? resume.seed : seedOf(level, idx, attempts[idx]);
  curSeed = seed;
  engine = createEngine(levelOpts(level, seed));

  movesLeft = dispMoves = level.moves;
  dispScore = shownScore = 0;
  liveCleared = {};
  resetFlights();
  selected = null;
  moving = false;
  sugarMode = false;
  debugWin = false;
  lowWarned = false;
  stepNo = 0;
  let snap = engine.snapshot();
  const layers = sumJelly(snap.jelly, true), cells = sumJelly(snap.jelly, false);
  const statJ = engine.stats ? engine.stats.jellyLeft : layers;
  jellyCountsLayers = statJ === layers || layers === cells;
  jellyLive = statJ;
  const st0 = engine.stats || {};
  mechLive = mechOf(st0);
  liveCnt = cntOf(st0);
  // 接著玩：盤面、分數、目標進度、機關、亂數都放回剛剛那一步
  let resumed = false;
  if (resume) {
    try { resumed = engine.restore(resume.eng); } catch (e) { console.warn('[resume]', e); }
    if (resumed) {
      const st = engine.stats || {};
      liveCleared = { ...(st.cleared || {}) };
      if (typeof st.jellyLeft === 'number') jellyLive = st.jellyLeft;
      mechLive = mechOf(st);
      liveCnt = cntOf(st);
      dispScore = shownScore = engine.score;
      movesLeft = dispMoves = resume.movesLeft;
      lowWarned = !!resume.lowWarned;
      stepNo = resume.step | 0;
      snap = engine.snapshot();
    } else {
      clearInProgress();
      engine = createEngine(levelOpts(level, seed));
      snap = engine.snapshot();
    }
  }

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
  if (resumed) {
    await R.banner('接著玩！', { sub: goalText(level), duration: 1300 });   // 教學小卡剛剛看過了，不再跳
  } else {
    if (resume) toast('剛剛的進度讀不到了，這關重新開始', 2000);
    await showIntros(level, token);
    if (token !== session) return;
    await R.banner(`第 ${idx + 1} 關`, { sub: goalText(level), duration: 1500 });
  }
  if (token !== session) return;
  state = 'play';
  if (resumed) saveInProgress();          // 接著玩之後的「這次開網頁正在玩」記號
  scheduleHint();
  try { cellSize(); } catch (e) { /* 第一次拖曳時再量 */ }   // 先量好格子大小，第一次拖曳不用等
}

function leaveToMap(opts) {
  clearInProgress();                      // 自己離開這關：不留中途進度
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
// 目標的一個部分 → 哪一張教學小卡（工作單11）。巧克力收集：盤上有巧克力壺就看壺的那張
function introOfPart(part) {
  if (part.kind === 'order') return introOfOrder(part.what);
  if (part.kind === 'chocoGot') return (level && (level.obstacles || []).join('').includes('P')) ? 'pot' : 'choco';
  if (part.kind === 'bake') return 'oven';
  return INTRO[part.kind] ? part.kind : '';
}
// 目標列的圖示：有示意動畫小卡的，點一下再看一次（工作單4、工作單11；不動盤面、步數、分數，也不再記一次看過）
function tapIntro(gi, ik) {
  if (!gi || !ik || !INTRO[ik] || !INTRO[ik].demo) return;
  gi.classList.add('tap');
  gi.setAttribute('role', 'button');
  gi.tabIndex = 0;
  gi.title = '再看一次說明';
  const go = e => { e.stopPropagation(); reopenIntro(ik); };
  gi.addEventListener('click', go);
  gi.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(e); } });
}
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
    tapIntro(mkItem(jellyIcon(), 'jelly').gi, 'jelly');
  } else if (PART_GOALS.includes(g.type)) {
    for (const part of goalPartsOf(level)) {
      if (part.kind === 'collect') {
        const p = pieceById(part.id);
        if (!p) continue;
        const r = mkItem(toyEl(p, 20), 'collect');
        r.k = kindOf(part.id); r.need = part.need;
        r.gi.classList.add('toy');
        setToyColors(r.gi, p.color);
      } else if (part.kind === 'jelly') tapIntro(mkItem(jellyIcon(), 'jelly').gi, 'jelly');
      else {
        const r = mkItem(partIcon(part), part.kind);
        r.need = part.need || 0; r.part = part;
        r.gi.setAttribute('aria-label', partName(part));
        tapIntro(r.gi, introOfPart(part));
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
    } else if (MECH_KINDS.includes(r.kind)) {
      const left = Math.max(0, mechLive[r.kind]);
      txt = String(left); done = left <= 0;
    } else if ((r.kind === 'order' || r.kind === 'chocoGot' || r.kind === 'bake') && levMod.partLeft) {
      const left = levMod.partLeft(r.part, liveCnt, kindOf);
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
    // 一個目標剛完成（打勾）：「叮叮！」＋圖示炸一圈星星（分數目標不算，星星條自己有音效）
    if (!init && done && r.done === false && r.kind !== 'score' && (state === 'play' || state === 'ending')) {
      audio.play('goaldone');
      starBurst(r.gi.querySelector('.ic'));
    }
    r.done = done;
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
  cage: 'cage', frost: 'frost', choco: 'choco', swirl: 'swirl', spread: 'spread', dino: 'dino', hatch: 'hatch',
  tick: 'tick', tickhot: 'tickhot', alarm: 'alarm', alarmoff: 'alarmoff', shell: 'shell', gift: 'gift', belt: 'belt',
  // 工作單9 新機關：先借用現有的音效
  gate: 'cage', ticket: 'chime', jar: 'wrap', jarfill: 'pop', egg: 'hatch', eggcrack: 'shell', lantern: 'chime',
  oven: 'stripe', ovenfire: 'tick', balloon: 'special' };
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
    case 'gate': case 'jar': case 'egg': case 'lantern': case 'oven': case 'balloon': buzzLater(d, 14, 60); break;
    case 'bomb': case 'board': case 'combo': buzzLater(d, [18, 40, 18], 60); break;
    case 'cage': case 'frost': case 'choco': case 'gift': buzzLater(d, 12, 60); break;
    case 'shell': buzzLater(d, 16, 60); break;
    case 'dino': buzzLater(d, [12, 30, 12], 80); break;
    case 'hatch': buzzLater(d + ((data && data.crack) || 0), 18, 60); break;     // 破殼那一下
    case 'alarm': buzzLater(d, [30, 40, 30, 40, 30], 80); break;
    case 'alarmoff': buzzLater(d, 12, 60); break;
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
    if (from && data.dy) from.y += data.dy * from.size;       // 龍龍破殼後先往上飛了幾格，從那裡接著飛
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
    case 'alarm':
      dispMoves = Math.max(movesLeft, dispMoves - 3 * ((ev.cells && ev.cells.length) || 1));
      renderMoves();
      break;
    case 'transform':
      if (ev.gained) { dispScore += ev.gained; renderScore(); }
      if (sugarMode) {
        audio.play('sugarstep', { n: sugarStepN++ });     // 每一步一個小「叮」，一步比一步高（整段小號只在開頭吹一次）
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
      if (ev.cnt) liveCnt = cntOf(ev.cnt);
      queueFlights(before, jellyBefore);
      dispScore += ev.gained || 0;
      renderScore();
      renderGoal();
      if (cascade >= 2 || fx.size || (ev.created && ev.created.length)) cheer();
      break;
    }
    case 'exit': {
      if (ev.balloon) {     // 熱氣球飄出最上面：直接扣
        if (ev.board) Object.assign(mechLive, countBlocks(ev.board, ev.lock));
        else mechLive.balloon = Math.max(0, mechLive.balloon - (ev.cells || []).length);
        if (ev.cnt) liveCnt = cntOf(ev.cnt);
        renderGoal();
        break;
      }
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
  mechLive = mechOf(st);
  liveCnt = cntOf(st);
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
  saveInProgress();
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
  stepNo++;
  // 鬧鐘數到 0 爆開：一個扣 3 步（不夠扣就變 0，照平常步數用完的流程走）。畫面上的步數等爆開那一刻才扣
  if (res.alarms) movesLeft = Math.max(0, movesLeft - 3 * res.alarms);
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
  if (movesLeft <= 5 && movesLeft > 0 && !lowWarned) { lowWarned = true; toast('只剩 ' + movesLeft + ' 步了！', 1300); audio.play('lowmoves'); }
  saveInProgress();
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
  clearInProgress();
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
  fireworks(3600);                          // 過關煙花（橫幅跳出來的同時從下面發射）
  $('#cheer').classList.add('party');
  const left = movesLeft;
  sugarBonus = left * 3000;
  if (left > 0 && SLOGANS.sugar.voice) audio.play('voice', { id: SLOGANS.sugar.voice, delay: 150 });
  await R.banner(left > 0 ? SLOGANS.sugar.text : SLOGANS.win.text,
    left > 0 ? { sub: `剩下 ${left} 步 × 3,000 分！`, duration: 1700 } : { duration: 1300 });
  if (token !== session) return;
  if (left > 0) {
    sugarMode = true; sugarStepN = 0;
    audio.play('sugar');                    // 小號只在開頭吹一次
    try {
      const res = engine.sugarCrush(left);
      // 剩下的步數一步一步慢慢變成特效（sugarStep：每步至少停 420ms；以前 220ms，一下子就全變完看不清楚）；
      // 之後的連爆照原本的快節奏（landHold 80、掉落 slowFall 0.82 ≈ 改版前的速度），整段才不會拖太久
      await R.play((res && res.events) || [], { sugarStep: 420, landHold: 80, slowFall: 0.82, onEvent: ev => onEvent(ev, token), onCue: (n, d) => onCue(n, d, token) });
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
let winsSinceCheer = 99;                    // 上次講「三寶都愛你！」之後過了幾關（showWin）
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
  $('#mw-title').parentElement.classList.remove('two');
  // 「三寶都愛你！」語音（2026-11：玩家覺得太多）：只在第一次拿到這關三星時講，而且至少隔兩次過關才講一次；字照樣顯示
  winsSinceCheer++;
  if (newThree && winsSinceCheer >= 3 && SLOGANS.win3.voice) { audio.play('voice', { id: SLOGANS.win3.voice, delay: 1500 }); winsSinceCheer = 0; }
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
  // 最後一關（看 LEVELS.length，不寫死關數）：不說「結局」，只說目前的關卡過完了、新關卡還在做（工作單9）
  if (last) {
    // 九個字放一行會被右上角的玩偶照片蓋住，拆成兩行
    $('#mw-title').replaceChildren('目前的關卡', document.createElement('br'), '都過完了');
    $('#mw-title').parentElement.classList.add('two');
    const bl = $('#mw-best-line');
    // 分數說明太長時「新關卡製作中」會被從中間斷開：有其他說明就自己放一行
    if (bl.textContent) bl.replaceChildren(bl.textContent, document.createElement('br'), '新關卡製作中');
    else bl.textContent = '新關卡製作中';
  }
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

// ---------- 過關煙花（2026-11）：全螢幕透明畫布（#fireworks），在遊戲畫面上面、彈窗下面 ----------
// 從下面發射幾顆，飛到上半部「碰」地開花（一圈彩色火花 + 往下掉的金色細火），約 3~4 秒；系統設定「減少動態」時不放
const FW_COLS = [['#ff5fa8', '#ffc4e1'], ['#ffd23f', '#fff3b0'], ['#4fdc8a', '#c9ffdc'], ['#55bfff', '#d0eeff'], ['#b48aff', '#e7d9ff'], ['#ff9a3c', '#ffdcb5']];
let fwCanvas = null, fwCtx = null, fwRaf = 0, fwEnd = 0, fwNext = 0, fwLast = 0, fwW = 0, fwH = 0;
let fwRockets = [], fwParts = [], fwFlash = [];
function fireworks(ms = 3200) {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  fwCanvas = fwCanvas || $('#fireworks');
  if (!fwCanvas || !fwCanvas.getContext) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  fwW = window.innerWidth; fwH = window.innerHeight;
  fwCanvas.width = Math.round(fwW * dpr); fwCanvas.height = Math.round(fwH * dpr);
  fwCtx = fwCanvas.getContext('2d');
  fwCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const t = performance.now();
  fwEnd = t + ms; fwNext = t + 80;
  fwCanvas.hidden = false;
  if (!fwRaf) { fwLast = t; fwRaf = requestAnimationFrame(fwFrame); }
}
function stopFireworks() {
  fwEnd = 0; fwRockets = []; fwParts = []; fwFlash = [];
  if (fwRaf) cancelAnimationFrame(fwRaf);
  fwRaf = 0;
  if (fwCtx) fwCtx.clearRect(0, 0, fwW, fwH);
  if (fwCanvas) fwCanvas.hidden = true;
}
function fwLaunch(t) {
  const x = fwW * (0.15 + Math.random() * 0.7), y = fwH * (0.14 + Math.random() * 0.32);
  const dur = 700 + Math.random() * 250;
  fwRockets.push({ x0: x + (Math.random() - 0.5) * fwW * 0.12, y0: fwH + 12, x1: x, y1: y, t0: t, dur, col: FW_COLS[Math.floor(Math.random() * FW_COLS.length)] });
  audio.play('firework', { boom: dur, pan: (x / fwW - 0.5) * 1.2 });
}
function fwBurst(r, t) {
  // 大小跟著螢幕走（手機直的約半徑 130px）；一圈彩色火花 + 中間一圈白色亮點 + 慢慢飄下來的金色細火
  const U = Math.min(fwW, fwH), n = 56 + Math.floor(Math.random() * 16), sp = U * (0.00068 + Math.random() * 0.00012);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.1, v = sp * (0.85 + Math.random() * 0.2);
    fwParts.push({ x: r.x1, y: r.y1, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t0: t, life: 1050 + Math.random() * 350, col: r.col[i % 3 ? 0 : 1], w: 3.4, g: 0.00014, glow: true });
  }
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2, v = sp * 0.45;
    fwParts.push({ x: r.x1, y: r.y1, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t0: t, life: 700, col: '#ffffff', w: 2.6, g: 0.0001 });
  }
  for (let i = 0; i < 18; i++) {          // 金色細火：慢慢往下飄、會閃
    const a = Math.random() * Math.PI * 2, v = Math.random() * sp * 0.35;
    fwParts.push({ x: r.x1, y: r.y1, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t0: t + 150, life: 1400 + Math.random() * 500, col: '#ffe27a', w: 2.2, g: 0.00007, twinkle: true });
  }
  fwFlash.push({ x: r.x1, y: r.y1, t0: t, col: r.col[0], R: U * 0.2 });
}
function fwFrame(t) {
  fwRaf = 0;
  const dt = Math.min(40, t - fwLast);
  fwLast = t;
  if (fwEnd && t < fwEnd && t >= fwNext) { fwLaunch(t); fwNext = t + 360 + Math.random() * 300; }
  const g = fwCtx;
  g.clearRect(0, 0, fwW, fwH);
  g.lineCap = 'round';
  // 火箭：拖著一條漸漸淡掉的尾巴往上飛，速度越來越慢
  fwRockets = fwRockets.filter(r => {
    const p = Math.min(1, (t - r.t0) / r.dur);
    if (p >= 1) { fwBurst(r, t); return false; }
    const e = 1 - Math.pow(1 - p, 2.2), e0 = 1 - Math.pow(1 - Math.max(0, p - 0.08), 2.2);
    const x = r.x0 + (r.x1 - r.x0) * e, y = r.y0 + (r.y1 - r.y0) * e;
    const xb = r.x0 + (r.x1 - r.x0) * e0, yb = r.y0 + (r.y1 - r.y0) * e0;
    const grd = g.createLinearGradient(xb, yb, x, y);
    grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(1, r.col[1]);
    g.strokeStyle = grd; g.lineWidth = 4; g.globalAlpha = 1;
    g.beginPath(); g.moveTo(xb, yb); g.lineTo(x, y); g.stroke();
    g.fillStyle = r.col[1]; g.globalAlpha = 0.5; g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.globalAlpha = 1; g.beginPath(); g.arc(x, y, 3.2, 0, Math.PI * 2); g.fill();
    return true;
  });
  // 開花那一下：一團很快散掉的光
  fwFlash = fwFlash.filter(f => {
    const p = (t - f.t0) / 260;
    if (p >= 1) return false;
    const rad = f.R * (0.35 + 0.65 * p), grd = g.createRadialGradient(f.x, f.y, 0, f.x, f.y, rad);
    grd.addColorStop(0, 'rgba(255,255,255,0.9)'); grd.addColorStop(0.35, f.col); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.globalAlpha = (1 - p) * 0.55; g.fillStyle = grd;
    g.beginPath(); g.arc(f.x, f.y, rad, 0, Math.PI * 2); g.fill();
    return true;
  });
  // 火花：每顆畫成一小段（目前位置往回拉一點），看起來在飛
  fwParts = fwParts.filter(q => {
    const age = t - q.t0;
    if (age < 0) return true;
    if (age > q.life) return false;
    const k = Math.pow(0.9985, dt);          // 空氣阻力
    q.vx *= k; q.vy = q.vy * k + q.g * dt;
    q.x += q.vx * dt; q.y += q.vy * dt;
    const f = 1 - age / q.life;
    let a = f < 0.35 ? f / 0.35 : 1;
    if (q.twinkle) a *= 0.45 + 0.55 * Math.abs(Math.sin(age / 55 + q.x));
    const x0 = q.x - q.vx * 34, y0 = q.y - q.vy * 34;
    if (q.glow) {                            // 外面一圈淡淡的光暈，淺色背景上也看得清楚
      g.globalAlpha = a * 0.3; g.strokeStyle = q.col; g.lineWidth = q.w * 2.6;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(q.x, q.y); g.stroke();
    }
    g.globalAlpha = a;
    g.strokeStyle = q.col; g.lineWidth = q.w;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(q.x, q.y); g.stroke();
    return true;
  });
  g.globalAlpha = 1;
  if ((fwEnd && t < fwEnd) || fwRockets.length || fwParts.length || fwFlash.length) fwRaf = requestAnimationFrame(fwFrame);
  else stopFireworks();
}

async function loseFlow() {
  const token = session;
  clearInProgress();                      // 失敗了就不留（按「＋5 步」繼續玩時再存）
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
  } else if (PART_GOALS.includes(g.type) && levMod.partLeft) {
    txt.appendChild(document.createTextNode('還差一點點：'));
    txt.appendChild(document.createElement('br'));
    for (const part of goalPartsOf(level)) {
      const left = levMod.partLeft(part, engine.stats, kindOf);
      if (!left) continue;
      const row = el('span', 'row');
      if (part.kind === 'collect') { const p = pieceById(part.id); if (p) row.appendChild(toyEl(p, 14)); }
      else if (part.kind === 'jelly') row.appendChild(jellyIcon(true));
      else row.appendChild(partIcon(part));
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
  const box = $('#acct-box');       // 帳號只放在設定最上面（封面左上的小牌子 11/23 拿掉了，跟右上齒輪重複）
  if (!box) return;
  box.hidden = !on;
  if (!on) return;
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
  $('#tg-op').setAttribute('aria-pressed', String(getOpAlways()));
}
function openSettings() {
  const inGame = screen === 'game' && (state === 'play' || state === 'intro');
  const m = $('#m-settings');
  m.classList.toggle('in-game', inGame);
  $('#set-title').textContent = inGame ? '暫停' : '設定';
  $('#set-close').textContent = inGame ? '繼續' : '好了';
  syncToggles();
  renderAccount();
  renderVersion();
  renderMechs(inGame && state === 'play');
  openModal('m-settings');
}
// 暫停選單的「這關的機關」（工作單11）：這關有哪些機關，點一下再看那張小卡；看完回到暫停選單。
// 跟目標列一樣：不動盤面、步數、分數，也不再記一次看過。沒有機關的關卡整行不顯示
function renderMechs(on) {
  const box = $('#set-mechs'), list = $('#set-mechs-list');
  if (!box || !list) return;
  list.innerHTML = '';
  const ks = on && level ? levelMechs(level) : [];
  box.hidden = !ks.length;
  for (const k of ks) {
    const it = INTRO[k];
    const b = el('button', 'sm-it');
    b.type = 'button';
    b.setAttribute('aria-label', '再看一次：' + it.name);
    const ic = el('span', 'sm-ic');
    ic.appendChild(it.icon());
    b.appendChild(ic);
    b.appendChild(el('small')).textContent = it.name;
    b.addEventListener('click', () => reviewMech(k));
    list.appendChild(b);
  }
}
async function reviewMech(k) {
  if (state !== 'play' || !isOpen('m-settings')) return;
  const token = session;
  closeModal('m-settings');
  await openIntroCard(k, () => token === session);
  if (token === session && state === 'play' && screen === 'game' && !document.querySelector('.modal.open')) openSettings();
}
// 設定最下面的小字：版本（大家都看得到）；?debug=1 時多顯示最後一次的錯誤和中斷紀錄
function renderVersion() {
  const box = $('#set-ver');
  if (!box) return;
  box.textContent = '版本 ' + MOD_V.slice(1);
  if (!DEBUG) return;
  const get = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
  const when = t => (t ? new Date(t).toLocaleString('zh-TW', { hour12: false }) : '');
  const er = get(ERR_KEY), it = get(INT_KEY);
  const lines = [];
  if (er) lines.push(`最後的錯誤：${er.msg}｜${er.src}:${er.line}:${er.col}｜${er.screen || ''} 第${er.level || '-'}關 第${er.step | 0}步｜${er.v || ''}｜${when(er.t)}`);
  if (it) lines.push(`上次中斷：第${it.n}關 第${it.step | 0}步（還有${it.movesLeft}步）｜最後一步 ${when(it.t)}｜${it.gone ? '正常關掉／重新整理 ' + when(it.gone) : it.hid ? '在背景被收掉（切到背景 ' + when(it.hid) + '）' : '畫面開著時被收掉'}｜發現 ${when(it.at)}`);
  if (!lines.length) lines.push('沒有錯誤紀錄');
  const d = el('span', 'dbg');
  d.textContent = lines.join('\n');
  box.appendChild(d);
}

// ---------- 綁定按鈕 ----------
function bindUI() {
  $('#btn-start').addEventListener('click', () => showMap());
  $('#map-back').addEventListener('click', () => show('title'));
  $('#map-scroll').addEventListener('scroll', onMapScroll, { passive: true });
  bindScrubber();
  $('#map-here').addEventListener('click', () => { audio.play('tap'); openStations(); });
  $('#sl-home').addEventListener('click', () => { audio.play('tap'); closeModal('m-stations'); scrollMapToCurrentNow(); });
  for (const b of $$('[data-open-settings]')) b.addEventListener('click', openSettings);
  // 一步還在結算（掉落、連鎖）時不能暫停，免得過關／失敗的流程跑在暫停選單後面
  const canPause = () => (state === 'play' && !moving && !(R && R.busy)) || state === 'intro';
  $('#btn-pause').addEventListener('click', () => { if (canPause()) openSettings(); });
  $('#ms-play').addEventListener('click', () => { if (cardLevel >= 0) startLevel(cardLevel); });
  $('#mr-go').addEventListener('click', () => { const r = pendingResume; pendingResume = null; closeModal('m-resume'); if (r) startLevel(r.idx, r); });
  $('#mr-new').addEventListener('click', () => { const r = pendingResume; pendingResume = null; closeModal('m-resume'); clearInProgress(); if (r) startLevel(r.idx); });
  for (const b of $$('[data-close]')) b.addEventListener('click', () => closeModal(b.closest('.modal').id));
  // 點背景關閉（只限開始卡、設定、好友排行榜、站點清單）
  for (const id of ['m-start', 'm-settings', 'm-friends', 'm-stations']) {
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
  $('#tg-op').addEventListener('click', () => { setOpAlways(!getOpAlways()); syncToggles(); audio.play('tap'); });
  $('#set-close').addEventListener('click', () => closeModal('m-settings'));
  $('#acct-pw').addEventListener('click', () => openLogin('in'));
  $('#lg-form').addEventListener('submit', submitLogin);
  $('#lg-switch').addEventListener('click', () => setLoginMode(lgMode === 'up' ? 'in' : 'up'));
  $('#lg-show').addEventListener('change', e => { const t = e.target.checked ? 'text' : 'password'; $('#lg-pass').type = t; $('#lg-pass2').type = t; });
  $('#acct-out').addEventListener('click', signOut);
  $('#map-friends').addEventListener('click', () => { audio.play('tap'); openFriends(); });
  $('#fr-form').addEventListener('submit', submitFriend);
  $('#fr-copy').addEventListener('click', copyCode);
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
    saveInProgress();
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
    else if (isOpen('m-stations')) closeModal('m-stations');
    else if (screen === 'game' && canPause()) openSettings();
  });
  // iOS：擋住雙指縮放
  document.addEventListener('gesturestart', e => e.preventDefault());
  document.addEventListener('dblclick', e => e.preventDefault());

  const onResize = () => {
    if (screen === 'game') sizeBoard(); else if (screen === 'map') { refreshMapArt(); updateMapHere(); buildScrubber(); }
    if (screen === 'title') { clearTimeout(coverTimer); coverTimer = setTimeout(buildCover, 250); } else coverDirty = true;
  };
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
    openLevel,
    showMap,
    quickWin() {
      debugWin = true;
      if (state === 'play' && !moving && !R.busy) winFlow();
    },
    setMoves(n) { movesLeft = dispMoves = n; renderMoves(); },
    unlockAll() { save.unlocked = LEVELS.length; writeSave(); if (screen === 'map') { buildMap(); buildScrubber(); } },
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
    // 玩到一半的存檔（測試用）
    get stepNo() { return stepNo; },
    readInProgress,
    offerResume,
    ipKey: () => ipKey(),
    resetResumeOffer() { resumeOffered = ''; },
    reopenIntro,   // 教學小卡（截圖用）
  };
}

// ---------- 開機 ----------
async function boot() {
  try { buildCover(); } catch (e) { console.warn('[cover]', e); }   // 封面背景先畫好：載入條就放在封面上
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
  noteInterrupt();
  try {
    R = createRenderer(canvas, { pieces: PIECES, images });
  } catch (e) {
    console.error(e);
    $('#load-text').innerHTML = '載入失敗了 QQ<br><small>畫盤面的程式出錯了，請重新整理。</small>';
    return;
  }
  try { audio.setMuted(save.muted); audio.setMusic(save.music); } catch (e) {}
  setLevels(LEVELS.map(l => String(l.id)));   // 衣櫃的「走到第 n 關」「全部過關」照實際關卡判斷
  loadCloset();
  applyLook();
  renderClosetBtn();
  buildTitle();
  bindUI();
  syncToggles();
  if (DEBUG) installDebug();
  initCloud();          // 不等它：SDK 在背景載，登入狀態恢復後才換成那個帳號的存檔
  setProgress(1);
  await sleep(250);
  document.documentElement.classList.remove('is-loading');   // 載入條換成「開始遊戲」
  try { buildCover(); } catch (e) { console.warn('[cover]', e); }
  show('title');
  const lv = parseInt(params.get('level'), 10);
  if (DEBUG && lv >= 1 && lv <= LEVELS.length) startLevel(lv - 1);
}

boot();
