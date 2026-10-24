# Lighting continuity comparison

New Studio jobs and newly exported standalone workflows use native `VAEDecode` to decode each complete generated segment with shared context. Previously, `VAEDecodeTiled` split spatial context into 512-pixel tiles and temporal context into 32-frame windows with eight-frame overlap. For this 37-frame generated shot, the overlapping temporal windows begin around one second, where the earlier result visibly brightened. An existing unfinished Studio job retains its previous decoder through the saved render version; it is never silently converted during continuation.

## What was tested

The same source video, character reference, uniformly aligned reference, source window, prompt and seed were reused on the retained RTX 3090. The output is 704 × 1248, 24 fps, 36 frames / 1.5 seconds with source audio. The new candidate used continuous decoding, relighting at 1 and the optional Natural preset: eight steps, CFG 1, Euler, shift 5 and T2V acceleration strength 0.8. DPO stayed at 1 and the two additional user LoRA slots stayed empty. It completed in 437.558 seconds, versus 342.233 seconds for the earlier six-step render with relighting off. That timing compares two configurations and includes preparation/export; it is not a universal speed estimate.

The test saved the sampled latent once. A separate graph loaded those exact bytes and decoded them using the previous tiled settings. This control contained no diffusion sampler: it did not generate a second character performance. It retained the same VAE, source, trim and export settings. The exported latent's SHA256 was independently checked before comparison.

## Result and limitations

Synchronized full-frame and face crops were reviewed around 0.5 seconds and through the later lighting change. A motion-compensated patch of the stable ceiling measured a +0.1518 EV adjacent-frame brightness jump at one second in the earlier result. The same-latent control recreated a +0.1303 EV jump, while continuous decoding measured 0 EV median in that patch and removed the visible pulse. These are linear-luminance descriptors of a selected region, not a perceptual quality score or a guarantee of correct lighting everywhere. The source also measured approximately 0 EV at that transition.

The earlier skin-detail loss near 0.5 seconds is less pronounced in the new candidate, but sampling, relighting and decoding changed together. Their individual contributions to skin texture are not isolated by this experiment. Source acting includes a held-open mouth and sideward gaze. The new candidate sometimes reduces that mouth opening and adds stronger brow furrowing; partly lowered eyelids remain. Broad reference appearance is recognizable, but expressions are not perfectly preserved. No face-recognition or identity-similarity score was measured.

All five existing framing checks pass. The new result's head-size ratio is 0.927–1.004 of the source, but maximum face-center offsets are 18.5 pixels horizontally and 23.4 vertically, compared with 4.6 and 5.2 in the previous result. Face-box measurements do not establish whole-body or occlusion fidelity. The source-relative reference transformation remains unchanged.

Continuous decoding is the new rendering path. **Fast / 6 steps remains the default**, and the saved draft is preserved. Natural / 8 steps is optional and explicitly described as experimental. Relighting remains a separate setting. The existing prompt already assigns expressions, gaze and timing to the source; no prompt rewrite was presented as a proven fix for the remaining acting differences. No new checkpoint, face-restoration pass or prompt filter was added.

## Connection recovery and cleanup

A metadata read timed out while the GPU was still sampling. The same prompt was recovered and followed to completion; no duplicate generation was submitted. Safe ComfyUI GET requests now allow a 45-second deadline and up to three attempts with abortable backoff. Submissions and other POST mutations are still attempted only once. If recovery is exhausted, the app reports the interruption and checks the existing job before resuming.

The library entry is **Lighting continuity · Natural 8 · same inputs**. Its final video is stored locally and remains playable with the GPU offline. The retained instance was confirmed stopped after the one generation and decoder-only control. Raw media, dense comparison sheets, graphs, histories and sampled memory telemetry stay in ignored local backups. The sanitized record is [validation/lighting-continuity.json](../validation/lighting-continuity.json).

Only this short, single-person shot has been checked. Continuous decoding may use native memory fallback on other dimensions or longer segments. Thirty-fps rendering, long-shot continuity, other references, and reliable expression fidelity need separate comparisons before stronger claims.
