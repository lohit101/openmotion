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

The viewer separates still studies from full video candidates, loads its fourth video only when requested, pauses on page exit, and reports the failing media panel when decoding fails. Its JavaScript syntax and three-/four-panel playback were checked. Media remain loopback-only and ignored. See the [sanitized detail-study record](validation/facial-eye-detail-20261030.json). No additional GPU session was started for those initial CPU studies. The later GPU follow-up below has its own timing, transfer and stop record. The wider goal remains active: likeness, exact gaze, closure and fine texture are still imperfect.

## Full-video restoration and source-eye placement follow-up

The next study reused the same 811 lossless managed v4 frames, chronological source videos and fixed donors. It did not submit another Viggle or Imagen generation. These are separate private post-processing candidates, not changes to `source-face-v4`, its fingerprint, Studio defaults or saved user preferences.

The CodeFormer file from the earlier CPU still study was explicitly copied to the existing A6000's private evaluation cache. It remains outside the product model manifest. CUDA execution was required for the restoration model and existing parser. Two complete eye-only exports, at 35% and 70% restoration contribution, used the same fidelity weight 1.0 and source-visible/occlusion gates. A quiet CPU control exactly reproduced the earlier saved still outputs before the GPU run.

| Existing clip | Frames | GPU post-pass for both variants | Restoration-model calls | Modified / retained uncertain |
| --- | ---: | ---: | ---: | ---: |
| Hair across eyes | 355 | 69.156 s | 17.416 s | 334 / 0 |
| Later-reference continuity | 216 | 42.944 s | 10.670 s | 202 / 0 |
| Portrait and hand occlusion | 240 | 33.996 s | 10.762 s | 204 / 10 |

These times include the separate post-pass and two encodes, not Generate latency. Frames without an eligible eye edit are also retained. Independent reconstruction checked all pre-encode frame and patch hashes, output frame counts, decoded timing and copied original audio. Exact protected pixels refer to the frames before lossy MP4 encoding.

The 35% variant gives clearer iris detail in the inspected main frame 98 without restoring the detached brow or doubled eyelid. The 70% variant can look too bright or glassy, and full-face restoration was already less convincing in the earlier still study. Restoration alone does not correct the source-to-output glance mismatch; it can move the apparent iris position slightly. This is a quality/fidelity trade-off, not an identity lock.

The session began at 04:54:20 UTC. Its first stop request returned an unconfirmed HTTP 400; an independent provider refresh subsequently confirmed the exact instance `exited` / intended `stopped` at 05:04:27 UTC. The conservative start-to-confirmation compute estimate is $0.07864 at the saved existing-host rate, plus transfers and storage. It is not an invoice or a per-clip price. The original five-minute idle preference was restored. Hash-verified duplicate evaluation archives were released remotely after recovery; original paid animations, model files and local evidence were preserved.

A separate isolated CPU environment on this Mac then tested image-space iris placement using the official [MediaPipe Face Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/python). Its 3,758,596-byte task bundle is pinned by SHA-256 `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`; it was not added to Studio or the GPU runtime. Eye coordinates are estimates, not measured gaze angles. Source RGB is never copied into the replacement eyes.

The first simple displacement prototype could fold the eye interior and was rejected. Private `iris-flow-v2` instead integrates a bounded velocity field inside the current character's eye interior, fixes the eyelid border, samples its RGB only once and rejects unsafe inverse Jacobians. It keeps current source blink/visibility gates and the original uncertain-face fallbacks. Full CPU exports took 56.884 / 34.884 / 24.638 seconds for the 355 / 216 / 240-frame clips, each including two candidates and two encodes. All 811 frame/patch hashes, timing and audio were independently checked. The sampled side glances move closer to the source, but inspection found an isolated landmark-driven wobble near main frame 219. This version remains an experiment.

The follow-up private temporal test uses a three-frame median of the corrective residual only when all three observations for that eye are clear and open. It retains the current frame's blink gate and skips temporal reuse across uncertain or closing eyes. A monotonic step or ramp keeps its current-frame value; a one-frame outlier is suppressed. Five synthetic checks cover those cases, immutable observations and ambiguous current frames. This is an image-space correction, not 3D gaze recovery.

| Temporal test | Frames | CPU wall time for both variants | Changed v4 / restoration base | Retained uncertain |
| --- | ---: | ---: | ---: | ---: |
| Hair across eyes | 355 | 57.500 s | 321 / 320 | 0 |
| Later-reference continuity | 216 | 35.511 s | 180 / 186 | 0 |
| Portrait and hand occlusion | 240 | 25.351 s | 164 / 158 | 10 |

Both candidates again passed independent reconstruction of all 811 pre-encode frames, final timing/count/audio checks and the fixed eye-permission assertions. The saved main-frame 217–221 comparison shows less isolated corrective wobble than v2; continuity 171–175 and portrait 222–226 retain their blink progression. This does not prove accurate eye motion in every frame. Some glance mismatch, softness and the earlier mouth-closure discrepancy remain.

The private page groups versioned finishes, eye-movement tests, restoration tests and native-detail tests. Candidate A starts at the actual managed v4 finish; Candidate B starts at **Source eye movement + clarity · temporal test**. Each still strip identifies whether it comes from a CPU still experiment or a full-video candidate. Normal-speed four-panel playback reached frames 354 / 215 / 239, with the issue frames, opening side glance, blink strips and covered portrait frame sampled visually. This is not a claim that every frame passes a realism review. Navigation pauses playback without resetting every decoder during page teardown. A fresh navigation successfully loaded the page; app/user tabs, Studio jobs and drafts were untouched.

Complete-video evidence, timings and review decisions are recorded in the [sanitized follow-up record](validation/facial-eye-restoration-20261030.json). No experimental restoration or iris-flow candidate is enabled in production. Further work must preserve the frozen v4 recipe and paid originals rather than silently changing their compositor.
