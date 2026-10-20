# 照片去背：把主人拍的照片做成貼紙（照片方塊 assets/sprites/<id>.png、裝飾貼紙 assets/deco/*.webp）
# build_assets.py 會 import 這個檔；調參數時也可以單獨跑，看去背結果:
#   python tools/photo_cut.py dino                 # assets.json 裡 id 或輸出檔名含這個字的那幾筆
#   python tools/photo_cut.py sloth_orange pig     # 一次看好幾筆
#   python tools/photo_cut.py --all
# 每筆會在 tools/out/pc/ 輸出 <名字>_hints.jpg（提示畫在原圖上：綠 = 一定是玩具、紅 = 一定是背景、
# 黃框 = rect、藍框 = crop、紫框 / 紫圈 = 浮水印 / patch 修補範圍）和 <名字>_check.png（去背結果放在棋盤格和方塊底色上）。
#
# 設定（tools/assets.json 的 "cut"，座標都是原照片的像素）:
#   method   "grabcut"（預設）或 "chroma"（純色背景，例如 moodeng_face.png 的粉紅底）
#   rect     [x0, y0, x1, y1]  玩具一定在這個框裡面，框外全部當背景
#   fg / bg  [[x, y, r], ...]  一定是玩具 / 一定是背景的圓點
#   fgRect / bgRect  [[x0, y0, x1, y1], ...]  同上，但用方框（例如右下角的 PicPet 浮水印 → bgRect）
#   crop     [x0, y0, x1, y1]  最後只留這個範圍（切掉照片邊緣、手指、浮水印）
#   inpaint  [[x0, y0, x1, y1], ...]  浮水印壓在玩具身上時：框裡比周圍亮的字跡先修補掉再去背
#   patch    [[x, y, r], ...]  圓圈裡整塊用周圍的顏色補掉再去背（夾在玩具中間的手指、擋在玩具前面的把手）
#   cap      照片上緣切到玩具（頭頂被切平）時往上補一個圓頂：圓頂高度 = 切口寬度 × cap（例如 0.3），顏色沿用最上面幾排
#   keep     只留最大的一塊（預設 1）；> 1 = 留最大的幾塊；0 = 全部留
#   close    補小縫的閉運算直徑（px，預設 15）；open = 去掉細毛邊的開運算直徑（預設 0）
#   shrink   邊緣往內縮幾 px（預設 1，去掉背景色的邊）；feather = 柔邊（高斯 sigma，預設 1.6）
#   defringe 邊緣這麼多 px 以內的顏色改用更裡面的顏色（預設 2），背景色不會滲進邊緣
#   chroma 專用: key [r, g, b]、near / far（顏色距離：near 以內是背景、far 以外是玩具）、scale（先放大幾倍）
import json, os, sys

import cv2
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

TOOLS = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(TOOLS)
sys.path.insert(0, TOOLS)
import postprocess as pp

PHOTOS = os.path.join(TOOLS, 'source', 'photos')     # 主人的原始照片（不進 git）
DEBUG = os.path.join(TOOLS, 'out', 'pc')


def read_rgb(path):
    return np.asarray(Image.open(path).convert('RGB'), dtype=np.uint8).copy()


# ---------------------------------------------------------------- 浮水印
def inpaint_overlay(rgb, rects, thr=14):
    """半透明白字（PicPet 浮水印）壓在玩具上：框裡比周圍亮 thr 以上的筆畫用 cv2.inpaint 補掉"""
    if not rects:
        return rgb
    mask = np.zeros(rgb.shape[:2], np.uint8)
    for x0, y0, x1, y1 in rects:
        reg = rgb[y0:y1, x0:x1]
        g = cv2.cvtColor(reg, cv2.COLOR_RGB2GRAY)
        base = cv2.medianBlur(g, 41 if min(reg.shape[:2]) > 41 else 3 + 2 * (min(reg.shape[:2]) // 4))
        m = (g.astype(np.int16) - base.astype(np.int16)) > thr
        mask[y0:y1, x0:x1] |= m.astype(np.uint8)
    mask = cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
    return cv2.inpaint(rgb, mask * 255, 9, cv2.INPAINT_TELEA)


def patch(rgb, circles):
    """圓圈裡整塊用周圍的顏色補掉（cv2.inpaint），例如夾在兩隻手中間的手指"""
    if not circles:
        return rgb
    mask = np.zeros(rgb.shape[:2], np.uint8)
    for x, y, r in circles:
        cv2.circle(mask, (int(x), int(y)), int(r), 255, -1)
    return cv2.inpaint(rgb, mask, 15, cv2.INPAINT_TELEA)


# ---------------------------------------------------------------- 去背
def grabcut(rgb, c):
    h, w = rgb.shape[:2]
    x0, y0, x1, y1 = c.get('rect', [0, 0, w, h])
    mask = np.full((h, w), cv2.GC_BGD, np.uint8)
    mask[y0:y1, x0:x1] = cv2.GC_PR_FGD
    for k, val in (('bgRect', cv2.GC_BGD), ('fgRect', cv2.GC_FGD)):
        for a0, b0, a1, b1 in c.get(k, []):
            mask[b0:b1, a0:a1] = val
    # 背景圓點先畫、玩具圓點後畫（重疊時以「一定是玩具」為準）
    for k, val in (('bg', cv2.GC_BGD), ('fg', cv2.GC_FGD)):
        for x, y, r in c.get(k, []):
            cv2.circle(mask, (int(x), int(y)), int(r), int(val), -1)
    bgd = np.zeros((1, 65), np.float64)
    fgd = np.zeros((1, 65), np.float64)
    cv2.setRNGSeed(520)                        # GMM 初始化有亂數：固定種子，每次結果一樣
    cv2.grabCut(rgb[..., ::-1].copy(), mask, None, bgd, fgd, int(c.get('iters', 8)), cv2.GC_INIT_WITH_MASK)
    return ((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD)).astype(np.float32)


def clean(m, c):
    """硬遮罩 -> 留最大塊、補縫、補洞、內縮、柔邊（0..1 float）"""
    b = m > 0.5
    keep = int(c.get('keep', 1))
    n, lab, st, _ = cv2.connectedComponentsWithStats(b.astype(np.uint8), connectivity=4)
    if n > 1 and keep > 0:
        order = 1 + np.argsort(-st[1:, cv2.CC_STAT_AREA])
        b = np.isin(lab, order[:keep])
    k = int(c.get('close', 15))
    if k > 1:
        b = cv2.morphologyEx(b.astype(np.uint8), cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))) > 0
    b = ndimage.binary_fill_holes(b)
    k = int(c.get('open', 0))
    if k > 1:
        b = cv2.morphologyEx(b.astype(np.uint8), cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))) > 0
        if keep > 0:      # 開運算可能切出小碎塊
            n, lab, st, _ = cv2.connectedComponentsWithStats(b.astype(np.uint8), connectivity=4)
            if n > 1:
                b = np.isin(lab, 1 + np.argsort(-st[1:, cv2.CC_STAT_AREA])[:keep])
    s = float(c.get('shrink', 1))
    if s > 0:
        b = ndimage.distance_transform_edt(b) > s
    f = float(c.get('feather', 1.6))
    a = b.astype(np.float32)
    return cv2.GaussianBlur(a, (0, 0), f) if f > 0 else a


def chroma(rgb, c):
    """純色背景色鍵。回傳 (rgb float 0..1, alpha)（已放大 scale 倍）"""
    s = int(c.get('scale', 4))
    im = Image.fromarray(rgb)
    if s > 1:
        im = im.resize((im.width * s, im.height * s), Image.LANCZOS)
    col = np.asarray(im, dtype=np.float32)
    key = np.array(c.get('key', [255, 64, 129]), np.float32)
    near, far = float(c.get('near', 45)), float(c.get('far', 110))
    d = np.sqrt(((col - key) ** 2).sum(-1))
    # 確定是背景 = 和照片邊緣連著、顏色很接近 key 的區域；半透明只出現在它旁邊一圈（band px），
    # 玩具身上剛好和背景色有點像的地方（例如 Moo Deng 粉紅色的臉頰）不會變透明
    lab, _ = ndimage.label(d < near)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    sure_bg = np.isin(lab, list(border))
    near_bg = ndimage.distance_transform_edt(~sure_bg) <= float(c.get('band', 3)) * s
    alpha = np.where(sure_bg, 0.0, np.where(near_bg, np.clip((d - near) / (far - near), 0, 1), 1.0))
    alpha = ndimage.gaussian_filter(alpha, float(c.get('feather', 1.0)))
    a = np.clip(alpha, 1e-3, 1)[..., None]
    fg = np.clip((col - (1 - a) * key) / a, 0, 255) / 255     # 把背景色從半透明邊緣減掉
    return fg, alpha.astype(np.float32), s


def defringe(rgb, alpha, band=2.0, solid=0.98):
    """邊緣一圈（半透明 + 往內 band px）的顏色換成更裡面最近的像素顏色：
    背景色（床單的紅、牆的灰、手指的膚色）不會滲進邊緣和白邊"""
    core = alpha >= solid
    if band > 0:
        core = ndimage.distance_transform_edt(core) > band
    if not core.any():
        return rgb
    _, (iy, ix) = ndimage.distance_transform_edt(~core, return_indices=True)
    out = rgb[iy, ix]
    return np.where(core[..., None], rgb, out)


def cut(entry, photos=PHOTOS):
    """assets.json 的一筆 -> 去背後的 RGBA（float 0..1，已裁切）"""
    c = entry.get('cut', {})
    rgb = read_rgb(os.path.join(photos, entry['photo']))
    if c.get('method', 'grabcut') == 'chroma':
        fg, alpha, s = chroma(rgb, c)
        sh = float(c.get('shrink', 0)) * s
        if sh > 0:       # 原圖邊緣有一圈深色鋸齒（之前去背留下的）：整圈往內縮
            d = ndimage.distance_transform_edt(alpha > 0.5)
            alpha = np.minimum(alpha, np.clip((d - sh) / s, 0, 1)).astype(np.float32)
    else:
        rgb = patch(inpaint_overlay(rgb, c.get('inpaint', [])), c.get('patch', []))
        alpha = clean(grabcut(rgb, c), c)
        fg, s = rgb.astype(np.float32) / 255, 1
    fg = defringe(fg, alpha, float(c.get('defringe', 2)) * s)
    rgba = np.concatenate([fg, alpha[..., None]], -1).astype(np.float32)
    if 'crop' in c:
        x0, y0, x1, y1 = [int(v * s) for v in c['crop']]
        rgba = rgba[y0:y1, x0:x1]
        # 裁切邊緣也柔一點（不然切口是鋸齒）
        a = rgba[..., 3]
        e = np.ones_like(a); e[0, :] = e[-1, :] = e[:, 0] = e[:, -1] = 0
        rgba[..., 3] = a * np.clip(ndimage.distance_transform_edt(e) / (1.5 * s), 0, 1)
    if c.get('cap'):
        rgba = cap_top(rgba, float(c['cap']), s)
    rgba[..., 3] = np.where(rgba[..., 3] < 0.02, 0, rgba[..., 3])
    return rgba


def cap_top(rgba, k, s=1):
    """上緣被照片邊切平的玩具（例如頭頂超出照片）：往上補一個半橢圓的圓頂，顏色用最上面幾排往上延伸"""
    a = rgba[..., 3]
    row = np.concatenate([[False], a[0] > 0.5, [False]])
    edges = np.flatnonzero(row[1:] != row[:-1]).reshape(-1, 2)    # 每一段 [開始, 結束)
    if not len(edges):
        return rgba
    xa, xb = max(edges, key=lambda e: e[1] - e[0])
    w = xb - xa
    P = int(round(k * w))
    H, W = a.shape
    out = np.zeros((H + P, W, 4), np.float32)
    out[P:] = rgba
    n = min(int(6 * s), H)
    wt = a[:n, xa:xb, None]
    col = (rgba[:n, xa:xb, :3] * wt).sum(0) / np.maximum(wt.sum(0), 1e-4)
    col = cv2.GaussianBlur(col[None], (0, 0), sigmaX=3 * s, sigmaY=0.1)[0]   # 只橫向模糊，去掉一條一條的紋
    out[:P, xa:xb, :3] = col[None]
    t = (np.arange(xa, xb) + 0.5 - (xa + xb) / 2) / (w / 2)
    h = P * np.sqrt(np.clip(1 - t * t, 0, 1))
    y = np.arange(P)[:, None] + 0.5
    out[:P, xa:xb, 3] = np.clip(y - (P - h)[None] + 0.5, 0, 1)
    return out


# ---------------------------------------------------------------- 調色 + 貼紙
def enhance(rgba, g):
    """照片比渲染圖暗、灰：pp.grade 之外再加 vibrance（低飽和的地方多加一點）"""
    if not g:
        return rgba
    out = pp.grade(rgba, {k: v for k, v in g.items() if k != 'vibrance'})
    v = g.get('vibrance', 0.0)
    if v:
        rgb = out[..., :3]
        mx, mn = rgb.max(-1, keepdims=True), rgb.min(-1, keepdims=True)
        sat = (mx - mn) / np.maximum(mx, 1e-4)
        l = (rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32))[..., None]
        k = 1 + v * (1 - sat)
        out[..., :3] = np.clip(l + (rgb - l) * k, 0, 1)
    return out


def sticker_piece(rgba, size=256, fill=pp.FILL, g=None):
    """照片方塊：和掃描玩具一樣的貼紙（白邊 + 陰影，玩具連白邊佔方塊 fill）"""
    return pp.sprite(pp.to_im(enhance(rgba, g)), size, K=3, fill=fill)


def sticker_rect(rgba, max_side=512, g=None, K=2):
    """裝飾貼紙：長邊 = max_side，比例照玩具本身，白邊粗細和 256px 方塊的貼紙看起來一樣（以長邊 256 為基準）"""
    a = enhance(rgba, g)
    bb = pp.bbox(a)
    bw, bh = bb[2] - bb[0], bb[3] - bb[1]
    unit = max_side / 256 * K
    m = (pp.OUTLINE + 0.5 + 9.0) * unit                    # 白邊 + 陰影的空間
    s = (max_side * K - 2 * m) / max(bw, bh)
    W = int(round((bw * s + 2 * m) / K)) * K
    H = int(round((bh * s + 2 * m) / K)) * K
    ox = W / 2 - (bb[0] + bb[2]) / 2 * s
    oy = H / 2 - (bb[1] + bb[3]) / 2 * s - pp.SHADOW_DY * unit / 2     # 陰影在下面，整體稍微往上
    big = pp.resample(a, s, ox, oy, W, H)
    return pp.to_im(pp.downsample(pp.stickerize(big, unit), W // K, H // K))


# 裝飾貼紙的「遊戲光」：手機照片本來就比掃描渲染圖亮、飽和，再做 toonify 會整片發白、臉上的灰色眼罩不見；
# 所以只做 toyify，飽和度加重一點（顏色接近盤面上的玩具，細節留著）
DECO_TOY = dict(sat=1.5, vib=0.7, gamma=0.9)


def toy_rect(rgba, max_side=512, g=None, K=2, toon=False, **toy):
    """裝飾貼紙（新樣式 "style": "toy"）：沒有白邊和陰影，和盤面玩具一樣的「遊戲光」；發光和落地的影子由遊戲（CSS）
    依場景加。長邊 = max_side。toon=True 先做 toonify；toy = 覆蓋 DECO_TOY / pp.TOY 的參數"""
    toy = {**DECO_TOY, **toy}
    a = enhance(rgba, g)
    if toon:
        a = pp.toonify(a)
    bb = pp.bbox(a)
    bw, bh = bb[2] - bb[0], bb[3] - bb[1]
    unit = max_side / 256 * K
    m = 3.0 * unit                                         # 只留柔邊的空間
    s = (max_side * K - 2 * m) / max(bw, bh)
    W = int(round((bw * s + 2 * m) / K)) * K
    H = int(round((bh * s + 2 * m) / K)) * K
    ox = W / 2 - (bb[0] + bb[2]) / 2 * s
    oy = H / 2 - (bb[1] + bb[3]) / 2 * s
    big = pp.resample(a, s, ox, oy, W, H)
    return pp.to_im(pp.downsample(pp.toyify(big, unit, **toy), W // K, H // K))


def resize_photo(src, max_side=900):
    im = Image.open(src).convert('RGB')
    k = max_side / max(im.size)
    if k < 1:
        im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
    return im


def save_webp(im, path, quality=82):
    im.save(path, 'WEBP', quality=quality, method=6, alpha_quality=85)


# ---------------------------------------------------------------- 調參數用的檢查圖
def checker(w, h, n=16):
    y, x = np.mgrid[0:h, 0:w]
    v = np.where(((x // n) + (y // n)) % 2 == 0, 205, 245).astype(np.uint8)
    return Image.fromarray(np.stack([v, v, v, np.full_like(v, 255)], -1), 'RGBA')


def debug(entry, name, color='#cccccc'):
    os.makedirs(DEBUG, exist_ok=True)
    c = entry.get('cut', {})
    src = Image.open(os.path.join(PHOTOS, entry['photo'])).convert('RGB')
    d = ImageDraw.Draw(src)
    for x, y, r in c.get('fg', []):
        d.ellipse((x - r, y - r, x + r, y + r), outline=(0, 230, 0), width=4)
    for x, y, r in c.get('bg', []):
        d.ellipse((x - r, y - r, x + r, y + r), outline=(255, 0, 0), width=4)
    for k, col in (('fgRect', (0, 230, 0)), ('bgRect', (255, 0, 0)), ('inpaint', (200, 0, 255))):
        for r in c.get(k, []):
            d.rectangle(r, outline=col, width=4)
    for x, y, r in c.get('patch', []):
        d.ellipse((x - r, y - r, x + r, y + r), outline=(200, 0, 255), width=4)
    if 'rect' in c:
        d.rectangle(c['rect'], outline=(255, 220, 0), width=4)
    if 'crop' in c:
        d.rectangle(c['crop'], outline=(0, 120, 255), width=4)
    src.save(os.path.join(DEBUG, name + '_hints.jpg'), quality=85)
    rgba = cut(entry)
    raw = pp.to_im(rgba)
    if 'id' in entry:
        st = sticker_piece(rgba, 256, entry.get('fill', pp.FILL), entry.get('grade'))
    elif entry.get('style') == 'toy':
        st = toy_rect(rgba, 512, entry.get('grade'), toon=entry.get('toon', False), **entry.get('toy', {}))
    else:
        st = sticker_rect(rgba, 512, entry.get('grade'))
    # 原始去背（棋盤格，最長邊 640）+ 貼紙放在方塊底色 / 深色底上
    k = 640 / max(raw.size)
    raw = raw.resize((max(1, round(raw.width * k)), max(1, round(raw.height * k))), Image.LANCZOS)
    W = raw.width + 2 * st.width + 60
    H = max(raw.height, st.height) + 20
    C = Image.new('RGBA', (W, H), (43, 22, 74, 255))
    ch = checker(raw.width, raw.height)
    ch.alpha_composite(raw)
    C.alpha_composite(ch, (10, 10))
    x = raw.width + 30
    bgc = Image.new('RGBA', st.size, color)
    bgc.alpha_composite(st)
    C.alpha_composite(bgc, (x, 10))
    C.alpha_composite(st, (x + st.width + 20, 10))
    C.save(os.path.join(DEBUG, name + '_check.png'))
    print('  ', os.path.relpath(os.path.join(DEBUG, name + '_check.png'), ROOT))


def entries(cfg):
    """assets.json 裡所有用照片的項目：(名字, entry)"""
    out = []
    for p in cfg['pieces']:
        if p.get('source') == 'photo':
            out.append((p['id'], p))
    for e in cfg.get('deco', []):
        out.append((os.path.splitext(os.path.basename(e['out']))[0], e))
    return out


def main(argv):
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    cfg = json.load(open(os.path.join(TOOLS, 'assets.json'), encoding='utf-8'))
    colors = {}
    try:
        import re
        for m in re.finditer(r"id:\s*'(\w+)'.*?color:\s*'(#[0-9a-fA-F]{6})'",
                             open(os.path.join(ROOT, 'js', 'pieces.js'), encoding='utf-8').read()):
            colors[m.group(1)] = m.group(2)
    except OSError:
        pass
    todo = [(n, e) for n, e in entries(cfg) if '--all' in argv or any(a in n for a in argv)]
    if not todo:
        print('用法: python tools/photo_cut.py <名字…> | --all   可以用的名字:', ', '.join(n for n, _ in entries(cfg)))
        return
    for n, e in todo:
        if not os.path.exists(os.path.join(PHOTOS, e['photo'])):
            print(f'  {n}: 找不到 tools/source/photos/{e["photo"]}')
            continue
        debug(e, n, colors.get(e.get('id'), '#3a2160'))


if __name__ == '__main__':
    main(sys.argv[1:])
