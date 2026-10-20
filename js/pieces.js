// 方塊清單（SPEC §2.1）。kind = 在 PIECES 裡的索引；彩色炸彈的 kind 是 -1。
// 之後換成自己掃描的玩具：用同一個 id 放新檔案，或直接改這份清單。
// color = 糖果的顏色：跟上面那隻玩具「同色系」，一格只有一種色彩印象（不撞色）；白色 / 灰色的玩具配柔和的淺色
export const PIECES = [
  { id: 'dog',     name: '皮蛋',     color: '#9384cf', scan: true  },  // black plush dog (Object Capture scan) — 灰黑配柔和的灰紫
  { id: 'sloth',   name: '薯餅',     color: '#ffad5c', scan: true  },  // sloth (the repo is named after it) — 橘色配淺一點的琥珀
  { id: 'egg',     name: '蛋黃哥',   color: '#ffc93c', scan: true  },  // Gudetama egg — 黃配黃
  { id: 'dino',    name: '小恐龍',   color: '#2fb5a0', scan: false, photo: true },  // 照片去背做的貼紙（沒有 3D 模型）— 青綠配深一點的青綠
  { id: 'nyanko',  name: '貓咪老師', color: '#f6eee4', scan: false, photo: true },  // 白貓配珍珠白
  { id: 'moodeng', name: '彈跳豬',   color: '#f58fa3', scan: false, photo: true },  // Moo Deng（橘粉色）配珊瑚粉
  { id: 'snoopy',  name: '史努比',   color: '#79b4ea', scan: false, photo: true },  // 白色的狗配淡天空藍（白色已經給貓咪老師）
];
export const TRIO = { id: 'trio', name: '三寶合照' };           // the color bomb picture
export const spritePath = id => `assets/sprites/${id}.png`;
export const spinPath   = id => `assets/sprites/${id}_spin.webp`;
export const SPIN = { frames: 24, cols: 6, rows: 4, size: 192 };
export const glbPath    = id => `assets/models/${id}.glb`;
export const usdzPath   = id => `assets/models/${id}.usdz`;
