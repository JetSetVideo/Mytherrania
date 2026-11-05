# QD (wave TEX closing): drawn face decals vs the REAL eyes/lips on C's face close-up (r06f-final).
#   uv run --with pillow --with numpy --with scipy --with matplotlib python artifacts/wave-tex/verify-domain/face_hits.py <run> [variant...]
# mask = marks-view pixels of <variant> differing from the reference marks view (dE > 6) on the 'face' tile;
# zones = face-project.json (rig eye globes / lips projected with the capture's camera law).
# Validation of the projection: colour of the reference FINAL tile at each eye centre (must be iris/sclera, not skin).
import json, sys, numpy as np
from PIL import Image
from matplotlib.path import Path
from scipy import ndimage
run = sys.argv[1]; variants = sys.argv[2:] or ["marked-bare", "marked"]
idx = json.load(open(f"artifacts/wave-tex/captures/{run}/index.json"))
fp = json.load(open(f"artifacts/wave-tex/verify-domain/{run}/face-project.json"))
def lab(rgb):
    c = rgb.astype(np.float64) / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = (lin @ M.T) / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)
cache = {}
def tile(race, sex, variant, view, angle="face", sheet="channels"):
    for im in idx["images"]:
        if (im["race"], im["sex"], im["variant"], im["view"], im["angle"]) == (race, sex, variant, view, angle) and im["sheet"].endswith(sheet) and im["light"] == "studio":
            if im["path"] not in cache: cache[im["path"]] = np.asarray(Image.open(im["path"]).convert("RGB"))
            x, y, w, h = im["render"]; return cache[im["path"]][y:y + h, x:x + w]
    return None
res = {"run": run, "rows": []}
for subj, f in fp.items():
    race, sex = subj.split("-")
    ref_fin = tile(race, sex, "reference", "final")
    eyecol = {z["name"]: [int(v) for v in ref_fin[int(round(z["centre"][1])), int(round(z["centre"][0]))]] for z in f["zones"] if z["name"].startswith("eye")}
    H, W = ref_fin.shape[:2]
    yy, xx = np.mgrid[0:H, 0:W]; pts = np.stack([xx.ravel() + 0.5, yy.ravel() + 0.5], 1)
    zm = {z["name"]: Path(z["poly"]).contains_points(pts).reshape(H, W) for z in f["zones"]}
    from scipy.spatial import ConvexHull
    lp = np.array(f["lipPts"]); hull = lp[ConvexHull(lp).vertices]
    zm["lips(drawn)"] = Path(hull).contains_points(pts).reshape(H, W)
    for variant in variants:
        mk = tile(race, sex, variant, "marks"); mr = tile(race, sex, "reference", "marks")
        if mk is None: continue
        mask = np.sqrt(((lab(mk) - lab(mr)) ** 2).sum(-1)) > 6
        lbl, n = ndimage.label(mask, structure=np.ones((3, 3)))
        parts = []
        for k in range(1, n + 1):
            m = lbl == k
            if m.sum() < 6: continue
            ys, xs = np.where(m)
            hits = {zn: int((m & z).sum()) for zn, z in zm.items()}
            # nearest distance (mm) from the part to each zone boundary (0 if inside)
            near = {}
            for zn, z in zm.items():
                dt = ndimage.distance_transform_edt(~z)
                near[zn] = round(float(dt[m].min()) * f["mmPerPx"], 1)
            parts.append({"px": int(m.sum()), "bbox": [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())], "zoneHitsPx": hits, "gapMm": near})
        parts.sort(key=lambda p: -p["px"])
        res["rows"].append({"subject": subj, "variant": variant, "mmPerPx": f["mmPerPx"], "eyeColourAtCentre": eyecol, "maskPx": int(mask.sum()),
                            "hitPx": int(sum(sum(v for k, v in p["zoneHitsPx"].items() if k != "mouth") for p in parts)), "perioralZonePx": int(sum(p["zoneHitsPx"]["mouth"] for p in parts)), "parts": parts})
        # overlay for the record: zones cyan, decal mask magenta, on the final view
        fin = tile(race, sex, variant, "final").copy()
        for z in zm.values():
            e = z & ~ndimage.binary_erosion(z); fin[e] = [0, 255, 255]
        e = ndimage.binary_dilation(mask) & ~mask; fin[e] = [255, 0, 255]
        Image.fromarray(fin[250:470, 60:330]).resize((540, 440), Image.NEAREST).save(f"artifacts/wave-tex/verify-domain/{run}/{subj}-{variant}-face-zones.png")
json.dump(res, open(f"artifacts/wave-tex/verify-domain/{run}/face-hits.json", "w"), indent=1)
for r in res["rows"]:
    print(r["subject"], r["variant"], "eye px", r["eyeColourAtCentre"], "mask", r["maskPx"], "HITS eyes+lips", r["hitPx"], "perioral", r["perioralZonePx"], [(p["px"], p["bbox"], p["gapMm"]) for p in r["parts"][:3]])
