// 方塊清單（SPEC §2.1）。kind = 在 PIECES 裡的索引；彩色炸彈的 kind 是 -1。
// 之後換成自己掃描的玩具：用同一個 id 放新檔案，或直接改這份清單。
export const PIECES = [
  { id: 'dog',   name: '皮蛋',   color: '#8fd3ff', scan: true  },  // black plush dog
  { id: 'sloth', name: '薯餅',   color: '#9be8c8', scan: true  },  // sloth (the repo is named after it)
  { id: 'egg',   name: '蛋黃哥', color: '#ffb3d1', scan: true  },  // Gudetama egg
  { id: 'bunny', name: '兔兔', color: '#c9b6ff', scan: false },  // placeholder until a real scan exists
  { id: 'frog',  name: '呱呱', color: '#ffe08a', scan: false },  // placeholder
  { id: 'whale', name: '小鯨', color: '#ffc49b', scan: false },  // placeholder
];
export const TRIO = { id: 'trio', name: '三寶合照' };           // the color bomb picture
export const spritePath = id => `assets/sprites/${id}.png`;
export const spinPath   = id => `assets/sprites/${id}_spin.webp`;
export const SPIN = { frames: 24, cols: 6, rows: 4, size: 192 };
export const glbPath    = id => `assets/models/${id}.glb`;
export const usdzPath   = id => `assets/models/${id}.usdz`;
