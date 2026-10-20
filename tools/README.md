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

1. **模型**：`tools/source/<id>.usdz` 存在就用掃描檔（轉成 GLB + 縮小版 USDZ；看檔案內容決定要不要重轉，跟修改時間無關）。`source` 是 `photo` 的玩具沒有 3D 模型。
2. **渲染**：掃描玩具的方塊圖、24 格旋轉圖、三寶合照（彩色炸彈）、標題圖（無頭 Chromium + three.js）。
3. **後製**：白色描邊貼紙 + 陰影（`postprocess.py`）；照片玩具和裝飾貼紙用 `photo_cut.py` 從照片去背。
   遊戲裡實際用的是**沒白邊的版本**（`<id>_n.png`、`<id>_spin_n.webp`、`trio_n.png`），會再加上「遊戲光」（`postprocess.py` 的 `toyify`）：
   磨皮、暗部拉亮加對比、髒灰變乾淨、面向光的邊緣加暖白色邊緣光、左上一片光澤、邊緣柔化。參數在 `postprocess.py` 的 `TOY`。
   發光邊（糖果色）和影子不做在圖裡，由遊戲依場景加。
4. 複製到 `assets/sprites/`、`assets/models/`、`assets/deco/`、`assets/photos/`，寫 `assets/manifest.json`。
5. 輸出檢查用總覽圖 `tools/out/contact.png`，跑完打開看一下每隻是否清楚。

`tools/source/` 和 `tools/out/` 不進 git。原始掃描檔或照片不在的時候，會沿用 `assets/` 裡已經做好的檔案。

同樣的輸入重跑結果完全一樣（.usdz 的 zip 時間戳固定成 1980-01-01），沒改東西就跑完，`git status` 不會出現有改的素材。

## 目前的 7 隻

| id | 名字 | 來源 |
|---|---|---|
| `dog` | 皮蛋 | Object Capture 掃描（會轉圈） |
| `sloth` | 薯餅 | Object Capture 掃描 |
| `egg` | 蛋黃哥 | Object Capture 掃描 |
| `dino` | 小恐龍 | 照片去背（選到會彈跳） |
| `nyanko` | 貓咪老師 | 照片去背 |
| `moodeng` | 彈跳豬（Moo Deng） | 照片去背 |
| `snoopy` | 史努比 | 照片去背 |

## 照片玩具（沒有 3D 掃描時）

1. 把照片放進 `tools/source/photos/`（**不進 git**：照片裡常拍到房間，網站是公開的，只上傳去背後的貼紙）。
2. 在 `tools/assets.json` 的 `pieces` 加一筆或改一筆：`"source": "photo"`、`"photo": "檔名.jpg"`，`"cut"` 裡設定去背提示（說明在 `tools/photo_cut.py` 開頭）：
   - `rect`：玩具一定在這個框裡
   - `fg` / `bg`：`[x, y, 半徑]` 圓點，一定是玩具 / 一定是背景
   - `bgRect`：一定是背景的方框（例如右下角的 PicPet 浮水印）
   - `crop`：最後只留這個範圍
   - 純色背景可以用 `"method": "chroma"` + `"key": [r, g, b]`
3. 跑 `python tools/photo_cut.py <id>`，看 `tools/out/pc/<id>_check.png`（`<id>_hints.jpg` 會把提示畫在原圖上），不乾淨就加 `fg` / `bg` 點再跑。
4. 跑 `python tools/build_assets.py`。
5. 改 `js/pieces.js` 那一行：`name`、`color`（方塊底色），照片玩具加 `photo: true`。

裝飾貼紙（標題、地圖、過關畫面的 `assets/deco/*.webp`）設定在 `assets.json` 的 `deco`，做法一樣。

## 把照片玩具換成 3D 掃描

1. 用 Object Capture 掃好，改名成 **`<id>.usdz`**（例如 `moodeng.usdz`）放進 `tools/source/`。檔名決定換掉哪一隻。
2. `tools/assets.json` 那一筆改成 `"source": "scan"`，加上 `"view": { "yaw": 20, "pitch": 14 }`（角度之後再調）。
3. 跑 `python tools/build_assets.py`，打開 `tools/out/contact.png` 看角度。不好看就改 `view` 再跑一次：
   - `yaw`：水平角度（度）。0 = 模型正面，90 = 右側，180 = 背面，270 = 左側
   - `pitch`：俯角，10–35 之間通常好看
   - `exposure`：曝光，玩具很暗（像皮蛋）就調高到 2 左右
   - `rim`：背光，深色玩具調高才看得到輪廓
4. `js/pieces.js` 那一行拿掉 `photo: true`、改成 `scan: true`。

**想用新的代號或多加一隻**：`tools/assets.json` 的 `pieces` 和 `js/pieces.js` 的 `PIECES` 各加一筆，再到 `js/levels.js` 把它加進想要的關卡（每關的種類數決定難度，換玩具不要改種類數）。改完跑 `python tests/run_tests.py --sim` 看平衡。

## 個別腳本

| 腳本 | 用途 |
|---|---|
| `build_assets.py` | 一鍵重建（上面那套流程） |
| `assets.json` | 每隻的來源、角度、曝光、調色；三寶合照與標題圖的排列 |
| `usd_to_glb.py` | USDZ → GLB（貼圖縮到 1024） |
| `slim_usdz.py` | 縮小版 USDZ（3D 看看頁只用 GLB；USDZ 留著，方便之後在 Mac / iPhone 上直接打開看） |
| `photo_cut.py` | 照片去背（照片玩具、裝飾貼紙）；`python tools/photo_cut.py <名字>` 看去背結果 |
| `make_placeholders.py` | 程式產生暫代玩具（目前沒有用到，留著備用） |
| `postprocess.py` | 貼紙描邊、陰影、旋轉圖拼成一張；`toyify`（遊戲光）；`retoy` 給沒有原照片的現成 `_n.png` 補上遊戲光（只能做一次） |
| `contact_sheet.py` | 檢查用總覽圖 |
| `render/shoot.py` | 無頭瀏覽器渲染（也可以單獨用：`python tools/render/shoot.py <jobs.json> <輸出資料夾>`） |
| `inspect_usd.py` | 印出 USD 檔結構、點數、包圍盒 |
| `browse.py` | 開遊戲頁面截圖、看 console 錯誤（開發用） |
