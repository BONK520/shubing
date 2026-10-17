# 把 Object Capture 掃描的 .usdz 轉成 .glb（位置 / 法線 / UV + 顏色、法線、AO 貼圖）
# 用法: python usd_to_glb.py <輸入.usdz> <輸出.glb> [貼圖尺寸=1024]
import io, os, sys, tempfile, zipfile
import numpy as np, trimesh
from pxr import Usd, UsdGeom
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
texsize = int(sys.argv[3]) if len(sys.argv) > 3 else 1024

work = tempfile.mkdtemp()
if src.endswith('.usdz'):
    zipfile.ZipFile(src).extractall(work)
    usdc = next(os.path.join(work, f) for f in os.listdir(work) if f.endswith('.usdc'))
else:
    usdc = src
st = Usd.Stage.Open(usdc)
m = UsdGeom.Mesh(st.GetPrimAtPath('/ObjectCapture/Geometry/Mesh'))
P = np.array(m.GetPointsAttr().Get(), dtype=np.float32)
N = np.array(m.GetNormalsAttr().Get(), dtype=np.float32)
fvi = np.array(m.GetFaceVertexIndicesAttr().Get(), dtype=np.int64)
pv = UsdGeom.PrimvarsAPI(m.GetPrim()).GetPrimvar('st')
uvv = np.array(pv.Get(), dtype=np.float32)
uvi = np.array(pv.GetIndices(), dtype=np.int64)

# UV 是 faceVarying + indexed，glTF 需要每個頂點一組 UV：用 (點, UV) 配對去重
key = fvi * (len(uvv) + 1) + uvi
uniq, inv = np.unique(key, return_inverse=True)
first = np.zeros(len(uniq), dtype=np.int64)
first[inv[::-1]] = np.arange(len(key))[::-1]
pos, uv = P[fvi[first]], uvv[uvi[first]]
nrm = N[fvi[first]] if m.GetNormalsInterpolation() == 'vertex' else N[first]
faces = inv.reshape(-1, 3)

texdir = os.path.join(os.path.dirname(usdc), '0')
base = os.path.splitext(os.path.basename(usdc))[0]

def load(suffix, mode):
    return Image.open(os.path.join(texdir, base + suffix)).convert(mode).resize((texsize, texsize), Image.LANCZOS)

def as_jpeg(im, q=88):
    # trimesh 依 image.format 決定嵌入格式；轉成 JPEG 讓 glb 變小
    b = io.BytesIO(); im.save(b, 'JPEG', quality=q); b.seek(0)
    return Image.open(b)

col = load('_tex0.png', 'RGB')
nor = load('_norm0.png', 'RGB')
ao = load('_ao0.png', 'L')
orm = Image.merge('RGB', (ao, Image.new('L', ao.size, 230), Image.new('L', ao.size, 0)))  # R=AO G=粗糙度 B=金屬度
mat = trimesh.visual.material.PBRMaterial(
    baseColorTexture=as_jpeg(col), normalTexture=as_jpeg(nor, 92),
    occlusionTexture=as_jpeg(orm), metallicRoughnessTexture=as_jpeg(orm),
    metallicFactor=0.0, roughnessFactor=1.0)
mesh = trimesh.Trimesh(vertices=pos, faces=faces, vertex_normals=nrm, process=False,
                       visual=trimesh.visual.TextureVisuals(uv=uv, material=mat))
mesh.export(out)
print(f'{os.path.basename(src)}: {len(pos)} 頂點, {len(faces)} 三角面 -> {out} ({os.path.getsize(out) // 1024} KB)')
