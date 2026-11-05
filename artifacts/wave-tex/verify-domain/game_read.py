# QD (wave TEX closing): game-distance read of C's close-up marks (r06f-final, marked-bare final view, studio light).
#   uv run --with pillow --with numpy --with scipy python artifacts/wave-tex/verify-domain/game_read.py <run>
# Each close-up tile (face/forearm/back-closeup) is box-downsampled from its own mm/px to the player's 6.4 mm/px (fov 50,
# 5.5 m, 800 px) and the opponent's 9.3 mm/px (~8 m); marked vs reference (same subject, same camera) is compared on the
# downsampled grid. The reference subject is CLOTHED (marked-bare is not), so the mark footprint comes from the 'marks' channel
# view (marked-bare vs reference marks view, dE > 6, as marks_meter.py) and each coarse px with mark coverage >= 0.25 is compared
# with the median of the coarse skin ring around it (coverage 0, 1-3 coarse px away, not background): px_dE10 = coarse px >= 10.
import json, sys, numpy as np
from PIL import Image
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
def tile(race, sex, variant, angle, view="final"):
    for im in idx["images"]:
        if (im["race"], im["sex"], im["variant"], im["view"], im["angle"], im["light"]) == (race, sex, variant, view, angle, "studio") and im["sheet"].endswith("channels"):
            if im["path"] not in cache: cache[im["path"]] = np.asarray(Image.open(im["path"]).convert("RGB"))
            x, y, w, h = im["render"]; c = im["camera"]
            return cache[im["path"]][y:y + h, x:x + w].astype(np.float64), 2 * c["distanceM"] * np.tan(np.radians(c["fovDeg"] / 2)) * 1000 / h
    return None, None
def down(a, k):
    # box filter in LINEAR light by an integer-ish factor (area resample)
    lin = np.where(a / 255 <= 0.04045, a / 255 / 12.92, ((a / 255 + 0.055) / 1.055) ** 2.4)
    H, W = lin.shape[:2]; h, w = max(1, int(H / k)), max(1, int(W / k))
    im = np.stack([np.asarray(Image.fromarray((lin[..., i] * 65535).astype(np.uint16).astype(np.int32)).resize((w, h), Image.BOX)) for i in range(3)], -1) / 65535
    srgb = np.where(im <= 0.0031308, 12.92 * im, 1.055 * im ** (1 / 2.4) - 0.055) * 255
    return srgb
from scipy import ndimage
rows = []
BG = np.array([112, 114, 118])
for s in ["human-male", "human-female", "elf-male", "elf-female", "dwarf-male", "dwarf-female", "ork-male", "ork-female"]:
    race, sex = s.split("-")
    for angle in ("face", "forearm", "back-closeup"):
        a, mm = tile(race, sex, "marked-bare", angle)
        mk, _ = tile(race, sex, "marked-bare", angle, "marks"); mr, _ = tile(race, sex, "reference", angle, "marks")
        if a is None or mk is None: continue
        mask = (np.sqrt(((lab(mk) - lab(mr)) ** 2).sum(-1)) > 6).astype(np.float64)
        bg = (np.abs(a - BG).sum(-1) < 8).astype(np.float64)
        row = {"subject": s, "angle": angle, "mmPerPx": round(mm, 2), "maskPxFull": int(mask.sum())}
        for name, target in (("player6.4", 6.4), ("opponent9.3", 9.3)):
            k = target / mm
            L = lab(down(a, k))
            h, w = L.shape[:2]
            cov = np.asarray(Image.fromarray((mask * 65535).astype(np.int32)).resize((w, h), Image.BOX)) / 65535
            bgc = np.asarray(Image.fromarray((bg * 65535).astype(np.int32)).resize((w, h), Image.BOX)) / 65535
            m = cov >= 0.25
            ring = ndimage.binary_dilation(m, iterations=3) & ~ndimage.binary_dilation(cov > 0, iterations=1) & (bgc < 0.05)
            if m.sum() == 0 or ring.sum() < 3:
                row[name] = {"px": int(m.sum()), "px_dE10": 0, "medianDE": None}; continue
            d = np.sqrt(((L[m] - np.median(L[ring], 0)) ** 2).sum(-1))
            row[name] = {"px": int(m.sum()), "px_dE10": int((d >= 10).sum()), "medianDE": round(float(np.median(d)), 1), "maxDE": round(float(d.max()), 1)}
        rows.append(row)
json.dump(rows, open(f"artifacts/wave-tex/verify-domain/{run}/game-read.json", "w"), indent=1)
for r in rows: print(r["subject"], r["angle"], r["mmPerPx"], r["maskPxFull"], "player", r["player6.4"], "opp", r["opponent9.3"])
