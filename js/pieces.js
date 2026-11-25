// 方塊清單（SPEC §2.1）。kind = 在 PIECES 裡的索引；彩色炸彈的 kind 是 -1。
// 之後換成自己掃描的玩具：用同一個 id 放新檔案，或直接改這份清單。
// color = 底座（果凍糖果）的顏色：七種是完全不撞色的高飽和色（紫、橘、金黃、綠、寶藍、桃紅、正紅），
//         玩偶照片本身顏色比較柔和，靠底座的顏色一眼分出誰是誰；也不跟冰藍色的果凍格撞色
export const PIECES = [
  { id: 'dog',     name: '皮蛋',     color: '#7b3ff2', scan: true  },  // 深邃亮紫（灰黑色的皮蛋在亮紫上最清楚）
  { id: 'sloth',   name: '薯餅',     color: '#ff7a12', scan: true  },  // 鮮明橘
  { id: 'egg',     name: '蛋黃哥',   color: '#ffc81a', scan: true  },  // 鮮豔金黃
  { id: 'piggy',   name: '存錢豬',   color: '#18c25a', scan: false, photo: true },  // 亮翠綠（粉白色的存錢豬在綠底上最清楚）
  { id: 'nyanko',  name: '貓咪老師', color: '#2563eb', scan: true  },  // 濃郁寶藍（白貓在寶藍上一眼就看到）
  { id: 'moodeng', name: '彈跳豬',   color: '#ff3fb0', scan: false, photo: true },  // 桃紅
  { id: 'snoopy',  name: '史努比',   color: '#e8263c', scan: false, photo: true },  // 正紅（白狗在紅底上最清楚）
];
export const TRIO = { id: 'trio', name: '三寶合照' };           // the color bomb picture
export const spritePath = id => `assets/sprites/${id}.png`;
export const spinPath   = id => `assets/sprites/${id}_spin.webp`;
export const SPIN = { frames: 24, cols: 6, rows: 4, size: 192 };
export const glbPath    = id => `assets/models/${id}.glb`;
export const usdzPath   = id => `assets/models/${id}.usdz`;
