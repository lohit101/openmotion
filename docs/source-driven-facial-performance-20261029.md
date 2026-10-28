# Source-driven facial performance: matched five-second comparison

29 October 2026. The user requested the original video's lip shapes, eye movements,
blinks and expressions on the repainted character. This is visual performance
transfer, including silent performance and miming; soundtrack-driven speech
generation is a different task. Imagen's no-replacement issue remains deferred in
[the saved investigation](imagen-noop-investigation-20261029.md).

## Decision

**PerformRecast is the strongest new expression candidate on this clip, but no
candidate passed the complete face-identity/gaze/detail requirement.** Do not
enable it globally or describe eye tracking as solved. Keep the existing paid
video, current Studio recipes and optional face-swap methods unchanged while the
user reviews these comparisons. These are separate evaluation outputs, not new
Viggle generations or Library sampling runs.

The promising route is source-video performance extraction followed by a
face-scoped correction of the generated video. Preserve generated identity and
head pose, exact source/output frame correspondence, and protected body/scene
pixels. Do not synthesize a fresh speech performance from music and assume it is
the visible source performance. Do not add an unrelated model-family LoRA to H3.

PerformRecast preserves the identity in its current target frame; it does not
recover a fixed donor identity if Viggle has already drifted. A future fixed-donor
identity correction followed by source-driven expression transfer is a sensible
ordering to test. That combined GPU pipeline was not benchmarked here and must
not be presented as a validated identity lock.

## Research findings

| Candidate | Fit for this request | Evidence and decision |
| --- | --- | --- |
| PerformRecast | Expression-only video-to-video editing, separating expression from target identity and head pose | Four retrained appearance/motion/warp/decoder networks; source-video Replacement mode is the relevant route. Tested below. |
| LivePortrait | Fast video-to-video expression transfer, regional controls, eye/lip-opening retargeting | Widely integrated, including FaceFusion; tested at two strengths. Eye opening is not pupil direction. |
| Existing Source eyes & mouth | Fixed-donor swaps of source and generated faces, then gated feature transfer | Tested on the same five seconds locally; adds no new model family. Some eyelid seams and appearance transfer remain. |
| MuseTalk 1.5 / LatentSync 1.6 | Audio-to-mouth correction | Reviewed, but excluded from this source-expression comparison: neither supplies the source's blinks, gaze or silent expressions. Their incomplete local download evaluation was stopped; no audio-model weights were uploaded to the GPU. |
| Native H3 source-audio pinning | Supplies audible speech cues to H3 | Earlier music/miming test worsened the matched source-mouth diagnostic; not repeated or enabled. |

PerformRecast is a separate third-party project, unrelated to this application's
name. Its official pipeline recomposes driving expression onto the target video's
identity/head pose. The authors recommend **Replacement (mode 1)** for editing;
Enhancement adds a delta and can stack expressions. The community VisoMaster
Fusion 3.6.1 release also integrates PerformRecast specifically as a face
expression restorer. This is evidence of an implemented practitioner workflow,
not independent proof of universally better quality.

Primary sources:

- [PerformRecast official code, modes and checkpoints](https://github.com/youku-aigc/PerformRecast), revision `0206abf3ba9e5b1eaa3cdc584879d5fa20d6a0b4`.
- [PerformRecast paper](https://arxiv.org/abs/2603.19731).
- [VisoMaster Fusion 3.6.1 release](https://github.com/VisoMasterFusion/VisoMaster-Fusion/releases/tag/v3.6.1) and [its ONNX expression implementation](https://github.com/VisoMasterFusion/VisoMaster-Fusion/blob/f2d6f5ebe190b631ee5c8972332083cf7f8a3e72/app/processors/perform_recast.py).
- [Checksummed PerformRecast ONNX exports](https://github.com/Glat0s/PerformRecast-onnx/releases/tag/onnx-v1).
- [LivePortrait official code and video editing](https://github.com/KlingAIResearch/LivePortrait), [FaceFusion expression restorer](https://github.com/facefusion/facefusion/blob/decc6c9d8f8e014878624452c6e8fe208726b4ec/facefusion/processors/modules/expression_restorer/core.py).
- [MuseTalk](https://github.com/TMElyralab/MuseTalk), [LatentSync](https://github.com/bytedance/LatentSync), [prior source-audio evaluation](facial-performance-research-20261028.md).

No verified publisher H3/Viggle LoRA dedicated to reproducing source eye direction
and facial expressions was found in the checked releases. The DMD adapter
accelerates sampling; it is not a source-performance controller. A negative search
is not proof that no experimental adapter exists anywhere.

## Matched inputs and method

All candidates use frames **0–119**, exactly five seconds at 24 fps, from immutable
paid video `56094f66-1da4-4e8e-ab49-7651ff0eb0fe` and its exact `prepared-source.mp4`.
The original output is 704×1248. This sample contains a clear, large face and simple
continuous motion. It does not validate cuts, occlusions, hidden-face reappearance,
large pose changes or multi-person tracking.

Source and generated faces were independently aligned with the existing
YuNet/2DFAN4 route to common 512×512 crops. Initial detection/alignment and XSeg
permission preparation took **27.471 seconds on the Mac CPU**. This is deliberately
a common-crop comparison, **not the official PerformRecast 203-point cropper or a
measured integrated Studio end-to-end pipeline**. Crop choice may affect quality.
The unmodified upstream input checks accepted this sample.

LivePortrait used the pinned FaceFusion absolute expression composition, retaining
the target's canonical points, pose, translation and scale, with its trained
expression limits and protected keypoints. Strengths were 0.6 and 1.0. The earlier
rejected first-frame-relative calibration was not reused.

PerformRecast used all four FP32 ONNX models, 49-point motion, the upstream
`softmax * 3 - 99` pose convention and Replacement mode's cheek/jaw modulation.
The target supplies per-frame appearance, canonical geometry and head pose; the
source supplies per-frame expression. Feature/warp tensors stay on the GPU with
ONNX Runtime I/O binding. Its four files total **1,020,005,645 bytes**; DINO is inside
the appearance export, not an additional download. Hashes and exact model/runtime
versions are in the [sanitized receipt](validation/source-driven-performance-20261029.json).

The existing Source eyes & mouth baseline used the same donor prepared frame,
original source and generated frames. The first 120 decoded pixels were stored in
FFV1 inputs without introducing an extra input-compression difference. Its normal
fixed-donor swaps, pose gates, XSeg masks and feature transfer were unchanged.

A cheap offline hybrid also combined PerformRecast with only eye regions from
that baseline. This is an ablation, not a new accepted workflow: it inherited
heavy-looking eyelid edges and was not selected as an automatic default.

## Timings and visual findings

| Candidate | Processing measurement for 120 frames | Review |
| --- | --- | --- |
| LivePortrait 0.6 | **5.983 s** face-model loop, A6000 | Mouth motion improves; gaze is pulled downward, eyelid/resting-expression mismatch and softened detail remain. |
| LivePortrait 1.0 | **5.599 s** face-model loop, same warmed sessions | Stronger mouth motion but more conspicuous eye changes. Not preferred over 0.6 for overall appearance. |
| PerformRecast Replacement 1.0 | **13.286 s** face-model loop, A6000 | Closest sampled lip shapes and expression changes; skin/detail softening and imperfect gaze remain. Best new mouth/expression candidate, not a full fidelity pass. |
| Existing Source eyes & mouth | **197.657 s** complete CPU baseline on this Mac | 118 source-feature frames, two generated-face tracking skips retained. Better mouth timing; some strong eyelid edges/appearance changes. This CPU timing cannot rank GPU implementations. |

Model session initialization was approximately 0.415 s for the first LivePortrait
run and 0.599 s for PerformRecast; the second LivePortrait run reused sessions.
The model-loop measurements include per-crop preparation, motion extraction,
decoding and the final GPU-to-CPU result, but exclude detection/alignment,
masking, crop transfer, PNG writing, full-frame paste-back, video encoding and
result transfer. They are **extra pass timings**, not total Viggle creation times.
At $0.40/hour compute, 13.286 seconds corresponds to about **$0.00148 / 0.148 cents**
of inference compute alone. A managed end-to-end implementation has not been timed.

The first draft benchmark repeatedly decompressed the entire NPZ input arrays
between frames, falsely adding about half a second per frame. It was stopped and
replaced with a complete 120-frame run with arrays materialized once. Only that
corrected run supplies the table above. Model sessions used CUDA; ONNX execution
profiles confirm CUDA kernels for all seven networks. PerformRecast also executes
some nodes on CPU, which is recorded rather than called an all-CUDA graph.

Synchronized source/output close-ups were inspected at frames 0, 12, 24, 36, 48,
60, 72, 84, 96, 108 and 119, including the late lip closure/smile. Full 120-frame
previews were produced for comparison. All outputs retain 120 frames, 24 fps and
five seconds; their preview audio is the original corresponding track.

### Limited geometric diagnostics

2DFAN4 mouth-opening ratios were measured on all 120 exported frames. These are
landmark proxies, affected by differing anatomy and compression, **not lip-sync,
gaze, identity or human-quality scores**. They do not test phoneme correctness,
tongue realism, pupil direction or fine facial microexpressions.

| Candidate | Mean absolute source mouth-opening discrepancy | Mouth-opening correlation |
| --- | --- | --- |
| Viggle baseline | 0.07819 | 0.6292 |
| LivePortrait 0.6 | 0.02621 | 0.9239 |
| LivePortrait 1.0 | 0.04092 | 0.9639 |
| PerformRecast | **0.01813** | **0.9830** |
| Source eyes & mouth | 0.02504 | 0.9649 |
| PerformRecast + source-feature eyes | 0.01711 | 0.9862 |

The hybrid's slightly better proxy does not override its visible eyelid artifacts.
Eyelid-opening diagnostics were also collected, but no calibrated iris/gaze-angle
metric was used. Do not present good eyelid numbers as successful eye tracking.
Single-clip performance does not establish cross-character identity preservation.

## Output preservation and access

Private results remain under ignored `backups/lipsync-20261029/`:

- `previews/source-performance-comparison.mp4`: source / Viggle / PerformRecast /
  existing source-feature method, synchronized face close-ups.
- `previews/performrecast-100.mp4`: full-frame corrected candidate.
- `previews/liveportrait-060.mp4`, `liveportrait-100.mp4`, `source-features.mp4`,
  `perform-source-eyes.mp4`: separate alternatives/ablation.
- `previews/comparison-00.jpg`, `comparison-06.jpg`: sampled review sheets.
- `gpu-results/`: lossless FFV1 crop outputs, decoded-pixel hashes, transfer hashes,
  timing and actual provider receipts.

All crop outputs were verified pixel-for-pixel through lossless packaging and
again after downloading. Composition asserted exact decoded generated-frame
pixels outside the face permission **before encoding**. MP4 previews use H.264
CRF 16; they are not pixel-lossless masters. Original paid video, references,
drafts and historical receipts were not modified or resampled.

## Setup, cost and lifecycle

The same cached RTX A6000 instance `58120414` was used, with $0.40/hour compute and
$0.0177778/hour retained disk quote, below the $0.70 ceiling. No new rental or
Viggle inference was submitted. The disk had little spare room, so model weights
and crop/result scratch stayed in RAM-backed storage. An isolated executable
venv reused the engine's existing PyTorch/CUDA binaries; ComfyUI's environment
and model cache were not changed. The RAM mount's `noexec` restriction required
putting only the evaluation runtime on the persistent disk.

The measured resume/setup/comparison/transfer interval was about **15 minutes**.
Its quoted compute/storage plus known evaluation-model/input/result transfers is
approximately **$0.11**, excluding earlier Imagen/session activity, unmetered
minor package traffic and ongoing retained storage. This is a rate-based estimate,
not an invoice or a per-clip production price. Most of this session cost was setup,
transfer and evaluation overhead, not the 13-second model pass.

The user's five-minute idle preference was temporarily suspended only because the
isolated test worker is outside Studio's queue. It was restored to **enabled**.
Both application and native ComfyUI queues were checked empty before stopping the
same instance; provider state was confirmed **exited / computeStopped: true**.
Model/media storage was retained; temporary RAM weights disappear on stop.

## Requirements before selecting a production pass

1. User review of these matched previews, explicitly weighing improved mouth
   motion against softness, altered resting expression and gaze mismatch.
2. A dedicated source pupil/gaze evaluation. Eye-opening retargeting alone is
   insufficient; neither the latent expression route nor feature transplant
   passed that requirement here. Test regional controls/calibrated gaze without
   resurrecting the rejected first-frame-relative eye-roll behavior.
3. Second matched continuous-shot test with blinks, closed lips, side glance and
   modest head rotation. Keep donor identity fixed and compare source timing.
4. Only then expose an explicit optional download and resumable isolated GPU
   post-pass with immutable source mapping and unchanged originals. Benchmark
   full creation-to-Library latency before promising a fast end-to-end target.

PerformRecast's code is MIT, but its official cropper includes separately licensed
InsightFace models and the author explicitly warns about commercial use. The
current baseline also uses non-commercial recognition / ResearchRAIL swap weights
and XSeg terms. This private comparison does not clear the complete dependency
stack for a hosted service. [Official licensing note](https://github.com/youku-aigc/PerformRecast#license).
