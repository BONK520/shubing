# 貼紙風後製：白色描邊（膨脹 alpha 後圓滑）、柔和陰影、透明背景
# build_assets.py 會 import 這個檔；也可以單獨試一張:
#   python tools/postprocess.py <輸入.png> <輸出.png> [尺寸=256]
#
# 所有運算都在「輸出尺寸 x K」的大畫布上做（預設 K=3），最後用預乘 alpha 縮小，邊緣才會乾淨。
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

# 以 256px 方塊為基準的參數，其他尺寸等比例縮放
OUTLINE = 6.0        # 白邊粗細
SMOOTH = 5.0         # 白邊外形的圓滑半徑（會填平窄縫和尖角）
SHADOW_BLUR = 3.2    # 陰影模糊（高斯 sigma）
SHADOW_DY = 3.5      # 陰影往下偏移
SHADOW_A = 0.42      # 陰影不透明度
SHADOW_RGB = (46, 20, 70)    # 深紫色陰影，放在任何底色上都自然
EDGE_A = 0.22        # 白邊外緣一圈很細的深色線，讓白邊在淺色底上也看得清楚
FILL = 0.84          # 玩具（含白邊）佔方塊的比例


# ---------------------------------------------------------------- 基本
def to_np(im):
    return np.asarray(im.convert('RGBA'), dtype=np.float32) / 255.0


def to_im(a):
    return Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGBA')


def bbox(a, thr=0.03):
    """alpha 的外框 (x0, y0, x1, y1)，像素座標（x1/y1 不含）"""
    ys, xs = np.where(a[..., 3] > thr)
    if len(xs) == 0:
        return (0, 0, a.shape[1], a.shape[0])
    return (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)


def resample(a, scale, ox, oy, W, H):
    """把 a 縮放 scale 倍再平移 (ox, oy) 放進 W x H 畫布（預乘 alpha，避免黑邊）"""
    h, w = a.shape[:2]
    pm = a.copy(); pm[..., :3] *= pm[..., 3:4]
    inv = 1.0 / scale
    # 仿射：輸出 (x, y) <- 輸入 ((x - ox) / s, (y - oy) / s)
    out = np.zeros((H, W, 4), np.float32)
    big = scale > 1
    for c in range(4):
        im = Image.fromarray(pm[..., c], 'F')
        if not big:   # 縮小先用高品質 resize，再做次像素平移
            nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
            im = im.resize((nw, nh), Image.LANCZOS)
            sx, sy = w / nw, h / nh
            ax, ay = 1 / (scale * sx), 1 / (scale * sy)
            im = im.transform((W, H), Image.AFFINE, (ax, 0, -ox * ax, 0, ay, -oy * ay), Image.BILINEAR)
        else:
            im = im.transform((W, H), Image.AFFINE, (inv, 0, -ox * inv, 0, inv, -oy * inv), Image.BICUBIC)
        out[..., c] = np.asarray(im)
    out[..., 3] = np.clip(out[..., 3], 0, 1)
    rgb = np.where(out[..., 3:4] > 1e-4, out[..., :3] / np.maximum(out[..., 3:4], 1e-4), 0)
    out[..., :3] = np.clip(rgb, 0, 1)
    return out


def downsample(a, W, H):
    pm = a.copy(); pm[..., :3] *= pm[..., 3:4]
    out = np.stack([np.asarray(Image.fromarray(pm[..., c], 'F').resize((W, H), Image.LANCZOS)) for c in range(4)], -1)
    out[..., 3] = np.clip(out[..., 3], 0, 1)
    out[..., :3] = np.clip(np.where(out[..., 3:4] > 1e-4, out[..., :3] / np.maximum(out[..., 3:4], 1e-4), 0), 0, 1)
    return out


def rotate(a, deg):
    """以中心旋轉（逆時針為正），畫布自動加大，預乘 alpha"""
    if not deg:
        return a
    pm = a.copy(); pm[..., :3] *= pm[..., 3:4]
    ch = [np.asarray(Image.fromarray(pm[..., c], 'F').rotate(deg, Image.BICUBIC, expand=True)) for c in range(4)]
    out = np.stack(ch, -1)
    out[..., 3] = np.clip(out[..., 3], 0, 1)
    out[..., :3] = np.clip(np.where(out[..., 3:4] > 1e-4, out[..., :3] / np.maximum(out[..., 3:4], 1e-4), 0), 0, 1)
    return out


def over(top, bot):
    """top 疊在 bot 上（都是非預乘 RGBA）"""
    ta, ba = top[..., 3:4], bot[..., 3:4]
    oa = ta + ba * (1 - ta)
    rgb = (top[..., :3] * ta + bot[..., :3] * ba * (1 - ta)) / np.maximum(oa, 1e-6)
    return np.concatenate([rgb, oa], -1)


# ---------------------------------------------------------------- 調色（只給皮蛋這種很暗的黑色玩具用）
def grade(a, g):
    """g: {gamma, gain, lift, contrast, sat, tint:[r,g,b]}；只動顏色不動 alpha"""
    if not g:
        return a
    a = a.copy(); rgb = a[..., :3]
    rgb = rgb * g.get('gain', 1.0) + g.get('lift', 0.0)
    rgb = np.clip(rgb, 0, 1) ** g.get('gamma', 1.0)
    c = g.get('contrast', 1.0)
    if c != 1.0:
        m = (rgb * a[..., 3:4]).sum((0, 1)) / max(a[..., 3].sum(), 1)
        rgb = (rgb - m.mean()) * c + m.mean()
    s = g.get('sat', 1.0)
    if s != 1.0:
        l = (rgb @ np.array([0.2126, 0.7152, 0.0722]))[..., None]
        rgb = l + (rgb - l) * s
    if 'tint' in g:
        rgb = rgb * np.array(g['tint'], np.float32)
    a[..., :3] = np.clip(rgb, 0, 1)
    return a


# ---------------------------------------------------------------- 貼紙
def outline_alpha(alpha, r, smooth):
    """alpha 膨脹 r、再用 smooth 做閉運算（圓滑外形），回傳柔邊 0..1"""
    m = alpha > 0.5
    d_out = ndimage.distance_transform_edt(~m)               # 物體外每點到物體的距離
    grown = d_out <= r + smooth
    d_in = ndimage.distance_transform_edt(grown)             # 膨脹區內每點到外面的距離
    soft = np.clip(d_in - smooth + 0.5, 0, 1)
    return np.maximum(soft, alpha)


def stickerize(a, unit, outline=OUTLINE, smooth=SMOOTH, shadow=True, edge=EDGE_A):
    """a: 已經放好位置的大畫布 RGBA；unit = 「256px 方塊的 1px」在這張畫布上是幾 px"""
    H, W = a.shape[:2]
    ol = outline_alpha(a[..., 3], outline * unit, smooth * unit)
    white = np.zeros_like(a); white[..., :3] = 1.0; white[..., 3] = ol
    out = over(a, white)
    if edge:
        # 白邊外緣的細深色線（約 1px），淺色底上也分得出貼紙邊
        rim = np.clip(ndimage.gaussian_filter(ol, 1.1 * unit), 0, 1) * (1 - ol)
        e = np.zeros_like(a); e[..., :3] = np.array(SHADOW_RGB) / 255; e[..., 3] = rim * edge
        out = over(out, e)
    if shadow:
        sh = ndimage.gaussian_filter(ol, SHADOW_BLUR * unit)
        sh = ndimage.shift(sh, (SHADOW_DY * unit, 0), order=1, mode='constant')
        s = np.zeros_like(a); s[..., :3] = np.array(SHADOW_RGB) / 255; s[..., 3] = sh * SHADOW_A
        out = over(out, s)
    return out


def fit_transform(bb, box_w, box_h, unit, fill=FILL, outline=OUTLINE):
    """回傳 (scale, ox, oy)：把 bb 放大縮小後置中，連白邊佔 fill"""
    bw, bh = bb[2] - bb[0], bb[3] - bb[1]
    pad = 2 * (outline + 0.5) * unit
    s = min((box_w * fill - pad) / bw, (box_h * fill - pad) / bh)
    ox = box_w / 2 - (bb[0] + bb[2]) / 2 * s
    oy = box_h / 2 - (bb[1] + bb[3]) / 2 * s
    return s, ox, oy


def sprite(render, size=256, K=3, fill=FILL, g=None, transform=None, outline=OUTLINE):
    """一張渲染圖 -> 一張貼紙（size x size）。transform 可以指定 (scale, ox, oy)（以 size 為單位）"""
    a = grade(to_np(render), g)
    W = size * K; unit = size / 256 * K
    if transform is None:
        s, ox, oy = fit_transform(bbox(a), W, W, unit, fill, outline)
    else:
        s, ox, oy = transform[0] * K, transform[1] * K, transform[2] * K
    big = resample(a, s, ox, oy, W, W)
    return to_im(downsample(stickerize(big, unit, outline=outline), size, size))


def toonify(a):
    """照片 → 「發光的塑膠公仔」：保留邊緣的磨皮（去掉布料雜訊）、暗部拉亮、飽和度和局部對比提高。
    a：float RGBA（0..1）。透明的地方先用周圍顏色補滿，磨皮時邊緣才不會帶進黑邊。"""
    import cv2
    rgb, al = a[..., :3], a[..., 3:4]
    w = cv2.GaussianBlur(al[..., 0], (0, 0), 4)[..., None]
    fill = cv2.GaussianBlur(rgb * al, (0, 0), 4) / np.maximum(w, 1e-4)
    base = np.where(al > 0.5, rgb, np.clip(fill, 0, 1))
    u8 = (base * 255 + 0.5).astype(np.uint8)
    sz = max(u8.shape[:2])
    d = 7 if sz < 600 else 11
    sm = cv2.bilateralFilter(u8, d, 45, d)
    sm = cv2.bilateralFilter(sm, d, 35, d)
    hsv = cv2.cvtColor(sm, cv2.COLOR_RGB2HSV).astype(np.float32)
    v = hsv[..., 2] / 255.0
    v = np.power(v, 0.66)                                   # 暗部拉亮（整體亮約 25%）
    clahe = cv2.createCLAHE(clipLimit=1.6, tileGridSize=(4, 4))
    v8 = clahe.apply((v * 255).astype(np.uint8)).astype(np.float32) / 255.0
    v = 0.6 * v + 0.4 * v8                                  # 一點局部對比
    hsv[..., 2] = np.clip(v * 255 * 1.05, 0, 255)
    hsv[..., 1] = np.clip(hsv[..., 1] * 1.48 + 8, 0, 255)  # 飽和度
    out = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2RGB).astype(np.float32) / 255.0
    return np.concatenate([out, al], -1)


LUM = np.array([0.2126, 0.7152, 0.0722], np.float32)
# 「遊戲光」的參數（以 256px 方塊為基準）
TOY = dict(
    smooth=5.0,     # 磨皮：保留邊緣的平滑（px），把布料的毛躁雜訊抹掉，看起來像光滑的公仔
    detail=0.3,     # 磨掉的細節再補回多少（0 = 全部抹平）
    black=0.14,     # 色階：最暗的 2% 拉到至少這麼亮（沒有死黑）
    white=0.97,     #       最亮的 2% 拉到至少這麼亮（本來就很亮的不動，不會爆掉）
    gamma=0.88,     # 中間調提亮
    contrast=0.28,  # S 曲線（一點對比，顏色才有精神）
    vib=0.45,       # 低飽和的地方多加飽和（髒灰變乾淨）
    sat=1.12,       # 整體飽和度
    rim=1.0,        # 面向光那一側的暖白色邊緣光
    rim_w=7.0,      # 邊緣光往內多寬（px）
    shade=0.24,     # 背光那一側的邊緣陰影（紫色調，不是灰）
    sheen=0.26,     # 左上一片柔和的光澤（像塑膠表面）
    spec=0.35,      # 光澤中間一個比較小、比較亮的反光點
    feather=0.55,   # 邊緣柔化（高斯 sigma，px）
    light=(-0.35, -0.94),   # 光從哪裡來（螢幕座標，往上偏左，跟遊戲裡糖果的反光同一邊）
)


def toyify(a, unit, **kw):
    """照片 / 掃描玩具 → 「發光世界裡的玩具」第二步（toonify 之後，在放好位置的大畫布上做）：
    去掉去背留下的白邊黑邊、邊緣柔一點；磨皮；暗部拉亮、加對比、髒灰變乾淨；面向光的邊緣加暖白色的邊緣光、
    背光的邊緣加一點紫色陰影（有體積）；左上一片柔和光澤。unit = 256px 方塊的 1px 在這張畫布上是幾 px"""
    p = {**TOY, **kw}
    rgb, al = a[..., :3], a[..., 3]
    solid = al > 0.5
    if not solid.any():
        return a
    # 1) 邊緣：半透明那一圈（再往內 1px）換成更裡面的顏色，不會留下背景的白邊或黑邊
    core = ndimage.distance_transform_edt(al >= 0.98) > 1.0 * unit
    if core.any():
        _, (iy, ix) = ndimage.distance_transform_edt(~core, return_indices=True)
        rgb = np.where(core[..., None], rgb, rgb[iy, ix])
    al = np.clip(ndimage.gaussian_filter(al, p['feather'] * unit), 0, 1)
    # 2) 磨皮（保留邊緣）：布料的毛躁抹平，只補回一點細節
    if p['smooth'] > 0:
        import cv2
        u8 = (np.clip(rgb, 0, 1) * 255 + 0.5).astype(np.uint8)
        sm8 = cv2.edgePreservingFilter(u8, flags=cv2.RECURS_FILTER, sigma_s=float(p['smooth'] * unit), sigma_r=0.32)
        smf = sm8.astype(np.float32) / 255
        rgb = smf + (np.clip(rgb, 0, 1) - smf) * p['detail']
    # 3) 亮度和顏色：每隻玩具自己的色階（只往亮的方向拉）、中間調提亮、S 曲線加對比
    l0 = rgb @ LUM
    lo, hi = np.percentile(l0[solid], [2, 98])
    b, w = max(p['black'], lo), max(p['white'], hi)
    rgb = np.clip(b + (rgb - lo) * (w - b) / max(hi - lo, 0.1), 0, 1) ** p['gamma']
    rgb = rgb + (rgb * rgb * (3 - 2 * rgb) - rgb) * p['contrast']
    mx, mn = rgb.max(-1), rgb.min(-1)
    sat = (mx - mn) / np.maximum(mx, 1e-4)
    l = (rgb @ LUM)[..., None]
    rgb = l + (rgb - l) * (p['sat'] + p['vib'] * (1 - sat))[..., None]
    # 4) 形體：從 alpha 估向外的法線（只在靠近邊緣的地方用得到）
    d = ndimage.distance_transform_edt(solid) / unit
    sm = ndimage.gaussian_filter(al, 2.5 * unit)
    gy, gx = np.gradient(sm)
    n = np.hypot(gx, gy) + 1e-6
    lx, ly = p['light']
    dot = (-gx / n) * lx + (-gy / n) * ly
    band = np.clip(1 - d / p['rim_w'], 0, 1) ** 1.5
    rim = band * np.clip(dot, 0, 1) ** 1.3 * p['rim']
    rgb = 1 - (1 - np.clip(rgb, 0, 1)) * (1 - np.array([1.0, 0.97, 0.88], np.float32) * rim[..., None])
    shade = np.clip(1 - d / (p['rim_w'] * 1.6), 0, 1) * np.clip(-dot, 0, 1) ** 1.2 * p['shade']
    rgb = rgb * (1 - shade[..., None] * (1 - np.array([0.55, 0.45, 0.78], np.float32)))
    # 5) 光澤：一大片柔光 + 中間一個比較小的亮點
    ys, xs = np.nonzero(solid)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    cx, cy, sg = x0 + 0.36 * (x1 - x0), y0 + 0.26 * (y1 - y0), 0.3 * max(x1 - x0, y1 - y0)
    yy, xx = np.mgrid[0:rgb.shape[0], 0:rgb.shape[1]]
    r2 = ((xx - cx) ** 2 + (yy - cy) ** 2).astype(np.float32)
    gl = np.exp(-r2 / (2 * sg * sg)) * p['sheen'] + np.exp(-r2 / (2 * (sg * 0.32) ** 2)) * p['spec']
    rgb = 1 - (1 - np.clip(rgb, 0, 1)) * (1 - np.clip(gl, 0, 1)[..., None])
    return np.concatenate([np.clip(rgb, 0, 1), al[..., None]], -1).astype(np.float32)


def sprite_clean(render, size=256, K=3, fill=0.9, g=None, transform=None, toon=True, toy=None):
    """沒有白邊、沒有陰影的玩具圖（盤面上放進糖果裡用；陰影和發光邊由遊戲畫）。toon：塑膠公仔化 + 遊戲光。
    toy：覆蓋 TOY 的參數；裡面放 "toonify": False 就不做 toonify（皮蛋這種黑色玩具做了會整片變灰紫色、像起霧）"""
    toy = dict(toy or {})
    pre = toy.pop('toonify', True)
    a = grade(to_np(render), g)
    if toon and pre:
        a = toonify(a)
    W = size * K; unit = size / 256 * K
    if transform is None:
        s, ox, oy = fit_transform(bbox(a), W, W, unit, fill, outline=0)
    else:
        s, ox, oy = transform[0] * K, transform[1] * K, transform[2] * K
    big = resample(a, s, ox, oy, W, W)
    if toon:
        big = toyify(big, unit, **toy)
    return to_im(downsample(big, size, size))


def retoy(im, size=None, K=3):
    """已經做好的沒白邊玩具圖（沒有原始照片時）再補上 toyify：放大 K 倍做完再縮回來"""
    a = to_np(im)
    h, w = a.shape[:2]
    big = resample(a, K, 0, 0, w * K, h * K)
    unit = (size or max(w, h)) / 256 * K
    return to_im(downsample(toyify(big, unit), w, h))


def spin_transform(frames, static_bb, static_wh, size=192, fill=FILL, margin=7.0, outline=OUTLINE):
    """轉盤序列的固定構圖。frames: 每格的 RGBA numpy（同一個相機）；static_bb: 靜態圖的 bbox。
    讓第 0 格盡量和靜態貼紙一樣大、一樣位置，但所有格都要放得下。回傳 ((scale, ox, oy), 和靜態比的縮放)"""
    fh, fw = frames[0].shape[:2]
    unit = size / 256
    k = fw / static_wh[0]                                   # 靜態渲染 px -> 序列渲染 px
    sbb = [v * k for v in static_bb]
    s0, ox0, oy0 = fit_transform(sbb, size, size, unit, fill, outline)
    bbs = np.array([bbox(f) for f in frames], float)
    u = (bbs[:, 0].min(), bbs[:, 1].min(), bbs[:, 2].max(), bbs[:, 3].max())
    m = (outline + 0.5) * unit + margin * unit
    s_fit = min((size - 2 * m) / (u[2] - u[0]), (size - 2 * m) / (u[3] - u[1]))
    s = min(s0, s_fit)
    # 縮放後，以第 0 格中心為準，但夾在讓所有格都放得下的範圍內
    cx, cy = (sbb[0] + sbb[2]) / 2, (sbb[1] + sbb[3]) / 2
    ox, oy = size / 2 - cx * s, size / 2 - cy * s
    lo_x, hi_x = m - u[0] * s, size - m - u[2] * s
    lo_y, hi_y = m - u[1] * s, size - m - u[3] * s
    ox = (lo_x + hi_x) / 2 if lo_x > hi_x else min(max(ox, lo_x), hi_x)
    oy = (lo_y + hi_y) / 2 if lo_y > hi_y else min(max(oy, lo_y), hi_y)
    return (s, ox, oy), s / s0


def sheet(frames, cols, rows, size):
    im = Image.new('RGBA', (cols * size, rows * size), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        im.paste(f, ((i % cols) * size, (i // cols) * size))
    return im


# ---------------------------------------------------------------- 合照（三寶 / 標題）
def compose(layers, W, H, K=2, unit_px=None, outline=OUTLINE, group=True, fill=None, sticker=True):
    """layers: [{img: PIL, h: 目標高度(輸出 px), cx, by: 底部中心(輸出 px), g: 調色, rot: 旋轉角度}] 由後往前。
    group=True：整組一個白邊；False：每隻各自一圈白邊（像疊起來的貼紙）。
    fill: 若給，整組再縮放置中到佔畫面 fill。
    sticker=False：不要白邊和陰影，改成和盤面玩具一樣的「遊戲光」（toonify + toyify）。回傳 PIL RGBA (W x H)"""
    unit = (unit_px if unit_px else W / 256) * K
    WW, HH = W * K, H * K
    placed = []
    for L in layers:
        a = grade(to_np(L['img']), L.get('g'))
        if not sticker:
            a = toonify(a)
        a = rotate(a, L.get('rot', 0))
        bb = bbox(a)
        s = L['h'] * K / (bb[3] - bb[1])
        ox = L['cx'] * K - (bb[0] + bb[2]) / 2 * s
        oy = L['by'] * K - bb[3] * s
        placed.append(resample(a, s, ox, oy, WW, HH))
    if fill:
        tmp = np.zeros((HH, WW, 4), np.float32)
        for p in placed:
            tmp = over(p, tmp)
        bb = bbox(tmp)
        s, ox, oy = fit_transform(bb, WW, HH, unit, fill, outline if sticker else 0)
        placed = [resample(p, s, ox, oy, WW, HH) for p in placed]
    if not sticker:
        acc = np.zeros((HH, WW, 4), np.float32)
        for p in placed:
            acc = over(p, acc)
        return to_im(downsample(toyify(acc, unit), W, H))
    if group:
        acc = np.zeros((HH, WW, 4), np.float32)
        for p in placed:
            acc = over(p, acc)
        out = stickerize(acc, unit, outline=outline)
    else:
        out = np.zeros((HH, WW, 4), np.float32)
        for i, p in enumerate(placed):
            st = stickerize(p, unit, outline=outline, shadow=True)
            out = over(st, out)
    return to_im(downsample(out, W, H))


def save_png(im, path):
    im.save(path, 'PNG', optimize=True)


def save_webp(im, path, quality=85):
    im.save(path, 'WEBP', quality=quality, method=6, alpha_quality=90)


if __name__ == '__main__':
    src, dst = sys.argv[1], sys.argv[2]
    size = int(sys.argv[3]) if len(sys.argv) > 3 else 256
    save_png(sprite(Image.open(src), size), dst)
    print('saved', dst)
