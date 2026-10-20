# PicPet App 的截圖 → 只留中間那張照片（給 photo_cut.py 去背用）
# 用法: python tools/picpet_crop.py <截圖.jpg> <輸出.jpg>
# 照片在截圖裡的位置用「卡片白底」自動找；找不到時用 1188x2576 截圖的固定位置。
# 照片四角的頭像、時間、Instagram 按鈕不會自動去掉：在 assets.json 的 cut 用 bgRect 標成背景。
import sys
import numpy as np
from PIL import Image


def find_photo(im):
    a = np.asarray(im.convert('RGB')).astype(int)
    h, w = a.shape[:2]
    k = w / 1188
    x0, x1 = round(146 * k), round(1040 * k)
    # 卡片白底是很淺的灰（約 240）；照片 = 五個位置裡有任何一處不是白底、連續最長的那一段
    # （白色的玩具不會讓照片斷掉；照片上面天空的漸層和照片中間隔著卡片的白邊，比較短）
    cols = [round(w * f) for f in (0.2, 0.35, 0.5, 0.65, 0.8)]
    best, run = (0, 0), None
    for y in range(round(h * 0.2), round(h * 0.8)):
        if any(abs(a[y, c] - 241).sum() > 45 for c in cols):
            run = (run[0], y) if run else (y, y)
            if run[1] - run[0] > best[1] - best[0]:
                best = run
        else:
            run = None
    side = x1 - x0
    if best[1] - best[0] > side * 0.6:
        y0 = best[0] + 2
        return (x0, y0, x0 + side, y0 + side)
    return (x0, round(791 * k), x1, round(1685 * k))


if __name__ == '__main__':
    src, dst = sys.argv[1], sys.argv[2]
    im = Image.open(src)
    box = find_photo(im)
    im.convert('RGB').crop(box).save(dst, quality=95)
    print(dst, box)
