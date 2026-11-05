# QD (wave TEX closing): readability of the facial dotwork + face incision on C's face close-up (r06f-final, 0.68-0.95 mm/px).
#   uv run --with pillow --with numpy --with scipy python artifacts/wave-tex/verify-domain/dot_read.py <run>
# Components from face_hits' mask (marks view vs reference, dE > 6); the dotwork = the component on the faceR cheek (x < mouth x),
# the incision = the component on faceL (x > mouth x). Per pixel: dE76 of the marked FINAL view vs (a) the SAME pixel of the
# reference final view, (b) the median of a 3-8 px skin ring. Target (QD Z-84): >= 60 % of the stroke px at dE >= 10.
import json, sys, numpy as np
from PIL import Image
from scipy import ndimage
run = sys.argv[1]
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
def tile(race, sex, variant, view, light="studio"):
    for im in idx["images"]:
        if (im["race"], im["sex"], im["variant"], im["view"], im["angle"], im["light"]) == (race, sex, variant, view, "face", light) and im["sheet"].endswith("channels"):
            if im["path"] not in cache: cache[im["path"]] = np.asarray(Image.open(im["path"]).convert("RGB"))
            x, y, w, h = im["render"]; return cache[im["path"]][y:y + h, x:x + w]
rows = []
for subj, f in fp.items():
    race, sex = subj.split("-")
    mouthX = [z for z in f["zones"] if z["name"] == "mouth"][0]["centre"][0]
    for variant in ("marked-bare", "marked"):
        mk, mr = tile(race, sex, variant, "marks"), tile(race, sex, "reference", "marks")
        fi, fr, al = lab(tile(race, sex, variant, "final")), lab(tile(race, sex, "reference", "final")), lab(tile(race, sex, variant, "albedo"))
        alr = lab(tile(race, sex, "reference", "albedo"))
        mask = np.sqrt(((lab(mk) - lab(mr)) ** 2).sum(-1)) > 6
        lbl, n = ndimage.label(mask, structure=np.ones((3, 3)))
        for name, side in (("dotwork", -1), ("incision", 1)):
            sel = np.zeros_like(mask)
            for k in range(1, n + 1):
                m = lbl == k
                if m.sum() >= 6 and np.sign(np.where(m)[1].mean() - mouthX) == side: sel |= m
            if sel.sum() == 0: rows.append({"subject": subj, "variant": variant, "mark": name, "px": 0}); continue
            ring = ndimage.binary_dilation(sel, iterations=8) & ~ndimage.binary_dilation(sel, iterations=3) & ~mask
            dSame = np.sqrt(((fi - fr) ** 2).sum(-1))[sel]
            dRing = np.sqrt(((fi - np.median(fi[ring], 0)) ** 2).sum(-1))[sel]
            dAl = al[sel].mean(0) - np.median(al[ring], 0)
            dAlRef = alr[sel].mean(0) - alr[ring].mean(0)  # the same pixels on the unmarked body (local skin variation)
            C = lambda v: float(np.hypot(v[1], v[2]))
            rows.append({"subject": subj, "variant": variant, "mark": name, "px": int(sel.sum()), "mmPerPx": f["mmPerPx"],
                         "vsSame_median": round(float(np.median(dSame)), 1), "vsSame_ge10": round(float((dSame >= 10).mean()), 3),
                         "vsRing_median": round(float(np.median(dRing)), 1), "vsRing_ge10": round(float((dRing >= 10).mean()), 3),
                         "albedo_dLab": [round(float(v), 1) for v in dAl], "albedo_dC": round(C(al[sel].mean(0)) - C(np.median(al[ring], 0)), 1),
                         "refAlbedo_dL_samePx": round(float(dAlRef[0]), 1)})
json.dump(rows, open(f"artifacts/wave-tex/verify-domain/{run}/face-read.json", "w"), indent=1)
for r in rows: print(r)
