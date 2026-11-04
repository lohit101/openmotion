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

The full 73-frame lossless assembly is **not locally recovered**. A local tail preview can cover source frames 32–72 using the five genuine reverse float frames in chronological order, followed by decoded frames 5–40 of the bridged MP4. Its first five frames are quantized from the original float output; the remainder has MP4 compression. This supports inspection of visible geometry and motion at the 36→37 join, with a compression caveat. It is not an all-PNG reconstruction or the missing controlled A/B comparison.

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

## Budget and terminal state

The user explicitly approved a **$2.20 cumulative cap** for this same existing rental. The conservative allocation at 05:54:42 UTC is **$2.19310**, including the existing transfer/storage reserves and continuous retained-disk accounting. This is a planning estimate, not a finalized provider invoice.

Compute was independently confirmed **exited / intended stopped** at 05:54:06 UTC. Five-minute idle pause was restored. No further paid resume fits the remaining allowance. Retained storage continues at approximately $0.01481/hour; preserving that disk is separate from stopped compute.

The independent follow-up audit consumes the $0.002 post-stop media-storage reserve once into observed storage, rather than holding it forever alongside that same observed cost. Its 486 seconds ended at 06:02:12 UTC. With transfer reserves unchanged, the conservative allocation at 06:23:25 is $2.19819 / $2.20. This does not authorize more compute, and it does not authorize deleting the user's retained disk.

Sanitized facts are recorded in [the validation receipt](validation/remotion-shared-anchor-20261104.json). Original private inputs, native histories, all attempt receipts and budget ledgers remain under ignored `.local/remotion-shared-anchor-20261104/authorized-phase/`. Preserve them; do not recreate paid frames to make the comparison appear complete.
