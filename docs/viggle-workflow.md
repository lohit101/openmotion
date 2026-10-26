# Source-aligned Viggle replacement

This is a new experimental engine, separate from the existing SCAIL workflow. Offline schema, graph and application checks pass. No live speed or visual-quality result is claimed until the GPU validation report exists.

## Use in Recast

1. Connect a managed GPU. Start with an RTX PRO 5000 Blackwell **48 GB**, at least 64 GB-class host RAM and **96 GB disk** for this stack alone. Inspect the compute price separately from disk and transfer fees.
2. In Motion control, select **Viggle Animate**. Choose a continuous, single-person shot, **480p, 24 fps, 5 seconds or less**. Upload the source video and a clear character photo showing the desired face, hair and outfit.
3. Leave **Reference preparation → Match character to source frame** enabled. Click the explicit download button beside Files for these settings. The seven pinned files total **40,428,343,196 bytes**. Changing options and Generate never download weights.
4. Generate. The first stage edits a source frame with FLUX.2 Klein 4B. The second stage uses that edited frame and the source video in Viggle. The progress counters report actual image and video sampling separately.
5. Open Render details to inspect the conditioning frame and export the actual API graph. Compare scale, head size, screen position, lighting and identity with the source. A better frame is necessary before temporal propagation can preserve those attributes.

If you already edited a frame from the exact source shot, upload it as the reference and choose **Use an already edited source frame**. This skips Klein and requires four files totalling **27,976,525,336 bytes**. A standalone character photo is not an already edited source frame.

The current Studio integration intentionally handles one shot of up to **124 frames** at native 24 fps, rather than applying SCAIL's unrelated 81-frame continuation scheme. Existing SCAIL jobs, modes, adapters and longer clips keep their original behavior. Multi-shot editing needs a fresh aligned frame per shot; it is not solved by raising the duration field.

## Exact recipe

- Video: community pruned INT8 ConvRot Viggle transformer; matching **full-rank Viggle DMD** adapter at strength 1; fixed conditioning; H3 INT8 video VAE.
- Fast video: Euler + BasicGuider (CFG 1); video/audio shift 3; ManualSigmas **1, 0.8571428571428571, 0.6, 0**. These four boundaries produce **three model passes**. No second sigma shift or interpolation through `log(0)`.
- Balanced: six explicit sigma boundaries, five passes; experimental, not a guaranteed quality increase.
- Preparation: FLUX.2 Klein 4B FP8, Qwen3 4B encoder, matching Flux2 VAE, four Euler steps, CFG 1, source frame first and character photo second.
- Output: exact source-frame count, 24 fps, original source audio, H.264 CRF 16; 720p export uses the existing aligned render/downsample path. No interpolation is presented as native model detail.
- SCAIL DPO, relighting and generic Wan acceleration/style LoRAs are **not compatible** with Viggle. They are excluded from this graph and download plan.

All revisions, file sizes and SHA256 values are pinned in [viggle-models.lock.json](../config/viggle-models.lock.json) and [repaint-models.lock.json](../config/repaint-models.lock.json). Boot installs the small pinned Viggle node pack without extra pip dependencies or weights. Existing cached installations detect missing nodes and perform the required upgrade.

## Direct ComfyUI

After the normal pinned setup, import either JSON from [workflows/experimental](../workflows/experimental). The matching API graphs live in its `api` directory. Configure the same canvas dimensions in Prepare Source and Viggle Conditioning. The source helper fits without cropping, pads to H3's **17k+5** grid and retains the true count for export.

Regenerate both editable workflows with:

```sh
cd studio
npx tsx scripts/export-viggle.ts
cd ..
python3 scripts/build_viggle_workflows.py
```

The supplemental schema snapshot is extracted from pinned source. It is not a substitute for live `/object_info` validation; Studio performs that check before submitting a paid prompt.

## Evidence and limits

[Viggle's research](https://viggle.ai/research/viggle-animate-character-replacement-from-a-repainted-frame) reports 124 frames at 480×832 in 26 seconds on B200, **after** a repainted frame is available. Its released model uses three forward passes. The consumer INT8 graph here, its image editor and our complete application have not demonstrated that time. The separately described optimized 5090 implementation is not released.

The [community node pack](https://github.com/Saganaki22/ComfyUI-Viggle-Animate-H3/tree/6ae081af5b3175f99ef7cddebd5dfaf93390ab70) supports the exact sigma schedule but its converted/pruned weights are experimental. Quantization, pruning and the reference edit can change fidelity. Check mouths, fingers, occlusions, exposure changes and fine texture. Publisher demos are useful qualitative evidence, not an independent score for our inputs.

Viggle/H3 weights use the MiniMax H3 Community License; this evaluation follows your private-testing instruction. A future hosted product needs a separate rights review. Klein 4B and its selected repackaged image components are distributed under Apache 2.0. No paid image/video API, hosted moderation service or additional content filter was added.
