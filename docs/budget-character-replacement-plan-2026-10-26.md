# Budget-first character replacement plan

Updated 26 October 2026 IST. This is the current execution plan and supersedes the high-memory/multi-engine implementation order and 256GB default in the earlier [research plan](production-character-replacement-plan-2026-10-26.md) and [latency audit](latency-cost-and-higgsfield-audit-2026-10-26.md). Those documents remain research evidence. This revision changes documentation and planning only; it does not rent a GPU, download weights, change generation settings, impose an automatic timeout or delete an existing disk.

## The revised decision

Use **one inexpensive GPU and one new video engine**. Start with Wan2.2-Animate replacement, quantized where its tested implementation requires it, and model-specific acceleration. Use existing SCAIL outputs as the comparison instead of paying to regenerate the baseline. Do not treat the current SCAIL output quality as acceptable merely because it is already installed.

- First rental candidate: **RTX PRO 5000 48GB**, approximately **$0.70/hour including 80GB disk** in the current qualifying snapshot. Its extra memory is a useful capacity candidate, not a measured speed advantage.
- Before requesting a new rental, compare the retained A100's actual resume quote and saved model inventory. Reuse it only if the selected minimal graph fits its memory/disk and avoids a worthwhile download/setup cost. Choose one route for the pilot; do not run the A100 and a newly rented GPU together. Do not resume it merely to inspect inventory that is available locally.
- Rental search ceiling: propose **$0.80/hour total**, not GPU-only price, with low transfer fees. If no suitable offer exists, wait or review the quote; do not escalate automatically to a 96GB PRO, H200 or B200.
- **80GB disk**, one precision/checkpoint, essential preprocessing/encoders and only the required compatible adapters. Confirm the exact selected manifest, free space and temporary-download behavior offline first. Target at most 40GB new weight transfers and at least 15GB working headroom after installation; these are planning limits, not measured Wan requirements. If the actual bundle does not fit, rework it before rental rather than silently increasing disk or spending an hour downloading a whole repository.
- Minimum 48GB usable host RAM, with a 64GB-class host preferred; quoted memory must be checked rather than rejecting a nominal 64GB machine reporting 63.9GB. Keep CUDA/driver/directSSH checks and host quality filters. Use verified offers with reported reliability at least 98%, while recognizing neither value guarantees an uninterrupted host.
- Current 4090 offers around $0.47/hour are alternatives only if the quantized graph proves a lower cost per acceptable clip. Do not rent several GPU types for a speculative comparison. Keep 5090 as another re-quote option, not another immediate experiment.

The active scope excludes Viggle/H3, MoCha, additional image-editing engines, AI upscalers, generic influencer LoRAs and paid hosted inference. They remain possible later additions only when a measured failure justifies their expense. Extra adapters stay optional; nothing currently installed is removed by this plan.

## What we build offline first

1. A separate Wan-Animate replacement graph/adapter for the existing Studio, leaving existing jobs and SCAIL available. One source video, one clean character reference, source-relative conditioning and a clear preview of the source masks/background preparation.
2. Pin exact files and compatible runtime revisions. Reuse encoders/VAEs only when formats and hashes actually match. Download neither both precision variants nor unused task branches. The existing explicit-download and delete controls remain.
3. Implement cached source preparation, per-stage timing and real progress. Prepare media, inspect framing/cuts and build the graph on this Mac before rental. No local Mac video-diffusion benchmark is assumed.
4. Start with one continuous shot at 480p-class dimensions and 24fps. Preserve aspect with padding. Generic style LoRAs stay empty; only exact-model relighting/acceleration is considered.
5. Compare the documented quantized standard replacement configuration with its compatible four-step acceleration experiment on a short shot. LightX2V publishes separate 20-step 4090 FP8/SageAttention2 and four-step non-offloaded replacement configurations. Combining low-memory execution with acceleration is an A/B to validate, not a proven fast consumer recipe. Do not require 16/20 steps by default merely because a dropdown calls them Quality. [4090 configuration](https://github.com/ModelTC/LightX2V/blob/main/configs/wan22/wan_animate_replace_4090.json), [four-step configuration](https://github.com/ModelTC/LightX2V/blob/main/configs/wan22/wan_animate_replace_lora.json).

Initially use Wan's native character-reference replacement conditioning. A cropped/aligned reference is not an identity-edited source frame; do not pretend they are interchangeable. Add a separate keyframe image editor only if the first controlled test shows a concrete need. Ordinary local resizing is sufficient for preview/export experiments; it does not restore missing facial detail. AI upscaling waits until the base footage is worth finishing.

## First GPU validation: proposed $2 planning envelope

The user has requested a cheaper plan, not a new rental. **No paid run is authorized by this document.** This is a proposed envelope for a later specifically approved pilot, not a new implemented hard billing cap.

At no more than $0.80/hour including running disk:

| Item | Planning allowance |
| --- | ---: |
| Up to 90 minutes total billed session time, including setup, model loading, review/idle and generation | $1.20 |
| Model-transfer allowance, checked against exact selected bytes and host tariff before launch | $0.15 |
| Existing retained-disk billing during a 90-minute pilot, rounded allowance | $0.05 |
| Unused contingency | $0.60 |
| Proposed maximum pilot budget | **$2.00** |

Use that one session for at most **two short 2-second comparisons and one 5-second validation** if time and quality allow. A simple continuous source shot avoids the cut in the latest clip. Evaluate identity, source-relative placement/scale, lighting, occlusions and temporal stability against saved inputs. Stop expanding the experiment when a recipe fails quality; do not automatically rerender, download alternatives or upgrade hardware. Reserve enough money to finish the already queued job before starting it. Any additional pilot needs its own review.

This arithmetic envelope does not automatically stop a healthy setup or render. Existing no-elapsed-time-stop behavior remains. Before a paid pilot starts, agree how its remaining budget will be monitored and what to do if setup or a job threatens that envelope; do not claim an unenforced dollar ceiling is guaranteed. Avoid starting work that cannot fit the planned reserve. Current automatic cleanup remains limited to the explicitly authorized failed empty-host case.

The first measurable target is **an acceptable 5-second base result at about $0.05–$0.20 of warm render cost**, subject to actual timing. Three-minute completion remains a stretch goal. We do not buy a much more expensive GPU just to hit it. A ten-minute good render costing 12¢ is more useful here than a fast expensive or unusable result. No tested improvement in identity or realism is claimed yet.

## Current cost examples

Fresh live read-only Vast quotes, 26 October IST: 80GB disk, 48GB minimum usable host RAM, at least 1Gbps reported download, CUDA13/direct SSH, verified and reported reliability ≥98%. Requote before rental. [Sanitized quote snapshot](../validation/budget-gpu-quotes-20261026.json).

The qualifying Japan PRO 5000 offer reports 47.8GiB GPU memory, 63.9GB host RAM and **$0.696296/hour including 80GB disk**. Ingress is $0.002604/GB. All values below are arithmetic scenarios, not measured new-model performance:

| Billed warm time to produce one 5-second output | Compute + running disk |
| --- | ---: |
| 3 minutes | $0.0348 |
| 5 minutes | $0.0580 |
| 10 minutes | $0.1160 |
| 15 minutes | $0.1741 |
| 20 minutes | $0.2321 |

For an **illustrative 40GB download**, ingress is $0.1042. If setup takes 10 billed minutes and one clip takes 10 minutes, the session costs approximately **$0.3363** before additional files, idle time, retries, taxes or retention. If 10 clips each take 10 minutes, the same 10-minute setup and 40GB ingress yield approximately **$1.3807 total / $0.1381 per output**. If only 8 of those 10 outputs are usable, cost is approximately $0.1726 per accepted output. Actual model bundle size and runtime remain unmeasured.

The proposed 90-minute new-rental pilot on that quote plus the illustrative 40GB ingress is approximately $1.1486; include approximately $0.0444 if the old A100 disk is also retained for those 90 minutes. This leaves room within the proposed $2 envelope. This does not imply all three tests finish in that time. If any scenario requires more download bytes or longer billed time, recalculate before approval. Warm/cold examples above describe the selected new rental; continuing charges for unrelated retained resources must be included in the account total.

## Prevent ongoing storage and idle charges

- **Current bill to address:** the last account refresh at 2026-10-25T21:25:17Z reports instance 57709189, A100 PCIe, compute stopped, 64GB disk retained at approximately $0.02963/hour. That is approximately **$0.71/day / $21.33 per 30 days** even with no generation. This is separate from a future rental. It has not been deleted or resumed. Confirm useful outputs/logs are local, then have the user explicitly choose whether to retain or destroy it; do not silently keep accumulating that bill while presenting only future per-clip costs.
- **No always-on GPU.** Do implementation, reference selection and visual review offline when possible; queue prepared tests together. During a session, idle time is billed just like rendering.
- Prefer a short batch session. After downloading outputs and useful logs locally, decide whether to stop/retain or destroy the rental. **Destroy only through the user's explicit action/authorization**; the disk cannot be recovered afterwards. Never destroy an existing model disk merely to satisfy this planning target.
- The quoted 80GB disk costs approximately **$21.33/30 days** if retained continuously: about 71¢ per clip if only one clip is made daily. That retention would dominate a 12¢ render. Pause preserves that storage bill; short-session destruction eliminates subsequent instance storage billing after deletion is confirmed.
- Re-downloading 40GB at this host's tariff is approximately 10¢ plus billed download time. Compare actual retention against a later fresh-session download, instead of defaulting to a monthly disk. Nominal 1Gbps/advertised host speed is not a guaranteed Hugging Face transfer rate.
- Optional model caching on another provider/local disk comes later only when supported storage/location/transfer economics prove cheaper. Do not add another recurring subscription to solve a few cents of transfer.

General acceptance-cost formula:

`(all billed session time × quoted hourly rate + transfer + separately retained storage + other fees) / usable outputs`

The expensive 96GB/H200/B200 models and the under-three-minute research budget are deferred. The next implementation milestone is one minimal replacement engine, followed by a small explicitly approved pilot. If that does not deliver acceptable quality, report the failed result and measured cost before expanding the plan.
