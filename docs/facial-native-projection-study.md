# Face sampling and fine-detail study

This private follow-up isolates softness in the final face-to-scene projection. It reuses saved jaw-corrected frames and their exact pre-composite neural face crops. It adds no expression/identity generation, image repaint, model download or GPU work. The paid model outputs and production finishing recipes remain unchanged.

The official [PerformRecast pipeline](https://github.com/youku-aigc/PerformRecast/blob/main/src/pipeline.py) extracts appearance, transfers expression and decodes a cropped face before pasting it into the scene. Softness can enter during both neural synthesis and subsequent resampling. The official [crop configuration](https://github.com/youku-aigc/PerformRecast/blob/main/src/config/crop_config.py) uses a 512-pixel source crop and a 256-pixel driver crop, with scale 1.5 and vertical offset −0.125. Our ArcFace alignment is not a reproduction of its 203-landmark cropper; the earlier 68-landmark approximation showed no clear improvement and remains experimental.

CodeFormer's authors describe a [quality/fidelity trade-off](https://github.com/sczhou/CodeFormer#testing). Our earlier face-wide restoration trial softened appearance, while restrained eye-only restoration helped some irises. This study therefore holds those model outputs fixed and tests projection math separately.

## Frozen candidates

Fifteen saved frames across four clips compare the unchanged saved jaw finish with cubic projection, skin-interior sampling-detail recovery, and both together. The sampling residual comes exclusively from the raw generated animation and its crop/reprojection, never from the source actor's RGB. It is high-pass filtered, bounded to ±8 channel values, multiplied by 0.8 and limited to an eroded skin interior that excludes eyes, brows, mouth and the face outline. The cubic alternative keeps the current edit permission and changes only the inverse projection of the final face plane.

The still study took 18.460 seconds on this Mac, including parsing, face detection, composition and evidence saving. Median eye spatial energy increased about 6.8% with cubic projection; the combined candidate increased skin spatial energy about 15.7%. These are sharpness diagnostics, not identity, gaze or realism scores. The inspected differences are modest. They do not recover missing true detail or establish improved facial geometry.

Every still retains exact baseline pixels outside its new permission. CPU replay does **not** exactly reproduce the original CUDA masks: only three of fifteen structural jaw metadata objects match exactly, and the largest source-jaw visibility difference is about 0.0385. Some of the largest visibility differences occur on frames where both routes retain the old jaw mask. These private variants are built as bounded deltas on immutable saved jaw-fixed frames, rather than being presented as a bit-exact GPU replay.

## Full motion and review

The same frozen parameters completed all 355 hair/eye frames, 216 continuity frames and 51 held-out portrait frames. Two alternatives per clip produce six complete exports from 622 existing frames. The serial CPU study took 558.7 seconds overall, including composition, evidence saving and encoding. The per-clip processing times before encoding were 297.4, 203.7 and 41.5 seconds. These are CPU post-processing measurements, not new animation inference or GPU/Generate latency.

All 1,244 candidate PNG file hashes, decoded output timing/frame counts and original audio packet hashes were verified. The worker asserts unchanged baseline pixels outside each candidate's permission on every frame. A separate replay reconstructed all sixty still outputs exactly from their saved projection deltas and baseline; this is not an independent reconstruction of every full-video segmentation mask. The three uncertain held-out frames remain exact saved baseline pixels in both alternatives before encoding.

The main combined export played natively through its ending pose, and synchronized blink/brow-turn strips plus fifteen still comparisons were inspected. Full visual review of all six exports is not claimed. The changes are subtle. The sharper projection does not remove the remaining source/output aperture and gaze differences; the eye/skin finish still looks soft in places. The skin residual has no clear enough visual advantage to select it. It can also retain unwanted fine detail already present in a drifting raw animation; that is a method limitation, not a demonstrated new identity failure in this cohort. The projection-only variant is the first private review comparison. Neither variant is enabled in Studio or claimed as a quality pass.

The private comparison page provides a **Sampling and texture tests** group. `?review=projection&compare=1` selects the saved jaw finish against projection-only when available; the combined skin candidate remains separately selectable. Existing preferred variants and original paid results remain unchanged. The still gallery explicitly labels its CPU comparisons.

The user's credit hold remains in force. GPU tool preparation, native v6/v7/v8 recovery and GPU permission replay await their confirmation of a refill. The broader quality goal remains incomplete: exact identity, gaze, soft texture and arbitrary occlusions are not solved by resampling alone.

See the [sanitized validation record](validation/facial-native-projection-20261030.json). All raw media, frozen private plans and CPU workers remain in ignored backups; no credentials or reference images are pushed.
