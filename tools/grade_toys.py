# 照片調色：所有玩具用同一套色彩平衡，讓色溫、亮點、暗點對齊（放在同一個盤面上才像同一組照片）
#
# 每隻玩具量一次參考圖（盤面用的 <id>_n.png），同一組參數套到那隻的所有圖（貼紙、旋轉序列）：
#   1. 白平衡：低彩度的亮部（白毛、白殼、反光）對齊同一個暖白 WARM_WHITE。只往暖的方向修
#      （偏冷、偏藍的拉回來，本來就偏暖的不會被修冷），每個色版最多改 MAX_GAIN。
#   2. 黑白點：亮點（第 HIGH_PCT 百分位的亮度）不到 WHITE 的拉到 WHITE；暗點（第 LOW_PCT 百分位）往 BLACK 靠
#      BLACK_PULL 的比例（本來就夠黑的不動），對比最多加到 MAX_STRETCH 倍。
#   3. 暗部：低彩度的暗部往同一個暖的深色靠（SHADOW_TINT，深焦糖 / 深玫瑰，不偏藍紫），越暗越明顯。
# 裝飾貼紙（assets/deco/）和三寶合照（trio.png）每張自己量自己調。
#
# 調過的檔案記在 tools/graded.json（調完的 sha1 + 參數），重跑只調新做出來的檔案，不會疊兩次。
# build_assets.py 後製完會自動跑；沒有原始檔、只想重調現成的圖時：
#   python tools/grade_toys.py            # 調 assets/ 裡還沒調過的圖
#   python tools/grade_toys.py --check    # 只量、輸出 tools/out/grade.png（每組左邊調色前、右邊調色後），不改檔
import argparse, hashlib, json, os, sys
import numpy as np
from PIL import Image

TOOLS = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(TOOLS)
STATE = os.path.join(TOOLS, 'graded.json')

WARM_WHITE = (1.0, 0.984, 0.957)   # 亮部的目標色（比例，sRGB）：一點點暖的白，約 (255, 251, 244)
MAX_GAIN = 0.08                    # 白平衡每個色版最多 ±8%（線性光）
NEUTRAL = 0.2                      # 彩度（(max - min) / max）低於這個算「沒有顏色」的像素
HIGH_PCT, LOW_PCT = 99.7, 0.3
WHITE, BLACK = 0.985, 0.06
BLACK_PULL, MAX_STRETCH = 0.6, 1.12
SHADOW_TINT = (1.04, 0.985, 0.95)  # 暗部的目標色比例
SHADOW_PULL, SHADOW_RANGE = 0.7, 0.5
LUMA = np.array([0.2126, 0.7152, 0.0722])


def srgb_to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(c):
    c = np.clip(c, 0, None)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def load(path):
    return np.asarray(Image.open(path).convert('RGBA'), dtype=np.float32) / 255.0


def body(a):
    """量測用的像素：幾乎不透明、離去背邊緣兩格（避開毛邊）"""
    from scipy.ndimage import binary_erosion
    m = binary_erosion(a[..., 3] > 0.9, iterations=2)
    return a[..., :3][m]


def measure(px):
    """px：N×3 的 sRGB（0..1）→ 調色參數"""
    mx, mn = px.max(1), px.min(1)
    neutral = (mx - mn) / np.maximum(mx, 1e-4) < NEUTRAL
    enough = neutral.sum() >= max(40, 0.003 * len(px))
    g = np.ones(3)
    if enough:
        Y = px @ LUMA
        hi = neutral & (Y >= np.percentile(Y[neutral], 95))
        h = srgb_to_lin(px[hi]).mean(0)
        h = h / h.max()
        g = srgb_to_lin(np.array(WARM_WHITE)) / h
        g[0], g[2] = max(g[0], 1.0), min(g[2], 1.0)       # 只往暖的方向修
        g *= (LUMA @ h) / (LUMA @ (g * h))                 # 亮部的亮度不變
        g = np.clip(g, 1 - MAX_GAIN, 1 + MAX_GAIN)
    p = dict(gain=g, lo=0.0, lo_t=0.0, k=1.0, shadow=np.zeros(3))
    Y = apply(px, p) @ LUMA
    lo, hi = np.percentile(Y, LOW_PCT), np.percentile(Y, HIGH_PCT)
    hi_t = max(hi, WHITE)
    lo_t = lo + BLACK_PULL * (BLACK - lo) if lo > BLACK else lo
    k = (hi_t - lo_t) / max(hi - lo, 1e-3)
    if k > MAX_STRETCH:
        k = MAX_STRETCH
        lo_t = hi_t - k * (hi - lo)
    p.update(lo=lo, lo_t=lo_t, k=k)
    if enough:
        out = apply(px, p)
        Y = out @ LUMA
        sh = neutral & (Y <= np.percentile(Y[neutral], 8))
        S = out[sh].mean(0)
        if LUMA @ S < 0.45:                                # 真的是暗部才調（白貓這種沒有暗的灰）
            t = np.array(SHADOW_TINT)
            p['shadow'] = np.clip(((LUMA @ S) * t / (LUMA @ t) - S) * SHADOW_PULL, -0.04, 0.04)
    return p


def apply(px, p):
    out = lin_to_srgb(srgb_to_lin(px) * p['gain'])
    out = p['lo_t'] + (out - p['lo']) * p['k']
    w = np.clip(1 - (out @ LUMA) / SHADOW_RANGE, 0, 1) ** 2
    return np.clip(out + w[..., None] * p['shadow'], 0, 1)


def grade_image(a, p):
    out = a.copy()
    m = a[..., 3] > 0
    out[..., :3][m] = apply(a[..., :3][m], p)
    return out


def save(a, path, quality):
    im = Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGBA')
    if path.endswith('.webp'):
        im.save(path, 'WEBP', quality=quality, method=6, alpha_quality=90)
    else:
        im.save(path, 'PNG', optimize=True)


def sha1(path):
    return hashlib.sha1(open(path, 'rb').read()).hexdigest()


def jobs(cfg):
    """[(群組名, 參考圖, [(檔案, webp 品質)])]"""
    spr = lambda n: os.path.join('assets', 'sprites', n)
    q = cfg.get('spin', {}).get('webpQuality', 85)
    out = []
    for p in cfg['pieces']:
        i = p['id']
        files = [(spr(f'{i}_n.png'), 0), (spr(f'{i}.png'), 0), (spr(f'{i}_spin.webp'), q), (spr(f'{i}_spin_n.webp'), q)]
        out.append((i, spr(f'{i}_n.png'), [f for f in files if os.path.exists(os.path.join(ROOT, f[0]))]))
    out.append(('trio', spr('trio.png'), [(spr('trio.png'), 0)]))
    for e in cfg.get('deco', []):
        if e.get('kind') != 'photo':                       # 3D 看看頁的照片卡片（有背景的原照片）不調
            out.append((e['out'], e['out'], [(e['out'], e.get('quality', 82))]))
    return [j for j in out if os.path.exists(os.path.join(ROOT, j[1]))]


def fmt(p):
    return dict(gain=[round(float(v), 4) for v in p['gain']], lo=round(float(p['lo']), 4), lo_t=round(float(p['lo_t']), 4),
                k=round(float(p['k']), 4), shadow=[round(float(v), 4) for v in p['shadow']])


def unfmt(d):
    return dict(gain=np.array(d['gain']), lo=d['lo'], lo_t=d['lo_t'], k=d['k'], shadow=np.array(d['shadow']))


def grade_all(cfg=None, check=False):
    cfg = cfg or json.load(open(os.path.join(TOOLS, 'assets.json'), encoding='utf-8'))
    state = json.load(open(STATE, encoding='utf-8')) if os.path.exists(STATE) else {'files': {}, 'params': {}}
    pairs, n = [], 0
    for name, ref, files in jobs(cfg):
        todo = [(f, q) for f, q in files if state['files'].get(f.replace(os.sep, '/')) != sha1(os.path.join(ROOT, f))]
        ref_new = any(f == ref for f, _ in todo)
        if ref_new or name not in state['params']:
            p = measure(body(load(os.path.join(ROOT, ref))))
        else:
            p = unfmt(state['params'][name])               # 參考圖調過了：用當時的參數（同一隻玩具的圖要一致）
        if check:
            a = load(os.path.join(ROOT, ref))
            pairs.append((name, a, grade_image(a, p) if ref_new else a, fmt(p)))
            continue
        for f, q in todo:
            path = os.path.join(ROOT, f)
            save(grade_image(load(path), p), path, q)
            state['files'][f.replace(os.sep, '/')] = sha1(path)
            n += 1
        if todo:
            state['params'][name] = fmt(p)
            print(f'  {name}: 調了 {len(todo)} 張', fmt(p))
    if check:
        for name, _, _, p in pairs:
            print(f'  {name}:', p)
        sheet(pairs, os.path.join(TOOLS, 'out', 'grade.png'))
        return
    if n:
        state['files'] = dict(sorted(state['files'].items()))
        with open(STATE, 'w', encoding='utf-8') as f:
            json.dump(state, f, ensure_ascii=False, indent=1, sort_keys=True)
            f.write('\n')
    print(f'  調色：{n} 張' if n else '  調色：全部都調過了')


def sheet(pairs, path, cell=200):
    """每組兩格（左：調色前、右：調色後），上排灰底、下排盤面的深藍底"""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    W = len(pairs) * (cell * 2 + 16)
    out = Image.new('RGB', (W, cell * 2), (128, 128, 128))
    out.paste((38, 42, 96), (0, cell, W, cell * 2))
    for i, (_, a, b, _) in enumerate(pairs):
        for j, im in enumerate((a, b)):
            t = Image.fromarray((im * 255 + 0.5).astype(np.uint8), 'RGBA')
            t.thumbnail((cell - 8, cell - 8), Image.LANCZOS)
            x = i * (cell * 2 + 16) + j * cell + (cell - t.width) // 2
            for row in (0, 1):
                out.paste(t, (x, row * cell + (cell - t.height) // 2), t)
    out.save(path)
    print('  總覽圖', os.path.relpath(path, ROOT))


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description='統一玩具照片的色溫和黑白點')
    ap.add_argument('--check', action='store_true', help='只量、輸出 tools/out/grade.png，不改檔')
    a = ap.parse_args()
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    grade_all(check=a.check)
