# Layered source-frame photo evaluation

Seven same-input comparisons on the retained RTX PRO 4500 did not meet the full identity, pose, outfit and illumination requirement. These are experimental options, not production defaults. Input photographs, raw stages and receipts remain local; the small sanitized measurements are in `validation/photo-layered-evaluation-20261027.json`.

The key failure is competing reference information. The donor photograph has a raised hand, hard sunlight and an overlay near its tank top. Body transfer can import all three. Conversely, source inpainting and detailed Canny conditioning can retain the original face, bun, clothing and jewelry. More steps alone did not solve this.

| Test | End-to-end seconds | Observed result |
| --- | ---: | --- |
| A: body-only | 64.105 | Donor transfer, but copied hand/light and clipped hair. |
| C: native base + mask reference + head | 103.523 | Mask interpreted as a cutout with purple background/fringe. Rejected. |
| D: native base, two photographs | 52.780 | Removed purple cutout; still copied donor pose/light. |
| E: face → outfit → illumination | 187.671 | Better pose and room light, but original hair/appearance persisted. |
| F: normalized reference → body | 62.966 | Removed unwanted raised hand; hard sunlight and clipped hair remained. |
| G: normalized reference → body → illumination | 112.656 | Best donor appearance, but smaller/higher face, tattoo/strap errors and a blend halo. |
| H: reference → body with contour control → illumination | 161.231 | Better pose/light and clean boundary; retained original identity. Rejected. |

The newer options preserve separate adapter branches instead of stacking body, head, outfit and consistency LoRAs together. Every paid recipe has a version and retains raw outputs. The native mask experiment uses the base model's extra reference slots; it never adds a third image to the trained two-reference BFS body adapter. The default settings have not been changed to a failed candidate.

## Boundary correction

Explicit edit allowance expands the brush region by up to 64 source pixels. Interior protection holes remain protected unless the user enables filling. Final protection applies to this effective area. Optional local NORMAL_CLONE integration removes the pale alpha seam using the generated image's gradients; it preserves exact decoded target pixels outside that area. It does not move, scale or warp the actor. MIXED_CLONE is not used because it may reintroduce source facial detail. Raw assembled stages and local finalization allow recovery without another paid inference.

## Next controlled experiment

`scene-anchor-v7` removes source facial, hair and internal clothing edges from the placement guide, retaining a neutral head outline and outer placement. An optional local identity stage transfers the original reference face into the target before the body edit, then uses that same original reference after scene integration. It does not use the generated normalized reference as facial authority. Models are verified and the stage is cached per immutable input. Generation never downloads them.

Local identity setup is explicit:

```sh
python3 scripts/local_identity.py setup
```

Requires Python 3.13. The pinned FaceFusion checkout and nine model pairs occupy approximately 1.22 GB on the local computer, not the rental disk. `python3 scripts/local_identity.py status` is read-only. The tested CPU swap operator took 3.329 seconds in the initial trace and 2.484 seconds after wrapping; cold import, checksum and image-check time are additional. This is not an identity guarantee or quality benchmark across other images. The upstream image content check is retained, with network model discovery disabled during inference. No embeddings or inferred demographic labels are saved.

FaceFusion's code and individual weights have separate terms; the recognition weights identify themselves as non-commercial. This optional private evaluation route is not cleared for the proposed future hosted business. It is disabled by default. A face-only model cannot independently transfer hair, body or garments, and can soften details; compare all stages before using an image for video.

GPU compute is $0.360/hour, with retained 64 GB storage $0.023704/hour. Model ingress is $0.002604/GB on this host. About 25.62 GB of photo files were explicitly downloaded during this evaluation, approximately 6.7 cents in ingress. Render-only compute for the seven listed comparisons is approximately 8.5 cents; instance startup and idle time are additional. These are estimates, not the provider's account receipt. The rental was confirmed stopped for offline implementation between tests. Retained storage continues to be billed.

Sources: [official Qwen ComfyUI recipe](https://github.com/Comfy-Org/workflow_templates/blob/main/templates/image_qwen_image_2_1_image_edit.json), [BFS body input contract](https://huggingface.co/Alissonerdx/BFS-Best-Face-Swap/blob/main/docs/qwen-image-2.1-body.md), [outfit consistency adapter](https://huggingface.co/ausboss/Qwen-Image-2.1-Outfit-Swap-Consistency-LoRA), [general consistency adapter](https://huggingface.co/ausboss/Qwen-Image-2.1-Consistency-LoRA), [FaceFusion](https://github.com/facefusion/facefusion), [face swapper options](https://docs.facefusion.io/usage/cli-arguments/processors/face-swapper).
