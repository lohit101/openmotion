# Image replacement validation · 27 October 2026

## Scope

Separate image workspace using the already installed FLUX.2 Klein 4B FP8 stack on the existing A100 PCIe 40 GB rental. No new rental or generation-model download was needed. Original inputs and generated media remain in ignored local job folders.

## Functional checks

- TypeScript and production build passed.
- Studio suite: 242 tests across 16 files passed, including serialized image/video jobs, immutable inputs, idempotent submission, lost-response recovery, local finalization without another paid render, model-family separation and whole-download storage preflight.
- CPU image processing: nine checks passed, including exact unpainted pixels, padded/downscaled mask alignment, the actual manual face reference and close-up field-of-view cropping. Model provisioning/storage checks: 11 passed.
- Pinned native ComfyUI validation accepted four image API graphs and the four existing video graphs. Native masked compositing was also executed with CPU tensors.
- Live UI: uploaded a reference through the file picker, extracted the selected source-video frame, painted/saved the edit area, generated and inspected the actual PNG. Shared library and source-frame handoff are available.

## Visual results

| Run | Wall time | Result |
|---|---:|---|
| Initial composite-only edit | 43.459 s | Mixed outfit, weak identity and pale region following the broad mask; failed visual review. |
| User's composite-only edit | 26.975 s | Obvious background exposure mismatch and identity drift; failed visual review. |
| Same-input masked-latent edit | 25.228 s | Large bright halo substantially reduced; faint mask-shaped background difference and mixed outfit remained. Identity insufficient. |
| Focused outfit instruction, same inputs | 39.824 s | Full gray dress and shoulder bag transferred more successfully. Facial likeness and small accessories still failed the requested fidelity. |
| Trained Klein head adapter after whole-person edit | 31.108 s | Full dress transfer improved over the first baseline, but the face still failed visual identity review. Adapter loading was verified: 80 trained patches attached. |
| Close-up reference framing + published fresh-latent head recipe | 35.873 s | Close-up framing retained more effectively; facial likeness, hair seams and photorealism still failed. Not enabled by default. |

Baseline edits used four Euler steps; the two-stage adapter tests used four plus four steps. All used CFG 1 and saved fixed seeds. These are observations on two target/reference pairs, not a representative benchmark. No image was automatically promoted to a video reference after failing visual review.

The user's close-up run retained the base room but borrowed the reference's distant body framing, preserved much of the original face and generated an additional arm. Saved upload order and reference-latent order were inspected and correct. This was a semantic conditioning/quality failure, not evidence that the upload fields had been reversed.

The 369,644,384-byte Klein adapter was explicitly downloaded on the existing rental and SHA256 verified. Its approximate ingress cost at $0.004/GB is $0.00148. No additional base checkpoints were downloaded. Tests did not establish a reliable identity lock or consistent scene illumination inside the painted region.

## Qwen whole-person implementation

This section records the initial blocked preflight. The user subsequently authorized removing Klein; the completed installation and actual GPU results are in [the migration record](qwen-migration-20261027.md).

The alternative uses native `TextEncodeQwenImage21`, scene-first/person-second conditioning, the native scene-sized latent, matching Qwen model/encoder/VAE, the official eight-step adapter and a trained BFS complete-person adapter. Its 18.41 GB pinned manifest and portable API/editable graphs are included. Native prompt validation passes without model inference. The alternative is explicitly labelled pending GPU quality evaluation.

The existing rental reports 19,917,156,352 free bytes. The new stack plus 5 GiB working reserve requires 23,774,868,320 bytes. No Qwen download or inference was initiated. A larger disk is needed to evaluate it while keeping the installed video/Klein stacks. The new whole-plan preflight blocks an insufficient-space download before any worker starts and accounts for existing partial files.

The live UI was refreshed and the Qwen option selected. It displayed zero of five files installed and disabled the complete download with the measured 23.77 GB required / 19.92 GB available message. No download started. The result panel separately shows the saved base/reference photographs; a draft model change does not relabel an old Klein result as Qwen output.

After validation, the idle A100 stop was confirmed by Vast (`exited`, intended state `stopped`, `computeStopped: true`). Models and disk were retained; reported storage billing remains approximately $0.02963/hour. The local preview-only test server was stopped.

Zero-mask pixels in locally finalized results match the decoded target exactly. This does not establish background preservation *inside* a broad mask or identity correctness. Face-detection and head-geometry diagnostics do not measure facial identity.

## Cost context

The existing rental reports $0.333333/hour compute and $0.029630/hour storage. At that combined rate, the 25.228-second run corresponds to about $0.00254 of running time and the 39.824-second run to about $0.00402. These are time-based estimates, not separate billing receipts; account billing also includes idle time and transfers. No large model transfer was needed for these baseline tests.

## Remaining work

The baseline is an editing tool, not a demonstrated identity-preserving character-swap solution. Improve complete outfit replacement, use a compatible trained identity mechanism, and retest scene exposure, mask edges and reference likeness before claiming a quality pass.
