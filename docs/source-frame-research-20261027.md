# Source-frame replacement research · 27 October 2026

## What the commercial tools actually disclose

[Higgsfield's engineer-authored swap guide](https://higgsfield.ai/blog/AI-Face-Character-Swap-in-Video-Photo-PRO-Guide) explicitly discusses masking, multiple passes, reusable character identities, compatible proportions, clear faces and similar lighting. Its public guide does **not** publish the production weights, conditioning graph, inference schedule or internal quality selection. Those internals cannot be reconstructed reliably from showcase videos.

The newer [Genjutsu documentation](https://higgsfield.ai/creator-hub/help-center/tools/how-do-i-use-genjutsu) separates scene rebuilding from selective object replacement and supports several reference views. [Higgsfield's consistency guide](https://higgsfield.ai/blog/two-characters-one-scene-ai-video) uses separate character anchors and review before continuation. Its current [filmed-look guide](https://higgsfield.ai/blog/how-to-make-ai-video-look-filmed) names Seedance 2.5 for Cinema Studio 4.0 and describes distinct lighting, video-edit and upscale tools. That disclosure is specific to those products; it does not establish which checkpoint powers Character Swap 2.0 or every Recast version.

[Runway's reference documentation](https://help.runwayml.com/hc/en-us/articles/40042718905875-Creating-with-Gen-4-Image-References) likewise separates reusable identity references from scene composition, recommends neutral/clear reference photography, and supports sketch-guided layout and sequential editing. These are documented product practices, not evidence that all vendors use a particular public ComfyUI graph.

The transferable engineering pattern is controlled editing with stable references, localized stages and explicit review. Replicating that pattern with available open weights is feasible. Claiming the same proprietary model, guaranteed indistinguishability or commercial-service equivalence is not justified by these sources.

## Why our preceding recipe failed

The saved Qwen results make the failure concrete: a fresh scene-sized latent, a whole-person adapter and a semantic preservation prompt were followed by mask compositing. The body adapter borrowed distant reference framing, while a broad painted area admitted newly rendered background illumination. Tiny gaps retained conspicuous pieces of the original person. Appending a close-up instruction improved geometry but still left a detected head scale of only 0.76× the original.

Increasing output size or adding a face restorer would not constrain those failures. The main missing controls were the source spatial structure during sampling, an actual inpainting condition, and separation between wardrobe replacement and head identity.

## Selected open implementation

Use the installed Qwen Image 2.1 INT8 stack and the matching BFS body adapter. Add the official [Qwen Image 2.1 Fun ControlNet Union](https://huggingface.co/alibaba-pai/Qwen-Image-2.1-Fun-Controlnet-Union): a trained branch for structural conditions and masked inpainting. It is already supported by the project's pinned [native ComfyUI model-patch implementation](https://github.com/Comfy-Org/ComfyUI/blob/fb3befd168731438f88bc96e0920a538e8649878/comfy_extras/nodes_model_patch.py). No floating custom-node installation is required.

The new `scene-anchor-v1` recipe:

1. Preserve immutable original inputs. Uniformly scale and pad the source, masks and structural guide together.
2. Generate source Canny contours on the CPU, removing internal facial edges so the guide does not intentionally encode the original eyes/nose/mouth. This is an edge guide, not a pose-estimator or a depth model. It can also constrain unwanted garment or hair contours, so strength must be tested.
3. Optionally repair tiny enclosed mask gaps. Keep the outer painted boundary and large protected holes. Expose the processed mask for inspection; deliberately protected small foreground objects require this repair option off.
4. Encode the **original source latent**, attach the aligned sampling mask, and apply Union structural plus inpainting conditioning throughout the body pass. The original face core remains protected when a head pass is selected.
5. Run an independent head adapter with the completed body as image one and a clear replacement face as image two. Body and head LoRAs are never stacked on the same branch. Each stage retains its two-reference contract, original geometry and localized mask.
6. Restore exact original decoded pixels outside the actual processed mask. Save both the body intermediate and final image, reference/face crops, graph, prompt, masks and execution receipt. Review before video propagation.

The [BFS Qwen head guide](https://huggingface.co/Alissonerdx/BFS-Best-Face-Swap/blob/main/docs/qwen-image-2.1.md) documents v1.1 as reducing the MLP changes associated with skin smoothing while retaining trained attention paths. These are the author's limited tests, not our quality guarantee. The adapter is matched specifically to Qwen Image 2.1. Generic beautification is not a substitute for identity conditioning.

Fast evaluation uses the existing official eight-step acceleration adapter, CFG 1. A separate twenty-step, CFG 4 comparison omits that adapter. ControlNet and the body/head adapters were not jointly trained for this exact combination; compatibility and visual quality require actual ablations. [Qwen's prompt-rewrite instructions](https://github.com/QwenLM/Qwen-Image-2.1/blob/main/prompt_rewrite/prompts/system_prompt_edit.txt) support concise, attribute-specific edits and image-referenced identity rather than inventing a verbose verbal face description.

## Cost, validation and limits

The pinned Union branch is **7,550,979,904 bytes**, and BFS head v1.1 is **260,096,144 bytes**. Their combined download is approximately **$0.0312** at this rental's quoted $0.004/GB ingress rate. The plan needs **13.18 GB free including the 5 GiB reserve**, below the last measured 14.18 GB. Working files consume additional space and remain subject to preflight. These weights use the Qwen Research License and MIT respectively; future hosted-service licensing requires separate review.

The current A100 PCIe 40 GB costs $0.333333/hour compute, below the user's $0.70 ceiling. The latest user video must finish before transfers, deployment or inference tests. GPU timing and results for the new method will be recorded separately; do not advertise a quality pass from successful graph validation.

Review full-frame geometry, hands and occlusions, recognizable facial features, outfit transfer, scene exposure, directional shadows, skin texture and mask boundaries. Face-box measurements quantify placement/scale, not identity. A single successful frame cannot establish temporal identity stability; only a reviewed frame should proceed to a matched short Viggle test and synchronized source/output inspection. Preserve failed results as evidence and never automatically spend compute on hidden quality retries.
