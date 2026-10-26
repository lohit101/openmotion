# Source-frame photo evaluation · 27 October 2026

## Inputs and execution

Five paid comparisons used the same 720×1280 source frame, the user's latest 714×858 cropped reference, saved painted area and seed 20261027. The reference shows brown hair and a black top; the original target has blonde hair and a white top. All runs used a 2 MP working canvas (1088×1888), restored the source dimensions and retained exact source pixels outside the processed mask. Tiny-gap repair closed three accidental mask holes without extending the outer painted boundary.

The active user video finished before tests 01–03. Another video was submitted during diagnosis and completed before tests 04–05. Neither user video was interrupted. Only the local Studio server was reloaded, while both queues were empty; the ComfyUI engine was never restarted.

| Library result | Recipe / geometry strength | Sampling | End-to-end time | Visual finding |
|---|---|---|---:|---|
| Photo test 01 | v1 / 0.80 | 8 body + 8 head; Turbo; CFG 1 | 115.069 s | Mostly retained the original person and white outfit. Failed. |
| Photo test 02 | v1 / 0.25 | Same | 108.996 s | Lower guidance did not recover the swap. Failed. |
| Photo test 03 | v2 / 0.25 | Native editing latent; 8 + 8 | 98.339 s | Correcting the latent did not recover identity/outfit transfer. Failed. |
| Photo test 04 | v2 / 0 | 8 + 8; Turbo; CFG 1 | 108.565 s | Raw body transferred the reference; the head stage regressed toward the original face. Failed final identity. |
| Photo test 05 | v3 / 0 | 20 body; CFG 1; no Turbo or head | 116.591 s | Best tested face, hair and outfit transfer on this pair. Remaining halo, skin smoothing and lettering errors. |

Test 05's native execution-start/success interval was **34.230 s**. The 116.591 s total additionally includes local preparation, input transfer/readiness, result downloads and local review. Native execution time must not be advertised as the end-to-end wait. This is a photo benchmark, not a five-second video benchmark.

## Diagnosed failures and resulting changes

- Downloaded actual ComfyUI input PNGs and compared their decoded arrays with the prepared target/reference/guidance/masks. They matched; the reference and mask were not reversed or missing.
- Recovered test 04's raw body/head images with a cached diagnostic graph. Both sampler nodes appear in the execution-cached receipt: the capture did not resample either stage.
- Union suppressed replacement in these accelerated comparisons. New jobs at geometry strength zero omit its nodes and file requirement; no structural guidance is applied in that configuration.
- V1/v2 pasted the original facial core into the intermediate body, and the following head stage retained much of that source appearance. V3 keeps the generated identity instead. The optional v3 head handoff has CPU/compiler coverage but has not passed a live visual-quality comparison; it stays off in the evaluated draft.
- Corrected new native-quality sampling to CFG 1, consistent with the publisher's CFG-distilled Qwen 2.1 instructions. Historical v1/v2 graphs retain their original settings. V3 saves raw stages before compositing so generation and blending failures can be distinguished.

## Quality and cost

Test 05's detected face-box linear size was **0.951×** the target, versus **0.874×** for the preceding user-generated v4 result. Its detected center was approximately **12 px left and 23 px below** the source. These are geometric detector diagnostics, not an identity similarity score. Visual reference resemblance improved, but exact identity/placement and photographic realism are not established. Tattoo lettering changed, the skin is somewhat smooth, and regenerated background inside the broad painted area leaves a visible halo. A CPU-only GrabCut mask diagnostic cut hair and introduced a facial pinhole; it was rejected and did not alter the saved result or ship as automatic processing.

The evaluated starting settings are: Qwen 2.1, 2 MP, native 20 steps, CFG 1, head pass off, geometry strength 0, background protection on, feather 4 px, gap repair on. They require **17,492,844,688 bytes** of existing base/encoder/VAE/body-adapter files; Turbo, Union and the head adapter are unnecessary for this recipe. The image draft was updated only after checking that it still contained the original evaluation inputs/settings. No output was automatically propagated to video.

The A100 PCIe 40 GB quote was **$0.333333/hour compute**, **$0.0296296/hour storage**, and **$0.004/GB ingress**. Five measured job durations total **547.560 s**, corresponding to approximately **$0.0507 compute** and **$0.0045 storage during those intervals**. Test 05 alone corresponds to approximately **$0.0108 compute**. These estimates exclude download/setup/idle time, other user renders and unrelated transfers; they are not account billing receipts. The separately authorized 7.55 GB Union plus 260 MB head download was approximately **$0.0312 ingress**. No additional model files were downloaded for these five inference tests.

## Verification and retention

Image compiler checks: **15 passed**. CPU image checks: **13 passed**. Production TypeScript/build passed. All six portable image API/editable graphs passed wiring validation. Raw outputs, masks, receipts and immutable inputs remain in ignored local job/backup folders; media and credentials are not committed. After both queues were empty, compute was stopped and independently confirmed as actual `exited`, intended/current/next `stopped`. Models, disk and all local/user results were retained; storage billing continues.

Research and primary sources: [source-frame research](../source-frame-research-20261027.md), [official Union model card](https://huggingface.co/alibaba-pai/Qwen-Image-2.1-Fun-Controlnet-Union/blob/8a4702014d4dabb5f896fcba917e2ee0a961465f/README.md), [BFS body guide](https://huggingface.co/Alissonerdx/BFS-Best-Face-Swap/blob/main/docs/qwen-image-2.1-body.md), [BFS head guide](https://huggingface.co/Alissonerdx/BFS-Best-Face-Swap/blob/main/docs/qwen-image-2.1.md).
