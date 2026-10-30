# GPU memory handoff for facial finishing

The 2026-10-30 RTX PRO 4500 failure happened after the directional video was rendered and saved. ComfyUI's queue was empty, but its process still held approximately 28 GB of GPU memory. The separate ONNX facial process ran out of room while initializing a further 9 MiB buffer. An empty queue did not mean the video models had released VRAM.

Releasing the idle ComfyUI cache reduced reported usage from 28,056 MiB to 1,156 MiB. It deleted no model files, restarted no server and repeated no video inference. The existing 356-frame run then completed its original v4 facial finish in 133.113 seconds. Its saved parent video and chronological source hashes were unchanged.

## Automatic protection

The managed controller now runs a small resource-admission helper before CUDA reference preflight and before launching a new or interrupted facial worker. This applies to historical saved recipes as well as the new optional eye finish. It changes no recipe fingerprint, donor, model, prompt, video graph or sampling setting.

- Verify that the exact managed ComfyUI queue is readable and contains neither running nor pending work.
- Probe actual free device memory through the driver before creating a CUDA context.
- Keep the warm model cache when at least 10 GiB is already free. Otherwise, request ComfyUI's `unload_models` and `free_memory`, then wait for the driver to confirm sufficient free VRAM.
- Recheck the queue around the probe and cache release. Reject unknown or newly active work rather than interrupting it. A global facial-processing lock also prevents clearing caches during another active facial worker.
- Reuse an already-running worker for the same job. Cancellation before launch submits no facial process. An unconfirmed worker remains protected; a failed memory check clears remote activity only after the exact worker confirms termination.

If the working reserve cannot be obtained, the saved video stays recoverable and the error explains available memory and **Check & resume**. The helper never rents, resumes, restarts or stops compute, deletes files, changes settings, falls back to CPU or resubmits diffusion. Unloaded models reload from the existing disk when needed.

The 10 GiB reserve is a conservative admission threshold for this facial stack, not a promise about every external workload or driver failure. The observed collision does not require upgrading the user's 32 GB card.

## Live verification

The next user-created five-second run exercised the automatic path without manual cache clearing. Before facial finishing, it observed 9,370,075,136 free bytes, requested release, and confirmed 33,168,556,032 free bytes. All 120 facial frames completed on CUDA. Its earlier reference preflight had enough VRAM and correctly retained the warm cache.

Eight offline checks cover sufficient memory, delayed release, new/unknown queued work, cancellation, failed release and invalid device status. Controller checks additionally verify that memory-admission failure confirms a stop only for the exact stopped worker. The memory fix is committed separately as `5b185bf`.

See the [sanitized validation record](validation/facial-memory-handoff-20261030.json). Detailed logs and per-attempt memory records remain under ignored private evidence. User generations were left running, and the normal five-minute idle pause was restored after the first interrupted private comparison.
