# Clarity video upscaling

Clarity is a separate video workspace. Upload a clip or choose a completed Library video, select 720p or 1080p, and save a new Library result. It never changes Remotion/Imagen drafts, resamples their paid frames, or replaces the original file. Upscaling is experimental. Two user-run v2 receipts provide initial timing observations; the new v3 speed path still awaits a GPU comparison. See [the speed update](clarity-speed-20261031.md).

## Storage and first setup

The selected [FlashVSR+](https://github.com/OpenImagingLab/FlashVSR_Plus) Turbo weights are three files totaling **7,016,472,997 bytes** (7.02 GB decimal / 6.54 GiB), pinned in `config/upscale-models.lock.json`. The Base checkpoint and Wan VAE are excluded. The small context tensor comes from the pinned official source revision; no text encoder is downloaded.

Allow **25 GB additional free disk** for the weights, isolated CUDA/Python runtime and a short clip's working space. This is a capacity allowance, not a measurement of installed runtime bytes. Long clips require more scratch space; v3 admission estimates the lossless output bridge/final export plus a 5 GiB reserve before loading the model. Input preparation now streams without a disk intermediate. Successful output verification removes only that job's disposable intermediates. Failed-job evidence and original inputs remain saved.

Use the individual file download controls or the three-file batch, then **Prepare Clarity runtime**. These are explicit, separate actions. Preparation uses a detached, tracked setup process and an independent environment under `upscale-runtime/.local/venv`; it never downgrades ComfyUI. Runtime packages have their own transfer cost and installation time. The first release requires Linux/x86_64, host Python 3.10–3.12, CUDA and a single GPU with at least 20 GiB free VRAM. This free-memory floor is an admission guard, not a validated peak-memory claim.

The source is pinned at `b548a2cc2c929d3d4676f2973abe27876ec4dee7`; selected weights are pinned at Hugging Face revision `46b79520946ac67dec94d1566490690953c7debc`. The runtime pins PyTorch 2.7.1/cu128. New v2 attempts require the pinned source’s **Triton block-sparse** backend, installed explicitly from `operators/flashvsr_attn` without dependency changes. Preparation runs a small BF16 CUDA comparison against dense reference attention before marking the runtime ready. Compatible existing Torch/runtime packages are reused. No NVCC/BSA/FlashAttention extension build or model re-download is required by this operator’s audited imports. Published optimized-kernel speed claims must not be presented as Clarity’s speed. Historical v1 attempts retain their original SDPA receipts and recovery path.

## Timing and output limits

For a five-second/24 fps 480p clip to 720p, **30–120 seconds was only an initial planning target**, not a measured guarantee. The saved 15.583-second A100 PCIe pair took 290.142 seconds to 720p and 414.962 seconds to 1080p end to end. Cold weight loading, host/disk performance, kernel compilation and transfers all matter. The initial SDPA path hit upstream’s two-billion-entry mask guard at both 720p and 1080p and is no longer offered for new attempts. A real comparison is required before claiming a speedup over native 704p.

New v3 attempts stream preparation and use bounded CUDA scene-color matching when memory allows. Native output resolution remains the default. For inputs below 720p, **1080p → Processing → Fast 1080p** explicitly restores AI detail at 720p and resizes to the final 1080p output, trading fine detail for less GPU work without extra model files. This new route is not yet GPU-speed or quality validated. Details record actual AI dimensions and execution-phase timings.

Clarity uses one-step video super-resolution with upstream temporal processing. Fast uses temporal compression 4; More motion detail uses 2. Frame rate stays unchanged. Output sets the shorter edge to 720/1080, with even-sized dimensions rounded by at most a pixel. Temporary padding to the model's 128-pixel grid prevents the upstream center-crop from removing scene content; only padding is removed afterward.

The adapter replaces upstream intermediate serialization with a lossless RGB/FFV1 bridge. It checks the complete decoded RGB hash and rational frame rate, then encodes the final H.264 MP4 once at CRF 16. The MP4 is **not mathematically lossless**. Original audio packets are copied and checked. Inputs must be constant-rate SDR, square-pixel, at most 60 fps/five minutes, with no audio or one MP4-compatible audio track. Unsupported input is declined before model inference.

Upscaling cannot recover correct identity, mouth geometry, hands or texture that the original generation never produced. Review the source comparison in motion before choosing lower-resolution generation as a replacement for native high-resolution inference.

## Recovery and resource ownership

- Selection, status checks, refresh and inference do not download weights, rent/resume compute, or switch to CPU.
- Every request freezes source bytes, timing, geometry, settings, recipe fingerprint and the exact rental. Duplicate accepted request keys return the same job.
- The separate GPU lock and existing ComfyUI queue checks prevent overlap with generation. Only idle ComfyUI caches can be released for VRAM admission.
- Unconfirmed setup/remote processing blocks automatic idle pause and conflicting GPU work. An SSH error is not proof that a runtime is absent or a worker stopped.
- Check & resume polls/downloads the original attempt; it never relaunches sampling. Fully downloaded verified output can finalize offline, including after a code update. A failed partial model run requires an explicit new attempt.
- Cancellation retains files and stays unconfirmed until the original worker is verified stopped. Complete results cannot be changed into cancelled runs.
- Run details show upscaler provenance rather than invented Viggle seeds/steps. Readiness/failure use the existing notification system, with Clarity as their destination.

## Validation status

Offline Studio contracts, native media checks and an isolated browser review cover input selection, framing, exact/fractional timing, RGB serialization, audio packet copying, immutable drafts/originals, receipts, offline completion and unknown remote cancellation. Synthetic FFmpeg fixtures exercise transport/output contracts, **not AI quality or GPU speed**. The first full Studio run exposed an existing asynchronous Generate idempotency race; the final acceptance check now sits after preflight awaits and the regression passes.

No upscaler weights, CUDA runtime or paid test was installed/run during the original implementation or the offline v2/v3 repairs. The later user-run v2 results are preserved separately from these implementation checks. New v3 CUDA quality, peak memory, end-to-end speed and remote interruption recovery still require an authorized GPU evaluation; no test runs automatically on reconnect. The CUDA self-test runs only on explicit runtime preparation. See the original [sanitized validation receipt](validation/clarity-20261031.json) and [v3 speed report](clarity-speed-20261031.md).
