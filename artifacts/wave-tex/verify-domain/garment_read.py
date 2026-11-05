# QD (wave TEX closing): P rounds 4-5 on pictures - studded torso + skin/garment legibility, final capture vs the HEAD baseline
# (same layout + cameras: r00-baseline-head).  uv run --with pillow --with numpy --with scipy python ... garment_read.py <run> <headRun>
# studs: reference back-closeup FINAL, central torso crop (garment pixels only); luma high-pass (minus a 9 px box blur); bright blobs
#   = local maxima >= p97 of the high-pass, >= 0.5*period apart; count per 100 cm^2 and the nearest-neighbour spacing median (mm)
#   vs the specified 70 mm period; also the radial power of the high-pass at the stud period band (0.8-1.25 x period).
# legibility: reference FRONT final: median Lab of the face box (skin) vs the torso centre (garment): dE76 and luma ratio.
import json, sys, numpy as np
from PIL import Image
from scipy import ndimage
run, head = sys.argv[1], sys.argv[2]
def lab(rgb):
    c = rgb.astype(np.float64) / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = (lin @ M.T) / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)
def get(r, race, sex, angle):
    idx = json.load(open(f"artifacts/wave-tex/captures/{r}/index.json"))
    for im in idx["images"]:
        if (im["race"], im["sex"], im["variant"], im["view"], im["angle"], im["light"]) == (race, sex, "reference", "final", angle, "studio") and im["sheet"].endswith("angles"):
            x, y, w, h = im["render"]; c = im["camera"]
            return np.asarray(Image.open(im["path"]).convert("RGB"))[y:y + h, x:x + w], 2 * c["distanceM"] * np.tan(np.radians(c["fovDeg"] / 2)) * 1000 / h, im
    return None, None, None
rows = []
for s in ["human-male", "human-female", "elf-male", "elf-female", "dwarf-male", "dwarf-female", "ork-male", "ork-female"]:
    race, sex = s.split("-"); row = {"subject": s}
    for tag, r in (("final", run), ("head", head)):
        a, mm, im = get(r, race, sex, "back-closeup")
        H, W = a.shape[:2]; cr = a[int(H * 0.45):int(H * 0.75), int(W * 0.3):int(W * 0.7)].astype(np.float64)
        Y = 0.2126 * cr[..., 0] + 0.7152 * cr[..., 1] + 0.0722 * cr[..., 2]
        hp = Y - ndimage.uniform_filter(Y, 9)
        period = 70 / mm
        thr = np.percentile(hp, 97)
        mx = (hp == ndimage.maximum_filter(hp, size=max(3, int(period * 0.5)))) & (hp >= thr)
        ys, xs = np.where(mx)
        nn = []
        for i in range(len(xs)):
            d = np.hypot(xs - xs[i], ys - ys[i]); d[i] = 1e9; nn.append(d.min() * mm)
        F = np.abs(np.fft.fftshift(np.fft.fft2(hp - hp.mean()))) ** 2
        fy, fx = np.mgrid[-cr.shape[0] // 2:cr.shape[0] - cr.shape[0] // 2, -cr.shape[1] // 2:cr.shape[1] - cr.shape[1] // 2]
        rad = np.hypot(fx / cr.shape[1], fy / cr.shape[0])  # cycles per px
        band = (rad > 1 / (1.25 * period)) & (rad < 1 / (0.8 * period))
        areaCm2 = cr.shape[0] * cr.shape[1] * (mm / 10) ** 2
        row[tag] = {"mmPerPx": round(mm, 2), "hpStd": round(float(hp.std()), 2), "blobsPer100cm2": round(len(xs) / areaCm2 * 100, 1),
                    "nnMedianMm": round(float(np.median(nn)), 1) if nn else None, "studBandShare": round(float(F[band].sum() / F.sum()), 4)}
        f, mmf, imf = get(r, race, sex, "front")
        fb = imf["regions"]["face"]; x0, y0, x1, y1 = fb
        face = lab(f[y0:y1, x0:x1].reshape(-1, 3)); bgm = np.abs(f[y0:y1, x0:x1].reshape(-1, 3).astype(int) - [112, 114, 118]).sum(-1) > 10
        sk = np.median(face[bgm], 0)
        Hh, Wf = f.shape[:2]; tor = lab(f[int(Hh * 0.30):int(Hh * 0.42), int(Wf * 0.42):int(Wf * 0.58)].reshape(-1, 3)); gm = np.median(tor, 0)
        Yl = lambda L: ((L + 16) / 116) ** 3
        row[tag]["skinGarment_dE"] = round(float(np.linalg.norm(sk - gm)), 1)
        row[tag]["skinGarment_lumaRatio"] = round(float(max(Yl(sk[0]), Yl(gm[0])) + 0.05) / (min(Yl(sk[0]), Yl(gm[0])) + 0.05), 2)
        if tag == "final":
            Image.fromarray(a[int(H * 0.35):int(H * 0.8), int(W * 0.2):int(W * 0.8)]).save(f"artifacts/wave-tex/verify-domain/{run}/{s}-back-torso-final.png")
        else:
            Image.fromarray(a[int(H * 0.35):int(H * 0.8), int(W * 0.2):int(W * 0.8)]).save(f"artifacts/wave-tex/verify-domain/{run}/{s}-back-torso-head.png")
    rows.append(row)
json.dump(rows, open(f"artifacts/wave-tex/verify-domain/{run}/garment-read.json", "w"), indent=1)
for r in rows: print(r["subject"], "FINAL", r["final"], "\n            HEAD ", r["head"])
