"""Optional source-timed eye/mouth transfer after a fixed-donor identity swap."""
import json
from pathlib import Path


PROFILE = Path(__file__).resolve().parents[1]/'config/face-source-profile.json'


def profile():
    return json.loads(PROFILE.read_text())


def pose_proxy(points):
    import numpy as np
    points=np.asarray(points,dtype=np.float64)
    if points.shape != (5,2) or not np.isfinite(points).all():
        raise ValueError('Invalid facial alignment points.')
    eye=points[1]-points[0];distance=float(np.linalg.norm(eye))
    if distance < 1: raise ValueError('Degenerate eye geometry.')
    horizontal=eye/distance;vertical=np.array([-horizontal[1],horizontal[0]])
    nose=(points[2]-(points[0]+points[1])/2)/distance
    return distance,float(nose@horizontal),float(nose@vertical)


def compatible_faces(source_face,target_face,settings=None):
    cfg=settings or profile()
    if source_face.score_set['landmarker'] < cfg['source_landmark_confidence']:
        return 'uncertain-source-face'
    if target_face.score_set['landmarker'] < cfg['target_landmark_confidence']:
        return 'uncertain-output-face'
    try:
        sd,sx,sy=pose_proxy(source_face.landmark_set['5/68'])
        td,tx,ty=pose_proxy(target_face.landmark_set['5/68'])
    except ValueError:
        return 'invalid-face-geometry'
    if min(sd,td) < cfg['minimum_eye_distance']:
        return 'face-too-small'
    if abs(sx-tx)>cfg['maximum_yaw_proxy_gap'] or abs(sy-ty)>cfg['maximum_pitch_proxy_gap']:
        return 'source-output-pose-mismatch'
    return None


def feature_mask(landmarks,matrix,settings=None):
    import cv2
    import numpy as np
    cfg=settings or profile();size=cfg['crop_size']
    points=np.asarray(landmarks,dtype=np.float32)
    if points.shape != (68,2) or not np.isfinite(points).all():
        raise ValueError('Invalid expression landmarks.')
    points=cv2.transform(points.reshape(1,-1,2),matrix)[0]
    mask=np.zeros((size,size),np.float32)
    for indices in [range(36,42),range(42,48),range(48,60)]:
        polygon=cv2.convexHull(np.rint(points[list(indices)]).astype(np.int32))
        cv2.fillConvexPoly(mask,polygon,1.)
    diameter=cfg['feature_dilation']
    mask=cv2.dilate(mask,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(diameter,diameter)))
    return cv2.GaussianBlur(mask,(0,0),cfg['feature_feather_sigma'])


def transfer_features(source,source_face,source_swapped,target,target_face,identity_result):
    """Only donor-swapped features may enter the result. Both occlusions protect it."""
    import cv2
    import numpy as np
    from facefusion.face_helper import warp_face_by_face_landmark_5
    from facefusion.face_masker import create_occlusion_mask
    from video_identity import face_permission
    cfg=profile();size=(cfg['crop_size'],)*2
    reason=compatible_faces(source_face,target_face,cfg)
    if reason:return identity_result,{'performance':'identity-only','reason':reason}
    source_crop,sm=warp_face_by_face_landmark_5(source,source_face.landmark_set['5/68'],'arcface_128',size)
    target_crop,tm=warp_face_by_face_landmark_5(target,target_face.landmark_set['5/68'],'arcface_128',size)
    donor_features=cv2.warpAffine(source_swapped,sm,size,flags=cv2.INTER_LINEAR,borderMode=cv2.BORDER_REPLICATE)
    source_mask=cv2.warpAffine(face_permission(source,source_face.bounding_box),sm,size,flags=cv2.INTER_LINEAR)*create_occlusion_mask(source_crop)
    target_permission=face_permission(target,target_face.bounding_box)
    target_mask=cv2.warpAffine(target_permission,tm,size,flags=cv2.INTER_LINEAR)*create_occlusion_mask(target_crop)
    features=np.maximum(feature_mask(source_face.landmark_set['68'],sm,cfg),feature_mask(target_face.landmark_set['68'],tm,cfg))
    alpha=(np.minimum(source_mask,target_mask)*features).clip(0,1)
    inverse=cv2.invertAffineTransform(tm);geometry=(target.shape[1],target.shape[0])
    projected=cv2.warpAffine(donor_features,inverse,geometry,flags=cv2.INTER_LINEAR)
    mask=cv2.warpAffine(alpha,inverse,geometry,flags=cv2.INTER_LINEAR)*target_permission
    if float(mask.sum())<1:return identity_result,{'performance':'identity-only','reason':'features-occluded'}
    result=np.rint(projected*mask[...,None]+identity_result*(1-mask[...,None])).clip(0,255).astype(np.uint8)
    if np.any(result[target_permission==0]!=target[target_permission==0]):
        raise ValueError('Source performance transfer changed protected pixels.')
    return result,{'performance':'source-features'}
