# Recast Studio

A local dashboard for the project's SCAIL-2 INT8 character swap workflow. The browser and library run on your Mac. NVIDIA inference stays on the rented Vast GPU, accessed through the saved private SSH tunnel.

From the project root:

```bash
bash scripts/studio.sh
```

Open **http://127.0.0.1:3000**. The launcher checks Node.js 24+, npm, Python 3, FFmpeg and FFprobe; installs the locked Node dependencies if missing; builds the app; and starts it on loopback. It never rents, starts or bills a Vast instance. Existing dependencies are already installed on this Mac.

## Working offline

- Upload one motion video and one character image, write a prompt, and adjust settings.
- Preview the three imported real RTX 3090 renders, compare each against its source, download videos or export their API workflows.
- Search, sort, favorite, rename, reuse and move creations to reversible trash.
- Drafts, uploads, original settings, segments and results persist under `studio/data/`. Back up that entire folder with the app stopped. Trash does not permanently erase media.
- Change the appearance with the theme button in the sidebar.

No generation request or connection probe happens on launch. The Generate button remains disabled until you explicitly connect to a CUDA ComfyUI server. Loading the app is safe while the Vast instance is stopped.

## Rent and manage a GPU inside the app

Open **GPU cloud → Connect Vast**. Enter a Vast API key in the local password field; do not put it in a chat message. The local server validates it and saves it under `studio/data/private/` with folder mode 0700 and file mode 0600. The key is not returned by the API, stored in browser storage, logged or sent to the GPU. `VAST_API_KEY` in the server environment is also supported. The key needs offer search, instance read/write and SSH public-key read/registration permissions.

The marketplace fetches live compatible single-GPU RTX offers, including 3090, 4090 and 5090, sorted by the quoted running total. Select an offer to inspect VRAM, allocated RAM/CPU, host reliability and verification, driver/CUDA support, disk/PCIe/network bandwidth, storage price and transfer fees. The model download fee is a lower-bound estimate for the 29.846 GB model bundle; runtime downloads and setup compute are additional. No speed or quality ranking is invented.

Set disk space **before renting** (64 GB minimum, 80 GB recommended), select your RAM requirement and review the selected offer's total. **Check configuration · no rental** verifies the local tools, private/public SSH-key match, deployment files, tunnel port, existing account public key and the exact rental ask's current hardware and prices. It does not register a key, rent a GPU or start an instance. An offer can still change after a successful check.

**Rent & launch** is the paid action. The server checks local authentication and deployment prerequisites, registers this Mac's public SSH key if needed, then rechecks the exact `ask_contract_id`, hardware, hourly ceiling and download/upload fee ceilings. It creates one on-demand rental using NVIDIA's `cuda:13.0.2-cudnn-devel-ubuntu24.04` image. It waits for running status and SSH, uploads the small project package, installs the pinned runtime and models plus relighting, checks ComfyUI and opens the private tunnel. It never queues a generation automatically. A previous unconfirmed rental request or compute stop blocks another paid rental.

Setup runs on the remote host under a lock. The app displays the actual stages and setup logs. Retry follows or repairs the same rental and reuses verified model files and partial downloads. An ambiguous create response is recovered by its unique instance label; it is never blindly retried as another rental. The app requests a compute stop after recovering a failed or unconfirmed setup. Use **Start & connect** to resume that existing disk deliberately.

A long setup produces a **yellow warning and toast after 15 minutes**, while installation continues. There is no elapsed-time cutoff. The setup panel shows the model downloader's real per-file percentages. Temporary provider/SSH status delays are warnings and retries. When Vast's status lags, a live SSH check can prove that the selected GPU is reachable and let installation continue.

An actual installer, authentication, checksum or runtime validation failure produces a **red message and toast** and requests a compute stop. **Cancel launch & stop compute** and instance stop/destroy remain available. Vast's actual stopped state must be confirmed before the app reports compute stopped. An unconfirmed stop remains visible and is retried. Failed setup retains the disk and partial/verified downloads for retry; storage is still billed.

Closing the browser or local server does not stop healthy remote installation or a ready rental. Reopen the app and use **Reconnect setup** to follow the existing rental. The local server preserves a pending rental ID instead of submitting creation again. Keep it open to receive warnings and handle actual failures. The user remains responsible for stopping/destroying rentals when finished; there is no automatic time-based spending cap.

If a preflight check failed before any rental request, **Retry launch** repeats those checks at the previously approved price ceiling. Existing SSH keys are matched by their key material, including Vast's `public_key` field, regardless of comments or spacing. A concurrent duplicate-key response is accepted only after confirming the exact key on the account. Offers that have disappeared need a fresh marketplace selection.

**My instances** provides start/connect, stop compute and destroy for rentals created here. Other account instances are visible with a Vast console link. Stop keeps the disk and its storage charges. Destroy requires the exact instance ID and deletes the remote disk. Results and inputs already downloaded to this Mac remain in the library. Storage size cannot be changed on an existing Vast container; use a new rental for a different allocation. The dashboard shows provider-reported rates; the listed monthly storage price is not a guarantee of the stopped-instance bill.

API contracts and pricing/lifecycle behavior are based on [Vast's offer search](https://docs.vast.ai/api-reference/search/search-offers), [instance creation](https://docs.vast.ai/api-reference/instances/create-instance), [instance control](https://docs.vast.ai/api-reference/instances/manage-instance) and [storage documentation](https://docs.vast.ai/guides/instances/storage/types), checked on 2026-10-24. Live, read-only checks reproduced the old false-unavailable bug: the search `id` predicate returned no row while the same available rental matched `ask_contract_id`. The lookup now uses the rental ask ID. Contract tests cover pricing, one-time creation, lost-response recovery, non-stopping slow-setup warnings, failure stops, restart/shutdown reconnection, actual stop confirmation, malformed responses and private key storage with a mocked provider. A real paid API provisioning test remains pending a rental selected in the app.

## Connect an existing manually configured GPU

1. Start the existing instance in Vast. Keep its retained disk. ComfyUI and the models are already installed there.
2. In the app, open **GPU offline**, keep `http://127.0.0.1:8188` and **Restore saved SSH tunnel**, then click **Connect GPU**. The helper starts the existing remote ComfyUI service if necessary and restores the tunnel using `.local/connection.json` and the SSH key already on your Mac.
3. Wait for the actual NVIDIA device name. Review the inputs and settings, then Generate. No automatic demo render is submitted.
4. Stop a Recast-created instance in **GPU cloud → My instances**, or a manually created one in Vast. Disconnecting or closing this app does not stop compute billing.

If Vast changes the instance's SSH address or port, update it first:

```bash
python3 scripts/vast.py configure --ssh-command 'ssh -p PORT root@HOST'
```

The previously rented instance was destroyed by the user. Its workflow, inputs and outputs are backed up locally; GPU cloud creates its replacement. The manual connection helper is retained for existing instances. Verified models are reused when an instance retains its disk.

## What happens on Generate

The server validates the media and clip range, normalizes the selected source window without stretching it, transfers both inputs, and validates the compiled graph against the live ComfyUI node catalog before submission. It keeps the model and scheduler on the same LoRA-patched branch. Relighting has its own adapter, leaving two user LoRA slots available.

The app opens the native WebSocket before submitting a prompt. Progress displays ComfyUI's current node and its actual counter, for example **2 / 6 steps** or tracking frames. Stages without counters remain indeterminate; there is no estimated global percentage or fabricated live video preview. Completed segments are downloaded before assembly. A longer shot uses five prior generated frames for continuity and removes the overlap from the final result. The source audio is added once after the video segments are joined.

Only one render executes at a time. Repeated submissions with the same request ID return the same job. Each segment records its prompt ID, graph, history and continuity file. Following a disconnect or app restart, the app checks ComfyUI's queue/history before resuming. An accepted prompt whose response was lost is recovered by its client ID and segment prefix. Cancellation uses ComfyUI's targeted job endpoint; an unconfirmed cancellation stays visibly interrupted until checked again. This avoids interrupting unrelated work through a global stop command.

## Settings and validation boundary

The existing GPU-tested starting point is **Character swap, Fast / 6 steps, 480p, 16 fps, relighting on**, with one clear adult subject and a fixed camera. The indoor example took 123 seconds end to end on the RTX 3090. This is a prior ComfyUI result, not a timing benchmark of the new frontend.

The 20-step option disables the speed adapter and sets CFG 5, UniPC and shift 3. 704p, 24/30 fps, motion transfer, additional user LoRAs and long-shot AI continuity still need GPU quality/memory tests. They are settings to evaluate, not claims of improved quality. Higher output fps resamples the input; it does not provide a separate motion interpolation model. Compatible SCAIL-2 LoRAs can be added with the existing `scripts/vast.py push-lora` command; reconnect to refresh the installed adapter list. Other model architectures need a compatible workflow branch.

The frontend has not yet completed an end-to-end test against the rented GPU. Offline checks cover real uploads, native API/schema contracts, reported progress, two-segment frame/audio assembly, targeted cancellation and ambiguous-submission recovery using a localhost ComfyUI protocol fixture. That fixture uses FFmpeg media and is confined to tests; it does not simulate generation in the application.

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
