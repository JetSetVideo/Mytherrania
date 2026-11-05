import numpy as np
from PIL import Image
exec(open('ink.py').read().split("for subj in")[0])
def pair(subj,row,view,box,name,scale=2,swap=False):
    t=[tile(r,subj,row,view) for r in (['r07q-closing','r07q-before-F'] if swap else ['r07q-before-F','r07q-closing'])]
    x0,y0,x1,y1=box; ims=[Image.fromarray(a[y0:y1,x0:x1].astype(np.uint8)).resize(((x1-x0)*scale,(y1-y0)*scale),Image.NEAREST) for a in t]
    w,h=ims[0].size; S=Image.new('RGB',(w*2+12,h),(255,255,255)); S.paste(ims[0],(0,0)); S.paste(ims[1],(w+12,0)); S.save(name)
    d=lab(t[1][y0:y1,x0:x1])[...,0]-lab(t[0][y0:y1,x0:x1])[...,0]; print(name,'dL mean %.2f p1 %.1f p99 %.1f'%(d.mean(),np.percentile(d,1),np.percentile(d,99)))
pair('ork-female-reference','forearm','albedo',(0,0,280,420),'ork-ref-fa-albedo.png')
pair('elf-female-reference','face','final',(60,240,360,560),'elf-face-final.png') if False else None
pair('human-male-reference','front-left-3q','final',(120,30,320,530),'hm-3q-final.png')
pair('human-male-reference','front-left-3q','final',(120,30,320,530),'hm-3q-final-swap.png',swap=True)
pair('ork-female-marked-bare','forearm','albedo',(0,0,280,420),'ork-mb-fa-albedo.png')
pair('ork-female-marked-bare','forearm','albedo',(0,0,280,420),'ork-mb-fa-albedo-swap.png',swap=True)
pair('human-male-marked-bare','forearm','albedo',(0,0,280,420),'hm-mb-fa-albedo.png')
