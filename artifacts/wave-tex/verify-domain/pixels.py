# QD pixel meter for wave-TEX capture runs.
#   uv run --with pillow --with numpy python artifacts/wave-tex/verify-domain/pixels.py <run> [--ref <run>]
# For every subject with a "marked" and a "reference" variant in the same run, on the close-up tiles (face,
# forearm, back-closeup) and the full-body angles, it measures:
#   changed  share of render pixels whose CIE76 dE between marked and reference > 3 (the marks' footprint on screen)
#   dE95     95th percentile dE inside the changed mask (how strong the marks read)
#   meanL    mean L* shift inside the mask (scars pale +, tattoos dark -)
#   hue      mean a*, b* shift inside the mask (fresh scars red +a*, woad ink -b*)
# and writes per-tile crops (render only, no HUD) into artifacts/wave-tex/verify-domain/<run>/ for vision.
# Rows are appended to artifacts/wave-tex/verify-domain/pixels.json (replacing the rows of the same run).
import json, sys, os
import numpy as np
from PIL import Image

ROOT = "artifacts/wave-tex/verify-domain"
run = sys.argv[1]
cap = f"artifacts/wave-tex/captures/{run}"
idx = json.load(open(f"{cap}/index.json"))
out = f"{ROOT}/{run}"
os.makedirs(out, exist_ok=True)

def lab(rgb):
    c = rgb.astype(np.float64) / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = lin @ M.T
    xyz /= np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)

sheets = {}
def sheet(path):
    if path not in sheets:
        sheets[path] = np.asarray(Image.open(path).convert("RGB"))
    return sheets[path]

def crop(im, r):
    x, y, w, h = r
    return im[y:y + h, x:x + w]

by = {}
for im in idx["images"]:
    by[(im["race"], im["sex"], im["variant"], im["light"], im["angle"], im["view"])] = im

rows = []
for key, im in by.items():
    race, sex, variant, light, angle, view = key
    if variant != "marked" or view != "final":
        continue
    ref = by.get((race, sex, "reference", light, angle, view))
    if not ref:
        continue
    a = crop(sheet(im["path"]), im["render"]); b = crop(sheet(ref["path"]), ref["render"])
    if a.shape != b.shape:
        continue
    La, Lb = lab(a), lab(b)
    dE = np.sqrt(((La - Lb) ** 2).sum(-1))
    mask = dE > 3
    n = int(mask.sum())
    row = {"run": run, "subject": f"{race}-{sex}", "light": light, "angle": angle, "changedPct": round(100 * n / mask.size, 3),
           "dE95": round(float(np.percentile(dE[mask], 95)), 2) if n else 0.0,
           "dL": round(float((La[..., 0] - Lb[..., 0])[mask].mean()), 2) if n else 0.0,
           "da": round(float((La[..., 1] - Lb[..., 1])[mask].mean()), 2) if n else 0.0,
           "db": round(float((La[..., 2] - Lb[..., 2])[mask].mean()), 2) if n else 0.0}
    rows.append(row)
    if angle in ("face", "forearm", "back-closeup", "front", "back") and light == "studio":
        Image.fromarray(a).save(f"{out}/{race}-{sex}-{angle}-marked.png")
        Image.fromarray(b).save(f"{out}/{race}-{sex}-{angle}-reference.png")
        vis = np.clip(dE * 8, 0, 255).astype(np.uint8)
        Image.fromarray(vis).save(f"{out}/{race}-{sex}-{angle}-dE.png")

p = f"{ROOT}/pixels.json"
data = json.load(open(p)) if os.path.exists(p) else {"rows": []}
data["rows"] = [r for r in data.get("rows", []) if r.get("run") != run]
for r in rows:
    data["rows"].append({"sheet": f"{run}/{r['subject']}", "crop": f"{r['angle']}/{r['light']}", "metric": "marked vs reference: changed % / dE95 / dL* / da* / db*",
                         "value": f"{r['changedPct']} / {r['dE95']} / {r['dL']} / {r['da']} / {r['db']}", "run": run})
json.dump(data, open(p, "w"), indent=1)
for r in sorted(rows, key=lambda r: (r["subject"], r["angle"], r["light"])):
    print(r)
