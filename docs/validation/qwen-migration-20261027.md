# Klein → Qwen migration · 27 October 2026

## Completed migration

The user explicitly authorized replacing Klein with Qwen on the existing rental and testing the latest image inputs. No new GPU or larger disk was rented.

- Waited for the active video to finish before removing files or starting downloads. A subsequently submitted user video also completed before the shared queue ran the image test.
- Removed exactly the Klein 4B FP8 transformer, Qwen3 4B text encoder, Flux2 VAE and experimental Klein BFS head adapter, plus their verification stamps: **12,821,462,802 bytes reclaimed**. The idle model cache was released without restarting ComfyUI.
- Downloaded and SHA256 verified all five entries in `config/qwen-image-models.lock.json`: **18,406,159,200 bytes**. Downloads used four workers and existing resume/checksum protections.
- Preserved all four Viggle weights, original media and completed outputs. Qwen and Viggle fit on the existing **64 GiB disk**, with **14,182,993,920 bytes free** after the tests.
- Automatic Viggle frame preparation is disabled unless all three Klein files are confirmed installed. A separate download button sits beside that option. The server rejects a missing-Klein automatic job before queueing inference. Prepared-frame video generation remains available without Klein; ordinary references are never silently relabelled as prepared frames.

The live UI showed the disabled Automatic choice and its download control. Restoring Klein currently requires 17.82 GB free including the working reserve, so the button accurately explains the insufficient-space condition. Selecting an option starts no download.

## Same-input GPU tests

Both tests used the same target, reference and saved mask as the latest failed Klein close-up edit. The target is a 720 × 1280 indoor close-up with both hands at the hair; the reference is the original outdoor photograph with a black top and pink trousers. No normalized full-body reference was generated, no third face image was conditioned, and no new generation model was downloaded after the pinned stack.

Settings: A100 PCIe 40 GB; Qwen Image 2.1 INT8; matching Qwen3-VL INT8 encoder and RGBA VAE; official eight-step adapter and BFS whole-person adapter, both strength 1; eight Euler/simple steps; CFG 1; seed 20261027; 1088 × 1888 padded working canvas; approximately 0.59 MP reference budget; original-size PNG; inward feather 4 px. ComfyUI successfully attached the adapters and completed both native prompts without an out-of-memory error. Peak VRAM was not continuously measured.

| Run | End-to-end run time¹ | Native Comfy execution | Observed result |
|---|---:|---:|---|
| Same-input Qwen default | 45.873 s | 30.979 s | More recognizable reference appearance and complete black outfit, but smaller subject, extra arm, copied/mutated text and outdoor lighting. Dark mask-shaped background boundary remained. Failed review. |
| Same inputs, focused close-up instruction | 40.033 s | 23.513 s | Extra arm removed and close-up improved. Face/outfit transfer was clearer than the Klein baseline, but head size, light direction, mask edges and unpainted holes still failed the requested consistency. |

¹ From runner start through local PNG finalization, excluding time queued behind the user's video. These are two observations on one pair, not a throughput or broad quality benchmark. The earlier Klein close-up adapter test took 35.873 s and also failed quality review.

The focused prompt explicitly kept the face/shoulders large, both hands at the original hair positions, lower body outside frame and soft indoor light, and excluded reference text. It was a manual evaluation prompt, not a newly imposed universal default. No automatic quality rerenders occurred.

The detected face-box size ratios were **0.600×** and **0.760×** the target respectively. Both triggered the existing framing warning. This is a geometric diagnostic, not a facial-identity score. Visual inspection of the full image and reference/output face crops found better likeness transfer, but did not establish an identity lock. The reference's partial-body outdoor format differs from the adapter's recommended full-body plain-background input; that is a limitation of this comparison, not proof that normalizing it would solve the failures. The [publisher guide](https://huggingface.co/Alissonerdx/BFS-Best-Face-Swap/blob/main/docs/qwen-image-2.1-body.md) also describes pose following as approximate.

Both finalized PNGs preserve decoded target pixels exactly wherever the saved mask is zero. That also preserves accidentally unpainted holes inside the person. Qwen's trained recipe samples a native scene-sized latent and composites afterward; unlike the Klein inpainting variant, this mask does not constrain denoising. Background painted inside a broad mask can still change exposure. Neither result was automatically promoted to Motion control.

Local library job IDs: `036f36d0-1494-45c3-868b-df626560c855` and `f9a5f9f6-31ce-42f1-9579-d76f99cfcd7c`. Inputs, outputs, saved graphs and execution receipts remain in ignored job folders. Raw migration captures are under ignored `backups/qwen-migration-20261027/`.

## Validation and operating state

- Production build and TypeScript checks passed. The existing bundle-size warning remains.
- Automatic-preparation protocol checks and existing video checks: **42 tests passed** across two files. Missing Klein blocks automatic inference; prepared video still queues without it.
- CPU image checks: **10 passed**, including exact outside-mask pixels and reviewing Qwen against its actual identity reference instead of an unused saved manual close-up.
- The image readiness caption now names the selected model, and the Qwen hint continues to mark the recipe experimental.
- After both tests and downloads completed, Studio and native Comfy queues were empty. Vast subsequently confirmed the instance **exited**, intended state **stopped**, `computeStopped: true`. Models and disk are retained.

Provider quotes: compute **$0.333333/hour**, storage **$0.029630/hour**, ingress **$0.004/GB**. Qwen's first transfer is approximately **$0.0736**, and the two measured image durations correspond to approximately **$0.0087** combined compute/storage. These are duration/size-based estimates, not billing receipts, and exclude download/setup/idle compute and other user renders. Paused disk storage remains approximately **$0.02963/hour**.

Qwen components use the Qwen Research License; the BFS body adapter is MIT. This private test does not establish suitability for a future hosted commercial service. The result is a working, evaluated alternative, **not a photographic-quality pass**. Further work should address scene/pose constraints and mask correctness rather than assume a longer prompt guarantees fidelity.
