# Bare Wan2.2 Animate experiment · 2026-11-07

Branch: `feat/wan22-animate-baseline`, based on GPU main `4a38f79`. The reviewable [baseline profile](../experiments/wan22-animate/baseline.json) is a research configuration, not an implemented Studio engine or a successful render. Nothing is deployed; no model weights, rental, remote installation, compute resume or inference was requested by this branch. The paused selective-face-repair work and its exhausted allowance remain separate.

## Suitability

Use **Wan2.2-Animate-14B**, not the generic Wan2.2 I2V/T2V model. Its replacement mode combines a reference character with source body pose, implicit facial-motion features, scene video and a person mask. This is directly relevant to source-driven character replacement. The [paper](https://arxiv.org/abs/2509.14055) and [official preprocessing guide](https://github.com/Wan-Video/Wan2.2/blob/1ea34ff48f87168174e12956e200b1d908b1c5ff/wan/modules/animate/preprocess/UserGuider.md) describe those inputs.

“Bare” here means no acceleration/identity LoRA and no post-render face replacement, facial retargeting or upscaling. Pose/face extraction and the replacement mask are still necessary controls. A literal swap of a denoiser filename into the Viggle graph will not work.

Removing our facial finishing stage eliminates that stage's particular face-composite boundary and feature-over-hand failure mechanisms. That is a reason to evaluate native output, not evidence that Wan's generated face will have no flicker or occlusion errors. Native Viggle without finishing must be the control so that model differences are not confused with postprocessing differences.

## Quality questions

| Concern | What the evidence supports |
| --- | --- |
| Body motion and expressions | Dedicated training and source facial conditioning make it a plausible candidate. Source extraction quality still limits the result. |
| Identity and face proportions after a turn | Not guaranteed. A reference image is not a hard identity constraint. WanAnimate users directly report identity mismatch and a trade-off between facial conditioning and likeness. |
| Lips, eyes, jaw and teeth | Visible source performance can guide them; there is no hard per-frame mouth/teeth correctness guarantee. Removing face conditioning to strengthen identity can lose expression. |
| Hands, hidden faces, offscreen subjects | A mask and face/pose observations must remain correct. Missing observations still need explicit handling above the model. |
| Cuts and multiple people | No automatic solution. Official preprocessing warns that the simplified replacement mask is for one person and may fail on multiple people. Each new shot needs its own reviewed target and controls. |
| Different body proportions | Official preprocessing warns of deformations when driving and reference anatomy differ substantially. A tight source mask can constrain the new silhouette; a loose mask exposes more background to generation. |

The [first-hand face-consistency thread](https://github.com/kijai/ComfyUI-WanVideoWrapper/issues/1280) reports somewhat better likeness from BF16 and stronger likeness with facial control disconnected, but worse expression. These are user observations, not a controlled benchmark or a universal prescription. Do not disable facial motion in the baseline: expression accuracy is a core user requirement. A [native-node face-strength issue](https://github.com/Comfy-Org/ComfyUI/issues/14965) also reports replacement artifacts; verify the exact current runtime rather than assuming a preset fixes them.

## Time and model costs

The [native config](https://github.com/Wan-Video/Wan2.2/blob/1ea34ff48f87168174e12956e200b1d908b1c5ff/wan/configs/wan_animate_14B.py) uses 20 sampling steps, CFG 1, shift 5 and 77-frame windows. Our current Viggle graph uses three or five sampling passes. This is approximately 6.7× or 4× as many sampling steps, **not** a measured wall-time multiplier: model architecture, precision, attention, window size, frame rate, offloading and startup differ.

Expect a slower native sampling stage as the planning assumption. There is no defensible paired minutes/10-second estimate on our host yet. Pose/mask preparation adds time; omitting finishing removes some time; Clarity remains a separate stage. Do not multiply an old complete-video time, which included finishing and sometimes repaints, by the step ratio. Do not use the general Wan2.2 T2V/I2V benchmark table as an Animate benchmark.

The current [Comfy template](https://docs.comfy.org/tutorials/video/wan/wan2-2-animate) is not bare: the audited revision contains both a LightX2V accelerator and the model-specific relighting LoRA. Its six-step widgets do not establish the quality or speed of undistilled 20-step generation. Do not blindly attach generic Wan2.2 adapters; the [official model card](https://huggingface.co/Wan-AI/Wan2.2-Animate-14B) warns about compatibility.

The audited [Comfy model repository](https://huggingface.co/Comfy-Org/Wan-2.2) has a 34.55 GB BF16 Animate denoiser and an 18.41 GB INT8 denoiser. These exclude the text encoder, CLIP Vision, VAE and pose/segmentation dependencies. These weights are different from the H3 files. Existing compatible files may reduce downloads after inventory verification; no new manifest or automatic download has been registered. Do not broadly re-enable retired SCAIL weights/LoRAs.

## Proposed comparison

1. Begin with one five-second interval and the exact same reviewed prepared image in both arms. Inspect body pose, face crops and target/foreground masks before inference.
2. Compare bare Viggle with the undistilled Wan replacement candidate; keep face finishing, repaints and upscaling off in both. Use BF16 if the selected GPU can hold it, otherwise declare INT8 explicitly. Keep full body/face controls and a fixed seed.
3. Check actual timestamps and output duration, including reference-window joins. Native CLI defaults to 30 fps; passing 24-fps material through a 30-fps export would invalidate timing/lip-sync conclusions. Neither dropping frames nor FPS interpolation is an allowed speed trick.
4. Record preprocessing, cold/warm loading, sampling, decoding and transfer separately as well as total Generate time. Review synchronized source/output motion and several identity angles, not just one attractive still.
5. If promising, run longer speech, head-turn/reappearance and hand-crossing intervals. Only then evaluate the official relighting adapter as a separate arm if needed. Identity LoRAs or face finishing require independent evidence.

## Newer Wan-Animate-2

This is a separate release from Wan2.2-Animate-14B. Its [paper](https://arxiv.org/abs/2608.06009) targets intermediate-extractor errors and identity drift by conditioning directly on the driving video. The [released repository](https://github.com/Wan-Video/Wan-Animate-2) includes base/distilled inference, but its documented defaults target eight A800s and its reported 480p test uses two A800s. This does not prove a single GPU is impossible; it does mean that a practical single-GPU fit/speed claim remains unverified. Its Lite/realtime discussion must not be presented as the measured speed of our application.

## Current boundary

Only the isolated branch, source audit, baseline settings and comparison protocol are prepared. Native Wan provisioning, preprocessing integration, frame-accurate runner/recovery and GPU comparisons still need implementation/validation. No facial quality, tracking, speed or production-readiness pass is established.
