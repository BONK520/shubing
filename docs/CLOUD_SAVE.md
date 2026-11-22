# 雲端存檔（帳號）設定步驟

設定好之後，每個人用在遊戲裡自己開的 **帳號名稱＋密碼**（不用 email）登入，
**破到第幾關、每關的星星、最高分、道具** 會存到雲端：換手機、換瀏覽器，登入同一個帳號就接著玩；同一台手機換人登入，各玩各的。

還沒設定時（`js/cloud-config.js` 是 `null`），遊戲跟以前一樣，進度只存在那台裝置，畫面上也不會出現登入按鈕。

用的是 Google 的 **Firebase**（免費方案就夠：每天 5 萬次讀取、2 萬次寫入；這個遊戲每過一關大約寫 1 次）。
大約 10 分鐘，全部在網頁上點，不用寫程式。

---

## 1. 建立 Firebase 專案

1. 打開 <https://console.firebase.google.com/>，用你的 Google 帳號登入。
2. 按「**建立專案**」（Create a project），名字隨便取（例如 `plush-crush`）。
3. Google Analytics 可以關掉（用不到），按「建立專案」，等它跑完。

## 2. 新增網頁應用程式，拿到設定

1. 專案首頁按 **`</>`**（網頁）圖示，「新增應用程式」。
2. 暱稱隨便取（例如 `game`），**不用**勾 Firebase Hosting（遊戲放在 GitHub Pages）。
3. 按「註冊應用程式」後，畫面會出現一段：

   ```js
   const firebaseConfig = {
     apiKey: "AIza…",
     authDomain: "plush-crush-xxxx.firebaseapp.com",
     projectId: "plush-crush-xxxx",
     storageBucket: "…",
     messagingSenderId: "…",
     appId: "1:…:web:…"
   };
   ```

4. 打開專案裡的 **`js/cloud-config.js`**，把最後一行的 `null` 換成這段大括號（從 `{` 到 `}`）：

   ```js
   export const FIREBASE_CONFIG = {
     apiKey: "AIza…",
     authDomain: "plush-crush-xxxx.firebaseapp.com",
     projectId: "plush-crush-xxxx",
     storageBucket: "…",
     messagingSenderId: "…",
     appId: "1:…:web:…"
   };
   ```

   > 這些值**不是密碼**，Firebase 的設計本來就是放在網頁裡；資料安全靠第 5 步的規則。

## 3. 打開帳號密碼登入

1. 左邊選單「**建構 → Authentication**」→「開始使用」。
2. 「登入方式」（Sign-in method）分頁 → 按「**新增供應商**」（Add new provider）→ 選「**電子郵件/密碼**」（Email/Password）→
   只打開**第一個**開關「電子郵件/密碼」（**不要**開下面的「電子郵件連結（無密碼登入）」）→ 儲存。
   這是給「帳號名稱＋密碼」用的（玩家不用真的 email，遊戲會把名字換成一個不收信的地址，例如
   `alice@players.plush-crush.firebaseapp.com`）。

## 4. 讓遊戲的網址可以登入

1. 還在 Authentication →「**設定**」（Settings）分頁 →「**授權網域**」（Authorized domains）。
2. 按「新增網域」，加上 **`bonk520.github.io`**（遊戲的 GitHub Pages 網址，不要加 `https://` 和後面的 `/shubing/`）。
   `localhost` 預設已經在裡面（在自己電腦上用 `python -m http.server` 測試時用）。

## 5. 建立存檔用的資料庫，貼上安全規則

1. 左邊選單「**建構 → Firestore Database**」→「建立資料庫」。
2. 地點選 **`asia-east1`（台灣）**（離玩家近、比較快；選了之後不能改）。
3. 選「**以正式版模式啟動**」（production mode）→ 建立。
4. 上面的「**規則**」（Rules）分頁：把裡面的東西全部刪掉，換成專案根目錄 **`firestore.rules`** 的內容，按「**發布**」。

   規則的意思：每個人的存檔放在 `saves/{帳號 ID}`，**只有本人能讀、能寫**，別人看不到也改不了；寫入的格式也會檢查。

## 6. 上傳、試玩

1. commit 並 push（GitHub Pages 會自動更新，等 1～2 分鐘）。
2. 打開遊戲：標題畫面左上角會出現「**登入存檔**」。按下去 →「**帳號密碼**」→「還沒有帳號？開一個新的」→ 取名字（2～12 個字，中文也可以）＋設密碼（至少 6 個字）。
3. 如果這台手機之前沒登入時已經玩過，會問「**帶進帳號？**」：
   - 「帶進來」：之前的進度併進這個帳號（之後這台手機的訪客進度清空，下一個人登入不會拿到）。
   - 「不用」：帳號從自己的雲端進度開始，訪客進度留在這台手機。
4. 換另一台手機打開遊戲、登入同一個帳號，就會看到同樣的關卡和星星。

---

## 怎麼運作的

- **存什麼**：開到第幾關、每關最多幾顆星、每關最高分、道具數量（`saves/{uid}`）。音效 / 音樂開關跟著裝置，不上傳。
  不存 email、名字、照片（那些只在登入的那台裝置上顯示）。
- **什麼時候存**：進度一有變動（過關、用道具），等 1.5 秒合成一次寫上雲端。設定裡會顯示「已存到雲端 ✓」。
- **離線**：照樣可以玩，進度先存在手機上（「離線中，連上網路會自動存到雲端」），連上網路自動補傳。
- **兩台手機都玩過**：合在一起時，關卡、星星、最高分都取比較好的那份；道具用比較新的那份（不會兩台一合就變兩倍）。
- **登出**：換回那台裝置自己的訪客存檔。
- **重新整理 / 關掉再開**：登入狀態會記住，不用每次登入。

## 常見問題

- **帳號名稱**：2～12 個字，可以用任何語言的文字、數字、`_`、`-`；英文不分大小寫（`Alice` 和 `alice` 是同一個帳號）。
  名字被用過就不能再開。
- **忘記密碼（帳號名稱＋密碼的帳號）**：沒有 email 可以寄重設信，要管理員幫忙：
  1. Authentication →「使用者」找到那個帳號（英文名字直接看得到，例如 `alice@players…`；中文名字會是 `u.xxxx@players…`），
     記下它的「使用者 UID」，然後把這個帳號**刪除**。
  2. 請玩家用**同一個名字**重新開帳號（新密碼），從 Authentication 抄下新的 UID。
  3. Firestore →「資料」→ `saves` → 打開舊 UID 那份文件，把 `unlocked`、`stars`、`best`、`boosters` 的值照抄到新 UID 的文件裡
     （或請 Claude 幫忙搬）。
- **說「這個網址還不能登入」**：第 4 步的授權網域還沒加，或打錯字。
- **想刪掉某個人的存檔**：Firestore Database →「資料」分頁 → `saves` → 找到那個 ID → 刪除文件。
  帳號在 Authentication →「使用者」裡（可以看到 email 或帳號名稱對應的 ID）。

## 開發者：本機測試（不用真的 Firebase 專案）

用 Firebase 的模擬器跑端對端測試（兩台「裝置」、登入、合併、換人、離線補傳）：

```sh
npm i --no-save playwright firebase@13.2.0 firebase-tools   # 還要有 Java
npx firebase emulators:exec --only auth,firestore --project demo-plush "node tests/cloud_e2e.js"
```

或自己開模擬器（`npx firebase emulators:start --only auth,firestore --project demo-plush`），
用 `?debug=1&emu=1` 打開遊戲就會連到模擬器。

程式：`js/cloud-config.js`（設定）、`js/cloud.js`（登入、讀寫雲端，SDK 從 gstatic 載，版本 13.2.0）、
`js/main.js` 的「存檔」「雲端存檔（帳號）」兩段（每個帳號一份存檔、合併、同步）。
