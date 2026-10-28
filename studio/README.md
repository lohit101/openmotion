# Remotion

A local dashboard for the project's SCAIL-2 INT8 character swap workflow. The browser and library run on your Mac. NVIDIA inference stays on the rented Vast GPU, accessed through the saved private SSH tunnel.

From the project root:

```bash
bash scripts/studio.sh
```

Open **http://127.0.0.1:3000**. The launcher checks Node.js 24+, npm, Python 3, FFmpeg and FFprobe; prepares a small local CPU geometry environment and verified face detector; installs the locked Node dependencies if missing; builds the app; and starts it on loopback. It never rents, starts or bills a Vast instance. Existing dependencies, including the geometry tool, are already installed on this Mac.

## Working offline

- Upload one motion video and one character image, write a prompt, and adjust settings.
- Preview imported examples and saved RTX 3090 renders, compare each against its source, download videos or export their API workflows.
- Search, sort, favorite, rename, reuse and move creations to reversible trash.
- Drafts, uploads, original settings, segments and results persist under `studio/data/`. Back up that entire folder with the app stopped. Trash does not permanently erase media.
- Change the appearance with the theme button in the sidebar.

No generation request or connection probe happens on launch. The Generate button remains disabled until you explicitly connect to a CUDA ComfyUI server and finish required setup and install any extras required by your selected settings. See [required setup and optional extras](../docs/model-downloads.md). Loading the app is safe while the Vast instance is stopped.

The header contains the brand, GPU status and a compact theme icon. Recast stays at the top of the sidebar; My library and GPU cloud sit at the bottom, above a divider and Settings. Settings has Connection and Extras tabs. Model-management links in the editor open Settings → Extras directly. Extras shows optional downloads, installed LoRA sizes and removal controls; required files are handled by GPU setup.

## Rent and manage a GPU inside the app

Open **GPU cloud**. All Vast operations use the existing Vast CLI credential at `~/.config/vastai/vast_api_key` as their single source of truth. Remotion reads it for each request, so replacing it also updates marketplace search, favourites, preflight and instance controls without copying the key or restarting the server. There are no in-app key controls, credential write/delete endpoints, environment overrides or app-local credential fallbacks. If credentials are unavailable, configure the Vast CLI and select **Retry connection**. The key stays server-side and is never returned by the API, logged, stored in the browser or sent to the GPU. It needs offer search, instance read/write and SSH public-key read/registration permissions.

The marketplace fetches live compatible single-GPU NVIDIA offers, sorted by the quoted running total. Select 3090, 4090, 5090 or **Datacenter / A-series** (A10, A30, A40, A100 PCIe/SXM4, A800 PCIe and compatible RTX A cards), or browse All GPUs. Only offers meeting the existing memory, RAM, CUDA 13, driver, storage and SSH requirements appear. The A40 has one matched-input benchmark below; other datacenter families still need their own measurements. Select an offer to inspect VRAM, allocated RAM/CPU, host reliability and verification, driver/CUDA support, disk/PCIe/network bandwidth, storage price and transfer fees. The model transfer estimate covers the automatic required bundle. Fresh setup downloads its eight files while installing the runtime. Natural swap with DPO and relighting needs **29.739 GB**, excluding the unused Fast adapter; runtime downloads and setup compute are additional. No speed or quality ranking is invented.

Set disk space **before renting** (64 GB minimum, 80 GB recommended), select your RAM requirement and review the selected offer's total. **Check configuration · no rental** verifies the local tools, private/public SSH-key match, deployment files, tunnel port, existing account public key and the exact rental ask's current hardware and prices. It does not register a key, rent a GPU or start an instance. An offer can still change after a successful check.

**Rent & launch** is the paid action. The server checks local authentication and deployment prerequisites, registers this Mac's public SSH key if needed, then rechecks the exact `ask_contract_id`, hardware, hourly ceiling and download/upload fee ceilings. It creates one on-demand rental using NVIDIA's `cuda:13.0.2-cudnn-devel-ubuntu24.04` image. It waits for running status and SSH, uploads the small project package, installs the pinned runtime and required Natural bundle concurrently, verifies the files and ComfyUI, then opens the private tunnel. Optional adapters are in **Settings → Extras**; selection and Generate never download an extra. It never queues a generation automatically. A previous unconfirmed rental request or compute stop blocks another paid rental.

New rentals include a small startup hook that repairs root SSH directory/key ownership and permissions without replacing keys or disabling OpenSSH checks. This addresses the confirmed RTX A6000 host failure recorded in [the SSH diagnosis](../validation/ssh-permissions-57550828.json). Updating an existing failed rental’s startup configuration is a separate repair; the future-rental hook alone does not alter its current container. Authentication rejection and host-key verification failures now produce different messages.

On instance 57550828, Vast accepted the updated startup script but a normal stop/start reused the old container without applying it. Recreating its empty container in place applied the hook and restored SSH, with root-owned `.ssh` at 0700 and `authorized_keys` at 0600. This was an explicitly authorized repair of a container that had never reached project installation; see [the live repair verification](../validation/ssh-repair-57550828.json). Do not recycle a populated container as a routine retry: Vast's [recycle operation](https://docs.vast.ai/api-reference/instances/recycle-instance) destroys and recreates the container, so its files must be preserved first. Remotion does not perform this operation automatically.

Setup runs on the remote host under a lock. The app displays the actual stages and setup logs. Retry follows or repairs the same rental and reuses verified model files and partial downloads. An ambiguous create response is recovered by its unique instance label; it is never blindly retried as another rental. The app requests a compute stop after recovering a failed or unconfirmed setup. Use **Start & connect** to resume that existing disk deliberately.

A long setup produces a **yellow warning and toast after 15 minutes**, while installation continues. There is no elapsed-time cutoff. Setup shows runtime stages and actual required-file byte counters. Settings → Extras shows transfer progress for explicitly requested extras. Temporary provider/SSH status delays are warnings and retries. Idempotent upload, installer launch and tunnel connection also retry known transient SSH failures; authentication rejection, changed host identity and real program failures remain errors. New setup logs rotate the previous session before following current progress. The [live setup/resume check](../validation/required-setup-live-resume.json) records resumed checkpoint bytes and the GPU storage deletion test. When Vast's status lags, a live SSH check can prove that the selected GPU is reachable and let installation continue.

An actual runtime installer, authentication or runtime validation failure produces a **red message and toast** and requests a compute stop. **Cancel launch & stop compute** and instance stop/destroy remain available. Vast's actual stopped state must be confirmed before the app reports compute stopped. An unconfirmed stop remains visible and is retried. Failed setup retains the disk and partial/verified downloads for retry; storage is still billed.

Closing the browser or local server does not stop healthy remote installation or a ready rental. Reopen the app and use **Reconnect setup** to follow the existing rental. The local server preserves a pending rental ID instead of submitting creation again. Keep it open to receive warnings and handle actual failures. The user remains responsible for stopping/destroying rentals when finished; there is no automatic time-based spending cap.

If a preflight check failed before any rental request, **Retry launch** repeats those checks at the previously approved price ceiling. Existing SSH keys are matched by their key material, including Vast's `public_key` field, regardless of comments or spacing. A concurrent duplicate-key response is accepted only after confirming the exact key on the account. Offers that have disappeared need a fresh marketplace selection.

**My instances** provides start/connect, stop compute and destroy for rentals created here. Other account instances are visible with a Vast console link. Stop keeps the disk and its storage charges. Destroy requires the exact instance ID and deletes the remote disk. Results and inputs already downloaded to this Mac remain in the library. Storage size cannot be changed on an existing Vast container; use a new rental for a different allocation. The dashboard shows provider-reported rates; the listed monthly storage price is not a guarantee of the stopped-instance bill.

API contracts and pricing/lifecycle behavior are based on [Vast's offer search](https://docs.vast.ai/api-reference/search/search-offers), [instance creation](https://docs.vast.ai/api-reference/instances/create-instance), [instance control](https://docs.vast.ai/api-reference/instances/manage-instance) and [storage documentation](https://docs.vast.ai/guides/instances/storage/types), checked on 2026-10-24. Live, read-only checks reproduced the old false-unavailable bug: the search `id` predicate returned no row while the same available rental matched `ask_contract_id`. The lookup now uses the rental ask ID. Contract tests cover pricing, one-time creation, lost-response recovery, non-stopping slow-setup warnings, failure stops, restart/shutdown reconnection, actual stop confirmation, malformed responses and shared CLI credentials with a mocked provider. Existing-rental restart/reconnection and generation have completed on the retained RTX 3090; the latest validation did not create another paid rental.

## Connect an existing manually configured GPU

1. Start the existing instance in Vast. Keep its retained disk. ComfyUI and the models are already installed there.
2. In the app, open **GPU offline**, keep `http://127.0.0.1:8188` and **Restore saved SSH tunnel**, then click **Connect GPU**. The helper starts the existing remote ComfyUI service if necessary and restores the tunnel using `.local/connection.json` and the SSH key already on your Mac.
3. Wait for the actual NVIDIA device name. Review the inputs and settings, then Generate. No automatic demo render is submitted.
4. Stop a Remotion-created instance in **GPU cloud → My instances**, or a manually created one in Vast. Disconnecting or closing this app does not stop compute billing.

If Vast changes the instance's SSH address or port, update it first:

```bash
python3 scripts/vast.py configure --ssh-command 'ssh -p PORT root@HOST'
```

The original manually rented instance was destroyed by the user. Its workflow, inputs and outputs are backed up locally. Subsequent tests use a Remotion-managed retained RTX 3090 instance, which was confirmed paused after the latest test. The manual connection helper remains available for other existing instances. Verified models are reused when an instance retains its disk.

## What happens on Generate

New Character swap jobs first align the complete reference image to the prepared source video's face size and location. This is a uniform scale/translation with no stretching; the original reference stays intact. Preparation runs locally before GPU upload and requires one clear face/actor index 0. It fails before submission if the face is missing or ambiguous. The same aligned reference is reused across all segments. Motion transfer and historical unfinished jobs retain their previous behavior. See [source-framing details and limitations](../docs/source-framing.md).

After a new swap finishes, local checks compare sampled head size and placement. Drift or an unavailable check produces a yellow notice/toast and an amber result label; the completed video remains saved. **Compare source** and the aligned-reference link in Render details support review. Quality warnings never trigger an automatic paid retry or compute stop.

The server validates the media and clip range, normalizes the selected source window without stretching it, transfers both inputs, and validates the compiled graph against the live ComfyUI node catalog before submission. It keeps the model and scheduler on the same LoRA-patched branch. Relighting has its own adapter, leaving two user LoRA slots available.

All new jobs record `renderVersion: continuous-v1` and select native `VAEDecode` for the complete sampled shot, regardless of Fast, Natural or Quality preset. Historical unfinished jobs without that version retain their original tiled decoder during continuation. This avoids silently changing an existing render midway. Native decoding leaves memory handling and any fallback to ComfyUI; it is not a guarantee that every longer or larger shot fits without tiling.

The app opens the native WebSocket before submitting a prompt. Progress displays ComfyUI's current node and its actual counter, for example **2 / 6 steps** or tracking frames. Stages without counters remain indeterminate; there is no estimated global percentage or fabricated live video preview. Completed segments are downloaded before assembly. A longer shot uses five prior generated frames for continuity and removes the overlap from the final result. The source audio is added once after the video segments are joined.

Only one render executes at a time. Repeated submissions with the same request ID return the same job. Each segment records its prompt ID, graph, history and continuity file. Following a disconnect or app restart, the app checks ComfyUI's queue/history before resuming. An accepted prompt whose response was lost is recovered by its client ID and segment prefix. Cancellation uses ComfyUI's targeted job endpoint; an unconfirmed cancellation stays visibly interrupted until checked again. This avoids interrupting unrelated work through a global stop command.

Transient ComfyUI **GET/read** failures are retried. Mutating requests such as prompt submission are not automatically replayed; accepted jobs are recovered through their recorded ID or queue/history evidence instead. A read retry must not create a second paid generation.

## Settings and validation boundary

The factory starting settings remain **Character swap, Fast / 6 steps, 480p, 16 fps, relighting on**. Existing saved drafts and reused render settings retain their chosen values; adding Natural does not silently switch them. The earlier indoor 480p/16 fps example took 123 seconds end to end on the RTX 3090, and subsequent app-driven tests have also completed at 704 × 1248 and 24 fps.

**Natural / 8 steps** is an optional experimental preset: eight steps, CFG 1, Euler, shift 5, and a Wan T2V speed adapter at strength 0.8 for Character swap. Motion transfer retains the I2V speed adapter. **Relight character is a separate switch**, not an implicit part of selecting Natural. The Quality / 20 steps option disables the speed adapter and sets CFG 5, UniPC and shift 3. More steps or a different adapter do not guarantee more natural expressions.

The latest same-input RTX 3090 Natural8 + relighting test exported a **1.5-second, 36-frame clip at 704 × 1248 and 24 fps in 437.558 seconds**. It improved lighting continuity, but eyebrow furrowing, mouth-motion amplitude and a slight center shift still differ from the source. Natural therefore has **not** replaced Fast6 as the default. Because sampling, relighting and decoding changed together in that test, the result does not isolate the contribution of the T2V adapter or relighting.

A separate same-latent decoder control isolates the decoding defect: the former forced tiled decoder reproduces a +0.13032 EV ceiling-brightness jump at frame 24, while native decoding removes that measured jump. This fixes a demonstrated continuity issue, not every facial-expression or skin-texture limitation. See [lighting continuity tests and remaining limits](../docs/lighting-continuity.md).

The local frontend, real GPU submission, completed-media download and offline library playback have now been exercised against the retained RTX 3090. Offline checks also cover uploads, node/schema contracts, real progress counters, two-segment frame/audio assembly, targeted cancellation, read retry and ambiguous-submission recovery using a localhost ComfyUI protocol fixture. That fixture uses FFmpeg media only inside tests; it does not simulate generation in the application.

30 fps, motion transfer, additional user LoRAs and long-shot AI continuity still need GPU quality/memory tests. Higher output fps resamples the input; it does not provide a separate motion interpolation model. Compatible SCAIL-2 LoRAs can be added with `scripts/vast.py push-lora`; reconnect to refresh the installed adapter list. Other model architectures need a compatible workflow branch.

The first user-started A40 observation completed a five-second 704 × 1248 Natural / 8-step render at **16 fps in 12m22s**, estimated at **$0.086** using its $0.418/hour running quote. The previous RTX 3090 Natural run used **24 fps**, took **34m22s** and cost an estimated **$0.112** at $0.196/hour. These are different frame workloads, not a controlled hardware-only benchmark. Similar 81-frame sections were about twice as fast on the A40, with roughly similar/slightly higher section cost; fresh setup/transfer and idle charges are additional. See [the saved comparison](../validation/a40-vs-3090.json) for controls, telemetry and limitations. No extra paid benchmark was submitted.

A follow-up with **identical settings and byte-identical prepared inputs** completed on A40 in **17m14s** at 704 × 1248, **24 fps**, five seconds and Natural / 8 steps, versus **34m22s** on the old RTX 3090. At the saved rates, estimated render cost was **$0.120 versus $0.112**: about half the wait for a 7.1% cost premium. This supersedes the mixed-fps observation as the relevant same-settings comparison. One run per host and differing cache/power/system conditions limit generalization; setup, idle and transfer costs remain extra. See [the matched comparison](../validation/a40-vs-3090-matched.json).

See [the influencer LoRA research](../docs/influencer-lora-research.md) for publisher evidence and the limits of generic realism adapters. No additional adapters have been installed or promoted to default.

## Development

```bash
cd studio
npm run dev
npm run check
npm test
npm run build
```

Development serves the interface at port 5173 and proxies API requests to port 3000. Production uses only port 3000. `RECAST_DATA=/absolute/path` changes the data location; `PORT=3001` changes the local app port. The GPU connection stays private on the configured local tunnel. The app has no public hosting or account/authentication layer and should remain bound to loopback.

For isolated visual checks, `npx tsx tests/preview.ts` creates a temporary database at port 3002 with explicitly labeled sample offers and all rental creation disabled. This is separate from the production app and uses no account credential. Stop it with Ctrl+C after reviewing the screens.
