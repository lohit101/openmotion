# Body-only head correction and accepted native baseline

The user reported that a native body edit transferred physique but retained too much source facial shape. The inspected run was `e7eba1ad-843f-40c8-8292-709ce8250f81`, `body-only-v2`: one native three-reference diffusion pass, not separate body and face samplers. Its raw output already contained the facial compromise. Final background compositing was not reverting a successful face swap.

## Evaluated routes

| Run | Route | Native execution | End to end | Observation |
| --- | --- | ---: | ---: | --- |
| `7db3f434-51bf-4670-a3a7-c6ae42c6f910` | BFS body / source outfit / head, v3 | 58.100 s | 84.845 s | Body transfer visible, but bent arm lost and head overprocessed. Failed. |
| `b029e2ce-c597-4d1d-9ee4-30f74f9208b4` | Pose-guided body / outfit / Euler head, v4 | 87.860 s | 124.531 s | Body stage keeps source arm pose. Outfit stage reintroduces source hair/appearance. Failed combined result. |
| `ab9db44c-e23c-4650-97a9-7fafe89dfba1` | Reuse paid body, enlarged head, v5 | See sanitized JSON | 44.009 s | Clearer facial transfer; upward-looking reference affects proportions. |
| `5d7c2a4a-b412-4635-8733-ff700ca65405` | Same body, neutral front head reference, v5 | See sanitized JSON | 40.380 s | Useful visual alternative; introduced a reference-like necklace below the jaw. |
| `a84ea227-4538-4432-ae9d-ed45ca550c10` | New native body + enlarged head, v5 | See sanitized JSON | 56.871 s | Body remains unchanged during head correction, but body edit already changed mouth opening; head copied that altered expression. |
| `2a1352a0-4835-45c7-980d-3655260a3b74` | Reuse paid body, original-source head pose/expression, v6 | See sanitized JSON | 35.130 s | Better source mouth opening with transferred identity; head-neck permission excludes necklace area. This is an optional evaluation, not the accepted default. |

The separate head route gives a contextual square crop 1024×1024 pixels, uses the matching BFS Qwen 2.1 head v1.1 adapter at strength 1, 20 Euler/simple steps, CFG 1, and its trained two-image contract. The head adapter branches directly from the base model; it is not stacked on Turbo/body/outfit adapters. An opaque facial interior and outer boundary feather allow cheeks/jaw outline to change rather than retaining the old jaw through an inward-only mask. Original target-bound mask holes remain protected. V6 takes head pose/expression from the original source, while compositing onto the transferred body.

Face-only retries freeze the parent job ID and final PNG SHA-256. They validate source/body/mask bindings, reuse its exact paid pixels and omit the body sampler and Turbo requirement. New body generation is never substituted if the parent is missing or changed. Four head evaluations preserved every decoded body pixel outside their recorded head masks (maximum difference zero). New finalization validates this, as well as exact source pixels outside the full edit area. Face masks and hashes are not identity scores.

The v3/v4 three-stage route remains experimental. The source photo provided to the outfit adapter contains the original face/body and caused appearance regression in our pair, despite the publisher's preservation claims. A local clothes-only parser was probed offline, but was not integrated into the product or used in the paid results. Its experimental captures stay ignored.

## User-accepted baseline

The user subsequently accepted their own latest `Frame 0.00s / Imagen`, `545ff68d-173f-4acd-98bf-c805f57cea90`, created 2026-10-28 20:07 UTC. It uses **native v2**, not the new head experiments:

- Qwen Image 2.1 INT8, matching Qwen3-VL encoder/RGBA VAE, official Turbo adapter; 8 Euler/simple steps, CFG 1, 1 MP.
- One front body view and one front facial view. The accepted local draft retains their original bound sheet crop coordinates.
- Source clothing/accessories prompt; 64-pixel edit expansion, 12-pixel feather, interior gaps filled, background protection enabled.
- No BFS body/head/outfit, Union, relight, local identity or extra face pass.
- Actual accepted seed `1583893113`. The paid run had random seed enabled. Its saved output/settings remain immutable; the working draft and ignored local baseline copy disable randomization for repeatability.
- End to end 24.393 seconds. The earlier 2 MP user run took 41.112 seconds with another seed. Those two changes prevent attributing the appearance difference to resolution alone.

The accepted photo is favorited. No further paid renders were submitted after this acceptance. The user then requested these Imagen defaults and the same settings for segment-frame repaints. Automatic per-segment repaint integration is a separate integration decision: the current video continuation still uses its recorded previous-frame appearance and five-frame motion anchors. Do not label a saved photo preset as an automatically running segment repaint.

## Validation, costs and terms

Twenty-five Python image-preparation/finalization tests pass. Focused Studio tests cover graph contracts, parent guards, progress and paid submission/recovery. Fifteen paid photo graphs, including native, staged, head evaluations and the user-accepted baseline, recompile exactly to their stored graphs. No paid media or input conditioning was rewritten.

At the saved A6000 compute rate of $0.40/hour, the four new head evaluations' total end-to-end time of 176.390 seconds corresponds to about **1.96 cents** of compute. This excludes idle/resume time and separately billed storage/transfer; it is not a provider invoice. The head tests used cached models with no new weights downloaded. Earlier staged evaluation explicitly downloaded 629.29 MB of adapters and 7.55 GB Union; at $0.0026041667/GB that is approximately 2.13 cents ingress, separate from the earlier core stack. Retained disk is $0.0177778/hour. Compute was subsequently confirmed `exited`, intended `stopped`, `computeStopped: true`; media and model storage remain.

Model terms remain those of the existing pinned Qwen/BFS/Union and outfit adapters. Private evaluation does not establish commercial-service rights. The optional local clothing parser's SegFormer research terms are not superseded by MIT training code. The new head correction adds no hosted service or moderation dependency.

Primary references: [BFS head contract and limitations](https://huggingface.co/Alissonerdx/BFS-Best-Face-Swap/blob/main/docs/qwen-image-2.1.md), [outfit adapter and flat-lay support](https://huggingface.co/ausboss/Qwen-Image-2.1-Outfit-Swap-Consistency-LoRA), [Union pose controls](https://huggingface.co/alibaba-pai/Qwen-Image-2.1-Fun-Controlnet-Union).
