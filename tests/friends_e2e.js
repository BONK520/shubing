// 好友排行榜的端對端測試：本機 Firebase 模擬器 + firestore.rules（不用真的 Firebase 專案）
//
// 第一次先裝工具（不會寫進專案）：
//   npm i --no-save playwright firebase@13.2.0 firebase-tools        # 還要有 Java（Firestore 模擬器要用）
// 跑（在專案根目錄；firebase.json 設好了埠號和 firestore.rules）：
//   npx firebase emulators:exec --only auth,firestore --project demo-plush "node tests/friends_e2e.js"
//   node tests/friends_e2e.js --shots tools/out/friends     # 模擬器已經開著時；另存截圖
//
// 測的東西：
//   1. 規則（直接打模擬器的 REST，不經過遊戲）：players 只有本人能寫、欄位和大小有限制、登入的人才能讀；saves 還是只有本人能讀
//   2. 遊戲：登入後出現獎盃 → 用好友碼加好友 → 兩邊都看得到對方、照星星排名、同星同名次 → 關卡卡片看好友最高分
//      → 關卡卡片看自己和好友的最高分 → 別人亂寫的名字只當文字顯示 → 登出就收起來
//   3. 規則還沒發布（模擬器換回只有 saves 的舊規則）：存檔照常、獎盃不出現、沒有錯誤
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const FB = process.env.FIREBASE_SDK_DIR || path.dirname(require.resolve('firebase/package.json', { paths: [process.cwd(), __dirname] }));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.json': 'application/json', '.wav': 'audio/wav' };
function serve(ROOT) {
  return new Promise(res => {
    const srv = http.createServer((req, r) => {
      const u = decodeURIComponent(req.url.split('?')[0]);
      const f = path.join(ROOT, u === '/' ? 'index.html' : u);
      fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); r.end(d); });
    }).listen(0, () => res(srv));
  });
}
async function device(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.route('https://www.gstatic.com/firebasejs/**', route => {
    const f = path.join(FB, path.basename(new URL(route.request().url()).pathname));
    route.fulfill({ path: f, contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  return ctx;
}
const ROOT = path.join(__dirname, '..');
const si = process.argv.indexOf('--shots'), OUT = si > 0 ? process.argv[si + 1] : null;
if (OUT) fs.mkdirSync(OUT, { recursive: true });
const shot = (pg, name) => (OUT ? pg.screenshot({ path: path.join(OUT, name + '.png') }) : null);
let fails = 0;
const check = (name, ok, extra = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };

// ---------- 模擬器的 REST ----------
const FS = 'http://127.0.0.1:8085', AU = 'http://127.0.0.1:9099', P = 'demo-plush';
const DOCS = `${FS}/v1/projects/${P}/databases/(default)/documents`;
const RULES = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
// 「規則還沒發布」＝線上原本那份：拿掉 players 那一段（saves 和最後的全部禁止不動）
const OLD_RULES = RULES.replace(/\n[ \t]*\/\/ 好友排行榜的公開資料[\s\S]*?\n {4}match \/players\/\{uid\} \{[\s\S]*?\n {4}\}\n/, '\n');
const setRules = content => fetch(`${FS}/emulator/v1/projects/${P}:securityRules`, { method: 'PUT', body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content }] } }) }).then(r => r.ok);
const signUp = (email, password) => fetch(`${AU}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) }).then(r => r.json()).then(j => ({ uid: j.localId, token: j.idToken }));
// JS 值 → Firestore REST 的欄位格式（整數用 integerValue，跟 SDK 寫 Date.now() 一樣）
const enc = v => typeof v === 'string' ? { stringValue: v }
  : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
  : Array.isArray(v) ? { arrayValue: { values: v.map(enc) } }
  : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
const auth = tok => (tok ? { Authorization: 'Bearer ' + tok } : {});
const put = (tok, coll, id, obj) => fetch(`${DOCS}/${coll}/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...auth(tok) }, body: JSON.stringify({ fields: Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, enc(v)])) }) }).then(r => r.status);
const get = (tok, coll, id) => fetch(`${DOCS}/${coll}/${id}`, { headers: auth(tok) }).then(r => r.status);
const del = (tok, coll, id) => fetch(`${DOCS}/${coll}/${id}`, { method: 'DELETE', headers: auth(tok) }).then(r => r.status);
const byCode = (tok, code) => fetch(`${DOCS}:runQuery`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth(tok) }, body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'players' }], where: { fieldFilter: { field: { fieldPath: 'code' }, op: 'EQUAL', value: { stringValue: code } } }, limit: 5 } }) }).then(r => r.status);
const ADMIN = (coll, id) => fetch(`${DOCS}/${coll}/${id}`, { headers: { Authorization: 'Bearer owner' } }).then(r => r.status === 200 ? r.json() : null);
const num = v => v ? +(v.integerValue ?? v.doubleValue) : NaN;

(async () => {
  await fetch(`${FS}/emulator/v1/projects/${P}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`${AU}/emulator/v1/projects/${P}/accounts`, { method: 'DELETE' });
  check('old rules = new rules without the players block', !/players/.test(OLD_RULES.replace(/\/\/.*$/gm, '')) && /match \/saves\/\{uid\}/.test(OLD_RULES) && /document=\*\*/.test(OLD_RULES));
  check('emulator is using the new firestore.rules', await setRules(RULES));

  // ---------- 1. 規則 ----------
  const x = await signUp('x@players.test', 'xxxxxx1'), y = await signUp('y@players.test', 'yyyyyy1');
  const ok = { code: 'ABCDEF', name: '小明', stars: 12, best: { 1: 3400, 2: 5200 }, friends: [], t: Date.now() };
  check('rules: write my own players doc', await put(x.token, 'players', x.uid, ok) === 200);
  check('rules: cannot write someone else\'s players doc', await put(x.token, 'players', y.uid, ok) === 403);
  check('rules: cannot write without signing in', await put(null, 'players', x.uid, ok) === 403);
  check('rules: extra field refused', await put(x.token, 'players', x.uid, { ...ok, admin: 'yes' }) === 403);
  check('rules: friend code with I/O/0/1 refused', await put(x.token, 'players', x.uid, { ...ok, code: 'ABCDE1' }) === 403);
  check('rules: friend code wrong length refused', await put(x.token, 'players', x.uid, { ...ok, code: 'ABCDEFG' }) === 403);
  check('rules: empty name refused', await put(x.token, 'players', x.uid, { ...ok, name: '' }) === 403);
  check('rules: 25-letter name refused', await put(x.token, 'players', x.uid, { ...ok, name: 'a'.repeat(25) }) === 403);
  check('rules: stars over 3000 refused', await put(x.token, 'players', x.uid, { ...ok, stars: 3001 }) === 403);
  check('rules: negative stars refused', await put(x.token, 'players', x.uid, { ...ok, stars: -1 }) === 403);
  check('rules: stars as text refused', await put(x.token, 'players', x.uid, { ...ok, stars: '12' }) === 403);
  check('rules: 50 friends ok', await put(x.token, 'players', x.uid, { ...ok, friends: Array.from({ length: 50 }, (_, i) => 'u' + i) }) === 200);
  check('rules: 51 friends refused', await put(x.token, 'players', x.uid, { ...ok, friends: Array.from({ length: 51 }, (_, i) => 'u' + i) }) === 403);
  check('rules: t as text refused', await put(x.token, 'players', x.uid, { ...ok, t: 'now' }) === 403);
  check('rules: signed-in player can read another player\'s public doc', await get(y.token, 'players', x.uid) === 200);
  check('rules: cannot read players without signing in', await get(null, 'players', x.uid) === 403);
  check('rules: find by friend code works when signed in', await byCode(y.token, 'ABCDEF') === 200);
  check('rules: find by friend code refused when signed out', await byCode(null, 'ABCDEF') === 403);
  check('rules: cannot delete someone else\'s players doc', await del(y.token, 'players', x.uid) === 403);
  check('rules: delete my own players doc', await del(x.token, 'players', x.uid) === 200);
  const save = { v: 1, unlocked: 3, stars: { 1: 3 }, best: { 1: 100 }, boosters: {}, t: Date.now() };
  check('rules: saves still writable by the owner', await put(x.token, 'saves', x.uid, save) === 200);
  check('rules: saves still private (others cannot read)', await get(y.token, 'saves', x.uid) === 403);
  check('rules: saves still private (others cannot write)', await put(y.token, 'saves', x.uid, save) === 403);
  check('rules: anything else still blocked', await put(x.token, 'admin', 'cfg', { a: 1 }) === 403 && await get(x.token, 'admin', 'cfg') === 403);

  // ---------- 2. 遊戲 ----------
  const srv = await serve(ROOT);
  const URL0 = `http://127.0.0.1:${srv.address().port}/index.html?debug=1&emu=1`;
  const b = await chromium.launch();
  const errs = [];
  const open = async ctx => {
    const pg = await ctx.newPage();
    pg.on('pageerror', e => errs.push(e.message));
    pg.on('console', m => { if (m.type() === 'error' && !/ERR_|Failed to load resource|RPC_ERROR/.test(m.text())) errs.push(m.text()); });
    await pg.goto(URL0);
    await pg.waitForFunction(() => window.__game && window.__game.cloud && window.__game.cloud.isReady, null, { timeout: 20000 });
    return pg;
  };
  const G = (pg, expr, arg) => pg.evaluate(expr, arg);
  const waitSync = (pg, want = 'synced', ms = 10000) => pg.waitForFunction(w => window.__game.syncState === w, want, { timeout: ms });
  const friendsOn = pg => G(pg, () => document.documentElement.classList.contains('has-friends') && !document.querySelector('#map-friends').hidden);
  const waitFriends = (pg, ms = 10000) => pg.waitForFunction(() => document.documentElement.classList.contains('has-friends'), null, { timeout: ms });
  const win = async pg => {
    await pg.waitForFunction(() => window.__game.idle, null, { timeout: 15000 });
    await G(pg, () => window.__game.quickWin());
    await pg.waitForSelector('#m-win.open', { timeout: 30000 });
    await pg.waitForTimeout(400);
  };
  const pwForm = async (pg, mode, name, pass) => {
    await G(pg, () => { if (!document.querySelector('#m-settings.open')) document.querySelector('[data-open-settings]').click(); });
    await pg.waitForTimeout(400);
    if (!(await pg.$('#m-login.open'))) { await G(pg, () => document.querySelector('#acct-pw').click()); await pg.waitForTimeout(300); }
    const isUp = await G(pg, () => !document.querySelector('#lg-pass2-row').hidden);
    if ((mode === 'up') !== isUp) await G(pg, () => document.querySelector('#lg-switch').click());
    await pg.fill('#lg-name', name);
    await pg.fill('#lg-pass', pass);
    if (mode === 'up') await pg.fill('#lg-pass2', pass);
    await G(pg, () => document.querySelector('#lg-submit').click());
  };
  const closeAll = pg => G(pg, () => { for (const m of document.querySelectorAll('.modal.open')) { const c = m.querySelector('[data-close], #set-close'); if (c) c.click(); } });
  // 回到地圖、打開排行榜，等讀完
  const openBoard = async pg => {
    await closeAll(pg);
    await G(pg, () => { if (window.__game.screen !== 'map') window.__game.showMap(); });
    await pg.waitForTimeout(800);
    await G(pg, () => document.querySelector('#map-friends').click());
    await pg.waitForSelector('#m-friends.open', { timeout: 5000 });
    await pg.waitForTimeout(1500);
  };
  const rows = pg => G(pg, () => [...document.querySelectorAll('#fr-list .fr-row')].map(li => ({ rank: +li.dataset.rank, name: li.querySelector('.fr-nt').firstChild.textContent, lv: (li.querySelector('.fr-lv') || {}).textContent, me: li.classList.contains('me'), stars: +li.querySelector('.fr-st b').textContent.replace(/\D/g, '') })));
  const addFriend = async (pg, code) => {
    await pg.fill('#fr-input', code);
    await G(pg, () => document.querySelector('#fr-submit').click());
    await pg.waitForFunction(() => !document.querySelector('#fr-submit').disabled, null, { timeout: 10000 });
    await pg.waitForTimeout(300);
    return G(pg, () => document.querySelector('#fr-err').textContent.trim());
  };

  // 訪客：沒有獎盃
  const A = await device(b);
  const pa = await open(A);
  check('guest: no trophy button', !(await friendsOn(pa)) && await G(pa, () => document.querySelector('#map-friends').hidden));

  // Alice 開帳號 → 獎盃出現、公開資料寫上去
  await pwForm(pa, 'up', 'alice', 'alice123');
  await waitSync(pa);
  await waitFriends(pa).catch(() => {});
  check('signed in: trophy button appears', await friendsOn(pa));
  const aliceUid = await G(pa, () => window.__game.account.uid);
  const aliceCode = await G(pa, () => window.__game.cloud.friendCode(window.__game.account.uid));
  await pa.waitForTimeout(500);
  let d = await ADMIN('players', aliceUid);
  check('Alice public doc written (code, name, 0 stars)', d && d.fields.code.stringValue === aliceCode && d.fields.name.stringValue === 'alice' && num(d.fields.stars) === 0, d && JSON.stringify(d.fields).slice(0, 160));

  // Bob 在另一台開帳號、過第 1、2 關 → 星星和最高分上排行榜
  const B = await device(b);
  const pb = await open(B);
  await pwForm(pb, 'up', 'bob', 'bobby123');
  await waitSync(pb);
  await waitFriends(pb).catch(() => {});
  const bobUid = await G(pb, () => window.__game.account.uid);
  const bobCode = await G(pb, () => window.__game.cloud.friendCode(window.__game.account.uid));
  await closeAll(pb);
  for (const i of [0, 1]) {
    await G(pb, n => window.__game.startLevel(n), i);
    await pb.waitForTimeout(2500);
    await win(pb);
    await waitSync(pb);
    await G(pb, () => document.querySelector('#mw-map').click());
    await pb.waitForTimeout(1200);
  }
  await pb.waitForTimeout(800);
  d = await ADMIN('players', bobUid);
  const bobStars = d ? num(d.fields.stars) : 0, bobBest1 = d ? num(d.fields.best.mapValue.fields['1']) : 0;
  check('Bob stars and best scores published after winning', bobStars >= 2 && bobBest1 > 0, `stars ${bobStars}, best[1] ${bobBest1}`);

  // Alice 打開排行榜：只有自己、看得到好友碼
  await openBoard(pa);
  await shot(pa, 'board_empty');
  let r = await rows(pa);
  check('board: only me at first, empty hint shown', r.length === 1 && r[0].me && await G(pa, () => !document.querySelector('#fr-empty').hidden), JSON.stringify(r));
  check('board: my friend code shown (6 letters, no I/O/0/1)', (await pa.innerText('#fr-mycode')).trim() === aliceCode && /^[A-HJ-NP-Z2-9]{6}$/.test(aliceCode), aliceCode);

  // 打錯的好友碼
  check('add: wrong format refused', /6 個英文字母和數字/.test(await addFriend(pa, 'AB1')));
  check('add: own code refused', /自己的好友碼/.test(await addFriend(pa, aliceCode)));
  let ghost = 'ZZZZZZ';
  for (let i = 0; ghost === aliceCode || ghost === bobCode; i++) ghost = await G(pa, s => window.__game.cloud.friendCode(s), 'nobody' + i);
  check('add: unknown code → not found', /找不到這個好友碼/.test(await addFriend(pa, ghost)));
  // 小寫、中間有空白也認得
  const e1 = await addFriend(pa, ' ' + bobCode.slice(0, 3).toLowerCase() + ' ' + bobCode.slice(3).toLowerCase());
  check('add: Bob by friend code (lower case + space ok)', e1 === '', e1);
  await pa.waitForTimeout(400);
  check('add: toast says added', /加好友了：bob/.test(await pa.innerText('#toast')));
  r = await rows(pa);
  await shot(pa, 'board_alice');
  check('board: Bob ranked above Alice (more stars)', r.length === 2 && r[0].name === 'bob' && r[0].rank === 1 && r[0].stars === bobStars && r[1].me && r[1].rank === 2, JSON.stringify(r));
  check('board: input cleared, empty hint hidden', await G(pa, () => document.querySelector('#fr-input').value === '' && document.querySelector('#fr-empty').hidden));
  d = await ADMIN('players', aliceUid);
  check('Alice friends list has Bob', d && (d.fields.friends.arrayValue.values || []).some(v => v.stringValue === bobUid));
  const e2 = await addFriend(pa, bobCode);
  r = await rows(pa);
  check('add: adding Bob twice does not duplicate him', e2 === '' && r.length === 2, JSON.stringify(r));

  // Bob 沒輸入任何東西，也看得到 Alice（她加了他）
  await openBoard(pb);
  r = await rows(pb);
  await shot(pb, 'board_bob');
  check('board (Bob): Alice shows up because she added him', r.length === 2 && r[0].me && r[0].rank === 1 && r[1].name === 'alice' && r[1].rank === 2, JSON.stringify(r));

  // Alice 也過第 1、2 關 → 跟 Bob 同星 → 同一名
  await closeAll(pa);
  for (const i of [0, 1]) {
    await G(pa, n => window.__game.startLevel(n), i);
    await pa.waitForTimeout(2500);
    await win(pa);
    await waitSync(pa);
    await G(pa, () => document.querySelector('#mw-map').click());
    await pa.waitForTimeout(1200);
  }
  await pa.waitForTimeout(800);
  await openBoard(pa);
  r = await rows(pa);
  const aliceStars = r.find(x => x.me)?.stars;
  check('board: same stars → same rank, me listed first', aliceStars === bobStars ? (r[0].me && r[0].rank === 1 && r[1].rank === 1) : true, JSON.stringify(r));
  await openBoard(pb);
  r = await rows(pb);
  check('board (Bob): sees Alice\'s new stars', r.some(x => x.name === 'alice' && x.stars === aliceStars), JSON.stringify(r));
  // 排行榜每個名字下面寫第幾關（過了第 1、2 關 → 在第 3 關），自己那一行也有
  check('board: level shown under each name (cleared 1–2 → 第3關)', r.length === 2 && r.every(x => x.lv === '第3關'), JSON.stringify(r));
  // 地圖上第 3 關旁邊站著朋友的小頭像，點了跳出「名字・第N關・★數量」
  await closeAll(pb);
  await G(pb, () => window.__game.showMap());
  await pb.waitForTimeout(1500);
  const pins = await G(pb, () => [...document.querySelectorAll('#map-inner .fr-pins')].map(x => ({ n: x.querySelectorAll('.fr-pin').length, top: x.style.top })));
  const node3 = await G(pb, () => document.querySelectorAll('#map-inner .node')[2]?.style.top);
  check('map: Alice\'s pin stands next to level 3', pins.length === 1 && pins[0].n === 1 && pins[0].top === node3, JSON.stringify({ pins, node3 }));
  await G(pb, () => document.querySelector('#map-inner .fr-pin').click());
  await pb.waitForTimeout(300);
  check('map: tapping the pin says name, level and stars', (await pb.innerText('#toast')).includes(`alice・第3關・★${aliceStars}`), await pb.innerText('#toast'));

  // 關卡開始卡：好友最高分
  await closeAll(pa);
  await G(pa, () => window.__game.openStartCard(0));
  await pa.waitForSelector('#m-start.open', { timeout: 5000 });
  await pa.waitForTimeout(800);
  const cardRows = pg => G(pg, () => { const b = document.querySelector('#ms-friends'); return { hidden: b.hidden, lbl: (b.querySelector('.msf-lbl') || {}).textContent, rows: [...b.querySelectorAll('.msf-one')].map(x => ({ name: x.querySelector('i').textContent, s: +x.querySelector('b').textContent.replace(/\D/g, ''), me: x.classList.contains('me') })) }; });
  let card = await cardRows(pa);
  const aliceBest1 = await G(pa, () => Math.round(window.__game.save.best['1']));
  await shot(pa, 'start_card');
  check('start card: friend best score shown', !card.hidden && card.lbl === '最高分' && card.rows.some(x => x.name === 'bob' && x.s === bobBest1 && !x.me), JSON.stringify(card));
  check('start card: my own best score shown too', card.rows.some(x => x.me && x.name === '我' && x.s === aliceBest1), JSON.stringify(card));
  check('start card: sorted by score', card.rows.every((x, k) => !k || card.rows[k - 1].s >= x.s), JSON.stringify(card));
  await closeAll(pa);
  await G(pa, () => window.__game.openStartCard(40));
  await pa.waitForSelector('#m-start.open', { timeout: 5000 });
  await pa.waitForTimeout(500);
  check('start card: hidden on a level nobody has played', await G(pa, () => document.querySelector('#ms-friends').hidden));

  // 有人自己改公開資料、塞奇怪的名字 → 只當文字顯示，不會跑程式
  const evil = await signUp('evil@players.test', 'evil123');
  const evilName = '<img src=x onerror="window.__xss=1">';
  check('rules: a player may write any 24-letter name into their own doc', await put(evil.token, 'players', evil.uid, { code: 'EVEVEV', name: evilName.slice(0, 24), stars: 5, best: {}, friends: [aliceUid], t: Date.now() }) === 200);
  await openBoard(pa);
  r = await rows(pa);
  check('board: odd names shown as plain text, nothing runs', r.some(x => x.name === evilName.slice(0, 12)) && await G(pa, () => !window.__xss && !document.querySelector('#fr-list img')), JSON.stringify(r.map(x => x.name)));

  // 登出 → 獎盃收起來；再登入 → 回來
  await closeAll(pa);
  await G(pa, () => document.querySelector('[data-open-settings]').click());
  await pa.waitForTimeout(400);
  await G(pa, () => document.querySelector('#acct-out').click());
  await waitSync(pa, 'guest');
  check('signed out: trophy hidden', !(await friendsOn(pa)));
  await pwForm(pa, 'in', 'alice', 'alice123');
  await waitSync(pa);
  await waitFriends(pa).catch(() => {});
  check('signed back in: trophy back', await friendsOn(pa));

  // ---------- 3. 規則還沒發布（線上原本的規則） ----------
  check('emulator switched to the old rules (no players)', await setRules(OLD_RULES));
  await pa.waitForTimeout(1500);
  const C = await device(b);
  const pc = await open(C);
  await pwForm(pc, 'up', 'carol', 'carol123');
  await waitSync(pc);
  await closeAll(pc);
  await G(pc, () => window.__game.startLevel(0));
  await pc.waitForTimeout(2500);
  await win(pc);
  await waitSync(pc);
  await pc.waitForTimeout(1500);
  const cs = await ADMIN('saves', await G(pc, () => window.__game.account.uid));
  check('old rules: cloud save still works', cs && num(cs.fields.unlocked) === 2);
  check('old rules: trophy stays hidden', !(await friendsOn(pc)));
  await G(pc, () => document.querySelector('#mw-map').click());
  await pc.waitForTimeout(1200);
  await G(pc, () => window.__game.openStartCard(0));
  await pc.waitForSelector('#m-start.open', { timeout: 5000 });
  await pc.waitForTimeout(500);
  card = await cardRows(pc);
  check('start card without leaderboard: my own best score still shown', !card.hidden && card.rows.length === 1 && card.rows[0].me && card.rows[0].s > 0, JSON.stringify(card));
  await closeAll(pc);
  await pc.waitForTimeout(400);
  await shot(pc, 'old_rules_map');
  check('emulator back on the new rules', await setRules(RULES));

  console.log('page errors:', errs.length ? errs : 'none');
  check('no page errors', errs.length === 0);
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await b.close(); srv.close();
  process.exit(fails ? 1 : 0);
})().catch(async e => { console.error(e); await setRules(RULES).catch(() => {}); process.exit(2); });
