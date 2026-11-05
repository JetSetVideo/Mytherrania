import numpy as np, json, sys
from PIL import Image
from scipy import ndimage
C='/Users/macmax/Desktop/Mytherrania/artifacts/wave-tex/captures/'
def lab(rgb):
    c=rgb/255.0; c=np.where(c<=0.04045,c/12.92,((c+0.055)/1.055)**2.4)
    M=np.array([[0.4124,0.3576,0.1805],[0.2126,0.7152,0.0722],[0.0193,0.1192,0.9505]])
    xyz=c@M.T/np.array([0.95047,1,1.08883]); f=np.where(xyz>0.008856,np.cbrt(xyz),7.787*xyz+16/116)
    return np.stack([116*f[...,1]-16,500*(f[...,0]-f[...,1]),200*(f[...,1]-f[...,2])],-1)
def tile(run,subj,row,view):
    idx=json.load(open(C+run+'/index.json'))
    for im in idx['images']:
        if im['id']==f'{subj}/channels/{row}/studio/{view}':
            x,y,w,h=im['render']; a=np.asarray(Image.open(C+im['path'].split('captures/')[1]).convert('RGB')).astype(float)
            return a[y:y+h,x:x+w]
for subj in ['ork-female-marked-bare','human-male-marked-bare','elf-female-marked-bare','dwarf-male-marked-bare']:
  for row in ['forearm','front-left-3q']:
    print('==',subj,row)
    res={}
    for run in ['r07q-before-F','r07q-closing']:
        mk=tile(run,subj,row,'marks'); al=tile(run,subj,row,'albedo'); fi=tile(run,subj,row,'final')
        L=lab(mk); bg=mk[2,2]
        cand=(np.abs(mk-209).sum(-1)>18)&(np.abs(mk-al).sum(-1)>18)&(np.abs(mk-bg).sum(-1)>6)
        lab_,n=ndimage.label(cand); sizes=ndimage.sum(cand,lab_,range(1,n+1))
        ink=np.isin(lab_,[i+1 for i,sz in enumerate(sizes) if sz>=20])&(L[...,0]<75)
        ring=ndimage.binary_dilation(ink,iterations=6)&~ndimage.binary_dilation(ink,iterations=2)&(np.abs(mk-209).sum(-1)<6)
        La=lab(al); Lf=lab(fi)
        res[run]=(ink,al,fi)
        print(run,'inkPx',ink.sum(),'albedo L ink %.1f ring %.1f dL %.1f | final L ink %.1f ring %.1f dL %.1f | marksview L ink %.1f'%(La[ink][:,0].mean(),La[ring][:,0].mean(),La[ink][:,0].mean()-La[ring][:,0].mean(),Lf[ink][:,0].mean(),Lf[ring][:,0].mean(),Lf[ink][:,0].mean()-Lf[ring][:,0].mean(),L[ink][:,0].mean()))
    a,b=res['r07q-before-F'],res['r07q-closing']
    both=a[0]&b[0]
    d=lab(b[1])[...,0]-lab(a[1])[...,0]
    print(' mask IoU %.3f; albedo L change on common ink px: mean %.2f p5 %.1f p95 %.1f ; share |dL|>5 %.3f'%(both.sum()/max(1,(a[0]|b[0]).sum()),d[both].mean(),np.percentile(d[both],5),np.percentile(d[both],95),(np.abs(d[both])>5).mean()))
