# 把 Object Capture 掃描的 .usdz 轉成 .glb（位置 / 法線 / UV + 顏色、法線、AO 貼圖）
# 用法: python usd_to_glb.py <輸入.usdz> <輸出.glb> [貼圖尺寸=1024]
# 也可以 import: from usd_to_glb import convert; convert(src, out, 1024)
#
# 一般 Object Capture 檔只有一個 Mesh（/ObjectCapture/Geometry/Mesh）；這裡會找出所有 Mesh，
# 套用它們的世界座標變換，換算成公尺、Y 朝上，貼圖從綁定的 UsdPreviewSurface 材質讀。
import io, os, shutil, sys, tempfile, zipfile
import numpy as np, trimesh
from pxr import Usd, UsdGeom, UsdShade, Gf
from PIL import Image


def _tex_file(mat_prim_shader, input_name, root_dir):
    """沿著 UsdPreviewSurface 的 input 找到 UsdUVTexture 的檔案路徑"""
    inp = mat_prim_shader.GetInput(input_name)
    if not inp or not inp.HasConnectedSource():
        return None
    src = inp.GetConnectedSource()[0]
    sh = UsdShade.Shader(src.GetPrim())
    f = sh.GetInput('file')
    if not f:
        return None
    ap = f.Get()
    if ap is None:
        return None
    p = ap.resolvedPath or os.path.join(root_dir, ap.path)
    return p if os.path.exists(p) else None


def _surface(prim):
    mat = UsdShade.MaterialBindingAPI(prim).ComputeBoundMaterial()[0]
    if not mat:
        return None
    out = mat.GetSurfaceOutput()
    if out and out.HasConnectedSource():
        return UsdShade.Shader(out.GetConnectedSource()[0].GetPrim())
    return None


def _as_jpeg(im, q=88):
    # trimesh 依 image.format 決定嵌入格式；轉成 JPEG 讓 glb 變小
    b = io.BytesIO(); im.save(b, 'JPEG', quality=q); b.seek(0)
    return Image.open(b)


def convert(src, out, texsize=1024, verbose=True):
    work = tempfile.mkdtemp(prefix='u2g_')
    try:
        if src.lower().endswith('.usdz'):
            z = zipfile.ZipFile(src)
            z.extractall(work)
            root = os.path.join(work, z.namelist()[0])       # USDZ 規定第一個檔案是根圖層
        else:
            root = src
        root_dir = os.path.dirname(root)
        st = Usd.Stage.Open(root)
        mpu = UsdGeom.GetStageMetersPerUnit(st) or 1.0
        zup = UsdGeom.GetStageUpAxis(st) == UsdGeom.Tokens.z
        cache = UsdGeom.XformCache(Usd.TimeCode.Default())
        geoms = []
        for prim in st.Traverse():
            if not prim.IsA(UsdGeom.Mesh):
                continue
            m = UsdGeom.Mesh(prim)
            P = np.array(m.GetPointsAttr().Get(), dtype=np.float64)
            fvc = np.array(m.GetFaceVertexCountsAttr().Get(), dtype=np.int64)
            fvi = np.array(m.GetFaceVertexIndicesAttr().Get(), dtype=np.int64)
            if (fvc != 3).any():                               # 多邊形 -> 扇形三角化
                tris, k = [], 0
                corner = []
                for c in fvc:
                    for j in range(1, c - 1):
                        corner += [k, k + j, k + j + 1]
                    k += c
                corner = np.array(corner)
            else:
                corner = np.arange(len(fvi))
            M = np.array(cache.GetLocalToWorldTransform(prim), dtype=np.float64)   # 列向量在左：p' = p @ M
            P = P @ M[:3, :3] + M[3, :3]
            nattr = m.GetNormalsAttr().Get()
            N = None
            if nattr is not None and len(nattr):
                N = np.array(nattr, dtype=np.float64) @ np.linalg.inv(M[:3, :3]).T
            pv = UsdGeom.PrimvarsAPI(prim).GetPrimvar('st')
            if pv and pv.HasValue():
                uvv = np.array(pv.Get(), dtype=np.float64)
                uvi = np.array(pv.GetIndices(), dtype=np.int64) if pv.IsIndexed() else None
                interp = pv.GetInterpolation()
                if interp == UsdGeom.Tokens.faceVarying:
                    uv_corner = uvi if uvi is not None else np.arange(len(fvi))
                else:  # vertex / varying
                    uv_corner = (uvi[fvi] if uvi is not None else fvi)
            else:
                uvv = np.zeros((1, 2)); uv_corner = np.zeros(len(fvi), np.int64)
            # glTF 需要每個頂點一組 UV：用 (點, UV) 配對去重
            pc, uc = fvi[corner], uv_corner[corner]
            key = pc * (len(uvv) + 1) + uc
            uniq, inv = np.unique(key, return_inverse=True)
            inv = inv.reshape(-1)
            first = np.zeros(len(uniq), dtype=np.int64)
            first[inv[::-1]] = np.arange(len(key))[::-1]
            pos, uv = P[pc[first]], uvv[uc[first]]
            nrm = None
            if N is not None:
                if len(N) == len(P):
                    nrm = N[pc[first]]
                elif len(N) == len(fvi):
                    nrm = N[corner][first]
            faces = inv.reshape(-1, 3)
            # 單位換成公尺，Z 朝上就轉成 Y 朝上
            pos = pos * mpu
            if zup:
                R = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], float)   # (x, y, z) -> (x, z, -y)
                pos = pos @ R
                if nrm is not None: nrm = nrm @ R
            if nrm is not None:
                nrm = nrm / np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-12)
            # 材質貼圖
            sh = _surface(prim)
            files = {k: (_tex_file(sh, k, root_dir) if sh else None) for k in ('diffuseColor', 'normal', 'occlusion')}

            def load(path, mode):
                return Image.open(path).convert(mode).resize((texsize, texsize), Image.LANCZOS)
            kw = dict(metallicFactor=0.0, roughnessFactor=1.0)
            if files['diffuseColor']:
                kw['baseColorTexture'] = _as_jpeg(load(files['diffuseColor'], 'RGB'))
            else:
                kw['baseColorFactor'] = [180, 180, 180, 255]
            if files['normal']:
                kw['normalTexture'] = _as_jpeg(load(files['normal'], 'RGB'), 92)
            ao = load(files['occlusion'], 'L') if files['occlusion'] else Image.new('L', (texsize, texsize), 255)
            orm = Image.merge('RGB', (ao, Image.new('L', ao.size, 230), Image.new('L', ao.size, 0)))  # R=AO G=粗糙度 B=金屬度
            kw['metallicRoughnessTexture'] = _as_jpeg(orm)
            if files['occlusion']:
                kw['occlusionTexture'] = kw['metallicRoughnessTexture']
            mat = trimesh.visual.material.PBRMaterial(**kw)
            geoms.append(trimesh.Trimesh(vertices=pos, faces=faces, vertex_normals=nrm, process=False,
                                         visual=trimesh.visual.TextureVisuals(uv=uv, material=mat)))
        if not geoms:
            raise ValueError(f'{src}: 找不到 Mesh')
        obj = geoms[0] if len(geoms) == 1 else trimesh.Scene(geoms)
        tmp_out = os.path.join(work, 'out.glb')
        obj.export(tmp_out)
        shutil.copyfile(tmp_out, out)
        if verbose:
            nv = sum(len(g.vertices) for g in geoms); nf = sum(len(g.faces) for g in geoms)
            print(f'{os.path.basename(src)}: {nv} 頂點, {nf} 三角面 -> {os.path.basename(out)} ({os.path.getsize(out) // 1024} KB)')
        return out
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    convert(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 1024)
