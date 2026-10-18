# 把掃描的 .usdz 重新打包成給 iPhone AR Quick Look 用的小檔：貼圖縮到 1024（顏色、法線轉 JPEG）
# 用法: python tools/slim_usdz.py <輸入.usdz> <輸出.usdz> [貼圖尺寸=1024]
#       python tools/slim_usdz.py --check <檔案.usdz> ...     # 只檢查（usd-core 能開、貼圖找得到、ARKit 規則）
# 打包用 UsdUtils.CreateNewUsdzPackage，會照 USDZ 規則：不壓縮（stored）、每個檔案 64 bytes 對齊。
import os, shutil, sys, tempfile, zipfile
from PIL import Image
from pxr import Sdf, Usd, UsdUtils


def slim(src, out, texsize=1024, quality=88, verbose=True):
    work = tempfile.mkdtemp(prefix='slim_')      # 暫存資料夾在 %TEMP%，避開 Windows 260 字元路徑限制
    try:
        z = zipfile.ZipFile(src)
        z.extractall(work)
        root = os.path.join(work, z.namelist()[0])   # USDZ 規定第一個檔案是根圖層
        st = Usd.Stage.Open(root)
        done = {}
        for prim in st.Traverse():
            for attr in prim.GetAttributes():
                if attr.GetTypeName() != Sdf.ValueTypeNames.Asset:
                    continue
                ap = attr.Get()
                if not ap or not ap.path.lower().endswith(('.png', '.jpg', '.jpeg')):
                    continue
                rel = ap.path
                if rel not in done:
                    p = os.path.join(os.path.dirname(root), rel)
                    im = Image.open(p)
                    gray = im.mode in ('L', 'LA', 'I', 'I;16') or 'ao' in os.path.basename(rel).lower()
                    if max(im.size) > texsize:
                        im = im.resize((texsize, texsize) if im.size[0] == im.size[1] else
                                       (max(1, im.size[0] * texsize // max(im.size)), max(1, im.size[1] * texsize // max(im.size))),
                                       Image.LANCZOS)
                    base = os.path.splitext(rel)[0]
                    if gray:     # AO 這類灰階圖很小，維持 PNG
                        new = base + '_s.png'
                        im.convert('L').save(os.path.join(os.path.dirname(root), new), 'PNG', optimize=True)
                    else:
                        new = base + '_s.jpg'
                        q = 92 if 'norm' in rel.lower() else quality
                        im.convert('RGB').save(os.path.join(os.path.dirname(root), new), 'JPEG', quality=q, optimize=True)
                    done[rel] = new
                attr.Set(Sdf.AssetPath(done[rel]))
        st.GetRootLayer().Save()
        tmp = os.path.join(work, 'slim_out.usdz')
        if not UsdUtils.CreateNewUsdzPackage(Sdf.AssetPath(root), tmp):
            raise RuntimeError('CreateNewUsdzPackage failed: ' + src)
        shutil.copyfile(tmp, out)
        if verbose:
            print(f'{os.path.basename(src)}: {os.path.getsize(src) / 1e6:.1f} MB -> {os.path.basename(out)} '
                  f'{os.path.getsize(out) / 1e6:.2f} MB')
        return out
    finally:
        shutil.rmtree(work, ignore_errors=True)


def validate(st):
    """usd-core 內建的驗證器（usdchecker 用的同一套：USDZ 封裝、材質綁定、法線貼圖、stage metadata…）"""
    try:
        from pxr import UsdValidation
    except ImportError:
        return []
    reg = UsdValidation.ValidationRegistry()
    vs = [v for v in reg.GetOrLoadAllValidators()
          if not v.GetMetadata().name.startswith(('usdPhysics', 'usdSkel', 'usdLux'))]
    out = []
    for e in UsdValidation.ValidationContext(vs).Validate(st):
        if e.GetType() in (UsdValidation.ValidationErrorType.Error, UsdValidation.ValidationErrorType.Warn):
            out.append(f'{e.GetName()}: {e.GetMessage()}')
    return out


def check(path):
    """回傳問題清單（空 = 沒問題）：zip 規則、usd-core 開得起來、貼圖解析得到、ARKit 相容性檢查"""
    problems = []
    z = zipfile.ZipFile(path)
    for info in z.infolist():
        if info.compress_type != zipfile.ZIP_STORED:
            problems.append(f'{info.filename}: 有壓縮')
        data_ofs = info.header_offset + 30 + len(info.filename.encode()) + len(info.extra)
        if data_ofs % 64:
            problems.append(f'{info.filename}: 資料沒有 64 bytes 對齊 ({data_ofs})')
    st = Usd.Stage.Open(path)
    if st is None:
        return problems + ['usd-core 打不開']
    names = set(z.namelist())
    for prim in st.Traverse():
        for attr in prim.GetAttributes():
            if attr.GetTypeName() == Sdf.ValueTypeNames.Asset:
                ap = attr.Get()
                if ap and ap.path and not ap.resolvedPath:
                    problems.append(f'{attr.GetPath()}: {ap.path} 解析不到')
                if ap and ap.path and ap.path not in names:
                    problems.append(f'{attr.GetPath()}: {ap.path} 不在包裡')
    problems += validate(st)
    return problems


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    a = sys.argv[1:]
    if a and a[0] == '--check':
        bad = 0
        for p in a[1:]:
            pr = check(p)
            print(p, 'OK' if not pr else '\n  ' + '\n  '.join(pr))
            bad += bool(pr)
        sys.exit(1 if bad else 0)
    slim(a[0], a[1], int(a[2]) if len(a) > 2 else 1024)
