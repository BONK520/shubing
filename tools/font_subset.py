# 源泉圓體（GenSenRounded，SIL OFL 1.1，https://github.com/ButTaiwan/gensen-font）只留遊戲用到的字，做成小小的 woff2
# 用法（在專案根目錄）:
#   python tools/font_subset.py <放 GenSenRounded2TW-B.otf / -H.otf 的資料夾>
# 會掃 index.html、ar.html、js/*.js、style.css 裡畫面上會出現的字（註解裡的字不算），加上 ASCII 和常用標點，
# 輸出 assets/fonts/gensen-rounded-bold.woff2、gensen-rounded-heavy.woff2。改了遊戲裡的中文字就重跑一次。
# （Windows：原始字型放在路徑短的資料夾，Python 才打得開）
import glob, os, re, sys
from fontTools import subset

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'tools', 'source', 'fonts')
FILES = ['index.html', 'ar.html', 'style.css', 'ar.css'] + sorted(glob.glob(os.path.join(ROOT, 'js', '*.js')))
EXTRA = ''.join(chr(c) for c in range(0x20, 0x7f)) + '０１２３４５６７８９，。！？、：；「」『』（）～…—・×＋－％★☆♪　'
LINE_COMMENT = re.compile(r'(^|[^:\'"\\])//[^\n]*', re.M)


def chars():
    s = set(EXTRA)
    for f in FILES:
        p = f if os.path.isabs(f) else os.path.join(ROOT, f)
        try:
            t = open(p, encoding='utf-8').read()
        except OSError:
            continue
        # 註解裡的字不會出現在畫面上：先拿掉（行註解要避開網址裡的 //）
        t = re.sub(r'<!--.*?-->', '', t, flags=re.S)
        t = re.sub(r'/\*.*?\*/', '', t, flags=re.S)
        t = LINE_COMMENT.sub(lambda m: m.group(1), t)
        s |= set(t)
    # 只留一般文字（emoji 之類交給系統字型）
    keep = lambda c: c.isprintable() and ord(c) < 0x10000 and not (0x2600 <= ord(c) < 0x2c00 and c not in '★☆♪')
    return ''.join(sorted(c for c in s if keep(c)))


def main():
    text = chars()
    out_dir = os.path.join(ROOT, 'assets', 'fonts')
    os.makedirs(out_dir, exist_ok=True)
    for weight, name in (('B', 'bold'), ('H', 'heavy')):
        src = os.path.join(SRC, f'GenSenRounded2TW-{weight}.otf')
        out = os.path.join(out_dir, f'gensen-rounded-{name}.woff2')
        opts = subset.Options()
        opts.flavor = 'woff2'
        opts.layout_features = ['*']
        opts.name_IDs = ['*']
        opts.notdef_outline = True
        opts.desubroutinize = True
        font = subset.load_font(src, opts)
        sub = subset.Subsetter(opts)
        sub.populate(text=text)
        sub.subset(font)
        subset.save_font(font, out, opts)
        print(f'  {os.path.basename(out)}: {len(text)} chars, {os.path.getsize(out) // 1024} KB')


if __name__ == '__main__':
    main()
