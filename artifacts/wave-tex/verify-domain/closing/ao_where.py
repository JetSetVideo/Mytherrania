# QD closing: WHERE the ao view is dark. Grey body px of the ao view; dark = < 225. Per dark component: size, centroid as
# body-height fraction (0 = top of the figure) and x relative to the body's centre line, plus how enclosed it is:
# share of a 15-px disc around the centroid that is body (a recess has body on most sides; open convex skin sits near the
# silhouette with background around). Also the final-view luma inside vs a ring (does AO show as a contact darkening?).
import json, sys
import numpy as np
from PIL import Image
from scipy import ndimage
run = sys.argv[1]
idx = json.load(open(f"artifacts/wave-tex/captures/{run}/index.json"))
cache = {}
def tile(race, sex, variant, view, angle):
    for im in idx["images"]:
        if im["race"] == race and im["sex"] == sex and im["variant"] == variant and im["view"] == view and im["angle"] == angle and im["sheet"].endswith("channels"):
            p = im["path"]
            if p not in cache: cache[p] = np.asarray(Image.open(p).convert("RGB"))
            x, y, w, h = im["render"]; return cache[p][y:y + h, x:x + w].astype(int)
angles = sorted({im["angle"] for im in idx["images"] if im["view"] == "ao"})
out = []
for subj in ["human-male", "elf-female", "dwarf-male", "ork-female"]:
    race, sex = subj.split("-")
    for variant in ("marked-bare",):
        for ang in angles:
            ao = tile(race, sex, variant, "ao", ang); fi = tile(race, sex, variant, "final", ang)
            if ao is None: continue
            bgc = ao[2, 2]; body = np.abs(ao - bgc).sum(-1) > 6
            grey = body & (ao.max(-1) - ao.min(-1) <= 3)
            # ink hull (23,33,40) is not grey; fine
            dark = grey & (ao[..., 0] < 225)
            lbl, n = ndimage.label(dark, structure=np.ones((3, 3)))
            ys, xs = np.where(body); top, bot = ys.min(), ys.max(); cx = np.median(xs)
            comps = []
            yy, xx = np.mgrid[-15:16, -15:16]; disc = (yy ** 2 + xx ** 2) <= 225
            for k in range(1, n + 1):
                m = lbl == k
                if m.sum() < 15: continue
                cy, cxx = [int(v) for v in ndimage.center_of_mass(m)]
                pad = np.pad(body, 15)
                enc = float(pad[cy:cy + 31, cxx:cxx + 31][disc].mean())
                lum = fi.mean(-1)
                ring = ndimage.binary_dilation(m, iterations=6) & ~ndimage.binary_dilation(m, iterations=2) & grey & ~dark
                comps.append({"px": int(m.sum()), "yFrac": round((cy - top) / (bot - top), 2), "dx": int(cxx - cx), "enclosed": round(enc, 2),
                              "aoMin": int(ao[..., 0][m].min()), "finalLumaInMinusRing": round(float(lum[m].mean() - lum[ring].mean()), 1) if ring.sum() > 5 else None})
            comps.sort(key=lambda c: -c["px"])
            out.append({"subject": subj, "angle": ang, "greyPx": int(grey.sum()), "darkShare": round(float(dark.sum() / max(1, grey.sum())), 4), "comps": comps[:8]})
json.dump(out, open(f"artifacts/wave-tex/verify-domain/closing/ao-where-{run}.json", "w"), indent=1)
for o in out:
    print(o["subject"], o["angle"], "dark<225", o["darkShare"], [(c["px"], c["yFrac"], c["dx"], c["enclosed"], c["aoMin"], c["finalLumaInMinusRing"]) for c in o["comps"][:6]])
