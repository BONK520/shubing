// 口號（連鎖 / 組合技 / 驚喜 / 開場 / 糖果狂歡 / 洗牌 / 輸 / 贏）。renderer.js 和 main.js 共用這一份。
// toy = 方塊 id（renderer 每次隨機挑那隻玩具旋轉序列裡的一格，角度每次都不同）或 'trio'（assets/sprites/trio.png）；
// img = 直接用那張圖（可能還沒做好：找不到圖就只顯示字）。
export const SLOGANS = {
  cascade: { 2: { text: '薯餅衝刺！', toy: 'sloth' }, 3: { text: '皮蛋出動！', toy: 'dog' }, 4: { text: '蛋黃哥醒了！', toy: 'egg' }, 5: { text: '三寶合體！', toy: 'trio' } },  // 5 = 5 or more
  combo:    { text: '蛋黃哥不躺了！', toy: 'egg' },                        // special+special combos, colour bomb blasts
  surprise: [ { text: '薯餅頂橘子！', img: 'assets/deco/sloth_orange.webp' }, { text: '小豬搭便車！', img: 'assets/deco/sloth_pig.webp' } ],  // occasional on very big moves
  start:    { text: '薯餅準備好了！', toy: 'sloth' },
  sugar:    { text: '薯餅狂歡時間！', toy: 'sloth' },                      // end-of-level bonus banner
  shuffle:  { text: '蛋黃哥翻個身～', toy: 'egg' },
  lose:     { text: '薯餅趴趴睡…再試一次？', img: 'assets/deco/sloth_bed.webp' },
  win:      { text: '過關！' }, win3: { text: '三寶都愛你！' },
};

// 連鎖第 n 步的口號（5 以上都用 5）；n < 2 沒有口號
export function cascadeSlogan(n) {
  n = Math.floor(n);
  if (!(n >= 2)) return null;
  return SLOGANS.cascade[Math.min(5, n)] || null;
}

export default SLOGANS;
