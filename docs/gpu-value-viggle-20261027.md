# GPU value for the current Viggle workflow

Checked 27 October 2026. This compares the installed **Viggle pruned INT8 + full-rank DMD adapter + INT8 H3 VAE** workflow, not the older SCAIL/Wan graph. It is a read-only specification and marketplace comparison. No new rental, model transfer or benchmark was requested.

## RTX PRO 4000: compatible, but a risky speed tradeoff

The regular [RTX PRO 4000 Blackwell](https://www.nvidia.com/en-us/products/workstations/professional-desktop-gpus/rtx-pro-4000/) has **24 GB VRAM and 672 GB/s memory bandwidth**. [PRO 5000 Blackwell](https://www.nvidia.com/en-us/products/workstations/professional-desktop-gpus/rtx-pro-5000/) has **48 or 72 GB and 1,344 GB/s**. The 4000 has less compute and half the memory bandwidth; that does not translate directly into an exact runtime ratio.

Our pinned video checkpoint is **21,033,720,080 bytes on disk**, before the working tensors, attention buffers, adapter handling and decode stages. File size is not a measured peak VRAM requirement, and all models need not reside together. Nevertheless, 24 GB leaves much less room than the user's working 40/48 GB cards. ComfyUI may offload weights to system RAM, or the selected resolution/frame count may exhaust memory. Software compatibility does not establish fit or acceptable speed at the same settings.

Treat PRO 4000 as a lower-resolution/shorter-clip budget candidate until tested. Do not replace a working A100/PRO 5000 rental on the promise of equal speed. An identical precision and sampling configuration should not intrinsically become less realistic on a different supported GPU; quality compromises arise if resolution, frames or precision must change to fit.

The **PRO 4000 SFF** is a separate, lower-power variant: its [NVIDIA datasheet](https://www.nvidia.com/content/dam/en-zz/Solutions/data-center/rtx-pro-4000-blackwell/workstation-datasheet-blackwell-rtx-pro-4000-gtc25s-nvidia-3662515-r6.pdf) lists 24 GB but only **432 GB/s**. Do not equate it with the regular 672 GB/s card. Older RTX 4000 Ada and RTX A4000 are also different products. Inspect the actual model and memory allocation before renting.

## Current qualifying Vast quotes

These were returned by the app's authenticated read-only Vast offer searches around **07:44 UTC / 13:14 IST**. Each selected offer is single-GPU, verified, reports at least 98% reliability, has at least 64 GB allocated host RAM, at least 500 Mbps advertised download and known ingress of at most **$0.005/GB**. Compute remains at or below **$0.70/hr**. Every row includes the same **80 GB disk allocation**; transfer fees and setup time are additional. Reliability is provider-reported, not our uptime measurement. Offers can disappear or change before rental.

| GPU | Nominal memory | Compute/hr | Disk/hr | Running total/hr | Judgment for this graph |
|---|---:|---:|---:|---:|---|
| RTX PRO 4000 Blackwell | 24 GB | $0.320 | $0.037 | **$0.357** | Much cheaper hourly, but capacity/offload risk. Not benchmarked. |
| L40S | 48 GB | $0.533 | $0.022 | **$0.556** | Best current cheaper candidate to benchmark without dropping to 24 GB. |
| RTX 5090 | 32 GB | $0.604 | $0.015 | **$0.619** | Strong throughput candidate; less memory margin than 40/48 GB. This cheapest reliable quote also has weak reported disk throughput. |
| A100 PCIe | 40 GB | $0.600 | $0.037 | **$0.637** | Already works for the user; a retained cheaper rental can beat today's new offers. |
| RTX PRO 5000 Blackwell | 48 GB | $0.667 | $0.022 | **$0.689** | Known working route for the user, with comfortable memory capacity. |
| RTX 4090 | 24 GB | $0.387 | $0.074 | **$0.461** | More throughput than many budget cards, but the same 24 GB capacity concern. |
| RTX 3090 | 24 GB | $0.267 | $0.022 | **$0.289** | Cheap previews; not the first choice for fastest high-resolution Viggle output. |
| A40 | 48 GB | $0.533 | $0.022 | **$0.556** | No hourly saving over the current L40S quote; not attractive for a speed-focused switch. |

The L40S offer reports roughly 45 GiB usable memory, which differs from its nominal 48 GB specification. Use the actual allocation during preflight. [NVIDIA's L40S specifications](https://www.nvidia.com/en-us/data-center/l40s/) list 48 GB and 864 GB/s; lower bandwidth than PRO 5000 does not alone determine inference time. [NVIDIA's 5090](https://www.nvidia.com/en-us/geforce/graphics-cards/50-series/rtx-5090/) has 32 GB. These are compatibility/value candidates, not matched-workflow speed results.

The [PRO 4500 Blackwell](https://www.nvidia.com/en-us/products/workstations/professional-desktop-gpus/rtx-pro-4500/) is another sensible middle option with **32 GB and 896 GB/s**, but this search returned no qualifying offers. L40, RTX A6000 and RTX 6000 Ada also returned no qualifying offers under these exact filters. That does not mean they are unavailable across the whole marketplace or incompatible.

## Compare cost per completed clip

For a warm attempt, compute plus active storage cost is `running_hourly × elapsed_seconds / 3600`. Cold start, downloads, idle time, retained disks and failed attempts add to the real session bill. Do not move a cached model stack for a small hourly saving without accounting for that transfer/setup cost.

Using the selected PRO 5000 quote as a baseline:

- PRO 4000 saves money only if it takes **less than 1.93×** the PRO 5000's time.
- L40S saves money if it takes **less than 1.24×** the PRO 5000's time.
- The selected 5090 saves money if it takes **less than 1.11×** the PRO 5000's time.

These are price break-even ratios, **not predicted speed ratios**. For illustration only, a four-minute attempt at $0.689/hr costs about **4.59 cents**. At $0.556/hr, the same four minutes costs **3.70 cents**, but five minutes costs **4.63 cents**. Actual time must be measured with identical prepared frame, source, resolution, frame count, passes, model precision and warm/cold conditions.

My next paid comparison would be **L40S versus the user's working PRO 5000**, followed by 5090 if the graph fits well. Retain a good A100 deal already containing the models if its measured cost per clip is lower. PRO 4000 belongs behind those for this user's priority of fast completion. FP4 marketing TOPS and Vast DLPerf are not seconds-per-clip benchmarks for our INT8 implementation.

See the [sanitized quote snapshot](../validation/gpu-value-quotes-20261027.json). No quoted offer was rented or reserved.
