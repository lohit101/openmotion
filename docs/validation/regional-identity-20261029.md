# Regional PerformRecast and ONNX identity-order comparison

The user liked the previous expression candidate and authorized regional tuning
plus an ONNX identity-swap comparison. Same parent
`56094f66-1da4-4e8e-ab49-7651ff0eb0fe`, source frames 0–119, five seconds at 24 fps,
704×1248, and the same immutable single-face prepared reference were used.
No new Viggle inference, Imagen work, product-default change or runtime restart
was performed. The earlier user render had finished before testing started.

## Recipe

PerformRecast Advanced-style per-frame structural anchoring used XY weights:
mouth 1.0, eyes 0.8, brows 0.9, cheeks 0.2, jaw 0.15, other structural points 0.
Expression Z changes were zeroed. Canonical points, head pose, scale and translation
come from the generated target frame. This is per-frame structural-center
alignment, not the rejected first-frame-relative calibration. These controls
reduce structural modification; they do not guarantee fixed rendered identity.

The identity pass used the existing pinned `hyperswap_1a_256.onnx` with exact
FaceFusion normalization and 512px stride-based pixel boost. One donor ArcFace
embedding was extracted locally from the same reference after unchanged upstream
image/video checks. Face-swap embedding balance stayed at 0.5 (zero target-identity
mixing in that parameterization). **60% means blending 60% of the fully swapped
face result with 40% of the pre-swap result**, not a different embedding or model.
The same saved face-permission/occlusion masks and full-frame transforms apply.

Common face crops were used, as in the previous comparison. This is an isolated
evaluation rather than the complete production FaceFusion cropper/queue pipeline.
The previous accepted PerformRecast crop outputs were reused unchanged for the
last two branches; they were not presented as new inference.

## Results

| Variant | Measured face-model time / 120 frames | Source mouth-opening correlation |
| --- | --- | --- |
| Previous PerformRecast | 13.286 s, prior measured run | 0.9830 |
| Regional only | 13.232 s | 0.9815 |
| Identity swap only on Viggle | 4.590 s | 0.6187 |
| Swap then regional | 4.590 + 12.986 = 17.575 s | 0.9837 |
| Regional then full swap | 13.232 + 4.468 = 17.700 s | 0.9638 |
| Regional then 60% swap | Same model calls, cheap output blend | 0.9791 |
| Previous pass then full swap | 4.226 s additional | 0.9648 |
| Previous pass then 60% swap | 4.226 s additional, cheap output blend | 0.9763 |

These are component-loop measurements on the same RTX A6000, excluding
detection/alignment, transfer, full-frame composition and export. Component sums
are not an integrated Studio latency benchmark. Creating the previous-pass plus
identity route from scratch would involve about 17.5 seconds of measured face-model
work, in addition to Viggle and all preprocessing/export. Sessions took 1.161 s to
load for the combined evaluation. CUDA execution was checked; the receipt records
the actual mixed node providers instead of claiming an entirely CUDA-only graph.

**Review preference: previous expression pass → 60% ONNX identity swap.** The
reference likeness returns more clearly while most mouth-opening timing remains.
Regional-only appears sharper and restrains some shape changes, but its eye/makeup
appearance is heavier and it is not the strongest likeness candidate. Swapping
before the regional pass allows that pass to modify the recovered identity again.
Full-strength swaps bring stronger reference features but have a more processed
eye appearance and a greater mouth-motion tradeoff. Fine skin texture is still
soft; no generic sharpening/restoration model was silently added.

Synchronized review sheets cover frames 0,12,24,36,48,60,72,84,96,108,119, with
larger reference/result comparisons at 0,108,119. All 120 frames were checked for
mouth/eyelid geometry. The numbers above are **opening-ratio diagnostics, not
phoneme accuracy, gaze direction, identity fidelity or quality scores**.

A secondary ArcFace cosine diagnostic sampled every sixth frame. It favors
post-expression swapping over swapping beforehand, but uses the same encoder
family that conditions Hyperswap and is therefore biased. It is recorded as a
diagnostic, not an independent identity-accuracy benchmark or acceptance gate.
No embeddings or source/generated media are committed. No iris-direction metric
was measured, and occlusions/cuts/long-clip drift were not validated by this sample.

## Preservation, artifacts and lifecycle

All seven new crop variants were packaged losslessly, checked pixel-for-pixel,
transferred with checksums and revalidated during local composition. Every export
contains 120 frames at 24 fps / five seconds. Full-frame composition asserts exact
decoded Viggle pixels outside the saved face permission before encoding. Browser
previews are H.264 CRF16 with copied corresponding audio, not lossless masters.
Original paid media, previous accepted candidate and drafts remain unchanged.

Private artifacts live under ignored `backups/regional-identity-20261029/`:

- `previews/regional-identity-comparison-v2.mp4`: reference, source, previous pass,
  regional only, regional + 60% swap, previous pass + 60% swap.
- `previews/accepted-then-swap-060.mp4`: preferred full-frame preview.
- `previews/regional-then-swap-060.mp4`: alternate full-frame preview.
- `previews/swap-then-regional.mp4`, other full-frame variants, synchronized sheets
  and the full lossless crop/transfer/timing receipts are preserved separately.

The same cached A6000 `58120414` stayed below the $0.70/hour limit: $0.40/hour
compute plus $0.0177778/hour retained disk. Five evaluation ONNX files total
1.423 GB and were stored in temporary RAM scratch; existing local recognition
weights were reused for donor preparation. ComfyUI's environment/model cache
was not changed. Known model/input/result transfer and the conservatively timed
nine-minute evaluation interval total approximately **$0.07**, excluding minor
traffic and continued retained storage. This is a rate-based estimate, not an
invoice or a per-clip production cost.

The first stop API response was unconfirmed/HTTP 400. An independent provider
refresh subsequently confirmed **exited / computeStopped: true**. The original
five-minute idle preference was restored to enabled. No new rental or retry
inference was used to recover this response; all results were already verified
locally before stopping.

Current private-evaluation model/dependency licensing remains unchanged, including
the non-commercial recognition and ResearchRAIL swap terms. These results do not
clear a hosted commercial service. Recipes and sanitized receipts are saved;
application defaults remain unchanged for user comparison.

Implementation references: [PerformRecast](https://github.com/youku-aigc/PerformRecast),
[regional composition](https://github.com/VisoMasterFusion/VisoMaster-Fusion/blob/f2d6f5ebe190b631ee5c8972332083cf7f8a3e72/app/processors/perform_recast.py),
[pinned Hyperswap composition](https://github.com/facefusion/facefusion/blob/decc6c9d8f8e014878624452c6e8fe208726b4ec/facefusion/processors/modules/face_swapper/core.py).
