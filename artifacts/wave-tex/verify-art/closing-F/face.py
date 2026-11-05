import numpy as np
exec(open('ink.py').read().split("for subj in")[0])
import json
idx=json.load(open(C+'r07q-closing/index.json'))
def t(run,s): 
    for im in idx['images']:
        if im['id']==f'{s}/angles/face/studio/final':
            x,y,w,h=im['render']; from PIL import Image; a=np.asarray(Image.open(C+run+'/'+im['path'].split('/')[-1]).convert('RGB')).astype(float); return a[y:y+h,x:x+w]
for s in ['elf-female-marked-bare','human-male-reference','elf-female-reference']:
    d=lab(t('r07q-closing',s))[...,0]-lab(t('r07q-before-F',s))[...,0]; ch=np.abs(d)>2
    ys,xs=np.where(ch); print(s,'changed',ch.mean().round(4),'darker share %.2f lighter %.2f'%((d<-2).sum()/max(1,ch.sum()),(d>2).sum()/max(1,ch.sum())),'mean dL on changed %.1f'%d[ch].mean(),'rows y %d-%d'%(ys.min(),ys.max()))
