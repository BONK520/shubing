# 一鍵重建所有遊戲素材（在專案根目錄執行）:
#   python tools/build_assets.py            # 有變動的才重做（渲染結果有快取）
#   python tools/build_assets.py --force    # 全部重做
#   python tools/build_assets.py --no-contact   # 不輸出檢查用的總覽圖
#
# 流程（設定在 tools/assets.json）:
#   1. 模型：tools/source/<id>.usdz 存在就用掃描檔（usd_to_glb 轉 GLB、slim_usdz 縮小 USDZ），
#      否則 source = placeholder 的用 make_placeholders.py 程式產生 GLB + USDZ
#   2. 渲染：靜態圖、24 格轉盤、三寶合照與標題圖的每一隻（tools/render，無頭 Chromium + three.js）
#   3. 後製：貼紙白邊 + 陰影（postprocess.py）-> assets/sprites/
#   4. 複製模型到 assets/models/，寫 assets/manifest.json
#   5. 總覽圖 tools/out/contact.png（contact_sheet.py）
import argparse, hashlib, io, json, os, shutil, sys, time

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


def stale(out, deps):
    return not os.path.exists(out) or any(os.path.getmtime(d) > os.path.getmtime(out) for d in deps)


def copy_if_changed(src, dst):
    if os.path.exists(dst) and sha1(src) == sha1(dst):
        return False
    shutil.copyfile(src, dst)
    return True


# ---------------------------------------------------------------- 1. 模型
def build_models(cfg, force):
    from usd_to_glb import convert
    from slim_usdz import slim
    import make_placeholders as mp
    os.makedirs(MODELS, exist_ok=True)
    kinds, ph = {}, []
    for p in cfg['pieces']:
        i = p['id']
        src = os.path.join(SRC, i + '.usdz')
        glb, usdz = os.path.join(MODELS, i + '.glb'), os.path.join(MODELS, i + '.usdz')
        if os.path.exists(src):
            kinds[i] = 'scan'
            if force or stale(glb, [src, os.path.join(TOOLS, 'usd_to_glb.py')]):
                convert(src, glb)
            if force or stale(usdz, [src, os.path.join(TOOLS, 'slim_usdz.py')]):
                slim(src, usdz)
            if p.get('source') == 'placeholder':
                print(f'  {i}: 找到 tools/source/{i}.usdz，改用掃描檔（不再用暫代模型）')
        elif p.get('source') == 'placeholder':
            kinds[i] = 'placeholder'; ph.append(i)
        else:
            # 掃描原檔不在（tools/source 不進 git）：沿用 assets/models 裡已經做好的檔案
            ag, au = os.path.join(A_MOD, i + '.glb'), os.path.join(A_MOD, i + '.usdz')
            if not os.path.exists(ag):
                raise SystemExit(f'找不到 {i} 的掃描檔 tools/source/{i}.usdz，也沒有 assets/models/{i}.glb')
            print(f'  {i}: 沒有 tools/source/{i}.usdz，沿用 assets/models 的現成模型')
            copy_if_changed(ag, glb)
            if os.path.exists(au):
                copy_if_changed(au, usdz)
            kinds[i] = 'scan'
    if ph:
        mp.build(ph, MODELS)     # 很快而且結果固定（亂數有種子），每次都重做
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
        static = rimg(i)
        pp.save_png(pp.sprite(static, S['size'], K=3, g=g), os.path.join(A_SPR, i + '.png'))
        frames = [rimg(f'{i}_s{k:02d}') for k in range(F['frames'])]
        T, ratio = pp.spin_transform([pp.to_np(f) for f in frames], pp.bbox(pp.to_np(static)), static.size, F['size'])
        cells = [pp.sprite(f, F['size'], K=2, g=g, transform=T) for f in frames]
        pp.save_webp(pp.sheet(cells, F['cols'], F['rows'], F['size']), os.path.join(A_SPR, i + '_spin.webp'),
                     F.get('webpQuality', 85))
        info[i] = dict(spinScale=round(float(ratio), 3))
        print(f'  {i}: sprite + spin（第 0 格大小 = 靜態圖的 {ratio:.2f} 倍）')
    for comp in ('trio', 'hero'):
        c = cfg[comp]
        layers = [dict(img=rimg(f"{comp}_{L['id']}"), h=L['h'], cx=L['cx'], by=L['by'], rot=L.get('rot', 0),
                       g=pieces[L['id']].get('grade')) for L in c['layers']]
        W, H = c['size']
        im = pp.compose(layers, W, H, K=2, unit_px=c.get('unit'), outline=c.get('outline', pp.OUTLINE),
                        group=c.get('group', True), fill=c.get('fill'))
        pp.save_png(im, os.path.join(A_SPR, comp + '.png'))
        print(f'  {comp}: {W}x{H}')
    return info


# ---------------------------------------------------------------- 4. 模型複製 + manifest
def finish(cfg, kinds, info):
    import trimesh
    os.makedirs(A_MOD, exist_ok=True)
    F = cfg['spin']
    pieces = []
    for p in cfg['pieces']:
        i = p['id']
        for ext in ('glb', 'usdz'):
            copy_if_changed(os.path.join(MODELS, f'{i}.{ext}'), os.path.join(A_MOD, f'{i}.{ext}'))
        ext = trimesh.load(os.path.join(A_MOD, i + '.glb'), force='mesh').extents
        pieces.append(dict(id=i, sprite=f'assets/sprites/{i}.png', spin=f'assets/sprites/{i}_spin.webp',
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
