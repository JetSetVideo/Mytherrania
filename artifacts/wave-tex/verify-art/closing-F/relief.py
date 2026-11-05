import numpy as np, json
from PIL import Image
from scipy import ndimage
Q='/Users/macmax/.hermes/cache/scratch/QA/'
ld=lambda t,s,k: np.asarray(Image.open(f'{Q}{t}/{s}-{k}.png').convert('RGB')).astype(float)
def Ls(a):
    c=a/255; c=np.where(c<=0.04045,c/12.92,((c+0.055)/1.055)**2.4); Y=c@[0.2126,0.7152,0.0722]
    return np.where(Y>0.008856,116*np.cbrt(Y)-16,903.3*Y)
out={}
for t in ['before','after']:
  for s in ['human-male','ork-female','elf-female','dwarf-male']:
    for ang in ['forearm','back-closeup']:
      k=f'{s}-{ang}'; g=lambda n: ld(t,k,n)
      mk=g('marks'); skin=ndimage.binary_erosion(g('skin')[...,0]>128,iterations=2)
      mask=(np.abs(mk-209).sum(-1)>18)&skin
      lab_,n=ndimage.label(mask); sz=ndimage.sum(mask,lab_,range(1,n+1)); mask=np.isin(lab_,[i+1 for i,z in enumerate(sz) if z>=6])
      ring=ndimage.binary_dilation(mask,iterations=4)&~mask&skin
      nOn,nOff,nOn2,nNo=g('nOn'),g('nOff'),g('nOn2'),g('nNo')
      dist=np.sqrt(((nOn-nOff)**2).sum(-1)); rep=np.sqrt(((nOn-nOn2)**2).sum(-1))
      dL=np.abs(Ls(g('fOn'))-Ls(g('fOff')))
      hOn,hNo=g('hOn')[...,1],g('hNo')[...,1]
      inside_vs_ring=float(np.linalg.norm(nOn[mask].mean(0)-nOn[ring].mean(0))) if mask.sum() else None
      r=dict(maskPx=int(mask.sum()),
        nDistMean=round(float(dist[mask].mean()),2), nDistP90=round(float(np.percentile(dist[mask],90)),1), share10=round(float((dist[mask]>=10).mean()),3),
        ringDist=round(float(dist[ring].mean()),2), repeatNoise=float(rep.max()), noiseOutsideSkinRing=round(float(dist[~ndimage.binary_dilation(mask,iterations=6)].mean()),3),
        finalAbsDL=round(float(dL[mask].mean()),2), finalShareDL3=round(float((dL[mask]>=3).mean()),3),
        heightDecal=round(float((hOn-hNo)[mask].mean()),2), heightDecalP95=round(float(np.percentile((hOn-hNo)[mask],95)),1), heightDecalMin=float((hOn-hNo)[mask].min()),
        heightInMinusRing=round(float(hOn[mask].mean()-hOn[ring].mean()),2), meanInsideVsRing=round(inside_vs_ring,2))
      out[f'{t} {k}']=r; print(t,k,json.dumps(r))
json.dump(out,open(Q+'relief.json','w'),indent=1)
