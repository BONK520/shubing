import sys
from pxr import Usd, UsdGeom
for p in sys.argv[1:]:
    st = Usd.Stage.Open(p)
    print("==", p, "upAxis", UsdGeom.GetStageUpAxis(st), "mpu", UsdGeom.GetStageMetersPerUnit(st))
    for prim in st.Traverse():
        line = f"  {prim.GetPath()} {prim.GetTypeName()}"
        if prim.IsA(UsdGeom.Mesh):
            m = UsdGeom.Mesh(prim)
            pts = m.GetPointsAttr().Get()
            fvc = m.GetFaceVertexCountsAttr().Get()
            line += f" pts={len(pts)} faces={len(fvc)}"
            pv = UsdGeom.PrimvarsAPI(prim)
            for v in pv.GetPrimvars():
                line += f"\n     primvar {v.GetName()} interp={v.GetInterpolation()} indexed={v.IsIndexed()}"
            bb = UsdGeom.BBoxCache(0,['default']).ComputeWorldBound(prim).ComputeAlignedRange()
            line += f"\n     bbox {bb.GetMin()} {bb.GetMax()}"
        print(line)
