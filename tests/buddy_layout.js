// 工作單19：右上角陪玩角色不能疊到 HUD（步數、目標、分數）和左上的「暫停＋第N關」膠囊
// 用法（要在 firebase 模擬器裡跑，跟 cloud_e2e 一樣）：
//   firebase emulators:exec --only auth,firestore --project demo-plush "node tests/buddy_layout.js [截圖資料夾]"
// 需要環境變數 FIREBASE_SDK_DIR（本機 firebase SDK，代替 gstatic）。
// 量法：把角色裡所有動畫（左右晃、呼吸、擔心發抖、過關跳、彩紙）暫停，每個動畫取 0～100% 共 25 個時間點，
// 量每個看得見的元素的 getBoundingClientRect()，跟 HUD 三塊、膠囊比；也不能超出畫面上緣和左右兩邊。
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const FB = process.env.FIREBASE_SDK_DIR;
const OUT = process.argv[2] || '';
if (OUT) fs.mkdirSync(OUT, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.json': 'application/json', '.wav': 'audio/wav', '.svg': 'image/svg+xml' };
const serve = () => new Promise(res => {
  const srv = http.createServer((req, r) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    const f = path.join(ROOT, u === '/' ? 'index.html' : u);
    fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); r.end(d); });
  }).listen(0, '127.0.0.1', () => res(srv));
});
let fails = 0;
const check = (n, ok, x = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`); };
const G = (pg, e, a) => pg.evaluate(e, a);

async function open(b, srv, vp) {
  const ctx = await b.newContext({ viewport: { width: vp[0], height: vp[1] }, deviceScaleFactor: 2 });
  if (FB) await ctx.route('https://www.gstatic.com/firebasejs/**', route => route.fulfill({ path: path.join(FB, path.basename(new URL(route.request().url()).pathname)), contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' } }));
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  await pg.goto(`http://127.0.0.1:${srv.address().port}/index.html?debug=1&emu=1&intro=0`);
  await pg.waitForFunction(() => window.__game && window.__game.levels && window.__game.renderer, null, { timeout: 20000 });
  await pg.keyboard.press('Shift');
  await pg.waitForFunction(() => !document.querySelector('.op'), null, { timeout: 15000 }).catch(() => {});
  await pg.waitForTimeout(300);
  return { ctx, pg, errs };
}
const closeModals = pg => G(pg, () => { for (const m of document.querySelectorAll('.modal.open')) { const c = m.id === 'm-intro' ? m.querySelector('.intro-card') : m.querySelector('[data-close], #set-close, .btn.green'); if (c) c.click(); } });
async function toLevel(pg, idx) {
  await G(pg, () => window.__game.unlockAll());
  await G(pg, i => { window.__game.startLevel(i); }, idx);
  for (let k = 0; k < 40; k++) {
    await pg.waitForTimeout(250);
    const st = await G(pg, () => ({ idle: window.__game.idle, open: [...document.querySelectorAll('.modal.open')].map(m => m.id) }));
    if (st.idle && !st.open.length) return true;
    if (st.open.length) await closeModals(pg);
  }
  return false;
}

// 量角色：每個動畫取 25 個時間點，回傳每個元素的最大範圍，和跟 HUD／膠囊的重疊
const measure = pg => G(pg, () => {
  const bd = document.querySelector('#buddy');
  if (!bd || bd.hidden || !bd.offsetWidth) return { shown: false };
  const R = e => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  const targets = {};
  for (const s of ['.hud-moves', '.hud-goal', '.hud-score', '#btn-pause', '.level-pill']) targets[s] = R(document.querySelector(s));
  // 直式的「暫停＋第N關」是一整顆白色膠囊；手機橫放沒有底色，量裡面的暫停鈕和關卡字就好
  const cap = document.querySelector('.lv-cap');
  if (getComputedStyle(cap).backgroundColor !== 'rgba(0, 0, 0, 0)') targets['.lv-cap'] = R(cap);
  const anims = bd.getAnimations({ subtree: true });
  const playing = anims.map(a => a.playState);
  anims.forEach(a => a.pause());
  // 只量畫得出東西的元素：外層的定位盒子（.bd-sway、.bd-pose、透明的按鈕、彩紙的容器）轉動時方框會變大，但本身是透明的
  const paints = e => { const c = getComputedStyle(e); return /^(IMG|svg|CANVAS)$/i.test(e.tagName) || c.backgroundImage !== 'none' || (c.backgroundColor !== 'rgba(0, 0, 0, 0)' && c.backgroundColor !== 'transparent') || parseFloat(c.borderTopWidth) > 0 || c.boxShadow !== 'none' || [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) || ['::before', '::after'].some(p => { const q = getComputedStyle(e, p); return q.content !== 'none' && q.content !== 'normal'; }); };
  const seen = (e) => { for (let x = e; x && x !== document.body; x = x.parentElement) if (+getComputedStyle(x).opacity < 0.02 || getComputedStyle(x).visibility === 'hidden') return false; return true; };
  const name = e => (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).join('.') : e.tagName.toLowerCase());
  const box = {};
  const hits = new Set();
  const N = 24;
  for (let k = 0; k <= N; k++) {
    anims.forEach(a => { const t = a.effect.getComputedTiming(); const d = t.duration || 0; a.currentTime = (t.delay || 0) + d * Math.min(k / N, 0.999); });
    for (const e of bd.querySelectorAll('*')) {
      const r = R(e);
      if (r.w < 1 || r.h < 1 || !paints(e) || !seen(e)) continue;
      const n = name(e);
      const o = box[n] || (box[n] = { l: 1e9, t: 1e9, r: -1e9, b: -1e9 });
      o.l = Math.min(o.l, r.l); o.t = Math.min(o.t, r.t); o.r = Math.max(o.r, r.r); o.b = Math.max(o.b, r.b);
      for (const [s, q] of Object.entries(targets)) if (r.l < q.r - 0.5 && r.r > q.l + 0.5 && r.t < q.b - 0.5 && r.b > q.t + 0.5) hits.add(`${n} × ${s} (${Math.round(r.b - q.t)}px)`);
    }
  }
  anims.forEach((a, i) => { if (playing[i] === 'running') a.play(); });
  const all = Object.values(box).reduce((u, o) => ({ l: Math.min(u.l, o.l), t: Math.min(u.t, o.t), r: Math.max(u.r, o.r), b: Math.max(u.b, o.b) }), { l: 1e9, t: 1e9, r: -1e9, b: -1e9 });
  all.top = Object.entries(box).sort((a, b) => a[1].t - b[1].t)[0][0];
  const fx = document.querySelectorAll('.bd-burst > i').length;
  return { shown: true, hits: [...hits], all, box, targets, fx, vw: innerWidth, vh: innerHeight };
});

const layout = pg => G(pg, () => {
  const r = s => document.querySelector(s).getBoundingClientRect();
  const bd = r('#board'), bt = r('#boosters'), top = r('.game-top');
  const g = window.__game.engine.snapshot().grid, rows = g.length, cols = g[0].length, cs = window.__game.cellSize();
  const hit = !(bd.right <= bt.left + 0.5 || bd.left >= bt.right - 0.5 || bd.bottom <= bt.top + 0.5 || bd.top >= bt.bottom - 0.5);
  return { board: [Math.round(bd.width), Math.round(bd.height)], grid: [cols, rows], cs, fits: cs * cols <= bd.width + 1 && cs * rows <= bd.height + 1, hit, top: Math.round(top.height), sw: document.documentElement.scrollWidth - innerWidth };
});

(async () => {
  const srv = await serve();
  const b = await chromium.launch();
  const VPS = [[375, 812], [360, 640], [390, 844], [812, 375]];
  for (const vp of VPS) {
    const tag = vp.join('x');
    const { ctx, pg, errs } = await open(b, srv, vp);
    check(`${tag} 進到第2關`, await toLevel(pg, 1));
    const L = await layout(pg);
    check(`${tag} 沒有橫向捲動`, L.sw <= 0, L.sw);
    check(`${tag} 格子是正方形、整個盤面放得進畫布`, L.cs > 0 && L.fits, `格子 ${L.cs.toFixed(1)}px × ${L.grid.join('×')}，畫布 ${L.board.join('×')}`);
    check(`${tag} 盤面沒有擠到道具列`, !L.hit);
    console.log(`      上方列高 ${L.top}px，盤面畫布 ${L.board.join('×')}，格子 ${L.cs.toFixed(1)}px`);

    // 分數四位數、五位數：整串數字看得到
    for (const txt of ['3,640', '12,480']) {
      const fit = await G(pg, t => { const e = document.querySelector('#hud-score'); e.textContent = t; const r = e.getBoundingClientRect(), p = e.closest('.hud-score').getBoundingClientRect(); return { ok: r.left >= p.left - 0.5 && r.right <= p.right + 0.5 && e.scrollWidth <= e.clientWidth + 1, w: Math.round(r.width), pw: Math.round(p.width) }; }, txt);
      check(`${tag} 分數 ${txt} 整個在分數框裡`, fit.ok, `${fit.w}px／框 ${fit.pw}px`);
    }

    const states = [
      ['普通', async () => {}],
      ['擔心', async () => { await G(pg, () => window.__game.setMoves(3)); await pg.waitForTimeout(450); }],
      ['過關', async () => { await G(pg, () => window.__game.quickWin()); await pg.waitForTimeout(700); }],
    ];
    for (const [st, go] of states) {
      await go();
      if (OUT) await pg.screenshot({ path: path.join(OUT, `${tag}-${st}.png`) });   // 先截圖：量的時候會把動畫（彩紙）推到結尾
      const m = await measure(pg);
      if (!m.shown) { check(`${tag} ${st}：角色沒顯示（左欄放不下時不顯示）`, vp[0] < 807 && vp[0] > vp[1]); continue; }
      check(`${tag} ${st}：角色沒有疊到 HUD 和「第N關」`, !m.hits.length, m.hits.slice(0, 4).join('；'));
      check(`${tag} ${st}：沒有超出畫面上緣`, m.all.t >= 0, `最高 ${m.all.t.toFixed(1)}px（${m.all.top}）`);
      check(`${tag} ${st}：沒有超出畫面左右`, m.all.l >= 0 && m.all.r <= m.vw, `${m.all.l.toFixed(1)}～${m.all.r.toFixed(1)}`);
      if (st === '擔心') check(`${tag} 擔心：雨滴有出現`, !!m.box['.bd-rain'], '');
      if (st === '過關') check(`${tag} 過關：有彩紙`, m.fx > 0, m.fx + ' 片');
      console.log(`      ${st}：角色範圍 上${m.all.t.toFixed(1)} 下${m.all.b.toFixed(1)}，HUD 頂 ${Math.min(m.targets['.hud-moves'].t, m.targets['.hud-score'].t).toFixed(1)}`);
    }
    check(`${tag} 沒有紅字`, !errs.length, errs.slice(0, 2).join(' | '));
    await ctx.close();
  }
  await b.close(); srv.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
