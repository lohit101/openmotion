# Revised latency, cost and Higgsfield audit

Checked 26 October 2026 IST. This supplements and updates the [production plan](production-character-replacement-plan-2026-10-26.md). Public documentation, public source code, saved local histories and read-only Vast marketplace quotes were inspected. No GPU was started, no paid API was invoked, and no runtime or generation graph was changed.

**Superseded implementation order:** the user has requested a cheaper plan. The [budget-first plan](budget-character-replacement-plan-2026-10-26.md) now governs execution. The H200/B200/96GB and 256GB recommendations and 175s budget here are historical research scenarios, not current rental instructions or authorization. Start with one low-cost GPU and one video stack; paid validation requires separate approval.

## What the 160-second benchmark means

The prior recommendation needed a clearer distinction: a published 160-second Wan-Animate render is not a forecast for the existing SCAIL configuration.

| Variable | Last local result | Publisher's Wan comparison |
| --- | --- | --- |
| Model/task | SCAIL-2, Motion transfer | Wan2.2-Animate, replacement |
| GPU | A100 PCIe 40GB | B200 |
| Dimensions | 704×1248 | 480×832 |
| Output | 120 frames / 24fps / 5s | 124 frames / 24fps / about 5.17s |
| Sampler | 16 steps per section, CFG5, UniPC | 20 steps, CFG1, two chunks |
| Precision/runtime | INT8 ConvRot, native ComfyUI, PyTorch SDPA | BF16, no offload or compilation |
| Measured elapsed | 2463.988s / 41m04s | 160s after weight loading; excludes source preprocessing |

The publisher breaks Wan's time into 140s sampling and 20s other video-render work. Its 40 forward passes mean **20 steps × two chunks**, not CFG doubling. Wan's official defaults are CFG1, and its generation code runs the unconditional branch when guidance exceeds 1. Our CFG5 requires additional positive/negative conditioning work. The exact batching and step cost still require profiling. [Matched comparison](https://viggle.ai/research/viggle-animate-character-replacement-from-a-repainted-frame), [Wan defaults](https://github.com/Wan-Video/Wan2.2/blob/main/wan/configs/wan_animate_14B.py), [guidance implementation](https://github.com/Wan-Video/Wan2.2/blob/main/wan/animate.py).

Our frame area is exactly **2.2×** larger; output pixel-frame volume is **2.129×** larger. Neither ratio is a wall-time multiplier: temporal attention, padding, memory traffic and the different networks matter. Both paths use multiple sections, so chunking alone does not explain the difference. Our second graph loads 44 source frames including five overlapping frames to add 39 new output frames.

The saved ComfyUI timestamps establish something more useful than speculation:

- Section 1 executed for **1772.936s** and section 2 for **665.806s**.
- Together, **2438.742s / 40m39s / 98.975%** of the whole job elapsed inside server graph execution.
- The other job time was approximately **25.246s**. Slow dashboard polling, final download and local assembly do not explain this render's 41 minutes.

Server graph execution includes model loading, preprocessing, sampling, decoding and export; it is not a denoiser-only GPU timing. There is no saved per-node/PCIe profiler for this A100 run. CPU offloading, activation pressure and attention dispatch are plausible contributors, not measured root causes. The server deliberately uses PyTorch attention for compatibility, but SDPA can select fused kernels; it must not be labelled inherently slow. INT8 similarly does not establish which kernels dominate. See [the expanded local audit](../validation/latest-output-audit-20261026.json).

## What public reverse engineering establishes about Higgsfield

Higgsfield offers several distinct backends. Its **Kling3 Motion Control** explicitly uses Kling and animates an image from a video. Its **Genjutsu Object Swap** requests localized replacement in existing footage; **Genjutsu Motion Transfer** reconstructs a scene from references. The public Genjutsu upstream checkpoint is not disclosed. [Genjutsu product](https://higgsfield.ai/genjutsu), [Kling endpoint](https://open.higgsfield.ai/models/kling-video/v3/motion-control/std/playground).

The public full Genjutsu request has four fields: source `video_url`, 1–8 `image_urls`, optional `prompt`, and `resolution` (480p/720p/1080p). The official ComfyUI node forwards exactly those fields to a paid hosted endpoint. Its UI seed determines reruns/cache behavior; it is not sent as a generation seed. No local Genjutsu model weights are contained in that node. [Actual integration source](https://raw.githubusercontent.com/Comfy-Org/ComfyUI/master/comfy_api_nodes/nodes_higgsfield.py), [request schema](https://raw.githubusercontent.com/Comfy-Org/ComfyUI/master/comfy_api_nodes/apis/higgsfield.py), [Object Swap API](https://open.higgsfield.ai/models/higgsfield/genjutsu/object-swap/v1.0/api-reference).

This supports recreating the user-facing contract and task separation. It does **not** reveal whether Genjutsu internally uses keyframe repainting, masks, distillation, multiple models, compositing or a particular GPU. Those would be hypotheses. Our proposed source-frame edit/propagation pipeline is grounded in released replacement models, not a recovered private Higgsfield graph. Public help describes priority versus shared queues and usually-few-minute generation, without a three-minute SLA. [Queue documentation](https://higgsfield.ai/creator-hub/help-center/troubleshooting/generation-is-stuck-or-failed), [latency guidance](https://higgsfield.ai/creator-hub/help-center/getting-started/how-do-i-create-my-first-generation).

## India and the Viggle/H3 licence

**India is not an excluded territory.** That resolves the operator-location question, but does not give blanket clearance for the entire use. The licence grants rights within its applicable territory and Section V.4 also restricts use/distribution/display of **outputs** outside it. Thus a US/EU rental or globally distributed social post needs clarification from MiniMax. Japan hosting avoids the enumerated hosting-country exclusion; it does not itself settle publication rights. Commercial UI attribution, public AI-disclosure conditions, service obligations and the $20m annual-revenue authorization threshold also remain. These are material licence terms, not a claim that commercial use is prohibited everywhere. [Exact licence, especially II, IV, V.4 and Exhibit A](https://huggingface.co/Viggle/Viggle-Animate/raw/main/LICENSE).

Keep Viggle a conditional production candidate until those intended uses are resolved. Wan-Animate's Apache2 alternative avoids this particular territorial/output-licence issue. No licence question authorizes adding unrelated hosted moderation dependencies to our local pipeline.

## Revised technical route to under three minutes

Define the target as **Generate to playable output on a ready, warmed GPU**, including automated input preparation, generation, optional finishing and export. The GPU runtime, required weights and compatible kernels must already be installed. Report fresh rental setup, downloads, cold model load, compilation, queueing and human approval separately; all billed GPU time still counts toward cost.

1. **Profile one fixed shot.** Add per-node times, steady sampler timings, peak allocated/reserved VRAM, actual attention/quantized-linear dispatch, CPU/GPU utilization and CPU↔GPU traffic. Distinguish first-step/model loading from later steps and check cached conditioning across windows. Preserve all job inputs and conditioning hashes.
2. **Generate at 480p-class dimensions first, at the requested 24fps.** Preserve aspect/framing with padding. Process each continuous shot separately. The current source cut near 3.33s should be a shot boundary. Respect each model's temporal frame grid, then trim accurately; do not silently slow or speed the performance.
3. **Permissive speed candidate: Wan-Animate through LightX2V's released replacement implementation.** Establish a standard-quality reference and compare its actual four-step, CFG-disabled, rank32 I2V distillation recipe. The four-step preset uses no CPU offload and FlashAttention3; use a supported backend for the selected GPU. The separately published 4090 FP8/SageAttention2 preset still uses 20 steps. Combining its memory configuration with four-step distillation is an experiment, not a prevalidated consumer-GPU speed result. [Four-step preset](https://github.com/ModelTC/LightX2V/blob/main/configs/wan22/wan_animate_replace_lora.json), [4090 preset](https://github.com/ModelTC/LightX2V/blob/main/configs/wan22/wan_animate_replace_4090.json), [actual runner](https://github.com/ModelTC/LightX2V/blob/main/scripts/wan22/run_wan22_animate_replace.sh).
4. **Conditional speed/quality challenger: Viggle on 96GB+ memory.** Use the released finetuned transformer and its matched DMD adapter, a source-frame repaint, and the canonical three-pass schedule. The B200 publisher result is 26s, with a separate audio-conditioned example at 51s; neither establishes H200/PRO latency. Its 80.1GiB unoffloaded peak excludes a nominal 80GB card. Preserve source audio; include audio conditioning in the test when expression/lip timing matters. The author's fast 5090 NVFP4 path remains unreleased. [Released requirements and audio example](https://huggingface.co/Viggle/Viggle-Animate).
5. **Prepare the replacement within a real source frame.** Qwen2511 full-person editing and FLUX2 Klein4B/BFS head-only editing are separate options, with matched adapters. Reuse an approved edit and source-preprocessing cache on retries. Do not load every optional model. On 96GB, an image editor and Viggle's active peak may not fit simultaneously: explicitly unload/switch or use a separate worker and measure that time. Larger H200/B200 capacity may reduce this switching overhead; it must be profiled.
6. **Finish only an accepted base result.** Compare ordinary resizing with FlashVSR+ Turbo at 720p/1080p. Keep original source pixels outside the intended replacement region where tracked masks/occlusions make compositing valid, and inspect edges, shadows and reflections. Hard compositing is not automatically appropriate for every full-person replacement. Upscaling cannot fix anatomy, placement or identity. [Finisher](https://github.com/OpenImagingLab/FlashVSR_Plus).

Engineering acceptance budget, **not measured times**:

| Stage | Maximum target |
| --- | ---: |
| Automated source preparation and edited keyframe | 35s |
| Video replacement | 100s |
| Optional temporal finishing | 30s |
| Export, transfer and audio mux | 10s |
| Total | **175s**, with 5s margin |

An illustrative Wan calculation explains why four-step testing is worthwhile: if the benchmark's 140s sampling fell proportionally with 20→4 steps while its 20s other render work stayed constant, video inference would be about 48s. This is **an unvalidated extrapolation**, before preprocessing/upscale, using different acceleration/runtime settings. It is not a quote or guarantee. Conversely, stock Wan's 160s leaves only 20s for everything else, too little margin for a reliable under 180s complete pipeline.

Prefer a **single H200 NVL 141GB trial** for a straightforward high-memory speed test, using the appropriate attention backend; a Japan offer was available in this snapshot. Use the **96GB PRO** as the lower-cost capacity/quality comparison. Choose the PRO for production if it meets the same latency/quality acceptance. A 5090 quantization experiment follows the large-memory baseline so memory-saving changes have an observable quality reference. B200 is a faster-capacity benchmark option, with higher exposure and region restrictions for H3. None has been benchmarked on this new graph yet.

For a production claim, test a held-out set of simple movement, face turns, occlusion and changing light at normal speed. Record identity, placement/scale, motion timing, lighting, background preservation and rejection counts. Confirm the complete warmed path's median and 95th-percentile times. A fast attractive thumbnail is insufficient. No automatic paid rerenders on quality warnings. If the four-step result fails quality, switch recipes/models and accept the measured latency; do not disguise that tradeoff by exporting more pixels.

## Current costs per five-second attempt

Live read-only Vast snapshot: 26 October IST, approximately 20:55 UTC 25 October; one GPU, 256GB disk, at least 96GB host RAM, at least 1Gbps reported download, CUDA13/direct SSH. Rows below are verified hosts with reported reliability at least 98%. Availability changes; these are not reservations. Running 256GB disk is included; transfers, retained idle disk, taxes, setup, idle GPU and retries are excluded from the warm columns. [Saved quote evidence](../validation/replacement-cost-market-20261026.json), [Vast pricing model](https://vast.ai/pricing).

| GPU/location | Quoted compute + running disk/hour | If total warm job is 120s | If total warm job is 180s |
| --- | ---: | ---: | ---: |
| RTX 5090 / US | $0.7615 | $0.0254 | $0.0381 |
| PRO6000 Blackwell 96GB / South Korea | $1.4999 | $0.0500 | $0.0750 |
| PRO6000 Blackwell 96GB / Japan | $2.0474 | $0.0682 | $0.1024 |
| H200 NVL 141GB / Japan | $4.2044 | $0.1401 | $0.2102 |
| B200 / US | $7.5667 | $0.2522 | $0.3783 |

These are **cost calculations at assumed runtimes**, not predictions that each GPU finishes in 120/180s. Full BF16 Viggle does not fit the 5090. South Korea/US rows are usable price comparisons for Apache Wan, not H3 deployment clearance. One hour of current Japan PRO warm idle still costs about $2.05 even with no submissions.

At the B200 quote, the publisher's 160s Wan video stage alone would cost approximately **$0.336**, before its missing stages. Our last 41-minute A100 render was approximately $0.249. Thus a faster expensive GPU need not save money: the B200 would need to finish the complete attempt in roughly 119s to beat that historical render-only cost. On Japan PRO, the same break-even is about 438s. Compare accepted quality and total cost, not just speed.

### Cold sessions, downloads and retained storage

For an **example 80GB model download**, ingress is approximately $0.417 on Japan PRO, $0.104 on Japan H200, and $0.195 on the US B200. The cheapest verified 5090's high ingress tariff makes that download **$3.125**; its low hourly rate is misleading for repeated fresh sessions. These are quote-derived fees, not assumed free bandwidth. Image-editor/upscaler files add to the 80GB example; it is not the complete multi-engine bundle.

If a cold session takes **10 billed setup minutes plus a 3-minute render**, with that 80GB download, the illustrative totals are approximately **$0.86 Japan PRO, $1.02 Japan H200, $1.83 US B200**, before additional files/fees. Actual setup time is unmeasured for these rentals. An 80GB download alone has a theoretical lower bound of 10m40s at 1Gbps before installation; a new rental cannot honestly promise a sub-three-minute first result at that rate.

Retaining the quoted 256GB disk for 30 days is approximately **$34.13 Japan PRO** or **$51.20 Japan H200**. At one accepted clip/day, storage alone allocates **$1.14 or $1.71 per clip**, before rendering. Stopping compute does not eliminate that retention cost. Keeping the GPU warm 24 hours is much more expensive. Prefer batched sessions with explicitly installed models and, if supported by the chosen provider/location, economical reusable storage. This preserves the user's blank-engine startup and explicit-download controls.

For 20 accepted clips in one session, 10 setup minutes and 80GB ingress amortize to about $0.038/clip on Japan PRO or $0.040/clip on Japan H200. Add the render time, actual idle gaps and any retained disk. Failed or rejected outputs also count. General formula:

`cost per accepted clip = (all billed session time × hourly rate + transfer + separately retained storage + other fees) / accepted clips`

Runpod offers a useful alternative when repeated transfer costs dominate: published Pod prices are $2.49/hr PRO96, $5.29 H200, $7.99 B200 before storage; its docs state no ingress/egress fees. 256GB network storage is $17.92/month, subject to GPU/location compatibility. These are public advertised rates, not equivalent available rental quotes or a measured speed advantage. [Published GPU rates](https://www.runpod.io/pricing), [billing/storage](https://docs.runpod.io/pods/pricing).

### Hosted Higgsfield as a comparison

The official direct API lists **Genjutsu 720p at $0.681 per rounded source second**, or **$3.405 for 5s before customer discounts**. Kling3 Standard Motion Control lists $0.126/s, with an advertised 50%-off rate of $0.063/s: **$0.63 list/$0.315 advertised for 5s**, but its task differs from localized Object Swap. Kling4 Video Edit 720p with 5s input + 5s output is **$0.94 at the published rate** before applicable discounts. These are API tariffs, not subscription-credit conversions or guaranteed completion times. [Genjutsu tariff](https://open.higgsfield.ai/models/higgsfield/genjutsu/object-swap/v1.0/playground), [Kling motion tariff](https://open.higgsfield.ai/models/kling-video/v3/motion-control/std/playground), [Kling edit tariff](https://open.higgsfield.ai/models/kling-video/v4.0/video-edit/playground).

Genjutsu Light's public 720p rate is $0.10 per billable second, with wording that adds output duration and input reference-video durations. Its source-video versus reference-video billing treatment needs a preflight quote; do not promise that five output seconds costs exactly $0.50 or $1 without resolving that detail. [Actual Light pricing text](https://open.higgsfield.ai/models/higgsfield/genjutsu-light/object-swap/v1.0/playground).

The next implementation milestone is one instrumented, source-preserving 480p-class replacement graph, with cached conditioning and model-specific acceleration. The next paid validation should establish its actual end-to-end warmed latency and cost before adding more engines or claiming the three-minute goal is achieved.
