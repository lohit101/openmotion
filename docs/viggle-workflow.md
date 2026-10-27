# Source-aligned Viggle replacement

This is a new experimental engine, separate from the existing SCAIL workflow. Offline schema, graph and application checks pass. The real pinned ComfyUI classes also accept all four exported prompts in CPU-only validation, and the source-padding/anchor helpers execute on real CPU tensors. No live speed or visual-quality result is claimed until the GPU validation report exists.

## Use in Recast

1. Connect a managed GPU. Start with an RTX PRO 5000 Blackwell **48 GB**, at least 64 GB-class host RAM and **96 GB disk** for this stack alone. Inspect the compute price separately from disk and transfer fees.
2. In Motion control, select **Viggle Animate**. Start with a continuous, single-person shot, **480p, 24 fps**. New uploads initially select five seconds; the trimmer now supports up to **30 seconds** using automatic continuation. See the [segmentation guide](viggle-segmentation.md). Upload the source video and a prepared character frame, or explicitly select installed automatic preparation.
3. For the current Qwen photo route, upload the edited source frame and choose **Use an already edited source frame**. This requires the four Viggle files only. If using installed Klein instead, explicitly select automatic frame preparation; that seven-file combination totals **40,428,343,196 bytes**. Changing options and Generate never download weights.
4. Generate. Viggle uses the edited frame and source footage, with automatic continuation for longer selections. If automatic Klein preparation was selected, its image edit runs once before the first video window. Progress reports actual image/video counters and saved segments.
5. Open Render details to inspect the conditioning frame and export the actual API graph. Compare scale, head size, screen position, lighting and identity with the source. A better frame is necessary before temporal propagation can preserve those attributes.

If you already edited a frame from the exact source shot, upload it as the reference and choose **Use an already edited source frame**. This skips Klein and requires four files totalling **27,976,525,336 bytes**. A standalone character photo is not an already edited source frame.

New Studio runs above **124 frames** use versioned Viggle five-frame continuation for up to **720 frames / 30 seconds**. Short shots and historical jobs retain their original path; SCAIL's unrelated continuation is unchanged. Multi-shot editing still needs a fresh aligned frame per shot. The standalone editable graphs below remain single-window examples; Recast coordinates longer runs, local segment backups and final assembly.

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

The [community node pack](https://github.com/Saganaki22/ComfyUI-Viggle-Animate-H3/tree/6ae081af5b3175f99ef7cddebd5dfaf93390ab70) supports the exact sigma schedule but its converted/pruned weights are experimental. Quantization, pruning and the reference edit can change fidelity. Check mouths, fingers, occlusions, exposure changes and fine texture. The publisher has since added an audio-pinned speech recipe, but that conditioning is not implemented by this community Comfy graph. Source-audio passthrough alone does not provide lip-sync; start with movement-focused shots. Publisher demos are useful qualitative evidence, not an independent score for our inputs.

Viggle/H3 weights use the MiniMax H3 Community License; this evaluation follows your private-testing instruction. A future hosted product needs a separate rights review. Klein 4B and its selected repackaged image components are distributed under Apache 2.0. No paid image/video API, hosted moderation service or additional content filter was added.
