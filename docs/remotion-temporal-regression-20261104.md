# Rejected fixed-avatar face experiment

The user rejected the temporal result: the face cutout flickers and changes scale, and facial features cross a foreground hand. The fixed-avatar experiment is a regression, not an accepted facial-consistency recipe. Still-frame likeness improvements did not establish video quality. No production identity recipe, user draft, historical graph or paid original was changed.

## What was compared

Five small fixed-geometry probes used six individual views from one saved character's face sheet, existing PerformRecast/ONNX dependencies, and saved hand-covered and turning clips. A fixed canonical face, reference appearance features and source-driven expressions can look closer in selected stills, but this is not sufficient for temporal acceptance.

The final temporal test finished 73 hand-covered frames and 240 turning frames. It separately created a 73-frame driving video with its visible face replaced before Viggle. Eight uncertain hand-covered frames were preserved; every turn frame was processed. The combined worker took 194.197 seconds, excluding setup/upload/model initialization; that includes the two hand outputs, the turn output and their exports, not complete Generate latency.

One matched five-pass Viggle render then changed the driving video to that face-replaced input, retaining the earlier seed and repainted opening reference. All 73 frames were saved. Observed submission-to-save time was 85.667 seconds, including cold execution; this is not a steady-state speed comparison. Source motion still differs, and the pre-swap did not establish a solution. A separate three-pass same-reference comparison also retained hand artifacts and was rejected.

## Concrete failure mechanisms

1. **Reference selection has discontinuities.** The experimental renderer blends only its two closest views. When the second-nearest view changes, approximately 34–48% of the feature mixture can change at once. Saved temporal receipts show 13 view-set transitions across both clips, including one acquisition from no face; several turn-video transitions reverse within a few frames. A fixed canonical point set does not prevent appearance or apparent shape from changing through this mixture.
2. **Placement is still estimated independently.** The crop, motion scale, translation and mask are rebuilt for every frame. The crop itself depends partly on mouth landmarks. They have not been validated as a stable head track under occlusion or fast expressions. Reference switching is confirmed; the contribution of each placement estimate still needs a separate audit.
3. **Feature ownership can override occlusion.** `feature_masks` currently combines visibility with detected eyes/lips using a maximum. A feature classification can therefore bypass an occlusion veto. Jaw support can also expand permission. That is unsafe when foreground skin is misclassified as facial skin or a feature. An assertion that pixels outside the resulting mask stay exact proves compositing compliance, not that the mask correctly protects the real hand.
4. **Foreground correctness and base motion remain separate.** The animation already has gesture timing differences. Clamping a face residual cannot repair a missing or misplaced generated hand. The rejected source-RGB overlay approach was not restored.

A local YuNet diagnostic found median absolute second differences in the output/raw eye-spacing ratio of 0.04144 for the accepted finish versus 0.06341 for the fixed-bank candidate over this 73-frame clip. Over the clear-face tail they were 0.02506 and 0.03246. These noisy image-space measurements corroborate rejection; they are not identity scores, perceptual quality metrics or a substitute for video review.

## Corrections prepared, not released

An unregistered experiment now computes continuous weights across all reference views, avoiding a hard nearest-two membership change. A separate conservative visibility ceiling prevents semantic features from granting permission over an occluder. Eight CPU checks cover continuity, order invariance, finite inputs, foreground vetoes and no mask growth. These checks do not establish correct real-world hand segmentation or stable facial geometry.

A local CPU XSeg diagnostic reused all 73 existing frames in 10.987 seconds with one inference thread and existing weights. Conservative caps protect classified foreground pixels, but sampled results still have visible limitations. **A stricter mask alone is not a quality pass.** No corrected identity recipe was enabled. Next validation must inspect consecutive frames and full playback, measure actual visible hand overlap, and validate head placement independently before resuming broad likeness tuning.

The native application did not successfully open the new comparison in this session; the Open panel stayed unchanged. Decoded frames, dense timelines and image-space diagnostics were reviewed. Do not describe this as a successful complete native playback review.

## Timing validation and preservation

The higher-resolution facial driver is decoded from the original media at the saved start and 24 fps. The initial worker stopped when an exact anchor check found a Mac/server decoding difference. Independent checks found a maximum difference of two RGB levels and a median of one, with the same frame content. The correction records that bounded difference explicitly; it does not claim pixel identity or alter source timing. The failed attempt and its partial frame receipts are retained separately.

Private inputs, face references, sample outputs, FFV1 masters, frame hashes, worker logs and native prompt history remain under ignored `.local/remotion-geometry-20261104/` and `.local/remotion-bank-video-20261104/`, with full frame caches also on the retained disk. The [sanitized receipt](validation/remotion-temporal-regression-20261104.json) contains timing, hashes and rejection reasons without publishing face references or embeddings.

Only the previously authorized A100 #58966215 was used. There was no new rental, model download or runtime install. The private workers and native render completed before pausing. Independent provider refresh confirmed exited/stopped with `computeStopped: true`; five-minute idle pause is enabled. The quality goal remains incomplete. The earlier reported ~$0.74 compute applies only through the prior evaluation's confirmed stops; this continuation adds usage, and no final provider invoice total is claimed here.
