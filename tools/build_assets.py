# 一鍵重建所有遊戲素材（在專案根目錄執行）:
#   python tools/build_assets.py            # 有變動的才重做（渲染結果有快取）
#   python tools/build_assets.py --force    # 全部重做
#   python tools/build_assets.py --no-contact   # 不輸出檢查用的總覽圖
#
# 流程（設定在 tools/assets.json）:
#   1. 模型：tools/source/<id>.usdz 存在就用掃描檔（usd_to_glb 轉 GLB、slim_usdz 縮小 USDZ；
#      原檔或工具的內容變了才重轉，紀錄在 tools/out/models/stamps.json），
#      否則 source = placeholder 的用 make_placeholders.py 程式產生 GLB + USDZ
#      （assets/models/<id>.glb 已經是掃描模型的話會沿用它並警告，不會被暫代玩具蓋掉）
#   2. 渲染：靜態圖、24 格轉盤、三寶合照與標題圖的每一隻（tools/render，無頭 Chromium + three.js）
#   3. 後製：貼紙白邊 + 陰影（postprocess.py）-> assets/sprites/
#   4. 複製模型到 assets/models/，寫 assets/manifest.json
#   5. 總覽圖 tools/out/contact.png（contact_sheet.py）
import argparse, hashlib, io, json, os, shutil, struct, sys, time

TOOLS = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(TOOLS)
sys.path.insert(0, TOOLS)
sys.path.insert(0, os.path.join(TOOLS, 'render'))
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

import numpy as np
from PIL import Image
import postprocess as pp

SRC = os.path.join(TOOLS, 'source')
OUT = os.path.join(TOOLS, 'out')
MODELS = os.path.join(OUT, 'models')
RDIR = os.path.join(OUT, 'r')              # 渲染結果（短路徑，避開 Windows 260 字元限制）
A_SPR = os.path.join(ROOT, 'assets', 'sprites')
A_MOD = os.path.join(ROOT, 'assets', 'models')


def sha1(path):
    h = hashlib.sha1()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def copy_if_changed(src, dst):
    if os.path.exists(dst) and sha1(src) == sha1(dst):
        return False
    shutil.copyfile(src, dst)
    return True


def glb_generator(path):
    """GLB 的 asset.generator；檔案不在或不是 GLB 就回傳 None。
    make_placeholders.py 做的暫代模型寫 'shubing tools/make_placeholders.py'，掃描檔轉的是 trimesh。"""
    try:
        with open(path, 'rb') as f:
            magic, _, _, n, kind = struct.unpack('<5I', f.read(20))
            if magic != 0x46546C67 or kind != 0x4E4F534A:
                return None
            return str(json.loads(f.read(n)).get('asset', {}).get('generator', ''))
    except (OSError, ValueError, struct.error, AttributeError):
        return None


# ---------------------------------------------------------------- 1. 模型
def is_photo(p):
    """照片方塊：assets.json 是 "source": "photo"，而且沒有放掃描檔（放了 tools/source/<id>.usdz 就改用掃描）"""
    return p.get('source') == 'photo' and not os.path.exists(os.path.join(SRC, p['id'] + '.usdz'))


def build_models(cfg, force):
    from usd_to_glb import convert
    from slim_usdz import slim
    import make_placeholders as mp
    os.makedirs(MODELS, exist_ok=True)
    # 掃描檔轉出來的 GLB / USDZ 各是用哪個原檔、哪版工具做的。比的是內容 sha1，不是修改時間：
    # 從檔案總管複製、解壓縮的掃描檔會保留原本的修改時間，常常比上次建置還舊，用時間比會漏掉。
    stamp_file = os.path.join(MODELS, 'stamps.json')
    try:
        with open(stamp_file, encoding='utf-8') as f:
            stamps = json.load(f)
    except (OSError, ValueError):
        stamps = {}

    def save_stamps():
        with open(stamp_file, 'w', encoding='utf-8') as f:
            json.dump(stamps, f, indent=0, sort_keys=True)

    tool = {n: sha1(os.path.join(TOOLS, n)) for n in ('usd_to_glb.py', 'slim_usdz.py')}
    kinds, ph = {}, []
    for p in cfg['pieces']:
        i = p['id']
        src = os.path.join(SRC, i + '.usdz')
        glb, usdz = os.path.join(MODELS, i + '.glb'), os.path.join(MODELS, i + '.usdz')
        if os.path.exists(src):
            kinds[i] = 'scan'
            s = sha1(src)
            for out, make, t in ((glb, convert, 'usd_to_glb.py'), (usdz, slim, 'slim_usdz.py')):
                name, key = os.path.basename(out), s + ':' + tool[t]
                if force or stamps.get(name) != key or not os.path.exists(out):
                    stamps.pop(name, None); save_stamps()      # 做到一半中斷的話，下次一定重做
                    make(src, out)
                    stamps[name] = key; save_stamps()
            if p.get('source') == 'placeholder':
                print(f'  {i}: 找到 tools/source/{i}.usdz，改用掃描檔（不再用暫代模型）')
                print(f'  {i}: 記得把 tools/assets.json 裡 {i} 的 "source" 改成 "scan"'
                      f'（tools/source/ 不進 git，換電腦或重新 clone 就沒有這個檔）')
            continue
        # 輸出不是（或不再是）這台電腦上的掃描原檔轉的：清掉紀錄，之後放回同一個掃描檔也一定會重轉
        stamps.pop(i + '.glb', None); stamps.pop(i + '.usdz', None)
        if p.get('source') == 'photo':          # 照片方塊沒有 3D 模型
            kinds[i] = 'photo'
            continue
        ag, au = os.path.join(A_MOD, i + '.glb'), os.path.join(A_MOD, i + '.usdz')
        if p.get('source') == 'placeholder':
            gen = glb_generator(ag)
            if gen is None or 'make_placeholders' in gen:
                kinds[i] = 'placeholder'; ph.append(i)
                continue
            # assets/models 裡已經是掃描模型（以前放過 tools/source/<id>.usdz），只是原檔不在這台電腦：
            # 不要拿暫代玩具把它蓋掉
            print(f'  警告：{i} 在 tools/assets.json 還是 "source": "placeholder"，但 assets/models/{i}.glb 已經是掃描模型'
                  f'（沒有 tools/source/{i}.usdz）。沿用它，不重做暫代玩具。')
            print(f'        請把 {i} 的 "source" 改成 "scan"；真的要換回暫代玩具，先刪掉 assets/models/{i}.glb 再跑一次。')
        else:
            # 掃描原檔不在（tools/source 不進 git）：沿用 assets/models 裡已經做好的檔案
            if not os.path.exists(ag):
                raise SystemExit(f'找不到 {i} 的掃描檔 tools/source/{i}.usdz，也沒有 assets/models/{i}.glb')
            print(f'  {i}: 沒有 tools/source/{i}.usdz，沿用 assets/models 的現成模型')
        copy_if_changed(ag, glb)
        if os.path.exists(au):
            copy_if_changed(au, usdz)
        kinds[i] = 'scan'
    save_stamps()
    if ph:
        mp.build(ph, MODELS)     # 很快而且結果固定（亂數有種子、zip 時間戳固定），每次都重做
    return kinds


# ---------------------------------------------------------------- 2. 渲染
def merged_view(cfg, piece, *extra):
    v = dict(cfg['defaults']['view'])
    v.update(piece.get('view', {}))
    for e in extra:
        v.update(e or {})
    v['lockFrame'] = True
    return v


def render_jobs(cfg):
    pieces = {p['id']: p for p in cfg['pieces']}
    S, F = cfg['sprite'], cfg['spin']
    jobs = []
    for p in cfg['pieces']:
        if is_photo(p):
            continue
        url = f"/out/models/{p['id']}.glb"
        jobs.append((p['id'], [{'url': url}], merged_view(cfg, p, {'w': S['render'], 'h': S['render']})))
        sv = merged_view(cfg, p, p.get('spin', {}), {'w': F['render'], 'h': F['render']})
        for k in range(F['frames']):
            jobs.append((f"{p['id']}_s{k:02d}", [{'url': url, 'yaw': 360 * k / F['frames']}], sv))
    for comp, res in (('trio', 1024), ('hero', 1400)):
        for L in cfg[comp]['layers']:
            p = pieces[L['id']]
            jobs.append((f"{comp}_{L['id']}", [{'url': f"/out/models/{L['id']}.glb"}],
                         merged_view(cfg, p, L.get('view'), {'w': res, 'h': res})))
    return jobs


def render_all(cfg, force):
    os.makedirs(RDIR, exist_ok=True)
    cache_file = os.path.join(RDIR, 'cache.json')
    try:
        cache = json.load(open(cache_file, encoding='utf-8'))
    except Exception:
        cache = {}
    html = sha1(os.path.join(TOOLS, 'render', 'render.html'))
    mh = {}
    todo = []
    for name, items, view in render_jobs(cfg):
        for it in items:
            if it['url'] not in mh:
                mh[it['url']] = sha1(os.path.join(TOOLS, it['url'].lstrip('/')))
        key = hashlib.sha1(json.dumps([items, view, html, [mh[it['url']] for it in items]],
                                      sort_keys=True).encode()).hexdigest()
        png = os.path.join(RDIR, name + '.png')
        if force or cache.get(name) != key or not os.path.exists(png):
            todo.append((name, items, view, key, png))
    if todo:
        from shoot import Renderer
        t = time.time()
        with Renderer() as R:
            for n, (name, items, view, key, png) in enumerate(todo):
                with open(png, 'wb') as f:
                    f.write(R.shot(items, view))
                cache[name] = key
                if n % 25 == 0:
                    print(f'  渲染 {n + 1}/{len(todo)} {name}')
            if R.errors:
                raise SystemExit('渲染頁面錯誤: ' + '; '.join(R.errors))
        json.dump(cache, open(cache_file, 'w', encoding='utf-8'), indent=0, sort_keys=True)
        print(f'  渲染 {len(todo)} 張，{time.time() - t:.0f} 秒')
    else:
        print('  渲染：全部沿用快取')


# ---------------------------------------------------------------- 3. 後製
def rimg(name):
    return Image.open(os.path.join(RDIR, name + '.png'))


def postprocess(cfg):
    os.makedirs(A_SPR, exist_ok=True)
    pieces = {p['id']: p for p in cfg['pieces']}
    S, F = cfg['sprite'], cfg['spin']
    info = {}
    for p in cfg['pieces']:
        i, g = p['id'], p.get('grade')
        if is_photo(p):
            photo_piece(p)
            info[i] = {}
            continue
        static = rimg(i)
        pp.save_png(pp.sprite(static, S['size'], K=3, g=g), os.path.join(A_SPR, i + '.png'))
        pp.save_png(pp.sprite_clean(static, S['size'], K=3, g=g), os.path.join(A_SPR, i + '_n.png'))   # 沒白邊（盤面用）
        frames = [rimg(f'{i}_s{k:02d}') for k in range(F['frames'])]
        T, ratio = pp.spin_transform([pp.to_np(f) for f in frames], pp.bbox(pp.to_np(static)), static.size, F['size'])
        cells = [pp.sprite(f, F['size'], K=2, g=g, transform=T) for f in frames]
        pp.save_webp(pp.sheet(cells, F['cols'], F['rows'], F['size']), os.path.join(A_SPR, i + '_spin.webp'),
                     F.get('webpQuality', 85))
        cells_n = [pp.sprite_clean(f, F['size'], K=2, g=g, transform=T) for f in frames]
        pp.save_webp(pp.sheet(cells_n, F['cols'], F['rows'], F['size']), os.path.join(A_SPR, i + '_spin_n.webp'),
                     F.get('webpQuality', 85))
        info[i] = dict(spinScale=round(float(ratio), 3))
        print(f'  {i}: sprite + spin（第 0 格大小 = 靜態圖的 {ratio:.2f} 倍）')
    for e in cfg.get('deco', []):
        photo_deco(e)
    for comp in ('trio', 'hero'):
        c = cfg[comp]
        layers = [dict(img=rimg(f"{comp}_{L['id']}"), h=L['h'], cx=L['cx'], by=L['by'], rot=L.get('rot', 0),
                       g=pieces[L['id']].get('grade')) for L in c['layers']]
        W, H = c['size']
        im = pp.compose(layers, W, H, K=2, unit_px=c.get('unit'), outline=c.get('outline', pp.OUTLINE),
                        group=c.get('group', True), fill=c.get('fill'))
        pp.save_png(im, os.path.join(A_SPR, comp + '.png'))
        if comp == 'trio':      # 彩色炸彈用的沒白邊版本（和盤面玩具一樣的遊戲光）
            pp.save_png(pp.compose(layers, W, H, K=2, unit_px=c.get('unit'), fill=c.get('fill'), sticker=False),
                        os.path.join(A_SPR, 'trio_n.png'))
        print(f'  {comp}: {W}x{H}')
    return info


def photo_piece(p):
    """照片方塊的貼紙。原照片（tools/source/photos/，不進 git）不在的話就沿用 assets/sprites 裡做好的"""
    import photo_cut as pc
    i, out = p['id'], os.path.join(A_SPR, p['id'] + '.png')
    if not os.path.exists(os.path.join(pc.PHOTOS, p['photo'])):
        if not os.path.exists(out):
            raise SystemExit(f'找不到 {i} 的照片 tools/source/photos/{p["photo"]}，也沒有 assets/sprites/{i}.png')
        print(f'  {i}: 沒有原照片，沿用 assets/sprites/{i}.png')
        return
    rgba = pc.cut(p)
    pp.save_png(pc.sticker_piece(rgba, 256, fill=p.get('fill', pp.FILL), g=p.get('grade')), out)
    pp.save_png(pp.sprite_clean(pp.to_im(pc.enhance(rgba, p.get('grade'))), 256, fill=0.9), os.path.join(A_SPR, i + '_n.png'))
    print(f'  {i}: 照片貼紙')


def photo_deco(e):
    """裝飾貼紙 / 照片（assets.json 的 deco）。原照片不在就沿用現成的檔案"""
    import photo_cut as pc
    out = os.path.join(ROOT, e['out'])
    if not os.path.exists(os.path.join(pc.PHOTOS, e['photo'])):
        print(f'  {e["out"]}: 沒有原照片，沿用現成的檔案' if os.path.exists(out) else f'  警告：{e["out"]} 沒有原照片也沒有檔案')
        return
    os.makedirs(os.path.dirname(out), exist_ok=True)
    if e.get('kind') == 'photo':       # 不去背，只縮小（例如 3D 看看頁的照片卡片）
        im = pc.resize_photo(os.path.join(pc.PHOTOS, e['photo']), e.get('max', 900))
    elif e.get('style') == 'toy':      # 沒白邊、遊戲光（發光和影子由遊戲加）
        im = pc.toy_rect(pc.cut(e), e.get('max', 512), g=e.get('grade'), toon=e.get('toon', False), **e.get('toy', {}))
    else:
        im = pc.sticker_rect(pc.cut(e), e.get('max', 512), g=e.get('grade'))
    pc.save_webp(im, out, e.get('quality', 82))
    print(f'  {e["out"]}: {im.size[0]}x{im.size[1]}')


# ---------------------------------------------------------------- 4. 模型複製 + manifest
def finish(cfg, kinds, info):
    import trimesh
    os.makedirs(A_MOD, exist_ok=True)
    F = cfg['spin']
    pieces = []
    for p in cfg['pieces']:
        i = p['id']
        if kinds[i] == 'photo':
            pieces.append(dict(id=i, sprite=f'assets/sprites/{i}.png', clean=f'assets/sprites/{i}_n.png', photo=True))
            continue
        for ext in ('glb', 'usdz'):
            copy_if_changed(os.path.join(MODELS, f'{i}.{ext}'), os.path.join(A_MOD, f'{i}.{ext}'))
        ext = trimesh.load(os.path.join(A_MOD, i + '.glb'), force='mesh').extents
        pieces.append(dict(id=i, sprite=f'assets/sprites/{i}.png', clean=f'assets/sprites/{i}_n.png', spin=f'assets/sprites/{i}_spin.webp',
                           glb=f'assets/models/{i}.glb', usdz=f'assets/models/{i}.usdz',
                           placeholder=kinds[i] == 'placeholder', spinScale=info[i]['spinScale'],
                           sizeCm=[round(float(v) * 100, 1) for v in ext]))
    man = dict(pieces=pieces, trio='assets/sprites/trio.png', hero='assets/sprites/hero.png',
               spin=dict(frames=F['frames'], cols=F['cols'], rows=F['rows'], size=F['size']))
    with open(os.path.join(ROOT, 'assets', 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(man, f, ensure_ascii=False, indent=2)
        f.write('\n')
    # 檔案大小總表
    for d in (A_SPR, A_MOD):
        for n in sorted(os.listdir(d)):
            print(f'  {os.path.relpath(os.path.join(d, n), ROOT):34s} {os.path.getsize(os.path.join(d, n)) / 1024:8.0f} KB')


def main():
    ap = argparse.ArgumentParser(description='重建 assets/（模型、貼紙圖、轉盤序列、合照、manifest）')
    ap.add_argument('--force', action='store_true', help='忽略快取，全部重做')
    ap.add_argument('--no-contact', action='store_true', help='不輸出 tools/out/contact.png')
    a = ap.parse_args()
    cfg = json.load(open(os.path.join(TOOLS, 'assets.json'), encoding='utf-8'))
    t = time.time()
    print('1/5 模型'); kinds = build_models(cfg, a.force)
    print('2/5 渲染'); render_all(cfg, a.force)
    print('3/5 後製'); info = postprocess(cfg)
    print('4/5 複製模型、寫 manifest'); finish(cfg, kinds, info)
    if not a.no_contact:
        print('5/5 總覽圖')
        import contact_sheet
        contact_sheet.main(os.path.join(OUT, 'contact.png'))
    print(f'完成（{time.time() - t:.0f} 秒）')


if __name__ == '__main__':
    main()
