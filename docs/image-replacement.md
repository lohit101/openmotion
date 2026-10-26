# Image replacement

Open **Image replacement** in the left sidebar. It has its own saved draft and uses the existing FLUX.2 Klein 4B FP8 image stack. It does not load Viggle, SCAIL, SAM, video encoders or video LoRAs.

1. Add a **target photo** and an **identity reference**. The target supplies composition, pose, apparent head/body size, camera distance, expression and scene lighting; the reference supplies the replacement's face, hair and outfit.
2. To edit a frame from the current video, choose **Use motion frame**. The original video ID and exact 24 fps clip time are retained. **Use motion character** copies the selected character into the separate image draft.
3. **Protect the background** is on by default. Paint over the original person, hair, clothing and relevant contact shadows. Leave foreground occlusions unpainted. Paint, erase, undo and brush size work locally; saving stores a grayscale mask bound to this target.
4. Keep the photographic replacement prompt or refine it. Clearing it activates the same default. The fixed image-role instructions remain: target first, identity second, optional face close-up third.
5. Automatic face detail uses the existing local YuNet detector to crop an unambiguous reference face. An optional uploaded close-up can replace that crop. This is conditioning and visual review, not face recognition or an identity guarantee. If no clear crop exists, the full reference remains and the run records a warning.
6. Download the three required image files only if missing, then **Replace character**. Image and video jobs share one queue, so an existing video is never interrupted to run an image.
7. Review **Compare** and **Face review** before using the result. Download a lossless PNG or open **My library**. Head position/size warnings are diagnostics; there is no fabricated facial-similarity percentage or automatic quality rerender.

The three files are `flux-2-klein-4b-fp8.safetensors`, `qwen_3_4b.safetensors` and `flux2-vae.safetensors`, totalling **12,451,817,860 bytes**. These are already part of Viggle's automatic source-frame preparation; they are models/encoders, not LoRAs. A video configured to use an **already edited source frame** intentionally skips all three. Their absence from that video's required-download list does not mean they were removed from disk.

The distilled image recipe uses **four Euler steps, CFG 1**, with a reproducible saved seed. A random seed changes the seed for the new job only. No beautifier, face-restoration model, hidden second render or paid image API is applied. These files are Apache-2.0 components; see [Black Forest Labs' Klein release](https://bfl.ai/blog/flux2-klein-towards-interactive-visual-intelligence).

Working detail is capped at one or two megapixels without upscaling a smaller target. A uniform resize and grid padding preserve the source aspect ratio; decoding removes only the padding and restores the original dimensions. A larger exported PNG does not imply newly generated high-resolution detail.

New masked jobs encode the target as the starting latent and apply the source-aligned edit mask during sampling, then composite the result into the original photo. The earlier composite-only recipe allowed Klein to redraw a brighter background inside a broad painted region, producing an obvious pale halo. The masked-latent correction substantially reduced that defect in a same-input GPU test, but did not eliminate all changes to background painted inside the mask.

Feathering is inward, so zero-mask pixels never admit generated content. Local PNG finalization restores exact decoded source pixels outside the mask, removing float-to-PNG rounding differences. The guarantee applies **outside the mask**, not to background painted inside it, identity, pose or anatomical accuracy. Fine masks and an appropriate reference still matter. Paid legacy jobs retain their original conditioning recipe on recovery.

The first live evaluations are **not a quality pass**. The general four-step editor blended facial features and retained pieces of the target outfit. A focused clothing instruction transferred the full dress more successfully, but facial likeness remained insufficient. Do not treat automatic face crops or a long preservation prompt as a trained identity constraint. See [the validation record](validation/image-replacement-20261027.md).

Completed GPU receipts are saved before image download. Reconnection checks the same prompt and its history. Once downloaded, failed local finalization can be retried even with the GPU offline, without resampling. A genuinely missing paid GPU output requires the explicit existing retry action; it is never silently submitted again.

## Return to video

**Use in Motion control** saves the PNG as a reusable input. If the target was extracted from a known video, it restores that video and clip start, uses native 24 fps and selects **prepared frame**, avoiding a second Klein edit. A generic photograph becomes a normal character reference with **automatic preparation**; it is not mislabelled as a frame from an unrelated video. Review likeness before propagating it: video conditioning cannot repair an incorrect identity anchor.

The portable editable examples are [full-photo editing](../workflows/experimental/klein4b_image_replacement.json) and [masked editing](../workflows/experimental/klein4b_image_masked.json), with matching API graphs beside them. They use a 1024-square target. Studio's per-job export contains the actual source dimensions, mask, uploaded filenames and optional face input. Regenerate the examples with:

```sh
cd studio
npx tsx scripts/export-image.ts
python3 ../scripts/build_image_workflows.py
```

## Model research · 27 October 2026

| Model/path | Evidence and suitability | Decision |
|---|---|---|
| Existing FLUX.2 Klein 4B FP8 | Native multi-reference editing; four-step distilled recipe; already installed and shared with video preparation. | Implement and test this baseline first. Face detail and masks provide inspectable controls, not a hard identity lock. |
| FLUX 3 Image Klein 5.6B | New open-weight release with multi-reference editing and bounding-box guidance. BFL reports stronger editing scores than its earlier 9B model, but these are publisher evaluations, not our matched face-swap tests. | Best next small-model comparison candidate. It is a different model/encoder/schedule, not a replacement filename in the current graph. |
| Qwen-Image 2.1 / Turbo | Publisher describes a 7B visual model, up to ten references and local-edit/identity-preserving capabilities. | Strong alternative to evaluate on the same target/reference/mask. No current local identity or timing win is established. |
| Qwen-Image-Edit-2511 | Publisher documents improved character consistency over 2509 and Apache-2.0 licensing. | Older fallback; do not install its separate large stack merely from generic editing claims. |
| Community PuLID-Flux2 | Identity embeddings and cross-attention injection are attractive, but inspected code includes silent no-face bypass and randomly initialized fallback paths when dimensions differ. | Do not ship it as an “identity lock” without validating compatible trained weights, repeat-run behavior and dependency licensing. |

[BFL's FLUX 3 release](https://bfl.ai/blog/flux-3-image-klein/) and [its Comfy model card](https://huggingface.co/black-forest-labs/flux-3-image-klein-comfy) specify a 16-step distilled recipe, a separate Qwen3-VL encoder and scene-caption prompting. The INT8 transformer is listed at 5.8 GB, the INT8 encoder at 4.9 GB, plus the shared 0.3 GB VAE. Their default prompt upsampler is another 9.8 GB in INT8 or 6.7 GB in W4A8; an appropriate external captioner is also supported. Bounding boxes guide layout but are not hard pixel masks. Access is gated and the FLUX Kommunity License has specific qualifying-commercial-output terms; it is not Apache-2.0.

[Qwen's 2.1 model card](https://huggingface.co/Qwen/Qwen-Image-2.1) documents the multi-reference and editing capabilities, CPU offloading and Qwen Research License. [The 2511 card](https://huggingface.co/Qwen/Qwen-Image-Edit-2511) documents its separate editing architecture and Apache-2.0 licence. These models cannot use the currently installed Qwen3 text-only encoder simply because their names contain “Qwen.” The [PuLID implementation inspected](https://github.com/iFayens/ComfyUI-PuLID-Flux2/blob/main/pulid_flux2.py) is community code; its claims are not a matched quality benchmark.

No additional generation weights are downloaded by this feature or its model selection. A new stack should earn its storage, transfer and setup costs in a same-input comparison before becoming a default. No open-weight model cited here establishes zero identity drift or equivalence to a closed image service on arbitrary inputs.
