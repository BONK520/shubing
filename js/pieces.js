// 方塊清單（SPEC §2.1）。kind = 在 PIECES 裡的索引；彩色炸彈的 kind 是 -1。
// 之後換成自己掃描的玩具：用同一個 id 放新檔案，或直接改這份清單。
export const PIECES = [
  { id: 'dog',     name: '皮蛋',     color: '#3db8ff', scan: true  },  // black plush dog (Object Capture scan)
  { id: 'sloth',   name: '薯餅',     color: '#2fd37f', scan: true  },  // sloth (the repo is named after it)
  { id: 'egg',     name: '蛋黃哥',   color: '#ff6fae', scan: true  },  // Gudetama egg
  { id: 'dino',    name: '小恐龍',   color: '#9b6bff', scan: false, photo: true },  // 照片去背做的貼紙（沒有 3D 模型）
  { id: 'nyanko',  name: '貓咪老師', color: '#ffc21a', scan: false, photo: true },
  { id: 'moodeng', name: '彈跳豬',   color: '#ff8a3d', scan: false, photo: true },  // Moo Deng
  { id: 'snoopy',  name: '史努比',   color: '#ff4d5e', scan: false, photo: true },
];
export const TRIO = { id: 'trio', name: '三寶合照' };           // the color bomb picture
export const spritePath = id => `assets/sprites/${id}.png`;
export const spinPath   = id => `assets/sprites/${id}_spin.webp`;
export const SPIN = { frames: 24, cols: 6, rows: 4, size: 192 };
export const glbPath    = id => `assets/models/${id}.glb`;
export const usdzPath   = id => `assets/models/${id}.usdz`;
