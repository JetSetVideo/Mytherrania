# Laceration (400 d) scar vs skin ring at several ring widths, forearm albedo + final, three runs (QD part mask: marks view vs reference dE>6).
exec(open('ink_parent2.py').read().split("out = {")[0])
for s,bb in [('human-male',(169,192,181,241)),('ork-female',(107,174,120,211)),('elf-female',(179,201,184,236)),('dwarf-male',(112,189,134,221))]:
  for run in RUNS:
    mk=tile(run,s+'-marked-bare','forearm','marks'); rf=tile(run,s+'-reference','forearm','marks')
    al=lab(tile(run,s+'-marked-bare','forearm','albedo'))[...,0]; fi=lab(tile(run,s+'-marked-bare','forearm','final'))[...,0]
    diff=np.linalg.norm(lab(mk)-lab(rf),axis=-1)>6
    x0,y0,x1,y1=bb; box=np.zeros_like(diff); box[y0-2:y1+3,x0-2:x1+3]=True
    m=diff&box; anym=diff
    row=[]
    for a,b in [(1,4),(3,7),(5,10),(8,14)]:
      ring=ndimage.binary_dilation(m,iterations=b)&~ndimage.binary_dilation(m,iterations=a)&~anym&(np.abs(mk-209).sum(-1)<6)
      row.append(f"ring{a}-{b} alb {al[m].mean()-al[ring].mean():+5.1f} fin {fi[m].mean()-fi[ring].mean():+5.1f}")
    print(f"{s:11s} {run:14s} px {m.sum():3d} scar albL {al[m].mean():.1f} | "+" | ".join(row))
