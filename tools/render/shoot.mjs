// 用無頭瀏覽器 + three.js 把 glb 渲染成透明背景 PNG（遊戲方塊圖）
// 先在 tools/ 目錄開伺服器: python -m http.server 8765
// 再執行: node render/shoot.mjs render/jobs.example.json out/sprites
import {chromium} from 'playwright';
import fs from 'fs';
const [,, jobfile, outdir] = process.argv;
const jobs = JSON.parse(fs.readFileSync(jobfile, 'utf8'));
fs.mkdirSync(outdir, {recursive: true});
const b = await chromium.launch({args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
const pg = await b.newPage();
pg.on('pageerror', e => console.log('page error:', e.message));
await pg.goto('http://127.0.0.1:8765/render/render.html');
await pg.waitForFunction('window.ready');
for (const j of jobs) {
  const d = await pg.evaluate(([i, v]) => window.shot(i, v), [j.items, j.view]);
  fs.writeFileSync(`${outdir}/${j.name}.png`, Buffer.from(d.split(',')[1], 'base64'));
  console.log('saved', j.name);
}
await b.close();
