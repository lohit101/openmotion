# GPU marketplace filters and recommendations

The marketplace searches compatible hardware across Vast instead of requiring a GPU model name. Its default filters are a 24 GB-class GPU, 48 GB system RAM, 250 Mbps downloads, verified hosts, 95% host reliability, at most $0.70/hour including the selected disk, and downloads no higher than $0.005/GB. The separate existing $0.70/hour GPU-compute ceiling remains enforced even if the user raises the total-price filter to accommodate storage.

Search requires one NVIDIA GPU, CUDA 13, driver 580.65.06 or newer, a direct SSH port and compute capability 8.0 or newer for the current BF16 runtime. NVIDIA documents native BF16 Tensor Core support on Ampere. [NVIDIA Ampere tuning guide](https://docs.nvidia.com/cuda/archive/12.9.1/ampere-tuning-guide/index.html).

The dedicated search has no `gpu_name` restriction. A supplemental GB10 query keeps shared-memory hosts discoverable when the provider omits dedicated VRAM. Old frozen model-specific rental filters remain supported. Remotion and Imagen permit amd64/ARM64; Clarity and the all-module profile currently require amd64. Unsupported devices, MIG slices, multiple GPUs, invalid resources, unavailable offers, cooldown hosts and offers outside the chosen budgets are excluded locally too.

Provider pages use ascending rental-ask IDs with a strictly advancing cursor, deduplicate overlaps, and continue when the response reaches its limit even if `truncated` is false. Failure to complete produces an error rather than recommendations based on a silent partial result. The UI initially displays 24 offers and lets the user reveal more; ranking uses the complete fetched pool. [Vast offer API](https://docs.vast.ai/api-reference/search/search-offers).

## Workflow requirements and costs

The workflow selector reads only the selected recipes' manifest files. All modules count shared weights once. The disk floor includes those bytes, a 20 GB engine allowance and the existing workflow working reserve, rounded upward to an eight-GB allocation; floors start at 64 GB, or 96 GB/64 GB system RAM for all modules. Recommendations allow another 16 GB beyond the minimum. These are admission allowances, not a promise that arbitrarily long exports or additional models will fit.

Transfer estimates cover the selected model files only. Container images, runtime packages, media, installation and model-host throttling are additional. Internet speed is interpreted as **Mbps**, matching the official CLI's `Mb/s` field definition; it is divided by eight for MB/s estimates. This deliberately follows the CLI rather than the inconsistent MB/s label in the REST field table. [Official Vast CLI](https://github.com/vast-ai/vast-cli/blob/master/vast.py).

The estimated model-transfer lower bound is `GB × 1000 / min(download_Mbps / 8, disk_MBps)`. An unreported disk speed leaves the estimate network limited. First-hour cost means one hour of quoted GPU plus disk and the selected model-transfer fee. Neither estimate includes generation latency. Searches and recommendations do not download, rent or resume anything.

## Value score

Each search gives eligible offers a 0–100 score relative to that search's best reported ratings:

| Component | Points | Calculation |
| --- | ---: | --- |
| Compute | 35 | 65% DLPerf, 25% GPU memory bandwidth, 10% theoretical TFLOPS; each normalized linearly |
| Hourly price | 25 | Square root of cheapest total hourly rate divided by this rate |
| Setup throughput | 20 | Square root of effective network/disk throughput relative to the best offer |
| VRAM headroom | 10 | Saturates at twice the selected memory minimum |
| Download price | 5 | Lower ingress prices score higher against the existing $0.005/GB ceiling |
| Reliability | 5 | Provider reliability from 90% through 100% |

Components are bounded and rounded to tenths. Missing compute ratings contribute zero. Top picks require positive DLPerf and memory-bandwidth readings and select up to three different physical machines. Offers with incomplete ratings remain available to inspect without inventing their performance. This is an explicit heuristic, **not a workflow benchmark or a guarantee of fastest inference**. It does not predict container-cache availability or output quality.

## Cards and power state

Offer cards show price, transfer charges, VRAM, download speed, DLPerf and memory bandwidth. The selected card exposes the score breakdown and complete hardware/cost details. Rented-instance cards retain the same information, preferring new provider readings and labeling saved-offer fallbacks. Current running/storage rates and accepted quotes stay distinct; no historical quote or generation recipe is rewritten.

Filters persist in `recast-gpu-search-v2`. Changing filters clears the selected quote. Favourite offers are checked against current limits before review/rent, and the submitted approval cannot exceed the chosen hourly cap. Expired quotes request refreshed availability rather than creating a rental.

Header state refresh now works in every workspace, after focus/wake/network return, and faster during instance transitions. Persistent explicit rental selection survives pause with other retained disks. Snapshot revisions reject older HTTP state, while provider-status epochs prevent reads started before a stop from overwriting its exact confirmation. Conflicting list responses are resolved with an exact instance read. Polling never resumes compute; existing active-work confirmation, notifications and five-minute idle behavior remain intact.

Validation, live search checks and the guarded deployment are recorded in [the validation report](validation/gpu-marketplace-20261101.json). No paid GPU tests, rentals, resumes, installs or model downloads were used for this task.
