# Source-anchored eye calibration

New Standard + ONNX 60% runs use `source-face-v4` when scene matching, feature cleanup and **Calibrate eye appearance** are enabled. The new toggle defaults on. It reuses the same thirteen facial model files; no additional weights are required. Regional remains on v3. Turning calibration off retains v3, turning cleanup off retains v2, and turning scene matching off retains v1. Existing paid jobs keep their frozen version, settings and receipts.

This follows the matched private comparisons documented in [facial artifact evaluation](facial-artifact-evaluation.md). Broad reference-expression calibration clarified some eyes but introduced a resting sideways-glance change and incorrectly closed the speaking mouth in the nine-second clip. Those offsets are excluded from this version.

## What it does

The saved reference timestamp identifies one exact frame in the chronological prepared source video. For an ordinary starting reference this is frame zero; the tested later-frame reference correctly binds frame 45. The worker decodes the frame sequentially rather than accepting an approximate seek. It binds the video, reference, decoded anchor pixels, job, anchor index and recipe checksums in `calibration.json`.

One clear face with a compatible pose must be visible in both the source anchor and edited reference. Each eye must also be visible in both images before it can receive calibration. An uncertain, covered or incompatible anchor explicitly skips calibration and keeps the existing v3 facial finish. Run details and the completion warning show the reason. The worker never chooses another anchor or donor silently.

The adapter compares reference and source-anchor facial motion features. It excludes reference mouth and jaw offsets and all horizontal eye offsets. Current source visibility gates vertical eye correction, limiting attempts to open a closed or hidden eye. Standard source mouth features and the existing jaw composition are checked unchanged for every refined frame. This is a latent-feature constraint, not a guarantee of identical visible lip shapes or gaze.

The adapter then uses the frozen v3 compositor: complete target-aware feature ownership, the same fixed donor and 60% RGB identity blend, inward scene-edge blending, and gated registered native eye texture. It does not add another image repaint or edit the hair/body/background.

## Recovery and readiness

Calibration is stored once and restored on interruption. Changed video/reference/anchor bindings, nonfinite corrections, edited mouth/jaw/horizontal-eye offsets, hidden-eye edits and altered checksums are rejected while retaining saved frames. Complete downloads can be verified offline against their calibration and transport receipts.

Explicit **Prepare / update facial tools** updates the small worker/helper files and reuses installed weights. Inventory distinguishes the v4 code capability from installed model files and the older v3 capability. Changing an option or pressing Generate still starts no model download or GPU rental.

The new frozen recipe fingerprint is `4520b9613ed3e9d9b5e105baa85cc3332064d3564a0e759fa2af91426ac65239`. The v1/v2/v3 fingerprints remain unchanged. Further calibration math changes require a new recipe version; do not edit this helper in place after paid v4 results exist.

## Managed validation on 2026-10-30

The real Studio managed facial backend processed three separate private derivatives on the existing RTX A6000 #58291560. It reused paid raw animations, their exact prepared source videos and fixed donors. No Viggle or Imagen inference was submitted and no model weights were transferred.

| Saved animation | Frames | Face worker | Managed finishing | Refined / retained |
| --- | ---: | ---: | ---: | ---: |
| Hair across eyes | 355 | 154.556 s | 249.304 s | 355 / 0 |
| Later-reference continuity | 216 | 105.209 s | 211.911 s | 216 / 0 |
| Portrait and hand occlusion | 240 | 95.987 s | 161.513 s | 230 / 10 |

These are finishing-only measurements, not complete Generate times. Managed finishing includes transfers and checks; the first measurement also includes a deliberate cancellation/resume. It is not a fair end-to-end speed benchmark against an uninterrupted old run.

The first worker was stopped after 81 saved frames. Exact remote worker termination was confirmed, then the same job resumed with all 81 saved record objects and the calibration file unchanged. All 811 final frames, original audio packets and output hashes were verified. The worker retained ten uncertain portrait frames. Every lossless archive frame matches the remote saved PNG pixel hash. Decoding the compressed raw input locally produces small RGB differences on those retained frames, so the local archive check is not an independent cross-platform bit-exact raw comparison. All private frame archives were verified locally before releasing remote duplicate caches; original paid animation/image files and user models were retained.

The private viewer at `http://127.0.0.1:3012/artifacts/` includes **Eye calibration · Standard (managed)** for all three clips, alongside v3 and earlier private tests. The inspected main frames 32/49/98/332 have no detached brow or doubled eyelid; the open irises at frame 98 are clearer than v3. The speaking source-anchor frame 45 stays open, and the sampled portrait side glance remains. Playback and the named issue frames were checked at synchronized times and full-frame/face scales.

Some fine eye/skin softness remains. The pursed mouth at continuity frame 215 is still inaccurate in both v3 and v4. Exact gaze, geometry and identity fidelity have not been demonstrated across arbitrary videos; this is not a flawless quality pass. Processing counts and segmentation/flow diagnostics are not identity scores.

The implementation passed 436 Studio tests in 39 files, forty focused Python checks, type checking and the production build. A guarded local reload preserved all 223 existing job rows and both saved generation drafts byte for byte. New defaults fill the absent calibration preference; explicit user choices are not overwritten.

Compute was independently confirmed `exited` / intended `stopped` at 03:30:46 UTC, with the original five-minute idle preference restored. The measured session estimate is about $0.177 compute, or $0.184 including retained disk during that interval, plus media/network transfers and subsequent retained storage. This includes setup, archive movement and recovery testing; it is not an invoice or a per-clip price.

See the [sanitized validation record](validation/facial-eye-calibration-20261030.json). Private media, per-frame records, face calibration vectors and full local evidence remain ignored under `backups/face-artifacts-20261030/v4-validation/`.

## Private detail studies after v4

Three additional CPU studies test the remaining softness without changing the frozen v4 recipe, Studio preferences, paid animations or image/video inference. They remain evaluation candidates in the private comparison page.

The native-eye post-pass reuses the exact lossless v4 frames and the same raw animation. It limits changes to source-visible eye interiors, uses forward/backward optical-flow confidence and XSeg occlusion, and asserts unchanged pixels outside its projected permission mask before encoding. The three candidates apply up to 35% or 100% registered RGB difference, or 35% high-frequency difference. Those are detail weights, not identity strengths. Confidence, visibility and inward feathering reduce the actual contribution. Closed/hidden eyes and untrackable faces retain the v4 frame.

| Existing clip | Frames | CPU wall time for three variants | Frames with no eye edit |
| --- | ---: | ---: | ---: |
| Hair across eyes | 355 | 287.517 s | 17 |
| Later-reference continuity | 216 | 165.067 s | 13 |
| Portrait and hand occlusion | 240 | 202.260 s | 36 |

These CPU times include parsing, registration, compositing and three encodes; the first also ran alongside a separate CPU still study. They are not GPU timings or complete Generate times. All original uncertain-face frames remain unchanged before compression, including the ten portrait frames retained by v4. Independent patch reconstruction verifies each saved pre-encode frame hash; export checks verify decoded timing/count, final file hashes and original audio packets.

In the main clip, RGB100 gives some additional iris definition at frame 98. The blink/brow/edge intervals and normal-speed playback were checked against v4. This is a modest detail change; it does not establish exact gaze or likeness. The other complete clips are available for review, with their source-motion event buttons. No native-eye candidate has replaced the production compositor.

A separate nine-frame study uses the official FaceFusion CodeFormer ONNX file, pinned revision `728b9659bd9691bf32cbf7f61af478d94b7ba81e`, SHA-256 `21710e7ab61c82683576c428e9c1b6fe1ed419586b7b39e394c3449c294b550f`. The 376,951,650-byte file was downloaded only into this Mac's ignored evaluation cache. There is no GPU model transfer or new product download requirement. The experiment uses FFHQ-aligned 512-pixel faces and fidelity weight 1.0; the upstream model exposes a quality/fidelity trade-off rather than an identity guarantee. See the [official CodeFormer instructions](https://github.com/sczhou/CodeFormer#testing) and [FaceFusion enhancer implementation](https://github.com/facefusion/facefusion/blob/master/facefusion/processors/modules/face_enhancer/core.py).

The nine CodeFormer stills took 108.063 seconds on CPU, with 8.017–10.075 seconds per restoration-model call. Eye-only 35% and 70% blends sharpen some pupils; the stronger blend can look brighter or glassy. A 25% face-wide comparison smooths appearance. These are still-only findings; temporal stability and GPU latency have not been measured. None is enabled in the product.

The third study changes only the identity inference resolution: the current interleaved 512-pixel route versus one native 256-pixel pass, with or without retained input detail. It keeps the source, donor, saved calibration, 60% identity blend and compositor fixed. Nine still comparisons took 163.090 seconds on CPU. Four available control images match the previous actual CPU baseline exactly. The native 256-pixel route is softer in the inspected frames; adding input detail does not demonstrate a clear improvement. The existing identity path stays unchanged.

The viewer now separates still studies from full video candidates, loads its fourth video only when requested, releases media on page exit, and reports the failing media panel when decoding fails. Its JavaScript syntax and three-/four-panel playback were checked. Media remain loopback-only and ignored. See the [sanitized detail-study record](validation/facial-eye-detail-20261030.json). No additional GPU session was started for these studies; five-minute idle pause remains enabled. The wider goal remains active: likeness, exact gaze, closure and fine texture are still imperfect.
