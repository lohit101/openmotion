# Qwen source-frame replacement: boundary, lighting and identity audit

Research checked on 27 October 2026. This is a diagnosis and evaluation plan, **not a shipped quality fix**. No GPU was started, no inference was submitted and no model weights were downloaded for this audit. Existing paid results and settings are unchanged.

## What the latest result shows

Audited local job: `4f20fd39-7052-4c98-9c8f-05a19734909b`. It completed in **120.502 seconds end to end**, with **96.430 seconds** between native Comfy execution events. It used Qwen 2.1 INT8, the BFS body adapter followed by the separate BFS head v1.1 adapter, twenty steps per stage, CFG 1, Euler/simple, a 2 MP working canvas, geometry strength 0, gap repair on and inward feather 4 px. Turbo and Union were not active in this job.

I compared the original, appearance reference, raw body output and final composite. The target has soft indoor illumination and arms away from the head. The reference has strong golden sunlight, a raised hand beside the hair and an outdoor background. The **raw generated body already imports the hand and directional sunlight**, changes the head placement, smooths the skin and changes the tattoo lettering. Those failures precede mask compositing. The final image adds horizontal notches through the new hair and a broad background halo.

The saved diagnostic reports exact original decoded pixels outside the processed mask. That succeeds as a preservation check, but does not establish a seamless edit. On the 720 × 1280 output, the detected face box is approximately **0.777× the source box's linear size**, with its center **8.5 px right and 60.5 px up**. Face detection measures geometry, not identity similarity or actual camera distance. Different facial proportions also affect this proxy.

The processed mask covers **67.44%** of the frame; only **2.62%** of its nonzero pixels have intermediate alpha values. This is mostly a hard selection with a thin transition. No automatic inference retry is justified by these measurements.

## Confirmed implementation problems

In [image preparation](../scripts/image_replacement.py), feathering is `minimum(original_mask, gaussian_blur(original_mask))`. A zero in the painted mask stays zero. It softens inward, providing **no permission for new hair, clothing or shadows to extend outside the brush outline**. The head ellipse is also clipped against that mask.

In [the v3 compiler](../studio/server/qwen-scene-workflow.ts), the source-anchored recipe at geometry strength zero uses Qwen's native scene-sized latent. There is **no denoising mask or separate mask reference sent into the model**. The paint selection controls postprocessing, while generation is instructed by text and two images. The model can invent a hand elsewhere, and the compositor subsequently cuts it off.

With the head pass enabled, the body is composited over the original, the head is composited over that intermediate and the result is composited over the original again. Away from the head, applying the same alpha twice makes the body's contribution approximately alpha squared, subject to resizing. This weakens a feathered boundary and allows more original content through. Repeated compositing does not correct the underlying lighting.

The default prompt shown in the UI is also not the literal submitted prompt: the compiler recognizes that default and substitutes its shorter `body_swap:` instruction. Inspect the saved graph when assessing what the model was actually asked to do.

## What published workflows support

**Reference preparation matters.** The [BFS body author's guide](https://huggingface.co/Alissonerdx/BFS-Best-Face-Swap/blob/main/docs/qwen-image-2.1-body.md) describes training references as front-facing, full-body people on a plain light background. Our tight outdoor portrait with a raised hand differs substantially. The guide recommends approximately 2 MP scene / 0.59 MP reference, original aspect ratios and the encoder's scene-sized latent; our graph already does those. Its proposed normalization pass can invent unseen clothing/body parts and weaken facial likeness. It requires review rather than automatic use. The author reports approximate pose matching and weaker faces when small.

**A native masked-edit baseline remains untested.** The [Qwen publisher](https://huggingface.co/Qwen/Qwen-Image-2.1) documents separate masks and painted annotations for localized edits. The [official Comfy template](https://github.com/Comfy-Org/workflow_templates/blob/main/templates/image_qwen_image_2_1_image_edit.json) uses twenty-five steps, CFG 1 and Euler/simple. Its [documentation](https://github.com/Comfy-Org/docs/blob/main/tutorials/image/qwen/qwen-image-2-1.mdx) identifies image 1 as the canvas and subsequent slots as references. Native mask-reference guidance is semantic conditioning, not exact pixel preservation. Test it without BFS: adding extra slots to BFS's trained two-image contract would be a different, unverified combination.

**Context, edit permission and blending need separate controls.** [Crop and Stitch](https://github.com/lquesada/ComfyUI-Inpaint-CropAndStitch) separates context expansion, mask expansion and stitch blending. That design addresses our hard boundary, but cannot repair incorrect skin or lighting inside the generated patch. With the selection covering two thirds of this frame, a context crop may not save much inference time.

**A small outfit adapter could serve a separate second stage.** The [Outfit Swap Consistency author](https://huggingface.co/ausboss/Qwen-Image-2.1-Outfit-Swap-Consistency-LoRA) reports less alignment drift and face/background repainting across sixteen held-out clothing edits. These are the author's tests, not our identity-transfer results. The adapter preserves an existing person while changing clothes; it is not a full-character identity swap. Evaluate it only after an identity edit is approved, on a separate model branch. It can retain old garment parts and does not improve fabric/pattern accuracy. The recommended file is **159,436,488 bytes**, revision `3ae2a126eff7c3eb4e3721d89a6f9f06a1f61704`; at our $0.005/GB cap ingress is approximately **$0.00080**. It has not been downloaded or added to our manifest.

**Do not stack a general consistency adapter blindly.** Its [author's update](https://huggingface.co/ausboss/Qwen-Image-2.1-Consistency-LoRA) warns of overfitting, ignored pose/head changes and ghosts after large removals. Holding a picture still differs from transferring the right identity. Global realignment also cannot correct a locally distorted face.

**Sampler changes merit a controlled test.** One [BFS head user's experiment](https://www.reddit.com/r/StableDiffusion/comments/1wpt3lp/qwen_image_21_new_bsf_lora_head_swap_test_results/) preferred `res_multistep / beta` at twenty steps over Euler/simple for sharpness. It used the earlier head v1 adapter and is not a universal result. Our pinned sampler code includes `res_multistep`; verify runtime scheduler availability before submitting. Change one variable at a time.

## Proposed evaluation, in order

1. **Correct boundary mechanics offline.** Version the new recipe and preserve v1–v3 paid conditioning. Separate the requested edit region, model guidance and final blend. Start with a visible 16–32 px outward allowance and 12–24 px blend transition on the output canvas, scaling with image size. These are proposed starting values, not measured best settings. Preview the effective mask and preserve explicitly protected foreground objects/holes. Keep exact original pixels outside the expanded permission region. Blend the completed edit into the original once.
2. **Establish a native Qwen baseline using installed weights.** Scene in slot 1, appearance in slot 2, clearly identified mask in slot 3; no BFS, Turbo, head refinement or Union. Keep the native scene-sized latent, current resolution, CFG 1, twenty-five Euler/simple steps and fixed seed. This is a separate native recipe, not a modification of BFS's two-image contract. If necessary, test forty steps independently; steps alone do not guarantee identity.
3. **Compare a simpler BFS body-only branch.** Use the same images, geometry and seed, with the head pass off. Compare the existing reference with a reviewed neutral-background reference. Avoid generating unseen anatomy just to satisfy a full-body format. Keep the original face reference immutable and inspect any normalized reference first.
4. **Repair only an observed residual failure.** If identity is good but clothing drifts, evaluate the small outfit adapter separately, then inspect the face again. If skin stays soft, isolate a sampler comparison. A head pass should earn its additional cost through an observed improvement.
5. **Validate before video.** Review raw outputs and final composites at full frame and face/hair boundaries. Check facial appearance, head/shoulder placement, hands, garment details, occlusions, light direction/temperature, shadows, texture and grain. Repeat on several references and seeds after the first controlled pair. Face-box ratios and pixel preservation are diagnostics, never an identity percentage. Carry a result to Viggle only after approval, with known source-video/frame provenance. Generic photos remain ordinary references.

Candidate native instruction:

> Edit <image1>, the target photograph. Replace only its person with the person shown in <image2>, including their recognizable face, hair, physical appearance, clothing and accessories. <image3> marks the region available for this replacement. Keep the target's head and shoulder positions, apparent size, body pose, expression, camera perspective and framing. Fit the replacement's clothing to that pose. Use the target's lighting, exposure, color temperature, shadows, focus and grain. Preserve its room, objects and occlusions. Use <image2> for appearance only; retain the target's arm and hand positions and illumination. Return one photograph with natural skin and clothing texture.

This instruction has not been rendered. A tight face reference could be evaluated later in the **native** branch, but the current manual face crop includes the raised hand and strong light and is not a facial-only cue.

## Limits and next checkpoint

The evidence identifies correctable mask/compositing problems and reference leakage. It does not establish that Qwen can satisfy every swap or match a hosted product on every image. No disclosed commercial backend here can honestly be described as a reverse-engineered equivalent. Image 2.0 remains the user's visual target, not a benchmark passed by this workflow. Qwen and the proposed consistency adapters retain their published research-license terms; future hosted use requires separate review.

No production defaults changed. The first baseline needs no new multi-GB stack. GPU fit, inference cost and visual quality require a separately authorized, queue-safe evaluation. See [the sanitized audit report](../validation/photo-consistency-audit-20261027.json).
