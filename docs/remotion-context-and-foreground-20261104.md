# Remotion context and foreground evaluation

The new short-clip controls improve the observed hand timing, but **Remotion has not passed the requested quality standard**. The fixed studio-face experiment still has expression, lighting and boundary problems. No experimental face recipe or temporal-context policy was enabled in Studio.

The user capped this goal at **$2 total usage**. The conservative allocation after independently confirmed compute shutdown is approximately **$1.9924**, including transfer and overnight storage reserves. This is an upper allocation rather than a provider invoice. Do not resume paid testing for this goal under the remaining allowance. Continue independent local work; a future paid phase requires a new budget. The existing retained disk is preserved.

A subsequent ledger review removed one duplicated pre-start minute, revising the conservative allocation to **$1.98155** with both reserves unchanged. This does not authorize further paid testing. See the [local geometry follow-up](remotion-local-geometry-20261104.md).

## Short-context motion failure

The original three-second evaluation used 73 real frames at 24 fps. Two 124-real-frame controls retained precisely the same decoded first 73 source frames, the same opening repaint, and the published three-pass schedule. Both seeds followed the early hand turn substantially more closely. The 73-frame three-pass comparison still had the delayed/doubled hand, so the difference is not explained by adding sampler passes.

Inspection found an actual source cut at frame 83. The real-context tests therefore cannot justify conditioning across shots: identity deteriorates after that cut. A separate control removed this confound by retaining the same first 73 real frames and explicitly repeating frame 72 for the remaining 51 context positions. Only the real first 73 output positions are evaluated; the repeats are private synthetic context, not new footage or recovered paid frames.

| Observation | 73-frame, five-pass baseline | 124 real frames, seed 42 | 124 positions, explicit end hold |
| --- | ---: | ---: | ---: |
| Early palm-angle absolute error | 11.02° | 1.88° | 3.06° |
| First observed crossing of −50° | frame 17 | frame 8 | frame 8 |
| Source crossing | frame 9 | frame 9 | frame 9 |

These are partial, detector-dependent image-space observations with different numbers of valid detections, not complete motion or quality scores. Same seed across different tensor shapes does not mean identical sampled noise. The held-context result remains visibly different from the real-context render. Blink and mouth correspondence still fail some sampled frames. The evidence supports another controlled context study, not a universal minimum-length policy or silent padding of future jobs.

The two real-context native prompts took 90.111 and 53.611 seconds; the held-context prompt took 90.013 seconds. These include native pipeline execution and differing cache/load states. They are not comparable steady-state end-to-end Generate benchmarks.

## Face shape, foreground and lighting

The facial motion model emits three scale components. In the original hand test, the inferred X/Y ratio changed from about 0.912 to 1.013. Fixing canonical keypoints alone therefore does not fix face width. The private reference-geometry experiments used continuously interpolated reference-view ratios while retaining target global placement. Rendered and requested X/Y ratios agree within 1.2e−7; this proves a control invariant, not identity fidelity.

A whole-shot fixed viewport was rejected because movement away from its center distorts the face. A normalized facial crop is still required. Hard nearest-view appearance switching remains rejected. Geometry, appearance, facial edit permission and scene-space foreground are cached separately so compositing can be studied without rerunning video inference.

Official SAM 2.1 Hiera Tiny was evaluated privately with OpenCV Zoo palm/hand detectors. The new local files total about 164 MB; there was no production catalog change or implicit app download. Several landmark-derived seeds failed before facial processing, demonstrating that high hand-detection confidence does not validate individual fingertips. The selected old-clip tracking test took 11.329 seconds and protected the rendered hand in the final scene coordinates. Six manually reviewed hand/forearm cores and selected boundary points had zero changed pixels before encoding. These are sparse reviewed cores, not complete object ground truth. Protecting the generated hand also does not correct an earlier Viggle gesture error.

A new paid 73-frame prefix from the longer native control was then evaluated with two facial routes: fixed reference appearance, and current scene appearance plus fixed geometry and ONNX identity correction. Its first mask attempt stopped on a float/BFloat16 memory-cache mismatch. A separate private retry kept SAM memory features in FP32; its 73 masks completed in 10.883 seconds. The two full face renders completed in 64.993 seconds. Neither changed an existing paid output or production fingerprint. The scene-derived route retains more illumination but still has softness/gaze limitations; the studio route has stronger sampled likeness but a visible chin/neck contour and does not generalize its expression calibration.

An oversized SSH archive recovery timed out. The completed remote outputs were retained, and a bounded recovery retrieved 141 hash-verified files (19,537,924 compressed bytes), including both full MP4s, receipts, all mask PNGs and selected lossless layer/permission samples. Compute stop observation timed out once; an independent provider refresh subsequently confirmed exited/stopped. No new inference was used for recovery.

Private CPU ablations also examined source-coordinate iris adjustment, stronger scene-light matching, NORMAL_CLONE and multiband blending. Stronger low-frequency lighting matches pink scene illumination better than the existing ±7.8 RGB correction limit. It does not remove the geometric chin contour. NORMAL_CLONE creates a pale halo and is rejected; multiband only softens the contour. Exact masks do not prove good blending.

The fixed studio-expression variant loses a smile and creates an incorrect pout on five held-out turn frames, so it is rejected. The matched-scene expression variant retains those expressions better in stills. Its separate low-priority CPU temporal evaluation was subsequently stopped after 180 completed frames: a whole-face visibility bypass introduced an identity/expression pop. The preserved prefix is rejected, not a full-clip quality pass. A narrower 25-frame regional repair is documented in the [local geometry follow-up](remotion-local-geometry-20261104.md).

## Cuts and remaining scope

An offline 160-pixel FFmpeg scene scan found the hand clip's true cut at frame 83 and no candidate cuts in the tested continuous turn/back-facing clips; four scans took about 0.58 seconds. This is a small detector study, not validated automatic transition handling.

The current fixed-window segmenter and preceding-raw-frame face repaint cannot provide a new shot's appearance. A proper future shot plan must freeze source-bound ranges and character snapshots, prepare a fresh incoming-source repaint for each shot, use independent per-shot jobs, and retain bidirectional rendering when a later clear anchor is needed. No overlap latents or recursive appearance should cross a cut. Facial calibration belongs to each shot before chronological frame/audio assembly. That integration remains pending; do not describe cuts, hidden-face reappearance, full tracking or Higgsfield parity as solved.

All original jobs, source media, face sheets, rejected candidates and private receipts remain preserved. Frozen facial v1–v10 formulas and the user's drafts/defaults remain unchanged.
