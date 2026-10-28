# Blank engine and on-demand models

Studio starts a ComfyUI engine without downloading model weights, unused adapters or example media. This is the user's updated preference of 2026-10-25 and replaces automatic Natural-bundle installation. Engine connected and render ready are separate states. Render submission remains blocked until every file needed by the current settings is installed.

In Recast, **Files for these settings** lists the exact core files and active adapters. Click its download button to prepare the current recipe, or expand **View individual files** to download a single file. Changing presets, relighting, detail or LoRA selection starts no transfer. Quality 12/16/20 does not request a speed adapter; disabled relighting requests no relighting adapter. Existing verified files are reused.

All adapters are opt-in under Settings → Extras, including Natural and Fast acceleration, DPO detail, relighting and style/identity LoRAs. Core checkpoints and encoders appear in the per-recipe file list, not in Extras. File downloads use up to four concurrent workers, resumable partial files, per-file locks and pinned SHA256 checks. Progress counters normally update about once a second while data is flowing; SHA256 verification is shown separately. A network stall can still delay new bytes. No artificial progress or healthy-transfer time cutoff is used.

`config/setup-models.json` now describes the optional full Natural recipe: eight pinned files totaling **29,738,555,883 bytes / 29.74 GB**. It is not a startup download plan. The five shared core files alone total **26.65 GB**. Removing an inactive adapter reduces that recipe's download, but cannot remove its backbone or encoders.

A cached healthy engine skips apt/pip installation and verifies only the runtime on reconnect. `RECAST_SETUP_MODE=required python3 scripts/setup_required.py` remains an explicit CLI option for the complete Natural bundle. `python3 scripts/setup_required.py` defaults to runtime only.

## Settings → Extras

The Extras tab contains all optional adapters and custom uploaded LoRAs. Download buttons remain beside the corresponding quality, lighting and detail options in Recast.

| Extra | Download size | Purpose |
|---|---:|---|
| Fast / motion acceleration | 738,005,744 bytes / 738 MB | Fast 6-step generation and Natural in Motion transfer |
| Social media style · Instagooner | 613,557,448 bytes / 614 MB | Experimental influencer/phone-camera style LoRA for the Wan 2.1 14B backbone |

The style adapter remains disabled after download. **Use in LoRA A** selects it at an experimental starting strength of 0.35. Its publisher trigger `instag00n` is included in new compiled prompts while that adapter has a nonzero strength; it is omitted when disabled. Existing unstyled graphs and pre-harness continuation prompts remain unchanged. There is no measured SCAIL-2 video-quality improvement yet. See [the original research](influencer-lora-research.md).

The style file is pinned to a public Hugging Face mirror with the same size and SHA256 as the publisher's Civitai record. Civitai's download endpoint required authentication when checked; the pinned mirror is publicly downloadable. Its 400 adapter module pairs match the SCAIL-2 checkpoint's layer dimensions. That header comparison is structural evidence, not a test of LoRA application or visual quality. Model-card image examples do not establish temporal consistency or uncensored behavior.

Optional downloads require an explicit download button. Selecting a quality, lighting, detail or LoRA option does not start a transfer. Resolution, frame rate, duration and framing share the same model files. Generate validates all files required by the selected settings before creating a paid job and never downloads missing extras automatically.

## Remove optional LoRAs

The trash button beside an installed extra removes its weights, partial download and verification stamp from the connected managed GPU. The tab also inventories uploaded `.safetensors` LoRAs, including files in subfolders, and shows how much space extras use. A successful removal reports the actual removed byte count, refreshes ComfyUI's choices and clears matching LoRA A/B selections in the current draft. Saved videos and historical job settings remain untouched. Files can be downloaded again later; removal does not resize the rented disk.

Deletion is unavailable during setup, rendering or model transfers. The backend independently enforces those checks, validates the managed instance and saved tunnel, rejects path traversal, refuses symlinked/linked targets, and takes the same file lock used by downloads. It cannot delete checkpoints, encoders, reference media or arbitrary remote paths through this endpoint. A removal failure is reported without claiming freed space.

## Files and CLI

Pinned source revisions, sizes and hashes live in the existing base/Natural/relighting manifests and `config/extra-models.lock.json`. Add future optional adapters there and provide their UI metadata in `studio/shared/models.ts`; include them only in recipes that actually use them. Test backbone compatibility and video results separately.

Studio's marketplace model-transfer estimate describes the full Natural recipe only if requested; startup downloads no weights. Runtime downloads, compute and host-specific transfer rates are additional. Allocated storage remains billed independently of installed-file size, and destroying a rental removes its remote cache.

The standalone `vast.py setup`, `bootstrap.sh` and default managed path are runtime-only tools. The legacy standalone Fast graphs also need the optional I2V acceleration file; download it explicitly from Extras or with the pinned base manifest. `doctor.py --runtime-only` checks the runtime, and is the engine-startup check; requested downloads are checked separately before rendering.
