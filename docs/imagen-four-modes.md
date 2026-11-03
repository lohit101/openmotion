# Imagen: four explicit workflows

New standalone Imagen runs now use `imagen-v1` and expose four input contracts:

| Mode | Inputs | Result requested |
| --- | --- | --- |
| Prompt to image | Description | A new image at the selected native size and aspect ratio |
| Body only | Target + character; optional separate face reference | Character identity and physique, with the target's clothes and accessories |
| Character + outfit | Target + character; optional face and outfit references | Character identity and physique, wearing the separate outfit or the character reference's outfit |
| Clothes only | Target + outfit | Target person retained, wearing the referenced garments |

Saved Characters remain available for the two identity modes. Body and face sheets retain asset-bound view selection. A clothing reference may depict a worn outfit, mannequin or standalone garment. The actual input order determines the frozen prompt's image numbers; a fourth reference is not silently omitted.

The redundant Character/Clothing header tabs, legacy recipe selector, target brush and mask controls are removed. All new standalone edits grant permission across the entire image, recorded as a full-white mask and a permission receipt. A target mask supplied through the API is ignored by this recipe. Prompts request scene preservation, but no pixels are hard-protected or composited back afterward. This can change background details and is not an exact scene lock. Klein is disabled for new Imagen submissions; its historical workflows, weights and paid-job recovery remain available internally.

## Photo settings and observed defects

Review of the latest saved standalone image found smoothing already present in the raw Qwen output. Its final masked composite also introduced a broad circular edge against the sky. The new route removes that composite entirely and saves the native model result after removing grid padding. It adds no ONNX face restoration, beauty filter, sharpening, artificial texture or extra adapter stage.

New and upgraded standalone drafts default to **Photo, 40 steps, 2048-pixel long edge**. Fast remains available at eight steps using the existing matching Turbo LoRA. The alternative native size is 1024 pixels on the long edge. The actual output dimensions are shown before generation; source aspect ratio is retained to integer-pixel rounding. This is native generation, not a claimed 4K upscale. High-resolution decoding uses overlapping VAE tiles and an unquantized CPU prefix cache to reserve GPU memory.

The Qwen pipeline documentation recommends native 40-step sampling, while ComfyUI also documents the separate eight-step LoRA path. These are supported configurations, not evidence that this task's new recipe matches ChatGPT quality. [Diffusers Qwen Image 2.1 pipeline](https://huggingface.co/docs/diffusers/v0.42.0/en/api/pipelines/qwenimage21), [ComfyUI Qwen Image 2.1 guide](https://docs.comfy.org/tutorials/image/qwen/qwen-image-2-1).

Text-to-image reuses the same base/encoder/VAE, with no hidden target image. Its empty canvas follows the official template. Image edits use the target as image 1 and role-bound references afterward. [Official ComfyUI text-to-image template](https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_qwen_image_2_1_t2i.json), [Qwen Image 2.1 announcement](https://qwen.ai/blog?id=qwen-image-2.1).

The selected native route requires the three existing Qwen files; Fast adds the existing Turbo LoRA. No new weights, model transfers or runtime installations were performed for this update. Optional experimental texture VAEs were not added.

## Language and reproducibility

Advanced settings offer English or Chinese built-in instructions. Additional user directions remain verbatim and override conflicting task defaults. Both templates assign the same identity/body/wardrobe/scene roles and request natural photographic texture. No primary-source comparison established that Chinese universally improves fidelity, reduces token count or makes this workflow faster; the option is an explicit comparison setting, with English as the default.

Every job freezes its input assets, selected character revision/views, prompt, seed, language, dimensions and graph. Paid historical jobs are not migrated. Remotion's saved source-frame preset and automatic face-only boundary refresh remain unchanged; the new whole-image contract applies to standalone Imagen only.

## Validation and limits

All **553 Studio tests** and **seven CPU image checks** passed, along with typechecking and the staged production build. Tests cover all four graphs, two/three/four-reference ordering, bilingual roles, model requirements, full-image permission, exact native-pixel finalization, stale references, request deduplication and offline recovery without resampling. Mock integration output verifies the protocol, not image quality. All 126 historical image graphs with saved uploads compiled identically before and after the change.

An isolated native Chrome fixture was inspected for the four-mode layout, body/face reference controls and removal of legacy/painting controls. Automated render checks cover each mode's input visibility; a complete native interaction review of every mode was not performed while the user controlled Chrome. The temporary fixture server was stopped.

A guarded deployment preserved all **351 saved job records and both drafts**. Live invalid-input checks rejected Klein (409) and an empty text prompt (400), without creating jobs. Compute remained offline; no rental, GPU resume, paid render or download was initiated.

New GPU quality comparisons are pending the user's separate approval. Skin realism, identity fidelity, four-reference wardrobe quality, higher-resolution memory use and English-versus-Chinese visual differences have not been measured on this new recipe. The code removes the mask seam mechanism and exposes supported native settings; it does not establish flawless swaps or ChatGPT parity.
