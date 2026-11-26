# 跟薯餅小窩共用的錢包

2026-11-26 加的。蛋蛋島的造型幣和薯餅小窩（CharronYap/shubing-nest）的幣變成同一個錢包：1 比 1，在哪邊賺、在哪邊花都算同一堆。兩邊的價錢都沒有改。
完整說明（小窩那邊怎麼連、怎麼對帳）在小窩 repo 的 `docs/WALLET.md`。

## 玩家看到的

- 登入蛋蛋島的人：造型幣的數字就是錢包的數字，衣櫃上寫「幣（跟小窩共用）」。三星照舊送 1 枚、寶箱照舊送幣、兌換照舊扣幣，只是都算進同一個錢包。
- 小窩那邊用同一組名字和密碼登入，就會連到同一個錢包；小窩原本的幣會一起放進來。
- 沒登入（訪客）：造型幣照舊用星星算，跟錢包無關。

## 上線前要在主控台做的事（只要做一次）

Firebase 主控台 → plush-crush →「Firestore Database → 規則」：整份換成這個 repo 的 `firestore.rules`，按「發布」。這次只多了一段 `wallets`。
規則還沒發布時錢包讀寫會被擋（permission-denied），遊戲接住、不出聲，造型幣照舊用星星算。

## 怎麼做的

`wallets/{uid}` = `{coins, egg: {e, p}, nest: {小窩的帳號 id: 1}, t}`

- `js/cloud.js` 的 `walletEgg(e, p)`：e 是造型幣賺到的總數（三星＋寶箱，衣櫃的 `coinsEarned`），p 是兌換掉的總數（`coinsSpent`）。
  用 transaction：比錢包記的 egg.e、egg.p 多出來的部分加減進 coins，再把 egg.e、egg.p 換成比較大的那個。
  只看多出來的部分，所以舊裝置上的存檔比較少也不會把錢包扣回去。
- `js/cosmetics.js` 的 `coins()`：有錢包時 = 錢包的 coins + 這台還沒算進錢包的（新拿的三星減新兌換的）。沒有錢包照舊。
- `js/main.js` 的 `walletSync`：登入讀完存檔後、進度或衣櫃有變動（2 秒後合成一次）、回到這個分頁時各對一次。
  這台記一份最後的錢包（`plushcrush.v1.u.{uid}.wallet`），離線時照那個數字顯示。
