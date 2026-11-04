# Shared-anchor native evaluation — 4 November 2026

Two native arms completed. The planned matched unpinned forward control did not run, so this evaluation does not establish whether shared-context pinning improves the join. No application setting, production workflow, historical recipe or user draft changed.

## Scope and mapping

The continuous-shot evaluation covers source frames 0–72 at 24 fps and 480 × 864 pixels. A clear, approved replacement image is bound to source frame 36. Each native graph uses the already-installed weights, seed 42 and the frozen 124-position model context; held context after the real source range is discarded.

- Reverse arm: 37 real frames, reverse-local `R[j]` corresponds to source `36−j`.
- Forward arm: 41 real frames, forward-local `F[k]` corresponds to source `32+k`.
- Intended assembly: `R36…R0`, followed by `F5…F40`, giving 73 frames and one source-frame-36 anchor.
- The bridge uses chronological pixels `R4,R3,R2,R1,R0`, re-encodes them with the VAE, and pins the resulting two temporal latents. It does not reverse causal native sampler latents.

The separate unpinned graph has the same frozen conditioning, seed, dimensions and source context. It differs only in the prefix pin, apart from output naming. It remains **unsubmitted**.

## Actual execution

| Arm | Native prompt | Native graph time | Outcome |
| --- | --- | ---: | --- |
| Reverse | `45b1a004-c597-4c14-8902-11ada932bf42` | 87.356 s | Completed; native history and original float context recovered |
| Bridged forward | `b123e7c8-99ed-49ad-af7c-ead6605fedca` | 99.681 s | Completed; native history and 41-frame MP4 recovered |
| Matched unpinned forward | None | Not measured | Not queued; insufficient reserved work time |

These durations come from native execution-start/success timestamps. They exclude rental readiness, controller preparation, transfers and confirmed shutdown, and are not complete Generate latency.

The first attempt uploaded and verified the three inputs but timed out during redundant full-model hashing. The next attempt used the existing downloader's exact size/mtime/SHA-stamp contract, explicitly recording that it did not compute fresh model hashes. It completed the reverse arm and recovered its original float context. Uploading the approximately 50 MB sealed verification bundle then timed out; neither forward arm was submitted at that point.

A subsequent local reconstruction reproduced all ten sealed files byte for byte. The remote continuation copied the genuine saved context and reconstructed the chronological bridge from its exact header and reordered float pixels, transferring only about 86 KB of proof data. All sealed whole-file hashes matched. No reverse inference was repeated and no new weights were downloaded.

The bridged arm then completed. The controller refused to submit the final arm because the remaining work interval was below its admission gate. A separate zero-inference recovery attempt could not reach SSH within its 20-second readiness window; it stopped without retrieving the remaining archive. Original paid results remain on the retained disk.

## Available review and limits

The initial review had only a partial tail: source frames 32–72 using five genuine reverse float frames followed by decoded bridged MP4 frames 5–40. Its mixed compression limited fine boundary assessment. **The stopped-host recovery below subsequently recovered all native PNGs and the complete 73-frame lossless assembly.** The earlier mixed preview remains immutable; it is not the missing controlled A/B comparison.

Initial sampled forward frames retain the reference appearance but miss a source eyelid movement. No perfect identity, gaze, mouth, occlusion, cut handling or general quality claim is established. The older seed-42 native control also used a different reference-image hash; it cannot substitute for the missing matched control.

The recovered tail was played through its final source-frame-72 image in native QuickTime and reviewed at synchronized 36–39 and ending close-ups. There is no obvious severe face-outline/identity snap at 36→37 in this preview. However, the candidate's eyes remain too open when the source is downcast near 32–39; later eyelid timing and mouth shape are approximate. The source's pink facial illumination is also underrepresented. This slice does not contain the earlier hand-covered opening or complex speaking/teeth movement, so it cannot validate those requirements. No winner was selected and nothing was promoted.

## Offline finishing follow-up

No further cloud compute, weight downloads or provider mutations were used for this follow-up. The existing installed models ran on one local CPU thread. These are diagnostic stills, not complete video timing or CUDA numerical parity.

The corrected harness first proved that all 41 decoded pixels of the mixed tail master match its independent accepted-frame PNGs. It uses genuine reverse-prefix frames at source32–36, rather than the discarded forward overlap. Earlier discarded-prefix stills are preserved and excluded from the accepted-tail comparison. The source file and approved donor hashes match the frozen calibration; Mac/Linux decoded anchor pixels differ, as already documented by the earlier CPU harness.

Six samples (36, 37, 48, 58, 60, 72) ran the unchanged `source-face-v10` Standard + ONNX60 functions in 103.443 seconds. They improve sampled mouth closure and blink58, but do not fully correct the early eyelids or source lighting. Every output is bound to its same-call arrays and preserves pixels outside its computed facial alpha. Those masks do not prove physical hand protection.

Two isolated hypotheses were then tested:

1. **Raw-eye texture restoration.** A cache-only replay removes just that overlay, keeping the original prediction, alpha, projection and lighting field. Exact baseline reconstruction passes on all six samples; frame72, which has no texture overlay, remains byte-identical. Removing the overlay changes iris/detail appearance slightly but does not fix the overly open eyelids already present before restoration. It is not the main cause on these samples.
2. **Vertical eye calibration offset.** A private clone zeros only the eight EYES' Y offsets, preserving their Z offsets, every other calibration entry, source controls, donor and pipeline settings. Three CPU generator calls (36, 58, 72) take 52.940 seconds; two open/glance controls (48, 60) take 35.997 seconds. Frame36 becomes more source-like, and frame72 remains byte-identical to baseline, including pre-eye prediction and final alpha. However, open-eye48 and glance60 become too hooded. **A global zero-Y change is rejected for default use.** Unchanged source mouth latents do not establish unchanged decoded mouth pixels or identity geometry.

A further cache-only color diagnostic finds a large source-relative skin-color change that the raw animation does not reproduce. At frame48 versus36, computed source median Lab changes by approximately `[+2.99,+10.63,−18.98]`; generated skin changes by `[+2.52,+0.20,−4.28]`. Existing finishing matches the generated crop's lighting, so it cannot itself supply that missing source color cast. These are estimates from computed skin masks, not a physical illuminant measurement; no color correction was applied.

The final five-state factorial review confirms the same tradeoff with and without raw-eye texture. Cache-only texture interventions leave decoded mouth pixels exact. The upstream zero-Y intervention also changes decoded mouth RGB slightly (up to 11 channel levels in the sampled mouth region), despite preserving source mouth latents. This decoder coupling is another reason not to describe the intervention as an eye-only pixel fix.

The useful next calibration study must distinguish character anatomy from eye state across open, half-lidded, closed and glancing poses. It must not fit a constant to one winning frame. Whole-sequence replay, hand-covered openings, head turns/reappearance, complex speaking and the missing native control remain necessary before any production promotion. No new profile or app default was enabled.

## Separate eye-state observation

A predeclared, source-only statistical shortlist examined all 73 source positions using hash-bound current-frame 68-point geometry, existing pose/confidence gates and computed visibility. The first eight positions remain unknown where a current-frame detection is absent. Fifty-nine positions qualify. Exact-value Otsu separation of minimum binocular eye-aspect ratio is followed by an upper-state median representative with persistent source-time neighbors. This selects frame53; no output frame, maximum-aperture winner or literal test index chooses the template. Cached scoring takes 0.102 seconds, excluding the earlier feature extraction. The shortlist cannot certify neutrality or physical visibility.

After inspecting source53 against source36 and the fixed reference, a private test replaces only the eight EY-Y offsets with `reference.expY − source53.expY`. The original eye-area baseline, EY-Z, groups, eligibility, every other offset, masks, appearance anchor36 and identity blend stay fixed. Five CPU samples (36, 48, 72, 60, 37) complete in 85.204 seconds. Independent checks bind the selected frame, crop and motion, and verify the exact closed72 negative control.

Across these stills the selected observation gives a better balance: less excessive opening at36/37, while48 and60 remain more open than the rejected global-zero-Y version. Mouth RGB and alpha still change slightly because the decoder is coupled. These stills use the then-available mixed-tail parent; they have not been rerun as a finished sequence on the newly recovered native PNGs. This is a candidate for temporal testing, not a production profile or proof of correct anatomy, gaze or tracking across other clips. It must remain a fixed observation for the shot rather than switching offsets per frame.

## Stopped-host recovery and full raw review

Vast's documented host-level copy route can read stopped Docker storage when the host has open ports. It is separate from the stopped container's unavailable SSH service. The scoped recovery used only the paid output folder and a whitelist of 80 filenames from the two native histories. No compute-resume, new generation, model setup, remote write or rental request occurred. [Official data-movement documentation](https://docs.vast.ai/guides/instances/storage/data-movement), [pinned copy implementation](https://github.com/vast-ai/vast-cli/blob/a357b331fdebc4c137dd11be853e1290bdc27c9a/vastai/cli/commands/storage.py#L78).

The installed macOS OpenRSYNC authenticated but constructed ordinary remote-shell mode instead of the required daemon-over-SSH mode. GNU rsync3.5.1 was installed locally through Homebrew. The legacy numeric module then returned Unknown module; the documented `C.58966215` form in both the copy request and module worked. Previous failed diagnostics are preserved.

All 80 files, totaling 43,308,442 bytes, were recovered. A second authenticated rsync whole-content check reports no differences; local SHA256 hashes bind every file. This is not a claim that remote SHA256 was computed. Provider checks before/after the handshake and completed download show all four compute states stopped. Nominal egress is approximately $0.0000564 within the existing transfer reserve, excluding protocol overhead. Retained user storage continues billing independently; earlier cumulative estimates are timestamped snapshots, not a promise that retained storage becomes free.

The local assembler verifies 78 PNG prompts against their native graphs, allowing only the observed loader `is_changed` cache fingerprints. Every remaining field matches; the reference fingerprint equals the approved image hash. The first five reverse PNGs exactly match the saved float-context quantization; the downloaded bridged MP4 matches its earlier local SHA256. Assembly has 73 frames at24fps, one anchor36, no accepted held-tail positions, exact FFV1 pixels and all144 original AAC packets copied once. The source comparison was opened in native QuickTime and reached the last frame.

Full raw inspection covers every opening frame0–24 plus dense ending contacts. Hand/arm topology is mostly coherent and there is no obvious eye/lip painted over the visible palm in this raw candidate. Ring/nail details are regenerated, so exact hand/accessory preservation is not established. Early visible-eye closure is missed; head tilt/recoil18–24 is strongly damped; ending blink phase/depth and mouth closure remain inaccurate. No severe36→37 face cut is obvious in contacts. **The raw candidate fails the full quality requirement.**

A code audit explains a remaining limit: the current PERC finisher copies source expression while using generated-target rotation, scale, translation and scene placement. It cannot deliberately recover a missing source head tilt. A current-native-appearance/source-relative-rotation-only test has not been run; earlier fixed-portrait source-rotation experiments changed different models, geometry and appearance. Crop basis, head/hair/ear/neck support, foreground protection and temporal behavior must be checked before attempting or promoting that different route.

## Source-relative head rotation diagnostic

The recovered raw video shows a source head tilt that the animation dampens. A separate private test keeps each current generated frame's appearance features, canonical controls, scale, translation and scene placement, but changes the **driven** rotation to follow source motion relative to the shared anchor. The appearance-side `kp_source` retains the current raw target rotation. Both arms use the same fixed source53 eye-calibration candidate described above; this is not a comparison against a different eye recipe.

With column-vector rotation matrices and anchor `a = 36`, the desired rotation is `Rs_i @ Rs_a.T @ Rt_a`. An equivalent difference form, `Rt_a + (Rs_i − Rs_a) @ Rs_a.T @ Rt_a`, makes the anchor exactly equal without a frame-index branch. Independent array checks verify the production row-projection order, current raw appearance controls, crop transforms and same E53 expression. These rotations live in independently eye-line-normalized crop coordinates; scene roll remains the target's and is not transferred.

Before generation, six existing CPU motion calls took 1.942 seconds. Four parser and four XSeg calls on source/target23 and36 took 1.741 seconds. The actual scenes have no hand crossing the tested facial regions. Existing mask algorithms and thresholds remain unchanged; generated labels may naturally alter final alpha. There is no new independent hand mask for this native candidate, and old target masks were not reused on it.

Four paired CPU outputs—baseline and rotation candidate at23 and36—completed in **65.366 seconds**, using one thread and existing weights only. The frame36 negative control is byte-identical through the decoder, prediction, alpha and final scene composite. Frame23 moves toward the source's upward tilt, with 31,129 changed scene pixels between the two finished versions. Visual review finds a modest improvement in orientation, while source mouth shape, head outline and neck integration are not established as correct. The same frozen jaw rule also produces different downstream jaw support, so unchanged algorithm does not mean unchanged boundary pixels.

Observed model time includes 44.346 seconds in warping, 8.503 in decoding, 1.779 in appearance extraction and 3.929 in identity operations; worker peak RSS is approximately 2.79 GB. These are this Mac CPU diagnostic's component times, not GPU or complete Generate timings. An earlier isolated CoreML decoder speedup cannot be applied to the dominant warping stage or claimed as the same speedup for the whole workflow.

Every output preserves raw scene pixels outside its own computed alpha. This is a technical check, not proof of physical foreground protection. Two stills do not validate motion flicker, identity stability, mouth timing, hand-covered openings, cuts or reappearance. **No production workflow, profile, default or draft was changed.** Evidence is preserved under ignored `.local/remotion-source-r-only-20261104/`.

Independent post-render replay verifies every cached array and both PNGs are identical at36. At23, the candidate adds zero positive-alpha pixels outside the baseline and removes337; its permission on raw-parser neck pixels decreases from1,406 to284. Root and independent visual review find no obvious detached jaw/neck or forehead hard edge in this one still. These observations do not certify motion continuity or a physical foreground boundary, and do not resolve the remaining expression, identity and scene-lighting limits.

## Separate occlusion-topology audit

A cache-only study tests whether border connectivity can distinguish a foreground hand from legitimate low-XSeg facial features. Its inputs are eight frames from the earlier hash-bound raw/SAM cohort, not the newly recovered native video. No old mask was applied to a new frame.

With the frozen low-XSeg threshold of 0.05 and eight-connected components, each frame has one low component touching the crop border and no enclosed components. The proposed rule therefore reduces exactly to plain XSeg. Against a counterfactual semantic-feature override, it removes 7,120 weighted permission units inside the computed hand and 3,635.49 outside it, almost all near mouth/lip boundaries. Those outside-mask losses are close to the SAM boundary and may include mask error; they do not prove removal of truly visible anatomy. No topology switch occurs in these eight frames, so stable recovery of enclosed features is untested.

This 0.47-second array audit runs no models or network requests. Border connectivity supplies no new distinction in this sample and is not promoted as a foreground fix. Its receipt and weighted diagnostic contacts are preserved under ignored `.local/remotion-occlusion-topology-20261104/`.

## Budget and terminal state

The user explicitly approved a **$2.20 cumulative cap** for this same existing rental. The conservative allocation at 05:54:42 UTC is **$2.19310**, including the existing transfer/storage reserves and continuous retained-disk accounting. This is a planning estimate, not a finalized provider invoice.

Compute was independently confirmed **exited / intended stopped** at 05:54:06 UTC. Five-minute idle pause was restored. No further paid resume fits the remaining allowance. Retained storage continues at approximately $0.01481/hour; preserving that disk is separate from stopped compute.

The independent follow-up audit consumes the $0.002 post-stop media-storage reserve once into observed storage, rather than holding it forever alongside that same observed cost. Its 486 seconds ended at 06:02:12 UTC. With transfer reserves unchanged, the conservative allocation at 06:23:25 is $2.19819 / $2.20. This does not authorize more compute, and it does not authorize deleting the user's retained disk.

Sanitized facts are recorded in [the validation receipt](validation/remotion-shared-anchor-20261104.json). Original private inputs, native histories, all attempt receipts and budget ledgers remain under ignored `.local/remotion-shared-anchor-20261104/authorized-phase/`. Preserve them; do not recreate paid frames to make the comparison appear complete.
