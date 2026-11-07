# Image Edit · Qwen Image 2.1 INT8

The separate Image Edit module on `feat/openjutsu-remotion` now uses Qwen Image 2.1 INT8, the requested consistency LoRA and **BFS V1.1 alternative**. The user explicitly selected the alternative after clarifying the photorealistic variant. There is no weight named “Photorealism” in the linked repository. The original Imagen modes, Remotion/OpenJutsu generation, native Fix Faces and separate Kie API app remain independent.

Start this branch with `bash scripts/openjutsu-studio.sh`, open `http://127.0.0.1:3003`, and choose **Image Edit**. Refresh after an update.

## Inputs and controls

The same one-to-three ordered PNG/JPEG/WebP references (10 MB each), multi-image drag/drop, direct prompt, native canvas/aspect, seed, PNG/JPEG export, original/result comparison and native PNG download remain. Your saved reference order and prompt are retained. No mask editor or automatic Imagen/body/face post-processing is introduced. The complete prompt is sent verbatim, including spacing and language.

For BFS, use Image 1 as the target and Image 2 as the head/identity donor. Image 3 is optional extra reference evidence whose role should be stated in the prompt. The BFS author’s published contract demonstrates two images; support for a third image comes from Qwen’s native encoder, and does not establish multi-sheet identity accuracy. **Use head-swap starter** explicitly replaces the editable prompt with a short role-based `head_swap:` instruction; no prefix is silently inserted.

Both LoRAs default on at the authors’ starting strength of 1. Advanced settings offer separate switches: turn BFS off for generic clothing/scenery edits, and turn consistency off when intentionally changing pose/head direction or doing a major removal. Switching changes only the explicit download plan and next run, never existing paid output.

## Necessary model-specific changes

| Control | New Qwen 2.1 recipe |
|---|---|
| Base | `qwen_image_2.1_int8_convrot.safetensors` |
| Encoder | `qwen3vl_8b_int8_convrot.safetensors` |
| VAE | `qwen_image_2.1_vae_bf16.safetensors` |
| Consistency | `qwen-image-2.1-consistency.safetensors`, step 1500, strength 1 |
| BFS | `bfs_head_v1.1_alternative_qwen_2.1.safetensors`, strength 1 |
| Native | 40 steps, CFG 1, Euler/simple, denoise 1 |
| Turbo | 8 steps, CFG 1, matching official Qwen 2.1 Turbo LoRA |

Native remains the default and preserves the existing forty-step choice. The old four-step Lightning draft choice migrates to eight-step Turbo; the old BF16 option migrates to the requested INT8 base. Other controls retain their selected values. The legacy 2511 Lightning adapter, encoder, VAE and flow shift are never mixed into new 2.1 graphs. The published BFS example uses optional Pruna acceleration; this implementation reuses the project’s existing official Qwen 2.1 Turbo file rather than claiming byte parity with that example.

`TextEncodeQwenImage21` runs at resolution 0. The sampler uses that encoder’s latent output, avoiding the size-ratio zoom warned about by the consistency author. To retain the requested output canvas, local preparation fits the complete first image to its dimensions with equal-axis scaling and centered white padding if needed. References 2/3 remain complete and unmodified apart from normal decoding/alpha flattening; the encoder handles its own reference budget. No image is cropped or stretched and no paid output is enlarged. The Qwen 2.1 RGBA decoder is explicitly split to photographic RGB. Native PNG bytes remain saved; JPEG export/retry is local and never resamples the model.

## Explicit downloads and storage

Click **Download Image Edit** after choosing sampling and LoRA switches. Selecting settings or submitting a generation does not silently download files or start compute. Existing resumable, hash-checked downloads, inventory reconciliation, per-file deletion and queue/instance protections are reused.

With both requested LoRAs enabled, native selects five files totaling **17,761,348,616 bytes**; Turbo selects six totaling **18,674,663,128 bytes**. The 9,350,798,360-byte Qwen3 VL encoder is shared with Remotion. If already installed, additional native files total about **8.41 GB**, or **9.32 GB** for Turbo. No old 2511 weights are deleted. Disabled adapters are omitted from both graphs and download requirements. Setup size is disk usage, not a VRAM guarantee.

## History, recovery and validation

New runs freeze `image-edit-qwen21-v1`, ordered source hashes/provenance, exact prompt, native dimensions, resolved seed, sampling and both adapter switches. Original `image-edit-2511-v1` jobs retain their compiler, preprocessing, files, sampling, receipts, displayed metadata and offline export/recovery. Reuse copies editable inputs into the new model; it does not rewrite an old run. Twelve independent pre-change graph hashes plus the two actual completed local 2511 jobs compile identically.

All 714 Studio checks, 384 Python checks (one skip), typecheck and production build pass. The first broad Python invocation used the geometry-only environment and lacked Torch; the complete rerun used the existing Comfy validation environment without installing anything. Six new graphs (one/two/three references, native/Turbo) match the live GPU node-input contract after excluding unavailable model/media filenames. These checks do not load weights or run inference. Visual quality, identity, speed and memory for the combined LoRAs remain unmeasured. Native browser review remains unavailable because computer use was restricted on the current URL.

## Sources

- [BFS Qwen 2.1 guide, including the alternative variant and two-image contract](https://huggingface.co/Alissonerdx/BFS-Best-Face-Swap/blob/main/docs/qwen-image-2.1.md).
- [Consistency LoRA author’s recipe, encoder-latent requirement and limitations](https://huggingface.co/ausboss/Qwen-Image-2.1-Consistency-LoRA).
- [The requested Civitai listing](https://civitai.com/models/2969143/qwen-image-21-consistency-lora). Its API file SHA256 matches the already-pinned Hugging Face step-1500 file.
- [Comfy-Org Qwen 2.1 files and supported eight-step Turbo adapters](https://huggingface.co/Comfy-Org/Qwen-Image-2.1).

Pins and licenses remain in the model manifests; Qwen 2.1 and consistency follow Qwen Research terms. See the sanitized [validation receipt](validation/image-edit-qwen21-20261107.json).

The idle local rollout preserved all twelve current jobs, fourteen assets and other drafts after the user’s Fix Faces run completed. Port 3003 serves the new Image Edit UI/backend; main/Kie processes remain unchanged. GPU connection and native Face tools are still ready. New Qwen weights require the user’s explicit Download Image Edit action.
