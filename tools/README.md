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
   遊戲裡實際用的是**沒白邊的版本**（`<id>_n.png`、`<id>_spin_n.webp`），會再加上「遊戲光」（`postprocess.py` 的 `toyify`）：
   磨皮、暗部拉亮加對比、髒灰變乾淨、面向光的邊緣加暖白色邊緣光、左上一片光澤、邊緣柔化。參數在 `postprocess.py` 的 `TOY`；
   個別玩具可以在 `assets.json` 那一筆加 `"toy": {...}` 覆蓋（皮蛋：`"toonify": false`，黑色的玩具做了 toonify 會整片發灰）。
   發光邊（糖果色）和影子不做在圖裡，由遊戲依場景加。
   **調色**（`grade_toys.py`）：掃描渲染和手機照片的色溫不一樣（史努比、貓咪老師偏冷偏青，薯餅、蛋黃哥偏暖），
   所以每隻玩具量一次 `<id>_n.png`，同一套參數套到那隻的所有圖：低彩度的亮部對齊同一個暖白、亮點和暗點拉到差不多的位置、
   暗部帶一點暖（不偏藍紫）。只往暖的方向修，每個色版最多改 8%，對比最多加 12%；裝飾貼紙每張自己量。
   調過的圖記在 `tools/graded.json`（調完的 sha1 + 參數），重跑只調新做出來的圖。沒有原始檔、想重調現成的圖：
   `python tools/grade_toys.py`；只想看效果不改檔：`python tools/grade_toys.py --check`（輸出 `tools/out/grade.png`）。
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
   - `patch`：`[x, y, 半徑]` 圓圈裡先用周圍的顏色補掉再去背（夾在玩具中間的手指、擋在玩具前面的把手）
   - `cap`：照片上緣切到玩具（頭頂被切平）時往上補一個圓頂，數字 = 圓頂高度 / 切口寬度（例如 `0.3`）
   - 純色背景可以用 `"method": "chroma"` + `"key": [r, g, b]`
3. 跑 `python tools/photo_cut.py <id>`，看 `tools/out/pc/<id>_check.png`（`<id>_hints.jpg` 會把提示畫在原圖上），不乾淨就加 `fg` / `bg` 點再跑。
4. 跑 `python tools/build_assets.py`。
5. 改 `js/pieces.js` 那一行：`name`、`color`（方塊底色），照片玩具加 `photo: true`。

## 裝飾貼紙（`assets/deco/*.webp`）

標題、載入畫面、地圖、過關 / 失敗卡、連鎖口號旁邊的照片貼紙，設定在 `assets.json` 的 `deco`，去背做法和照片玩具一樣
（`python tools/photo_cut.py <名字>` 看結果，例如 `python tools/photo_cut.py snoopy_sloth`）。

- `"style": "toy"`：沒有白邊和陰影，跟盤面上的玩具一樣的「遊戲光」。手機照片本來就比掃描渲染圖亮、飽和，
  所以只做 `toyify`、飽和度加重一點（`photo_cut.py` 的 `DECO_TOY`），臉上的灰色眼罩和毛的細節會留著。
  個別貼紙可以用 `"toy": { "sat": 1.3 }` 覆蓋參數，`"toon": true` 會先做 `toonify`（更亮、更平滑，臉容易發白）。
  發光和影子不做在圖裡：標題 / 地圖 / 載入畫面 / 結算卡用 CSS 的 `drop-shadow`，口號旁的照片由 `renderer.js` 的 `photoSprite` 加。
- 沒有 `style` 的是舊樣式（白邊 + 陰影，`photo_cut.sticker_rect`）。

| 貼紙 | 照片 | 用在 |
|---|---|---|
| `snoopy_sloth` | `pp08_snoopy_sloth.jpg`（史努比坐在薯餅頭上） | 標題右上、地圖、過關卡 |
| `sloth_pig` | `pp07_sloth_pig.jpg`（小豬趴在薯餅頭上） | 地圖、過關卡、口號「小豬搭便車！」 |
| `sloth_bed` | `pp03_stack.jpg`（薯餅趴在最上面） | 地圖、失敗卡「薯餅趴趴睡」 |
| `pig` | `pp12_pig.jpg` | 標題左上、地圖 |
| `group` | `pp10_snoopy_group.jpg` | 過關卡 |
| `sloth_orange` | `p6_sloth_orange.jpg` | 載入畫面、地圖、過關卡、口號「薯餅頂橘子！」 |

`pp01`…`pp12` 是 PicPet App 的截圖切出來的照片：`python tools/picpet_crop.py <截圖.jpg> tools/source/photos/pp08_snoopy_sloth.jpg`
（自動找出截圖中間那張照片；四角的頭像、時間、Instagram 按鈕還在，`cut` 裡用 `bgRect` 標成背景）。
原照片不在的時候 `build_assets.py` 會沿用現成的貼紙。

`sloth_orange.webp` 這次是用 `strip_outline.py` 從舊的白邊貼紙轉的（雲端環境裡沒有 `p6_sloth_orange.jpg`）。
本機有原照片的話，`build_assets.py` 會改用原照片重新去背：先跑 `python tools/photo_cut.py sloth_orange` 看一下，
舊的去背在薯餅左手後面帶進一塊淡黃色的背景（這次轉檔時另外去掉了），需要的話在那裡加 `bg` 點。

**手邊沒有原照片的舊貼紙**：`python tools/strip_outline.py assets/deco/<名字>.webp`（去掉白邊和陰影、換成 toy 樣式；
`--light 0.62,0.5` 會順便去掉碰到邊緣的淡色背景殘塊）。白色的玩具（史努比）會跟白邊黏在一起被吃掉，只能用原照片重新去背。

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
| `picpet_crop.py` | PicPet App 的截圖 → 只留中間那張照片 |
| `strip_outline.py` | 舊的白邊裝飾貼紙 → toy 樣式（沒有原照片時用） |
| `make_placeholders.py` | 程式產生暫代玩具（目前沒有用到，留著備用） |
| `postprocess.py` | 貼紙描邊、陰影、旋轉圖拼成一張；`toyify`（遊戲光）；`retoy` 給沒有原照片的現成 `_n.png` 補上遊戲光（只能做一次） |
| `contact_sheet.py` | 檢查用總覽圖 |
| `render/shoot.py` | 無頭瀏覽器渲染（也可以單獨用：`python tools/render/shoot.py <jobs.json> <輸出資料夾>`） |
| `inspect_usd.py` | 印出 USD 檔結構、點數、包圍盒 |
| `browse.py` | 開遊戲頁面截圖、看 console 錯誤（開發用） |
