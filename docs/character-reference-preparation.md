# Face and body reference preparation

## Current capability

The downloaded SCAIL-2 INT8 checkpoint, Wan encoders/VAE, SAM tracker and speed/detail/relighting LoRAs form a **whole-character video replacement** pipeline. They can animate a finished face/body reference. They do not supply a dedicated still-image identity adapter that combines one person's face with another image's body while reliably preserving that body, pose and lighting. Repeating a still as a video is an experiment, not an established face-editing substitute.

The DPO, LightX2V and relighting adapters modify SCAIL/Wan video inference. INT8 describes weight representation; it does not make those adapters compatible with Qwen, SDXL or FLUX. Keep each architecture's adapters on its own branch.

## Smaller preparation branch to test first

For the lowest-cost first experiment, use **FLUX.2 Klein 4B FP8**, its Qwen3 4B text encoder, and the FLUX.2 VAE. [Black Forest Labs documents multi-reference editing and consumer-GPU support](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B), and [ComfyUI provides native editing workflows](https://docs.comfy.org/tutorials/flux/flux-2-klein). The 4B model has an Apache-2.0 license; this should not be confused with the differently licensed 9B variant.

| Additional file | Size, decimal GB | Source |
|---|---:|---|
| `flux-2-klein-4b-fp8.safetensors` | 4.071 | [BFL FP8 weights](https://huggingface.co/black-forest-labs/FLUX.2-klein-4b-fp8/tree/main) |
| `qwen_3_4b.safetensors` | 8.045 | [Comfy-Org encoder](https://huggingface.co/Comfy-Org/Flux-2-Klein-4B/tree/main/split_files/text_encoders) |
| `flux2-vae.safetensors` | 0.336 | [Comfy-Org VAE](https://huggingface.co/Comfy-Org/Flux-2-Klein-4B/tree/main/split_files/vae) |
| **Additional model storage** | **12.452** | One distilled editor, not both base and distilled weights |

This is the more economical first face/body editing candidate. BFL reports roughly 13 GB VRAM for its 4B model; that is a publisher figure, not our measured peak for two-reference face editing. Our 24 GB RTX 3090/4090 target is reasonable, with offloading available if needed. The distilled variant uses four steps. Face likeness, neck blending and preservation of the target body still require our own comparison; fast inference or a small checkpoint does not prove high identity accuracy. Model-specific image LoRAs are separate from the existing Wan slots. A smaller FP4 encoder also exists, but the initial estimate retains the standard encoder to avoid introducing another quantization variable.

## Larger comparison candidate

**Qwen Image Edit 2511 INT8** is an alternative two-image editor. Its multi-image editing and character-consistency features are documented by [Qwen](https://huggingface.co/Qwen/Qwen-Image-Edit-2511) and [ComfyUI](https://docs.comfy.org/tutorials/image/qwen/qwen-image-edit-2511). It is a useful comparison candidate, not an established quality winner over Klein for our face/body task.

The captured ComfyUI catalog already contains `TextEncodeQwenImageEditPlus`, `EmptySD3LatentImage`, `KSampler` and `CFGNorm`, so a native-node branch is possible without replacing the pinned video runtime. No image-editor weights were downloaded and no still-generation UI or validated image-edit graph has been installed in this change.

| Additional file | Size, decimal GB | Source |
|---|---:|---|
| `qwen_image_edit_2511_int8_convrot.safetensors` | 20.499 | [Comfy-Org image-edit weights](https://huggingface.co/Comfy-Org/Qwen-Image-Edit/tree/main/split_files/diffusion_models) |
| `qwen_2.5_vl_7b_fp8_scaled.safetensors` | 9.385 | [Comfy-Org encoder](https://huggingface.co/Comfy-Org/Qwen-Image/tree/main/split_files/text_encoders) |
| `qwen_image_vae.safetensors` | 0.254 | [Comfy-Org VAE](https://huggingface.co/Comfy-Org/Qwen-Image/tree/main/split_files/vae) |
| **Additional model storage** | **30.138** | Excludes caches, extra LoRAs and outputs |

Sizes were checked from the publishers' Hugging Face file metadata on 2026-10-24. The Wan VAE has the same structure but slightly different weights, as [Comfy-Org's maintainer explains](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/discussions/11). Use Qwen's small VAE for the first quality comparison rather than treating the files as identical. The existing UMT5 and CLIP Vision H do not replace the required Qwen VL encoder.

Together with our 29.846 GB video bundle this is about **59.984 GB of weights** for SCAIL plus Qwen, compared with **42.298 GB** for SCAIL plus Klein. An 80 GB disk would have little room for runtime packages, media and temporary data with Qwen added. Plan around 100–120 GB for the SCAIL/Qwen pair, subject to an actual free-space check before downloads. RTX 3090/4090 24 GB is the proposed Qwen test target with model offloading and sufficient system RAM; peak VRAM, latency and usable resolution have **not** been measured on our setup. Run image and video stages sequentially so their models need not remain resident together. Start Qwen without a speed or identity LoRA to establish a comparison.

The newer, smaller [Qwen Image 2.1](https://huggingface.co/Qwen/Qwen-Image-2.1) also supports editing, but its publisher uses a research license rather than 2511's Apache-2.0 license. It is not a direct replacement using the same weights, encoders or VAE. This recommendation therefore does not simply assume that the newest model is the best fit for an influencer production setup.

## Handoff

1. Provide a **body/pose image** as Picture 1 and a clear **face identity image** as Picture 2. An optional third image can supply another face angle. Similar head poses reduce ambiguity.
2. Edit the head region and match its illumination to the body image. Inspect neck boundaries, expression, skin texture, perspective, shadows and face likeness. For exact preservation outside the head, a separately supplied soft mask and image compositing step must be built and verified; an unmasked generative editor can change other pixels.
3. Approve one clean canonical character image before attempting additional views. Keep outfit and proportions stable. A detailed face crop can accompany it later.
4. Upload the approved image into Recast's existing character-reference input. The existing SCAIL video branch, DPO and relighting LoRAs are reused at this stage.
5. Keep front, three-quarter and side views as **separate image files**. A grid sheet is useful for human review but should not be assumed to act as one character reference: the current tracker can select only one of several figures. SCAIL's optional multi-reference mode pairs each view with a matching identity-color mask; the authors label it experimental and describe possible quality degradation. Our present UI supplies one image. See the [official multi-reference guidance](https://github.com/zai-org/SCAIL-2#experimental-functions-multi-reference).

An initial image-edit prompt for that future branch is:

> Picture 1 is the base photograph. Picture 2 supplies the facial identity. Give the person in Picture 1 the facial identity and recognizable facial features of the person in Picture 2. Keep the body, clothing, hairstyle, pose, expression, gaze, camera framing and background of Picture 1. Match the new face to Picture 1's head angle, perspective, light direction, exposure, color temperature, skin texture and shadows, with a natural transition into the neck and hairline. The result is one coherent realistic photograph. Only the facial identity changes.

This is an **editing instruction for the still-image branch**, not the descriptive video prompt used by SCAIL. Use the image numbering expected by the selected editor. It will need image-based validation, including difficult head angles and lighting, before becoming a product default.

## Smaller alternatives

ReActor is a smaller dedicated face-swap route, but its [official project](https://github.com/Gourieff/ComfyUI-ReActor) includes content detection and documents noncommercial conditions on the common InsightFace pretrained weights. Its small face-swap representation also is not proof of high-resolution skin-detail fidelity. It is not the default choice for this project's requested flexibility. [InstantID](https://github.com/instantX-research/InstantID#disclaimer) needs a separate SDXL/identity stack and also states research-use constraints for its supplied checkpoints. Neither is a way to reuse our current SCAIL adapters for still editing.

No hosted generation API is required. Model-specific prompt behavior remains untested; open weights alone do not establish its behavior on every requested edit.

Before downloading additional weights, complete the short prompt-only video comparison from `docs/realism-review.md`. It isolates the observed old-demo contamination without changing the model, reference fitting or sampler. Source-relative reference framing remains a separate change to develop and compare. No face-similarity score, lighting score or new realism improvement has been measured for the proposed editor yet.
