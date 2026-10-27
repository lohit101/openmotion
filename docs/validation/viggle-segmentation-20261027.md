# Viggle segmentation validation — 2026-10-27

Implemented offline, with the GPU disconnected. No rental, model transfer or paid inference was started. No existing model option or installed weight was retired.

- **279 app tests passed**, across 23 files. Includes exhaustive plans for every target from 5 through 720 frames, legacy single-shot/Wan behavior, original-frame reuse, unchanged sampling recipe, missing-anchor rejection and outdated-runtime preflight.
- **30-second protocol export:** seven segments, 720 actual decoded frames, 24/1 fps, one source audio track, nonzero input trim (1.25 s). Accepted counts: 124, 119, 119, 119, 119, 119, 1. Last source window starts at 612, loads 108 actual frames, and removes 107 already accepted frames.
- **Interrupted anchor transfer:** the local video and successful history survived the failed transfer. After GPU history was removed in the fixture, Check & resume downloaded the existing anchor and submitted only the next segment. The original first prompt ID and segment bytes were retained. The first image preparation was not repeated.
- **Real pinned ComfyUI CPU checks passed:** all ten exported API prompts validate, and the real helper classes extract frames 17–21 rather than tail frames 119–123 for a 125-frame target. Native nested video/audio latents and masks have the correct shapes; only two video latents are pinned. Wrong job, offset, overlap, dimensions and fps fail. The original input latent remains unchanged.
- **Python suite:** 90 tests ran successfully, with 27 optional-environment checks skipped. The separate ComfyUI CPU checks above exercise the new tensor path.
- TypeScript, production build, editable Viggle graph regeneration and Git whitespace checks passed. The local Studio server was reloaded only after confirming the GPU was offline and there were no queued/running/reconnecting jobs.

Protocol video is FFmpeg passthrough and cannot validate generated identity, seam lighting, motion continuity, performance or GPU memory. Those require a real-GPU continuous-shot comparison. No visual-quality pass is claimed. The browser UI could not be exercised while the user's Chrome window was changing; trim bounds and clip selection were checked in automated tests.

See [the continuation and recovery contract](../viggle-segmentation.md).
