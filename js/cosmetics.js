// 三星外觀獎勵與玩偶衣櫃（docs/SPEC.md §8b）
//
// ★ 測試用快捷開關：開發時改成 true，所有外觀直接解鎖，可以先預覽效果；正式玩時記得改回 false ★
export const DEBUG_UNLOCK_ALL_COSMETICS = false;
//
// 怎麼拿到外觀：
//   * 三星造型幣：每一關「第一次」拿到三星送 1 枚（照存檔裡每關的星星算，所以以前拿過的三星也算數、換手機登入也還在）。
//     用造型幣在衣櫃裡兌換有標價的外觀。
//   * 三星豪華寶箱：星星總數到達里程碑（3、9、15、24、36…一直到 675）就能開一個寶箱，直接解鎖稀有主題、限定全套裝扮，或多送造型幣。
//   * 累積星星：有些外觀是星星總數到了就自動解鎖。
//   * 走到那一站就送：那一關的前一關有星星就解鎖；金色外圈要全部關卡都過關。
// 衣櫃的狀態（兌換過的、開過的寶箱、正在穿的）存在這台裝置的 localStorage（每個帳號一份，main.js 給 key）；
// 造型幣和星星是照關卡星星算的，所以就算換了裝置，造型幣也不會不見（只是要重新兌換、重新開寶箱）。

// ---------- 分類 ----------
export const CATEGORIES = [
  { id: 'outfit', name: '玩偶造型', short: '造型' },   // 只穿在地圖左下角的頭像和衣櫃預覽，盤面上的娃娃不穿；右上角陪玩的薯餅（和蛋黃哥）有穿
  { id: 'ring', name: '頭像外圈', short: '外圈' },     // 地圖左下角頭像外面那一圈（跟造型都是打扮頭像，放隔壁）
  { id: 'hat', name: '頭飾配件', short: '配件' },
  { id: 'fx', name: '消除特效', short: '特效' },
  { id: 'frame', name: '方塊底座', short: '底座' },
  { id: 'theme', name: '棋盤主題', short: '主題' },
];

// ---------- 外觀清單 ----------
// unlock：null = 一開始就有；{ coins: n } = 用 n 枚造型幣兌換；{ stars: n } = 星星總數到 n 自動解鎖；{ chest: i } = 第 i 個寶箱開出來；
//         { station: n } = 走到第 n 關就送（第 n−1 關有星星就算走到）；{ allClear: true } = 全部關卡都過關
export const ITEMS = [
  // 分類 0：玩偶造型（地圖左下角的頭像）
  { id: 'outfit.none',      cat: 'outfit', name: '原本的樣子', unlock: null },
  { id: 'outfit.sailor',    cat: 'outfit', name: '碼頭水手',   unlock: null },
  { id: 'outfit.night',     cat: 'outfit', name: '晚安睡帽',   unlock: { coins: 3 } },
  { id: 'outfit.party',     cat: 'outfit', name: '生日派對',   unlock: { coins: 8 } },
  { id: 'outfit.berry',     cat: 'outfit', name: '草莓帽',     unlock: { coins: 10 } },
  { id: 'outfit.snow',      cat: 'outfit', name: '雪地毛帽',   unlock: { station: 61 } },
  { id: 'outfit.space',     cat: 'outfit', name: '太空頭盔',   unlock: { station: 86 } },
  { id: 'outfit.detective', cat: 'outfit', name: '小偵探',     unlock: { station: 106 } },
  { id: 'outfit.chef',      cat: 'outfit', name: '甜點師傅',   unlock: { station: 116 } },
  { id: 'outfit.pumpkin',   cat: 'outfit', name: '南瓜帽',     unlock: { station: 146 } },
  { id: 'outfit.wizard',    cat: 'outfit', name: '小魔法師',   unlock: { chest: 5 } },
  { id: 'outfit.king',      cat: 'outfit', name: '國王披風',   unlock: { chest: 14 } },
  { id: 'outfit.dino',      cat: 'outfit', name: '小恐龍',     unlock: { chest: 15 } },
  { id: 'outfit.painter',   cat: 'outfit', name: '小畫家',     unlock: { chest: 17 } },
  // 分類 1：玩偶頭飾與配件（疊在實拍照片上面的透明圖層，照片本身不動）
  { id: 'hat.none',   cat: 'hat', name: '不戴',         unlock: null },
  { id: 'hat.bow',    cat: 'hat', name: '粉紅蝴蝶結',   unlock: { coins: 2 } },
  { id: 'hat.blush',  cat: 'hat', name: '害羞紅腮紅',   unlock: { coins: 2 } },
  { id: 'hat.crown',  cat: 'hat', name: '迷你金皇冠',   unlock: { coins: 4 } },
  { id: 'hat.shades', cat: 'hat', name: '酷炫黑墨鏡',   unlock: { coins: 3 } },
  { id: 'hat.chef',   cat: 'hat', name: '小廚師帽',     unlock: { stars: 60 } },
  { id: 'hat.halo',   cat: 'hat', name: '發光天使光環', unlock: { chest: 2 } },
  { id: 'hat.clip',         cat: 'hat', name: '星星髮夾', unlock: { coins: 2 } },
  { id: 'hat.bunny',        cat: 'hat', name: '兔耳朵',   unlock: { coins: 3 } },
  { id: 'hat.beret',        cat: 'hat', name: '貝雷帽',   unlock: { coins: 3 } },
  { id: 'hat.heartglasses', cat: 'hat', name: '愛心眼鏡', unlock: { coins: 3 } },
  { id: 'hat.tophat',       cat: 'hat', name: '小禮帽',   unlock: { coins: 4 } },
  { id: 'hat.flowers',      cat: 'hat', name: '小花圈',   unlock: { station: 46 } },
  { id: 'hat.eggshell',     cat: 'hat', name: '蛋殼帽',   unlock: { chest: 6 } },
  { id: 'hat.santa',        cat: 'hat', name: '聖誕帽',   unlock: { chest: 7 } },
  // 分類 2：消除粒子特效
  { id: 'fx.default', cat: 'fx', name: '星光棉花',     unlock: null },
  { id: 'fx.sakura',  cat: 'fx', name: '櫻花花瓣雨',   unlock: { coins: 3 } },
  { id: 'fx.bubbles', cat: 'fx', name: '彩虹愛心泡泡', unlock: { chest: 1 } },
  { id: 'fx.gold',    cat: 'fx', name: '奢華金粉亮片', unlock: { chest: 4 } },
  { id: 'fx.confetti',  cat: 'fx', name: '糖果彩紙',   unlock: { coins: 4 } },
  { id: 'fx.snow',      cat: 'fx', name: '雪花',       unlock: { station: 61 } },
  { id: 'fx.notes',     cat: 'fx', name: '音符',       unlock: { station: 76 } },
  { id: 'fx.fish',      cat: 'fx', name: '小魚',       unlock: { station: 81 } },
  { id: 'fx.fireworks', cat: 'fx', name: '煙火',       unlock: { station: 96 } },
  { id: 'fx.choco',     cat: 'fx', name: '巧克力碎片', unlock: { station: 116 } },
  { id: 'fx.rainbow',   cat: 'fx', name: '彩虹',       unlock: { chest: 12 } },
  { id: 'fx.rain',      cat: 'fx', name: '雨滴',       unlock: { station: 176 } },
  // 分類 3：方塊底座
  { id: 'frame.jelly',   cat: 'frame', name: '果凍底座',   unlock: null },
  { id: 'frame.shape7',  cat: 'frame', name: '七種新形狀', unlock: null },
  { id: 'frame.none',    cat: 'frame', name: '不要底座',   unlock: null },
  { id: 'frame.cookie',  cat: 'frame', name: '酥脆餅乾底', unlock: { coins: 3 } },
  { id: 'frame.capsule', cat: 'frame', name: '透明扭蛋球', unlock: { coins: 5 } },
  { id: 'frame.petal',   cat: 'frame', name: '花瓣底座',   unlock: { chest: 3 } },
  { id: 'frame.macaron', cat: 'frame', name: '馬卡龍底座', unlock: { coins: 3 } },
  { id: 'frame.donut',   cat: 'frame', name: '甜甜圈底座', unlock: { station: 36 } },
  { id: 'frame.cloud',   cat: 'frame', name: '立體雲朵',   unlock: { station: 41 } },
  { id: 'frame.gear',    cat: 'frame', name: '齒輪底座',   unlock: { station: 101 } },
  { id: 'frame.gift',    cat: 'frame', name: '禮物盒',     unlock: { station: 121 } },
  { id: 'frame.gold',    cat: 'frame', name: '金色底座',   unlock: { chest: 13 } },
  // 分類 4：棋盤背景主題（配色取自地圖上那一站）
  { id: 'theme.macaron', cat: 'theme', name: '夢幻馬卡龍',     unlock: null },
  { id: 'theme.glass',    cat: 'theme', name: '半透明',     unlock: null },   // 工作單17：看得到後面這一站的背景
  { id: 'theme.claw',    cat: 'theme', name: '粉紅夾娃娃機台', unlock: { chest: 0 } },
  { id: 'theme.picnic',  cat: 'theme', name: '野餐草莓格紋',   unlock: { coins: 4 } },
  { id: 'theme.galaxy',  cat: 'theme', name: '深邃夢幻星空',   unlock: { chest: 4 } },
  { id: 'theme.dock',     cat: 'theme', name: '蛋蛋碼頭',   unlock: { station: 16 } },
  { id: 'theme.park',     cat: 'theme', name: '遊樂園',     unlock: { station: 66 } },
  { id: 'theme.snow',     cat: 'theme', name: '雪地',       unlock: { chest: 8 } },
  { id: 'theme.sea',      cat: 'theme', name: '海底',       unlock: { chest: 9 } },
  { id: 'theme.choco',    cat: 'theme', name: '巧克力工坊', unlock: { chest: 10 } },
  { id: 'theme.dream',    cat: 'theme', name: '夢幻工廠',   unlock: { chest: 11 } },
  { id: 'theme.bamboo',   cat: 'theme', name: '竹林',       unlock: { station: 156 } },
  { id: 'theme.lantern',  cat: 'theme', name: '燈籠夜市',   unlock: { station: 161 } },
  { id: 'theme.icecream', cat: 'theme', name: '冰淇淋店',   unlock: { chest: 16 } },
  { id: 'theme.moon',     cat: 'theme', name: '月亮島',     unlock: { chest: 18 } },
  { id: 'theme.castle',   cat: 'theme', name: '雲上城堡',   unlock: { chest: 20 } },
  // 分類 5：頭像外圈
  { id: 'ring.pink',    cat: 'ring', name: '粉紅',   unlock: null },
  { id: 'ring.cloud',   cat: 'ring', name: '雲朵',   unlock: { coins: 2 } },
  { id: 'ring.star',    cat: 'ring', name: '星星',   unlock: { station: 86 } },
  { id: 'ring.rainbow', cat: 'ring', name: '彩虹',   unlock: { coins: 6 } },
  { id: 'ring.gold',    cat: 'ring', name: '金色',   unlock: { allClear: true } },
  { id: 'ring.balloon', cat: 'ring', name: '熱氣球', unlock: { station: 136 } },
  { id: 'ring.moon',    cat: 'ring', name: '新月',   unlock: { chest: 19 } },
];
export const DEFAULT_LOOK = { outfit: 'outfit.none', hat: 'hat.none', fx: 'fx.default', frame: 'frame.jelly', theme: 'theme.macaron', ring: 'ring.pink' };
export const itemById = id => ITEMS.find(it => it.id === id) || null;

// ---------- 我的頭像（衣櫃裡的「我的頭像」：角色 + 圓形底色）----------
// 角色：shubing 薯餅（預設）、egg 蛋黃哥（工作單22）；底色只用程式畫的顏色和漸層。sakura 是原本的底色（舊玩家的頭像看起來不變）
export const AVATAR_WHO = ['shubing', 'egg'];
export const AVATAR_BGS = [
  { id: 'sakura', name: '櫻花粉', bg: 'radial-gradient(circle at 50% 35%, #fff, #ffe3f2)', sh: 'rgba(255, 111, 176, .22)' },
  { id: 'sea',    name: '海邊藍', bg: 'radial-gradient(circle at 50% 35%, #f5fcff, #b4e0ff)', sh: 'rgba(40, 130, 220, .22)' },
  { id: 'grass',  name: '草地綠', bg: 'radial-gradient(circle at 50% 35%, #f6fff0, #bfe9a8)', sh: 'rgba(60, 150, 50, .22)' },
  { id: 'yolk',   name: '蛋黃黃', bg: 'radial-gradient(circle at 50% 35%, #fffdf0, #ffdd6e)', sh: 'rgba(220, 140, 0, .24)' },
  { id: 'night',  name: '夜空紫', bg: 'radial-gradient(circle at 50% 30%, #b2a6f4, #4f409e)', sh: 'rgba(20, 10, 70, .3)' },
];
export const DEFAULT_AVATAR = { who: 'shubing', bg: 'sakura' };
export const avatarBg = id => AVATAR_BGS.find(b => b.id === id) || AVATAR_BGS[0];
// 頭像的樣子（朋友的 players.look、雲端衣櫃的 avatar 都用這個格式）：{ who, bg, hat, outfit, ring, fx }，值都是去掉分類前綴的短 id。
// 看不懂的值（舊版、亂寫、以後才有的品項）一律換回預設薯餅的那一項
const LOOK_PARTS = ['hat', 'outfit', 'ring', 'fx'];
export function cleanLook(l) {
  const o = l && typeof l === 'object' && !Array.isArray(l) ? l : {};
  const out = {
    who: AVATAR_WHO.includes(o.who) ? o.who : DEFAULT_AVATAR.who,
    bg: AVATAR_BGS.some(b => b.id === o.bg) ? o.bg : DEFAULT_AVATAR.bg,
  };
  for (const c of LOOK_PARTS) {
    const v = typeof o[c] === 'string' && o[c].length <= 40 ? o[c] : '';
    const it = v && itemById(c + '.' + v);
    out[c] = it && it.cat === c ? v : DEFAULT_LOOK[c].split('.')[1];
  }
  return out;
}
// 上一版就有的 19 件（「新」標記用：舊衣櫃讀進來時，這些不標「新」）
const OLD_IDS = new Set(['hat.none', 'hat.bow', 'hat.blush', 'hat.crown', 'hat.shades', 'hat.chef', 'hat.halo', 'fx.default', 'fx.sakura', 'fx.bubbles', 'fx.gold',
  'frame.jelly', 'frame.cookie', 'frame.capsule', 'frame.petal', 'theme.macaron', 'theme.claw', 'theme.picnic', 'theme.galaxy']);
// 關卡順序（main.js 開機時給 LEVELS 的 id）：「走到第 n 關」和「全部過關」照這個判斷，不寫死關卡數
let LEVEL_IDS = [];
export function setLevels(ids) { LEVEL_IDS = Array.isArray(ids) ? ids.slice() : []; }
export const levelCount = () => LEVEL_IDS.length;
const hasStar = (stars, id) => (Number(stars && stars[id]) || 0) > 0;
export function reachedStation(n, stars) {
  if (n <= 1) return true;
  const id = LEVEL_IDS.length ? LEVEL_IDS[n - 2] : n - 1;
  return id != null && hasStar(stars, id);
}
export const allCleared = stars => LEVEL_IDS.length > 0 && LEVEL_IDS.every(id => hasStar(stars, id));

// ---------- 三星豪華寶箱（星星總數里程碑）----------
// items：直接解鎖的外觀（ITEMS 裡 unlock: { chest: i } 的那些）；coins：多送的造型幣；set：限定全套的名字
export const CHESTS = [
  { stars: 3,   coins: 1, name: '粉紅夾娃娃機台' },
  { stars: 9,   coins: 1, name: '彩虹愛心泡泡' },
  { stars: 15,  coins: 1, name: '發光天使光環' },
  { stars: 24,  coins: 2, name: '花瓣底座' },
  { stars: 36,  coins: 2, name: '星空貴族全套', set: true },   // 深邃夢幻星空 + 奢華金粉亮片
  { stars: 54,  coins: 3, name: '小魔法師' },
  { stars: 80,  coins: 3, name: '蛋殼帽' },
  { stars: 110, coins: 4, name: '聖誕帽' },
  { stars: 145, coins: 4, name: '雪地棋盤' },
  { stars: 180, coins: 4, name: '海底棋盤' },
  { stars: 220, coins: 5, name: '巧克力工坊棋盤' },
  { stars: 260, coins: 5, name: '夢幻工廠棋盤' },
  { stars: 300, coins: 8, name: '彩虹特效' },
  { stars: 345, coins: 6, name: '金色底座' },
  { stars: 390, coins: 8, name: '國王披風' },
  { stars: 435, coins: 5, name: '小恐龍' },
  { stars: 480, coins: 5, name: '冰淇淋店棋盤' },
  { stars: 525, coins: 6, name: '小畫家' },
  { stars: 570, coins: 6, name: '月亮島棋盤' },
  { stars: 620, coins: 7, name: '新月外圈' },
  { stars: 675, coins: 10, name: '雲上城堡棋盤' },   // 225 關全部三星
];
export const chestItems = i => ITEMS.filter(it => it.unlock && it.unlock.chest === i);

// ---------- 畫 SVG 的小工具（新配件、玩偶造型、外圈、圖示共用）----------
const S = (d, f, s, w) => `<path d="${d}" fill="${f}" stroke="${s}" stroke-width="${w || 1.6}" stroke-linejoin="round" stroke-linecap="round"/>`;
const L = (d, s, w, o) => `<path d="${d}" fill="none" stroke="${s}" stroke-width="${w}" stroke-linecap="round" opacity="${o == null ? 1 : o}"/>`;
const C = (cx, cy, r, f, s, w) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${f}"${s ? ` stroke="${s}" stroke-width="${w || 1.4}"` : ''}/>`;
function star(cx, cy, r, f, s, w) {
  let p = '';
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; p += (i ? 'L' : 'M') + (cx + rr * Math.cos(a)).toFixed(2) + ' ' + (cy + rr * Math.sin(a)).toFixed(2) + ' '; }
  return S(p + 'Z', f, s || 'none', w || 0);
}
// 五瓣小花
function flower(cx, cy, r, petal, mid, edge) {
  let o = '';
  for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + i * 2 * Math.PI / 5; o += C((cx + r * 0.62 * Math.cos(a)).toFixed(2), (cy + r * 0.62 * Math.sin(a)).toFixed(2), (r * 0.5).toFixed(2), petal, edge, r * 0.16); }
  return o + C(cx, cy, (r * 0.38).toFixed(2), mid);
}
// 六角雪花
function flake(cx, cy, r, col, w) {
  let d = '';
  for (let i = 0; i < 3; i++) { const a = i * Math.PI / 3, dx = r * Math.cos(a), dy = r * Math.sin(a); d += `M${(cx - dx).toFixed(2)} ${(cy - dy).toFixed(2)} L${(cx + dx).toFixed(2)} ${(cy + dy).toFixed(2)} `; }
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3, bx = cx + r * 0.6 * Math.cos(a), by = cy + r * 0.6 * Math.sin(a);
    for (const s of [-1, 1]) { const b = a + s * 0.7; d += `M${bx.toFixed(2)} ${by.toFixed(2)} L${(bx + r * 0.32 * Math.cos(b)).toFixed(2)} ${(by + r * 0.32 * Math.sin(b)).toFixed(2)} `; }
  }
  return L(d, col, w);
}
// 齒輪外形
function gearPath(cx, cy, R, r, n) {
  let p = '';
  for (let i = 0; i < n * 4; i++) {
    const a = (i / (n * 4)) * Math.PI * 2 - Math.PI / 2, rr = (i % 4 === 1 || i % 4 === 2) ? R : r;
    p += (i ? 'L' : 'M') + (cx + rr * Math.cos(a)).toFixed(2) + ' ' + (cy + rr * Math.sin(a)).toFixed(2) + ' ';
  }
  return p + 'Z';
}
const lg = (id, stops, x2 = 0, y2 = 1) => `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient>`;
// 造型、外圈共用的漸層（每張 SVG 自己帶一份，畫成圖片時不會互相影響）
const GRAD = '<defs>' + [
  lg('gW', [[0, '#ffffff'], [0.55, '#f3f0fa'], [1, '#cfc8e2']]),
  lg('gB', [[0, '#d6e8ff'], [0.45, '#5b8ef0'], [1, '#2c55b8']]),
  lg('gR', [[0, '#ffd2cf'], [0.45, '#ff5a5a'], [1, '#c42a2a']]),
  lg('gP', [[0, '#ead8ff'], [0.45, '#9a5cf0'], [1, '#5b2bb0']]),
  lg('gY', [[0, '#fff8c4'], [0.45, '#ffd23c'], [1, '#e48a00']]),
  lg('gK', [[0, '#ffd0e6'], [0.45, '#ff86bd'], [1, '#f0468f']]),
  lg('gN', [[0, '#f3d9b5'], [0.45, '#b9814a'], [1, '#7a4a1f']]),
  lg('gG', [[0, '#d9ffc8'], [0.45, '#63c94f'], [1, '#2f8a2a']]),
  lg('gO', [[0, '#ffe0b0'], [0.45, '#ff9a2e'], [1, '#c85a00']]),
  lg('gD', [[0, '#6a5e9a'], [0.5, '#2c2648'], [1, '#141024']]),
  lg('gC', [[0, '#fffdf5'], [0.6, '#fbf0d6'], [1, '#e6d2a6']]),
  '<radialGradient id="gGlass" cx=".42" cy=".38" r=".62"><stop offset="0" stop-color="#e8f6ff" stop-opacity=".08"/><stop offset=".75" stop-color="#bfe0ff" stop-opacity=".22"/><stop offset="1" stop-color="#8ec4ff" stop-opacity=".5"/></radialGradient>',
  lg('gRain', [[0, '#ff6f9f'], [0.25, '#ffc21a'], [0.5, '#63c94f'], [0.75, '#5b8ef0'], [1, '#9a5cf0']], 1, 1),
].join('') + '</defs>';
const WS = '#8b86a6';

// ---------- 配件戴在哪裡 ----------
// 每隻玩偶的臉在照片裡的位置（0–1，照「照片裡玩偶不透明部分的外框」量）：
//   x 臉的中心（左右）、top 頭頂、eyes 眼睛那一排、cheeks 臉頰、w 臉有多寬（佔玩偶寬度的比例）
export const TOY_FACE = {
  dog:     { x: 0.5,  top: 0.03, eyes: 0.55, cheeks: 0.7,  w: 0.72 },
  sloth:   { x: 0.5,  top: 0.02, eyes: 0.33, cheeks: 0.44, w: 0.4 },
  egg:     { x: 0.5,  top: 0.02, eyes: 0.27, cheeks: 0.37, w: 0.72 },
  piggy:   { x: 0.3,  top: 0.26, eyes: 0.4,  cheeks: 0.6,  w: 0.5 },   // 火腿（存錢豬）：頭在照片左邊
  nyanko:  { x: 0.48, top: 0.08, eyes: 0.53, cheeks: 0.62, w: 0.8 },   // 3D 掃描，使用者取景（11/25 工作單32）：俯角 36°、拉近，臉在中間偏下
  moodeng: { x: 0.5,  top: 0.05, eyes: 0.3,  cheeks: 0.62, w: 0.86 },
  snoopy:  { x: 0.46, top: 0.04, eyes: 0.5,  cheeks: 0.64, w: 0.72 },
};
// 每種配件的基本位置：anchor = 對齊臉的哪一條線；size = 寬度（臉寬的幾倍）；ay = 配件圖的哪個高度對齊那條線（0 上緣、1 下緣）；
// dx = 往右挪（臉寬的幾倍）
export const ACCESSORY_PLACE = {
  crown:  { anchor: 'top',    size: 0.92, ay: 0.72, dx: 0 },
  chef:   { anchor: 'top',    size: 1.0,  ay: 0.78, dx: 0 },
  halo:   { anchor: 'top',    size: 1.05, ay: 0.95, dx: 0 },
  bow:    { anchor: 'top',    size: 0.66, ay: 0.4,  dx: 0.36 },
  shades: { anchor: 'eyes',   size: 1.05, ay: 0.45, dx: 0 },
  blush:  { anchor: 'cheeks', size: 1.08, ay: 0.5,  dx: 0 },
  clip:         { anchor: 'top',  size: 0.5,  ay: 0.45, dx: 0.34 },
  bunny:        { anchor: 'top',  size: 0.95, ay: 0.88, dx: 0 },
  beret:        { anchor: 'top',  size: 0.95, ay: 0.7,  dx: 0.05 },
  heartglasses: { anchor: 'eyes', size: 1.05, ay: 0.45, dx: 0 },
  tophat:       { anchor: 'top',  size: 0.72, ay: 0.86, dx: 0 },
  flowers:      { anchor: 'top',  size: 1.05, ay: 0.62, dx: 0 },
  eggshell:     { anchor: 'top',  size: 0.95, ay: 0.78, dx: 0 },
  santa:        { anchor: 'top',  size: 1.0,  ay: 0.8,  dx: 0 },
};
// ★ 微調設定檔：某隻玩偶戴某個配件時，位置 / 大小不對就改這裡 ★
//   offsetX / offsetY：往右 / 往下挪多少（玩偶寬 / 高的比例，例如 0.05 = 挪 5%；負數 = 往左 / 往上）
//   scale：大小（1 = 原本，1.2 = 大 20%）
//   rot：轉幾度（順時針為正，負數往左轉；以配件正中間為中心，跟飾品對齊台一樣）
export const ACCESSORY_TUNING = {
  dog:     { crown: { offsetX: -0.198, offsetY: 0.116, scale: 0.9, rot: -5 },
             chef: { offsetX: -0.205, offsetY: 0.143, scale: 0.82, rot: 0 },
             halo: { offsetX: -0.16, offsetY: 0.093, scale: 1, rot: 0 },
             bow: { offsetX: -0.477, offsetY: 0.2, scale: 1, rot: 0 },
             shades: { offsetX: -0.221, offsetY: -0.017, scale: 0.88, rot: 0 },
             blush: { offsetX: -0.247, offsetY: 0.055, scale: 1, rot: 0 },
             clip: { offsetX: -0.451, offsetY: 0.105, scale: 1, rot: 0 },
             eggshell: { offsetX: -0.181, offsetY: 0.23, scale: 0.82, rot: 0 } },
  sloth:   { crown: { offsetX: -0.094, offsetY: -0.022, scale: 1.2, rot: -10 },
             chef: { offsetX: -0.088, offsetY: 0.007, scale: 1.15, rot: -10 },
             halo: { offsetX: -0.089, offsetY: 0.021, scale: 1.2, rot: -10 },
             bow: { offsetX: -0.162, offsetY: 0.517, scale: 1.15, rot: -5 },
             shades: { offsetX: -0.034, offsetY: -0.061, scale: 1.1, rot: -10 },
             blush: { offsetX: -0.021, offsetY: -0.073, scale: 1.12, rot: -10 },
             bunny: { offsetX: -0.058, offsetY: 0.034, scale: 1.2, rot: -5 },
             clip: { offsetX: -0.199, offsetY: -0.073, scale: 1.15, rot: -5 },
             beret: { offsetX: -0.096, offsetY: 0.027, scale: 1.2, rot: -10 },
             tophat: { offsetX: -0.079, offsetY: 0.053, scale: 1.2, rot: -10 },
             flowers: { offsetX: -0.062, offsetY: 0.046, scale: 1.2, rot: -10 },
             eggshell: { offsetX: -0.066, offsetY: 0.069, scale: 1.15, rot: -10 },
             santa: { offsetX: -0.081, offsetY: 0.049, scale: 1.15, rot: -10 } },
  egg:     { crown: { offsetX: 0.019, offsetY: -0.032, scale: 1, rot: 0 },
             chef: { offsetX: 0.021, offsetY: -0.037, scale: 0.88, rot: 0 },
             halo: { offsetX: 0.025, offsetY: -0.01, scale: 1, rot: 0 },
             bow: { offsetX: -0.272, offsetY: 0.511, scale: 1, rot: 0 },
             shades: { offsetX: 0.015, offsetY: -0.091, scale: 0.8, rot: 0 },
             blush: { offsetX: 0.008, offsetY: -0.099, scale: 1, rot: 0 },
             clip: { offsetX: -0.233, offsetY: -0.088, scale: 1, rot: 0 },
             beret: { offsetX: -0.024, offsetY: 0.033, scale: 1, rot: 0 },
             tophat: { offsetX: 0.017, offsetY: 0.057, scale: 1, rot: 0 },
             flowers: { offsetX: 0.01, offsetY: 0.032, scale: 1, rot: 0 },
             eggshell: { offsetX: 0.026, offsetY: 0.069, scale: 0.88, rot: 0 },
             santa: { offsetX: 0.033, offsetY: 0.058, scale: 0.88, rot: 0 } },
  piggy:   { crown: { offsetX: -0.065, offsetY: -0.034, scale: 0.9, rot: -10 },
             chef: { offsetX: -0.095, offsetY: -0.006, scale: 1, rot: -10 },
             halo: { offsetX: -0.095, offsetY: 0.009, scale: 1, rot: -15 },
             bow: { offsetX: -0.045, offsetY: 0.041, scale: 1, rot: 15 },
             shades: { offsetX: -0.053, offsetY: -0.018, scale: 1, rot: -10 },
             blush: { offsetX: -0.055, offsetY: -0.129, scale: 1, rot: -15 },
             clip: { offsetX: -0.266, offsetY: -0.062, scale: 1, rot: -15 },
             beret: { offsetX: -0.095, offsetY: 0.018, scale: 0.9, rot: -15 },
             eggshell: { offsetX: -0.056, offsetY: 0.033, scale: 1, rot: -10 } },
  nyanko:  { crown: { offsetX: 0, offsetY: 0.015, scale: 0.75, rot: 0 },
             chef: { offsetX: 0, offsetY: 0.01, scale: 0.75, rot: 0 },
             halo: { offsetX: 0, offsetY: 0, scale: 0.8, rot: 0 },
             bow: { offsetX: -0.28, offsetY: 0.636, scale: 0.6, rot: 0 },
             shades: { offsetX: 0, offsetY: 0, scale: 0.85, rot: 0 },
             blush: { offsetX: 0, offsetY: 0, scale: 0.85, rot: 0 },
             clip: { offsetX: -0.285, offsetY: -0.096, scale: 1, rot: 0 },
             bunny: { offsetX: 0, offsetY: 0, scale: 0.8, rot: 0 },
             beret: { offsetX: -0.048, offsetY: -0.004, scale: 0.75, rot: 0 },
             heartglasses: { offsetX: -0.009, offsetY: 0, scale: 0.85, rot: 0 },
             tophat: { offsetX: 0, offsetY: 0, scale: 0.75, rot: 0 },
             flowers: { offsetX: 0, offsetY: 0, scale: 0.8, rot: 0 },
             eggshell: { offsetX: 0, offsetY: 0, scale: 0.8, rot: 0 },
             santa: { offsetX: 0, offsetY: 0, scale: 0.8, rot: 0 } },   // 使用者取景（11/25 工作單32）；bow、clip、beret、heartglasses 使用者在對齊台調（工作單33）
  moodeng: { crown: { offsetX: 0.025, offsetY: -0.106, scale: 0.72, rot: 0 },
             chef: { offsetX: 0.031, offsetY: -0.115, scale: 0.68, rot: 0 },
             halo: { offsetX: 0, offsetY: 0, scale: 0.9, rot: 0 },
             bow: { offsetX: -0.304, offsetY: 0.984, scale: 0.9, rot: 0 },
             shades: { offsetX: 0.012, offsetY: 0.038, scale: 0.88, rot: 0 },
             blush: { offsetX: 0, offsetY: 0, scale: 1, rot: 0 },
             clip: { offsetX: -0.268, offsetY: -0.193, scale: 0.9, rot: 0 },
             beret: { offsetX: -0.013, offsetY: 0.026, scale: 0.72, rot: 0 },
             tophat: { offsetX: 0.009, offsetY: 0.042, scale: 0.72, rot: 0 },
             flowers: { offsetX: 0.019, offsetY: 0, scale: 0.72, rot: 0 },
             eggshell: { offsetX: 0.015, offsetY: 0.058, scale: 0.68, rot: 0 },
             santa: { offsetX: 0.013, offsetY: 0.049, scale: 0.68, rot: 0 } },
  snoopy:  { crown: { offsetX: -0.037, offsetY: -0.017, scale: 0.94, rot: 0 },
             chef: { offsetX: -0.046, offsetY: -0.048, scale: 0.92, rot: 0 },
             halo: { offsetX: -0.031, offsetY: 0.042, scale: 1, rot: 0 },
             bow: { offsetX: -0.047, offsetY: 0.056, scale: 1, rot: 0 },
             shades: { offsetX: 0, offsetY: 0, scale: 1, rot: 0 },
             blush: { offsetX: 0, offsetY: 0, scale: 1, rot: 0 },
             clip: { offsetX: -0.285, offsetY: -0.071, scale: 1, rot: 0 },
             tophat: { offsetX: -0.039, offsetY: 0.067, scale: 0.94, rot: 0 },
             flowers: { offsetX: -0.038, offsetY: 0.081, scale: 0.94, rot: 0 },
             eggshell: { offsetX: -0.017, offsetY: 0.065, scale: 0.92, rot: 0 },
             santa: { offsetX: 0.007, offsetY: 0.087, scale: 0.92, rot: 0 } },
};
// 新配件沒有自己的微調時，照戴法最像的舊配件微調（例如貝雷帽跟皇冠一樣戴在頭頂）
const TUNE_LIKE = { clip: 'bow', heartglasses: 'shades', bunny: 'crown', beret: 'crown', tophat: 'crown', flowers: 'crown', eggshell: 'chef', santa: 'chef' };
export function accTune(toy, name) {
  const t = ACCESSORY_TUNING[toy] || {};
  return Object.assign({ offsetX: 0, offsetY: 0, scale: 1, rot: 0 }, t[name] || t[TUNE_LIKE[name]]);
}

// ---------- 配件的圖（SVG，透明背景；renderer 先畫成小圖再疊到玩偶上）----------
export const ACCESSORY_SVG = {
  crown: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 88"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff8c4"/><stop offset=".45" stop-color="#ffd23c"/><stop offset="1" stop-color="#e48a00"/></linearGradient></defs><path d="M12 72 L8 26 L35 47 L60 12 L85 47 L112 26 L108 72 Z" fill="url(#g)" stroke="#9a5200" stroke-width="5" stroke-linejoin="round"/><rect x="10" y="64" width="100" height="17" rx="8" fill="url(#g)" stroke="#9a5200" stroke-width="5"/><circle cx="8" cy="24" r="6.5" fill="#fff3a0" stroke="#9a5200" stroke-width="3.5"/><circle cx="60" cy="10" r="7" fill="#fff3a0" stroke="#9a5200" stroke-width="3.5"/><circle cx="112" cy="24" r="6.5" fill="#fff3a0" stroke="#9a5200" stroke-width="3.5"/><circle cx="60" cy="72" r="6.5" fill="#ff5fa2" stroke="#9a1f5a" stroke-width="2.5"/><circle cx="33" cy="72" r="4.8" fill="#5fd0ff" stroke="#1d6f9a" stroke-width="2.2"/><circle cx="87" cy="72" r="4.8" fill="#5fd0ff" stroke="#1d6f9a" stroke-width="2.2"/><path d="M20 36 L23 60" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".75"/><circle cx="57" cy="7" r="2.2" fill="#fff"/></svg>`,
  shades: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 54"><defs><linearGradient id="l" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4a3f7a"/><stop offset=".5" stop-color="#1c1830"/><stop offset="1" stop-color="#0c0a16"/></linearGradient></defs><rect x="3" y="7" width="134" height="8" rx="4" fill="#1c1830"/><path d="M7 11 H62 Q67 11 66 17 L61 37 Q58 48 44 48 H25 Q10 48 8 35 Z" fill="url(#l)" stroke="#000" stroke-width="3" stroke-linejoin="round"/><path d="M133 11 H78 Q73 11 74 17 L79 37 Q82 48 96 48 H115 Q130 48 132 35 Z" fill="url(#l)" stroke="#000" stroke-width="3" stroke-linejoin="round"/><path d="M62 17 Q70 10 78 17" fill="none" stroke="#1c1830" stroke-width="5" stroke-linecap="round"/><path d="M16 17 L32 17 L21 38 Z" fill="#fff" opacity=".55"/><path d="M86 17 L102 17 L91 38 Z" fill="#fff" opacity=".55"/><circle cx="52" cy="19" r="2.5" fill="#fff" opacity=".8"/><circle cx="122" cy="19" r="2.5" fill="#fff" opacity=".8"/></svg>`,
  bow: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 110 74"><defs><linearGradient id="p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd0e6"/><stop offset=".5" stop-color="#ff86bd"/><stop offset="1" stop-color="#f0468f"/></linearGradient></defs><path d="M50 42 L38 70 L48 65 L54 72 Z" fill="url(#p)" stroke="#b8155a" stroke-width="4" stroke-linejoin="round"/><path d="M60 42 L72 70 L62 65 L56 72 Z" fill="url(#p)" stroke="#b8155a" stroke-width="4" stroke-linejoin="round"/><path d="M55 36 C40 10 7 4 5 23 C3 42 30 54 55 36 Z" fill="url(#p)" stroke="#b8155a" stroke-width="4.5" stroke-linejoin="round"/><path d="M55 36 C70 10 103 4 105 23 C107 42 80 54 55 36 Z" fill="url(#p)" stroke="#b8155a" stroke-width="4.5" stroke-linejoin="round"/><rect x="45" y="26" width="20" height="20" rx="8" fill="#ff7fb5" stroke="#b8155a" stroke-width="4.5"/><path d="M15 20 Q23 13 33 19" stroke="#fff" stroke-width="4.5" fill="none" stroke-linecap="round" opacity=".85"/><path d="M77 19 Q86 13 94 19" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" opacity=".6"/><circle cx="51" cy="31" r="2.6" fill="#fff" opacity=".9"/></svg>`,
  halo: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 50"><defs><radialGradient id="h"><stop offset=".5" stop-color="#fff6a8" stop-opacity="0"/><stop offset=".74" stop-color="#fff3a8" stop-opacity=".9"/><stop offset="1" stop-color="#ffe066" stop-opacity="0"/></radialGradient></defs><ellipse cx="60" cy="25" rx="52" ry="18" fill="url(#h)" opacity=".5"/><ellipse cx="60" cy="25" rx="44" ry="13" fill="none" stroke="#f5b800" stroke-width="10"/><ellipse cx="60" cy="25" rx="44" ry="13" fill="none" stroke="#ffe36e" stroke-width="6"/><ellipse cx="60" cy="25" rx="44" ry="13" fill="none" stroke="#fffbe6" stroke-width="2.4"/><circle cx="30" cy="16" r="2.6" fill="#fff"/></svg>`,
  blush: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 42"><defs><radialGradient id="b"><stop offset="0" stop-color="#ff5f92" stop-opacity=".9"/><stop offset=".65" stop-color="#ff86ad" stop-opacity=".6"/><stop offset="1" stop-color="#ff9fbf" stop-opacity="0"/></radialGradient></defs><ellipse cx="22" cy="21" rx="21" ry="15" fill="url(#b)"/><ellipse cx="118" cy="21" rx="21" ry="15" fill="url(#b)"/><g stroke="#ff3f7a" stroke-width="2.8" stroke-linecap="round" opacity=".85"><path d="M12 26 L17 16 M20 27 L25 17 M28 26 L33 16"/><path d="M108 26 L113 16 M116 27 L121 17 M124 26 L129 16"/></g></svg>`,
  chef: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 112 98"><path d="M23 62 C3 60 1 30 23 28 C25 7 51 1 59 18 C69 1 101 5 96 30 C114 33 110 62 89 62 Z" fill="#fff" stroke="#a9a2bf" stroke-width="4.5" stroke-linejoin="round"/><path d="M33 44 C35 33 45 29 52 35 M70 30 C77 24 87 27 88 36" stroke="#ebe6f6" stroke-width="5" fill="none" stroke-linecap="round"/><rect x="23" y="58" width="66" height="32" rx="7" fill="#fff" stroke="#a9a2bf" stroke-width="4.5"/><path d="M41 63 V86 M56 63 V86 M71 63 V86" stroke="#e3dff0" stroke-width="3.5" stroke-linecap="round"/><rect x="23" y="58" width="66" height="8" rx="4" fill="#ffd8ea" opacity=".9"/></svg>`,
  // 新配件（畫法跟上面一樣：粗描邊、上亮下深的漸層、一兩道白色反光）
  clip: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 74">${GRAD}${S('M14 58 L66 58 Q70 58 70 63 Q70 68 66 68 L14 68 Q10 68 10 63 Q10 58 14 58 Z', 'url(#gK)', '#b8155a', 3.5)}${star(40, 33, 30, 'url(#gY)', '#9a5200', 4)}${L('M27 24 Q30 17 36 15', '#fff', 4, 0.85)}${C(48, 36, 3, '#ff86bd')}${C(32, 36, 3, '#ff86bd')}</svg>`,
  bunny: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100">${GRAD}${S('M36 86 C20 62 16 16 31 6 C46 -2 54 40 53 86 Z', 'url(#gW)', '#a9a2bf', 4)}${S('M38 78 C29 60 26 24 33 15 C42 10 46 44 46 78 Z', '#ffc1d9', 'none', 0)}${S('M84 86 C100 62 104 16 89 6 C74 -2 66 40 67 86 Z', 'url(#gW)', '#a9a2bf', 4)}${S('M82 78 C91 60 94 24 87 15 C78 10 74 44 74 78 Z', '#ffc1d9', 'none', 0)}${L('M8 94 Q60 72 112 94', '#b8155a', 11)}${L('M8 94 Q60 72 112 94', '#ff86bd', 7)}${L('M24 30 Q24 18 30 12', '#fff', 3.5, 0.9)}</svg>`,
  beret: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 72">${GRAD}${L('M62 14 L64 3', '#8f1d1d', 6)}${S('M8 48 C2 24 40 8 70 11 C102 14 120 28 113 46 C104 60 22 64 8 48 Z', 'url(#gR)', '#8f1d1d', 4.5)}${S('M18 50 Q60 64 104 50 L104 57 Q60 70 18 57 Z', '#c42a2a', '#8f1d1d', 3.5)}${L('M26 30 Q40 18 58 17', '#fff', 4.5, 0.8)}</svg>`,
  heartglasses: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 56"><defs><linearGradient id="k" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb3d6"/><stop offset="1" stop-color="#ff3f8e"/></linearGradient></defs>${L('M12 16 L2 10 M128 16 L138 10', '#b8155a', 5)}${S('M34 52 C12 40 4 27 8 16 C12 5 28 4 34 15 C40 4 56 5 60 16 C64 27 56 40 34 52 Z', 'url(#k)', '#b8155a', 4.5)}${S('M106 52 C84 40 76 27 80 16 C84 5 100 4 106 15 C112 4 128 5 132 16 C136 27 128 40 106 52 Z', 'url(#k)', '#b8155a', 4.5)}${L('M59 19 Q70 11 81 19', '#b8155a', 5)}${L('M16 18 Q20 11 27 12', '#fff', 4, 0.9)}${L('M88 18 Q92 11 99 12', '#fff', 4, 0.9)}</svg>`,
  tophat: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 92">${GRAD}${S('M24 74 L27 12 Q50 4 73 12 L76 74 Z', 'url(#gD)', '#000', 4)}${S('M25.5 52 L74.5 52 L75.3 66 L24.7 66 Z', 'url(#gK)', '#b8155a', 3)}<ellipse cx="50" cy="76" rx="46" ry="10" fill="url(#gD)" stroke="#000" stroke-width="4"/>${L('M34 18 L33 46', '#fff', 4, 0.5)}${star(64, 59, 5, '#fff6a8')}</svg>`,
  flowers: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 130 62">${GRAD}<ellipse cx="65" cy="32" rx="57" ry="15" fill="none" stroke="#2f8a2a" stroke-width="7"/><ellipse cx="65" cy="32" rx="57" ry="15" fill="none" stroke="#63c94f" stroke-width="4"/>${[[18, 26], [40, 19], [90, 19], [112, 26]].map(([x, y]) => S(`M${x - 6} ${y} Q${x} ${y - 7} ${x + 6} ${y} Q${x} ${y + 4} ${x - 6} ${y} Z`, '#63c94f', '#2f8a2a', 1.6)).join('')}${flower(12, 36, 9, '#ffd0e6', '#ffd23c', '#f0468f')}${flower(34, 44, 10, '#fff', '#ffd23c', '#a9a2bf')}${flower(57, 48, 10.5, '#ffe36e', '#ff86bd', '#e48a00')}${flower(80, 47, 10.5, '#ffd0e6', '#ffd23c', '#f0468f')}${flower(101, 43, 10, '#fff', '#ff86bd', '#a9a2bf')}${flower(119, 35, 9, '#cfe2ff', '#ffd23c', '#5b8ef0')}</svg>`,
  eggshell: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 110 70">${GRAD}${S('M8 62 C8 22 32 4 55 4 C78 4 102 22 102 62 L92 51 L82 62 L72 51 L62 62 L55 53 L48 62 L38 51 L28 62 L18 51 Z', 'url(#gC)', '#b39a6a', 4)}${C(70, 22, 4, '#f1dfb6')}${C(82, 36, 3, '#f1dfb6')}${C(40, 18, 2.6, '#f1dfb6')}${L('M22 34 Q26 18 40 11', '#fff', 5, 0.9)}</svg>`,
  santa: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 112 100">${GRAD}${S('M14 72 C20 42 46 12 76 10 C92 9 101 20 98 34 C88 30 82 42 80 72 Z', 'url(#gR)', '#8f1d1d', 4.5)}${L('M36 34 Q50 18 68 14', '#fff', 4, 0.55)}<rect x="6" y="64" width="98" height="22" rx="11" fill="url(#gW)" stroke="${WS}" stroke-width="4"/>${C(98, 37, 10, 'url(#gW)', WS, 4)}${L('M18 70 Q30 67 40 69', '#fff', 3, 0.9)}</svg>`,
};

// ---------- 衣櫃裡每一格的小圖示（配件就是配件的圖；其他分類是示意圖）----------
const ICON = {
  'hat.none': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="22" fill="none" stroke="#c9b7d8" stroke-width="5" stroke-dasharray="6 7" stroke-linecap="round"/><path d="M22 42 L42 22" stroke="#c9b7d8" stroke-width="5" stroke-linecap="round"/></svg>`,
  'fx.default': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="22" cy="38" r="12" fill="#fff" stroke="#e5d7f3" stroke-width="3"/><circle cx="40" cy="44" r="9" fill="#ffe1f0" stroke="#f6c3dc" stroke-width="3"/><path d="M44 8 Q44 22 58 22 Q44 22 44 36 Q44 22 30 22 Q44 22 44 8 Z" fill="#ffd23c" stroke="#e48a00" stroke-width="2.5" stroke-linejoin="round"/><path d="M16 10 Q16 17 23 17 Q16 17 16 24 Q16 17 9 17 Q16 17 16 10 Z" fill="#fff3b0" stroke="#e8a500" stroke-width="2"/></svg>`,
  'fx.sakura': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g fill="#ffc1d9" stroke="#ef7aa8" stroke-width="2.5" stroke-linejoin="round"><path d="M20 8 C30 10 30 24 20 28 C10 24 10 10 20 8 Z"/><path d="M44 26 C54 28 54 42 44 46 C34 42 34 28 44 26 Z" transform="rotate(40 44 36)"/><path d="M18 40 C26 42 26 54 18 57 C10 54 10 42 18 40 Z" transform="rotate(-30 18 48)"/></g><circle cx="20" cy="18" r="2.5" fill="#fff"/></svg>`,
  'fx.bubbles': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="r" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff8fc8"/><stop offset=".35" stop-color="#ffd36e"/><stop offset=".65" stop-color="#7fe0c8"/><stop offset="1" stop-color="#8fa6ff"/></linearGradient></defs><circle cx="24" cy="36" r="17" fill="rgba(255,255,255,.35)" stroke="url(#r)" stroke-width="4"/><circle cx="45" cy="18" r="10" fill="rgba(255,255,255,.35)" stroke="url(#r)" stroke-width="3.5"/><path d="M16 28 Q18 22 24 21" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M46 46 C46 40 54 40 54 46 C54 50 50 53 46 56 C42 53 38 50 38 46 C38 40 46 40 46 46 Z" fill="#ff6fa8" stroke="#fff" stroke-width="2"/></svg>`,
  'fx.gold': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff6c0"/><stop offset=".5" stop-color="#ffcf3a"/><stop offset="1" stop-color="#c88200"/></linearGradient></defs><g fill="url(#g)" stroke="#9a5a00" stroke-width="2"><polygon points="18,10 26,14 26,24 18,28 10,24 10,14"/><polygon points="44,30 50,33 50,41 44,44 38,41 38,33"/><circle cx="22" cy="46" r="7"/><circle cx="48" cy="12" r="5"/></g><path d="M34 22 Q34 30 42 30 Q34 30 34 38 Q34 30 26 30 Q34 30 34 22 Z" fill="#fff"/></svg>`,
  'frame.jelly': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><radialGradient id="j" cx=".38" cy=".32"><stop offset="0" stop-color="#ffd9ec"/><stop offset=".6" stop-color="#ff8fc0"/><stop offset="1" stop-color="#d9478c"/></radialGradient></defs><rect x="8" y="10" width="48" height="46" rx="16" fill="#b23a74"/><rect x="8" y="8" width="48" height="45" rx="16" fill="url(#j)"/><path d="M16 20 Q22 12 34 13" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" opacity=".9"/></svg>`,
  'frame.cookie': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><radialGradient id="c" cx=".4" cy=".35"><stop offset="0" stop-color="#f7d398"/><stop offset=".7" stop-color="#e0a456"/><stop offset="1" stop-color="#b8742c"/></radialGradient></defs><path d="M32 6 Q38 9 43 8 Q46 13 51 15 Q52 21 56 25 Q54 31 57 37 Q53 41 52 47 Q46 49 43 54 Q37 53 32 58 Q27 53 21 54 Q18 49 12 47 Q11 41 7 37 Q10 31 8 25 Q12 21 13 15 Q18 13 21 8 Q26 9 32 6 Z" fill="url(#c)" stroke="#9a5a1c" stroke-width="2.5"/><circle cx="32" cy="32" r="15" fill="#ffb6d5" stroke="#f07aab" stroke-width="2.5"/><g fill="#8a4a12"><circle cx="18" cy="22" r="2"/><circle cx="46" cy="20" r="2"/><circle cx="48" cy="44" r="2"/><circle cx="17" cy="44" r="2"/></g></svg>`,
  'frame.capsule': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9fd8ff"/><stop offset="1" stop-color="#3d8fe0"/></linearGradient></defs><path d="M8 33 A24 24 0 0 0 56 33 Z" fill="url(#b)" stroke="#2c6fb8" stroke-width="2.5"/><path d="M8 31 A24 24 0 0 1 56 31 Z" fill="rgba(235,246,255,.55)" stroke="#9fb9d6" stroke-width="2.5"/><rect x="6" y="29" width="52" height="5" rx="2.5" fill="#fff" stroke="#9fb9d6" stroke-width="1.5"/><path d="M16 22 Q20 12 32 11" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round"/></svg>`,
  'frame.petal': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g fill="#ffc8e0" stroke="#ef7aa8" stroke-width="2.5"><ellipse cx="32" cy="14" rx="11" ry="12"/><ellipse cx="49" cy="27" rx="11" ry="12"/><ellipse cx="43" cy="47" rx="11" ry="12"/><ellipse cx="21" cy="47" rx="11" ry="12"/><ellipse cx="15" cy="27" rx="11" ry="12"/></g><circle cx="32" cy="33" r="14" fill="#fff3f8" stroke="#ef7aa8" stroke-width="2.5"/></svg>`,
  'theme.macaron': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="4" y="4" width="56" height="56" rx="10" fill="#2b2560"/><g><rect x="6.5" y="6.5" width="17" height="17" rx="3" fill="#3d3680"/><rect x="23.5" y="6.5" width="17" height="17" rx="3" fill="#342e72"/><rect x="40.5" y="6.5" width="17" height="17" rx="3" fill="#3d3680"/><rect x="6.5" y="23.5" width="17" height="17" rx="3" fill="#342e72"/><rect x="23.5" y="23.5" width="17" height="17" rx="3" fill="#3d3680"/><rect x="40.5" y="23.5" width="17" height="17" rx="3" fill="#342e72"/><rect x="6.5" y="40.5" width="17" height="17" rx="3" fill="#3d3680"/><rect x="23.5" y="40.5" width="17" height="17" rx="3" fill="#342e72"/><rect x="40.5" y="40.5" width="17" height="17" rx="3" fill="#3d3680"/></g><circle cx="15" cy="15" r="4.5" fill="#ffc81a"/><circle cx="49" cy="32" r="4.5" fill="#5b8cff"/><circle cx="32" cy="49" r="4.5" fill="#ff3fb0"/></svg>`,
  'theme.claw': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="4" y="4" width="56" height="56" rx="12" fill="#ff8cc2" stroke="#d94b8f" stroke-width="3"/><rect x="11" y="11" width="42" height="42" rx="6" fill="#5c1e5a"/><g fill="#fff6a6" stroke="#e0a500" stroke-width="1.5"><circle cx="8" cy="20" r="3"/><circle cx="8" cy="32" r="3"/><circle cx="8" cy="44" r="3"/><circle cx="56" cy="20" r="3"/><circle cx="56" cy="32" r="3"/><circle cx="56" cy="44" r="3"/></g><path d="M32 12 V24 M26 30 Q26 24 32 24 Q38 24 38 30" stroke="#9aa3b5" stroke-width="3" fill="none" stroke-linecap="round"/></svg>`,
  'theme.picnic': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="4" y="4" width="56" height="56" rx="12" fill="#e8be7c" stroke="#c08a45" stroke-width="3"/><rect x="10" y="10" width="44" height="44" rx="6" fill="#fff"/><g fill="rgba(235,70,90,.45)"><rect x="10" y="10" width="44" height="7"/><rect x="10" y="24" width="44" height="7"/><rect x="10" y="38" width="44" height="7"/><rect x="10" y="10" width="7" height="44"/><rect x="24" y="10" width="7" height="44"/><rect x="38" y="10" width="7" height="44"/></g><path d="M44 40 Q52 40 52 48 Q50 56 44 58 Q38 56 36 48 Q36 40 44 40 Z" fill="#ff4d6a" stroke="#c22a45" stroke-width="2"/><path d="M40 40 L44 36 L48 40" fill="#4cbf6a"/></svg>`,
  'theme.galaxy': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a2c84"/><stop offset="1" stop-color="#16103e"/></linearGradient></defs><rect x="4" y="4" width="56" height="56" rx="12" fill="#5440a8" stroke="#2c1f6e" stroke-width="3"/><rect x="10" y="10" width="44" height="44" rx="6" fill="url(#s)"/><g fill="#fff"><circle cx="18" cy="18" r="1.6"/><circle cx="44" cy="16" r="1.2"/><circle cx="30" cy="40" r="1.4"/><circle cx="48" cy="44" r="1.8"/><circle cx="20" cy="46" r="1"/></g><path d="M36 22 Q36 30 44 30 Q36 30 36 38 Q36 30 28 30 Q36 30 36 22 Z" fill="#ffe9a0"/></svg>`,
};
export const svgUrl = svg => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
// 新品項的小圖示（產生出來的；viewBox 64）
const svg64 = body => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${GRAD}${body}</svg>`;
const drop = (x, y, r, f, s, w) => S(`M${x} ${y - r * 1.7} C${x + r * 0.4} ${y - r * 0.9} ${x + r} ${y - r * 0.2} ${x + r} ${y + r * 0.35} A${r} ${r} 0 0 1 ${x - r} ${y + r * 0.35} C${x - r} ${y - r * 0.2} ${x - r * 0.4} ${y - r * 0.9} ${x} ${y - r * 1.7} Z`, f, s, w);
function themeIcon(frame, edge, a, b, extra) {
  let cells = '';
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) cells += `<rect x="${(11 + c * 14).toFixed(1)}" y="${(11 + r * 14).toFixed(1)}" width="14" height="14" rx="3" fill="${(r + c) % 2 ? b : a}"/>`;
  return svg64(`<rect x="4" y="4" width="56" height="56" rx="12" fill="${frame}" stroke="${edge}" stroke-width="3"/><rect x="10" y="10" width="44" height="44" rx="6" fill="${a}"/>${cells}${extra}`);
}
const NEW_ICON = {
  'fx.confetti': svg64([[10, 12, 18, '#ff6f9f'], [36, 8, -24, '#ffc21a'], [48, 26, 30, '#5b8ef0'], [18, 34, -12, '#63c94f'], [40, 44, 16, '#9a5cf0'], [12, 50, 36, '#ff9a2e'], [28, 22, 60, '#ff86bd']]
    .map(([x, y, a, f]) => `<rect x="${x}" y="${y}" width="12" height="7" rx="2" fill="${f}" stroke="#fff" stroke-width="1.5" transform="rotate(${a} ${x + 6} ${y + 3.5})"/>`).join('')),
  'fx.snow': svg64(flake(30, 34, 22, '#7fb4e6', 4.5) + flake(30, 34, 22, '#e8f4ff', 1.6) + flake(53, 12, 8, '#a9cdf0', 2.4)),
  'fx.notes': svg64(`<ellipse cx="16" cy="48" rx="8" ry="6" fill="#ff86bd" stroke="#b8155a" stroke-width="2.5" transform="rotate(-20 16 48)"/><ellipse cx="44" cy="42" rx="8" ry="6" fill="#5b8ef0" stroke="#1d3c80" stroke-width="2.5" transform="rotate(-20 44 42)"/>${L('M23 45 L23 14 M51 39 L51 8', '#3a2440', 3.5)}${S('M23 14 L51 8 L51 15 L23 21 Z', '#3a2440', '#3a2440', 2)}${star(10, 14, 5, '#ffd23c', '#e48a00', 1.2)}`),
  'fx.fish': svg64(`${S('M8 32 Q22 12 40 24 L54 14 Q50 32 54 50 L40 40 Q22 52 8 32 Z', 'url(#gO)', '#c85a00', 2.5)}${C(18, 29, 3, '#fff')}${C(18.5, 29, 1.6, '#3a2440')}${L('M28 24 Q32 32 28 40', '#c85a00', 2, 0.6)}${C(52, 8, 3.5, 'none', '#7fb4e6', 2)}${C(58, 18, 2.2, 'none', '#7fb4e6', 1.6)}`),
  'fx.fireworks': svg64(Array.from({ length: 12 }, (_, i) => { const a = i * Math.PI / 6, c = ['#ff6f9f', '#ffc21a', '#5b8ef0', '#63c94f'][i % 4]; return L(`M${(32 + 9 * Math.cos(a)).toFixed(1)} ${(30 + 9 * Math.sin(a)).toFixed(1)} L${(32 + 24 * Math.cos(a)).toFixed(1)} ${(30 + 24 * Math.sin(a)).toFixed(1)}`, c, 4) + C((32 + 28 * Math.cos(a)).toFixed(1), (30 + 28 * Math.sin(a)).toFixed(1), 2, c); }).join('') + star(32, 30, 6, '#fff6a8', '#e48a00', 1.2)),
  'fx.choco': svg64(`${S('M10 20 L24 12 L30 24 L18 32 Z', '#7a4a1f', '#4a2a10', 2)}${S('M36 30 L50 26 L54 40 L40 44 Z', '#93644f', '#4a2a10', 2)}${S('M14 42 L26 40 L28 52 L16 54 Z', '#5e3a28', '#3a1f0c', 2)}${[[40, 12, 30, '#ff86bd'], [48, 50, -30, '#fff'], [30, 40, 70, '#ffd23c'], [54, 18, -60, '#5b8ef0']].map(([x, y, a, f]) => `<rect x="${x - 5}" y="${y - 1.8}" width="10" height="3.6" rx="1.8" fill="${f}" stroke="#b8155a" stroke-width=".8" transform="rotate(${a} ${x} ${y})"/>`).join('')}`),
  'fx.rainbow': svg64(['#ff6f9f', '#ffc21a', '#63c94f', '#5b8ef0', '#9a5cf0'].map((c, i) => L(`M${8 + i * 4} 48 A${24 - i * 4} ${24 - i * 4} 0 0 1 ${56 - i * 4} 48`, c, 4.2)).join('') + C(12, 50, 6, '#fff', '#d6cdef', 1.5) + C(52, 50, 6, '#fff', '#d6cdef', 1.5)),
  'fx.rain': svg64(drop(20, 26, 8, '#8ec4ff', '#2c55b8', 2.5) + drop(44, 20, 6, '#bfe0ff', '#2c55b8', 2.2) + drop(40, 46, 7, '#8ec4ff', '#2c55b8', 2.5) + L('M17 24 Q17 20 20 18', '#fff', 2, 0.9) + C(14, 52, 3, 'none', '#7fb4e6', 1.6)),
  'frame.macaron': svg64(`<ellipse cx="32" cy="44" rx="24" ry="11" fill="url(#gK)" stroke="#b8155a" stroke-width="2.5"/><rect x="9" y="30" width="46" height="9" rx="4.5" fill="#fff8e6" stroke="#e6c99a" stroke-width="2"/><ellipse cx="32" cy="22" rx="24" ry="12" fill="url(#gK)" stroke="#b8155a" stroke-width="2.5"/>${L('M17 17 Q22 12 30 12', '#fff', 3.5, 0.9)}`),
  'frame.donut': svg64(`${C(32, 33, 24, '#e8b878', '#a8682a', 2.5)}${S('M32 11 Q40 10 46 15 Q52 18 53 26 Q56 34 51 41 Q47 50 38 52 Q30 55 22 50 Q13 46 12 37 Q9 28 15 20 Q22 11 32 11 Z', 'url(#gK)', '#b8155a', 2)}${C(32, 32, 8, '#fff', '#a8682a', 2.5)}${[[22, 20, 30, '#fff'], [44, 20, -40, '#ffd23c'], [46, 40, 20, '#5b8ef0'], [20, 42, -20, '#63c94f'], [32, 46, 80, '#fff']].map(([x, y, a, f]) => `<rect x="${x - 3.5}" y="${y - 1.3}" width="7" height="2.6" rx="1.3" fill="${f}" transform="rotate(${a} ${x} ${y})"/>`).join('')}`),
  'frame.cloud': svg64(`<g fill="url(#gW)" stroke="#b9aedb" stroke-width="2.5">${C(18, 38, 13)}${C(33, 27, 17)}${C(48, 36, 13)}<rect x="12" y="34" width="42" height="17" rx="8.5"/></g><g fill="url(#gW)">${C(18, 38, 11.8)}${C(33, 27, 15.8)}${C(48, 36, 11.8)}<rect x="13.2" y="35" width="39.6" height="14.8" rx="7.4"/></g>${L('M24 22 Q28 15 36 14', '#fff', 3.5, 0.9)}`),
  'frame.gear': svg64(`<defs>${lg('gS', [[0, '#f4f6fa'], [0.5, '#b9c2d0'], [1, '#7d889c']])}</defs>${S(gearPath(32, 32, 28, 22, 10), 'url(#gS)', '#5c667a', 2.5)}${C(32, 32, 13, '#ff86bd', '#b8155a', 2.5)}${C(32, 32, 4, '#fff')}`),
  'frame.gift': svg64(`<rect x="10" y="26" width="44" height="30" rx="5" fill="url(#gK)" stroke="#b8155a" stroke-width="2.5"/><rect x="7" y="18" width="50" height="11" rx="4" fill="url(#gK)" stroke="#b8155a" stroke-width="2.5"/><rect x="28" y="18" width="8" height="38" fill="url(#gY)" stroke="#9a5200" stroke-width="2"/>${S('M32 18 C22 6 12 10 18 17 Q24 21 32 18 Z', 'url(#gY)', '#9a5200', 2)}${S('M32 18 C42 6 52 10 46 17 Q40 21 32 18 Z', 'url(#gY)', '#9a5200', 2)}`),
  // 七種新形狀：星星、水滴、三角排在一起（果凍色＋反光）
  'frame.shape7': svg64(`${star(21, 23, 15, 'url(#gY)', '#c87800', 2.4)}${drop(46, 24, 9.5, 'url(#gB)', '#2c55b8', 2.4)}${S('M32 33 Q34 30 36 33 L49 54 Q50 57 47 57 L17 57 Q14 57 15 54 Z', 'url(#gK)', '#b8155a', 2.4)}${L('M15 18 Q17 14 21 13', '#fff', 2.6, 0.9)}${L('M41 20 Q42 17 45 16', '#fff', 2.2, 0.9)}${L('M27 49 L31 42', '#fff', 2.4, 0.85)}`),
  // 不要底座：虛線格子＋格子裡直接放一隻小玩偶（沒有底座）
  'frame.none': svg64(`<rect x="6" y="6" width="52" height="52" rx="10" fill="none" stroke="#c9b7d8" stroke-width="3" stroke-dasharray="6 5" stroke-linecap="round"/><ellipse cx="34" cy="50" rx="13" ry="3.2" fill="#8b6fa8" opacity=".22"/>${C(21, 19, 6, '#f2c9a0', '#9a6a3c', 2)}${C(43, 19, 6, '#f2c9a0', '#9a6a3c', 2)}${C(32, 32, 15, '#f2c9a0', '#9a6a3c', 2.2)}${C(21, 19, 2.6, '#ff9ec4')}${C(43, 19, 2.6, '#ff9ec4')}<ellipse cx="32" cy="37" rx="6.5" ry="5" fill="#fff4e6"/>${C(26, 30, 2, '#3a2440')}${C(38, 30, 2, '#3a2440')}${C(32, 35, 1.8, '#3a2440')}${C(22, 36, 2.6, '#ff9ec4')}${C(42, 36, 2.6, '#ff9ec4')}`),
  'frame.gold': svg64(`${C(32, 32, 23, '#ff86bd', '#9a5200', 2)}<circle cx="32" cy="32" r="23" fill="none" stroke="url(#gY)" stroke-width="9"/>${C(32, 32, 27.5, 'none', '#9a5200', 2)}${C(32, 32, 18.5, 'none', '#9a5200', 1.6)}${star(32, 32, 9, '#fff6a8', '#e48a00', 1.2)}${L('M14 22 Q18 14 26 11', '#fff', 3, 0.85)}`),
  'theme.dock': themeIcon('#8fd3ef', '#3f8fb8', '#fff8e6', '#dff3fb', `<ellipse cx="32" cy="30" rx="8" ry="10" fill="#fff" stroke="#d4a24a" stroke-width="2.5"/>${L('M12 48 Q17 44 22 48 T32 48 T42 48 T52 48', '#3f8fb8', 3)}`),
  'theme.park': themeIcon('#ffb3cf', '#d9558c', '#fff4f8', '#e3f4d8', `${C(32, 30, 12, 'none', '#ff6fa8', 3)}${L('M32 18 L32 42 M20 30 L44 30 M23.5 21.5 L40.5 38.5 M40.5 21.5 L23.5 38.5', '#ff6fa8', 1.6)}${[[32, 18], [44, 30], [32, 42], [20, 30]].map(([x, y]) => C(x, y, 3, '#ffd23c', '#e48a00', 1)).join('')}${L('M26 50 L32 30 L38 50', '#d9558c', 2.5)}`),
  'theme.snow': themeIcon('#cfe0f0', '#7d9cc0', '#ffffff', '#e8f1fa', flake(32, 32, 13, '#7fb4e6', 3)),
  'theme.sea': themeIcon('#5a98d2', '#2c5a94', '#bfe8f7', '#a5dcf2', `${S('M18 32 Q26 22 36 29 L44 23 L44 41 L36 35 Q26 42 18 32 Z', 'url(#gO)', '#c85a00', 2)}${C(23, 30, 1.6, '#3a2440')}${C(44, 16, 2.6, 'none', '#fff', 1.6)}${C(48, 48, 2, 'none', '#fff', 1.4)}`),
  'theme.choco': themeIcon('#93644f', '#5e3a28', '#ecd0ba', '#ffe3ee', `<rect x="19" y="20" width="26" height="24" rx="3" fill="#7a4a1f" stroke="#4a2a10" stroke-width="2"/>${L('M32 20 L32 44 M19 28 L45 28 M19 36 L45 36', '#4a2a10', 1.6)}${S('M37 20 L45 20 L45 30 Q40 26 37 20 Z', '#fff', '#a9a2bf', 1)}`),
  'theme.dream': themeIcon('#c9b5f5', '#8a6fd0', '#fff1f6', '#e2f1ff', `${star(26, 26, 9, '#ffd23c', '#e48a00', 1.4)}${S('M40 44 C30 37 30 30 34 28 C37 26 40 29 40 31 C40 29 43 26 46 28 C50 30 50 37 40 44 Z', '#ff86bd', '#b8155a', 1.6)}`),
  'theme.bamboo': themeIcon('#8fc48a', '#4c8a48', '#eef8e8', '#d8edcc', `<rect x="24" y="12" width="8" height="40" rx="3" fill="#63c94f" stroke="#2f8a2a" stroke-width="2"/>${L('M24 24 L32 24 M24 38 L32 38', '#2f8a2a', 2)}${S('M32 22 Q44 14 50 20 Q42 26 32 22 Z', '#63c94f', '#2f8a2a', 1.6)}${S('M32 36 Q42 32 46 38 Q40 42 32 36 Z', '#63c94f', '#2f8a2a', 1.6)}`),
  'theme.lantern': themeIcon('#5e4f80', '#2f2550', '#43386a', '#4e4278', `${L('M32 12 L32 18', '#ffd23c', 2)}<ellipse cx="32" cy="32" rx="12" ry="14" fill="url(#gR)" stroke="#8f1d1d" stroke-width="2"/>${L('M26 20 Q22 32 26 44 M38 20 Q42 32 38 44 M32 18 L32 46', '#8f1d1d', 1.2, 0.6)}<rect x="27" y="16" width="10" height="4" rx="1.5" fill="#ffd23c"/><rect x="27" y="44" width="10" height="4" rx="1.5" fill="#ffd23c"/>${L('M32 48 L32 54', '#ffd23c', 2)}`),
  'theme.icecream': themeIcon('#ffc6d8', '#e0779c', '#fff8f0', '#e6f6f0', `${S('M23 30 L32 54 L41 30 Z', '#e8b878', '#a8682a', 2)}${L('M26 36 L36 46 M38 36 L29 46', '#a8682a', 1.2, 0.7)}${C(28, 26, 7, '#ffd0e6', '#f0468f', 2)}${C(36, 26, 7, '#d9ffc8', '#2f8a2a', 2)}${C(32, 19, 6.5, '#fff8c4', '#e48a00', 2)}`),
  'theme.moon': themeIcon('#4a5596', '#262b66', '#33397a', '#3d4488', `${S('M36 14 A15 15 0 1 0 46 40 A12 12 0 1 1 36 14 Z', 'url(#gY)', '#9a5200', 1.8)}${star(46, 20, 3.5, '#fff6a8')}${star(20, 46, 2.6, '#fff6a8')}`),
  'theme.castle': themeIcon('#d9cff5', '#8f7fc8', '#f5f0ff', '#fff4e6', `<g fill="#fff" stroke="#8f7fc8" stroke-width="2"><rect x="18" y="28" width="28" height="20"/><rect x="15" y="20" width="9" height="28"/><rect x="40" y="20" width="9" height="28"/></g>${S('M14 21 L19.5 12 L25 21 Z', '#ff86bd', '#b8155a', 1.4)}${S('M39 21 L44.5 12 L50 21 Z', '#ff86bd', '#b8155a', 1.4)}${S('M28 48 L28 40 Q32 35 36 40 L36 48 Z', '#9a5cf0', '#5b2bb0', 1.4)}${C(12, 52, 5, '#fff', '#d6cdef', 1.2)}${C(52, 52, 5, '#fff', '#d6cdef', 1.2)}`),
  // 半透明：後面有彩色的色塊，上面蓋一層白色半透明的格子和白邊
  'theme.glass': svg64(`<rect x="6" y="6" width="52" height="52" rx="12" fill="#b9a6e6"/>${C(18, 20, 13, '#ff86bd')}${C(46, 22, 11, '#ffd23c')}${C(40, 46, 13, '#5b8ef0')}${C(16, 48, 9, '#63c94f')}<rect x="6" y="6" width="52" height="52" rx="12" fill="rgba(255,255,255,.3)" stroke="rgba(255,255,255,.95)" stroke-width="4"/><rect x="11" y="11" width="14" height="14" rx="3" fill="rgba(255,255,255,0.12)"/><rect x="25" y="11" width="14" height="14" rx="3" fill="rgba(255,255,255,0.26)"/><rect x="39" y="11" width="14" height="14" rx="3" fill="rgba(255,255,255,0.12)"/><rect x="11" y="25" width="14" height="14" rx="3" fill="rgba(255,255,255,0.26)"/><rect x="25" y="25" width="14" height="14" rx="3" fill="rgba(255,255,255,0.12)"/><rect x="39" y="25" width="14" height="14" rx="3" fill="rgba(255,255,255,0.26)"/><rect x="11" y="39" width="14" height="14" rx="3" fill="rgba(255,255,255,0.12)"/><rect x="25" y="39" width="14" height="14" rx="3" fill="rgba(255,255,255,0.26)"/><rect x="39" y="39" width="14" height="14" rx="3" fill="rgba(255,255,255,0.12)"/>${L('M14 16 Q18 11 26 10', '#fff', 2.6, 0.9)}`),
};

// ---------- 玩偶造型（畫在地圖左下角頭像、衣櫃預覽、陪玩）----------
// 座標：0–100 對齊薯餅照片的方框；back 畫在薯餅後面（披風），front 畫在前面。SVG 的 viewBox 是 -6 -6 112 112，比方框大一點，裝飾可以稍微超出去
// 太空頭盔（11/24 換新）：帽子（兜帽＋面罩＋耳罩＋天線）和胸前面板分開畫，對位時兩塊各自移動
const HELM = {
  hood: S('M23.5 41 Q20 3.5 50 3.5 Q80 3.5 76.5 41 L69.5 41 Q71 22.5 50 22 Q29 22.5 30.5 41 Z', 'url(#gW)', WS, 1.6) + L('M27 36 Q26 26 29 19', '#5b8ef0', 2.2, 0.85) + L('M73 36 Q74 26 71 19', '#5b8ef0', 2.2, 0.85),
  visor: S('M29.5 21.5 Q30 9 50 8.5 Q70 9 70.5 21.5 Q50 15.5 29.5 21.5 Z', 'url(#gV)', '#3d7fc4', 1.3) + L('M35 15 Q40 11.6 47 11', '#fff', 1.6, 0.9) + C(61, 12.5, 1, '#fff').replace('/>', ' opacity=".8"/>'),
  ears: [24.5, 75.5].map(x => C(x, 35, 5.6, 'url(#gB)', '#2c55b8', 1.3) + C(x, 35, 2.8, '#e6f1ff', '#2c55b8', 0.7)).join(''),
  ant: L('M68 12 L74.5 4', '#8b86a6', 1.6) + C(75, 3.3, 2.4, 'url(#gR)', '#8f1d1d', 1) + C(74.3, 2.5, 0.7, '#fff'),
  panel: S('M38.5 57 Q38.5 53.5 42 53.5 L58 53.5 Q61.5 53.5 61.5 57 L61.5 66.5 Q61.5 70 58 70 L42 70 Q38.5 70 38.5 66.5 Z', 'url(#gW)', WS, 1.4) + C(44, 59, 2, 'url(#gR)', '#8f1d1d', 0.7) + C(50, 59, 2, 'url(#gY)', '#9a5200', 0.7) + C(56, 59, 2, 'url(#gB)', '#1d3c80', 0.7) + L('M43 65 L57 65', '#8b86a6', 1.8, 0.6),
};
export const OUTFITS = {
  none: { back: '', front: '' },
  sailor: { back: '', front: S('M33 21 Q33 7 50 7 Q67 7 67 21 Z', 'url(#gW)', WS) + L('M34 18 Q50 12 66 18', '#2c55b8', 2.6) + S('M27 22 Q50 14 73 22 Q74 27.5 50 24.5 Q26 27.5 27 22 Z', 'url(#gW)', WS) + L('M39 11 Q43 9 47 9', '#fff', 1.6, 0.9) + S('M34 50.5 Q50 56 66 50.5 L52 69 Q50 71 48 69 Z', 'url(#gB)', '#1d3c80') + L('M38.5 53.5 Q50 58.5 61.5 53.5', '#fff', 1.3, 0.9) + C(50, 56.5, 3.3, 'url(#gR)', '#8f1d1d', 1.2) },
  snow: { back: '', front: S('M30 24 Q30 6 50 6 Q70 6 70 24 Z', 'url(#gR)', '#8f1d1d') + L('M40 9 L39 20 M50 7 L50 20 M60 9 L61 20', '#fff', 1.2, 0.45) + S('M28.5 19 L71.5 19 Q73 22.7 71.5 26.5 L28.5 26.5 Q27 22.7 28.5 19 Z', 'url(#gW)', WS, 1.5) + C(50, 5.2, 5, 'url(#gW)', WS, 1.5) + S('M29 49 Q50 58 71 49 L72 56 Q50 66 28 56 Z', 'url(#gR)', '#8f1d1d') + L('M36 53 L37 59.5 M46 55.5 L46.5 62 M56 55.3 L56 61.7 M64 52.5 L64.5 58.7', '#fff', 2, 0.85) + S('M59 57 L67 74 L60 76 L54 59 Z', 'url(#gR)', '#8f1d1d') + L('M60.5 76 L60 79 M63.3 75.2 L63.3 78.2 M66 74.2 L66.6 77', '#8f1d1d', 1.2) },
  night: { back: '', front: S('M31 23 Q32 5 55 6 Q75 7 85 24 Q76 17 68 15 Q70 19 69 23 Z', 'url(#gB)', '#1d3c80') + star(45, 13, 2.6, '#fff6a8') + star(58, 10, 2, '#fff6a8') + star(73, 15, 1.8, '#fff6a8') + star(62, 19, 1.5, '#fff6a8') + S('M29 21 Q50 15 71 21 L71 27 Q50 21 29 27 Z', 'url(#gW)', WS, 1.5) + C(86, 26, 4.5, 'url(#gY)', '#9a5200', 1.4) + '<text x="17" y="17" font-size="9" font-weight="900" fill="#5b8ef0" stroke="#fff" stroke-width="2" paint-order="stroke" font-family="system-ui,sans-serif">z</text><text x="10" y="9" font-size="6.5" font-weight="900" fill="#5b8ef0" stroke="#fff" stroke-width="1.6" paint-order="stroke" font-family="system-ui,sans-serif">z</text>' },
  party: { back: '', front: S('M39 21 L50 2 L61 21 Q50 24 39 21 Z', 'url(#gK)', '#b8155a') + L('M45.5 12 L53.5 9.5 M42 18.5 L57.5 14', '#fff', 2, 0.8) + C(47, 16.5, 1.3, '#ffd23c') + C(54, 18.6, 1.3, '#5b8ef0') + C(51, 11.5, 1.1, '#63c94f') + C(50, 3, 3.5, 'url(#gY)', '#9a5200', 1.3) + S('M50 54 L38.5 48.5 Q36.5 54 38.5 59.5 Z', 'url(#gB)', '#1d3c80') + S('M50 54 L61.5 48.5 Q63.5 54 61.5 59.5 Z', 'url(#gB)', '#1d3c80') + C(50, 54, 3, 'url(#gB)', '#1d3c80', 1.4) + C(42, 52, 1.1, '#fff') + C(58.5, 56, 1.1, '#fff') + C(41.5, 56.5, 1, '#fff') + C(58, 51.5, 1, '#fff') },
  berry: { back: '', front: S('M29 24 Q28 5 50 5 Q72 5 71 24 Q50 19 29 24 Z', 'url(#gR)', '#8f1d1d') + [[38, 13], [46, 10], [55, 10.5], [63, 14], [42, 18.5], [51, 16], [59, 19], [34, 19.5], [66, 20]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="1.1" ry="1.6" fill="#ffe27a"/>`).join('') + S('M37 8.5 L42.5 2.5 L46.5 7 L50 0.8 L53.5 7 L57.5 2.5 L63 8.5 Q50 12.5 37 8.5 Z', 'url(#gG)', '#1f6a1f', 1.4) + L('M35 12 Q38 9 41 9', '#fff', 1.5, 0.7) },
  space: { back: '', front: '', head: HELM.hood + HELM.visor + HELM.ears + HELM.ant, body: HELM.panel, defs: '<defs>' + lg('gV', [[0, '#d9f3ff'], [0.5, '#8fd0f7'], [1, '#4b97d6']]) + '</defs>' },   // 帽子、胸前面板分開對位
  detective: { back: '', front: S('M31 22 Q31 7 50 7 Q69 7 69 22 Z', 'url(#gN)', '#5a3412') + L('M40 9 L40 21 M50 7 L50 21 M60 9 L60 21 M32 14 L68 14', '#5a3412', 1, 0.35) + S('M29 21 Q50 16.5 71 21 Q67 27.5 50 26 Q33 27.5 29 21 Z', 'url(#gN)', '#5a3412') + C(50, 7.2, 1.8, '#7a4a1f') + L('M13 65 L20 75', '#7a4a1f', 3.2) + C(9.5, 58.5, 7, 'url(#gGlass)', '#e4a400', 2.6) + L('M6 55 Q8 53 10.5 53', '#fff', 1.4, 0.9) },
  chef: { back: '', front: S('M37 58.5 Q50 55.5 63 58.5 L66 85 Q50 90.5 34 85 Z', 'url(#gW)', '#a9a2bf') + L('M38.5 58.8 L36.5 51.5 M61.5 58.8 L63.5 51.5', '#a9a2bf', 1.6) + S('M50 76 Q44 71 46 68 Q48 66 50 68.5 Q52 66 54 68 Q56 71 50 76 Z', 'url(#gK)', '#b8155a', 1.2) + S('M35.5 22 L36.5 15 Q50 13 63.5 15 L64.5 22 Q50 24 35.5 22 Z', 'url(#gW)', '#a9a2bf') + S('M36.5 16 Q28 10.5 34 4.5 Q38.5 -0.5 45 2.3 Q50 -1.8 55.5 2.3 Q62 -0.5 66 4.5 Q72 10.5 63.5 16 Z', 'url(#gW)', '#a9a2bf') + L('M40 8 Q42 5 45 5', '#fff', 1.6, 0.9) },
  wizard: { back: '', front: '<ellipse cx="50" cy="21" rx="26" ry="5.5" fill="url(#gP)" stroke="#3e1a80" stroke-width="1.6"/>' + S('M36 20 Q42 10 47 3 Q53 -1.5 58.5 4 Q55 5.5 55.5 9 Q60 15 64 20 Q50 23 36 20 Z', 'url(#gP)', '#3e1a80') + L('M37.5 17.5 Q50 21 62.5 17.5', '#ffd23c', 2.6) + star(51, 11, 3.4, '#ffe36e', '#9a5200', 0.8) + L('M86 72 L94 51', '#7a4a1f', 2.6) + star(94.5, 47, 5.5, 'url(#gY)', '#9a5200', 1.3) + C(86, 44, 1, '#fff') + C(98, 57, 0.9, '#fff') },
  king: {
    back: S('M24 46 Q50 38 76 46 L92 90 Q50 99 8 90 Z', 'url(#gR)', '#8f1d1d', 1.8) + L('M30 52 L18 86', '#fff', 1.6, 0.35),
    front: S('M28 48 Q50 58 72 48 Q74 56 50 64 Q26 56 28 48 Z', 'url(#gW)', '#a9a2bf') + [[36, 54], [44, 58], [56, 58], [64, 54], [50, 60.5]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="1" ry="1.6" fill="#3a2440"/>`).join('') + S('M35 21 L33 8 L42 14 L50 3 L58 14 L67 8 L65 21 Z', 'url(#gY)', '#9a5200') + C(50, 16, 2.3, 'url(#gR)', '#8f1d1d', 0.9) + C(41, 17.5, 1.5, '#5b8ef0') + C(59, 17.5, 1.5, '#63c94f') + L('M37 18 L36 11', '#fff', 1.6, 0.75),
  },
  pumpkin: { back: '', front: S('M30 23 Q28 6 50 6 Q72 6 70 23 Q50 18 30 23 Z', 'url(#gO)', '#8a3a00') + L('M40 8 Q36.5 15 38.5 21 M50 6.5 L50 19 M60 8 Q63.5 15 61.5 21', '#c85a00', 1.3, 0.75) + S('M48 7 Q47 1 52 -1 L54 1 Q51 3 52 7 Z', 'url(#gN)', '#5a3412', 1.2) + S('M53 3 Q60 -3.5 66 1.5 Q60 7 53 3 Z', 'url(#gG)', '#1f6a1f', 1.2) + L('M35 14 Q38 9 43 8', '#fff', 1.5, 0.7) + S('M39 52 Q50 57 61 52 L57 60 Q50 63 43 60 Z', 'url(#gO)', '#8a3a00', 1.3) + star(50, 57.5, 2.2, '#fff6a8') },
  dino: { back: '', front: S('M35 10 L37 0.5 L43 6 Z', 'url(#gY)', '#9a5200', 1.2) + S('M45 5 L50 -4 L55 5 Z', 'url(#gY)', '#9a5200', 1.2) + S('M57 6 L63 0.5 L65 10 Z', 'url(#gY)', '#9a5200', 1.2) + S('M27 26 Q26 4 50 4 Q74 4 73 26 Q50 20 27 26 Z', 'url(#gG)', '#1f6a1f') + C(41, 11, 1.6, '#1f6a1f') + C(59, 11, 1.6, '#1f6a1f') + L('M33 14 Q36 8 42 7', '#fff', 1.5, 0.7) + [33, 39, 45, 55, 61, 67].map(x => S(`M${x - 2.4} ${x < 50 ? 23.6 + (50 - x) * 0.04 : 23.6 + (x - 50) * 0.04} L${x} 28 L${x + 2.4} ${x < 50 ? 23.2 + (50 - x) * 0.04 : 23.2 + (x - 50) * 0.04} Z`, '#fff', '#1f6a1f', 0.9)).join('') },
  painter: { back: '', front: L('M50 6 L51 1.5', '#8f1d1d', 2.6) + S('M28 20 Q24 8 46 6 Q70 5 74 15 Q74 22 62 22 Q45 25 28 20 Z', 'url(#gR)', '#8f1d1d') + L('M33 13 Q38 8 46 8', '#fff', 1.5, 0.75) + S('M4 64 Q3 55 13.5 55 Q24 55 24 63 Q24 68 19 67 Q15 66 15 70 Q15 74 10 73 Q4 71 4 64 Z', '#f3d9b5', '#7a4a1f', 1.4) + C(8.5, 61, 1.9, '#ff5a5a') + C(13.5, 58.5, 1.9, '#ffd23c') + C(19, 60, 1.9, '#5b8ef0') + C(9.5, 67, 1.9, '#63c94f') + L('M22 76 L31.5 61', '#7a4a1f', 2.2) + S('M30.6 62.4 L33.8 56.5 L34.6 60.6 Z', '#ff86bd', '#b8155a', 0.9) },
};
// ---------- 角色對位表：別隻玩偶穿薯餅的造型 ----------
// 造型是照薯餅畫的。穿在玩偶身上時，y < split 的部分（帽子）和下面的部分（領子、披風、道具）各自位移縮放，
// 對到那隻玩偶的頭頂和身體。head、body 可以是 transform 字串，或 { x, y, s, r, w }（造型對齊台存下來的數值）：
//   以帽子中心 (50, 24)、衣服中心 (50, 60) 為準，往右 x、往下 y、放大 s 倍、轉 r 度、寬度再乘 w。
// 沒寫 head 也沒寫 body 的造型照原圖畫。per 裡個別調；all = 整套用同一個 transform（不切上下）。
// 帽子和衣服分開畫的造型（OUTFITS 裡有 head、body，例如太空頭盔）不切上下，兩塊各自套 head、body。
// skip：怎麼調都怪、先不穿的造型（衣櫃預覽會出「蛋黃哥這套還在做」）
export const OUTFIT_FIT = {
  sloth: {
    split: 36,
    per: {   // 造型對齊台（11/24）的數值；沒寫的那一半照原圖
      sailor: { head: { x: 3, y: -8.5, s: 1, r: -5 }, body: { x: 6.5, y: -2.5, s: 1, r: -5 } },
      night: { head: { x: 3, y: -7.5, s: 1, r: -5 } },
      party: { head: { x: 1, y: -6.5, s: 0.88, r: -10 }, body: { x: 7.5, y: -0.5, s: 1, r: -10 } },
      berry: { head: { x: 2.5, y: -4.5, s: 1, r: -5 } },
      snow: { head: { x: 3, y: -6, s: 1, r: -5 }, body: { x: 7.5, y: 1, s: 1, r: -5 } },
      space: { head: { x: 3.5, y: -4, s: 1, r: -5, w: 1.08 }, body: { x: 6.5, y: 0, s: 1, r: -5 } },
      detective: { head: { x: 3, y: -2, s: 1, r: -10 }, body: { x: 1, y: -0.5, s: 1, r: 0 } },
      chef: { head: { x: 1.5, y: -6, s: 0.92, r: -10 }, body: { x: 6, y: -3, s: 1.02, r: -5 } },
      pumpkin: { head: { x: 2, y: -4.5, s: 1, r: -10 }, body: { x: 7, y: -1, s: 1, r: -5 } },
      wizard: { head: { x: 1.5, y: -7, s: 0.9, r: -10 }, body: { x: 3, y: 4, s: 1, r: 0 } },
      king: { head: { x: 0, y: -4.5, s: 1, r: -10 }, body: { x: 7.5, y: -1, s: 1, r: -5 } },
      dino: { head: { x: 3, y: 0, s: 1, r: -10 } },   // 恐龍下半身沒有圖，衣服的值不套
      painter: { head: { x: 2, y: 3, s: 1, r: -10 } },
    },
    skip: [],
  },
  egg: {
    split: 36,
    head: 'translate(50 21) scale(1.12) translate(-50 -24)',
    body: 'translate(0 -2)',
    per: {   // 造型對齊台（11/24）的數值；沒寫 body 的照上面的 body（往上 2）
      sailor: { head: { x: 8.5, y: -18, s: 0.66, r: 0 }, body: { x: 6, y: 0, s: 1, r: 0 } },
      night: { head: { x: 8, y: -13, s: 0.82, r: 0 } },
      party: { head: { x: -5.5, y: -14.5, s: 0.62, r: -30 } },
      berry: { head: { x: 8.5, y: -12.5, s: 0.7, r: 0 } },
      snow: { head: { x: 7, y: -14, s: 0.6, r: 0 }, body: { x: 8, y: -2, s: 1, r: 0 } },
      space: { head: { x: 7, y: -13.5, s: 0.7, r: 0, w: 1.7 }, body: { x: 6.5, y: 6.5, s: 1.1, r: 0 } },
      detective: { head: { x: 8, y: -18.5, s: 0.61, r: 0 }, body: { x: 8, y: -16.5, s: 1, r: 0 } },
      chef: { head: { x: 7.5, y: -14, s: 0.63, r: 0 }, body: { x: 8, y: -6, s: 1.45, r: 0 } },
      pumpkin: { head: { x: 7.5, y: -17, s: 0.55, r: 0 }, body: { x: 7, y: 1.5, s: 1, r: 0 } },
      wizard: { head: { x: 7, y: -18, s: 0.5, r: 0 } },
      king: { head: { x: 6.5, y: -17, s: 0.55, r: 0 }, body: { x: 6, y: 1, s: 1, r: 0 } },
      dino: { head: { x: 29, y: -13.5, s: 0.5, r: 39 } },   // 恐龍下半身沒有圖，衣服的值不套
      painter: { head: { x: 7, y: -15.5, s: 0.5, r: 0 } },
    },
    skip: [],
  },
};
const outfitKey = id => String(id || '').replace(/^outfit\./, '');
export const outfitSkipped = (id, who) => { const f = OUTFIT_FIT[who]; return !!(f && f.skip.includes(outfitKey(id))); };
const r2 = n => Math.round(n * 100) / 100;
// 對齊台的換算：translate(50+x, 中心+y) rotate(r) scale(s*w, s) translate(-50, -中心)
function fitTf(v, py) {
  if (typeof v === 'string') return v;
  const s = v.s == null ? 1 : v.s, w = v.w == null ? 1 : v.w;
  return `translate(${r2(50 + (v.x || 0))} ${r2(py + (v.y || 0))})${v.r ? ` rotate(${r2(v.r)})` : ''} scale(${r2(s * w)} ${r2(s)}) translate(-50 -${py})`;
}
const wrap = (v, py, inner) => v ? `<g transform="${fitTf(v, py)}">${inner}</g>` : inner;
function fitBody(body, k, who) {
  const f = OUTFIT_FIT[who];
  if (!f) return body;
  const p = Object.assign({ head: f.head, body: f.body }, f.per[k]);
  if (p.all) return wrap(p.all, 35, body);
  if (!p.head && !p.body) return body;
  const sp = p.split || f.split;
  return `<clipPath id="fu"><rect x="-60" y="-60" width="220" height="${sp + 60}"/></clipPath><clipPath id="fd"><rect x="-60" y="${sp}" width="220" height="${160 - sp}"/></clipPath>`
    + wrap(p.head, 24, `<g clip-path="url(#fu)">${body}</g>`) + wrap(p.body, 60, `<g clip-path="url(#fd)">${body}</g>`);
}
// 帽子、衣服分開畫的造型：front 畫兩塊（各自對位），back 照常
function fitParts(o, k, who) {
  const f = OUTFIT_FIT[who], p = (f && f.per[k]) || {};
  return wrap(p.head, 24, o.head || '') + wrap(p.body, 60, o.body || '');
}
// who：'sloth'（預設）或 'egg'；SVG 各自是一張圖，clipPath 的 id 不會跟別張撞
export function outfitSvg(id, layer, who = 'sloth') {
  const k = outfitKey(id), o = OUTFITS[k];
  if (!o || outfitSkipped(k, who)) return '';
  if (layer === 'front' && (o.head || o.body)) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-6 -6 112 112">${GRAD}${o.defs || ''}${fitParts(o, k, who)}</svg>`;
  const body = o[layer];
  if (!body) return '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-6 -6 112 112">${GRAD}${o.defs || ''}${fitBody(body, k, who)}</svg>`;
}

// ---------- 頭像外圈（地圖左下角頭像外面那一圈）----------
// ring：外圈的 CSS 底色；sh：外圈下面的厚度；deco：稍微超出圓圈的裝飾（viewBox 0 0 72 72，對齊頭像外面多 10px 的方框）
export const RINGS = {
  pink: { ring: '#ff6fb0', sh: '#c42a74', deco: '' },
  cloud: { ring: 'linear-gradient(#ffffff,#d9d1f0)', sh: '#b9aedb', deco: [[8, 52, 7], [16, 62, 7], [64, 52, 7], [56, 62, 7], [36, 66, 6]].map(([x, y, r]) => C(x, y, r, '#fff', '#d6cdef', 1.2)).join('') },
  star: { ring: 'radial-gradient(#fff3a6,#ffc21a)', sh: '#b86e00', deco: star(10, 12, 6, 'url(#gY)', '#9a5200', 1.2) + star(63, 58, 5, 'url(#gY)', '#9a5200', 1.2) + star(64, 14, 3.5, '#fff3a6', '#9a5200', 0.9) },
  rainbow: { ring: 'conic-gradient(#ff6f9f,#ffc21a,#63c94f,#5b8ef0,#9a5cf0,#ff6f9f)', sh: '#7d4fb8', deco: '' },
  gold: { ring: 'linear-gradient(#fff8c4,#ffd23c 45%,#e48a00)', sh: '#9a5200', deco: S('M27 9 L25 0.5 L31 4.5 L36 -1 L41 4.5 L47 0.5 L45 9 Z', 'url(#gY)', '#9a5200', 1.2) },
  balloon: { ring: 'linear-gradient(#cdeefa,#8fd3ef 55%,#5aaed8)', sh: '#3f86b0', deco: L('M56.5 20.5 L58 25 M63.5 20.5 L62 25', '#7a4a1f', 0.9) + S('M60 1 C67 1 70 6 70 10.5 C70 16 65 20 60 22 C55 20 50 16 50 10.5 C50 6 53 1 60 1 Z', 'url(#gR)', '#8f1d1d', 1.2) + S('M60 1 C63.5 6 63.5 16 60 22 C56.5 16 56.5 6 60 1 Z', '#fff8c4', 'none', 0) + L('M53.5 6 Q55 3.5 57.5 3', '#fff', 1.2, 0.9) + S('M57 25 L63 25 L62.4 29.5 L57.6 29.5 Z', 'url(#gN)', '#5a3412', 0.9) + L('M10.5 63 Q12 66 10 70', '#8b86a6', 0.8) + `<ellipse cx="10.5" cy="58" rx="4.2" ry="5" fill="url(#gY)" stroke="#9a5200" stroke-width="1"/>` },
  moon: { ring: 'radial-gradient(#6b77c0,#3b4290)', sh: '#262b66', deco: S('M14 2.5 A10 10 0 1 0 21 19 A8 8 0 1 1 14 2.5 Z', 'url(#gY)', '#9a5200', 1.2) + star(62, 60, 4.2, '#fff6a8', '#9a5200', 0.8) + star(64.5, 13, 3, '#fff6a8', '#9a5200', 0.7) + star(21, 63, 2.4, '#fff6a8') },
};
const ringKey = id => String(id || '').replace(/^ring\./, '');
export const ringData = id => RINGS[ringKey(id)] || RINGS.pink;
export function ringDecoSvg(id) {
  const r = RINGS[ringKey(id)];
  return r && r.deco ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72">${GRAD}${r.deco}</svg>` : '';
}
// 外圈的小圖示：SVG 畫不出 CSS 的 conic 漸層，用相近的顏色代替
const RING_STROKE = { pink: '#ff6fb0', cloud: '#e3dcf5', star: '#ffc21a', rainbow: 'url(#gRain)', gold: 'url(#gY)', balloon: '#8fd3ef', moon: '#4a5596' };
function ringIcon(k) {
  const r = RINGS[k];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72">${GRAD}<circle cx="36" cy="36" r="23" fill="#fff5fb" stroke="${RING_STROKE[k]}" stroke-width="8"/><circle cx="36" cy="36" r="27.5" fill="none" stroke="${r.sh}" stroke-width="1.6" opacity=".7"/>${r.deco}</svg>`;
}
export function iconSvg(id) {
  if (ICON[id]) return ICON[id];
  if (NEW_ICON[id]) return NEW_ICON[id];
  const [cat, k] = String(id).split('.');
  if (cat === 'hat' && ACCESSORY_SVG[k]) return ACCESSORY_SVG[k];
  if (cat === 'ring' && RINGS[k]) return ringIcon(k);
  if (cat === 'outfit' && OUTFITS[k]) return outfitSvg(id, 'front') || ICON['hat.none'];
  return ICON['hat.none'];
}

// ---------- 衣櫃狀態 ----------
// stars：存檔裡每關的星星 { levelId: 0..3 }
export const totalStars = stars => Object.values(stars || {}).reduce((s, v) => s + Math.max(0, Math.min(3, Number(v) || 0)), 0);
export const threeStarCount = stars => Object.values(stars || {}).filter(v => Number(v) >= 3).length;

export function createCloset() {
  let key = null;
  let st = blank();
  let hadData = false;
  // seen：這台裝置上點過（看過）的品項，只用來決定「新」標記；null＝還沒整理過
  // avatar：我的頭像（角色、底色）；t：最後一次換裝 / 換頭像的時間（雲端衣櫃合併時，穿著和頭像用比較新的那份）
  function blank() { return { owned: [], chests: [], equip: { ...DEFAULT_LOOK }, avatar: { ...DEFAULT_AVATAR }, t: 0, seen: null }; }
  function norm(o) {
    const s = blank();
    if (!o || typeof o !== 'object') return s;
    if (Array.isArray(o.owned)) s.owned = o.owned.filter(id => itemById(id));
    if (Array.isArray(o.chests)) s.chests = o.chests.filter(i => Number.isInteger(i) && i >= 0 && i < CHESTS.length);
    if (o.equip && typeof o.equip === 'object') for (const c of CATEGORIES) {
      const it = itemById(o.equip[c.id]);
      if (it && it.cat === c.id) s.equip[c.id] = it.id;
    }
    if (o.avatar && typeof o.avatar === 'object') { const a = cleanLook(o.avatar); s.avatar = { who: a.who, bg: a.bg }; }
    if (Number.isInteger(o.t) && o.t > 0) s.t = o.t;
    if (Array.isArray(o.seen)) s.seen = o.seen.filter(id => typeof id === 'string' && itemById(id));
    return s;
  }
  // sync=false：只改了這台裝置自己的東西（看過的品項）或剛從雲端合併進來，不用再叫 main.js 排雲端存檔
  // 這台裝置上存著的那份「看過」（另一個分頁或主畫面圖示開的那份可能剛記了新的）
  function storedSeen() {
    try { const o = JSON.parse(localStorage.getItem(key) || 'null'); return o && Array.isArray(o.seen) ? o.seen.filter(id => typeof id === 'string' && itemById(id)) : null; } catch (e) { return null; }
  }
  // 存著的 seen 合進 st.seen（只增不減）。st.seen 還是 null（還沒整理過）就不動。回傳 true＝多了東西
  function unionStoredSeen() {
    if (!key || !st.seen) return false;
    const other = storedSeen();
    if (!other) return false;
    const add = other.filter(id => !st.seen.includes(id));
    if (add.length) st.seen = [...st.seen, ...add];
    return add.length > 0;
  }
  function persist(sync = true) {
    if (!key) return;
    // 整份寫回去之前，先把存著的「看過」合進來，舊的那份才不會把另一邊剛記的蓋掉（工作單24）
    unionStoredSeen();
    try { localStorage.setItem(key, JSON.stringify(st)); } catch (e) { /* 無痕模式：照玩 */ }
    if (sync && typeof api.onChange === 'function') { try { api.onChange(); } catch (e) { /* ignore */ } }
  }
  const api = {
    // 換帳號 / 開機時：讀這個帳號在這台裝置上的衣櫃
    load(k) {
      key = k;
      let raw = null;
      try { raw = JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { raw = null; }
      hadData = !!(raw && typeof raw === 'object');
      st = norm(raw);
    },
    // 每次 load 之後叫一次。第一次整理「看過」：
    // 舊衣櫃（這次更新前就有）→ 原本就有的 19 件裡已經解鎖的算看過，新加的品項會亮「新」；
    // 這台裝置第一次開（換裝置、新玩家）→ 已經解鎖的全部算看過，不會整排都是「新」。
    // 回傳 true＝以前開過的寶箱這次多了東西，要跳一次提示
    initSeen(stars) {
      if (st.seen) return false;
      const fromOld = hadData;
      st.seen = ITEMS.filter(it => api.isUnlocked(it, stars) && (!fromOld || OLD_IDS.has(it.id) || Object.values(DEFAULT_LOOK).includes(it.id))).map(it => it.id);
      persist(false);
      return fromOld && st.chests.some(i => i >= 5 && i <= 12);
    },
    isNew(item, stars) {
      if (typeof item === 'string') item = itemById(item);
      return !!(item && st.seen && !st.seen.includes(item.id) && api.isUnlocked(item, stars));
    },
    hasNew(stars, cat) { return ITEMS.some(it => (!cat || it.cat === cat) && api.isNew(it, stars)); },
    // id 可以是一個或一串（打開分頁時整類一起記）
    markSeen(id) {
      if (!st.seen) return;
      const add = [...new Set([].concat(id))].filter(x => itemById(x) && !st.seen.includes(x));
      if (!add.length) return;
      st.seen.push(...add); persist(false);
    },
    // 另一個分頁改了這份衣櫃（storage 事件）：把那邊記的「看過」合進來。回傳 true＝多了東西
    syncSeen() { return unionStoredSeen(); },
    get state() { return st; },
    coinsEarned(stars) {
      let n = threeStarCount(stars);
      for (const i of st.chests) n += CHESTS[i] ? CHESTS[i].coins : 0;
      return n;
    },
    coinsSpent() { return st.owned.reduce((s, id) => { const it = itemById(id); return s + (it && it.unlock && it.unlock.coins ? it.unlock.coins : 0); }, 0); },
    coins(stars) { return Math.max(0, api.coinsEarned(stars) - api.coinsSpent()); },
    isUnlocked(item, stars) {
      if (typeof item === 'string') item = itemById(item);
      if (!item) return false;
      if (DEBUG_UNLOCK_ALL_COSMETICS || !item.unlock) return true;
      const u = item.unlock;
      if (u.coins) return st.owned.includes(item.id);
      if (u.stars) return totalStars(stars) >= u.stars;
      if (u.chest != null) return st.chests.includes(u.chest);
      if (u.station) return reachedStation(u.station, stars);
      if (u.allClear) return allCleared(stars);
      return false;
    },
    canBuy(item, stars) { return !!(item && item.unlock && item.unlock.coins && !api.isUnlocked(item, stars) && api.coins(stars) >= item.unlock.coins); },
    buy(item, stars) {
      if (!api.canBuy(item, stars)) return false;
      st.owned.push(item.id); persist();
      return true;
    },
    equip(item, stars) {
      if (typeof item === 'string') item = itemById(item);
      if (!item || !api.isUnlocked(item, stars)) return false;
      st.equip[item.cat] = item.id; st.t = Date.now(); persist();
      return true;
    },
    avatar() { return { ...st.avatar }; },
    // 雲端衣櫃（saves/{uid}.closet）：兌換的、開過的寶箱、穿著、頭像、換裝時間。seen 是這台裝置的，不上雲端
    onChange: null,
    cloudData() {
      return { owned: [...new Set(st.owned)].slice(0, 300), chests: [...new Set(st.chests)].slice(0, 100), equip: { ...st.equip }, avatar: { ...st.avatar }, t: st.t };
    },
    // 雲端那份合進這台裝置的：兌換的、開過的寶箱兩邊合在一起（不會少），穿著和頭像用換得比較晚的那份。回傳 true＝內容有變
    mergeCloud(remote) {
      if (!remote || typeof remote !== 'object' || Array.isArray(remote)) return false;
      const r = norm(remote), before = JSON.stringify(api.cloudData());
      const newer = r.t > st.t ? r : st;
      st = { ...st, owned: [...new Set([...st.owned, ...r.owned])], chests: [...new Set([...st.chests, ...r.chests])], equip: { ...newer.equip }, avatar: { ...newer.avatar }, t: Math.max(st.t, r.t) };
      persist(false);
      return JSON.stringify(api.cloudData()) !== before;
    },
    setAvatar(part) {
      const a = cleanLook({ ...st.avatar, ...part });
      if (a.who === st.avatar.who && a.bg === st.avatar.bg) return false;
      st.avatar = { who: a.who, bg: a.bg }; st.t = Date.now(); persist();
      return true;
    },
    // 'open' 開過了、'ready' 可以開、'locked' 星星還不夠
    chestState(i, stars) {
      if (st.chests.includes(i)) return 'open';
      return totalStars(stars) >= CHESTS[i].stars ? 'ready' : 'locked';
    },
    readyChests(stars) { return CHESTS.map((c, i) => i).filter(i => api.chestState(i, stars) === 'ready'); },
    openChest(i, stars) {
      if (api.chestState(i, stars) !== 'ready') return null;
      st.chests.push(i); persist();
      return { items: chestItems(i), coins: CHESTS[i].coins };
    },
    // 目前穿的（沒解鎖的不算：例如換了裝置、或 DEBUG 開關關掉）→ { outfit, hat, fx, frame, theme, ring }（去掉分類前綴）；renderer 只看 hat、fx、frame、theme
    look(stars) {
      const out = {};
      for (const c of CATEGORIES) {
        let id = st.equip[c.id];
        if (!api.isUnlocked(id, stars)) id = DEFAULT_LOOK[c.id];
        out[c.id] = id.split('.')[1];
      }
      return out;
    },
  };
  return api;
}
