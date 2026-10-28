# Source eyes and mouth comparison — 2026-10-28

The user requested direct face replacement and source facial performance. The
existing pass already calls FaceFusion's Hyperswap face swapper. ONNX is its
runtime. Swapping onto generated footage cannot independently recover a source
blink or mouth shape missing from that generated footage.

The pinned implementation interpolates its embedding coefficient from +0.35
to −0.35. The retained weight **0.5** gives a zero target-embedding coefficient;
it is not a 50% pixel blend. Increasing the slider is not a simple increase to
100% swapping. See the [pinned FaceFusion implementation](https://github.com/facefusion/facefusion/blob/decc6c9d8f8e014878624452c6e8fe208726b4ec/facefusion/processors/modules/face_swapper/core.py)
and [processor documentation](https://docs.facefusion.io/usage/cli-arguments/processors/face-swapper).

## Implemented route

Library **Swap face** retains the existing direct method as its default. The
optional **Source eyes & mouth · beta** swaps the same fixed donor onto both the
generated video and its immutable prepared source. Independently aligned source
eye/mouth regions are transferred to the generated face when landmarks,
pose-proxy compatibility and both occlusion masks permit it. It does not copy
the whole source head, alter the generated body or infer an unseen face. A
full-source-face projection was rejected during local probes because it changed
cheek shape and lighting.

This is an inference/compositing change, not a trained H3 adapter or audio-based
lip sync. FaceFusion's separate [expression restorer](https://docs.facefusion.io/usage/cli-arguments/processors/expression-restorer)
uses LivePortrait; earlier experiments with that route are preserved separately
and were not silently enabled here. Source features are donor-swapped first,
but upstream feathered face boundaries can still retain target details. The
tested profile's short note must not be read as proof of zero source leakage.

## One authorized full GPU comparison

The user manually resumed the existing A6000 after authorizing one comparison
up to **$0.05**, with a compute stop afterward. Both generation queues were empty.
No new rental, model-weight download, Viggle inference or user draft change was
made. Existing media and paid parents remain immutable.

| Item | Observed result |
| --- | --- |
| Parent | `09958330-2657-4fed-b935-d79b057e5a15` |
| Donor asset | `42772279-7c8e-44df-802f-95987388d4ea` |
| New derivative | `3faab64e-7a50-4f03-bd15-450b92bea5cb` |
| Library title | Face swap / source eyes & mouth / 11.5s |
| Hardware | NVIDIA RTX A6000 |
| Remote processing | 80.522308 s |
| Full job to Library | 127.162 s |
| Source-feature frames | 266 |
| Direct-swap fallback frames | 2 |
| Untrackable generated-face frames kept unchanged | 8 |
| Output | 276 decoded frames, 704×1248, 24 fps, 11.5 s |
| New weights | 0 bytes |

Identity-only fallback occurred at frame 51 (ambiguous/missing source face) and
242 (uncertain source landmarks). Frames 247, 249 and 261–266 retained the
generated result because its face could not be reliably tracked. The hand/lens
transition near the end remains a weak spot. A face-only pass cannot repair a
new shot's hair, clothing or scene appearance.

Synchronized frame review at 18, 48, 96, 132, 192 and 240 found closer side
glances and mouth/smile shapes with the generated cheeks, jaw and scene retained.
Fallback-frame sheets were also reviewed. This is a qualitative sampled review,
not a full continuous-playback approval, gaze-angle metric, identity score or
zero-drift result. No flawless quality claim is established. The option remains
beta and off by default.

Output duration/frame geometry and encoded audio payload were checked against
the parent. The source-performance profile is frozen at
`8e3a1613781b81c2ba1739860f43ede28f6192b9395a65fa7aaf5e51396f9df7`.
Parent/source/output hashes and audio parity are in the sanitized
[validation receipt](../../validation/source-face-swap-20261028.json). Media and
raw probes remain ignored under `studio/data` and `backups`.

## Budget and compute

The observed reconnect-to-confirmed-stop interval was approximately **248.29 s**
at $0.40/hour compute and $0.0177777778/hour running storage. Including small
media transfers, its tariff-based estimate is approximately **$0.03**, below the
$0.05 authorization. This is not a finalized provider invoice. It includes more
than the 80.52-second processing stage. No model weights were downloaded.

Vast's first stop request did not promptly confirm; the existing safety monitor
continued checking. A subsequent explicit check confirmed **exited/stopped at
2026-10-28 13:49:06 UTC**. Retained storage remains billed. No second paid test
was submitted.

## Verification

Five offline geometry/masking tests cover uncertain pose/landmarks, finite
eye/mouth regions, occlusion fallback and protected pixels. Server tests cover
method-specific deduplication, exact source/provenance validation, historical
timing-recovery rejection and CUDA receipt verification. Existing direct jobs
retain their old keys and settings. Existing model terms and upstream media
checks remain unchanged.
