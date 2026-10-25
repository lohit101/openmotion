# Alternative GPU providers for the SCAIL workflow

Checked 26 October 2026 IST. These are advertised prices or dated public snapshots, not account-specific guaranteed available quotes. Compare one GPU, at least 48 GB system RAM, 64–80 GB storage, a CUDA 13-compatible driver, and SSH/custom-runtime access. Taxes, payment/marketplace fees and storage can change the total. No provider accounts or rentals were created for this research.

The recent [Vast snapshot](../validation/gpu-selection-market-20261025.json) found a 5090 at $0.533/hr unverified or $0.836/hr verified, and RTX PRO 6000 Blackwell WS at $1.151/hr verified, including 64 GB running disk. A previous accepted 5090 contract was $0.418/hr. These unusually cheap consumer-card quotes are difficult to beat with a fully specified alternative.

| Provider | Relevant published rates, USD/hour | How to interpret them |
| --- | --- | --- |
| [Clore live marketplace](https://clore.ai/marketplace) | Eligible single-GPU listings observed: 3090 $0.146, 4090 $0.375, 5090 $0.458 hourly equivalent before fees. | Live API snapshot with at least 48 GB RAM, 64 GB reported disk, CUDA 13 and reported reliability ≥0.98. Lowest 3090/5090 offers require CLORE; network/driver quality still needs verification. [Captured offers](../validation/clore-market-20261026.json). |
| [TensorDock deployment page](https://console.tensordock.com/deploy) | Current public starting prices: 3090 $0.23, 4090 $0.50, 5090 $0.60, RTX A6000 $0.47. | These listings have only 4 GB RAM, 2 vCPUs and 20 GB disk. Reprice the required RAM/disk before comparing with Vast. Their older GPU-only tariff page is dated 2024 and should not be treated as a current full-system quote. |
| [Runpod pricing](https://www.runpod.io/pricing) | Public pricing table: A40 $0.59, RTX A6000 $0.59, 4090 $0.89, 5090 $1.19, RTX PRO 6000 96 GB $2.49. | Cloud tier and host affect the rate. The listed 5090 has 35 GB system RAM and 4090 41 GB, below our current 48 GB minimum; choose a sufficiently provisioned host. Older product pages show lower, conflicting rates, so use the live deployment quote. |
| [Hyperstack](https://www.hyperstack.cloud/gpu-pricing) | On-demand RTX A6000 $0.50, RTX PRO 6000 Server $1.85, H100 SXM $3.20, H200 $3.99, B200 $6.00. | Worth comparing for datacenter cards. The A6000 is close to the Vast quote; the PRO costs more than the observed Vast WS offer. Server and Workstation PRO variants need separate performance measurements. |
| [Verda, formerly DataCrunch](https://verda.com/rtx-pro-6000) | RTX PRO 6000 Server: $1.89 on-demand, $0.945 spot. | Spot can be cheaper than the observed Vast PRO offer but can interrupt an unfinished segment. Use on-demand for predictable long renders. The low starting-price headline is the spot rate. |
| [Spheron](https://www.spheron.network/pricing/) | 4090 $0.48, marked last known October 25; 5090 $0.84, last known September 17; PRO 6000 $2.35 on-demand or $1.11 spot. | An aggregator of providers. Check current capacity, included system RAM and storage; a listed model or last-known price does not establish availability. |

## What this means for our workflow

Clore has the strongest observed consumer-card price alternative: the $0.458/hr-equivalent 5090 is about 14% below the recent $0.533 Vast quote before fees, but about 10% above the earlier $0.418 contract. Its low-end 4090 is about 18% below the $0.458 Vast 4090 snapshot, and its 3090 about 29% below the $0.204 Vast quote. These are not equal-network or equal-service guarantees, and crypto/marketplace fees can reduce savings. TensorDock needs a full RAM/storage quote. Datacenter-card providers can beat an unusually expensive Vast listing.

Provider choice does not determine SCAIL quality. On equivalent hardware and settings, compare actual warm render time, CPU offloading, PCIe/memory performance, and failed-run rate. There are no matched SCAIL runs across these providers yet. A provider's uptime or instant-start marketing claim is not proof of faster startup for our runtime.

For illustration only, a render using 20 minutes of GPU time costs about $0.139 at $0.418/hr, $0.200 at $0.60/hr, or $0.397 at $1.19/hr, before extras. These are cost examples, not predictions that our selected clip finishes in 20 minutes.

## Storage and continuity

[Runpod](https://www.runpod.io/pricing) publishes container storage at $0.10/GB/month and standard network storage below 1 TB at $0.07/GB/month: 64 GB is $6.40 or $4.48/month respectively. Idle local volume storage is $0.20/GB/month. Network-volume availability and GPU location must match before relying on it to retain downloaded models across rentals.

[Hyperstack](https://www.hyperstack.cloud/gpu-pricing) publishes SSV storage at $0.000096774/GB/hour, approximately $4.52/month for 64 GB at 730 hours. Snapshot storage is separate. TensorDock prices resources separately. For the other providers, obtain a full disk/transfer quote rather than assuming storage is included in a per-GPU headline.

The model files and ComfyUI graph can be reused on a compatible NVIDIA Linux machine. Recast's automated search, rental, lifecycle and favourites implementation currently targets Vast. Another provider needs its own adapter, or a deliberately configured manual ComfyUI connection; its instance IDs must never be sent to Vast's lifecycle API.

Recommendation: Clore is the leading price candidate to benchmark against a previously successful saved Vast host. TensorDock needs a fully specified quote; Hyperstack and Verda are alternatives for datacenter hardware. Prefer on-demand over spot for long, expensive in-flight segments.

The live Clore API quotes daily rates; [its API documentation](https://docs.clore.ai/for-hosts/api#id-4-marketplace) establishes that unit. Public Clore GPU landing pages describe an older September 21 sample and should not replace these current listings. For example, 5090 server #106550 advertised approximately $11/day, 64 GB RAM, 32 GB VRAM and CUDA 13.2; 4090 server #115224 advertised approximately $9/day with 64 GB RAM. These are candidates for testing, not deployed or endorsed hosts.
