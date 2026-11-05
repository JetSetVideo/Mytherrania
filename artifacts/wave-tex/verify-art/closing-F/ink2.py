import numpy as np
from PIL import Image
from scipy import ndimage
Q='/Users/macmax/.hermes/cache/scratch/QA/'
def lab(rgb):
    c=rgb/255.0; c=np.where(c<=0.04045,c/12.92,((c+0.055)/1.055)**2.4)
    M=np.array([[0.4124,0.3576,0.1805],[0.2126,0.7152,0.0722],[0.0193,0.1192,0.9505]])
    xyz=c@M.T/np.array([0.95047,1,1.08883]); f=np.where(xyz>0.008856,np.cbrt(xyz),7.787*xyz+16/116)
    return np.stack([116*f[...,1]-16,500*(f[...,0]-f[...,1]),200*(f[...,1]-f[...,2])],-1)
ld=lambda t,s,k: np.asarray(Image.open(f'{Q}{t}/ink-{s}-{k}.png').convert('RGB')).astype(float)
for s in ['human-male','ork-female','elf-female','dwarf-male']:
  mkA=ld('after',s,'marks'); mkB=ld('before',s,'marks')
  def inkmask(mk):
    L=lab(mk); m=(np.abs(mk-209).sum(-1)>18)&(L[...,0]<60)&(np.abs(mk-mk[2,2]).sum(-1)>6)
    m=ndimage.binary_erosion(m,iterations=1); return m
  for t,mk in [('before',mkB),('after',mkA)]:
    ink=inkmask(mk); ring=ndimage.binary_dilation(ink,iterations=7)&~ndimage.binary_dilation(ink,iterations=3)&(np.abs(mk-209).sum(-1)<6)
    out=[]
    for k in ['aOn','aNoEdge','fOn','fNoEdge']:
      L=lab(ld(t,s,k))[...,0]; out.append('%s ink %.1f ring %.1f d %.1f'%(k,L[ink].mean(),L[ring].mean(),L[ink].mean()-L[ring].mean()))
    print(s,t,'inkPx',ink.sum(),' | '.join(out))
  ink=inkmask(mkA)&inkmask(mkB)
  dA=lab(ld('after',s,'aOn'))[...,0]-lab(ld('before',s,'aOn'))[...,0]
  dE=lab(ld('after',s,'aOn'))[...,0]-lab(ld('after',s,'aNoEdge'))[...,0]
  print('   after-before albedo on ink: mean %.2f share>5 %.3f ; crest on-off on ink: mean %.2f share>5 %.3f'%(dA[ink].mean(),(np.abs(dA[ink])>5).mean(),dE[ink].mean(),(np.abs(dE[ink])>5).mean()))
