# 胖數字字型：把源泉圓體 Heavy 的數字和幾個符號「膨脹」一圈（筆畫約加粗 22%），做成很小的 woff2
# 用法（在專案根目錄）:
#   python tools/fat_digits.py
# 讀 assets/fonts/gensen-rounded-heavy.woff2，輸出 assets/fonts/plush-num.woff2（字型名稱 PlushNum）。
# 只放數字和數字旁邊會出現的符號；中文字筆畫多，加粗會糊成一團，所以不動（CSS 用 unicode-range 只拿這幾個字）。
# 做法：輪廓畫成高解析度的圖 → 距離轉換往外長 GROW 個單位（圓角會更圓）→ 描回輪廓 → TrueType 字型。
# 字寬每邊加 GROW，字跟字的間距不變；數字都一樣寬（分數跑動時不會左右晃）。
# 授權：源泉圓體是 SIL OFL 1.1，改過的版本不能用保留名稱（Source），所以叫 PlushNum。
import os
import numpy as np
import cv2
from fontTools.ttLib import TTFont
from fontTools.pens.basePen import BasePen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.fontBuilder import FontBuilder

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'fonts', 'gensen-rounded-heavy.woff2')
OUT = os.path.join(ROOT, 'assets', 'fonts', 'plush-num.woff2')
CHARS = '0123456789,.+-×/%'
GROW = 19          # 每邊往外長幾個單位（UPM 1000；數字筆畫約 170 → 約 208）
S = 4              # 每個單位幾個像素（越大輪廓越準）
EPS = 0.9          # 描回輪廓時容許的誤差（像素）


class FlatPen(BasePen):
    """把輪廓（含曲線）攤平成很多小線段。"""
    def __init__(self, glyphset):
        super().__init__(glyphset)
        self.contours, self.cur = [], None

    def _moveTo(self, p):
        self.cur = [p]

    def _lineTo(self, p):
        self.cur.append(p)

    def _curveToOne(self, p1, p2, p3):
        p0 = self.cur[-1]
        for i in range(1, 25):
            t = i / 24
            u = 1 - t
            self.cur.append((u ** 3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t ** 3 * p3[0],
                             u ** 3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t ** 3 * p3[1]))

    def _closePath(self):
        if self.cur:
            self.contours.append(self.cur)
        self.cur = None

    _endPath = _closePath


def signed_area(pts):
    return sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts))) / 2


def fatten(glyphset, name):
    """回傳膨脹後的輪廓（字型座標，已經排好方向：外框順時針、洞逆時針）。"""
    pen = FlatPen(glyphset)
    glyphset[name].draw(pen)
    if not pen.contours:
        return []
    xs = [x for c in pen.contours for x, _ in c]
    ys = [y for c in pen.contours for _, y in c]
    pad = GROW + 8
    x0, y1 = min(xs) - pad, max(ys) + pad
    w, h = int((max(xs) + pad - x0) * S) + 1, int((y1 - min(ys) + pad) * S) + 1
    img = np.zeros((h, w), np.uint8)
    pts = [np.array([[(x - x0) * S * 16, (y1 - y) * S * 16] for x, y in c], np.int32) for c in pen.contours]
    cv2.fillPoly(img, pts, 255, lineType=cv2.LINE_8, shift=4)
    # 到最近筆畫的距離 ≤ GROW 的地方都算筆畫（= 用圓形往外長，轉角變得更圓）
    dist = cv2.distanceTransform(255 - img, cv2.DIST_L2, cv2.DIST_MASK_PRECISE)
    fat = np.where(dist <= GROW * S, 255, 0).astype(np.uint8)
    found, hier = cv2.findContours(fat, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    out = []
    for i, c in enumerate(found):
        c = cv2.approxPolyDP(c, EPS, True).reshape(-1, 2)
        p = [(round(px / S + x0), round(y1 - py / S)) for px, py in c]
        p = [q for k, q in enumerate(p) if q != p[k - 1]]
        if len(p) < 3:
            continue
        hole = hier[0][i][3] >= 0
        if (signed_area(p) > 0) != hole:      # 外框要面積 < 0（順時針），洞要 > 0
            p = p[::-1]
        out.append(p)
    return out


def main():
    src = TTFont(SRC)
    gs, cmap, hmtx = src.getGlyphSet(), src.getBestCmap(), src['hmtx']
    order, cmap_out, glyphs, metrics = ['.notdef', 'space'], {32: 'space'}, {}, {}
    for n, ch in (('.notdef', '0'), ('space', ' ')):
        glyphs[n] = TTGlyphPen(None).glyph()
        metrics[n] = (hmtx[cmap[ord(ch)]][0] + (2 * GROW if ch != ' ' else 0), 0)
    for ch in CHARS:
        g = cmap.get(ord(ch))
        if not g:
            print('  沒有這個字：', ch)
            continue
        contours = fatten(gs, g)
        pen = TTGlyphPen(None)
        for p in contours:
            pen.moveTo((p[0][0] + GROW, p[0][1]))
            for x, y in p[1:]:
                pen.lineTo((x + GROW, y))
            pen.closePath()
        name = 'n%04X' % ord(ch)
        order.append(name)
        cmap_out[ord(ch)] = name
        glyphs[name] = pen.glyph()
        metrics[name] = (hmtx[g][0] + 2 * GROW, min(x for p in contours for x, _ in p) + GROW)
    fb = FontBuilder(src['head'].unitsPerEm, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap(cmap_out)
    fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics(metrics)
    os2, hhea = src['OS/2'], src['hhea']
    fb.setupHorizontalHeader(ascent=hhea.ascent, descent=hhea.descent)
    fb.setupNameTable({
        'familyName': 'PlushNum', 'styleName': 'Regular',
        'copyright': "Copyright 2014-2019 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source'. "
                     'Modified from GenSenRounded2 TW by ButTaiwan (https://github.com/ButTaiwan/gensen-font).',
        'licenseDescription': 'This Font Software is licensed under the SIL Open Font License, Version 1.1.',
        'licenseInfoURL': 'https://openfontlicense.org',
    })
    fb.setupOS2(sTypoAscender=os2.sTypoAscender, sTypoDescender=os2.sTypoDescender, sTypoLineGap=os2.sTypoLineGap,
                usWinAscent=os2.usWinAscent, usWinDescent=os2.usWinDescent, usWeightClass=400, fsSelection=0x40,
                achVendID='NONE')
    fb.setupPost()
    fb.font.flavor = 'woff2'
    fb.save(OUT)
    print(f'  {os.path.basename(OUT)}: {len(order) - 2} glyphs, {os.path.getsize(OUT)} bytes')


if __name__ == '__main__':
    main()
