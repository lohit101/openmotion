# Image replacement validation · 27 October 2026

## Scope

Separate image workspace using the already installed FLUX.2 Klein 4B FP8 stack on the existing A100 PCIe 40 GB rental. No new rental or generation-model download was needed. Original inputs and generated media remain in ignored local job folders.

## Functional checks

- TypeScript and production build passed.
- Studio suite: 236 tests across 16 files passed, including serialized image/video jobs, immutable inputs, idempotent submission, lost-response recovery and local finalization without another paid render.
- CPU image processing: five checks passed, including exact unpainted pixels and padded/downscaled mask alignment.
- Pinned native ComfyUI validation accepted both image API graphs and the four existing video graphs. Native masked compositing was also executed with CPU tensors.
- Live UI: uploaded a reference through the file picker, extracted the selected source-video frame, painted/saved the edit area, generated and inspected the actual PNG. Shared library and source-frame handoff are available.

## Visual results

| Run | Wall time | Result |
|---|---:|---|
| Initial composite-only edit | 43.459 s | Mixed outfit, weak identity and pale region following the broad mask; failed visual review. |
| User's composite-only edit | 26.975 s | Obvious background exposure mismatch and identity drift; failed visual review. |
| Same-input masked-latent edit | 25.228 s | Large bright halo substantially reduced; faint mask-shaped background difference and mixed outfit remained. Identity insufficient. |
| Focused outfit instruction, same inputs | 39.824 s | Full gray dress and shoulder bag transferred more successfully. Facial likeness and small accessories still failed the requested fidelity. |

All four used four Euler steps, CFG 1 and a fixed seed. Differences are observations on one target/reference pair, not a representative benchmark. No image was automatically promoted to a video reference after failing visual review.

Zero-mask pixels in locally finalized results match the decoded target exactly. This does not establish background preservation *inside* a broad mask or identity correctness. Face-detection and head-geometry diagnostics do not measure facial identity.

## Cost context

The existing rental reports $0.333333/hour compute and $0.029630/hour storage. At that combined rate, the 25.228-second run corresponds to about $0.00254 of running time and the 39.824-second run to about $0.00402. These are time-based estimates, not separate billing receipts; account billing also includes idle time and transfers. No large model transfer was needed for these baseline tests.

## Remaining work

The baseline is an editing tool, not a demonstrated identity-preserving character-swap solution. Improve complete outfit replacement, use a compatible trained identity mechanism, and retest scene exposure, mask edges and reference likeness before claiming a quality pass.
