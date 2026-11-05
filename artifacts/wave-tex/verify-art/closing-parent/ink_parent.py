# QA (art) re-check of parent fix Z-154: tattoo ink vs edge highlight, three runs + own GPU on/off probe.
#   uv run --with pillow --with numpy --with scipy python artifacts/wave-tex/verify-art/closing-parent/ink_parent.py
import numpy as np, json
from PIL import Image
from scipy import ndimage
C = '/Users/macmax/Desktop/Mytherrania/artifacts/wave-tex/captures/'
Q = '/Users/macmax/.hermes/cache/scratch/QA/'
D = '/Users/macmax/Desktop/Mytherrania/artifacts/wave-tex/verify-art/closing-parent/'
RUNS = ['r07q-before-F', 'r07q-closing', 'r08q-parent']
SUBJ = ['ork-female', 'human-male', 'elf-female', 'dwarf-male']

def lab(rgb):
    c = rgb / 255.0; c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = c @ M.T / np.array([0.95047, 1, 1.08883]); f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)

def tile(run, subj, row, view):
    idx = json.load(open(C + run + '/index.json'))
    for im in idx['images']:
        if im['id'] == f'{subj}/channels/{row}/studio/{view}':
            x, y, w, h = im['render']; a = np.asarray(Image.open(C + im['path'].split('captures/')[1]).convert('RGB')).astype(float)
            return a[y:y + h, x:x + w]

out = {'capture': {}, 'band': {}, 'probe': {}}
print('### 1. capture ink (same mask law as closing-F/ink.py): albedo/final ink-vs-ring dL')
for s in SUBJ:
    subj = s + '-marked-bare'
    for row in ['forearm', 'front-left-3q']:
        res = {}
        for run in RUNS:
            mk = tile(run, subj, row, 'marks'); al = tile(run, subj, row, 'albedo'); fi = tile(run, subj, row, 'final')
            L = lab(mk); bg = mk[2, 2]
            cand = (np.abs(mk - 209).sum(-1) > 18) & (np.abs(mk - al).sum(-1) > 18) & (np.abs(mk - bg).sum(-1) > 6)
            lb, n = ndimage.label(cand); sizes = ndimage.sum(cand, lb, range(1, n + 1))
            ink = np.isin(lb, [i + 1 for i, sz in enumerate(sizes) if sz >= 20]) & (L[..., 0] < 75)
            ring = ndimage.binary_dilation(ink, iterations=6) & ~ndimage.binary_dilation(ink, iterations=2) & (np.abs(mk - 209).sum(-1) < 6)
            La = lab(al); Lf = lab(fi)
            r = dict(inkPx=int(ink.sum()), albInk=La[ink][:, 0].mean(), albRing=La[ring][:, 0].mean(), finInk=Lf[ink][:, 0].mean(), finRing=Lf[ring][:, 0].mean())
            r['albDL'] = r['albInk'] - r['albRing']; r['finDL'] = r['finInk'] - r['finRing']
            res[run] = (ink, al, r)
            print(f"{s:11s} {row:14s} {run:14s} inkPx {r['inkPx']:5d} albedo ink {r['albInk']:.1f} ring {r['albRing']:.1f} dL {r['albDL']:+.1f} | final dL {r['finDL']:+.1f}")
            out['capture'][f'{s}/{row}/{run}'] = {k: round(float(v), 2) for k, v in r.items()}
        a, b = res['r07q-before-F'], res['r08q-parent']
        both = a[0] & b[0]; d = lab(b[1])[..., 0] - lab(a[1])[..., 0]
        print(f"   r08q vs before-F on common ink px: IoU {both.sum() / max(1, (a[0] | b[0]).sum()):.3f} albedo dL mean {d[both].mean():+.2f} p95 {np.percentile(d[both], 95):.1f} share|dL|>5 {(np.abs(d[both]) > 5).mean():.3f}")

print('\n### 2. ork forearm BAND tattoo component x163-205 y165-199 (Z-147 region), albedo L* and ink-vs-ring dE76')
for run in RUNS:
    mk = tile(run, 'ork-female-marked-bare', 'forearm', 'marks'); al = tile(run, 'ork-female-marked-bare', 'forearm', 'albedo'); fi = tile(run, 'ork-female-marked-bare', 'forearm', 'final')
    L = lab(mk); bg = mk[2, 2]
    cand = (np.abs(mk - 209).sum(-1) > 18) & (np.abs(mk - al).sum(-1) > 18) & (np.abs(mk - bg).sum(-1) > 6) & (L[..., 0] < 75)
    box = np.zeros_like(cand); box[165:200, 163:206] = True
    ink = cand & box
    ring = ndimage.binary_dilation(ink, iterations=6) & ~ndimage.binary_dilation(ink, iterations=2) & (np.abs(mk - 209).sum(-1) < 6) & ~cand
    La, Lf = lab(al), lab(fi)
    dEa = np.linalg.norm(La[ink].mean(0) - La[ring].mean(0)); dEf = np.linalg.norm(Lf[ink].mean(0) - Lf[ring].mean(0))
    r = dict(px=int(ink.sum()), albL=La[ink][:, 0].mean(), ringL=La[ring][:, 0].mean(), albDE=dEa, finL=Lf[ink][:, 0].mean(), finDE=dEf)
    out['band'][run] = {k: round(float(v), 2) for k, v in r.items()}
    print(f"{run:14s} px {r['px']} albedo L* ink {r['albL']:.1f} ring {r['ringL']:.1f} dE {dEa:.1f} | final L* ink {r['finL']:.1f} dE {dEf:.1f}")

print('\n### 3. own GPU on/off probe (aEdge zeroed, same rig+camera, forearm, capture MARKED_SET): before=F snapshot, after=F closing, parent=work tree now')
ld = lambda t, s, k: np.asarray(Image.open(f'{Q}{t}/ink-{s}-{k}.png').convert('RGB')).astype(float)
for s in SUBJ:
    for t in ['before', 'after', 'parent']:
        mk = ld(t, s, 'marks'); aOn = ld(t, s, 'aOn'); aNo = ld(t, s, 'aNoEdge'); fOn = ld(t, s, 'fOn'); fNo = ld(t, s, 'fNoEdge')
        L = lab(mk)[..., 0]
        cand = (np.abs(mk - 209).sum(-1) > 18) & (np.abs(mk - aNo).sum(-1) > 18)
        lb, n = ndimage.label(cand); sz = ndimage.sum(cand, lb, range(1, n + 1))
        keep = [i + 1 for i, z in enumerate(sz) if 20 <= z <= 20000]
        m = np.isin(lb, keep) & (L < 62); m = ndimage.binary_erosion(m)
        ring = ndimage.binary_dilation(m, iterations=7) & ~ndimage.binary_dilation(m, iterations=3) & (np.abs(mk - 209).sum(-1) < 6)
        La, Ln, Lf, Lfn = [lab(x)[..., 0] for x in (aOn, aNo, fOn, fNo)]
        # edge highlight elsewhere: on-minus-off over bare skin (marks view neutral) away from marks
        skin = (np.abs(mk - 209).sum(-1) < 6) & ~ndimage.binary_dilation(m, iterations=8)
        lift = (La - Ln)[skin]
        r = dict(inkPx=int(m.sum()), albInk=La[m].mean(), albRing=La[ring].mean(), contrast=La[m].mean() - La[ring].mean(), contrastOff=Ln[m].mean() - Ln[ring].mean(),
                 finContrast=Lf[m].mean() - Lf[ring].mean(), finContrastOff=Lfn[m].mean() - Lfn[ring].mean(), liftInk=(La - Ln)[m].mean(), liftInkShare5=(np.abs(La - Ln)[m] > 5).mean(),
                 liftRing=(La - Ln)[ring].mean(), skinLiftShare5=(lift > 5).mean(), skinLiftP99=np.percentile(lift, 99), skinLiftMax=lift.max())
        out['probe'][f'{s}/{t}'] = {k: round(float(v), 3) for k, v in r.items()}
        print(f"{s:11s} {t:7s} inkPx {r['inkPx']:4d} albedo contrast {r['contrast']:+.1f} (edge off {r['contrastOff']:+.1f}) final {r['finContrast']:+.1f} (off {r['finContrastOff']:+.1f}) | edge lift on ink {r['liftInk']:+.2f} share>5 {r['liftInkShare5']:.3f} ring {r['liftRing']:+.2f} | edge on bare skin: share>5L {r['skinLiftShare5']:.4f} p99 {r['skinLiftP99']:.1f} max {r['skinLiftMax']:.1f}")
json.dump(out, open(D + 'ink-parent.json', 'w'), indent=1)
