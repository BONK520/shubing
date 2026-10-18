# 素材工具（tools/）

遊戲用的圖和 3D 模型全部由這裡的腳本產生，輸出到 `assets/`。遊戲本身不用跑任何工具，`assets/` 已經放在 git 裡。

## 需要的東西

- Python 3.10 以上（不需要 Node.js）

```bash
python -m venv .venv
.venv\Scripts\activate             # macOS / Linux: source .venv/bin/activate
pip install -r tools/requirements.txt
python -m playwright install chromium
```

## 一鍵重建

在專案根目錄：

```bash
python tools/build_assets.py           # 只重做有變動的部分
python tools/build_assets.py --force   # 全部重做
```

它會依照 `tools/assets.json`：

1. **模型**：`tools/source/<id>.usdz` 存在就用掃描檔（轉成 GLB + 縮小版 USDZ；看檔案內容決定要不要重轉，跟修改時間無關）；不存在而且 `source` 是 `placeholder`，就用 `make_placeholders.py` 程式產生暫代玩具。
2. **渲染**：每隻的方塊圖、24 格旋轉圖、三寶合照（彩色炸彈）、標題圖（無頭 Chromium + three.js）。
3. **後製**：白色描邊貼紙 + 陰影（`postprocess.py`）。
4. 複製到 `assets/sprites/`、`assets/models/`，寫 `assets/manifest.json`。
5. 輸出檢查用總覽圖 `tools/out/contact.png`，跑完打開看一下每隻是否清楚。

`tools/source/` 和 `tools/out/` 不進 git。原始掃描檔不在的時候，`source` 是 `scan` 的玩具會沿用 `assets/models/` 裡已經做好的模型。還標著 `placeholder`、但 `assets/models/<id>.glb` 已經是掃描模型的，也會沿用並印出「警告」，不會被暫代玩具蓋掉。

同樣的輸入重跑結果完全一樣（.usdz 的 zip 時間戳固定成 1980-01-01），沒改東西就跑完，`git status` 不會出現有改的素材。

## 把暫代玩具換成自己的 AR 掃描

目前的暫代玩具：`bunny`（兔兔）、`frog`（呱呱）、`whale`（小鯨）。以換掉兔兔為例：

1. 用 Object Capture 掃好，得到一個 `.usdz`。
2. 改名成 **`bunny.usdz`**，放進 `tools/source/`。檔名決定換掉哪一隻。
3. 把 `tools/assets.json` 裡那隻的 `"source": "placeholder"` 改成 **`"scan"`**。一定要改：`tools/source/` 不進 git，換電腦、重新 clone 或清掉資料夾之後就沒有原始掃描檔，`source` 要是 `scan`，建置才會沿用 `assets/models/` 裡做好的掃描模型。
4. 跑 `python tools/build_assets.py`。看到「找到 tools/source/bunny.usdz，改用掃描檔」就代表換成功了（還多一行「記得把…改成 "scan"」的話，就是第 3 步還沒改）。
5. 打開 `tools/out/contact.png` 看角度。不好看的話，改 `tools/assets.json` 裡那隻的 `view`，再跑一次：
   - `yaw`：水平角度（度）。0 = 模型正面，90 = 右側，180 = 背面，270 = 左側
   - `pitch`：俯角，10–35 之間通常好看
   - `exposure`：曝光，玩具很暗（像皮蛋）就調高到 2 左右
   - `rim`：背光，深色玩具調高才看得到輪廓
6. 改 `js/pieces.js` 那一行：`name` 改成新玩具的名字，`scan: true`（3D/AR 頁就不會再顯示「暫代模型」）；`color` 是方塊底色，挑一個跟玩具對比明顯、又跟其他五隻不撞色的顏色。
7. 在專案根目錄跑 `python -m http.server 8000`，打開 `http://localhost:8000` 試玩。

**想換回暫代玩具**：刪掉 `tools/source/bunny.usdz` 和 `assets/models/bunny.glb`，`source` 改回 `"placeholder"`，`js/pieces.js` 改回 `scan: false`，再跑一次。

**想用新的代號**（例如 `cat`，不沿用 `bunny`）：檔名用 `cat.usdz`，然後把 `tools/assets.json`、`js/pieces.js` 裡的 `bunny` 都改成 `cat`（`assets.json` 那筆的 `source` 也改成 `"scan"`），`js/levels.js` 每一關 `kinds` 裡的 `'bunny'` 也要換掉。改完重新跑 `build_assets.py`。

**想多加一隻**（變成 7 種）：`tools/assets.json` 的 `pieces` 和 `js/pieces.js` 的 `PIECES` 各加一筆，再到 `js/levels.js` 把它加進想要的關卡。注意種類越多越難湊三連。

## 個別腳本

| 腳本 | 用途 |
|---|---|
| `build_assets.py` | 一鍵重建（上面那套流程） |
| `assets.json` | 每隻的來源、角度、曝光、調色；三寶合照與標題圖的排列 |
| `usd_to_glb.py` | USDZ → GLB（貼圖縮到 1024） |
| `slim_usdz.py` | 縮小版 USDZ，給 iPhone AR Quick Look |
| `make_placeholders.py` | 程式產生暫代玩具（GLB + USDZ） |
| `postprocess.py` | 貼紙描邊、陰影、旋轉圖拼成一張 |
| `contact_sheet.py` | 檢查用總覽圖 |
| `render/shoot.py` | 無頭瀏覽器渲染（也可以單獨用：`python tools/render/shoot.py <jobs.json> <輸出資料夾>`） |
| `inspect_usd.py` | 印出 USD 檔結構、點數、包圍盒 |
| `browse.py` | 開遊戲頁面截圖、看 console 錯誤（開發用） |
