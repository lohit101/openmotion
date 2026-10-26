# Overnight realism and cost plan · 26 October 2026

The implementation is a source-frame repaint followed by Viggle propagation. The first GPU to test is a **48 GB RTX PRO 5000 Blackwell**, preferably the final **$0.667/hour compute / $0.693/hour running** quote with fast networking and low transfer fees, with **96 GB disk** and a 64 GB-class or larger host RAM allocation. Keep GPU compute at or below the user's **$0.70/hour hard ceiling**; disk is separate. **Three minutes for five seconds is a validation target, not an achieved result.**

The app and both standalone ComfyUI workflows are built. Offline checks pass, including real pinned ComfyUI prompt validation on CPU and actual tensor execution of the source-fitting, padding and anchor helpers. These checks load no model weights and do not establish GPU inference correctness or output quality. Vast's most recent rental attempt reports **insufficient credit**, and the provider currently lists no running or retained instances on this account. No new generated video, speed record, or visual-quality improvement is claimed for this implementation. Do not mistake the saved example timings for a new benchmark.

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

I also inspected the released publisher comparison videos at 0.5, 2.5 and 4.5 seconds, rather than relying only on promotional descriptions. The [review and background measurements](../validation/public-viggle-demo-review-20261026.json) separate those examples from our untested conversion. Motion/placement look promising; small montage faces cannot establish close-up fidelity. The newer [audio-pinned example](https://huggingface.co/Viggle/Viggle-Animate#limitations) demonstrates a separate speech-conditioning route and reports 51 seconds on B200 after loading. Our current video-only Comfy path does not implement that route. Original audio is retained in export, which does not by itself synchronize a generated mouth. The unreleased v2 teaser is excluded from the evidence.

The [official Wan-Animate-2 repository](https://github.com/Wan-Video/Wan-Animate-2) releases base and distilled animation paths; the [native distilled Comfy template](https://github.com/Comfy-Org/workflow_templates/blob/main/templates/video_wan_animate2_distilled.json) clarifies the available controls. The Lite real-time research result is not a released interchangeable replacement checkpoint. The [LightX2V replacement configuration](https://github.com/ModelTC/LightX2V/blob/main/configs/wan22/wan_animate_replace_lora.json) is the relevant accelerated v1 fallback, rather than an arbitrary Wan2.2 MoE style LoRA.

[FLUX.2 Klein's Comfy documentation](https://docs.comfy.org/tutorials/flux/flux-2-klein) supplies the native multi-reference editing path and four-step distilled image recipe. The chosen 4B FP8 checkpoint, full Qwen3-4B encoder and matching image VAE total **12.452 GB**. The video stack totals **27.977 GB**. No generic influencer LoRA is required: one may change texture or lighting and reduce identity fidelity. Future identity/style adapters must match the specific image or video model; existing Wan adapters cannot be reused on H3.

[Higgsfield distinguishes Object Swap from Motion Transfer](https://higgsfield.ai/blog/how-to-edit-videos-with-ai): one changes part of the original shot, while the other builds a new scene around its movement. Its public [Object Swap API](https://open.higgsfield.ai/models/higgsfield/genjutsu/object-swap/v1.0/api-reference) establishes inputs, not an internal model recipe. Our previous source/reference scene mismatches must not be compared as if those were the same task. Its newly advertised Lite service also does not establish our achievable local latency.

## GPU choice inside the ceiling

These are timestamped **Vast quotes, not reservations or benchmarks**. See [the sanitized quote report](../validation/overnight-gpu-quotes-20261026.json). Every row uses a single GPU, verified host, at least 48 GB allocated host RAM, 96 GB disk and at least 500 Mbps advertised download. Availability and fees can change before rental.

| GPU / example location | Compute / hour | Disk / hour | Running total / hour | Assessment |
|---|---:|---:|---:|---|
| RTX PRO 5000 48 GB / Nebraska | $0.6667 | $0.0267 | $0.6933 | Preferred final quote: 73.7 GB host RAM, 3,412 Mbps download, 7,456 MB/s reported disk and near-zero transfer fees. Actual timing still needs testing. |
| RTX PRO 5000 48 GB / India | $0.604 | $0.0267 | $0.6307 | Lower hourly price; its 629 Mbps download and higher transfer fee make cold sessions less attractive. |
| RTX 5090 32 GB / Japan | $0.5733 | $0.1333 | $0.7067 | Faster raw compute/bandwidth candidate, but tight VRAM, expensive retained disk and a lower host reliability score in this quote. Test only after the recipe works. |
| L40S 48 GB / US | $0.4333 | quoted separately | quoted separately | Economical alternate for suitable stacks; no matched timing here. |
| A40 48 GB / Belgium | $0.400 | quoted separately | quoted separately | Lower rental cost; older architecture may lose the time/cost advantage. |
| A800 PCIe 80 GB / US | $0.480 | $0.0178 | $0.4978 | Memory-rich alternative for a later unpruned INT8/audio experiment; not a demonstrated speed upgrade. |
| A100 PCIe 40 GB / Croatia | $0.600 | quoted separately | quoted separately | Not automatically faster for this quantized implementation. Different model/settings require a new measurement. |
| GB10 shared memory / Vietnam | $0.3067 | quoted separately | quoted separately | Capacity is attractive; previous local run and low bandwidth make it a poor speed-first recommendation. |

[NVIDIA's PRO 5000 specifications](https://www.nvidia.com/en-au/products/workstations/professional-desktop-gpus/rtx-pro-5000/) list 48 GB and 1,344 GB/s memory bandwidth; [5090 specifications](https://www.nvidia.com/en-us/geforce/graphics-cards/50-series/rtx-5090/) list 32 GB and 1,792 GB/s. **The 5090 has more raw throughput; PRO 5000 buys memory headroom.** VRAM must fit first, then measured same-workflow time decides. Internet bandwidth affects setup/transfers, not the speed of a resident sampler. GPU memory bandwidth is different from Internet bandwidth. Marketing FP4/sparse TOPS and Vast DLPerf cannot be converted into our seconds per clip.

The A800 80 GB quote means extra model capacity can fit the budget without moving to an expensive H100. Its older architecture still needs a matched timing. If pruned weights or speech conditioning limit fidelity, evaluate an unpruned INT8 video checkpoint and audio VAE there before spending above the ceiling. Do not assume the existing 21 GB pruned conversion is equivalent for audio conditioning.

No current verified PRO 6000/H100/B200 offer in the sampled results met the compute ceiling. Do not stretch the budget based on hypothetical throughput. Keep one GPU active at a time. The server enforces this compute ceiling on listing and rental revalidation, and before resuming stopped compute. Storage remains a separate line item; no healthy setup/render is stopped for elapsed time.

## Realistic cost envelope

At the final Nebraska PRO 5000 quote, the **running** price is $0.6933/hour including 96 GB disk. Warm per-attempt costs, **conditional on measured latency**, would be:

| End-to-end time for a five-second shot | Compute + disk per attempt |
|---|---:|
| 90 seconds | $0.0173 |
| 3 minutes | $0.0347 |
| 5 minutes | $0.0578 |
| 10 minutes | $0.1156 |

These are arithmetic scenarios, not predictions. Two attempts per accepted take double those variable costs. A three-minute pipeline with a 50% acceptance rate costs about **$0.069 per usable take**, before setup, transfers, persistent storage and other service overhead.

The final Nebraska host quotes $0.000002604/GB ingress: about **$0.00011** for the 40.428 GB model pack, with a theoretical transfer minimum of **1.6 minutes** at its advertised 3,411.8 Mbps. Its quoted storage is unchanged from the India alternative. A higher compute rate here can lower total cold-session cost.

For comparison, the India host charges about **$0.263** to download the same files, with a model-transfer minimum of **8.6 minutes** at 629.4 Mbps. The Taiwan quote has higher transfer fees again. OS/PyTorch downloads, HTTP overhead, retries, hashing and installation add time and possibly traffic charges; advertised network speed is not a measured transfer rate. Neither quote establishes a universal five-minute first launch.

If complete setup took 15 minutes on the Nebraska host, its running charge would be about **$0.173**. Amortized across ten accepted one-attempt three-minute clips, setup plus model ingress adds about $0.017 per clip: roughly **$0.052 each** in that hypothetical session, before other traffic and overhead. Include actual failed attempts, idle time and persistent storage in the final measurement. The lower-rate India example would be about $0.074 for the same hypothetical session because its model transfer fee dominates the small compute saving.

For a service, batch jobs and measure acceptance rate. At three minutes per attempt, one GPU has at most 20 attempts/hour before overhead; 50% acceptance means at most 10 usable clips/hour. A single clip per day cannot be priced from marginal compute alone: retained disk and idle time can dominate.

Retaining 96 GB at the quoted disk rate costs about **$0.64/day or $19.20 per 30 days**, even with compute stopped; stopped storage rates can differ and must be checked. Reusing this disk avoids repeated 40 GB downloads but loses VRAM caches when compute stops. Stop compute after a batch; retain or delete disk according to the intended return interval. There is no always-on rental requirement, automatic quality rerender, or hidden API bill.

## Validation before choosing a winner

1. Confirm the rented card, RAM, driver, current compute/disk/transfer prices and free disk; do not launch above $0.70/hour compute. Record provider setup, runtime install, model download and cold model load separately.
2. Use a real five-second continuous source shot, one clearly visible adult character, 24 fps and 480p. Use movement-focused footage for the current video-only path; speech is a separate validation. The latest five-second source contains a cut around 3.33 seconds; that is a separate stress test, not a clean first benchmark. Keep the same source, character, crop and seed for a matched comparison.
3. Review the saved source-aligned keyframe, then measure three-pass video sampling, decode, upload/download and final end-to-end time. Distinguish first render from warm repeats. Count all failed attempts and billed setup.
4. Inspect synchronized frames at the beginning, 0.5 s, 1 s, 2 s, 3 s, 4 s and the end. Record screen position/head scale relative to source, occlusion boundaries, mouth/hand anatomy, facial identity, exposure flicker and fine camera texture. Pose/framing metrics are diagnostics, not proof that a video is indistinguishable from real footage.
5. Only after a good short result, test one second shot and one occlusion/lighting case. Test 704/720p separately. Upscaling cannot fix identity drift or reconstruct real facial motion that was never generated.
6. If PRO 5000 meets quality and time targets, keep the stack and benchmark the same graph on a good 5090 only to test whether memory offload erases its raw speed advantage. If Viggle fails quality, test Wan v1's task-specific four-step replacement recipe. Do not pile on unrelated LoRAs or silently rent a larger GPU.

A paid test was not run while credits were unavailable. The UI labels the new path experimental, leaves existing SCAIL defaults/drafts intact, and retains true progress, explicit downloads, immutable job settings, local output receipts and manual stop/destroy controls. See [the operational workflow guide](viggle-workflow.md) for the exact installed files and controls.

The final [validation record](../validation/overnight-implementation-20261026.json) distinguishes unit/protocol checks, real ComfyUI CPU validation, public-demo review and the still-blocked GPU test. No new rental or paid render was created during this work.
