# Production character replacement: research and implementation plan

Research date: 26 October 2026. Scope: inspect the latest result, identify released open models and compatible adapters, and plan a faster production workflow. No model weights were downloaded, no workflow/runtime was changed, and no paid render or GPU resume was submitted. The user's current priority is realism and speed; ordinary stock models are acceptable.

## Decision

Build a **scene-preserving replacement pipeline with an edited source keyframe**, model-specific few-step recipes and optional temporal upscaling.

- **Practical permissive baseline:** Wan2.2-Animate-14B in replacement mode, comparing its standard recipe with LightX2V's actual four-step replacement recipe. Keep SCAIL-2 available as a measured baseline.
- **Fastest compelling released replacement candidate:** Viggle-Animate, a 33.1B H3 derivative. It has unusually strong published speed evidence, but its custom licence is a material production constraint. Treat this as a conditional pilot, not an automatically approved production default.
- **Fidelity challenger:** MoCha. Its conditioning is relevant to preserving a shot, but its published many-step inference is not an established speed solution.
- **Separate motion-transfer branch:** Wan-Animate-2 Distillation. Its documented interface animates a reference scene; a newer version number does not establish source-scene replacement support.

None has demonstrated consistently invisible AI or Higgsfield parity on our inputs. Establish this with a small, controlled evaluation before choosing the default.

## What the latest result establishes

The latest completed job is `f8fd21ad-46cd-4348-ba2c-62f265aa0b03`: five seconds, 120 frames, 24 fps, 704×1248, SCAIL-2 INT8, Quality16, CFG5, UniPC, DPO1, no speed adapter and no generic style LoRAs. It ran on A100 PCIe 40GB for **2,463.988 seconds: 41m04s**. Its two sections took 1,778.958 and 671.028 seconds. At the saved $0.364296/hour quote, render-time compute/storage is approximately **$0.249**, excluding setup, downloads, idle time and transfers.

The mode was **Motion transfer**, not Character swap. Both replacement controls were false; the checked relighting option was not applied because relighting is replacement-only. The warm hallway and character placement follow the reference scene by design. This explains the scene change; it does not excuse the synthetic-looking skin and reconstructed clothing/jewellery detail visible in the sampled output. The reference itself has strong warm lighting and a very smooth skin presentation.

There is also a source framing/shot change at approximately **3.333s**, close to the first section's 3.375s boundary. FFmpeg scene detection flags an output change near 3.458s. This is a diagnostic signal, not proof of the cause or an exact motion-lag measurement. Split shots before generation rather than treating this as one continuous lighting/camera condition. The output is genuinely five seconds at 24 fps; changing the export fps alone would not fix its appearance.

Synchronized frames were inspected at 0, 0.5, 1.5, 3.25, 3.42 and 4.5 seconds, with additional full-resolution frames. No automatic face-identity or photorealism score was invented. See [the saved audit](../validation/latest-output-audit-20261026.json); raw media comparisons remain under ignored `backups/latest-output-review-20261026/`.

## Video engines and evidence

| Model | Suitable task | GPU/integration position | Recommendation |
| --- | --- | --- | --- |
| **Wan2.2-Animate-14B** | Dedicated full-character replacement using source background/masks; animation is a separate mode | Native ComfyUI/WanVideo ecosystem; LightX2V publishes a 4090 quantized/offload configuration. Use 5090 for the quantized candidate and 96GB PRO for a full-precision capacity baseline. | First production candidate. Apache2 weights. |
| **Viggle-Animate / H3, 33.1B** | Propagates one repainted source frame through its driving video | Official BF16 example peaks about 80.1GiB: target 96GB+ or B200/H200. Community ComfyUI exists. | Conditional high-speed pilot after licence review. |
| **MoCha / Wan2.1 14B backbone** | Replacement with a designation mask; optional extra face/body references | WanVideoWrapper integration is acknowledged. Official script defaults to 50 steps, CFG5, 81 frames at 480×832. No authoritative minimum VRAM or comparable single-5090 time established. | Quality challenger if simpler candidates fail. Model card says AGPL3. |
| **Wan-Animate-2 Base/Distillation** | Driving-video character animation | Released weights and Comfy integration; documented examples are not evidence of a replacement/masking interface or a single-5090 latency. | Separate reference-scene motion mode. Apache2. |

Sources: [Wan replacement model/instructions](https://huggingface.co/Wan-AI/Wan2.2-Animate-14B), [LightX2V 4090 replacement configuration](https://github.com/ModelTC/LightX2V/blob/main/configs/wan22/wan_animate_replace_4090.json), [MoCha official implementation](https://github.com/Orange-3DV-Team/MoCha), [MoCha licence metadata](https://huggingface.co/Orange-3DV-Team/MoCha), [Wan-Animate-2](https://github.com/Wan-Video/Wan-Animate-2).

The Wan publisher warns that generic Wan2.2 LoRAs may behave unexpectedly on Animate. Replacement also disables pose retargeting to preserve interactions with the source scene. Mask extent trades background preservation against freedom to change the character's shape. These need an engine-specific template, not a checkpoint filename swap in the existing SCAIL graph. [Official preprocessing guide](https://github.com/Wan-Video/Wan2.2/blob/main/wan/modules/animate/preprocess/UserGuider.md)

### The credible speed result

Viggle's publisher compares the released model with Wan-Animate on the same B200 and inputs: **26 seconds versus 160 seconds** for 124 frames at 24 fps and 480×832. This is a warm, BF16 video-generation result; repainting, model loading and Wan preprocessing are excluded. It is not a comparison with our 41-minute SCAIL job. [Publisher research](https://viggle.ai/research/viggle-animate-character-replacement-from-a-repainted-frame)

The canonical recipe has four sigma boundaries but **three forward passes**, CFG1 and its own DMD adapter. Another bundled audio-conditioned example takes 51 seconds. The video stage consumes the driving video and a repainted source frame; its text conditioning is frozen. The official unoffloaded memory figure excludes a nominal 80GB card, and its author's optimized 5090 path is not released. [Actual checkpoint, requirements and examples](https://huggingface.co/Viggle/Viggle-Animate)

The [community ComfyUI wrapper](https://github.com/Saganaki22/ComfyUI-Viggle-Animate-H3) and [converted checkpoints](https://huggingface.co/drbaph/Viggle-Animate-ComfyUI) include a roughly 21GB pruned INT8 transformer, 0.94GB reduced-rank adapter and 3.17GB quantized VAE. This is a different experimental package; it does not establish the same quality or 26-second latency on a 5090. Extreme pose changes, re-entry and interactions remain documented failure cases. Newer teaser demonstrations must not be mistaken for these released weights.

**Licence:** the checkpoint inherits MiniMax H3 Community terms, including excluded territories (US, EU, UK and South Korea), commercial attribution and restrictions involving outputs. An India-based user does not automatically clear a US/EU rental or global publication. Review these uses with the publisher before selecting this for commercial social posting. Apache2 on example code does not override the model terms. [Actual licence](https://huggingface.co/Viggle/Viggle-Animate/raw/main/LICENSE)

## Prepare the character in the shot first

Select a clear source frame per shot. Edit the selected person into the target character while preserving camera geometry, body placement, light direction and occlusions. Composite the original pixels outside the intended edit region back into that keyframe. Show the prepared frame before expensive video inference. Keep crop/scale/padding transforms explicit so they can be reversed without changing apparent camera distance.

| Image engine | Intended role | Limits |
| --- | --- | --- |
| **Qwen-Image-Edit-2511** | Initial multi-reference full-person edit candidate; its matching LightX2V Lightning adapter is a speed experiment | Apache2 base; stock identity/scene preservation still requires inspection. |
| **FireRed-Image-Edit-1.1** | Quality challenger for multi-image identity, outfit and scene-aware editing | Apache2, native Comfy package; bigger 20B-class model. Publisher acceleration results are not measured on our system. |
| **FLUX.2 Klein 4B + matching BFS head adapter** | Lean head/face preparation when source body/clothes should stay | Apache2 base; four-step editing and publisher ~13GB VRAM figure. A head adapter does not replace the full body. |

Sources: [Qwen Edit2511](https://huggingface.co/Qwen/Qwen-Image-Edit-2511), [its exact Lightning adapter](https://huggingface.co/lightx2v/Qwen-Image-Edit-2511-Lightning), [FireRed1.1](https://github.com/FireRedTeam/FireRed-Image-Edit), [FireRed Comfy pack](https://huggingface.co/FireRedTeam/FireRed-Image-Edit-1.1-ComfyUI), [FLUX2 Klein4B](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B).

Use a clear face reference and, for full replacement, a useful full-body/outfit reference. Avoid feeding an unstructured contact sheet to an engine expecting one person. A clean reference with visible skin texture is more helpful than adding photographic adjectives to an already smoothed image. Full-body editing and optional head correction are separate stages; do not claim a head-swap LoRA solves the whole task.

Newer image releases were considered. Qwen-Image2.1/Viggle Turbo and its BFS Body Swap adapter have noncommercial research-base terms; FLUX3/Krea2 have separate commercial conditions. They are evaluation options rather than automatic upgrades over the permissive choices. [Qwen2.1 Turbo card](https://huggingface.co/Viggle/Qwen-Image-2.1-viggle-turbo), [BFS body guide](https://huggingface.co/Alissonerdx/BFS-Best-Face-Swap/blob/main/docs/qwen-image-2.1-body.md), [FLUX3 card](https://huggingface.co/black-forest-labs/flux-3-image-klein), [Krea2](https://github.com/krea-ai/krea-2).

## Minimal adapter recipes

| Engine | Exact candidate | Purpose / caution |
| --- | --- | --- |
| Wan2.2-Animate replacement | Its relighting adapter; separately A/B LightX2V's four-step replacement recipe | The published four-step config uses `lightx2v_I2V_14B_480p_cfg_step_distill_rank32_bf16.safetensors`, CFG1 and strength1. Generic Wan2.2 MoE Lightning adapters are not equivalent. |
| Viggle-Animate | Its own DMD2 adapter, strength1; Euler, CFG1, sigmas `[1, 0.8571428571, 0.6, 0]` | Apply to the Viggle-finetuned H3 transformer, not stock H3. More steps are not automatically better. |
| SCAIL-2 baseline | Compare the published eight-step LightX2V recipe with our current Natural profile; ablate DPO separately | Current official example uses I2V rank128, strength1, shift1, CFG1. Our recipes differ; this needs a compatible-version A/B, not a claim that our adapters caused the latest failure. |
| Qwen Edit2511 head preparation | `bfs_head_v5_2511_merged_version_rank_16_fp16.safetensors` | Source body/frame first, reference head second. Image-only, not a video-transformer adapter. |
| FLUX2 Klein4B head preparation | `bfs_head_v1_flux-klein_4b.safetensors` | Same input order; test the creator's model-specific workflow. |

Sources: [LightX2V actual replacement config](https://github.com/ModelTC/LightX2V/blob/main/configs/wan22/wan_animate_replace_lora.json), [Viggle inference recipe](https://huggingface.co/Viggle/Viggle-Animate), [SCAIL official LoRA examples](https://github.com/zai-org/SCAIL-2/tree/wan-scail2#lora-integrations), [BFS Qwen instructions](https://huggingface.co/Alissonerdx/BFS-Best-Face-Swap/blob/main/docs/qwen-image-edit.md), [BFS FLUX instructions](https://huggingface.co/Alissonerdx/BFS-Best-Face-Swap/blob/main/docs/flux-2-klein.md).

Leave extra style slots empty initially. Existing Smartphone/Instagooner evidence consists mainly of still images, not matched replacement-video improvements. An identity LoRA reinforces a particular character; an influencer-themed style LoRA does not generally repair timing, occlusion or facial anatomy. See [the earlier adapter audit](influencer-lora-research.md).

## Optional finishing

First compare a simple high-quality resize with **FlashVSR+ Turbo**. It is a released Apache2 video upscaler with roughly 7GB selected weights and a consumer-compatible backend. The official interface is CLI/Python, so use an isolated finishing worker if a mature Comfy wrapper is not available. Pad/unpad around its 128-pixel constraints; do not silently center-crop or change framing. Preserve exact fps, frame count and original audio timing. [Official implementation](https://github.com/OpenImagingLab/FlashVSR_Plus), [weights](https://huggingface.co/ruchangyao/FlashVSR_plus).

Its creator reports 6.63 GPU-seconds and 8.72GB peak for an 89-frame 1080p Turbo benchmark on H200-equivalent hardware. A separate 4090 4K result is 0.98fps. These are different measurements, not a universal end-to-end latency. Start with 720/1080 export, not 4K. [Creator results](https://www.flashvsr.tech/)

**SeedVR2-3B** is the more established ComfyUI fallback. Evaluate conservatively: restoration can invent texture or change identity. Its package's automatic-download defaults must be disabled in our integration. **LTX2.5 Refine-Details** is a later finishing experiment with much larger model/encoder requirements. Upscaling cannot repair wrong pose, camera distance, identity or missing interactions. [SeedVR](https://github.com/ByteDance-Seed/SeedVR), [Comfy integration](https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler), [LTX finishing adapter](https://huggingface.co/Lightricks/LTX-2.5-22b-IC-LoRA-Refine-Details).

## Hardware and storage

- **Existing A100 PCIe40:** usable for initial Wan/SCAIL comparisons; memory/offload must be profiled. It cannot hold the published Viggle BF16 example unoffloaded.
- **RTX5090 32GB:** preferred consumer-GPU test for supported quantized Wan recipes. Its Viggle community INT8 route is experimental.
- **RTX PRO6000 Blackwell96GB:** a capacity starting point for full-precision comparisons and reduced offloading; compare a fresh rental quote with H200/B200 before choosing it. Capacity suitability does not establish B200-like latency or a cost advantage.
- **B200/H200:** speed/capacity trial if the selected engine and licence allow the deployment. Rent one GPU; our existing graph does not distribute a job across several cards.
- Prefer 96–128GB system RAM for the large full-precision trial. Verify actual peak GPU/CPU allocation rather than relying on a model filename.
- **256GB disk is a pragmatic multi-engine allocation**, not a minimum. Selected Viggle components are approximately 80GB; the entire 269GB H3 repository is unnecessary. Share compatible encoders/VAEs by exact hash, keep only the chosen precision and one upscaler, and retain individual download/delete controls. Smaller single-engine trials need less space.

No new dollar quote is assumed here. Use a fresh full running/storage/transfer quote. For illustration, three warm minutes at $1.50/hour costs $0.075 before other charges. Measure cost per accepted clip including rejected attempts, not just the cheapest hourly rate. The last job's $0.249 render estimate is historical.

## Implementation and validation order

1. **Offline contract and input preparation.** Add shot-cut detection, source-aspect transforms and an explicit choice of face-only, full-person replacement, or reference-scene motion transfer. Save per-shot source/reference/keyframe hashes. Keep the current graph intact as a baseline.
2. **Prepare and inspect one keyframe.** Start full-person editing with Qwen2511; use FireRed1.1 only if the baseline fails. Offer the lean FLUX/BFS branch for head-only work. Preserve the original scene outside the edit region and its foreground occlusions. Reference appearance and source geometry must not be conflated.
3. **One short matched comparison.** Use the first roughly three seconds of the latest source, before its cut, at approximately480p and the same fps. Compare correctly conditioned SCAIL8, Wan standard replacement, and Wan four-step replacement. Keep inputs and approved keyframe fixed where each engine supports them. Record differences in required conditioning explicitly. Do not call this a matched whole-system benchmark if preprocessing differs.
4. **Challenge the winners.** Test two further clips with turning/occlusion and changing illumination. Try MoCha if fidelity remains unacceptable. Test Viggle only after its production uses and hardware are cleared. Do not benchmark unreleased teaser code paths.
5. **Finish accepted base footage.** Compare raw output, ordinary resize and one FlashVSR+ variant. Check identity, fabric, skin, edges, lighting and temporal consistency. No automatic rerender of a failed quality check.
6. **Optimize the chosen engine.** Profile offloading, attention kernels, model loads, caches and CPU preprocessing. Test compatible SageAttention/FlashAttention and compile independently; amortize compile cost over a warm session. Lazy compilation and weight downloads must not lengthen blank-engine startup.
7. **Integrate separate Comfy/API templates.** Each engine declares supported tasks, LoRA families, frame/grid limits, input preparation, sampler recipe and prompt capability. Disable irrelevant controls (Viggle uses frozen text conditioning). Save graph/checkpoint/adapter revisions per job; never silently carry a Wan LoRA into H3 or LTX.
8. **Production pilot.** Only after short clips pass, test 5–10-second shots and a small set of longer, cut-aware clips. Maintain identity/reference preparation across shots. Track cold startup separately from warm image preparation, generation, finishing and export, with real progress and failure reporting.

Proposed engineering targets, not measured promises: a publishable five-second result in **under three warm minutes** on the chosen production GPU, with consistent source-relative placement, no distracting identity/lighting shifts, and a high first-attempt acceptance rate across a held-out set. Target 24 fps and verify each engine's supported frame counts and actual motion cadence; lower-fps generation/interpolation is a separate optional experiment. Judge normal-speed playback and synchronized frames, not one attractive thumbnail.

For the comparison, retain the source, reference, edited keyframe, masks, seed, precision, adapters and complete sampler settings. Record cold preparation, warm inference, finishing, peak VRAM and total cost separately. Have the user rate each anonymized result for publishability and score identity, source-relative placement/scale, occlusions, lighting stability and visible artifacts on the same five-point rubric. Report individual scores and accepted/rejected counts rather than inventing an overall photorealism percentage. Bounding-box drift can support geometry review; different target body proportions mean it is not an identity or realism metric. The acceptance decision must also include normal-speed playback.

## Models not selected as automatic replacements

- LTX2.5 Ingredients/Layout-To-Render support other conditioning tasks; they are not demonstrated drop-in arbitrary-footage character replacement engines. [LTX2.5](https://github.com/Lightricks/LTX-2)
- SteadyDancer is relevant to a separate dance-animation mode. [Released model](https://huggingface.co/MCG-NJU/SteadyDancer-14B)
- UniSwap's impressive talking-video streaming result currently points to code coming soon. Vorch-IR's paper is relevant, but a usable official release was not verified. Do not promise deployment from paper speeds. [UniSwap repository](https://github.com/uniswap-av/UniSwap), [Vorch paper](https://arxiv.org/abs/2608.05648)
- FaceFusion/ReActor-style crop swapping is useful for face-only work, but common public InsightFace/INSwapper recognition/swap weights have noncommercial terms. Audit the dependency chain before commercial use. [FaceFusion licences](https://docs.facefusion.io/introduction/licenses), [InsightFace terms](https://github.com/deepinsight/insightface#license)

Higgsfield publicly offers different motion/editing products, but does not disclose everything needed to reproduce its training, pipeline or latency. Its general timing includes queue/load variability. Use it as a visual and latency reference, not proof that one public checkpoint or more VRAM reproduces the service. [Official Genjutsu](https://higgsfield.ai/genjutsu), [generation/queue help](https://higgsfield.ai/creator-hub/help-center/troubleshooting/generation-is-stuck-or-failed).

Checked checkpoint revisions are recorded in [the metadata snapshot](../validation/model-research-revisions-20261026.json). This plan is ready for implementation; GPU A/B validation remains outstanding.
