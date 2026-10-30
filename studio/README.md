# Recast

A local dashboard for Viggle Animate video replacement (Remotion), Qwen Image 2.1 photo replacement (Imagen), saved Characters, Library and a lightweight clip editor. The browser and library run on your computer. NVIDIA inference stays on the rented Vast GPU, accessed through the saved private SSH tunnel. Historical SCAIL jobs keep their original models and graphs; that engine is disabled for new Studio work.

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
- Change the appearance with the theme icon in the top bar; collapse the sidebar using its own toggle.
- Save body/face sheets in Characters and select an exact view for Imagen. Preview/trim media and use the local clip editor without a GPU.

Launching the local app does not rent/resume compute or submit inference. Generate requires a connected compatible GPU and the exact files/runtime for the selected settings. Setup installs a blank engine; all weights require an explicit download action. Selection, refresh and Generate never download missing models. See [on-demand files](../docs/model-downloads.md). Library and previews stay usable while the GPU is stopped.

The header contains the brand, GPU status/compute control and theme icon. The collapsible sidebar groups Remotion, Imagen and Characters, the Clip editor, then Library/GPU cloud shortcuts above Settings. Settings has Connection, Downloads, Extras and Alerts. Downloads is the complete per-instance model inventory with sizes, workflow uses and explicit controls; Extras contains optional adapters. Required files download explicitly beside their options or through Downloads. Verified LoRAs can be deleted when no render/transfer is using them; core checkpoints/encoders remain protected.

**Settings → Alerts** enables desktop notifications, sound/volume controls and event switches for GPU status, model downloads, image/video generations and clip exports. Sounds activate after interacting with the page. Desktop notifications request browser permission only when enabled, appear while away, and open the relevant result or management screen. Keep a Recast tab and the local app running. See [the alert guide](../docs/alerts.md).

## Rent and manage a GPU inside the app

Open **GPU cloud → Set up Vast account** (or **Account** if already configured). Paste your own [Vast API key](https://cloud.vast.ai/manage-keys/), then choose **Create or reuse a Recast key** or **Use my existing SSH key** with its local private-key path. Click **Verify & save**. The same form is available in **Settings → Connection → Account & SSH keys**. Verification only reads account instances and registered public keys; it does not rent/start a GPU or register a key. A Vast CLI installation is optional. The API key needs offer search, instance read/write and SSH public-key read/registration permissions. See [the first-run guide](../docs/user-setup.md).

All Vast operations continue to read `~/.config/vastai/vast_api_key` for each request. The UI saves to this same CLI-compatible file atomically with owner-only permissions; it does not create a second credential source. Leave the API-key field blank to keep the saved key. Neither the saved API key nor private SSH contents is returned by the API, stored in browser preferences, included in renders or sent to a GPU. The transient password field clears after saving/closing. Only the public SSH key is registered when launching a GPU. Encrypted private keys must already be unlocked in `ssh-agent`; Recast does not save passphrases.

Generated SSH keys belong to this installation under `studio/data/private/`; an existing `~/.ssh/comfyui_vast` remains the legacy default until explicitly changed. Selecting a new default preserves each retained Recast rental's original SSH-key path. Updates are blocked during active work or unresolved rental/stop requests, and a replacement API key must still access retained rentals. Account public-key registration alone does not repair access to an already-created instance; use its Vast key controls if it was created outside Recast.

The marketplace fetches compatible single-GPU NVIDIA offers, sorted by the quoted running total. Use the RTX filters or **Datacenter** with model selection for supported A/RTX PRO, A100/H100 and Blackwell families. Hardware families are not a measured speed ranking; experimental ARM hosts have separate compatibility limits. Select an offer to inspect GPU/RAM/CPU allocation, reliability, driver/CUDA, disk/PCIe/network bandwidth and separate compute/storage/transfer fees. New rentals and favourite availability require a known ingress price no higher than **$0.005/GB**, checked both in discovery and against the exact rental ask. The transfer estimate reflects selected model files; runtime packages and billed setup time are additional.

Set disk space **before renting** (64 GB minimum, 80 GB recommended), select your RAM requirement and review the selected offer's total. **Check configuration · no rental** verifies the local tools, private/public SSH-key match, deployment files, tunnel port, account SSH-key status and the exact rental ask's current hardware and prices. A valid local public key that is not registered yet passes with a message that launch will register it. The check does not register a key, rent a GPU or start an instance. An offer can still change after a successful check.

**Rent & launch** is the paid action. The server checks local prerequisites, registers this computer's public SSH key if necessary, then rechecks the exact rental ask, hardware and approved prices/fees. It creates one on-demand rental using a small architecture-matched CUDA base image, waits for SSH, uploads the project package and installs the pinned **blank engine**. It verifies ComfyUI and opens the private tunnel. Download only the selected files afterward; no sample render or model download is queued by launch itself. An unconfirmed rental request or compute stop blocks another paid rental.

New rentals include a small startup hook that repairs root SSH directory/key ownership and permissions without replacing keys or disabling OpenSSH checks. This addresses the confirmed RTX A6000 host failure recorded in [the SSH diagnosis](../validation/ssh-permissions-57550828.json). Updating an existing failed rental’s startup configuration is a separate repair; the future-rental hook alone does not alter its current container. Authentication rejection and host-key verification failures now produce different messages.

On instance 57550828, Vast accepted the updated startup script but a normal stop/start reused the old container without applying it. Recreating its empty container in place applied the hook and restored SSH, with root-owned `.ssh` at 0700 and `authorized_keys` at 0600. This was an explicitly authorized repair of a container that had never reached project installation; see [the live repair verification](../validation/ssh-repair-57550828.json). Do not recycle a populated container as a routine retry: Vast's [recycle operation](https://docs.vast.ai/api-reference/instances/recycle-instance) destroys and recreates the container, so its files must be preserved first. Recast does not perform this operation automatically.

Setup runs on the remote host under a lock. The app displays the actual stages and setup logs. Retry follows or repairs the same rental and reuses verified model files and partial downloads. An ambiguous create response is recovered by its unique instance label; it is never blindly retried as another rental. The app requests a compute stop after recovering a failed or unconfirmed setup. Use **Start & connect** to resume that existing disk deliberately.

A long setup produces a **yellow warning and toast after 15 minutes**, while installation continues. There is no elapsed-time cutoff. Setup shows actual runtime stages/logs. Explicit model transfers show byte counters beside their controls and in Settings → Downloads/Extras. Temporary provider/SSH status delays are warnings and retries. Idempotent upload, installer launch and tunnel connection also retry known transient SSH failures; authentication rejection, changed host identity and real program failures remain errors. New setup logs rotate the previous session before following current progress. The [live setup/resume check](../validation/required-setup-live-resume.json) records resumed checkpoint bytes and the GPU storage deletion test. When Vast's status lags, a live SSH check can prove that the selected GPU is reachable and let installation continue.

An actual runtime installer, authentication or runtime validation failure produces a **red message and toast** and requests a compute stop. **Cancel launch & stop compute** and instance stop/destroy remain available. Vast's actual stopped state must be confirmed before the app reports compute stopped. An unconfirmed stop remains visible and is retried. Failed setup retains the disk and partial/verified downloads for retry; storage is still billed.

Closing the browser or local server does not stop healthy remote installation or a ready rental. Reopen the app and use **Reconnect setup** to follow the existing rental. The local server preserves a pending rental ID instead of submitting creation again. Keep it open to receive warnings and handle actual failures. The five-minute idle pause, when enabled, waits for all generation, face processing and transfers to finish and independently verifies the remote queue before stopping compute. It does not impose a runtime limit on healthy work. Keep the local server running for this monitor. Manual stop/destroy remains available; retained storage is still billed.

If a preflight check failed before any rental request, **Retry launch** repeats those checks at the previously approved price ceiling. Existing SSH keys are matched by their key material, including Vast's `public_key` field, regardless of comments or spacing. A concurrent duplicate-key response is accepted only after confirming the exact key on the account. Offers that have disappeared need a fresh marketplace selection.

**My instances** provides start/connect, stop compute and destroy for rentals created here. Other account instances are visible with a Vast console link. Stop keeps the disk and its storage charges. Destroy requires the exact instance ID and deletes the remote disk. Results and inputs already downloaded to this Mac remain in the library. Storage size cannot be changed on an existing Vast container; use a new rental for a different allocation. The dashboard shows provider-reported rates; the listed monthly storage price is not a guarantee of the stopped-instance bill.

API contracts and pricing/lifecycle behavior are based on [Vast's offer search](https://docs.vast.ai/api-reference/search/search-offers), [instance creation](https://docs.vast.ai/api-reference/instances/create-instance), [instance control](https://docs.vast.ai/api-reference/instances/manage-instance) and [storage documentation](https://docs.vast.ai/guides/instances/storage/types), checked on 2026-10-24. Live, read-only checks reproduced the old false-unavailable bug: the search `id` predicate returned no row while the same available rental matched `ask_contract_id`. The lookup now uses the rental ask ID. Contract tests cover pricing, one-time creation, lost-response recovery, non-stopping slow-setup warnings, failure stops, restart/shutdown reconnection, actual stop confirmation, malformed responses and shared CLI credentials with a mocked provider. Existing-rental restart/reconnection and generation have completed on the retained RTX 3090; the latest validation did not create another paid rental.

## Connect an existing manually configured GPU

1. Start the existing instance in Vast. Keep its retained disk. ComfyUI and the models are already installed there.
2. In the app, open **GPU offline**, keep `http://127.0.0.1:8188` and **Restore saved SSH tunnel**, then click **Connect GPU**. The helper starts the existing remote ComfyUI service if necessary and restores the tunnel using `.local/connection.json` and the SSH key already on your Mac.
3. Wait for the actual NVIDIA device name. Review the inputs and settings, then Generate. No automatic demo render is submitted.
4. Stop a Recast-created instance in **GPU cloud → My instances**, or a manually created one in Vast. Disconnecting or closing this app does not stop compute billing.

If Vast changes the instance's SSH address or port, update it first:

```bash
python3 scripts/vast.py configure --ssh-command 'ssh -p PORT root@HOST'
```

The original manually rented instance was destroyed by the user. Its workflow, inputs and outputs are backed up locally. Subsequent tests use a Recast-managed retained RTX 3090 instance, which was confirmed paused after the latest test. The manual connection helper remains available for other existing instances. Verified models are reused when an instance retains its disk.

## What happens on Generate

The app validates the clip range, prepared reference, exact model inventory and frozen character/face options before paid submission. Viggle's prepared-frame route uses an edited frame from the same shot, preserving source framing and native 24 fps. Review that image first: a wrong identity anchor is not repaired by motion propagation. Use [Imagen's concise native recipe](../docs/imagen-consistency-20261029.md) for the source frame. Automatic Klein preparation stays unavailable when its files are absent; it never silently downloads them.

Long clips use bounded 124-frame native windows and strict saved continuation receipts. The current default passes the previous raw last frame as appearance, with separate five-frame motion anchors. Optional [Imagen face refresh](../docs/remotion-imagen-segment-refresh.md) freezes the saved character/views and repaints a visible face before the next window, preserving pixels outside its scope. Hidden/uncertain faces skip with a warning; this is not cut detection or a per-frame identity guarantee. Old original-reference and historical paid jobs keep their original contracts.

In **Advanced settings → Reference frame position**, a [later edited reference](../docs/later-frame-reference.md) can drive earlier motion backward and later motion forward. Match the source moment explicitly; known Imagen frames carry their timestamp. The two directions run serially, then join in the original order with one anchor and source audio. Saved branches resume independently; a completed branch is never silently sampled again.

**Advanced settings → Facial consistency** offers Off, Standard + ONNX 60% and Regional + ONNX 60%. Either selected route automatically applies source-driven PerformRecast and fixed-reference identity correction after complete assembly. No Library button is needed. Explicit setup installs twelve shared ONNX files / 2.227 GB and a separate GPU runtime; preflight checks the single prepared-frame face before paid video sampling. [Automatic facial pipeline, timings and terms](../docs/automatic-facial-consistency.md). The local CPU preference for older Library actions does not change this GPU-only automatic pass.

The simplified loader estimates overall completion from recorded stages and native counters, starts at zero, holds when work stalls and reaches 100 only when the result is playable. Its inline detail view shows the actual stage/segment counters. Completed native outputs and continuation files are saved locally before proceeding. Source audio is added once. A framing warning never silently rerenders the paid result.

The [combined RTX PRO 5000 test](../docs/validation/later-frame-reference-20261029.md) measured the full nine-second/704p backward-forward + Imagen refresh + automatic face pipeline at 12m34s. These features add work; no universal sub-three-minute target, flawless hands, exact gaze or identity lock is claimed. Sampling/reference quality still matters.

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
