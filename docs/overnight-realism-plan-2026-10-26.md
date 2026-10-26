# Overnight realism and cost plan · 26 October 2026

The implementation is a source-frame repaint followed by Viggle propagation. The first GPU to test is a **48 GB RTX PRO 5000 Blackwell**, with **96 GB disk** and a 64 GB-class or larger host RAM allocation. Keep GPU compute at or below the user's **$0.70/hour hard ceiling**; disk is separate. **Three minutes for five seconds is a validation target, not an achieved result.**

The app and both standalone ComfyUI workflows are built. Offline checks pass. Vast's most recent rental attempt reports **insufficient credit**, and the provider currently lists no running or retained instances on this account. No new generated video, speed record, or visual-quality improvement is claimed for this implementation. Do not mistake the saved example timings for a new benchmark.

## What changes the result

The current SCAIL setup takes an independent character image and tries to reconcile its scene, pose and apparent scale with the source. Prompt instructions and affine alignment improved its conditioning, but do not guarantee local replacement. More undistilled steps increase cost without fixing that mismatch.

The new path first edits a frame from the source with **FLUX.2 Klein 4B**, using the character photo as the second image reference. This gives the video stage an appearance reference already in the original pose, framing and lighting. **Viggle Animate** then propagates that edit using the source video. It needs no pose estimator, SAM tracker, vision encoder or video text encoder. The exact frame used is saved alongside the video for inspection. SCAIL remains available, and old jobs remain on their original engine.

This is a useful architectural change, not a promise of perfect compositing. Klein can alter a face or clothing; Viggle can alter fine detail or struggle with occlusion, speech and cuts. Review the keyframe before attributing an error to the temporal model. Keep ordinary camera texture instead of smoothing everything into a polished synthetic portrait.

## Research decisions

| Candidate | What the released implementation provides | Decision |
|---|---|---|
| Viggle Animate + source repaint | Task-specific replacement; exact three-pass DMD schedule; community pruned INT8 Comfy conversion | Implemented as the primary experiment. Strongest released replacement/speed evidence; consumer result still needs measurement. |
| Wan2.2 Animate v1 + LightX2V | Actual replacement mode; masks, face/pose preprocessing and relighting; published four-step acceleration recipe | Credible fallback if Viggle's quality or memory behavior fails. Do not add a second large video stack before the first test. |
| Wan-Animate-2 | End-to-end raw-video motion animation; distilled weights and native Comfy integration | Promising for Motion transfer. Its current Comfy workflow does not expose v1's replacement mode, so do not present it as a drop-in local swap. |
| SCAIL-2 | Existing tested integration, tracking, motion transfer and replacement | Retained as baseline. Extra steps and influencer style adapters do not solve the current placement/texture problem. |
| LTX-2.5 + IC-LoRAs | Fast open-weight generation and task-specific control/reference adapters | Secondary investigation. No established matched full-character replacement benchmark on our inputs; motion or reference conditioning alone does not demonstrate faithful local editing. |
| Closed Kling / Higgsfield Genjutsu | Hosted character editing; public product/API interface | Useful comparison target. No evidence their private weights or exact pipeline can be recovered from the public UI. No paid API dependency added. |

[Viggle's publisher](https://viggle.ai/research/viggle-animate-character-replacement-from-a-repainted-frame) reports **26 seconds** for 124 frames, 24 fps, 480×832 on B200, **after the repainted frame exists**. Sampling is 13.6 seconds and uses three forward passes. The consumer INT8 conversion, image editing, model loading and our app add different costs. The announced optimized 5090 route is not released. That B200 result cannot establish a consumer three-minute promise.

The [official Wan-Animate-2 repository](https://github.com/Wan-Video/Wan-Animate-2) releases base and distilled animation paths; the [native distilled Comfy template](https://github.com/Comfy-Org/workflow_templates/blob/main/templates/video_wan_animate2_distilled.json) clarifies the available controls. The Lite real-time research result is not a released interchangeable replacement checkpoint. The [LightX2V replacement configuration](https://github.com/ModelTC/LightX2V/blob/main/configs/wan22/wan_animate_replace_lora.json) is the relevant accelerated v1 fallback, rather than an arbitrary Wan2.2 MoE style LoRA.

[FLUX.2 Klein's Comfy documentation](https://docs.comfy.org/tutorials/flux/flux-2-klein) supplies the native multi-reference editing path and four-step distilled image recipe. The chosen 4B FP8 checkpoint, full Qwen3-4B encoder and matching image VAE total **12.452 GB**. The video stack totals **27.977 GB**. No generic influencer LoRA is required: one may change texture or lighting and reduce identity fidelity. Future identity/style adapters must match the specific image or video model; existing Wan adapters cannot be reused on H3.

[Higgsfield distinguishes Object Swap from Motion Transfer](https://higgsfield.ai/blog/how-to-edit-videos-with-ai): one changes part of the original shot, while the other builds a new scene around its movement. Its public [Object Swap API](https://open.higgsfield.ai/models/higgsfield/genjutsu/object-swap/v1.0/api-reference) establishes inputs, not an internal model recipe. Our previous source/reference scene mismatches must not be compared as if those were the same task. Its newly advertised Lite service also does not establish our achievable local latency.

## GPU choice inside the ceiling

These are timestamped **Vast quotes, not reservations or benchmarks**. See [the sanitized quote report](../validation/overnight-gpu-quotes-20261026.json). Every row uses a single GPU, verified host, at least 48 GB allocated host RAM, 96 GB disk and at least 500 Mbps advertised download. Availability and fees can change before rental.

| GPU / example location | Compute / hour | Disk / hour | Running total / hour | Assessment |
|---|---:|---:|---:|---|
| RTX PRO 5000 48 GB / India | $0.604 | $0.0267 | $0.6307 | First test: enough model headroom and current Blackwell kernels. Its 629 Mbps download is a cold-start weakness. |
| RTX 5090 32 GB / Japan | $0.5733 | $0.1333 | $0.7067 | Faster raw compute/bandwidth candidate, but tight VRAM, expensive retained disk and a lower host reliability score in this quote. Test only after the recipe works. |
| L40S 48 GB / US | $0.4333 | quoted separately | quoted separately | Economical alternate for suitable stacks; no matched timing here. |
| A40 48 GB / Belgium | $0.400 | quoted separately | quoted separately | Lower rental cost; older architecture may lose the time/cost advantage. |
| A100 PCIe 40 GB / Croatia | $0.600 | quoted separately | quoted separately | Not automatically faster for this quantized implementation. Different model/settings require a new measurement. |
| GB10 shared memory / Vietnam | $0.3067 | quoted separately | quoted separately | Capacity is attractive; previous local run and low bandwidth make it a poor speed-first recommendation. |

[NVIDIA's PRO 5000 specifications](https://www.nvidia.com/en-au/products/workstations/professional-desktop-gpus/rtx-pro-5000/) list 48 GB and 1,344 GB/s memory bandwidth; [5090 specifications](https://www.nvidia.com/en-us/geforce/graphics-cards/50-series/rtx-5090/) list 32 GB and 1,792 GB/s. **The 5090 has more raw throughput; PRO 5000 buys memory headroom.** VRAM must fit first, then measured same-workflow time decides. Internet bandwidth affects setup/transfers, not the speed of a resident sampler. GPU memory bandwidth is different from Internet bandwidth. Marketing FP4/sparse TOPS and Vast DLPerf cannot be converted into our seconds per clip.

No current verified PRO 6000/H100/B200 offer in the sampled results met the compute ceiling. Do not stretch the budget based on hypothetical throughput. Keep one GPU active at a time. The server enforces this compute ceiling on listing and rental revalidation, and before resuming stopped compute. Storage remains a separate line item; no healthy setup/render is stopped for elapsed time.

## Realistic cost envelope

At the India PRO 5000 quote, the **running** price is $0.6307/hour including 96 GB disk. Warm per-attempt costs, **conditional on measured latency**, would be:

| End-to-end time for a five-second shot | Compute + disk per attempt |
|---|---:|
| 90 seconds | $0.0158 |
| 3 minutes | $0.0315 |
| 5 minutes | $0.0526 |
| 10 minutes | $0.1051 |

These are arithmetic scenarios, not predictions. Two attempts per accepted take double those variable costs. A three-minute pipeline with a 50% acceptance rate costs about **$0.063 per usable take**, before setup, transfers, persistent storage and other service overhead.

The 40.428 GB model download costs about **$0.263** at this host's $0.0065104/GB ingress quote. At its advertised 629.4 Mbps, that transfer alone has a theoretical minimum of **8.6 minutes**. OS/PyTorch downloads, HTTP overhead, retries, hashing and installation add time and possibly traffic charges. A fresh machine cannot honestly promise a five-minute full-stack launch on that network.

If setup took 15 minutes, its running charge would be about $0.158. Amortizing that plus the model-transfer fee across ten accepted one-attempt three-minute clips adds roughly $0.042 per clip: about **$0.074 each** in that hypothetical session. Include actual failed attempts in the final measurement.

Retaining 96 GB at the quoted disk rate costs about **$0.64/day or $19.20 per 30 days**, even with compute stopped; stopped storage rates can differ and must be checked. Reusing this disk avoids repeated 40 GB downloads but loses VRAM caches when compute stops. Stop compute after a batch; retain or delete disk according to the intended return interval. There is no always-on rental requirement, automatic quality rerender, or hidden API bill.

## Validation before choosing a winner

1. Confirm the rented card, RAM, driver, current compute/disk/transfer prices and free disk; do not launch above $0.70/hour compute. Record provider setup, runtime install, model download and cold model load separately.
2. Use a real five-second continuous source shot, one clearly visible adult character, 24 fps and 480p. The latest five-second source contains a cut around 3.33 seconds; that is a separate stress test, not a clean first benchmark. Keep the same source, character, crop and seed for a matched comparison.
3. Review the saved source-aligned keyframe, then measure three-pass video sampling, decode, upload/download and final end-to-end time. Distinguish first render from warm repeats. Count all failed attempts and billed setup.
4. Inspect synchronized frames at the beginning, 0.5 s, 1 s, 2 s, 3 s, 4 s and the end. Record screen position/head scale relative to source, occlusion boundaries, mouth/hand anatomy, facial identity, exposure flicker and fine camera texture. Pose/framing metrics are diagnostics, not proof that a video is indistinguishable from real footage.
5. Only after a good short result, test one second shot and one occlusion/lighting case. Test 704/720p separately. Upscaling cannot fix identity drift or reconstruct real facial motion that was never generated.
6. If PRO 5000 meets quality and time targets, keep the stack and benchmark the same graph on a good 5090 only to test whether memory offload erases its raw speed advantage. If Viggle fails quality, test Wan v1's task-specific four-step replacement recipe. Do not pile on unrelated LoRAs or silently rent a larger GPU.

A paid test was not run while credits were unavailable. The UI labels the new path experimental, leaves existing SCAIL defaults/drafts intact, and retains true progress, explicit downloads, immutable job settings, local output receipts and manual stop/destroy controls. See [the operational workflow guide](viggle-workflow.md) for the exact installed files and controls.
