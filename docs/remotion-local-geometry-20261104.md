# Remotion local face geometry and visibility evaluation

This phase continues the [context and foreground evaluation](remotion-context-and-foreground-20261104.md) without further rental use. It has **not established a general quality pass**. Existing Studio defaults, facial v1–v10 formulas, historical outputs and user drafts remain unchanged.

The same rental remains confirmed stopped. A ledger review removed one duplicated minute before an already-stopped native-control start request. The revised conservative allocation is **$1.98155 of the $2 cap**, retaining the $0.05 transfer and $0.08 overnight-storage reserves. This is an allocation, not an itemized invoice: provider daily billing includes earlier user work. The correction does not authorize another paid resume or transfer. All work described below runs on the existing Mac or reuses already-recovered evidence.

## Whole-face fallback caused an additional visible pop

A matched-scene face experiment was stopped after 180 completed frames because its whole-face visibility/hand-box gate introduced a visible identity and expression switch. Frames around 138–146 fell back to the unprocessed animation; processed facial appearance returned at 147. The partial result and its frame hashes are preserved. It is not a completed 240-frame comparison or an accepted recipe.

A separate 25-frame comparison, covering absolute frames 130–154, removed that whole-face bypass while retaining per-pixel XSeg permission. An independently tracked native-hand mask was applied last in scene coordinates. Nineteen facial frames were newly rendered and six were reused exactly; the CPU worker took 157.661 seconds. All 25 decoded PNGs retain exact native pixels under the computed hand veto, and pixels outside the additional veto remain unchanged from their parent layer.

The moving comparison removes the binary face switch at 146→147. This is a narrow repair to the fallback policy, not proof of natural face geometry or complete hand segmentation. At frames 138 and 142, the additional SAM veto changes only 59 and 121 pixels respectively; XSeg already protected most of the overlap. The improvement cannot be attributed entirely to SAM.

Applying a whole-face XSeg ceiling also risks clipping legitimate jaw motion. A cache-only attempt to restore approximate jaw support produced a diagonal/doubled chin and was rejected. A correct follow-up needs the original pre-ceiling alpha, aligned edited face, semantic labels and jaw-support plane saved separately; those cannot be recovered exactly from the composited scene layer.

## Cropper and local foreground checks

The official PerformRecast 203-point cropper was compared against the private 68-point route. The crop utility and landmark runner match [PerformRecast](https://github.com/youku-aigc/PerformRecast) revision `0206abf3ba9e5b1eaa3cdc584879d5fa20d6a0b4` byte for byte. Its one additional landmark model was downloaded locally, not installed in the app or transferred to the rental. It is 114,666,491 bytes; its hash and source revision are recorded privately.

Across the old 73-frame native clip, the official cropper reduced three crop-trajectory diagnostics: median log-side second difference from 0.01019 to 0.00631, center second difference from 4.67 to 3.89 pixels, and rotation second difference from 0.523° to 0.301°. These are crop-motion diagnostics, not ground-truth alignment or identity scores. Actual six-render comparisons at frames 12, 43 and 65 look similar; no still-image winner or temporal quality pass was established.

Source frames 0–7 required backward landmark propagation from a genuinely detected clear frame 8. Hidden-eye points can still fall on the hand. A valid landmark record therefore does not establish that the corresponding feature is visible.

Private SAM 2.1 tracking on the Mac's MPS device completed 25 native turn frames in 36.489 seconds and all 73 prepared source frames in 62.335 seconds. The private FP32 memory-cache adjustment avoids the earlier float/BFloat16 mismatch without altering the original model or production source. The source and target masks are bound to their own decoded-video hashes; they are not interchangeable.

Source visibility measurements show why regional control matters: the right eye is fully covered at frame 0 while the left is visible. The mouth is only partly covered, with about 12.6% computed overlap. At frames 48 and 65, all audited facial regions are clear and the measured mouth-opening ratios are 0.0018 and 0.0030. These masks provide feature-confidence evidence, not a replacement for visual review or complete segmentation ground truth.

## Fixed-portrait LivePortrait alternative

Earlier local LivePortrait trials used changing generated appearance. This phase instead fixes one approved scene portrait and its identity geometry, then drives facial motion from the exact prepared source video. The official [LivePortrait](https://github.com/KwaiVGI/LivePortrait) transform uses 21 points, a scalar scale and expression outside the rotation. The FaceFusion ONNX generator's input names also require care: `source` receives desired points and `target` receives original points.

Existing feature, motion and generator weights are reused. Three small official retargeting/stitching models add 925,702 bytes locally, with pinned source/model receipts. No app download, rental transfer or production dependency was added.

Initial stills exposed two failures. Lip normalization alone retained an incorrect open mouth on a closed-mouth source frame. Global stitching closed it but introduced a large head-position shift; that bundled variant was rejected. A regional experiment replaces only oral Y/Z movement with the lip-opening model's correction, retaining horizontal expression and the prior source-driven eye/brow controls. It generates one oral cavity, without blending two separately generated mouths in RGB.

Three stills at frames 0, 48 and 65 completed in 15.454 seconds. The incorrect open mouth closes without the stitcher's global shift, and the two clear closed-mouth frames remain closed. Frame 0 explicitly uses an unvalidated neutral-closure fallback under partial mouth occlusion; it is not measured phoneme transfer. Lip opening alone cannot distinguish every phoneme, pucker, tongue position or teeth configuration. Eye-opening control likewise does not establish accurate gaze.

A full 73-frame temporal comparison then completed in **389.049 seconds on CPU**. It uses the newer 124-frame-context native prefix and its own hand masks. The four-column moving artifact compares the exact prepared source, that native video, the same-body fixed-PERC experimental route and the fixed-LivePortrait candidate. The older copied `current-finish` file belongs to the old 73-frame body and is not a valid same-body finishing baseline.

The temporal recipe refines the stills' visibility rules: central lip-support points determine whether opening is measurable, so frames 6–7 retain their measured opening rather than inheriting a whole-mouth fallback. Hidden-eye point controls return to the fixed-reference baseline in all XYZ coordinates. Coupled point 18 retains ordinary LP expression unless both eye-opening estimates are available and symmetric; this is not complete disentanglement of hidden facial motion.

All 292 output/crop/layer/control hashes were independently checked. All 73 pre-encode frames retain exact computed native-hand pixels and exact pixels outside final alpha. The 144 source audio packets match timestamps, durations and data hashes. The synchronized video was opened and played to its final frame in native QuickTime; contact sheets and source controls were also reviewed.

**This candidate is not selected.** It fixes the erroneous opening mouth and improves some late eyelid closure, but frame 6 adds an artificial frown, frame 12 opens the eye more than the visible near-closed source, and frame 20 retains a chin contour. Pixel review cannot establish an exact frame-12 aperture ratio; source landmarks are not ground truth. A correct lip aperture or exact computed mask does not establish natural expression, realistic boundaries or facial identity.

Fixed canonical geometry does not guarantee fixed scene-space anatomy: this prototype still uses each raw target frame's scalar placement scale/translation and inverse 203-point crop. A cache-only audit nevertheless shows that the factors partly cancel rather than automatically doubling size errors. The target/source physical-gain curves correlate 0.940; their median-normalized discrepancy has a 5th–95th percentile range of approximately −1.90% to +2.57%. The largest discrepancies occur at the obscured, backward-estimated opening. These are scalar trajectory diagnostics, not ground-truth face-width or jitter scores. Gross double-scale inheritance is not established; yaw, translation, expression and matte stability still require separate assessment.

Independent review also found unmanaged model/cache assumptions and missing interruption/recovery provenance. The prototype is not ready for an experimental Studio control; a production route would need an isolated, versioned adapter and explicit model/runtime preparation before paid validation.

## Unchanged production-finisher control

Four additional CPU stills apply the existing `source-face-v10` Standard + ONNX 60% functions to the newer native body. The source, clear donor, frozen eye-calibration model, code and model files are bound to the original evaluated recipe. CPU recomputes the embedding from the same donor; this is a numerical recipe replay, not byte-identical CUDA parity.

The original GPU's decoded source-anchor bytes are unavailable. Local OpenCV and multiple FFmpeg variants do not reproduce its recorded raw BGR hash. Cached registration differs from the old affine by at most 0.332 scene pixels at the audited corners/center, supporting similar placement without proving pixel equivalence. The mismatch remains recorded rather than silently rewriting the calibration receipt.

The four-still worker takes 21.994 seconds: frames 0 and 6 retain the raw target because the original source-face detector is uncertain; frames 12 and 65 refine in 10.744 and 9.954 seconds. Frame 12 closes the visible eyelid more convincingly than the LP candidate, and frame 65 retains a plausible sampled glance. These two stills do not establish mouth/teeth or temporal fidelity. The skipped opening frames still miss a physically visible source eyelid closure, exposing a regional-visibility gap in the existing whole-face gate.

A separately labeled final target-SAM veto changes seven pixels at frame 12 and none in the other three stills. It preserves all computed hand pixels, but does not recover the missed visible-eye performance. It is not part of the unchanged production baseline.

The source-event audit separates observed visibility from predicted aperture and gaze. In particular, a hidden eye's positive landmark opening is not observed movement, and similar opening ratios at frames 48 and 65 do not describe their different iris gaze. These observations are evaluation labels, not frame-number-specific production rules.

## Partial-source eye fallback and feature ownership

An attempted 68-point fit inside a backward-tracked source ROI was rejected before either requested face generator ran. At frame 6 it placed an open eye approximately 17.64 pixels above the observed closed eyelid. A returned landmark set is not sufficient evidence for a valid partial face.

A separate two-generator probe instead cross-calibrates the tracked 203-point source crop to the real clear-frame-8 ArcFace crop. It passes actual cropped source pixels to the existing calibrated PERC/ONNX functions, without inventing a primary detection or a 68-point face. The target keeps its real primary alignment. These two CPU generators take 20.984 seconds.

The full frame-6 prediction closes the visible eye without the LP frown. Its first eye-only composite nevertheless leaves the old upper lashes around the new lid: a complete generated feature needs permission over both its old and new footprint. Two cache-only orbital-mask studies preserve the original XSeg and final target-SAM veto while moving the feather into surrounding skin. The final still no longer has an obvious detached lash line. The frame-0 prediction still differs from the source's partial opening/gaze; this mask repair cannot correct model performance.

A short temporal prefix then reuses the same recipe and cached predictions. An unintended 80% occlusion-admission threshold initially skipped partially covered frames and introduced a route switch; that prefix is preserved as rejected gate evidence. The corrected formula uses computed positive same-source hand overlap with tracked facial feature support, a clear edited-eye support, a valid target face and bounded tracked ROI. Manual source-event labels are not runtime inputs. The corrected eight unique frames recover closure through frames 4–7 without the earlier gate pop in the inspected contact/native playback. A repeated preview contains only those eight unique frames and adds no temporal coverage.

The corrected test subsequently completed all 24 unique frames. Frames 0–7 use the computed-occlusion visible-eye fallback; 8–23 use the unchanged primary v10 route. All 96 PNG hashes, 48 source/raw decoded-pixel comparisons, computed native-hand pixels and the respective outside-permission checks passed. Twenty-one new generators were needed across the original and corrected processes, with exact reuse of the previously rendered frames 0, 6 and 12. Their frame timers total 209.133 CPU seconds. The corrected process's 350.504-second wall time includes a human-review checkpoint wait and is not an inference-speed benchmark.

The synchronized one-second comparison was opened and played to its final frame in native QuickTime; a four-repeat preview adds no unique-frame coverage. The visible opening closure improves without an obvious detached lash/frown in the reviewed interval. The switch into full primary correction changes a much larger face area and still needs broader temporal assessment; the source/native pose also changes there. Frame 0's partial opening and frame 23's asymmetric aperture remain imperfect.

A separate continuation then completed all **73 real frames**, retaining the original 96 prefix PNGs unchanged. It used 48 new CPU generators and exactly reused the existing primary frame 65. Active continuation time is 508.567 seconds, excluding a 42.151-second lighting-review pause; this is local CPU work, not GPU or end-to-end Generate latency. All 292 PNG hashes, 146 source/raw decoded comparisons, prefix hashes and respective hand/outside-permission checks passed. The final route count is eight regional fallback frames and 65 primary-v10 frames.

The completed 3.041667-second comparison and four singles contain one unchanged **68-packet original native-source AAC prefix**. It is distinct from the prepared-source audio used in the earlier 144-packet diagnostic. A combined encode initially stopped one audio packet early; a separate packet-preserving remux fixes the final previews without new inference or PNG changes. AAC/container duration is 3.043220 seconds because of packet/timescale rounding. No video frames were padded or invented.

The full synchronized video was opened and played through its final frame in native QuickTime. Sampled pink-light frames retain scene illumination, and the new opening does not have the earlier detached lash/frown. Partial opening, exact gaze, asymmetric eyelids and mouth/jaw correspondence remain imperfect. This is one short continuous shot, not a speech, long-turn, cut or reappearance quality pass. It is not an enabled Studio recipe. The underlying native prefix comes from the earlier real-124-frame control that also conditioned on a later source cut; this face comparison holds that body fixed and does not validate a universal short-context policy.

## Prepared native shared-anchor comparison

A private native experiment is also prepared without inference. It starts from the approved clear source frame 36, generates earlier motion in reverse, then generates later motion with an explicitly shared chronological prefix. The reverse input contains 37 real frames followed by 87 marked hold positions; the forward input contains source frames 32–72 followed by 83 marked hold positions. Both use 124 model positions. No synthetic tail is accepted as source footage.

The proposed bridge converts reverse outputs `[4, 3, 2, 1, 0]` into forward local positions `[0, 1, 2, 3, 4]`, representing original source frames 32–36. It re-encodes chronological pixels; it does not reverse or recover native sampler latents. A new envelope binds original reverse history, graph, context and frame hashes to the forward job, preserving the original reverse receipt. The existing five-frame/two-video-latent pinning math is reused under a new local clock. Directly treating global source offset 32 as an encoded-v3 continuation is invalid.

Eighteen CPU checks cover lineage, masks, frame mapping and synthetic media assembly. The actual-source mechanics test reproduces all 73 original decoded frames once, one anchor and all 144 source audio packets. It is not a generated-video result. A separate matched-control package has nine checks: the unpinned forward graph changes only the bridge node/sampler latent wire and unique artifact prefixes. It reuses the same reverse render for both assemblies and keeps all other source/reference/model/seed/sigma inputs equal.

Three actual native calls would be needed for that causal comparison. The reference portrait corresponds to source frame 36 while both forward source windows start at 32; this any-frame-reference offset is a shared startup-pose confound. Native continuity, source performance and quality must be observed rather than inferred from the protocol checks. The package is unregistered, unsubmitted and has no further paid authorization under the present cap. Two-direction rendering increases compute relative to one forward render; no speed improvement is claimed.

## Component speed study

Existing ONNX weights were benchmarked with CPU and CoreML on the Mac M5 with 16 GB memory. No runtime package or model was installed for this benchmark.

The PerformRecast decoder's warm median fell from 1.0156 to 0.1968 seconds, a **5.16× decoder-component improvement**. CoreML's compute plan assigns 209 decoder operations to GPU. Two real cached inputs have maximum float differences of 7.42e−6 and 4.89e−6; after RGB conversion, 38 and 26 of 262,144 pixels differ by at most one channel value. This is close numerical parity, not byte-identical rendering.

This does not make the complete facial pipeline 5× faster. Warping and other processing remain outside that measurement, and cold compilation/prediction are separate costs. The motion-model CPUAndNeuralEngine setting planned every operation on CPU; no ANE execution is claimed. The current quality comparisons keep their original CPU route to avoid confounding algorithm and provider changes.

## Remaining acceptance requirements

The local tests explain several regressions and provide narrower alternatives. They do not establish Higgsfield parity or universal identity lock. Before a production recipe is selected, it needs moving comparisons across simple and complex continuous shots, accurate source mouth/eye/expression transfer, stable jaw and scene edges, regional foreground protection, and explicit behavior when a face is hidden or ambiguous. Cuts require independent shot appearance and calibration; this phase does not add that orchestration.

All original and rejected evidence remains preserved. See the [sanitized validation receipt](validation/remotion-local-geometry-20261104.json) for measured results and scope.
