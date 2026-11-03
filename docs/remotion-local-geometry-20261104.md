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

**This candidate is not selected.** It fixes the erroneous opening mouth and improves some late eyelid closure, but frame 6 adds an artificial frown, frame 12 misses the full source blink, and frame 20 retains a chin contour. The frame-12 eye-opening estimate itself is imperfect; source landmarks are not ground truth. A correct lip aperture or exact computed mask does not establish natural expression, realistic boundaries or facial identity.

Fixed canonical geometry does not guarantee fixed scene-space anatomy: this prototype still uses each raw target frame's scalar placement scale/translation and inverse 203-point crop. A cache-only audit nevertheless shows that the factors partly cancel rather than automatically doubling size errors. The target/source physical-gain curves correlate 0.940; their median-normalized discrepancy has a 5th–95th percentile range of approximately −1.90% to +2.57%. The largest discrepancies occur at the obscured, backward-estimated opening. These are scalar trajectory diagnostics, not ground-truth face-width or jitter scores. Gross double-scale inheritance is not established; yaw, translation, expression and matte stability still require separate assessment.

Independent review also found unmanaged model/cache assumptions and missing interruption/recovery provenance. The prototype is not ready for an experimental Studio control; a production route would need an isolated, versioned adapter and explicit model/runtime preparation before paid validation.

## Component speed study

Existing ONNX weights were benchmarked with CPU and CoreML on the Mac M5 with 16 GB memory. No runtime package or model was installed for this benchmark.

The PerformRecast decoder's warm median fell from 1.0156 to 0.1968 seconds, a **5.16× decoder-component improvement**. CoreML's compute plan assigns 209 decoder operations to GPU. Two real cached inputs have maximum float differences of 7.42e−6 and 4.89e−6; after RGB conversion, 38 and 26 of 262,144 pixels differ by at most one channel value. This is close numerical parity, not byte-identical rendering.

This does not make the complete facial pipeline 5× faster. Warping and other processing remain outside that measurement, and cold compilation/prediction are separate costs. The motion-model CPUAndNeuralEngine setting planned every operation on CPU; no ANE execution is claimed. The current quality comparisons keep their original CPU route to avoid confounding algorithm and provider changes.

## Remaining acceptance requirements

The local tests explain several regressions and provide narrower alternatives. They do not establish Higgsfield parity or universal identity lock. Before a production recipe is selected, it needs moving comparisons across simple and complex continuous shots, accurate source mouth/eye/expression transfer, stable jaw and scene edges, regional foreground protection, and explicit behavior when a face is hidden or ambiguous. Cuts require independent shot appearance and calibration; this phase does not add that orchestration.

All original and rejected evidence remains preserved. See the [sanitized validation receipt](validation/remotion-local-geometry-20261104.json) for measured results and scope.
