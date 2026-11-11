# Setup performance and module queue

The GPU app can accept another module's Download request while files or tools for the current module are being prepared. Settings → Downloads shows the setup queue, including per-module pause, resume and cancel. The redundant Extras tab is removed.

## What changed

- Up to eight selected module recipes can be active, queued or paused. Each request retains its exact file/runtime list and connected rental/endpoint. Shared files are reused; generation remains a separate action.
- Existing four-file download concurrency and Xet transfer/resume/SHA verification remain intact. A second module no longer needs a second visit after the first installer finishes.
- Package installation stays serialized. ComfyUI modules share a Python environment and can restart the engine; overlapping pip processes or generation during installation can corrupt dependencies or interrupt work. Queuing is supported; cross-module parallel package installation is deliberately not enabled.
- Bootstrap checks the required dpkg package statuses first. When all are installed, it skips the repeated apt repository update/install. Missing or unknown statuses retain the original apt path.
- Clarity's isolated environment uses the already-available bootstrap uv binary for direct exact package pins, with bounded concurrent downloads and unpacking, no retained wheel cache, and fallback to the original pip command. No new uv installation is initiated by module setup. Missing uv also uses pip.
- Requirements/constraints, editable builds and configured pip environments retain pip behavior. A setup-only receipt can skip a repeated requirements check only when command, included requirements/constraints and installed-distribution metadata are unchanged. Mutable/editable sources and custom pip configuration bypass receipts. Environment changes invalidate previous receipts rather than blessing earlier conflicting package sets.
- Remotion, Fix Faces and Smooth Motion use this receipt helper during their explicit native tool preparation. Imagen's model files still require only verified downloads, not a separate GPU package installation.
- Queue acceptance, work start, verified-files-ready and final-ready timestamps are retained for the next actual host timing comparison. Installer logs report whether work was reused, installed by uv or installed by pip.

The GPU does not unpack Python wheels or compile every dependency. CPU, disk, package transfers, source builds, engine startup and kernel validation can dominate tool preparation even on a fast GPU. Large model weights require verified transfer and placement rather than a GPU-specific installation.

## Controls and recovery

Pause/cancel of a waiting item affects only that item. Pause of an active file transfer requests cancellation and keeps completed/partial files. A running tool installation must settle; the UI shows that wait and does not launch the next setup while remote activity is unknown. Cancel does not delete files or uninstall packages.

The accepted queue is stored with download state. Reconnection observes the same rental; it never rents/resumes compute, switches ownership to a different GPU or repeats unknown work. Explicit resume is required for paused items. A confirmed provider stop pauses waiting items. Normal app shutdown cancels pending requests; explicit Download/Resume reuses files afterward. An interrupted app/transport reconnect can restore accepted pending work on its original rental.

Actual rendering, cloud setup, idle pause and unconfirmed GPU work still block new setup/resume. File deletion and GPU changes retain their busy/ownership protections. Queue controls do not change normal GPU start/pause/stop policy.

## Compatibility and validation

The original Clarity inference worker, execution/video helpers, model/runtime manifests, model versions, generation defaults and frozen video recipes are unchanged. A separate setup dispatcher calls the original preparation, including disk checks, imports and sparse-attention CUDA self-test. No check is replaced by a cached success marker. Status/recovery still invoke the original read-only worker.

Offline checks cover queue advancement, shared-file reuse, individual pause/cancel, original-rental recovery, provider stops, unconfirmed cancellation, API render/idle guards, installer locking, receipt invalidation and pip fallback. A synthetic local wheel installs and imports identically through pip and uv. Its single tiny cold install was slower via the new helper (1.138 s vs 0.153 s); a verified receipt replay took 0.030 s. This is not a GPU setup benchmark or a speedup claim for large packages.

Native Chrome reviewed the actual UI with a synthetic, provider-disabled queue at desktop and 320 px phone emulation, including an individual pause. Fixture API errors from deliberately disabled unrelated calls are not live installation failures. No GPU lifecycle action, model transfer, remote install or inference was performed for validation. Fresh-host setup savings remain unmeasured.

The installer fast path is deliberately narrow because [uv documents differences from pip](https://docs.astral.sh/uv/pip/compatibility/). Its [concurrency controls](https://docs.astral.sh/uv/reference/environment/) are used only for compatible pinned package sets.

See `docs/validation/setup-performance-20261111.json` for the final validation and publication receipt.
