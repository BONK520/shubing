# 檢查用總覽圖：六隻貼紙放在各自的方塊底色上（256px 和 64px）、三寶合照、標題圖、轉盤幾格、一小塊盤面
# 用法（在專案根目錄）: python tools/contact_sheet.py [輸出.png=tools/out/contact.png]
import json, os, random, sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

TOOLS = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(TOOLS)
# 和 js/pieces.js（SPEC §2.1）一樣的底色
COLORS = {'dog': '#8fd3ff', 'sloth': '#9be8c8', 'egg': '#ffb3d1', 'bunny': '#c9b6ff', 'frog': '#ffe08a', 'moodeng': '#ffc49b'}
NAMES = {'dog': '皮蛋', 'sloth': '薯餅', 'egg': '蛋黃哥', 'bunny': '兔兔', 'frog': '呱呱', 'moodeng': '彈跳豬'}
BOARD = (43, 22, 74)


def font(sz):
    for f in ('C:/Windows/Fonts/msjhbd.ttc', 'C:/Windows/Fonts/msjh.ttc', '/System/Library/Fonts/PingFang.ttc',
              '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc'):
        if os.path.exists(f):
            return ImageFont.truetype(f, sz)
    return ImageFont.load_default()


def rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def tile(sz, col, r=None):
    """光滑圓角方塊（近似遊戲裡的樣子）：底色 + 上半部亮光 + 下緣暗邊"""
    r = r or sz // 5
    t = Image.new('RGBA', (sz, sz), (0, 0, 0, 0))
    d = ImageDraw.Draw(t)
    c = rgb(col)
    dark = tuple(int(v * 0.78) for v in c)
    d.rounded_rectangle((0, 0, sz - 1, sz - 1), r, fill=dark + (255,))
    d.rounded_rectangle((0, 0, sz - 1, sz - 1 - max(2, sz // 24)), r, fill=c + (255,))
    hl = Image.new('RGBA', (sz, sz), (0, 0, 0, 0))
    ImageDraw.Draw(hl).rounded_rectangle((sz * 0.1, sz * 0.05, sz * 0.9, sz * 0.45), r * 0.8, fill=(255, 255, 255, 70))
    t.alpha_composite(hl.filter(ImageFilter.GaussianBlur(sz / 30)))
    return t


def put(canvas, im, x, y, sz):
    a = im.resize((sz, sz), Image.LANCZOS) if im.size != (sz, sz) else im
    canvas.alpha_composite(a, (int(x), int(y)))


def main(out=None):
    out = out or os.path.join(TOOLS, 'out', 'contact.png')
    man = json.load(open(os.path.join(ROOT, 'assets', 'manifest.json'), encoding='utf-8'))
    ids = [p['id'] for p in man['pieces']]
    spr = {i: Image.open(os.path.join(ROOT, f'assets/sprites/{i}.png')).convert('RGBA') for i in ids}
    spin = {i: Image.open(os.path.join(ROOT, f'assets/sprites/{i}_spin.webp')).convert('RGBA') for i in ids}
    trio = Image.open(os.path.join(ROOT, man['trio'])).convert('RGBA')
    hero = Image.open(os.path.join(ROOT, man['hero'])).convert('RGBA')
    S = man['spin']['size']; cols = man['spin']['cols']
    W = 40 + 6 * 290
    H = 2200
    C = Image.new('RGBA', (W, H), BOARD + (255,))
    # 背景：深紫漸層 + 淡淡的圓點
    g = Image.new('RGBA', (W, H)); gd = ImageDraw.Draw(g)
    for y in range(H):
        k = y / H
        gd.line((0, y, W, y), fill=(int(58 - 20 * k), int(28 - 8 * k), int(96 - 26 * k), 255))
    C.alpha_composite(g)
    d = ImageDraw.Draw(C)
    f1, f2 = font(30), font(20)
    d.text((40, 18), '毛絨消消樂 素材總覽（256px / 64px / 48px，底色 = 方塊顏色）', font=f1, fill='white')
    y0 = 70
    for k, i in enumerate(ids):
        x = 40 + k * 290
        C.alpha_composite(tile(256, COLORS.get(i, '#cccccc')), (x, y0))
        put(C, spr[i], x, y0, 256)
        tag = ('暫代 ' if next(p for p in man['pieces'] if p['id'] == i)['placeholder'] else '掃描 ') + NAMES.get(i, i)
        d.text((x, y0 + 262), f'{tag}  ({i})', font=f2, fill='white')
        C.alpha_composite(tile(64, COLORS.get(i, '#ccc')), (x, y0 + 300)); put(C, spr[i], x, y0 + 300, 64)
        C.alpha_composite(tile(48, COLORS.get(i, '#ccc')), (x + 80, y0 + 308)); put(C, spr[i], x + 80, y0 + 308, 48)
        C.alpha_composite(tile(36, COLORS.get(i, '#ccc')), (x + 144, y0 + 314)); put(C, spr[i], x + 144, y0 + 314, 36)
    # 轉盤：每隻 6 格（0, 3, 6, 12, 18, 21）
    y1 = y0 + 400
    d.text((40, y1 - 40), '轉盤序列（第 0 / 3 / 6 / 12 / 18 / 21 格，96px）', font=f2, fill='white')
    for k, i in enumerate(ids):
        for j, fr in enumerate((0, 3, 6, 12, 18, 21)):
            cell = spin[i].crop(((fr % cols) * S, (fr // cols) * S, (fr % cols + 1) * S, (fr // cols + 1) * S))
            x = 40 + j * 102 + (k % 2) * 870; y = y1 + (k // 2) * 108
            C.alpha_composite(tile(96, COLORS.get(i, '#ccc')), (x, y)); put(C, cell, x, y, 96)
    # 三寶合照（彩色炸彈）：彩虹球上
    y2 = y1 + 3 * 108 + 60
    d.text((40, y2 - 40), '三寶合照 trio.png（384 / 64 / 48，彩虹球上）+ 標題圖 hero.png', font=f2, fill='white')
    orb = Image.new('RGBA', (384, 384), (0, 0, 0, 0)); od = ImageDraw.Draw(orb)
    rainbow = ['#ff6b8b', '#ffb347', '#ffe066', '#7ee081', '#5ec8ff', '#a78bfa']
    for a in range(0, 360, 2):
        od.pieslice((8, 8, 376, 376), a, a + 3, fill=rainbow[(a // 60) % 6])
    orb = orb.filter(ImageFilter.GaussianBlur(18))
    m = Image.new('L', (384, 384), 0); ImageDraw.Draw(m).ellipse((8, 8, 376, 376), fill=255)
    orb.putalpha(m)
    for sz, x in ((384, 40), (64, 444), (48, 524)):
        C.alpha_composite(orb.resize((sz, sz), Image.LANCZOS), (x, y2)); put(C, trio, x, y2, sz)
    hw = W - 640; hh = int(hw * hero.size[1] / hero.size[0])
    C.alpha_composite(hero.resize((hw, hh), Image.LANCZOS), (600, y2))
    # 一小塊盤面（56px 方格，像手機上的大小）
    y3 = y2 + max(400, hh + 20) + 40
    d.text((40, y3 - 40), '盤面模擬（每格 56px，約手機 2x 螢幕的實際大小）', font=f2, fill='white')
    rnd = random.Random(3)
    cell = 56; n = 8
    panel = Image.new('RGBA', (cell * n + 24, cell * n + 24), (0, 0, 0, 0))
    ImageDraw.Draw(panel).rounded_rectangle((0, 0, panel.size[0] - 1, panel.size[1] - 1), 22, fill=(255, 255, 255, 40))
    C.alpha_composite(panel, (40, y3))
    for r in range(n):
        for c in range(n):
            x, y = 52 + c * cell, y3 + 12 + r * cell
            if (r + c) % 2 == 0:
                ImageDraw.Draw(C).rectangle((x, y, x + cell - 1, y + cell - 1), fill=(255, 255, 255, 18))
            i = ids[rnd.randrange(len(ids))]
            if r == 3 and c == 4:
                C.alpha_composite(orb.resize((cell - 4, cell - 4), Image.LANCZOS), (x + 2, y + 2)); put(C, trio, x + 2, y + 2, cell - 4)
                continue
            C.alpha_composite(tile(cell - 4, COLORS.get(i, '#ccc'), r=12), (x + 2, y + 2))
            put(C, spr[i], x + 2, y + 2, cell - 4)
    # 同一塊盤面縮成 40px（小手機 1x）
    cell = 40
    bx = 40 + 56 * 8 + 60
    rnd = random.Random(3)
    for r in range(n):
        for c in range(n):
            x, y = bx + c * cell, y3 + 12 + r * cell
            i = ids[rnd.randrange(len(ids))]
            if r == 3 and c == 4:
                C.alpha_composite(orb.resize((cell - 2, cell - 2), Image.LANCZOS), (x + 1, y + 1)); put(C, trio, x + 1, y + 1, cell - 2)
                continue
            C.alpha_composite(tile(cell - 2, COLORS.get(i, '#ccc'), r=8), (x + 1, y + 1))
            put(C, spr[i], x + 1, y + 1, cell - 2)
    H2 = y3 + 56 * 8 + 60
    C = C.crop((0, 0, W, H2))
    C.convert('RGB').save(out, quality=92)
    print('  總覽圖:', os.path.relpath(out, ROOT))


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    main(sys.argv[1] if len(sys.argv) > 1 else None)
