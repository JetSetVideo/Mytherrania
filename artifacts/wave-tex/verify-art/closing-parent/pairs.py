# Unlabelled A|B pairs (and swapped) for the vision control: ork forearm albedo + final, x95-225 y150-290, 3x nearest.
exec(open('ink_parent.py').read().split("out = {")[0])
def crop(run, view):
    t = tile(run, 'ork-female-marked-bare', 'forearm', view)[150:290, 95:225].astype(np.uint8)
    return Image.fromarray(t).resize((130 * 3, 140 * 3), Image.NEAREST)
def pair(a, b, path):
    W = Image.new('RGB', (130 * 6 + 20, 140 * 3), (255, 255, 255)); W.paste(a, (0, 0)); W.paste(b, (130 * 3 + 20, 0)); W.save(path)
for view in ['albedo', 'final']:
    for other in ['r07q-closing', 'r07q-before-F']:
        p, o = crop('r08q-parent', view), crop(other, view)
        tag = other.split('-')[-1]
        pair(p, o, f'{D}pair-{view}-parent-{tag}.png'); pair(o, p, f'{D}pair-{view}-{tag}-parent.png')
print('ok')
