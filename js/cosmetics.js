// 三星外觀獎勵與玩偶衣櫃（docs/SPEC.md §8b）
//
// ★ 測試用快捷開關：開發時改成 true，所有外觀直接解鎖，可以先預覽效果；正式玩時記得改回 false ★
export const DEBUG_UNLOCK_ALL_COSMETICS = false;
//
// 怎麼拿到外觀：
//   * 三星造型幣：每一關「第一次」拿到三星送 1 枚（照存檔裡每關的星星算，所以以前拿過的三星也算數、換手機登入也還在）。
//     用造型幣在衣櫃裡兌換有標價的外觀。
//   * 三星豪華寶箱：星星總數到達里程碑（3、9、15、24、36…一直到 300）就能開一個寶箱，直接解鎖稀有主題、限定全套裝扮，或多送造型幣。
//   * 累積星星：有些外觀是星星總數到了就自動解鎖。
// 衣櫃的狀態（兌換過的、開過的寶箱、正在穿的）存在這台裝置的 localStorage（每個帳號一份，main.js 給 key）；
// 造型幣和星星是照關卡星星算的，所以就算換了裝置，造型幣也不會不見（只是要重新兌換、重新開寶箱）。

// ---------- 分類 ----------
export const CATEGORIES = [
  { id: 'hat', name: '頭飾配件', short: '配件' },
  { id: 'fx', name: '消除特效', short: '特效' },
  { id: 'frame', name: '方塊底座', short: '底座' },
  { id: 'theme', name: '棋盤主題', short: '主題' },
];

// ---------- 外觀清單 ----------
// unlock：null = 一開始就有；{ coins: n } = 用 n 枚造型幣兌換；{ stars: n } = 星星總數到 n 自動解鎖；{ chest: i } = 第 i 個寶箱開出來
export const ITEMS = [
  // 分類 1：玩偶頭飾與配件（疊在實拍照片上面的透明圖層，照片本身不動）
  { id: 'hat.none',   cat: 'hat', name: '不戴',         unlock: null },
  { id: 'hat.bow',    cat: 'hat', name: '粉紅蝴蝶結',   unlock: { coins: 2 } },
  { id: 'hat.blush',  cat: 'hat', name: '害羞紅腮紅',   unlock: { coins: 2 } },
  { id: 'hat.crown',  cat: 'hat', name: '迷你金皇冠',   unlock: { coins: 4 } },
  { id: 'hat.shades', cat: 'hat', name: '酷炫黑墨鏡',   unlock: { coins: 3 } },
  { id: 'hat.chef',   cat: 'hat', name: '小廚師帽',     unlock: { stars: 60 } },
  { id: 'hat.halo',   cat: 'hat', name: '發光天使光環', unlock: { chest: 2 } },
  // 分類 2：消除粒子特效
  { id: 'fx.default', cat: 'fx', name: '星光棉花',     unlock: null },
  { id: 'fx.sakura',  cat: 'fx', name: '櫻花花瓣雨',   unlock: { coins: 3 } },
  { id: 'fx.bubbles', cat: 'fx', name: '彩虹愛心泡泡', unlock: { chest: 1 } },
  { id: 'fx.gold',    cat: 'fx', name: '奢華金粉亮片', unlock: { chest: 4 } },
  // 分類 3：方塊底座
  { id: 'frame.jelly',   cat: 'frame', name: '果凍底座',   unlock: null },
  { id: 'frame.cookie',  cat: 'frame', name: '酥脆餅乾底', unlock: { coins: 3 } },
  { id: 'frame.capsule', cat: 'frame', name: '透明扭蛋球', unlock: { coins: 5 } },
  { id: 'frame.petal',   cat: 'frame', name: '花瓣底座',   unlock: { chest: 3 } },
  // 分類 4：棋盤背景主題
  { id: 'theme.macaron', cat: 'theme', name: '夢幻馬卡龍',     unlock: null },
  { id: 'theme.claw',    cat: 'theme', name: '粉紅夾娃娃機台', unlock: { chest: 0 } },
  { id: 'theme.picnic',  cat: 'theme', name: '野餐草莓格紋',   unlock: { coins: 4 } },
  { id: 'theme.galaxy',  cat: 'theme', name: '深邃夢幻星空',   unlock: { chest: 4 } },
];
export const DEFAULT_LOOK = { hat: 'hat.none', fx: 'fx.default', frame: 'frame.jelly', theme: 'theme.macaron' };
export const itemById = id => ITEMS.find(it => it.id === id) || null;

// ---------- 三星豪華寶箱（星星總數里程碑）----------
// items：直接解鎖的外觀（ITEMS 裡 unlock: { chest: i } 的那些）；coins：多送的造型幣；set：限定全套的名字
export const CHESTS = [
  { stars: 3,   coins: 1, name: '粉紅夾娃娃機台' },
  { stars: 9,   coins: 1, name: '彩虹愛心泡泡' },
  { stars: 15,  coins: 1, name: '發光天使光環' },
  { stars: 24,  coins: 2, name: '花瓣底座' },
  { stars: 36,  coins: 2, name: '星空貴族全套', set: true },   // 深邃夢幻星空 + 奢華金粉亮片
  { stars: 54,  coins: 3, name: '造型幣大禮包' },
  { stars: 80,  coins: 3, name: '造型幣大禮包' },
  { stars: 110, coins: 4, name: '造型幣大禮包' },
  { stars: 145, coins: 4, name: '造型幣大禮包' },
  { stars: 180, coins: 4, name: '造型幣大禮包' },
  { stars: 220, coins: 5, name: '造型幣大禮包' },
  { stars: 260, coins: 5, name: '造型幣大禮包' },
  { stars: 300, coins: 8, name: '三星紀念大禮包' },   // 300 顆星（大約 100 關全部三星）
];
export const chestItems = i => ITEMS.filter(it => it.unlock && it.unlock.chest === i);

// ---------- 配件戴在哪裡 ----------
// 每隻玩偶的臉在照片裡的位置（0–1，照「照片裡玩偶不透明部分的外框」量）：
//   x 臉的中心（左右）、top 頭頂、eyes 眼睛那一排、cheeks 臉頰、w 臉有多寬（佔玩偶寬度的比例）
export const TOY_FACE = {
  dog:     { x: 0.5,  top: 0.03, eyes: 0.55, cheeks: 0.7,  w: 0.72 },
  sloth:   { x: 0.5,  top: 0.02, eyes: 0.33, cheeks: 0.44, w: 0.4 },
  egg:     { x: 0.5,  top: 0.02, eyes: 0.27, cheeks: 0.37, w: 0.72 },
  piggy:   { x: 0.3,  top: 0.26, eyes: 0.4,  cheeks: 0.6,  w: 0.5 },   // 存錢豬：頭在照片左邊
  nyanko:  { x: 0.5,  top: 0.03, eyes: 0.33, cheeks: 0.5,  w: 0.82 },
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
};
// ★ 微調設定檔：某隻玩偶戴某個配件時，位置 / 大小不對就改這裡 ★
//   offsetX / offsetY：往右 / 往下挪多少（玩偶寬 / 高的比例，例如 0.05 = 挪 5%；負數 = 往左 / 往上）
//   scale：大小（1 = 原本，1.2 = 大 20%）
export const ACCESSORY_TUNING = {
  dog:     { crown: { offsetX: 0, offsetY: 0, scale: 1 }, chef: { offsetX: 0, offsetY: 0, scale: 1 }, halo: { offsetX: 0, offsetY: 0, scale: 1 },
             bow: { offsetX: 0, offsetY: 0, scale: 1 }, shades: { offsetX: 0, offsetY: -0.04, scale: 1 }, blush: { offsetX: 0, offsetY: 0, scale: 1 } },
  sloth:   { crown: { offsetX: 0, offsetY: 0.02, scale: 1.2 }, chef: { offsetX: 0, offsetY: 0.02, scale: 1.15 }, halo: { offsetX: 0, offsetY: 0, scale: 1.2 },
             bow: { offsetX: 0, offsetY: 0.03, scale: 1.15 }, shades: { offsetX: 0, offsetY: 0, scale: 1.1 }, blush: { offsetX: 0, offsetY: 0, scale: 1.2 } },
  egg:     { crown: { offsetX: 0, offsetY: 0, scale: 1 }, chef: { offsetX: 0, offsetY: 0, scale: 1 }, halo: { offsetX: 0, offsetY: 0, scale: 1 },
             bow: { offsetX: 0, offsetY: 0, scale: 1 }, shades: { offsetX: 0, offsetY: 0, scale: 1 }, blush: { offsetX: 0, offsetY: 0, scale: 1 } },
  piggy:    { crown: { offsetX: 0, offsetY: 0, scale: 1 }, chef: { offsetX: 0, offsetY: 0, scale: 1 }, halo: { offsetX: 0, offsetY: 0, scale: 1 },
             bow: { offsetX: 0, offsetY: 0, scale: 1 }, shades: { offsetX: 0, offsetY: 0, scale: 1 }, blush: { offsetX: 0, offsetY: 0, scale: 1 } },
  nyanko:  { crown: { offsetX: 0, offsetY: 0.02, scale: 1 }, chef: { offsetX: 0, offsetY: 0.02, scale: 1 }, halo: { offsetX: 0, offsetY: 0, scale: 1 },
             bow: { offsetX: 0, offsetY: 0, scale: 1 }, shades: { offsetX: 0, offsetY: 0, scale: 1 }, blush: { offsetX: 0, offsetY: 0, scale: 1 } },
  moodeng: { crown: { offsetX: 0, offsetY: 0.04, scale: 0.9 }, chef: { offsetX: 0, offsetY: 0.04, scale: 0.9 }, halo: { offsetX: 0, offsetY: 0, scale: 0.9 },
             bow: { offsetX: 0.02, offsetY: 0.04, scale: 0.9 }, shades: { offsetX: 0, offsetY: 0, scale: 1 }, blush: { offsetX: 0, offsetY: 0, scale: 1 } },
  snoopy:  { crown: { offsetX: 0, offsetY: 0, scale: 1 }, chef: { offsetX: 0, offsetY: 0, scale: 1 }, halo: { offsetX: 0, offsetY: 0, scale: 1 },
             bow: { offsetX: 0.04, offsetY: 0, scale: 1 }, shades: { offsetX: 0, offsetY: 0, scale: 1 }, blush: { offsetX: 0, offsetY: 0, scale: 1 } },
};

// ---------- 配件的圖（SVG，透明背景；renderer 先畫成小圖再疊到玩偶上）----------
export const ACCESSORY_SVG = {
  crown: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 88"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff8c4"/><stop offset=".45" stop-color="#ffd23c"/><stop offset="1" stop-color="#e48a00"/></linearGradient></defs><path d="M12 72 L8 26 L35 47 L60 12 L85 47 L112 26 L108 72 Z" fill="url(#g)" stroke="#9a5200" stroke-width="5" stroke-linejoin="round"/><rect x="10" y="64" width="100" height="17" rx="8" fill="url(#g)" stroke="#9a5200" stroke-width="5"/><circle cx="8" cy="24" r="6.5" fill="#fff3a0" stroke="#9a5200" stroke-width="3.5"/><circle cx="60" cy="10" r="7" fill="#fff3a0" stroke="#9a5200" stroke-width="3.5"/><circle cx="112" cy="24" r="6.5" fill="#fff3a0" stroke="#9a5200" stroke-width="3.5"/><circle cx="60" cy="72" r="6.5" fill="#ff5fa2" stroke="#9a1f5a" stroke-width="2.5"/><circle cx="33" cy="72" r="4.8" fill="#5fd0ff" stroke="#1d6f9a" stroke-width="2.2"/><circle cx="87" cy="72" r="4.8" fill="#5fd0ff" stroke="#1d6f9a" stroke-width="2.2"/><path d="M20 36 L23 60" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".75"/><circle cx="57" cy="7" r="2.2" fill="#fff"/></svg>`,
  shades: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 54"><defs><linearGradient id="l" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4a3f7a"/><stop offset=".5" stop-color="#1c1830"/><stop offset="1" stop-color="#0c0a16"/></linearGradient></defs><rect x="3" y="7" width="134" height="8" rx="4" fill="#1c1830"/><path d="M7 11 H62 Q67 11 66 17 L61 37 Q58 48 44 48 H25 Q10 48 8 35 Z" fill="url(#l)" stroke="#000" stroke-width="3" stroke-linejoin="round"/><path d="M133 11 H78 Q73 11 74 17 L79 37 Q82 48 96 48 H115 Q130 48 132 35 Z" fill="url(#l)" stroke="#000" stroke-width="3" stroke-linejoin="round"/><path d="M62 17 Q70 10 78 17" fill="none" stroke="#1c1830" stroke-width="5" stroke-linecap="round"/><path d="M16 17 L32 17 L21 38 Z" fill="#fff" opacity=".55"/><path d="M86 17 L102 17 L91 38 Z" fill="#fff" opacity=".55"/><circle cx="52" cy="19" r="2.5" fill="#fff" opacity=".8"/><circle cx="122" cy="19" r="2.5" fill="#fff" opacity=".8"/></svg>`,
  bow: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 110 74"><defs><linearGradient id="p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd0e6"/><stop offset=".5" stop-color="#ff86bd"/><stop offset="1" stop-color="#f0468f"/></linearGradient></defs><path d="M50 42 L38 70 L48 65 L54 72 Z" fill="url(#p)" stroke="#b8155a" stroke-width="4" stroke-linejoin="round"/><path d="M60 42 L72 70 L62 65 L56 72 Z" fill="url(#p)" stroke="#b8155a" stroke-width="4" stroke-linejoin="round"/><path d="M55 36 C40 10 7 4 5 23 C3 42 30 54 55 36 Z" fill="url(#p)" stroke="#b8155a" stroke-width="4.5" stroke-linejoin="round"/><path d="M55 36 C70 10 103 4 105 23 C107 42 80 54 55 36 Z" fill="url(#p)" stroke="#b8155a" stroke-width="4.5" stroke-linejoin="round"/><rect x="45" y="26" width="20" height="20" rx="8" fill="#ff7fb5" stroke="#b8155a" stroke-width="4.5"/><path d="M15 20 Q23 13 33 19" stroke="#fff" stroke-width="4.5" fill="none" stroke-linecap="round" opacity=".85"/><path d="M77 19 Q86 13 94 19" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" opacity=".6"/><circle cx="51" cy="31" r="2.6" fill="#fff" opacity=".9"/></svg>`,
  halo: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 50"><defs><radialGradient id="h"><stop offset=".5" stop-color="#fff6a8" stop-opacity="0"/><stop offset=".74" stop-color="#fff3a8" stop-opacity=".9"/><stop offset="1" stop-color="#ffe066" stop-opacity="0"/></radialGradient></defs><ellipse cx="60" cy="25" rx="52" ry="18" fill="url(#h)" opacity=".5"/><ellipse cx="60" cy="25" rx="44" ry="13" fill="none" stroke="#f5b800" stroke-width="10"/><ellipse cx="60" cy="25" rx="44" ry="13" fill="none" stroke="#ffe36e" stroke-width="6"/><ellipse cx="60" cy="25" rx="44" ry="13" fill="none" stroke="#fffbe6" stroke-width="2.4"/><circle cx="30" cy="16" r="2.6" fill="#fff"/></svg>`,
  blush: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 42"><defs><radialGradient id="b"><stop offset="0" stop-color="#ff5f92" stop-opacity=".9"/><stop offset=".65" stop-color="#ff86ad" stop-opacity=".6"/><stop offset="1" stop-color="#ff9fbf" stop-opacity="0"/></radialGradient></defs><ellipse cx="22" cy="21" rx="21" ry="15" fill="url(#b)"/><ellipse cx="118" cy="21" rx="21" ry="15" fill="url(#b)"/><g stroke="#ff3f7a" stroke-width="2.8" stroke-linecap="round" opacity=".85"><path d="M12 26 L17 16 M20 27 L25 17 M28 26 L33 16"/><path d="M108 26 L113 16 M116 27 L121 17 M124 26 L129 16"/></g></svg>`,
  chef: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 112 98"><path d="M23 62 C3 60 1 30 23 28 C25 7 51 1 59 18 C69 1 101 5 96 30 C114 33 110 62 89 62 Z" fill="#fff" stroke="#a9a2bf" stroke-width="4.5" stroke-linejoin="round"/><path d="M33 44 C35 33 45 29 52 35 M70 30 C77 24 87 27 88 36" stroke="#ebe6f6" stroke-width="5" fill="none" stroke-linecap="round"/><rect x="23" y="58" width="66" height="32" rx="7" fill="#fff" stroke="#a9a2bf" stroke-width="4.5"/><path d="M41 63 V86 M56 63 V86 M71 63 V86" stroke="#e3dff0" stroke-width="3.5" stroke-linecap="round"/><rect x="23" y="58" width="66" height="8" rx="4" fill="#ffd8ea" opacity=".9"/></svg>`,
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
export function iconSvg(id) {
  if (ICON[id]) return ICON[id];
  const k = id.split('.')[1];
  return ACCESSORY_SVG[k] || ICON['hat.none'];
}

// ---------- 衣櫃狀態 ----------
// stars：存檔裡每關的星星 { levelId: 0..3 }
export const totalStars = stars => Object.values(stars || {}).reduce((s, v) => s + Math.max(0, Math.min(3, Number(v) || 0)), 0);
export const threeStarCount = stars => Object.values(stars || {}).filter(v => Number(v) >= 3).length;

export function createCloset() {
  let key = null;
  let st = blank();
  function blank() { return { owned: [], chests: [], equip: { ...DEFAULT_LOOK } }; }
  function norm(o) {
    const s = blank();
    if (!o || typeof o !== 'object') return s;
    if (Array.isArray(o.owned)) s.owned = o.owned.filter(id => itemById(id));
    if (Array.isArray(o.chests)) s.chests = o.chests.filter(i => Number.isInteger(i) && i >= 0 && i < CHESTS.length);
    if (o.equip && typeof o.equip === 'object') for (const c of CATEGORIES) {
      const it = itemById(o.equip[c.id]);
      if (it && it.cat === c.id) s.equip[c.id] = it.id;
    }
    return s;
  }
  function persist() { if (!key) return; try { localStorage.setItem(key, JSON.stringify(st)); } catch (e) { /* 無痕模式：照玩 */ } }
  const api = {
    // 換帳號 / 開機時：讀這個帳號在這台裝置上的衣櫃
    load(k) {
      key = k;
      let raw = null;
      try { raw = JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { raw = null; }
      st = norm(raw);
    },
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
      st.equip[item.cat] = item.id; persist();
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
    // 目前穿的（沒解鎖的不算：例如換了裝置、或 DEBUG 開關關掉）→ 給 renderer 用的 { hat, fx, frame, theme }（去掉分類前綴）
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
