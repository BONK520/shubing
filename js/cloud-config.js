// 雲端存檔的設定（Firebase）。步驟見 docs/CLOUD_SAVE.md。
//
// 還沒設定（null）時，遊戲跟以前一樣：存檔只放在這台裝置的瀏覽器裡，畫面上不會出現登入按鈕。
// 設定好之後，玩家可以用 Google 帳號登入，破到第幾關、星星、最高分、道具會存到雲端，換手機登入同一個帳號就能接著玩。
//
// 把 Firebase 主控台「專案設定 → 一般 → 你的應用程式 → SDK 設定和配置」裡的 firebaseConfig 整段貼進來，例如：
//
//   export const FIREBASE_CONFIG = {
//     apiKey: 'AIza…',
//     authDomain: 'your-project.firebaseapp.com',
//     projectId: 'your-project',
//     appId: '1:1234567890:web:abc123',
//   };
//
// 這些值本來就會出現在網頁裡、不是密碼（Firebase 官方的設計就是放在前端）；
// 資料安全靠 Firestore 的規則（專案根目錄的 firestore.rules：每個人只能讀寫自己的存檔）。
//
// 目前用的專案：plush-crush（免費的 Spark 方案；Firestore 在 asia-east1 台灣；授權網域 bonk520.github.io）。
// 想暫時關掉雲端存檔：把下面整段換回 null。
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyABsrmZwxABSHZfaSka-8n7eTsW64uxqz8',
  authDomain: 'plush-crush.firebaseapp.com',
  projectId: 'plush-crush',
  storageBucket: 'plush-crush.firebasestorage.app',
  messagingSenderId: '740207706798',
  appId: '1:740207706798:web:b9dd64dd74250aff3ce33f',
};
