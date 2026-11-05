# Ork laceration crop (x92-140 y160-226, 6x) closing vs parent, final view, both orders.
exec(open('ink_parent.py').read().split("out = {")[0])
c=lambda r: Image.fromarray(tile(r,'ork-female-marked-bare','forearm','final')[160:226,92:140].astype(np.uint8)).resize((48*6,66*6),Image.NEAREST)
for a,b,n in [('r08q-parent','r07q-closing','scar-parent-closing'),('r07q-closing','r08q-parent','scar-closing-parent')]:
  W=Image.new('RGB',(48*12+20,66*6),(255,255,255)); W.paste(c(a),(0,0)); W.paste(c(b),(48*6+20,0)); W.save(D+n+'.png')
