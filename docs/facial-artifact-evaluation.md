# Facial artifact evaluation — 2026-10-30

This records the initial private evaluation. The subsequently implemented,
managed-backend-tested feature route is documented in
[Complete facial feature ownership](facial-feature-cleanup.md).

The user reported a detached eyebrow near 13–14 seconds, a doubled eyelid,
milky eye detail and a face-side mark. The goal remains active. During this
initial evaluation the production recipe stayed unchanged. The later v3 edge
fix is separately documented above; all paid originals remain unchanged.
Private comparisons are not a claim of flawless identity or gaze.

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
a narrow strip of real foreground. The later v3 implementation keeps that
witness exact and protects target hair, glasses and non-face labels. Its managed
evaluation and retained uncertain hand-occlusion frames are recorded in the
linked feature report; exact protection of classified pixels is not proof that
every real occluder is correctly classified.

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

## Subsequent calibration and identity-model evaluation

The aperture-only still tests retained soft eyes. Broader reference calibration
made the eyes clearer but introduced an unwanted resting sideways glance on the
portrait clip. A subsequent private variant disables horizontal calibration on
the eight eye keypoints, while gating vertical eye calibration by visible source
opening. It reuses the frozen v3 compositor, fixed donor and 60% identity blend.

Three full-clip runs processed the same 355/216/240 saved animation frames in
155.196/103.624/96.508 worker seconds respectively. Their complete frame counts,
dimensions, 24 fps timing, original audio packets and output hashes passed local
validation. The portrait again retained ten uncertain hand-occlusion frames.
Lossless RGB archives reproduce every decoded-frame and PNG checksum. These are
finishing-only timings and processing checks, not identity or gaze scores.

Horizontal calibration exclusion avoids the inspected resting-glance regression,
but broad calibration also closes the mouth at frame 45 of the nine-second clip
while the source is speaking. It therefore remains private, not a production
default. A seven-frame CPU comparison then excluded mouth and jaw calibration;
the speaking mouth opens again while the inspected eye detail stays clearer.
That refinement then completed all three full clips with the same fixed donor,
60% identity blend and v3 masks. Its workers took 156.007/104.867/94.202 seconds
for 355/216/240 frames. It preserves the ten uncertain portrait frames. The
nine-second run resumed its existing 117-frame facial prefix after reaching the
private working-space reserve; it did not regenerate paid animation frames.

The mouth-excluding candidate retains clearer inspected eyes and the speaking
pose at frame 45, making it the stronger calibration candidate. It still does
not reproduce the source's nearly closed/pursed mouth at frame 215 perfectly;
that discrepancy also exists in the prior v3 finish. Fine texture and exact gaze
and identity fidelity remain unresolved. It stays private pending versioned
managed integration and stronger temporal quality checks. It must not silently
replace a user's saved Standard/Regional choice or any paid v1/v2/v3 recipe.

Two official HyperSwap alternatives, 1b and 1c, were downloaded **only to this
Mac** from the checksum-pinned FaceFusion repository. Eight matched CPU stills
compare 1a/1b/1c at both 60% and 100% RGB identity blend, keeping Standard source
performance and v3 compositing. The 48 outputs took 77.05 seconds. Neither new
variant clearly fixes the reported soft-eye frame; some alter facial proportions
and makeup. No alternative was added to the app, transferred to the GPU or
selected as a default. These samples establish no universal ranking.

The horizontal-preserving full-clip batch used the existing A6000, with no new
Viggle/Imagen sampling or model transfer. Compute was independently confirmed
exited/stopped at **01:58:07 UTC**, with five-minute idle pause restored. Its
quoted-rate estimate is about **6.71¢ compute plus 0.26¢ storage**, excluding
small media/code transfers. Later test-session receipts are tracked separately.

The mouth-preserving batch was independently confirmed exited/stopped at
**02:20:42 UTC**, with idle pause restored. Its roughly **12.68¢ compute** estimate
includes the saved-frame recovery and archive relocation, not just inference.
Three older private lossless archives (424,193,472 bytes) were checksum-verified
on the Mac before their remote cache copies were released. Original paid media
and weights were not removed. The sanitized report records rates, retained
frames, archive proofs and the separate storage/transfer estimates.

A seven-frame, 28-output CPU texture study also compared no restoration, the
current 65% registered RGB, stronger registered RGB and high-frequency-only
restoration. Stronger RGB is sharper in some inspected eyes but may restore raw
animation errors; its temporal gaze/identity behavior has not been validated.
The high-frequency-only route showed no clear benefit. Neither changes v3.

A subsequent fourteen-still CPU closure probe activates only when the exact
source anchor has an open mouth and the fixed reference is clearly closed. It
applies vertical mouth calibration as source opening decreases, keeping open
speech and horizontal/depth expression unchanged. The inspected final mouth is
closer to closed, but its pucker still differs from the source. It is not adopted
and has no full-motion validation. Mean-per-eye horizontal calibration is the
next isolated CPU geometry test: shifting each eye group together may correct
spacing without changing the source's within-eye horizontal motion.

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

The initial private 93.63 MB parser was subsequently added to the explicit v3
download manifest and reused for the managed evaluation. Generate never starts
its download implicitly. Existing model licence limitations still apply.

The identity-model comparisons use the official
[FaceFusion swapper definitions](https://github.com/facefusion/facefusion/blob/master/facefusion/processors/modules/face_swapper/core.py)
and [model repository](https://huggingface.co/facefusion/models-3.3.0). The code
identifies all three HyperSwap models as ResearchRAIL; this evaluation does not
clear the complete stack for a future hosted service.
