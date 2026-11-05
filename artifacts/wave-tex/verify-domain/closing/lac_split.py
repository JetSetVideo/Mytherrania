# QD closing (parent fix Z-154): split the 400-d laceration's albedo contrast into scar L* and ring L* per run,
# so a change in dL* can be attributed to the scar (decal colour) or to the ring (crest/edge paint on skin).
#   uv run --with pillow --with numpy --with scipy python artifacts/wave-tex/verify-domain/closing/lac_split.py <runA> <runB> ...
import json, sys
import numpy as np
from PIL import Image
from scipy import ndimage

def lab(rgb):
    c = rgb.astype(np.float64) / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = (lin @ M.T) / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)

out = {}
for run in sys.argv[1:]:
    idx = json.load(open(f"artifacts/wave-tex/captures/{run}/index.json"))
    cache = {}
    def tile(race, sex, variant, view, angle):
        for im in idx["images"]:
            if im["race"] == race and im["sex"] == sex and im["variant"] == variant and im["view"] == view and im["angle"] == angle and im["sheet"].endswith("channels"):
                p = im["path"]
                if p not in cache: cache[p] = np.asarray(Image.open(p).convert("RGB"))
                x, y, w, h = im["render"]; return cache[p][y:y + h, x:x + w]
    for subj in ["human-male", "elf-female", "dwarf-male", "ork-female"]:
        race, sex = subj.split("-")
        mk, mr = tile(race, sex, "marked-bare", "marks", "forearm"), tile(race, sex, "reference", "marks", "forearm")
        al, fi, rf = (tile(race, sex, v, w, "forearm") for v, w in (("marked-bare", "albedo"), ("marked-bare", "final"), ("reference", "albedo")))
        d = np.sqrt(((lab(mk) - lab(mr)) ** 2).sum(-1)); mask = d > 6
        lbl, n = ndimage.label(mask, structure=np.ones((3, 3)))
        bg = (np.abs(al.astype(int) - al[2, 2].astype(int)).sum(-1) < 6)
        best = None
        for k in range(1, n + 1):
            m = lbl == k
            if m.sum() < 10 or mk[m].mean(0).mean() < 160: continue
            if best is None or m.sum() > best.sum(): best = m
        m = best
        ring = ndimage.binary_dilation(m, iterations=7) & ~ndimage.binary_dilation(m, iterations=3) & ~mask & ~bg
        L, F = lab(al), lab(fi)
        C = lambda v: np.hypot(v[:, 1], v[:, 2])
        out.setdefault(subj, {})[run] = {
            "px": int(m.sum()), "scarL": round(float(L[m][:, 0].mean()), 1), "ringL": round(float(L[ring][:, 0].mean()), 1),
            "dL": round(float(L[m][:, 0].mean() - L[ring][:, 0].mean()), 1), "dC": round(float(C(L[m]).mean() - C(L[ring]).mean()), 1),
            "scarC": round(float(C(L[m]).mean()), 1), "ringC": round(float(C(L[ring]).mean()), 1),
            "final_dL": round(float(F[m][:, 0].mean() - F[ring][:, 0].mean()), 1),
            "scarLp10": round(float(np.percentile(L[m][:, 0], 10)), 1), "ringLp90": round(float(np.percentile(L[ring][:, 0], 90)), 1),
            "dL_vsRingMedian": round(float(L[m][:, 0].mean() - np.median(L[ring][:, 0])), 1), "ringLp50": round(float(np.median(L[ring][:, 0])), 1), "ringLp25": round(float(np.percentile(L[ring][:, 0], 25)), 1),
            "paler_px_share": round(float((L[m][:, 0] > np.median(L[ring][:, 0])).mean()), 2)}
print(json.dumps(out, indent=1))
json.dump(out, open("artifacts/wave-tex/verify-domain/closing/lac-split.json", "w"), indent=1)
