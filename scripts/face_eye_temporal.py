"""Three-frame median of corrective eye placement, with current-frame blink gates."""
import copy
import numpy as np

def temporal_source(source,target,records,index,mode):
 if source is None or target is None:return source,{'method':'retained-ambiguous-current'}
 result=copy.deepcopy(source);proof=[]
 for side in range(2):
  current=records[index].get('modes',{}).get(mode,{})
  eye=next((e for e in current.get('eyes',[])if e['side']==side),None)
  if eye is None:
   proof.append({'side':side,'method':'retained-unavailable-observation'});continue
  assert np.allclose(eye['sourceUV'],source[side]['uv'],atol=1e-5)
  assert np.allclose(eye['targetUV'],target[side]['uv'],atol=1e-5)
  center=np.asarray(eye['sourceUV'],np.float32)-np.asarray(eye['targetUV'],np.float32)
  window=[]
  if 0<index<len(records)-1:
   for n in [index-1,index,index+1]:
    row=records[n];candidate=next((e for e in row.get('modes',{}).get(mode,{}).get('eyes',[])if e['side']==side),None)
    if row['action']!='source-eye-plane-flow'or candidate is None or candidate['sourceOpenGate']<.75:break
    difference=np.asarray(candidate['sourceUV'],np.float32)-np.asarray(candidate['targetUV'],np.float32)
    assert np.isfinite(difference).all();window.append(difference)
  error=np.median(np.asarray(window),axis=0)if len(window)==3 else center
  result[side]['uv']=target[side]['uv']+error
  proof.append({'side':side,'method':'median-of-three-corrective-residuals'if len(window)==3 else 'current-visible-residual',
   'window':list(range(index-1,index+2))if len(window)==3 else [index],
   'rawDifferenceUV':center.tolist(),'usedDifferenceUV':error.tolist()})
 return result,{'method':'private-temporal-residual-v3','eyes':proof,'currentFrameBlinkGatesUnchanged':True}
