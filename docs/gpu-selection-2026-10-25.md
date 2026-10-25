# GPU selection for SCAIL-2

Research snapshot: 25 October 2026, approximately 23:17 IST. Prices and eligibility are recorded in [the sanitized market snapshot](../validation/gpu-selection-market-20261025.json). No new rental or paid render was submitted for this research.

## Recommendation

Keep the RTX 5090 as the budget choice for the existing SCAIL-2 INT8 workflow. The next upgrade worth a matched benchmark is the **RTX PRO 6000 Blackwell Workstation Edition, 96 GB** (Vast name `RTX PRO 6000 WS`). Its principal advantage is room for the denoiser, activations and adapters without repeated CPU offloading. The size of that benefit on our graph is unmeasured. When the graph fits comfortably on a 5090, the PRO can deliver a much smaller improvement than its hourly premium requires.

B200/B300 are the leading candidates when turnaround takes priority over rental cost. GB10 is a poor choice for our current high-quality configuration: our cancelled sample spent approximately 227.5 seconds per steady sampler step and never completed a video segment. That sample changed resolution and step count from the preceding run, so it does not establish a matched GPU speed ratio.

Do not substitute the older RTX A6000 or RTX 6000 Ada for the 96 GB Blackwell card. The Max-Q and Server Blackwell variants also have different power/performance characteristics; do not assume identical latency from their shared name.

## Market observations

These are single-GPU, on-demand offers with 64 GB allocated disk, at least 48 GB system RAM, advertised download at least 1,000 Mbps, reliability at least 98%, CUDA 13 and driver 580.65.06 or newer, and a direct SSH port. The search allowed verified and unverified hosts, then recorded each separately. Running disk is included; transfer fees, setup/idle time and taxes are excluded.

| GPU | Cheapest qualifying running quote | Cheapest verified quote |
| --- | ---: | ---: |
| RTX 5090, 32 GB | $0.533/hr | $0.836/hr |
| RTX PRO 6000 WS, 96 GB | $1.151/hr | $1.151/hr |
| RTX PRO 6000 Server, 96 GB | $1.502/hr | $1.502/hr |
| RTX PRO 6000 Max-Q, 96 GB | $1.256/hr | $1.624/hr |
| H200 NVL, 141 GB | $4.041/hr | $4.041/hr |
| H200, 141 GB | $4.463/hr | $4.463/hr |
| B200, approximately 180 GB exposed | $7.517/hr | $7.517/hr |
| H100 SXM, 80 GB | $8.791/hr | $8.791/hr |

No B300, B300 PC, GB200, GB300 or H100 PCIe matched these criteria in the final per-model query. Some had offers in an earlier snapshot. This is an availability/filter result, not a compatibility finding. Earlier B200 quotes were as low as $6.267/hr; do not treat a transient minimum as a guaranteed rate. The unusually expensive H100 SXM listing is not a sensible purchase at this snapshot price.

The user's already accepted 5090 quote is $0.41778/hr, below newly available qualifying offers. A $1.15111/hr PRO must finish a job **2.755 times faster** to lower render-only cost against that contract. Against the newly observed verified 5090 minimum, the break-even ratio is **1.378**. Faster turnaround may still justify a higher cost per clip.

`render cost = running hourly rate × render seconds / 3600`

## Evidence and limits

[Runpod's own October 2026 measurements](https://www.runpod.io/articles/guides/best-gpu-for-ai-video) used Wan 2.2 fp16, 1280×704, 81 frames at 16 fps, and 20 steps in ComfyUI:

| GPU | Published seconds per clip |
| --- | ---: |
| B300 | 509 |
| B200 | 538 |
| H100 SXM | 652 |
| RTX PRO 6000, 96 GB | 734 |
| RTX 5090 | 1,297 |

Their 5090 offloaded weights. This heavier two-expert fp16 graph is not our SCAIL INT8 graph; its times and memory thresholds cannot be copied into our runtime estimates. It supports screening larger cards when offloading dominates, not a promised SCAIL speed multiplier.

[VALDI's own Wan 2.1 I2V tests](https://valdi.ai/blog/rtx-5090-vs-4090-in-the-real-world-of-image-to-video-inference/) averaged 419 seconds on 5090 versus 763 on 4090 over 100+ runs per GPU: approximately 1.82× throughput. The page omits sufficient clip/precision/step detail to forecast our clip duration.

[InstaSD's own Wan 2.1 14B test](https://www.instasd.com/post/wan2-1-performance-testing-across-gpus) used 33 frames, 16 fps and 30 steps. H100 took 284 seconds at 720p versus A100 523 and A40 1,083. It lacks a matched 5090 result and does not use SCAIL INT8.

Our [matched SCAIL comparison](../validation/a40-vs-3090-matched.json) measured 34.37 minutes on RTX 3090 and 17.23 on A40 for the same five-second Character swap, 704×1248, 24 fps, Natural 8 steps, CFG 1. At the historical quotes those runs cost approximately $0.112 and $0.120 respectively. Those settings differ from the cancelled Motion/16-step/CFG 5 run. There is no matched completed SCAIL benchmark yet for 5090 versus PRO 6000, H100, H200, B200 or B300.

The bandwidth figures are not render speed: [NVIDIA specifies 1,792 GB/s for RTX 5090](https://www.nvidia.com/en-us/geforce/graphics-cards/50-series/rtx-5090/) and [273 GB/s shared memory bandwidth for DGX Spark](https://docs.nvidia.com/dgx/dgx-spark/hardware.html). The [96 GB PRO 6000 Workstation also has 1,792 GB/s](https://www.nvidia.com/en-gb/products/workstations/professional-desktop-gpus/rtx-pro-6000/). These specifications alone do not give a clip-time ratio. Marketing FP4/sparse TOPS are also not measurements of our INT8-checkpoint/PyTorch SDPA workload.

## How to make a useful next comparison

Use one matched short job on the already rented 5090, then the same job on a 96 GB PRO when a paid test is authorized. Keep mode, prepared source/reference hashes, prompt, seed, resolution, frames, sampler, steps, CFG, adapters, attention backend and cache state fixed. Separate cold model loading from warm generation. Record end-to-end time, segment and steady step times, peak VRAM, CPU offloading and billed rate. GPU changes primarily buy turnaround and memory headroom; realism still depends on the model and conditioning.

Rent one GPU: the current graph does not distribute a single render across multiple GPUs. Prefer an adequately powered card, sufficient host RAM, fast PCIe and SSD, plus good actual download performance. Network bandwidth affects setup rather than the compute cost of a fully loaded denoising step. A larger GPU cannot fix host/container provisioning delays.
