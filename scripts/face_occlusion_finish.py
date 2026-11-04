"""Versioned v11 frame adapter; frozen v10 facial math stays unchanged."""
import cv2
import numpy as np

from face_partial_source import admit_visible_eye, compose_orbital, apply_scene_veto


def finish_frame(corrector, parser, frame, original, target_face, source_face,
                 observation, edited, record, calibration_active):
    """Protect target hands last; edit a visible eye only on admitted fallback."""
    target_state = observation['targetMaskState']
    route = 'primary' if record['action'] == 'refined' else 'preserved'
    if target_state not in ['known-none', 'segmented']:
        edited = frame.copy()
        record.update(action='preserved', reason='target-foreground-unavailable')
        for key in ['calibration', 'cleanup', 'partialEye', 'matrix', 'sourceMatrix']:
            record.pop(key, None)
        route = 'preserved'
    elif source_face is None and target_face is not None and calibration_active:
        decision = admit_visible_eye(
            observation.get('source203'), observation.get('sourceHandMask'),
            observation.get('sourceAffine'), False, True,
            track_valid=observation.get('trackValid') is True,
            source_mask_state=observation['sourceMaskState'])
        record['partialEyeAdmission'] = decision
        if decision['admitted']:
            from facefusion.face_helper import warp_face_by_face_landmark_5
            from facefusion.face_masker import create_occlusion_mask
            driver = cv2.warpAffine(original, observation['sourceAffine'], (512, 512),
                                    flags=cv2.INTER_AREA, borderMode=cv2.BORDER_REPLICATE)
            crop, matrix = warp_face_by_face_landmark_5(frame, target_face[1], 'arcface_128', (512, 512))
            prediction = corrector.correct(driver, crop, np.ones((512, 512), np.float32), False)
            edited, detail, permission = compose_orbital(
                frame, crop, prediction, parser(crop), parser(prediction),
                create_occlusion_mask(crop).clip(0, 1), matrix, target_face[2],
                observation['targetVeto'], decision['selectedImageEye'])
            if detail['edited'] and np.any(permission):
                record.update(action='partial-eye', reason=None, partialEye=detail,
                              matrix=matrix.tolist(), sourceMatrix=observation['sourceAffine'].tolist())
                record['calibration'] = corrector.last
                route = 'partial-eye'
        else:
            record['reason'] = decision['reason']
    # The orbital compositor already applies the target veto to its residual.
    if route != 'partial-eye':
        edited = apply_scene_veto(frame, edited, observation['targetVeto'])
    hard = np.asarray(observation['targetHard'], bool)
    if not np.array_equal(edited[hard], frame[hard]):
        raise ValueError('The final tracked target hand changed; raw pixels were preserved on disk.')
    record['occlusion'] = {
        'trackingFrameSHA256': observation['cacheSHA256'],
        'sourceMaskState': observation['sourceMaskState'], 'targetMaskState': target_state,
        'targetProtectedPixelsExact': True, 'route': route, 'sourceRGBTransferred': False,
    }
    return edited, record
