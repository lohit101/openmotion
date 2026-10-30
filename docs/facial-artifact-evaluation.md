# Facial artifact evaluation — 2026-10-30

This records the initial private evaluation. The subsequently implemented,
managed-backend-tested feature route is documented in
[Complete facial feature ownership](facial-feature-cleanup.md).

The user reported a detached eyebrow near 13–14 seconds, a doubled eyelid,
milky eye detail and a face-side mark. The goal remains active. The current
production recipe and all paid originals are unchanged; the following results
are private comparisons, not a claim of flawless identity or gaze.

The screenshots align to frames 332, 32, 98 and 49 respectively in the saved
355-frame 704p clip. Intermediate crops isolate two real compositing defects:

1. Projecting the source person's aligned XSeg matte onto a different hairstyle
   clips the corrected eye/brow. The original open eye can survive above the
   corrected closed lid. The source's hair is not the replacement's foreground.
2. A native-pixel additive residual can retain displaced feature edges. Applying
   the soft permission inside identity correction and again at final composition
   also weakens ownership of corrected features.

A target-aware semantic mask and one absolute feature plane remove the observed
double eye and detached brow in the inspected frames. The private mask prototype
also exposed a protection concern: expanding a semantic feature witness can edit
a narrow strip of real foreground. The implementation being developed instead
keeps that witness exact and protects target hair, glasses and non-face labels.
Its inward boundary feathering and real-media occlusion behavior still need
validation before release.

## Matched comparisons

All three clips reuse existing raw Viggle outputs, their exact chronological
source frames, original fixed donors and original audio. No new video sampling
or Imagen repaint was submitted for these comparisons.

Each clip has three initial recipes: mask/compositor correction; fixed-reference
expression calibration plus clean masks; and calibrated performance in broader
feature regions over a direct identity swap. A fourth comparison registers native
animation eye detail using forward/backward optical flow and source-eye opening
gates. Closed/uncertain eyes do not receive the native texture. This can improve
iris detail, but it can also restore details of an already drifting animation;
it is not a new identity reference or a proven gaze correction.

| Existing animation | Frames | Initial three-recipe worker | Extra eye-detail worker |
| --- | ---: | ---: | ---: |
| Hair across eyes | 355 | 325.036 s | 34.531 s |
| Earlier continuity clip | 216 | 243.6 s | 21.212 s |
| Earlier portrait/hand clip | 240 | 200.920 s | 17.405 s |

The initial timings combine **three** recipes, receipt persistence and exports;
they are not one production-pass latency or complete Generate time. The portrait
comparison retains ten uncertain/mismatched frames. Those are not successful
identity corrections and need explicit review around the preserved ranges.

The 216-frame clip uses its actual later reference at frame 45, rather than
inventing frame zero as the calibration anchor. Complete raw/edited frame hashes,
transforms, model providers, reference hashes and protected-pixel checks are saved
privately. Local validation verifies all output hashes, decoded frames, frame
rates, dimensions and original audio packets. Compressed MP4 pixels are not
claimed to be byte-identical outside the face.

Working PNG caches were compacted into lossless RGB archives only after every
decoded BGR frame and reconstructed PNG checksum matched. Only those disposable
private PNG caches were removed; original media, model weights and paid outputs
remain intact. This recovered enough working space to complete the comparisons.

## Rejected or unresolved directions

- Naive relative expression leaves some blinks or mouth closures partly open.
- Semantic left/right eye class names are not reliable enough for calibration;
  the current prototype uses image halves and the union of both eye classes.
- Partial/full fixed canonical geometry did not show a clear improvement across
  eight sampled frames. A 40-output local CPU ablation took 212.639 s; it does
  not establish temporal consistency.
- The official crop geometry, approximated using the existing 68-point detector,
  did not show a clear advantage. This is not a reproduction of the upstream
  203-point pipeline.
- Full expression calibration may alter resting gaze. A narrower aperture-only
  calibration is being compared before any production selection.

## Review and compute

The open **Face continuity · private comparisons** page is
`http://127.0.0.1:3012/artifacts/`. It provides all three clips, exact issue-frame
buttons, source/raw selection, original output, candidate selection, normal/slow
playback and optional fourth-panel comparisons. Media stays in ignored backups;
the generic viewer is tracked in `tools/face-continuity-review.html`.

The A6000 was independently confirmed exited/stopped at 00:08:36 UTC on October
30. Five-minute idle pause was restored. This first private session's quoted-rate
estimate is approximately $0.50 compute plus $0.019 storage and small transfers,
not a provider invoice. The retained disk remains billed while compute is stopped.
Independent implementation and CPU checks continue offline.

## Primary references

- [FaceFusion mask controls](https://docs.facefusion.io/usage/cli-arguments/face-masker)
  distinguish occlusion masks and semantic face regions.
- [FaceFusion mask implementation](https://github.com/facefusion/facefusion/blob/master/facefusion/face_masker.py)
  identifies the BiseNet ResNet34 region parser and its upstream MIT metadata.
- [PerformRecast pipeline](https://github.com/youku-aigc/PerformRecast/blob/main/src/pipeline.py)
  and [crop settings](https://github.com/youku-aigc/PerformRecast/blob/main/src/config/crop_config.py)
  inform the crop/expression comparisons.
- [LivePortrait pipeline](https://github.com/KlingAIResearch/LivePortrait/blob/main/src/live_portrait_pipeline.py)
  documents relative motion transfer. This is a method reference, not evidence
  that our particular relative-calibration candidate passed.

The new 93.63 MB parser is already present locally and was copied to the private
GPU experiment. It has not yet been added to the product's explicit download
manifest or enabled by Generate. Existing model licence limitations still apply.
