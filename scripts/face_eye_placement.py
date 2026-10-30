"""Source-image iris placement; a fixed-border, integrated eye warp."""
from pathlib import Path
import hashlib
import cv2
import numpy as np

MODEL_SHA256='64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff'
EYES=[(468,[33,133],[469,470,471,472],[33,7,163,144,145,153,154,155,133,173,157,158,159,160,161,246]),
 (473,[362,263],[474,475,476,477],[263,249,390,373,374,380,381,382,362,398,384,385,386,387,388,466])]
YY,XX=np.mgrid[:512,:512].astype(np.float32)

def smooth(x):
 x=np.clip(x,0,1);return x*x*(3-2*x)

class EyePlaneObserver:
 def __init__(self,model):
  import mediapipe as mp
  self.mp=mp
  assert hashlib.sha256(Path(model).read_bytes()).hexdigest()==MODEL_SHA256
  self.model=mp.tasks.vision.FaceLandmarker.create_from_options(mp.tasks.vision.FaceLandmarkerOptions(
   base_options=mp.tasks.BaseOptions(model_asset_path=str(model),delegate=mp.tasks.BaseOptions.Delegate.CPU),
   running_mode=mp.tasks.vision.RunningMode.IMAGE,num_faces=2))
 def close(self):self.model.close()
 def __call__(self,image):
  assert image.shape==(512,512,3)and image.dtype==np.uint8
  value=self.model.detect(self.mp.Image(image_format=self.mp.ImageFormat.SRGB,data=np.ascontiguousarray(image[:,:,::-1])))
  if len(value.face_landmarks)!=1:return None
  points=np.asarray([[p.x*512,p.y*512]for p in value.face_landmarks[0]],np.float32)
  assert points.shape==(478,2)and np.isfinite(points).all()
  output=[]
  for center,corners,ring,contour in EYES:
   a,b=sorted(points[corners],key=lambda p:float(p[0]));width=float(np.linalg.norm(b-a))
   if width<8:return None
   horizontal=(b-a)/width;vertical=np.array([-horizontal[1],horizontal[0]],np.float32);p=points[center]
   output.append({'a':a,'b':b,'h':horizontal,'v':vertical,'width':width,'pupil':p,
    'uv':np.array([(p-a)@horizontal/width,(p-(a+b)/2)@vertical/width],np.float32),
    'radius':float(np.linalg.norm(points[ring]-p,axis=1).mean()),'contour':points[contour]})
  return sorted(output,key=lambda eye:float(eye['pupil'][0]))

def retarget(image,source,target,gates,strength=.65):
 """Read source coordinates only; sample RGB only from the current character."""
 assert image.shape==(512,512,3)and image.dtype==np.uint8
 assert len(gates)==2 and all(np.isfinite(g)and 0<=g<=1 for g in gates)
 assert 0<=strength<=1
 if source is None or target is None:return image.copy(),np.zeros((512,512),np.float32),{'state':'skipped','reason':'ambiguous-landmarks'}
 map_x,map_y=XX.copy(),YY.copy();permission=np.zeros((512,512),np.float32);rows=[]
 for side,(src,dst,gate)in enumerate(zip(source,target,gates)):
  row={'side':side,'sourceUV':src['uv'].tolist(),'targetUV':dst['uv'].tolist(),'sourceOpenGate':gate}
  if gate<=.25:
   row.update(state='skipped',reason='source-eye-closed-or-hidden');rows.append(row);continue
  delta_uv=src['uv']-dst['uv'];norm=float(np.linalg.norm(delta_uv))
  gain=float(strength*smooth((norm-.015)/.03)*smooth((gate-.25)/.5))
  if gain<1e-5:
   row.update(state='skipped',reason='small-image-space-difference');rows.append(row);continue
  delta_uv*=min(1,.12/max(norm,1e-6))*gain
  delta=dst['width']*(dst['h']*delta_uv[0]+dst['v']*delta_uv[1])
  mask=np.zeros((512,512),np.uint8);cv2.fillPoly(mask,[np.rint(dst['contour']).astype(np.int32)],1)
  alpha=smooth(cv2.distanceTransform(mask,cv2.DIST_L2,5)/3)
  alpha[:,:256]*=side==0;alpha[:,256:]*=side==1
  if not np.any(alpha):
   row.update(state='skipped',reason='eye-interior-not-visible');rows.append(row);continue
  accepted=None
  for reduction in [1.,.8,.64,.512,.4096]:
   movement=delta*reduction;desired=dst['pupil']+movement
   distance=np.hypot(XX-desired[0],YY-desired[1]);inner=max(2,dst['radius']*1.1)
   outer=inner+max(3*float(np.linalg.norm(movement)),dst['width']*.22)
   weight=smooth((outer-distance)/(outer-inner))*alpha
   vx,vy=weight*movement[0],weight*movement[1]
   tx,ty=XX.copy(),YY.copy()
   # Integrate a stationary field; resample the RGB image just once afterward.
   for _ in range(24):
    sx=cv2.remap(vx,tx,ty,cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT)
    sy=cv2.remap(vy,tx,ty,cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT)
    tx-=sx/24;ty-=sy/24
   dy0,dx0=np.gradient(tx);dy1,dx1=np.gradient(ty);jacobian=dx0*dy1-dy0*dx1
   if np.all(jacobian[weight>0]>=.1):accepted=(tx,ty,jacobian,movement,reduction);break
  if accepted is None:
   row.update(state='skipped',reason='warp-fold-risk');rows.append(row);continue
  tx,ty,jacobian,movement,reduction=accepted;support=alpha>0
  map_x[support]=tx[support];map_y[support]=ty[support];permission=np.maximum(permission,alpha)
  row.update(state='warped',deltaPixels=movement.tolist(),requestedStrength=strength,effectiveGain=gain*reduction,
   clamped=norm>.12,minInverseJacobian=float(jacobian[weight>0].min()))
  rows.append(row)
 mapped=cv2.remap(image,map_x,map_y,cv2.INTER_LINEAR,borderMode=cv2.BORDER_REPLICATE)
 result=image.copy();result[permission>0]=mapped[permission>0]
 assert np.array_equal(result[permission==0],image[permission==0])
 return result,permission,{'state':'complete','eyes':rows,'protectedPixelsExact':True,
  'permittedPixels':int((permission>0).sum()),'changedPixels':int(np.any(result!=image,axis=2).sum())}
