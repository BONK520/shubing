// 雲端存檔的端對端測試：兩台「裝置」（兩個 browser context）+ 本機的 Firebase 模擬器（不用真的 Firebase 專案）
//
// 第一次先裝工具（不會寫進專案）：
//   npm i --no-save playwright firebase@13.2.0 firebase-tools        # 還要有 Java（Firestore 模擬器要用）
// 跑（在專案根目錄；firebase.json 設好了埠號和 firestore.rules）：
//   npx firebase emulators:exec --only auth,firestore --project demo-plush "node tests/cloud_e2e.js"
//   node tests/cloud_e2e.js --shots tools/out/cloud     # 模擬器已經開著時；另存截圖
//
// 測的東西：訪客進度 → 登入 → 問要不要帶進帳號 → 雲端有資料 → 另一台裝置登入同一個帳號就接著玩
// → 重新整理還是登入狀態 → 登出回到訪客 → 同一台換另一個人登入從頭開始、看不到別人的 → 離線過關、連回來自動補傳。
// 遊戲用 ?debug=1&emu=1 連模擬器；登入用遊戲裡的「帳號密碼」框（帳號開在模擬器上，不碰真的 Firebase 專案）。
// Firebase SDK 從本機的 npm 套件給（等同 gstatic 上的檔案）。
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
// 一個 context = 一台裝置（自己的 localStorage / IndexedDB）。Firebase SDK 從本機的 npm 套件給（這裡連不到 gstatic）
async function device(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, ...opts });
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
const ADMIN = uid => fetch(`http://127.0.0.1:8085/v1/projects/demo-plush/databases/(default)/documents/saves/${uid}`, { headers: { Authorization: 'Bearer owner' } }).then(r => r.status === 200 ? r.json() : null);
const cloudDoc = async uid => { const d = await ADMIN(uid); if (!d) return null; const f = d.fields; return { unlocked: +f.unlocked.integerValue, stars: Object.fromEntries(Object.entries((f.stars.mapValue.fields) || {}).map(([k, v]) => [k, +(v.integerValue ?? v.doubleValue)])) }; };
let fails = 0;
const check = (name, ok, extra = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };
(async () => {
  // 每次從乾淨的模擬器開始（清掉帳號和存檔）
  await fetch('http://127.0.0.1:8085/emulator/v1/projects/demo-plush/databases/(default)/documents', { method: 'DELETE' });
  await fetch('http://127.0.0.1:9099/emulator/v1/projects/demo-plush/accounts', { method: 'DELETE' });
  const srv = await serve(ROOT);
  const URL0 = `http://127.0.0.1:${srv.address().port}/index.html?debug=1&emu=1`;
  const b = await chromium.launch();
  const errs = [];
  const open = async (ctx, q = '') => {
    const pg = await ctx.newPage();
    pg.on('pageerror', e => errs.push(e.message));
    // 不算錯誤：RPC_ERROR（離線那段故意斷網）
    pg.on('console', m => { if (m.type() === 'error' && !/ERR_|Failed to load resource|RPC_ERROR/.test(m.text())) errs.push(m.text()); });
    await pg.goto(URL0 + q);
    await pg.waitForFunction(() => window.__game && window.__game.cloud && window.__game.cloud.isReady, null, { timeout: 20000 });
    return pg;
  };
  const G = (pg, expr, arg) => pg.evaluate(expr, arg);
  const waitSync = (pg, want = 'synced', ms = 10000) => pg.waitForFunction(w => window.__game.syncState === w, want, { timeout: ms });
  const win = async pg => {
    await pg.waitForFunction(() => window.__game.idle, null, { timeout: 15000 });
    await G(pg, () => window.__game.quickWin());
    await pg.waitForSelector('#m-win.open', { timeout: 30000 });
    await pg.waitForTimeout(400);
  };
  // 帳號名稱＋密碼的登入框：mode 'up' 開新帳號、'in' 登入
  const pwForm = async (pg, mode, name, pass, pass2) => {
    await G(pg, () => { if (!document.querySelector('#m-settings.open')) document.querySelector('[data-open-settings]').click(); });
    await pg.waitForTimeout(400);
    if (!(await pg.$('#m-login.open'))) { await G(pg, () => document.querySelector('#acct-pw').click()); await pg.waitForTimeout(300); }
    const isUp = await G(pg, () => !document.querySelector('#lg-pass2-row').hidden);
    if ((mode === 'up') !== isUp) await G(pg, () => document.querySelector('#lg-switch').click());
    await pg.fill('#lg-name', name);
    await pg.fill('#lg-pass', pass);
    if (mode === 'up') await pg.fill('#lg-pass2', pass2 ?? pass);
    await G(pg, () => document.querySelector('#lg-submit').click());
  };
  const lgErr = async pg => { await pg.waitForFunction(() => document.querySelector('#lg-err').textContent.trim() || !document.querySelector('#m-login.open'), null, { timeout: 10000 }); return G(pg, () => document.querySelector('#lg-err').textContent.trim()); };
  const ALICE = { name: 'alice', pass: 'alice123' };
  const BOB = { name: 'bob', pass: 'bobby123' };

  // ---------- 裝置 A：先當訪客玩過第 1 關 ----------
  const A = await device(b);
  let pa = await open(A, '&level=1');
  check('A starts as guest', await G(pa, () => window.__game.syncState === 'guest'));
  await win(pa);
  const guestA = await G(pa, () => JSON.parse(localStorage.getItem('plushcrush.v1')));
  check('guest progress saved locally (level 1 cleared)', guestA.unlocked >= 2 && guestA.stars['1'] >= 1, `unlocked ${guestA.unlocked}, stars ${JSON.stringify(guestA.stars)}`);
  await G(pa, () => document.querySelector('#mw-map').click());
  await pa.waitForTimeout(1500);

  // 開帳號 alice → 問要不要把訪客進度帶進來 → 帶進來
  await pwForm(pa, 'up', ALICE.name, ALICE.pass);
  await pa.waitForSelector('#m-merge.open', { timeout: 10000 }).catch(async e => {
    console.log('DEBUG', JSON.stringify(await G(pa, () => ({ sync: window.__game.syncState, acct: window.__game.account, toast: document.querySelector('#toast').textContent, open: [...document.querySelectorAll('.modal.open')].map(m => m.id), screen: window.__game.screen, guest: localStorage.getItem('plushcrush.v1') }))));
    throw e;
  });
  check('merge prompt appears', true, (await pa.innerText('#mm-text')).slice(0, 60));
  await shot(pa, 'merge');
  await G(pa, () => document.querySelector('#mm-yes').click());
  await waitSync(pa);
  await pa.waitForTimeout(300);
  await shot(pa, 'welcome');
  check('welcome toast after the merge answer', /歡迎，alice/.test(await pa.innerText('#toast')));
  const aliceUid = await G(pa, () => window.__game.account.uid);
  check('A signed in as Alice and synced', await G(pa, () => window.__game.account.name === 'alice' && window.__game.saveKey.includes('.u.')));
  check('Alice save has the guest progress', await G(pa, () => window.__game.save.unlocked >= 2 && window.__game.save.stars['1'] >= 1));
  check('guest save on A was cleared', (await G(pa, () => JSON.parse(localStorage.getItem('plushcrush.v1')))).unlocked === 1);
  let doc = await cloudDoc(aliceUid);
  check('cloud doc has Alice progress', doc && doc.unlocked >= 2 && doc.stars['1'] >= 1, JSON.stringify(doc));
  await pa.waitForTimeout(500);
  await shot(pa, 'settings_in');
  await G(pa, () => document.querySelector('#set-close').click());

  // Alice 在 A 再過一關 → 自動傳上雲端
  await G(pa, () => window.__game.startLevel(1));
  await pa.waitForTimeout(2500);
  await win(pa);
  await waitSync(pa);
  doc = await cloudDoc(aliceUid);
  check('after clearing level 2 the cloud has it', doc && doc.unlocked === 3 && doc.stars['2'] >= 1, JSON.stringify(doc));

  // ---------- 裝置 B：全新的手機，登入同一個 Alice ----------
  const B = await device(b);
  let pb = await open(B);
  check('B starts as a fresh guest', await G(pb, () => window.__game.save.unlocked === 1 && window.__game.syncState === 'guest'));
  await pwForm(pb, 'in', ALICE.name, ALICE.pass);
  await waitSync(pb);
  check('no merge prompt on B (no guest progress there)', !(await pb.$('#m-merge.open')));
  check('B now has Alice progress from the cloud', await G(pb, () => window.__game.save.unlocked >= 3 && window.__game.save.stars['2'] >= 1), JSON.stringify(await G(pb, () => ({ u: window.__game.save.unlocked, s: window.__game.save.stars }))));
  await G(pb, () => document.querySelector('#set-close').click());
  await G(pb, () => document.querySelector('#btn-start').click());
  await pb.waitForTimeout(1500);
  await shot(pb, 'b_map');

  // 重新整理：還是 Alice（登入狀態記住了）
  await pb.reload();
  await pb.waitForFunction(() => window.__game && window.__game.cloud && window.__game.cloud.isReady, null, { timeout: 20000 });
  await waitSync(pb);
  check('after reload B is still Alice with her progress', await G(pb, () => window.__game.account && window.__game.account.name === 'alice' && window.__game.save.unlocked >= 3));
  await pb.waitForFunction(() => window.__game.screen === 'title', null, { timeout: 10000 });
  await pb.waitForTimeout(1200);
  await shot(pb, 'b_title');

  // 登出 → 回到 B 的訪客存檔
  await G(pb, () => document.querySelector('[data-open-settings]').click());
  await pb.waitForTimeout(400);
  await G(pb, () => document.querySelector('#acct-out').click());
  await pb.waitForFunction(() => window.__game.syncState === 'guest', null, { timeout: 10000 });
  check('signed out on B → back to B guest save (level 1)', await G(pb, () => !window.__game.account && window.__game.save.unlocked === 1));

  // 同一台 B 換 Bob 開帳號 → Bob 從頭開始，看不到 Alice 的進度
  await pwForm(pb, 'up', BOB.name, BOB.pass);
  await waitSync(pb);
  check('Bob on B starts from level 1', await G(pb, () => window.__game.account.name === 'bob' && window.__game.save.unlocked === 1 && Object.keys(window.__game.save.stars).length === 0));
  const bobUid = await G(pb, () => window.__game.account.uid);
  doc = await cloudDoc(aliceUid);
  check('Alice cloud save untouched by Bob', doc && doc.unlocked >= 3, JSON.stringify(doc));

  // ---------- 離線：A 斷網過關，連回來自動補傳 ----------
  await G(pa, () => document.querySelector('#mw-map').click());
  await pa.waitForTimeout(1200);
  await G(pa, () => window.__game.startLevel(2));
  await pa.waitForTimeout(2500);
  await A.setOffline(true);
  await win(pa);
  await pa.waitForFunction(() => window.__game.syncState === 'offline', null, { timeout: 15000 }).catch(() => {});
  check('offline win → status says offline', (await G(pa, () => window.__game.syncState)) === 'offline', await G(pa, () => window.__game.syncState));
  check('offline progress kept on the device', (await G(pa, () => JSON.parse(localStorage.getItem(window.__game.saveKey)))).unlocked >= 4);
  check('cloud still at level 3 while offline', (await cloudDoc(aliceUid)).unlocked === 3);
  await A.setOffline(false);
  await G(pa, () => window.dispatchEvent(new Event('online')));
  await waitSync(pa, 'synced', 15000);
  doc = await cloudDoc(aliceUid);
  check('back online → cloud catches up', doc && doc.unlocked >= 4 && doc.stars['3'] >= 1, JSON.stringify(doc));

  // ---------- 帳號名稱＋密碼：裝置 C 開帳號「小明」（中文名字），裝置 D 用同一組登入 ----------
  const C = await device(b);
  const pc = await open(C);
  check('settings shows the sign-in button for a guest (no Google button)', await G(pc, () => { document.querySelector('[data-open-settings]').click(); return !document.querySelector('#acct-btns').hidden && !!document.querySelector('#acct-pw') && !document.querySelector('#acct-in'); }));
  await pc.waitForTimeout(400);
  await pwForm(pc, 'up', '小明', '123');
  check('short password is refused before sending', /至少要 6 個字/.test(await lgErr(pc)));
  await pwForm(pc, 'up', '小明', 'candy123', 'candy124');
  check('mismatched confirmation is refused', /不一樣/.test(await lgErr(pc)));
  await pwForm(pc, 'up', 'a', 'candy123');
  check('one-letter name is refused', /至少要 2 個字/.test(await lgErr(pc)));
  await shot(pc, 'login_signup');
  await pwForm(pc, 'up', '小明', 'candy123');
  await waitSync(pc);
  check('created account 小明 and signed in', await G(pc, () => window.__game.account && window.__game.account.name === '小明' && !document.querySelector('#m-login.open')), JSON.stringify(await G(pc, () => window.__game.account)));
  await shot(pc, 'login_done');
  const xmUid = await G(pc, () => window.__game.account.uid);
  await G(pc, () => document.querySelector('#set-close').click());
  await G(pc, () => window.__game.startLevel(0));
  await pc.waitForTimeout(2500);
  await win(pc);
  await waitSync(pc);
  doc = await cloudDoc(xmUid);
  check('小明 progress is in the cloud', doc && doc.unlocked === 2, JSON.stringify(doc));

  const D = await device(b);
  const pd = await open(D);
  await pwForm(pd, 'up', '小明', 'other999');
  check('same name cannot be taken twice', /已經有人用了/.test(await lgErr(pd)));
  await pwForm(pd, 'in', '小明', 'wrong999');
  check('wrong password is refused', /名字或密碼不對/.test(await lgErr(pd)));
  await pwForm(pd, 'in', '小明', 'candy123');
  await waitSync(pd);
  check('小明 signs in on device D and gets the progress', await G(pd, () => window.__game.account && window.__game.account.name === '小明' && window.__game.save.unlocked === 2));
  await G(pd, () => document.querySelector('#acct-out').click());
  await pd.waitForFunction(() => window.__game.syncState === 'guest', null, { timeout: 10000 });
  await pwForm(pd, 'up', 'Kid-01', 'jelly123');
  await waitSync(pd);
  check('English name is stored lower-case', await G(pd, () => window.__game.account.name === 'kid-01'));
  await G(pd, () => document.querySelector('#acct-out').click());
  await pd.waitForFunction(() => window.__game.syncState === 'guest', null, { timeout: 10000 });
  await pwForm(pd, 'in', 'KID-01', 'jelly123');
  await waitSync(pd);
  check('English names ignore upper/lower case when signing in', await G(pd, () => window.__game.account && window.__game.account.name === 'kid-01'));

  console.log('page errors:', errs.length ? errs : 'none');
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await b.close(); srv.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
