# Adaptive speaking-jaw blending

The 14.83-second pink-room result exposed a compositor defect: PerformRecast lowers the chin as the source mouth opens, and the fixed-donor identity pass retains that movement. The old final permission map ends at the raw animation's jawline. It therefore blends away the moving chin while retaining much of the opening mouth, making the lower face look compressed.

Stage isolation at the reported speech moment confirmed the cause before changing expression weights. A separate full jaw-depth experiment was unnecessary. The correction keeps the existing expression model, fixed donor, 60% identity blend, eye calibration and skin-lighting statistics.

## General rule

`face_jaw_geometry.py` uses the current source landmarks, segmentation and occlusion estimates. It contains no clip IDs, timestamps, filenames, character names or per-clip thresholds.

1. Require a visible, contained source jaw. An uncertain or occluded jaw keeps the previous mask.
2. Find generated chin skin extending onto the raw frame's visible neck, below the detected mouth. Require connection to the existing face and a bounded displacement relative to face height.
3. Build one unified support, including a small outward feather and ownership over the old jaw boundary. Two separately feathered mattes leave a double contour and were rejected.
4. Keep hair, glasses, clothing and background outside this added support. Use the old face interior for lighting statistics, rather than treating neck pixels as matching skin samples.
5. Project one absolute face plane and assert exact original pixels outside permission before encoding. No face synthesis is added by this mask correction.

Visibility is a model estimate. This does not establish perfect occlusion detection, anatomy, identity or gaze for arbitrary videos. It does not solve cuts, transitions, old recursive identity drift or the separate face-wide texture-softening issue.

## Recipes and existing work

New feature-cleanup runs use `source-face-v6` for the uncalibrated/Regional route, `source-face-v7` for Standard with eye calibration, and `source-face-v8` when the optional eye-finishing beta is selected. Those inherit the corresponding frozen v3/v4/v5 math and bind the added jaw helper/configuration. The v8 eye orchestration has separate version bindings; the six frozen v5 helper/configuration files are unchanged.

Existing v1–v5 requests, fingerprints, paid frame caches, calibration and outputs keep their saved recipes. New runs retain the user's selected Standard/Regional profile and toggles. This adds no new control or forced preference reset.

The jaw correction needs no additional model weights beyond the existing feature-cleanup stack. An explicit **Prepare / update facial tools** action updates the code on another retained disk. Generate and selection never install tools or models. The separate eye beta remains off by default and still requires its two optional files and isolated observer runtime.

## Validation protocol

The mask/helper configuration was frozen before an eight-clip GPU cohort. The first five clips are development regressions; the final three, 435 frames, were held out from parameter selection. All 1,722 frames use the same rule. Comparisons reuse immutable paid raw animations and references, generate matched old-mask/new-mask face finishes, and keep the complete raw/control/candidate/crop evidence outside Git.

Synthetic checks cover chin ownership, original lighting statistics, protected semantic regions, hidden/uncertain source jaws, disconnected/far generated skin, subpixel scene projection, invalid observations and shifted face placement. App checks cover the new capabilities/receipt validation and historical recovery. Full motion, independent permission replay, actual managed v6/v7/v8 finishing and saved-prefix recovery are recorded separately in the final validation receipt; they must not be inferred from the synthetic checks alone.

The private loopback comparison supports direct clip URLs and keeps the original paid result next to a matched control and the new jaw candidate. Diagnostic event buttons select review frames; they never control inference.

## Deployment checkpoint — October 30

After resuming the evaluation, the user requested enabling the correction for their own new videos before the remaining managed validation round. The speaking-jaw rule is the unchanged candidate from the eight-clip cohort. New runs with feature cleanup use v6/v7/v8; saved v1–v5 runs retain their recipes. No extra jaw model or new toggle is required.

The focused validation passed eight jaw helper checks, four worker-protocol checks and 42 Studio facial checks; the production build passed. A guarded local reload preserved all 233 existing job records and both saved drafts byte for byte. The new host's models finished downloading before the runtime update. GPU finishing tests continue only when the user is not rendering or downloading; the remaining managed recovery/permission checks must be recorded as pending until actually completed.

The user subsequently reported exhausted credits. Compute was independently confirmed stopped, with no active model downloads or user generations; the reconnect-update watcher was cancelled. GPU preparation and paid tests wait for the user to confirm a refill. Offline comparison and implementation can continue.
