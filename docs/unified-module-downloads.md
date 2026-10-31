# Unified module downloads

Remotion, Imagen and Clarity share the same download area at the bottom of their settings panel. The main action reads **Download Remotion**, **Download Imagen** or **Download Clarity** when the selected settings need files or tools. It can prepare a module before media inputs are supplied. Once preparation succeeds it returns to the module’s generation action; downloading never submits inference automatically.

The expandable **Downloads** row immediately above that button lists only files required by the current settings, their sizes, installed state, individual progress and errors. The button shows aggregate byte progress, including reused partial files, and keeps verification below completion until the downloader confirms success. Runtime package installation uses a separate **Preparing tools** state when no reliable byte total is available. Optional local model transfers report their actual byte percentage. Progress is not a time estimate.

Changing settings starts nothing. The server derives the file plan from the submitted settings and the existing manifests. Shared files and installed models are reused; unselected adapters, disabled facial finishing and optional image stages are excluded. The existing inference validation remains in place. Custom uploaded LoRAs still need to be supplied separately.

**Settings → Downloads → Download all models** explicitly queues every file in the model catalog, including optional and legacy models. Shared files are counted once, installed files are skipped, and remaining bytes plus working space are checked before transfer. This bulk action downloads catalog weights; module-specific tools are prepared by the module button when requested. Its storage/compute/transfer information remains visible. It does not change selected models or enable optional stages.

## Transfer ownership and recovery

Each managed file transfer has a deterministic hash of its pinned manifest, a remote progress journal and completion receipt. A detached worker owns the actual download, independent of the local SSH observer. Its PID is checked against the Linux boot ID, process start tick and exact job argument before cancellation. Remote helpers are versioned by their source hash; recovery locates the helper saved with the original transfer.

Network failures resume partial HTTP byte ranges with the existing bounded retries and pinned SHA256 verification. A disconnected observer polls the same saved job after SSH becomes reachable, without starting a duplicate. Terminal failures expose **Retry downloads**; a retry is explicit and keeps valid installed files and resumable partials. Invalid checksums are rejected. Cancellation never removes valid weights or a model disk, and an unconfirmed remote stop stays busy until independently resolved.

The local server persists the pending queue, selected module plan, transfer set and exact rental/endpoint ownership. A browser refresh receives current state through the normal event stream. After a server restart the recovery monitor reattaches only to authorized pending work on that same rental. It may restore its existing SSH transport, but never rents or resumes compute. A different GPU does not inherit a pending transfer’s authority. Confirmed provider stops clear only the matching session; old stop events cannot cancel a newer download.

Facial-tool preparation has a detached setup receipt as well. Clarity uses its existing tracked runtime setup. An interrupted module first checks these existing setups, waits while they run, and verifies readiness before enabling generation. A stopped incomplete setup requires an explicit retry. Optional local Imagen helpers retain their existing setup/model recipes and use a locked resumable download wrapper. Their model implementations are unchanged.

Unknown remote activity, setup and transfers remain protected by generation/storage/idle-pause guards. Completion alerts wait for selected runtime preparation as well as model files. Keep the local server running on an awake computer for automatic status recovery and alerts; a remote download can continue while its observer is disconnected.

## Validation on 2026-10-31

The complete Studio suite passed 503 tests. Focused checks cover exact file selection, byte progress, module/runtime sequencing, failed-file retries, persisted same-rental recovery, unknown cancellation, provider-stop ownership and completion-alert timing. Fifteen new Python tests use a local HTTP fixture and mocked SSH: they exercise an actual mid-transfer disconnect and Range retry, checksum/receipt validation, process-owned cancellation, duplicate starts, read-only recovery, helper upload descriptors, local setup reuse, CLI batch selection and a lost runtime-start response. Existing model-profile, managed-path and face-package tests also pass.

The real frontend was reviewed against an isolated local fixture for Remotion, Imagen and Clarity, progress, expandable file lists, reconnect/retry states, runtime preparation, return to generation and the Settings bulk action. No user media/database or provider connector was attached to that fixture.

No GPU was resumed, contacted or tested; no model host transfer, remote install or inference ran during this task. Real-host recovery remains to be validated when the user resumes work. No model URL, weight checksum, sampling recipe, facial compositor or paid output was changed.
