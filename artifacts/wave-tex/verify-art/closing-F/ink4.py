import numpy as np
from PIL import Image
from scipy import ndimage
exec(open('ink2.py').read().split("for s in")[0])
for s in ['human-male','ork-female','elf-female','dwarf-male']:
  for t in ['before','after']:
    mk=ld(t,s,'marks'); aOn=ld(t,s,'aOn'); aNo=ld(t,s,'aNoEdge'); fOn=ld(t,s,'fOn'); fNo=ld(t,s,'fNoEdge')
    L=lab(mk)[...,0]
    cand=(np.abs(mk-209).sum(-1)>18)&(np.abs(mk-aNo).sum(-1)>18)
    lab_,n=ndimage.label(cand); sz=ndimage.sum(cand,lab_,range(1,n+1))
    keep=[i+1 for i,z in enumerate(sz) if 20<=z<=20000]
    m=np.isin(lab_,keep)&(L<62); m=ndimage.binary_erosion(m)
    ring=ndimage.binary_dilation(m,iterations=7)&~ndimage.binary_dilation(m,iterations=3)&(np.abs(mk-209).sum(-1)<6)
    La,Ln,Lf,Lfn=[lab(x)[...,0] for x in (aOn,aNo,fOn,fNo)]
    print(s,t,'inkPx',m.sum(),'albedo ink %.1f ring %.1f contrast %.1f | crest-off contrast %.1f | final contrast %.1f crest-off %.1f | crest lift on ink %.2f (share>5 %.3f) on ring %.2f'%(La[m].mean(),La[ring].mean(),La[m].mean()-La[ring].mean(),Ln[m].mean()-Ln[ring].mean(),Lf[m].mean()-Lf[ring].mean(),Lfn[m].mean()-Lfn[ring].mean(),(La-Ln)[m].mean(),(np.abs(La-Ln)[m]>5).mean(),(La-Ln)[ring].mean()))
