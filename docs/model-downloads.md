# Required setup and optional extras

Studio setup installs the ComfyUI runtime and automatically downloads the required bundle. On a fresh GPU the two jobs run concurrently; an existing healthy runtime is reused. Setup reports Ready only after the CUDA, workflow schema and required-file integrity checks pass. Connecting the app or clicking Generate never downloads an optional extra or queues a render.

`config/setup-models.json` selects eight pinned files totaling **29,738,555,883 bytes / 29.74 GB**: SCAIL-2 INT8, the text and reference encoders, video VAE, person tracker, Natural T2V acceleration, SCAIL-2 DPO detail and replacement relighting. Natural / 8 steps is the default for new drafts. Current saved drafts and historical jobs retain their settings. The measured Natural rendering recipe is unchanged.

Setup downloads at most two model files concurrently with the runtime installer. It reserves working space for runtime packages, resumes partial files, verifies SHA256 and uses per-file locks. The setup card retains actual per-file byte counters independently of the trimmed log, including checksum verification. A slow setup warns after 15 minutes and continues. An actual setup failure requests a compute stop; completed weights and partial files remain for retry. Reconnecting an existing rental checks the required bundle again rather than repeating successful transfers.

## Settings → Extras

The Extras tab contains optional downloads and custom uploaded LoRAs; it does not list the eight included setup files as separate downloads.

| Extra | Download size | Purpose |
|---|---:|---|
| Fast / motion acceleration | 738,005,744 bytes / 738 MB | Fast 6-step generation and Natural in Motion transfer |
| Social media style · Instagooner | 613,557,448 bytes / 614 MB | Experimental influencer/phone-camera style LoRA for the Wan 2.1 14B backbone |

The style adapter remains disabled after download. **Use in LoRA A** selects it at an experimental starting strength of 0.35. Its publisher trigger `instag00n` is included in new compiled prompts while that adapter has a nonzero strength; it is omitted when disabled. Existing unstyled graphs and pre-harness continuation prompts remain unchanged. There is no measured SCAIL-2 video-quality improvement yet. See [the original research](influencer-lora-research.md).

The style file is pinned to a public Hugging Face mirror with the same size and SHA256 as the publisher's Civitai record. Civitai's download endpoint required authentication when checked; the pinned mirror is publicly downloadable. Its 400 adapter module pairs match the SCAIL-2 checkpoint's layer dimensions. That header comparison is structural evidence, not a test of LoRA application or visual quality. Model-card image examples do not establish temporal consistency or uncensored behavior.

Optional downloads require an explicit download button. Selecting a quality, lighting, detail or LoRA option does not start a transfer. Resolution, frame rate, duration and framing share the same model files. Generate validates all files required by the selected settings before creating a paid job and never downloads missing extras automatically.

## Remove optional LoRAs

The trash button beside an installed extra removes its weights, partial download and verification stamp from the connected managed GPU. The tab also inventories uploaded `.safetensors` LoRAs, including files in subfolders, and shows how much space extras use. A successful removal reports the actual removed byte count, refreshes ComfyUI's choices and clears matching LoRA A/B selections in the current draft. Saved videos and historical job settings remain untouched. Files can be downloaded again later; removal does not resize the rented disk.

Deletion is unavailable during setup, rendering or model transfers. The backend independently enforces those checks, validates the managed instance and saved tunnel, rejects required setup adapters and path traversal, refuses symlinked/linked targets, and takes the same file lock used by downloads. It cannot delete checkpoints, encoders, reference media or arbitrary remote paths through this endpoint. A removal failure is reported without claiming freed space.

## Files and CLI

Pinned source revisions, sizes and hashes live in the existing base/Natural/relighting manifests and `config/extra-models.lock.json`. Add future optional adapters there and provide their UI metadata in `studio/shared/models.ts`; leave them out of `config/setup-models.json`. Test backbone compatibility and video results separately.

Studio's marketplace transfer estimate covers the automatic required bundle, excluding extras. Runtime downloads, compute and host-specific transfer rates are additional. Allocated storage remains billed independently of installed-file size, and destroying a rental removes its remote cache.

The standalone `vast.py setup` / `bootstrap.sh` path remains a runtime-only tool for manually managed ComfyUI. On that GPU, `python3 scripts/setup_required.py` installs/checks the same automatic Natural bundle. The legacy standalone Fast graphs also need the optional I2V acceleration file; download it explicitly from Extras or with the pinned base manifest. `doctor.py --runtime-only` checks the runtime, while Studio's final check uses the generated required-bundle manifest.
