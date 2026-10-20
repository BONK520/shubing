# 舊樣式的裝飾貼紙（白邊 + 陰影）轉成新樣式（"style": "toy"：沒有白邊、遊戲光）。
# 只在手邊沒有原照片的時候用；有原照片就在 assets.json 把那一筆改成 "style": "toy"，讓 build_assets.py 重新去背。
#   python tools/strip_outline.py assets/deco/sloth_orange.webp                # 直接覆蓋
#   python tools/strip_outline.py in.webp out.webp --max 512 --light 0.62,0.5  # 另存、順便去掉邊緣淡色的背景殘塊
# 做法：從外面沿著「接近純白」的像素把白邊找出來拿掉（陰影和白邊外那圈細線本來就是半透明，會一起去掉），
# 剩下的玩具再做 photo_cut.toy_rect（和其他 toy 貼紙同一套遊戲光）。
# 白色的玩具（Snoopy）會跟白邊黏在一起被吃掉，這種的只能用原照片重新去背。
import argparse, os, sys

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage

TOOLS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, TOOLS)
import postprocess as pp
import photo_cut as pc


def largest(m):
    lab, n = ndimage.label(m)
    if n <= 1:
        return m
    return lab == 1 + int(np.argmax(ndimage.sum(m, lab, range(1, n + 1))))


def strip(im, white=0.92, light=None):
    """舊貼紙 -> 去掉白邊的玩具（float RGBA）。light = (亮度, 飽和度)：碰到邊緣、比這亮又比這灰的大塊（舊去背帶進來的背景）也拿掉"""
    a = pp.to_np(im)
    rgb, op = a[..., :3], a[..., 3] > 0.5
    wh = (rgb.min(-1) > white) & op
    lab, _ = ndimage.label(wh)
    seed = wh & (ndimage.distance_transform_edt(op) <= 3)
    ids = np.unique(lab[seed])
    toy = op & ~np.isin(lab, ids[ids > 0])
    if light:
        lum = rgb @ pp.LUM
        mx, mn = rgb.max(-1), rgb.min(-1)
        pale = (lum > light[0]) & ((mx - mn) / np.maximum(mx, 1e-4) < light[1]) & toy
        lab, n = ndimage.label(pale)
        edge = pale & (ndimage.distance_transform_edt(toy) <= 3)
        ids = [i for i in np.unique(lab[edge]) if i and (lab == i).sum() >= 150]      # 小點是毛的亮邊，不動
        rem = cv2.dilate(np.isin(lab, ids).astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))) > 0
        toy &= ~rem
    toy = cv2.morphologyEx(toy.astype(np.uint8), cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))) > 0
    toy = ndimage.binary_fill_holes(largest(toy))
    toy = ndimage.distance_transform_edt(toy) > 1.0           # 最外 1px 是玩具和白邊的混色
    alpha = cv2.GaussianBlur(toy.astype(np.float32), (0, 0), 0.8)
    return np.concatenate([pc.defringe(rgb, alpha, 2.0), alpha[..., None]], -1).astype(np.float32)


def main():
    ap = argparse.ArgumentParser(description='舊貼紙（白邊）-> toy 樣式')
    ap.add_argument('src')
    ap.add_argument('dst', nargs='?')
    ap.add_argument('--max', type=int, default=None, help='輸出長邊（預設和原圖一樣）')
    ap.add_argument('--light', default=None, help='亮度,飽和度：去掉邊緣淡色的背景殘塊，例如 0.62,0.5')
    a = ap.parse_args()
    im = Image.open(a.src)
    light = tuple(float(v) for v in a.light.split(',')) if a.light else None
    out = pc.toy_rect(strip(im, light=light), a.max or max(im.size))
    dst = a.dst or a.src
    pc.save_webp(out, dst) if dst.lower().endswith('.webp') else out.save(dst)
    print(f'  {dst}: {out.size[0]}x{out.size[1]}')


if __name__ == '__main__':
    main()
