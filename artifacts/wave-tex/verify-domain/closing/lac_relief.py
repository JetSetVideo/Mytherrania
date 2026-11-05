# QD closing: relief + colour of the 400-d forearm laceration (the pale/warm marks-view component, not the ink band).
# height view inside the component vs a 3..7 px skin ring (median, mean, p95 |dh|), roughness, albedo dL*/dC*.
import json, sys
import numpy as np
from PIL import Image
from scipy import ndimage
sys.path.insert(0, "artifacts/wave-tex/verify-domain")
run = sys.argv[1]
idx = json.load(open(f"artifacts/wave-tex/captures/{run}/index.json"))
def lab(rgb):
    c = rgb.astype(np.float64) / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = (lin @ M.T) / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)
cache = {}
def tile(race, sex, variant, view, angle):
    for im in idx["images"]:
        if im["race"] == race and im["sex"] == sex and im["variant"] == variant and im["view"] == view and im["angle"] == angle and im["sheet"].endswith("channels"):
            p = im["path"]
            if p not in cache: cache[p] = np.asarray(Image.open(p).convert("RGB"))
            x, y, w, h = im["render"]; return cache[p][y:y + h, x:x + w]
    return None
res = []
for subj in ["human-male", "elf-female", "dwarf-male", "ork-female"]:
    race, sex = subj.split("-")
    mk, mr = tile(race, sex, "marked-bare", "marks", "forearm"), tile(race, sex, "reference", "marks", "forearm")
    if mk is None: continue
    hv, rv, al = (tile(race, sex, "marked-bare", v, "forearm") for v in ("height", "roughness", "albedo"))
    d = np.sqrt(((lab(mk) - lab(mr)) ** 2).sum(-1)); mask = d > 6
    lbl, n = ndimage.label(mask, structure=np.ones((3, 3)))
    bg = (np.abs(al.astype(int) - al[2, 2].astype(int)).sum(-1) < 6)
    best = None
    for k in range(1, n + 1):
        m = lbl == k
        if m.sum() < 10: continue
        col = mk[m].mean(0)
        if col.mean() < 160: continue  # ink (dark blue-grey in the marks view)
        if best is None or m.sum() > best.sum(): best = m
    if best is None: res.append({"subject": subj, "found": False}); continue
    m = best
    ring = ndimage.binary_dilation(m, iterations=7) & ~ndimage.binary_dilation(m, iterations=3) & ~mask & ~bg
    h, r, L = hv[..., 0].astype(float), rv[..., 0].astype(float), lab(al)
    dh = h[m] - np.median(h[ring])
    C = lambda v: float(np.hypot(v[..., 1], v[..., 2]).mean())
    res.append({"subject": subj, "found": True, "px": int(m.sum()), "ringPx": int(ring.sum()),
        "dHeight_median": round(float(np.median(dh)), 1), "dHeight_mean": round(float(dh.mean()), 1), "dHeight_absP95": round(float(np.percentile(np.abs(dh), 95)), 1),
        "ringHeight_sd": round(float(h[ring].std()), 1), "dRough_median": round(float(np.median(r[m]) - np.median(r[ring])), 1),
        "albedo_dL": round(float(L[m][:, 0].mean() - L[ring][:, 0].mean()), 1), "albedo_dC": round(C(L[m]) - C(L[ring]), 1)})
print(json.dumps(res, indent=1))
json.dump(res, open(f"artifacts/wave-tex/verify-domain/closing/lac-relief-{run}.json", "w"), indent=1)
