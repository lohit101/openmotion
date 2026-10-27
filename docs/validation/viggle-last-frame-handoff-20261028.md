# Previous-frame appearance handoff — 2026-10-28

The user requested that each continuation use the preceding segment's last generated frame as its appearance reference. The earlier workflow already pinned five prior frames as motion continuity but reused the original supplied frame for appearance. The new default separates these two roles.

For the 14.5-second comparison (zero-based source indices):

| Segment | Appearance reference | Motion anchor |
| --- | --- | --- |
| 1 | User-prepared frame | None |
| 2 | Last raw frame of segment 1: 123 | Frames 119–123 |
| 3 | Last raw frame of segment 2: 242 | Frames 238–242 |

The feature uses `last-frame-v2` checkpoints and a small reference-loader node. Older `five-frame-v1` jobs remain unchanged. Advanced settings retains **Original prepared frame**, and Reuse settings infers the actual saved policy for older jobs that predate the settings field. Segment reference previews are saved and linked in run details; failed optional previews never cause a paid render to be resubmitted.

For unusual final overlaps larger than five frames, the actual last accepted frame is stored separately; the tail of the five-frame anchor would refer to the wrong source time. Normal overlaps reuse a pixel tensor already present in the checkpoint, so there is no duplicated reference-frame tensor. No model, LoRA or extra sampler pass was added.

## Checks

- After preserving and merging the concurrent shared-Vast-credentials changes, the full combined app suite passed **291 tests across 24 files**, including historical Reuse settings behavior. TypeScript and the merged production build passed.
- Python suite: 90 checks, 27 optional-environment skips. Real ComfyUI CPU validation and tensor checks passed, including both five-frame and 107-frame overlaps, exact last-frame extraction, strict job/version/offset validation and unchanged motion-anchor tensors.
- The thirty-second protocol case verifies the new reference node, per-segment reference downloads, native 24 fps and exact frame/audio assembly. Protocol media remains FFmpeg passthrough, not a model-quality evaluation.

## Controlled GPU comparison

The recovered original-reference run `c34fc566-c480-4f17-a526-36e5d4f829c9` is preserved as the baseline. The separate comparison `1530a7b9-6f4b-4004-bfa0-4ea2d9ea1619`, titled **Previous-frame handoff / 14.5s comparison**, reuses its already paid first 124 frames. This provenance is shown in run details rather than presenting the prefix as new inference. The exact raw continuation tensor was cloned with the new job/version metadata, and its RGB payload was preserved. Source, seed, five-pass quality, dimensions and frame rate remain matched.

On the real A100 PCIe 40 GB, segment two completed. Its saved appearance PNG matched the previous segment's last raw frame **pixel-for-pixel**, with maximum difference zero after the normal PNG quantization. A synchronized source/baseline/new frame review at the first join showed smooth placement and no obvious identity discontinuity in the sampled frames. Both modes looked coherent there; this does not establish a universal quality improvement or a numerical identity score.

The comparison completed successfully: **348 frames, 14.500 seconds, 1248×704, native 24 fps and one source audio track**. Both actual saved appearance PNGs matched their previous raw frame pixel-for-pixel after PNG quantization: source frames **123** and **242**, maximum difference **0**. This verifies the reference handoff, not the identity accuracy of newly generated frames. The first paid MP4 remains byte-identical to the baseline prefix. The GPU was confirmed stopped after both queues emptied.

At ending frame 347, the new version followed the source's close, turned head pose more closely; the original-reference version had returned toward the starting product pose. However, the new output also regained the source person's forehead mark, which is absent from the prepared reference. Local motion continuity improved in this sample, while appearance leakage remains. Do not describe this as flawless identity or a complete visual-quality pass.

Raw evidence and private contact sheets stay in ignored `backups/last-frame-handoff-20261028/`.

The handoff can improve local pose, exposure and appearance continuity, but it can also carry generation errors forward. It is not a guarantee of flawless identity, especially through occlusions, full turns or cuts. Keep the baseline and the original-reference option for comparisons.
