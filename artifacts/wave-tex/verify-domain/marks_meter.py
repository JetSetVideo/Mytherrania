# QD per-mark colour meter on a capture run (wave TEX).
#   uv run --with pillow --with numpy --with scipy python artifacts/wave-tex/verify-domain/marks_meter.py <run> <subject> [variant]
# For the close-up angles (face, forearm, back-closeup) of <subject>-<variant>-channels.png (default variant marked-bare):
#   mask  = pixels where the 'marks' channel view differs from the same tile of <subject>-reference-channels.png (dE > 6)
#   parts = 8-connected components of the mask (>= 6 px)
#   per part: size, bbox, mean CIELAB of the ALBEDO view (unlit; light-independent) inside the part vs a ring 3..7 px
#   around it (the skin next to the mark), and the same on the FINAL view (lit).
# Medicine: a mature scar must be PALER (dL* > 0) and less chromatic than its ring; a fresh (<= 60 d) one redder (da* > 0 on
# a non-green skin, or a* rising toward neutral/red on green skin); ink must be darker (dL* < 0) than the ring.
import json, sys, os
import numpy as np
from PIL import Image
from scipy import ndimage

run, subject = sys.argv[1], sys.argv[2]
variant = sys.argv[3] if len(sys.argv) > 3 else "marked-bare"
ROOT = "artifacts/wave-tex/verify-domain"
idx = json.load(open(f"artifacts/wave-tex/captures/{run}/index.json"))
race, sex = subject.split("-")

def lab(rgb):
    c = rgb.astype(np.float64) / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = (lin @ M.T) / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)

cache = {}
def tile(variant, view, angle):
    for im in idx["images"]:
        if im["race"] == race and im["sex"] == sex and im["variant"] == variant and im["view"] == view and im["angle"] == angle and im["sheet"].endswith("channels"):
            p = im["path"]
            if p not in cache:
                cache[p] = np.asarray(Image.open(p).convert("RGB"))
            x, y, w, h = im["render"]
            return cache[p][y:y + h, x:x + w], im
    return None, None

out = {"run": run, "subject": subject, "variant": variant, "angles": {}}
os.makedirs(f"{ROOT}/{run}", exist_ok=True)
for angle in ("face", "forearm", "back-closeup"):
    mk, im = tile(variant, "marks", angle)
    mr, _ = tile("reference", "marks", angle)
    al, _ = tile(variant, "albedo", angle)
    fi, _ = tile(variant, "final", angle)
    if mk is None or mr is None or al is None:
        continue
    d = np.sqrt(((lab(mk) - lab(mr)) ** 2).sum(-1))
    mask = d > 6
    lbl, n = ndimage.label(mask, structure=np.ones((3, 3)))
    Lal, Lfi = lab(al), lab(fi)
    bg = (np.abs(al.astype(int) - al[2, 2].astype(int)).sum(-1) < 6)  # background colour (corner)
    parts = []
    for k in range(1, n + 1):
        m = lbl == k
        if m.sum() < 6:
            continue
        ring = ndimage.binary_dilation(m, iterations=7) & ~ndimage.binary_dilation(m, iterations=3) & ~mask & ~bg
        if ring.sum() < 6:
            continue
        ys, xs = np.where(m)
        a_in, a_ring = Lal[m].mean(0), Lal[ring].mean(0)
        f_in, f_ring = Lfi[m].mean(0), Lfi[ring].mean(0)
        C = lambda v: float(np.hypot(v[1], v[2]))
        parts.append({"px": int(m.sum()), "bbox": [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())],
                      "albedo_dL": round(float(a_in[0] - a_ring[0]), 1), "albedo_da": round(float(a_in[1] - a_ring[1]), 1),
                      "albedo_db": round(float(a_in[2] - a_ring[2]), 1), "albedo_dC": round(C(a_in) - C(a_ring), 1),
                      "final_dL": round(float(f_in[0] - f_ring[0]), 1), "final_dE": round(float(np.linalg.norm(f_in - f_ring)), 1),
                      "markColour": [int(v) for v in mk[m].mean(0)]})
    parts.sort(key=lambda p: -p["px"])
    out["angles"][angle] = {"maskPx": int(mask.sum()), "mmPerPx": round(2 * im["camera"]["distanceM"] * np.tan(np.radians(im["camera"]["fovDeg"] / 2)) * 1000 / im["render"][3], 2), "parts": parts}
    # overlay for vision: mask outlined in magenta on the final view, 2x
    ov = fi.copy()
    edge = ndimage.binary_dilation(mask, iterations=2) & ~mask
    ov[edge] = [255, 0, 255]
    Image.fromarray(fi).resize((fi.shape[1] * 2, fi.shape[0] * 2), Image.NEAREST).save(f"{ROOT}/{run}/{subject}-{variant}-{angle}-final2x.png")
    Image.fromarray(ov).resize((fi.shape[1] * 2, fi.shape[0] * 2), Image.NEAREST).save(f"{ROOT}/{run}/{subject}-{variant}-{angle}-outlined2x.png")
p = f"{ROOT}/marks-meter.json"
allm = json.load(open(p)) if os.path.exists(p) else []
allm = [x for x in allm if not (x["run"] == run and x["subject"] == subject and x["variant"] == variant)] + [out]
json.dump(allm, open(p, "w"), indent=1)
print(json.dumps(out, indent=1))
