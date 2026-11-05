# Band chroma split + unlabelled A|B pairs (both orders) r09q vs r08q / r07q-before-F: ork forearm albedo + scar crop final.
exec(open('ink_parent2.py').read().split("out = {")[0])
for run in RUNS:
    mk = tile(run, 'ork-female-marked-bare', 'forearm', 'marks'); al = tile(run, 'ork-female-marked-bare', 'forearm', 'albedo')
    L = lab(mk); bg = mk[2, 2]
    cand = (np.abs(mk - 209).sum(-1) > 18) & (np.abs(mk - al).sum(-1) > 18) & (np.abs(mk - bg).sum(-1) > 6) & (L[..., 0] < 75)
    box = np.zeros_like(cand); box[165:200, 163:206] = True; ink = cand & box
    ring = ndimage.binary_dilation(ink, iterations=6) & ~ndimage.binary_dilation(ink, iterations=2) & (np.abs(mk - 209).sum(-1) < 6) & ~cand
    La = lab(al); d = La[ink].mean(0) - La[ring].mean(0)
    print(f"{run:14s} band albedo ink Lab {La[ink].mean(0).round(1)} ring {La[ring].mean(0).round(1)} dL {d[0]:+.1f} da {d[1]:+.1f} db {d[2]:+.1f} dC {np.hypot(*La[ink].mean(0)[1:])-np.hypot(*La[ring].mean(0)[1:]):+.1f} dE {np.linalg.norm(d):.1f}")
def crop(run, view, b):
    y0,y1,x0,x1,s=b; t = tile(run, 'ork-female-marked-bare', 'forearm', view)[y0:y1, x0:x1].astype(np.uint8)
    return Image.fromarray(t).resize(((x1-x0)*s, (y1-y0)*s), Image.NEAREST)
def pair(a, b, path):
    W = Image.new('RGB', (a.width*2 + 20, a.height), (255, 255, 255)); W.paste(a, (0, 0)); W.paste(b, (a.width + 20, 0)); W.save(path)
for name,view,b in [('band','albedo',(150,290,95,225,3)),('scar','final',(160,226,92,140,6))]:
    for other in ['r08q-parent','r07q-before-F']:
        p, o = crop('r09q-parent', view, b), crop(other, view, b); tag=other.split('-')[0]
        pair(p, o, f'{D}{name}-p2-{tag}.png'); pair(o, p, f'{D}{name}-{tag}-p2.png')
