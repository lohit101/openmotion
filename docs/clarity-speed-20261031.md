# Clarity speed update

The user requested local preparation only while sleeping. No GPU was contacted, resumed, installed, tested or scheduled for this change. New attempts use `clarity-flashvsr-turbo-v3`; paid v1/v2 requests, receipts and outputs stay frozen and recoverable.

## What the existing runs actually measured

The saved pair uses the same 374-frame, 24 fps, 864 × 480 source: **15.583 seconds of video**, not five seconds. Both use Turbo, temporal compression 4 and source-color matching on the same A100 PCIe host.

| Output | Complete job | Recorded worker |
| --- | ---: | ---: |
| 720p, 1296 × 720 | 290.142 s | 164.088 s |
| 1080p, 1944 × 1080 | 414.962 s | 342.057 s |

The 1080p result took 6m55s, with 72.905 seconds outside its worker timer. That difference includes preparation/checks/transfers; the old receipt cannot attribute it precisely. Worker time also includes loading, CPU color matching, serialization, verification and encoding, not just GPU sampling. This single pair does not establish typical throughput or an overall speedup over generating native 704p.

## Changes

- **Native remains the default.** Keep the same model, attention, full target resolution, one model step, temporal compression, scene-color algorithm, frame rate and CRF-16/medium export quality.
- **Fast 1080p is an explicit alternative.** Restore at the 720p shorter edge with the same weights, then Lanczos-resize once during 1080p export. This reduces AI work and fine-detail recovery. Inputs must be below 720p; this upscales the saved video without another Remotion generation. The saved pair suggests materially less model work, but this exact new path has no GPU timing or visual comparison yet. It is not native 1080p AI restoration.
- Stream full-frame resized/padded input through a pipe instead of writing and rereading a prepared video. Untagged limited-range footage uses raw YUV/NUT. Tagged matrix/full-range footage uses FFV1/Matroska to retain color metadata that NUT/rawvideo loses in the FFmpeg/OpenCV interface. CPU checks compare the normalized model input exactly against the old FFV1 preparation.
- Run the unchanged pinned float32 wavelet color matcher in two-frame CUDA windows when enough memory is free, with TF32 convolution disabled just for this pass. Conservative low-memory admission or a color-only OOM keeps that window on CPU; it never retries diffusion or changes decoder history. Record GPU/CPU frame counts and OOM fallbacks. The pinned decoder returns CPU tensors, so the previous color pass ran on CPU; its actual share of old runtime is unmeasured.
- Use upstream's memory-aware automatic TinyDecoder executor rather than forcing serial everywhere. Its native 1080p heuristic still chooses serial; small inputs can use parallel microsteps and its saved-history OOM fallback. Keep automatic KV-cache offloading.
- Keep the complete verified RGB/FFV1 output bridge. Rename it after verification instead of remuxing another lossless copy without useful audio. Encode the final MP4 only once and verify original audio packet payloads and exact frame timing.
- Bound CPU helpers to affinity/quota with an eight-thread cap, replacing the old fixed two-thread encoding limit. Cache verified weight checksums using size, mtime, ctime, inode and device; unknown/changed files are fully hashed. Status remains read-only.
- Compatible runtime/operator installations are reused during explicit preparation. No new weights or dependencies are added. The ready marker/fingerprint includes the new execution adapter; a manual runtime update is required before new v3 attempts.
- Save worker-total/phase timings, input transport, actual AI geometry and native pipeline metadata. Details show nested input/color/bridge times under total inference; nested phases must not be added to their parent. Total job time remains separate because it includes transport and local finalization.

## Offline verification and morning test

491 Studio tests, type checks, production builds and 23 CPU Python checks passed. CPU fixtures cover exact input RGB at integer/fractional rates, source matrix/range tags, window boundaries/count errors, decoder-process cleanup, unchanged pinned wavelet CPU values, simulated color OOM/low-memory handling, checksum invalidation, lossless RGB output and original audio. Historical v1/v2 downloaded results recover offline without migrating or rewriting their receipts. These are not CUDA equivalence, peak-memory, visual-quality or speed measurements.

A 36-frame synthetic Mac CPU input-only comparison took 0.392 → 0.291 seconds at 720p and 0.749 → 0.600 seconds at 1080p, with identical model-input hashes. It excludes model work and is not a prediction of GPU latency. Tagged footage retains a lossless streaming codec and may have different preparation cost.

After the user resumes compute: explicitly update Clarity tools, reuse an existing clip, compare native v3 against its preserved v2 baseline, then compare Fast 1080p with native. Inspect faces, eyes, hair, text, motion/occlusion edges and fine detail; verify all frames/audio, phase times, selected decoder/cache policy, GPU/CPU color counts and recovery. No test runs automatically on reconnect. Exact speedup and quality remain pending.

The audited upstream is the [official FlashVSR+ repository](https://github.com/OpenImagingLab/FlashVSR_Plus), pinned at `b548a2cc2c929d3d4676f2973abe27876ec4dee7`. See the [sanitized validation receipt](validation/clarity-speed-20261031.json).
