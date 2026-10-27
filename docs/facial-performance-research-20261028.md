# Source facial performance, hand occlusion and shot transitions

Research and isolated evaluations on 28 October 2026. Studio defaults, drafts, historical jobs and accepted pixels are unchanged. The user authorized adapter/workflow testing after asking for research. The existing Japan A100 40 GB was used for one comparison, at $0.333333/hour compute; no new rental was created. Compute was confirmed stopped afterward and storage retained.

## What is missing in the current graph

The recorded Studio graph supplies the source video, prepared reference and frozen text embedding to Viggle. It supplies source audio only to finalization/export, not to the denoiser. It has no separate facial-performance, gaze or foreground-occlusion controller. Changing the visible prompt cannot introduce these inputs into prepared-frame Viggle sampling.

The pinned community wrapper still documents unreliable lip synchronization. The **original publisher has since retracted its blanket lip-sync limitation** and demonstrated holding the source soundtrack clean in the target audio rows. This is a real, specific missing input to evaluate; it is not proof of source-expression accuracy. Audio predicts speech motion, whereas the user's requirement is to reproduce the visible performance, including silent expressions and gestures. [Viggle's updated model card](https://huggingface.co/Viggle/Viggle-Animate#limitations), [pinned wrapper](https://github.com/Saganaki22/ComfyUI-Viggle-Animate-H3/tree/6ae081af5b3175f99ef7cddebd5dfaf93390ab70).

The installed 21.03 GB pruned INT8 model retains its audio input/output projections. The native H3 model supports clean audio timesteps through its audio denoise mask. No replacement diffusion checkpoint was needed for the live audio experiment. A separate soundtrack reference block is not equivalent to pinning target audio. [Native H3 implementation](https://github.com/Comfy-Org/ComfyUI/blob/fb3befd168731438f88bc96e0920a538e8649878/comfy/ldm/minimax/model.py), [published inference code](https://huggingface.co/Viggle/Viggle-Animate/blob/main/inference/sample.py).

## Input/output audit

Baseline `9a617616-ec4c-48e6-bd2f-d3662caaf353` contains 78 decoded frames at 704×1248, 24 fps, duration 3.25 s. The selected source has the same dimensions, frame count, zero start timestamp and duration. This pair does not have an export-FPS or one-frame alignment fault.

Synchronized inspection shows a weaker blink around output frame 18 / 0.75 s, different mouth shapes, and a restrained smile around frame 54 / 2.25 s. The source includes glasses absent from the prepared identity; that appearance difference complicates eye tracking. During the hand pass, a clear face is unavailable on frames 74–76. The source then reveals a different scene/outfit. One prepared car-scene frame is insufficient to anchor the new shot's appearance.

## Experiments and decisions

### A: Hold the source soundtrack in target audio

`RecastVigglePinAudio` is an opt-in native node with a separate manual-download manifest and API example. It encodes stereo audio with the matching 32 kHz H3 audio VAE, holds its target audio rows with a zero denoise mask (clean t=1), and preserves any existing video continuation mask. The original source audio still supplies export. Codec/grid tail silence is logged separately; no video frames are invented. It validates waveform, latent family, frame/audio grids, VAE rate and finite encoded output before sampling.

The comparison used the baseline's uploaded source, reference, seed, dimensions, five-pass Euler schedule and DMD strength. Only target audio pinning changed. Native prompt `e5a1dfac-56eb-47f4-b815-460cd21f4ac4` completed in **173.048 s**, producing exactly 78 frames. This is a **3.25-second native comparison**, not a five-second under-three-minute end-to-end pass. Runtime differences from the previous run cannot establish a speed improvement.

Visual review found changed mouth motion but persistent expression mismatch and worse transparency/edge detail in the raised hand. On the same twelve pre-cut sample frames, mouth-opening discrepancy increased. **Do not enable this by default for source-performance copying.** Evaluate separately on real dialogue with the speaker's matching audio; music or another voice is not an authoritative record of the visible face.

At the recorded host tariffs, native execution corresponds to $0.016023 compute and $0.001424 running storage. The verified 605,254,808-byte decoder download corresponds to $0.002421 ingress. The 4,243,594-byte downloaded result adds about $0.000023 egress. Their sum is approximately **$0.01989**. These are tariff-based stage costs, not an invoice total: runtime reload, setup, polling/idle time and retained storage are additional. All raw receipts and the native error/history record remain under ignored `backups/facial-motion-20261028/`.

For a broader session estimate, the observed already-running window was 23:25:46.741–23:42:42.176 UTC (1015.435 seconds), ending at confirmed compute stop. That includes research/idle and reload as well as inference: approximately $0.09402 compute + $0.00836 running disk + $0.00244 measured model/result transfer = **$0.10482**. This is not a provider invoice measurement, excludes charges before the first capture and retained disk after stopping, and must not be presented as a two-cent complete session.

### B: Source-driven facial correction on the existing paid output

Used the existing pinned FaceFusion checkout (`decc6c9d8f8e014878624452c6e8fe208726b4ec`) with its LivePortrait expression components. Source/target faces were independently aligned, expression transferred from the original video, and generated identity feature volume/head pose retained. No face embeddings or demographic classification were computed. The existing YuNet, 2DFAN4 and XSeg models were reused; 338,254,240 bytes of LivePortrait ONNX weights were explicitly downloaded to this Mac, with pinned revision/checksums. No remote model transfer or new paid video inference was used for this pass.

The approach is supported by LivePortrait's released video-to-video expression/eye/lip controls and FaceFusion's expression restorer. These are separate face components, not LoRAs for H3. The dedicated eye/lip retargeting scalar controls describe opening, not a guarantee of accurate pupil direction. [LivePortrait](https://github.com/KlingAIResearch/LivePortrait), [retargeting configuration](https://github.com/KlingAIResearch/LivePortrait/blob/9b294b3d0536135442ea73cb01e6cb3ca7029dd3/src/config/inference_config.py), [FaceFusion restorer](https://docs.facefusion.io/usage/cli-arguments/processors/expression-restorer).

Sampled tests compared neutral codec round-trip (strength 0), strength 0.6 and strength 1.0. Blinks and the wider smile visibly improve. The 1.0 full-clip CPU evaluation took **218.914 s**, corrected 75 frames, and retained the original generated frame unchanged when face tracking failed on frames 74–76. The detected new shot at frame 77 has no approved replacement reference, so this complete preview is not a successful shot-transition result. A weaker strength looks preferable on the sampled frames; it has **not** received a complete temporal pass.

Metrics below are mean absolute differences in normalized 68-landmark opening ratios on twelve identical pre-cut frames. They are geometry proxies with cross-person/glasses/tracker bias, **not** identity scores, gaze angles, perceptual realism or lip-audio synchronization scores.

| Proxy | Baseline | Audio pin | Absolute expression 0.6 | Absolute expression 1.0 |
| --- | ---: | ---: | ---: | ---: |
| Left eyelid opening | 0.02358 | 0.01976 | 0.01324 | 0.01278 |
| Right eyelid opening | 0.02227 | 0.02399 | 0.01054 | 0.01009 |
| Mouth opening | 0.03044 | 0.06831 | 0.01495 | 0.02911 |

Across all 74 pre-cut frames, the strength-1.0 pass moved left/right eyelid discrepancy from 0.02304/0.02630 to 0.01771/0.01592, and mouth discrepancy from 0.03824 to 0.02608. Visual review still finds unwanted resting-expression changes. A separate first-frame-calibrated relative variant reduced some mouth error but produced worse eyelid/gaze behavior, including an upward eye roll absent from the source. **Reject that variant.** Do not infer that a lower opening error establishes accurate gaze.

Upstream content checks were retained. Probe frames can be declined; full-video evaluation uses the unchanged upstream video check, which accepted both videos. No component was patched to bypass a check. Raw comparisons are local and excluded from Git.

## Recommended architecture and acceptance gates

1. **Keep the original time axis authoritative.** Decode/frame-index the selected interval once; retain exact original timing/audio. Track visible face/iris landmarks, eyelids, mouth and hand occlusion per frame. Reset trackers at actual cuts. Do not smooth away short blinks, lip closures or fast hand passes to hide tracking errors.
2. **Keep Viggle for body/scene propagation while evaluating a separate face pass.** Drive facial motion from the original video, with appearance from the generated character. Preserve generated head pose/scale and edit only the valid face region. The 0.6 expression route is a candidate, not a new default. Unknown/occluded faces must retain the existing accepted pixels and expose diagnostics instead of hallucinating a face over the hand.
3. **Add explicit gaze evaluation before calling eyes solved.** Eye opening alone misses pupil direction. Compare iris position relative to each eye/head pose, blink onset/duration and source timing on clear frames. Test independent gaze/eyelid controls against the source before enabling. Research demonstrates that full-face objectives can miss gaze; it does not supply a ready-made H3 adapter. [Explicit gaze constraints research](https://arxiv.org/abs/2305.16138).
4. **Separate foreground occlusion from expression editing.** Track hands/props through the video with temporal masks, preserve front/behind order and motion blur, and exclude occluded facial pixels from correction. SAM2 is a suitable mask-tracking candidate, not an automatic depth/occlusion solution. Copying the original hand indiscriminately can leak the source's skin tone, clothing or accessories; changing its appearance while preserving geometry requires its own evaluation. [SAM2](https://github.com/facebookresearch/sam2).
5. **Handle real cuts as new shots.** A hand covering the lens may hide an edit. Prepare a correctly placed replacement frame for each new shot, retain accepted frames and exact shot timing, and reinitialize trackers/appearance only at the boundary. A blanket 5-second continuation boundary is not a shot detector. Do not carry a car-scene repaint into another room and expect identity fidelity.
6. **Use speech generation conditionally.** LatentSync 1.6 is a possible dialogue-only benchmark (published minimum 18 GB VRAM, 20–50 steps); MuseTalk 1.5 is a faster 256-pixel-face benchmark. Both are audio-driven and neither solves source gaze or hand performance. Neither has been installed/tested here. [LatentSync](https://github.com/bytedance/LatentSync), [MuseTalk](https://github.com/TMElyralab/MuseTalk).

Acceptance must include synchronized close-ups of eye direction, blink timing, lip closure, smile shape, hand/face crossing order, identity after uncovering, source placement/scale, lighting, and untouched background. Hold source/output duration and frame count equal. Include silent expressions, real speech, music/miming, hand passes and scene changes; do not validate solely with a frontal talking head. Keep identity checks distinct from these motion checks. Measure complete warmed latency and additional models/storage only after a quality pass.

No verified public H3/Viggle gaze/hand-expression LoRA was found in the checked publisher releases; the available DMD adapters accelerate sampling. An influencer/style LoRA is not a facial-performance controller, and Wan/Klein/Qwen adapters are not interchangeable with H3.

## Alternatives and product claims

Wan2.2-Animate-14B has explicit face/pose/background/mask conditioning and is a reasonable controlled alternative, but it needs a separate graph and preprocessing, not the disabled SCAIL checkpoint selector. Its publisher warns of proportion mismatch and mask/background tradeoffs. Wan-Animate-2 is newer and directly consumes video, but the released examples use multi-A800 configurations; its low-latency claims do not establish a single-A100/PRO-5000 budget result here. Neither was downloaded or tested in this task. [Wan preprocessing](https://github.com/Wan-Video/Wan2.2/blob/main/wan/modules/animate/preprocess/UserGuider.md), [Wan-Animate-2 release](https://github.com/Wan-Video/Wan-Animate-2).

Higgsfield publicly describes targeted Object Swap and scene/motion preservation. Its public material does not disclose a reproducible private facial/occlusion pipeline. Do not claim we recovered its model internals or can guarantee identical behavior. [Official Genjutsu description](https://higgsfield.ai/blog/higgsfield-genjutsu).

Pixel-exact unedited regions require compositing plus a lossless master and verified masks. A new identity with different anatomy cannot also have every source facial/skin pixel remain identical. Frame timing and preservation outside the edit can be enforced; exact generative identity/motion/occlusion fidelity is an acceptance target, not a proven guarantee.

Existing H3 territorial/commercial terms remain unchanged. LivePortrait's MIT code licence specifically excludes InsightFace recognition/detection weights from commercial clearance; this evaluation used geometry-only YuNet/2DFAN detection, not recognition. Dependencies and converted-weight terms still need a deployment review before a hosted service. No hosted moderation dependency or new prompt-blocking UI was added. [LivePortrait licence](https://github.com/KlingAIResearch/LivePortrait/blob/main/LICENSE).

## Reproduce the optional audio evaluation

The core four-file Viggle bundle and the Studio startup/download defaults are unchanged. On an explicitly selected, idle managed GPU, download only the matching extra VAE with the existing verified/resumable downloader:

```sh
python3 scripts/download_models.py --manifest config/viggle-audio-evaluation.lock.json --model-dir models
```

Use `workflows/experimental/api/viggle_int8_audio_swap.json`, supplying the selected source interval as `source.mp4` and the approved source-aligned frame as `repainted-source-frame.png`. This template retains the existing 480×864/three-update example defaults; the measured test instead cloned the 704×1248/five-update baseline. This is a manual API graph, not a Studio default or an accuracy-certified workflow. Never replay a paid test just to inspect its saved output. The node's five CPU tests cover immutable inputs, preserved continuation masks, missing soundtracks, timing/shape checks and invalid codec output; one native GPU submission succeeded.
