# 程式產生三隻「暫代」毛絨玩具（兔兔 bunny、呱呱 frog、彈跳豬 moodeng = Moo Deng 河馬寶寶），輸出 GLB + USDZ
# 等之後有真正的 Object Capture 掃描，把 tools/source/<id>.usdz 放進去，build_assets.py 就會改用掃描檔。
#
# 用法（在專案根目錄）: python tools/make_placeholders.py [bunny frog moodeng] [--out tools/out/models]
#
# 座標：Y 朝上、單位公尺、底部在 y=0、臉朝 +Z（yaw 0 = 正面），和掃描檔一樣 metersPerUnit = 1。
# 每個部件是平滑的參數曲面（橢球、沿曲線掃掠的管子），各自有 PBR 材質（粗糙度 0.9、布料法線貼圖、
# GLB 另外有 KHR_materials_sheen 絨毛光澤和頂點 AO）。
import io, json, os, shutil, struct, sys, tempfile
import numpy as np
from PIL import Image
from scipy.interpolate import CubicSpline, PchipInterpolator
from scipy.spatial import cKDTree
import trimesh

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

TILE = 0.022          # 布料貼圖一格 = 2.2 cm
TEX = 256             # 布料貼圖尺寸


# ---------------------------------------------------------------- 小工具
def lin(hexcol):
    """sRGB 十六進位 -> 線性 RGB（glTF / USD 的顏色常數都是線性）"""
    c = np.array([int(hexcol[i:i + 2], 16) / 255 for i in (1, 3, 5)])
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def rot(rx=0, ry=0, rz=0):
    """歐拉角（度）-> 3x3 旋轉矩陣，套用順序 X、Y、Z"""
    a, b, c = np.radians([rx, ry, rz])
    X = np.array([[1, 0, 0], [0, np.cos(a), -np.sin(a)], [0, np.sin(a), np.cos(a)]])
    Y = np.array([[np.cos(b), 0, np.sin(b)], [0, 1, 0], [-np.sin(b), 0, np.cos(b)]])
    Z = np.array([[np.cos(c), -np.sin(c), 0], [np.sin(c), np.cos(c), 0], [0, 0, 1]])
    return Z @ Y @ X


def frame_to(n, up=(0, 1, 0)):
    """回傳把本地 +Z 轉到 n、本地 +Y 盡量朝 up 的旋轉矩陣"""
    z = np.asarray(n, float); z = z / np.linalg.norm(z)
    x = np.cross(up, z)
    if np.linalg.norm(x) < 1e-6:
        x = np.cross((0, 0, 1), z)
    x /= np.linalg.norm(x); y = np.cross(z, x)
    return np.stack([x, y, z], axis=1)


def grid_faces(nu, nv):
    """(nv+1) 列 x (nu+1) 行的格點 -> 三角面"""
    i, j = np.meshgrid(np.arange(nv), np.arange(nu), indexing='ij')
    a = i * (nu + 1) + j; b = a + 1; c = a + nu + 1; d = c + 1
    return np.concatenate([np.stack([a, c, b], -1).reshape(-1, 3), np.stack([b, c, d], -1).reshape(-1, 3)])


def ellipsoid(r, nu=40, nv=24):
    """本地座標的橢球，接縫在背面（-Z）。回傳 V, F, UV"""
    th = np.linspace(0, 2 * np.pi, nu + 1)
    ph = np.linspace(0, np.pi, nv + 1)
    P, T = np.meshgrid(ph, th, indexing='ij')
    V = np.stack([r[0] * np.sin(P) * np.sin(T), r[1] * np.cos(P), -r[2] * np.sin(P) * np.cos(T)], -1).reshape(-1, 3)
    circ = np.pi * (r[0] + r[2]); mer = np.pi * (r[0] + r[1] + r[2]) / 3
    UV = np.stack([T / (2 * np.pi) * max(1, round(circ / TILE)), P / np.pi * mer / TILE], -1).reshape(-1, 2)
    return V, grid_faces(nu, nv), UV


def cap_t(nv, e):
    """管子的 t 取樣：兩端各一段圓頭（角度均勻），中間均勻"""
    k = max(4, nv // 5)
    phi = np.linspace(0, np.pi / 2, k + 1)
    a = e * (1 - np.cos(phi))
    mid = np.linspace(e, 1 - e, max(2, nv - 2 * k))[1:-1]
    return np.concatenate([a, mid, 1 - a[::-1]])


def sweep(pts, radius, nu=24, nv=40, hint=(0, 0, 1), t=None, t_range=(0, 1), offset=None):
    """沿曲線 pts 掃掠橢圓截面。radius(t) -> (寬, 厚)；寬沿 cross(hint, 切線)，厚沿 hint 那側。
    offset(曲線參數) -> 截面中心沿厚度方向的位移（例如耳朵內側的粉紅色貼在正面）"""
    pts = np.asarray(pts, float)
    s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))])
    L = s[-1]; cs = CubicSpline(s / L, pts, bc_type='natural')
    if t is None:
        t = (1 - np.cos(np.linspace(0, np.pi, nv + 1))) / 2
    tt = t_range[0] + (t_range[1] - t_range[0]) * t
    C = cs(tt); T = cs(tt, 1); T /= np.linalg.norm(T, axis=1, keepdims=True)
    hint = np.asarray(hint, float)
    W = np.cross(hint, T); W /= np.linalg.norm(W, axis=1, keepdims=True)
    H = np.cross(T, W)
    ab = np.array([radius(x) for x in t])
    if offset is not None:
        C = C + np.array([offset(x) for x in tt])[:, None] * H
    th = np.linspace(0, 2 * np.pi, nu + 1)
    V = (C[:, None, :] + ab[:, 0, None, None] * np.cos(th)[None, :, None] * W[:, None, :]
         + ab[:, 1, None, None] * np.sin(th)[None, :, None] * H[:, None, :]).reshape(-1, 3)
    circ = np.pi * (ab[:, 0].max() + ab[:, 1].max())
    Tg, Sg = np.meshgrid(th, tt * L, indexing='xy')
    UV = np.stack([Tg / (2 * np.pi) * max(1, round(circ / TILE)), Sg / TILE], -1).reshape(-1, 2)
    return V, grid_faces(nu, len(t) - 1), UV


def tube_profile(r, length, taper=1.0):
    """圓頭管子的半徑函數（兩端半球），taper<1 尾端變細"""
    e = min(0.45, r / max(length, 1e-6))
    def f(t):
        k = 1.0
        if t < e: k = np.sqrt(max(0.0, 1 - ((e - t) / e) ** 2))
        elif t > 1 - e: k = np.sqrt(max(0.0, 1 - ((t - 1 + e) / e) ** 2))
        rr = r * (1 + (taper - 1) * t)
        return (rr * k, rr * k)
    return f, e


def profile(points, w, h):
    """用控制點 (t, 比例) 做平滑半徑曲線"""
    p = np.array(points, float); f = PchipInterpolator(p[:, 0], p[:, 1])
    return lambda t: (w * float(f(t)), h * float(f(t)))


def ray_mesh(o, d, V, F):
    """Möller–Trumbore：射線和所有三角面求交，回傳 (距離, 點, 朝向射線來源的面法線) 或 None"""
    a, b, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    e1, e2 = b - a, c - a
    pv = np.cross(d, e2); det = np.einsum('ij,ij->i', e1, pv)
    ok = np.abs(det) > 1e-14
    inv = np.where(ok, 1 / np.where(ok, det, 1), 0)
    tv = o - a; u = np.einsum('ij,ij->i', tv, pv) * inv
    qv = np.cross(tv, e1); v = (qv @ d) * inv
    t = np.einsum('ij,ij->i', e2, qv) * inv
    hit = ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > 0)
    if not hit.any():
        return None
    i = np.where(hit)[0][np.argmin(t[hit])]
    n = np.cross(e1[i], e2[i]); n /= np.linalg.norm(n)
    if np.dot(n, d) > 0:
        n = -n
    return t[i], o + d * t[i], n


def smooth_normals(V, F):
    fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])  # 長度 = 2 倍面積（面積加權）
    N = np.zeros_like(V)
    for k in range(3):
        np.add.at(N, F[:, k], fn)
    # 接縫和極點：位置相同的頂點共用法線
    key = np.round(V / 1e-6).astype(np.int64)
    _, inv = np.unique(key, axis=0, return_inverse=True)
    inv = inv.reshape(-1)
    S = np.zeros((inv.max() + 1, 3)); np.add.at(S, inv, N)
    N = S[inv]
    n = np.linalg.norm(N, axis=1, keepdims=True); n[n == 0] = 1
    return (N / n).astype(np.float32)


# ---------------------------------------------------------------- 玩具
class Toy:
    def __init__(self, name):
        self.name = name; self.parts = []; self.mats = {}

    def mat(self, key, color, rough=0.9, sheen=0.55, fabric=True, emissive=None, ao=True):
        self.mats[key] = dict(color=lin(color), rough=rough, sheen=sheen, fabric=fabric,
                              emissive=emissive, ao=ao)

    def add(self, name, mat, mesh, R=np.eye(3), pos=(0, 0, 0), deform=None):
        V, F, UV = mesh
        V = V @ np.asarray(R).T + np.asarray(pos, float)
        if deform:
            V = deform(V)
        # 讓三角面朝外（體積為正）
        vol = np.einsum('ij,ij->i', V[F[:, 0]], np.cross(V[F[:, 1]], V[F[:, 2]])).sum()
        if vol < 0:
            F = F[:, [0, 2, 1]]
        self.parts.append(dict(name=name, mat=mat, V=V, F=F, UV=UV))
        return V

    def ell(self, name, mat, r, pos, R=np.eye(3), nu=40, nv=24, deform=None):
        return self.add(name, mat, ellipsoid(r, nu, nv), R, pos, deform)

    def hit(self, x, y, names, d=(0, 0, -1), z0=1.0, origin=None):
        """從前方（+Z）往後打一條射線，回傳落在指定部件上的 (點, 法線)"""
        best = None
        o = np.array(origin if origin is not None else (x, y, z0), float)
        d = np.asarray(d, float) / np.linalg.norm(d)
        for p in self.parts:
            if p['name'] not in names:
                continue
            r = ray_mesh(o, d, p['V'], p['F'])
            if r and (best is None or r[0] < best[0]):
                best = r
        if best is None:
            raise ValueError(f'{self.name}: ray at {x},{y} missed {names}')
        return best[1], best[2]

    def stick(self, name, mat, r, x, y, on, inset=0.4, up=(0, 1, 0), nu=24, nv=14, d=(0, 0, -1), z0=1.0, origin=None):
        """在表面 (x,y) 處貼一個橢球（本地 Z 沿法線），inset = 埋進去的比例（以 r[2] 計）"""
        p, n = self.hit(x, y, on, d, z0, origin)
        R = frame_to(n, up)
        return self.ell(name, mat, r, p + n * r[2] * (1 - 2 * inset), R, nu, nv), p, n

    def curve(self, name, mat, xy, on, r, lift=0.4, nu=10, nv=40, d=(0, 0, -1)):
        """沿表面畫一條線（嘴巴）：xy 是 (x,y) 點列，投影到部件表面上"""
        pts = []
        for x, y in xy:
            p, n = self.hit(x, y, on, d)
            pts.append(p + n * r * lift)
        pts = np.array(pts)
        L = np.linalg.norm(np.diff(pts, axis=0), axis=1).sum()
        f, e = tube_profile(r, L)
        hint = np.cross(pts[-1] - pts[0], (0, 1, 0)) if np.linalg.norm(np.cross(pts[-1] - pts[0], (0, 1, 0))) > 1e-9 else (1, 0, 0)
        return self.add(name, mat, sweep(pts, f, nu, nv, hint=hint, t=cap_t(nv, e)))

    def finish(self, scale=1.0):
        """整體縮放、底部對齊 y=0、X 置中，算法線和頂點 AO"""
        for p in self.parts:
            p['V'] = p['V'] * scale
            p['UV'] = p['UV'] * scale   # 布紋密度跟著縮放前的大小走，看起來才一致
        allV = np.concatenate([p['V'] for p in self.parts])
        lo, hi = allV.min(0), allV.max(0)
        off = np.array([-(lo[0] + hi[0]) / 2, -lo[1], -(lo[2] + hi[2]) / 2])
        off[2] = 0.0  # Z 不置中：保持臉朝 +Z 的設計座標（旋轉軸由渲染器自己用包圍盒中心）
        for p in self.parts:
            p['V'] = (p['V'] + off).astype(np.float32)
            p['N'] = smooth_normals(p['V'], p['F'])
        # 頂點 AO：靠近其他部件表面的地方變暗（部件相接處的縫）
        trees = []
        for p in self.parts:
            m = trimesh.Trimesh(p['V'], p['F'], process=False)
            cnt = int(np.clip(m.area / 0.0011 ** 2, 1500, 40000))
            pts, _ = trimesh.sample.sample_surface(m, cnt, seed=1)
            trees.append(cKDTree(np.concatenate([pts, p['V']])))
        for i, p in enumerate(self.parts):
            occ = np.zeros(len(p['V'])); fall = 0.0045 * scale
            for j, q in enumerate(self.parts):
                if i == j:
                    continue
                dist, idx = trees[j].query(p['V'], k=1, distance_upper_bound=0.03 * scale)
                ok = np.isfinite(dist)
                if not ok.any():
                    continue
                dd = np.where(ok, dist, 1.0)
                occ = np.maximum(occ, np.where(ok, np.exp(-dd / fall), 0))
            p['AO'] = (1 - 0.42 * occ).astype(np.float32)
        self.size = (allV.max(0) - allV.min(0))
        return self


# ---------------------------------------------------------------- 三隻暫代玩具
def flat_bottom(y0, k=0.25):
    def f(V):
        V = V.copy(); m = V[:, 1] < y0
        V[m, 1] = y0 + (V[m, 1] - y0) * k
        return V
    return f


def eye(t, side, x, y, on, size=1.0, d=(0, 0, -1)):
    """亮面黑眼睛 + 兩顆反光點"""
    _, p, n = t.stick(f'eye{side}', 'eye', np.array([0.0068, 0.0084, 0.0042]) * size, x, y, on, inset=0.35, d=d)
    R = frame_to(n)
    hl = p + R @ np.array([0.0024, 0.0030, 0.0]) * size + n * 0.0040 * size
    t.ell(f'eyehl{side}', 'hl', np.array([0.0021, 0.0021, 0.0012]) * size, hl, R, 12, 8)
    hl2 = p + R @ np.array([-0.0024, -0.0028, 0.0]) * size + n * 0.0036 * size
    t.ell(f'eyehl2{side}', 'hl', np.array([0.0011, 0.0011, 0.0007]) * size, hl2, R, 10, 6)


def build_bunny():
    t = Toy('bunny')
    t.mat('fur', '#f4e8d6', sheen=0.3)
    t.mat('white', '#fff8ee', sheen=0.3)
    t.mat('pink', '#ff9ebb', sheen=0.25)
    t.mat('blush', '#ff9db6', sheen=0.2)
    t.mat('nose', '#ff7fa0', rough=0.6, fabric=False, sheen=0)
    t.mat('line', '#5a3a3a', rough=0.8, fabric=False, sheen=0)
    t.mat('eye', '#1d1416', rough=0.18, fabric=False, sheen=0, ao=False)
    t.mat('hl', '#ffffff', rough=0.3, fabric=False, sheen=0, emissive=(1, 1, 1), ao=False)
    t.ell('body', 'fur', (0.047, 0.050, 0.044), (0, 0.050, -0.004), nu=56, nv=32, deform=flat_bottom(0.012))
    t.ell('head', 'fur', (0.060, 0.051, 0.052), (0, 0.117, 0.004), nu=64, nv=36)
    t.ell('muzzle', 'white', (0.024, 0.016, 0.013), (0, 0.101, 0.043), nu=32, nv=18)
    # 耳朵：在本地 XY 平面掃掠，厚度沿 Z，再轉到頭頂
    ear_pts = [(0, -0.01, 0), (0.002, 0.025, 0), (0.005, 0.055, 0), (0.002, 0.083, 0)]
    ear_w = profile([(0, 0), (0.03, 0.5), (0.12, 0.72), (0.35, 0.93), (0.6, 1.0), (0.82, 0.86), (0.93, 0.62), (0.985, 0.32), (1, 0)], 0.0175, 0.0085)
    in_w = profile([(0, 0), (0.05, 0.55), (0.3, 0.9), (0.6, 1.0), (0.85, 0.8), (0.97, 0.4), (1, 0)], 0.0105, 0.0032)
    for s in (-1, 1):
        R = rot(-10, s * 12, -s * 13)
        base = np.array([s * 0.021, 0.152, -0.006])
        t.add(f'ear{s}', 'fur', sweep(ear_pts, ear_w, 28, 44, hint=(0, 0, 1)), R, base)
        inner = sweep(ear_pts, in_w, 20, 36, hint=(0, 0, 1), t_range=(0.2, 0.95),
                      offset=lambda tt: ear_w(tt)[1] - 0.0016)
        t.add(f'earin{s}', 'pink', inner, R, base)
    eye(t, 'L', -0.0245, 0.123, ['head'])
    eye(t, 'R', 0.0245, 0.123, ['head'])
    t.stick('nose', 'nose', (0.0068, 0.0048, 0.004), 0, 0.1085, ['muzzle', 'head'], inset=0.3)
    for s in (-1, 1):
        t.stick(f'cheek{s}', 'blush', (0.0115, 0.0068, 0.0032), s * 0.038, 0.106, ['head'], inset=0.45)
    # 小小的 ω 嘴
    t.curve('mouthL', 'line', [(-0.0085, 0.0985), (-0.0045, 0.0962), (-0.0006, 0.0990)], ['muzzle', 'head'], 0.0011)
    t.curve('mouthR', 'line', [(0.0006, 0.0990), (0.0045, 0.0962), (0.0085, 0.0985)], ['muzzle', 'head'], 0.0011)
    t.curve('mouthC', 'line', [(0, 0.1045), (0, 0.1012), (0, 0.0990)], ['muzzle', 'head'], 0.0011)
    for s in (-1, 1):
        t.ell(f'arm{s}', 'fur', (0.0145, 0.022, 0.015), (s * 0.031, 0.056, 0.032), rot(20, 0, s * 18), 28, 16)
        t.ell(f'foot{s}', 'fur', (0.0185, 0.0135, 0.026), (s * 0.026, 0.0135, 0.029), rot(0, s * 10, 0), 32, 18)
        t.stick(f'pad{s}', 'pink', (0.0085, 0.0075, 0.003), s * 0.027, 0.0145, [f'foot{s}'], inset=0.4)
    t.ell('tail', 'white', (0.017, 0.016, 0.015), (0, 0.032, -0.047), nu=28, nv=16)
    return t.finish(0.82)


def build_frog():
    t = Toy('frog')
    t.mat('skin', '#56c234', sheen=0.3)
    t.mat('dark', '#43a52a', sheen=0.3)
    t.mat('belly', '#eaf5a0', sheen=0.3)
    t.mat('white', '#ffffff', sheen=0.2)
    t.mat('blush', '#ff9db0', sheen=0.2)
    t.mat('line', '#3d2626', rough=0.8, fabric=False, sheen=0)
    t.mat('eye', '#1a1214', rough=0.18, fabric=False, sheen=0, ao=False)
    t.mat('hl', '#ffffff', rough=0.3, fabric=False, sheen=0, emissive=(1, 1, 1), ao=False)

    def pear(V):  # 下面比較寬、底部壓平
        V = flat_bottom(0.014, 0.22)(V)
        k = 1 + 0.10 * np.clip(1 - V[:, 1] / 0.09, 0, 1)
        V[:, 0] *= k; V[:, 2] *= k
        return V
    t.ell('body', 'skin', (0.064, 0.050, 0.055), (0, 0.052, 0), nu=64, nv=36, deform=pear)
    t.ell('belly', 'belly', (0.046, 0.031, 0.030), (0, 0.036, 0.034), nu=48, nv=28)
    for s in (-1, 1):
        x = s * 0.031
        t.ell(f'bump{s}', 'skin', (0.0215, 0.0205, 0.020), (x, 0.097, 0.010), nu=40, nv=24)
        t.ell(f'sclera{s}', 'white', (0.0158, 0.0158, 0.010), (x, 0.0995, 0.0225), nu=36, nv=20)
    for s, side in ((-1, 'L'), (1, 'R')):
        eye(t, side, s * 0.0285, 0.0985, [f'sclera{s}'], size=1.12)
    # 大大的笑臉
    xs = np.linspace(-0.036, 0.036, 15)
    t.curve('mouth', 'line', [(x, 0.0705 - 0.012 * (1 - (x / 0.036) ** 2)) for x in xs], ['body', 'belly'], 0.0019)
    for s in (-1, 1):
        t.curve(f'dimple{s}', 'line', [(s * 0.0335, 0.0738), (s * 0.0375, 0.0712), (s * 0.0385, 0.0682)], ['body'], 0.0016)
        t.stick(f'cheek{s}', 'blush', (0.011, 0.0068, 0.003), s * 0.047, 0.067, ['body'], inset=0.45)
        # 前腳 + 三根腳趾
        fx = s * 0.034
        t.ell(f'foot{s}', 'dark', (0.018, 0.0075, 0.016), (fx, 0.0072, 0.046), rot(0, s * 15, 0), 32, 16)
        for k, a in enumerate((-35, 0, 35)):
            d = rot(0, s * 15 + a, 0) @ np.array([0, 0, 1.0])
            t.ell(f'toe{s}{k}', 'dark', (0.0062, 0.0055, 0.0062), np.array([fx, 0.0072, 0.046]) + d * 0.0155, nu=16, nv=10)
        # 後腿
        t.ell(f'leg{s}', 'skin', (0.017, 0.021, 0.029), (s * 0.058, 0.021, -0.008), rot(0, s * 20, s * 10), 32, 18)
    return t.finish()


def build_moodeng():
    """Moo Deng（หมูเด้ง，彈跳豬）：泰國 Khao Kheow 開放動物園的侏儒河馬寶寶，做成圓滾滾的毛絨版。
    四隻短短的腳、超寬的圓鼻口（鼻孔長在上面）、小眼睛、小圓耳朵、張著嘴的招牌表情、粉紅臉頰。
    顏色用比真的河馬淺的灰粉紫，64px 也看得出來，不會跟深灰色的皮蛋搞混。"""
    t = Toy('moodeng')
    t.mat('skin', '#8f7d89', sheen=0.35)       # 灰粉紫的身體
    t.mat('snout', '#9c8893', sheen=0.35)      # 鼻口稍微亮一點
    t.mat('chin', '#a98893', sheen=0.3)        # 下巴：偏粉的灰
    t.mat('pink', '#c49aa3', sheen=0.3)        # 肚子
    t.mat('inner', '#b8435f', sheen=0.15)      # 嘴巴裡面
    t.mat('tongue', '#ff8ea5', sheen=0.2)
    t.mat('tooth', '#fffaf2', rough=0.5, fabric=False, sheen=0)
    t.mat('blush', '#ff86a3', sheen=0.2)
    t.mat('earin', '#eba0ae', sheen=0.25)
    t.mat('nostril', '#4a2f3b', rough=0.8, fabric=False, sheen=0)
    t.mat('nail', '#f3dfd9', sheen=0.2)
    t.mat('eye', '#1d1416', rough=0.18, fabric=False, sheen=0, ao=False)
    t.mat('hl', '#ffffff', rough=0.3, fabric=False, sheen=0, emissive=(1, 1, 1), ao=False)
    # 身體：前後長的圓桶
    t.ell('body', 'skin', (0.052, 0.044, 0.064), (0, 0.060, -0.022), nu=64, nv=36)
    t.ell('belly', 'pink', (0.038, 0.026, 0.048), (0, 0.041, -0.020), nu=36, nv=20)
    # 四隻短腿 + 三片趾甲
    for s in (-1, 1):
        for zk, z in (('f', 0.018), ('b', -0.060)):
            nm = f'leg{zk}{s}'
            t.ell(nm, 'skin', (0.0175, 0.021, 0.0185), (s * 0.031, 0.019, z), nu=32, nv=18, deform=flat_bottom(0.005, 0.2))
            for k, dx in enumerate((-0.0075, 0.0, 0.0075)):
                t.stick(f'nail{zk}{s}{k}', 'nail', (0.0036, 0.0030, 0.0022), s * 0.031 + dx, 0.0065, [nm], inset=0.45, nu=14, nv=8)
    # 頭：圓圓的頭殼 + 很寬的鼻口（底部壓平）+ 往下張開的下巴，中間露出嘴巴裡面和舌頭
    t.ell('head', 'skin', (0.047, 0.043, 0.042), (0, 0.112, 0.034), nu=64, nv=36)
    t.ell('snout', 'snout', (0.050, 0.029, 0.036), (0, 0.098, 0.066), nu=64, nv=32, deform=flat_bottom(0.086, 0.35))
    # 張開的嘴：下巴往下掉，上緣兩邊和後面往上翹到鼻口下面（側面看是一個楔形的大嘴），
    # 中間露出深粉紅的嘴巴裡面、舌頭和兩顆小牙；喉嚨把下巴接回身體
    def jaw_u(V):
        V = V.copy()
        up = np.clip((V[:, 1] - 0.034) / 0.022, 0, 1)
        V[:, 1] += up * (0.034 * np.clip(V[:, 0] / 0.038, -1, 1) ** 2 + 0.026 * np.clip((0.068 - V[:, 2]) / 0.030, 0, 1))
        return V
    t.ell('throat', 'skin', (0.040, 0.030, 0.026), (0, 0.066, 0.030), nu=40, nv=22)
    t.ell('jaw', 'chin', (0.038, 0.0155, 0.031), (0, 0.0445, 0.061), nu=56, nv=28, deform=jaw_u)
    t.ell('inner', 'inner', (0.031, 0.020, 0.024), (0, 0.066, 0.058), nu=32, nv=18)
    t.ell('tongue', 'tongue', (0.019, 0.0075, 0.015), (0, 0.0585, 0.071), rot(10, 0, 0), nu=28, nv=14)
    for s in (-1, 1):
        t.stick(f'tooth{s}', 'tooth', (0.0044, 0.0040, 0.0060), 0, 0, ['jaw'], inset=0.3, up=(0, 0, 1),
                d=(0, -1, 0), origin=(s * 0.021, 0.2, 0.082), nu=14, nv=10)
    # 鼻孔：鼻口上面的兩個小鼓包 + 深色橢圓
    for s in (-1, 1):
        t.stick(f'nbump{s}', 'snout', (0.011, 0.010, 0.0075), 0, 0, ['snout'], inset=0.5,
                up=(0, 0, 1), d=(0, -1, 0), origin=(s * 0.018, 0.2, 0.086), nu=20, nv=12)
        t.stick(f'nostril{s}', 'nostril', (0.0048, 0.0028, 0.0022), 0, 0, [f'nbump{s}'], inset=0.4,
                up=(-s * 0.5, 0, 1), d=(0, -1, 0), origin=(s * 0.018, 0.2, 0.087), nu=16, nv=10)
    # 小眼睛（高高的）、小圓耳朵、粉紅臉頰
    for s, side in ((-1, 'L'), (1, 'R')):
        eye(t, side, s * 0.024, 0.134, ['head'], size=1.02)
        R = rot(-10, s * 20, -s * 28)
        c = np.array((s * 0.034, 0.150, 0.016))
        t.ell(f'ear{s}', 'skin', (0.0105, 0.0125, 0.0065), c, R, 24, 14)
        t.ell(f'earin{s}', 'earin', (0.0062, 0.0078, 0.0028), c + R @ np.array((0, -0.0005, 0.0042)), R, 18, 10)
        t.stick(f'cheek{s}', 'blush', (0.0125, 0.0075, 0.0032), s * 0.040, 0.103, ['snout', 'head'], inset=0.45)
    # 小尾巴
    t.ell('tail', 'skin', (0.0065, 0.0060, 0.012), (0, 0.072, -0.086), rot(30, 0, 0), 18, 12)
    return t.finish()


BUILDERS = {'bunny': build_bunny, 'frog': build_frog, 'moodeng': build_moodeng}


# ---------------------------------------------------------------- 布料貼圖（可無縫拼接，固定亂數種子）
def fabric_textures(seed=7):
    rng = np.random.default_rng(seed)
    n = TEX
    f = np.fft.fftfreq(n) * n
    FX, FY = np.meshgrid(f, f)

    def band(lo, hi, aniso=None):
        w = np.fft.fft2(rng.standard_normal((n, n)))
        if aniso is not None:  # 某個方向拉長的纖維感
            c, s = np.cos(aniso), np.sin(aniso)
            u, v = FX * c + FY * s, -FX * s + FY * c
            r = np.sqrt((u * 0.35) ** 2 + v ** 2)
        else:
            r = np.sqrt(FX ** 2 + FY ** 2)
        m = np.exp(-((np.log(np.maximum(r, 1e-3)) - np.log(np.sqrt(lo * hi))) / np.log(hi / lo)) ** 2 * 2)
        m[0, 0] = 0
        h = np.real(np.fft.ifft2(w * m))
        return h / h.std()

    h = 0.55 * band(40, 110) + 0.35 * band(14, 40, aniso=0.6) + 0.25 * band(14, 40, aniso=2.1) + 0.3 * band(3, 9)
    h /= h.std()
    k = 0.10
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    N = np.stack([-dx * k, dy * k, np.ones_like(h)], -1)
    N /= np.linalg.norm(N, axis=-1, keepdims=True)
    nimg = Image.fromarray(((N * 0.5 + 0.5) * 255 + 0.5).astype(np.uint8), 'RGB')
    lum = np.clip(0.955 + 0.03 * h, 0.86, 1.0)
    dimg = Image.fromarray((np.repeat(lum[..., None], 3, -1) * 255 + 0.5).astype(np.uint8), 'RGB')
    nb = io.BytesIO(); nimg.save(nb, 'PNG', optimize=True)
    db = io.BytesIO(); dimg.save(db, 'JPEG', quality=90)
    dmean = float(np.mean(np.where(lum <= 0.04045, lum / 12.92, ((lum + 0.055) / 1.055) ** 2.4)))
    return nb.getvalue(), db.getvalue(), dmean


# ---------------------------------------------------------------- 依材質合併
def groups(toy):
    out = {}
    for p in toy.parts:
        g = out.setdefault(p['mat'], dict(V=[], N=[], UV=[], AO=[], F=[], n=0))
        g['F'].append(p['F'] + g['n']); g['n'] += len(p['V'])
        for k in ('V', 'N', 'UV', 'AO'):
            g[k].append(p[k])
    for g in out.values():
        for k in ('V', 'N', 'UV', 'AO', 'F'):
            g[k] = np.concatenate(g[k])
    return out


# ---------------------------------------------------------------- GLB（自己寫，才能共用一張貼圖、加 sheen）
def write_glb(toy, path, tex):
    nb, db, dmean = tex
    bin_ = bytearray(); views = []; accs = []

    def view(data, target=None):
        while len(bin_) % 4:
            bin_.append(0)
        views.append(dict(buffer=0, byteOffset=len(bin_), byteLength=len(data), **({'target': target} if target else {})))
        bin_.extend(data); return len(views) - 1

    def acc(arr, ctype, typ, target, normalized=False, minmax=False):
        a = dict(bufferView=view(arr.tobytes(), target), componentType=ctype, count=len(arr), type=typ)
        if normalized: a['normalized'] = True
        if minmax: a['min'] = arr.min(0).tolist(); a['max'] = arr.max(0).tolist()
        accs.append(a); return len(accs) - 1

    imgs = [dict(bufferView=view(nb), mimeType='image/png'), dict(bufferView=view(db), mimeType='image/jpeg')]
    mats, meshes, nodes = [], [], []
    for key, g in groups(toy).items():
        m = toy.mats[key]
        pbr = dict(baseColorFactor=[*np.clip(m['color'] / (dmean if m['fabric'] else 1), 0, 1).tolist(), 1.0],
                   metallicFactor=0.0, roughnessFactor=m['rough'])
        md = dict(name=key, pbrMetallicRoughness=pbr)
        if m['fabric']:
            pbr['baseColorTexture'] = dict(index=1)
            md['normalTexture'] = dict(index=0, scale=1.0)
        if m['emissive']:
            md['emissiveFactor'] = list(m['emissive'])
        if m['sheen']:
            sc = (m['color'] * 0.5 + 0.5) * m['sheen']
            md['extensions'] = {'KHR_materials_sheen': dict(sheenColorFactor=sc.tolist(), sheenRoughnessFactor=0.55)}
        mats.append(md)
        V = g['V'].astype(np.float32); N = g['N'].astype(np.float32)
        UV = g['UV'].astype(np.float32); F = g['F']
        ao = g['AO'] if m['ao'] else np.ones(len(V), np.float32)
        col = np.concatenate([np.repeat((ao * 255 + 0.5).astype(np.uint8)[:, None], 3, 1),
                              np.full((len(V), 1), 255, np.uint8)], 1)
        idx = F.astype(np.uint16 if len(V) < 65536 else np.uint32).reshape(-1)
        prim = dict(attributes=dict(POSITION=acc(V, 5126, 'VEC3', 34962, minmax=True), NORMAL=acc(N, 5126, 'VEC3', 34962),
                                    TEXCOORD_0=acc(UV, 5126, 'VEC2', 34962), COLOR_0=acc(col, 5121, 'VEC4', 34962, normalized=True)),
                    indices=acc(idx, 5123 if idx.dtype == np.uint16 else 5125, 'SCALAR', 34963), material=len(mats) - 1)
        meshes.append(dict(name=key, primitives=[prim]))
        nodes.append(dict(name=key, mesh=len(meshes) - 1))
    doc = dict(asset=dict(version='2.0', generator='shubing tools/make_placeholders.py'),
               extensionsUsed=['KHR_materials_sheen'], scene=0,
               scenes=[dict(name=toy.name, nodes=[len(nodes)])],
               nodes=nodes + [dict(name=toy.name, children=list(range(len(nodes))))],
               meshes=meshes, materials=mats, accessors=accs, bufferViews=views,
               buffers=[dict(byteLength=0)], images=imgs,
               samplers=[dict(magFilter=9729, minFilter=9987, wrapS=10497, wrapT=10497)],
               textures=[dict(sampler=0, source=0), dict(sampler=0, source=1)])
    while len(bin_) % 4:
        bin_.append(0)
    doc['buffers'][0]['byteLength'] = len(bin_)
    js = json.dumps(doc, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bin_)))
        f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack('<II', len(bin_), 0x004E4942)); f.write(bin_)


# ---------------------------------------------------------------- USDZ（usd-core，UsdPreviewSurface）
def write_usdz(toy, path, tex):
    from pxr import Usd, UsdGeom, UsdShade, UsdUtils, Sdf, Gf, Vt
    nb = tex[0]
    work = tempfile.mkdtemp(prefix='ph_')
    try:
        os.makedirs(os.path.join(work, '0'))
        with open(os.path.join(work, '0', 'fabric_n.png'), 'wb') as f:
            f.write(nb)
        usdc = os.path.join(work, toy.name + '.usdc')
        st = Usd.Stage.CreateNew(usdc)
        UsdGeom.SetStageUpAxis(st, UsdGeom.Tokens.y)
        UsdGeom.SetStageMetersPerUnit(st, 1.0)
        root = UsdGeom.Xform.Define(st, f'/{toy.name}')
        st.SetDefaultPrim(root.GetPrim())
        Usd.ModelAPI(root.GetPrim()).SetKind('component')
        st.GetRootLayer().customLayerData = {'creator': 'shubing tools/make_placeholders.py', 'placeholder': True}
        UsdGeom.Scope.Define(st, f'/{toy.name}/Materials'); UsdGeom.Scope.Define(st, f'/{toy.name}/Geometry')
        for key, g in groups(toy).items():
            m = toy.mats[key]
            mp = f'/{toy.name}/Materials/{key}'
            mat = UsdShade.Material.Define(st, mp)
            sh = UsdShade.Shader.Define(st, mp + '/surface')
            sh.CreateIdAttr('UsdPreviewSurface')
            sh.CreateInput('diffuseColor', Sdf.ValueTypeNames.Color3f).Set(Gf.Vec3f(*m['color'].tolist()))
            sh.CreateInput('roughness', Sdf.ValueTypeNames.Float).Set(float(m['rough']))
            sh.CreateInput('metallic', Sdf.ValueTypeNames.Float).Set(0.0)
            if m['emissive']:
                sh.CreateInput('emissiveColor', Sdf.ValueTypeNames.Color3f).Set(Gf.Vec3f(*[e * 0.8 for e in m['emissive']]))
            mat.CreateSurfaceOutput().ConnectToSource(sh.ConnectableAPI(), 'surface')
            if m['fabric']:
                stn = mat.CreateInput('frame:stPrimvarName', Sdf.ValueTypeNames.String); stn.Set('st')
                rd = UsdShade.Shader.Define(st, mp + '/uvReader')
                rd.CreateIdAttr('UsdPrimvarReader_float2')
                rd.CreateInput('varname', Sdf.ValueTypeNames.String).ConnectToSource(stn)
                rd.CreateOutput('result', Sdf.ValueTypeNames.Float2)
                tx = UsdShade.Shader.Define(st, mp + '/normalTex')
                tx.CreateIdAttr('UsdUVTexture')
                tx.CreateInput('file', Sdf.ValueTypeNames.Asset).Set('0/fabric_n.png')
                tx.CreateInput('st', Sdf.ValueTypeNames.Float2).ConnectToSource(rd.ConnectableAPI(), 'result')
                tx.CreateInput('wrapS', Sdf.ValueTypeNames.Token).Set('repeat')
                tx.CreateInput('wrapT', Sdf.ValueTypeNames.Token).Set('repeat')
                tx.CreateInput('sourceColorSpace', Sdf.ValueTypeNames.Token).Set('raw')
                tx.CreateInput('scale', Sdf.ValueTypeNames.Float4).Set(Gf.Vec4f(2, 2, 2, 2))
                tx.CreateInput('bias', Sdf.ValueTypeNames.Float4).Set(Gf.Vec4f(-1, -1, -1, -1))
                tx.CreateOutput('rgb', Sdf.ValueTypeNames.Float3)
                sh.CreateInput('normal', Sdf.ValueTypeNames.Normal3f).ConnectToSource(tx.ConnectableAPI(), 'rgb')
            mesh = UsdGeom.Mesh.Define(st, f'/{toy.name}/Geometry/{key}')
            V = g['V']; F = g['F']
            mesh.CreatePointsAttr(Vt.Vec3fArray.FromNumpy(V.astype(np.float32)))
            mesh.CreateFaceVertexCountsAttr(Vt.IntArray.FromNumpy(np.full(len(F), 3, np.int32)))
            mesh.CreateFaceVertexIndicesAttr(Vt.IntArray.FromNumpy(F.astype(np.int32).reshape(-1)))
            mesh.CreateNormalsAttr(Vt.Vec3fArray.FromNumpy(g['N'].astype(np.float32)))
            mesh.SetNormalsInterpolation(UsdGeom.Tokens.vertex)
            mesh.CreateSubdivisionSchemeAttr(UsdGeom.Tokens.none)
            mesh.CreateExtentAttr([Gf.Vec3f(*V.min(0).tolist()), Gf.Vec3f(*V.max(0).tolist())])
            uv = g['UV'].astype(np.float32).copy(); uv[:, 1] = -uv[:, 1]   # glTF 的 v 往下、USD 的 v 往上
            pv = UsdGeom.PrimvarsAPI(mesh).CreatePrimvar('st', Sdf.ValueTypeNames.TexCoord2fArray, UsdGeom.Tokens.vertex)
            pv.Set(Vt.Vec2fArray.FromNumpy(uv))
            UsdShade.MaterialBindingAPI.Apply(mesh.GetPrim()).Bind(mat)
        st.GetRootLayer().Save()
        out_tmp = os.path.join(work, toy.name + '.usdz')
        if not UsdUtils.CreateNewUsdzPackage(Sdf.AssetPath(usdc), out_tmp):
            raise RuntimeError('CreateNewUsdzPackage failed')
        from slim_usdz import fix_zip_times
        fix_zip_times(out_tmp)       # 固定 zip 時間戳：每次重做 bytes 都一樣，git 不會一直顯示 .usdz 有改
        shutil.copyfile(out_tmp, path)
    finally:
        shutil.rmtree(work, ignore_errors=True)


def build(ids, outdir):
    os.makedirs(outdir, exist_ok=True)
    tex = fabric_textures()
    res = {}
    for i in ids:
        toy = BUILDERS[i]()
        g, u = os.path.join(outdir, i + '.glb'), os.path.join(outdir, i + '.usdz')
        write_glb(toy, g, tex); write_usdz(toy, u, tex)
        nv = sum(len(p['V']) for p in toy.parts); nf = sum(len(p['F']) for p in toy.parts)
        sz = ' x '.join(f'{v * 100:.1f}' for v in toy.size)
        print(f'{i}: {len(toy.parts)} 部件, {nv} 頂點, {nf} 面, {sz} cm -> '
              f'{os.path.getsize(g) // 1024} KB glb, {os.path.getsize(u) // 1024} KB usdz')
        res[i] = (g, u)
    return res


if __name__ == '__main__':
    args = sys.argv[1:]
    out = 'tools/out/models'
    if '--out' in args:
        k = args.index('--out'); out = args[k + 1]; del args[k:k + 2]
    build(args or list(BUILDERS), out)
