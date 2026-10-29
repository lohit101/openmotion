# Complete-overlap continuation

The user resumed the face-continuity goal on 2026-10-30. A smaller Imagen mask
improved the join but still changed expression/face geometry. The strongest
tested direction preserves the previous appearance and carries the **entire**
accepted overlap, then uses the fixed-donor facial pass across the assembled clip.
Standalone Imagen and historical photo recipes are unchanged.

## Why the old join changed the face

The nine-second example's forward branch has an end-aligned second window:
skip 51, source count 120, overlap 73, with 47 new accepted frames. The original
anchor pinned only the first five decoded frames/two video latents. Most of the
73-frame overlap could change before the visible chronological join at frame
169 (7.0417 seconds). Repainting the reference also changed facial placement.

The pinned upstream [loop implementation](https://github.com/Saganaki22/ComfyUI-Viggle-Animate-H3/blob/6ae081af5b3175f99ef7cddebd5dfaf93390ab70/loop_nodes.py)
distinguishes five-frame anchors from complete latent overlap. H3's 17k+5 frame
packing maps 73 frames to 22 video latents. Our v3 checkpoint explicitly uses
**VAE encodings of prior raw decoded pixels**, not recovered sampler latents.

## New-job contract

New previous-appearance long jobs use `encoded-overlap-v3`. The preceding
window encodes exactly the next overlapping range and stores it with one exact
float RGB appearance frame. The next window pins every carried video latent;
silent H3 audio stays unpinned, and original chronological audio is restored by
existing assembly. Accepted output frames are still discarded from the new
window rather than overwritten or crossfaded.

The checkpoint validates job ID, version, temporal phase, source range, canvas,
frame rate, finite tensors and their dimensions. Final windows write a terminal
receipt without an unused encoding. Each checkpoint/video still downloads before
progress advances, through the existing resumable transfer implementation.

For the tested 73-frame overlap, the compact checkpoint is 17,792,040 bytes;
encoding took 16.431 seconds on the A6000. It replaces roughly 63 MB of previous
five-frame-plus-appearance storage. Five-frame overlaps still carry two latents.
This is not a claim that all video inference is faster, or that identity cannot
drift within a generated window.

`five-frame-v1` and `last-frame-v2` jobs retain their nodes, math and contracts.
Directional children inherit their parent's saved version, including when a
previously paid parent resumes before creating its second child. Cached engines
without the three new nodes are rejected before a new paid long job is queued;
Connect / retry setup updates code without additional model weights.

## Evaluation

See the sanitized [validation record](validation/encoded-overlap-20261030.json).
Every new native test generated 120 frames, accepted 47, and explicitly reused
169 paid parent frames. These are **not** four new nine-second render benchmarks.
All complete comparison exports contain 216 frames at 24 fps, 704×1248.

| Tail comparison | Native seconds | Raw join change / nearby median | Finished join change / nearby median |
|---|---:|---:|---:|
| Original broad Imagen baseline | Existing paid output | 4.014 | 4.245 |
| Previous actual appearance, old five-frame anchor | 405.008 | 1.237 | 2.076 |
| Tighter aligned Imagen repaint, old anchor | 374.670 | 1.826 | 2.368 |
| Full decoded overlap + ONNX keyframe | 387.999 | 0.883 | 1.100 |
| Compact encoded overlap + previous appearance | 400.414 | 1.065 | 1.252 |

The finished column uses the unchanged standard expression + 60% ONNX route.
These aligned pixel-change ratios are temporal diagnostics, **not identity
accuracy scores**. The tested compact route's finished detected eye-center jump
is approximately (0.69, 0.48) pixels, versus (4.74, 6.55) in the original finish.
Some facial softness remains. A separate scene-residual compositor was compared
privately; it is not part of this continuation version or the legacy face recipe.

The grouped four-way/two-style facial evaluation took 140.094 seconds with shared
prefix inference. Do not report that as an independent per-video latency.
All paid raw inputs and prior outputs remain unchanged in ignored local storage.
The compact checkpoint test used decoded paid H264 frames because the original
sampler's full raw latent history was not saved; its exact raw float appearance
frame was restored explicitly. This limits the experiment's generality.

Five checkpoint tests, five appearance tests, type/build checks and focused
protocol checks passed. The full Studio run passed 414 checks and exposed one
stale guard fixture; after correcting it, all five targeted guard/assembly/repaint
checks passed. Old/new compilers produced identical graphs in 23 valid positions
from 17 saved legacy settings, and identical errors in 20 invalid positions.

Only the four Viggle and twelve existing face files were downloaded onto the
user-selected A6000. No Imagen stack was required. Compute was independently
confirmed exited/stopped after output recovery; the five-minute idle preference
was restored and retained storage remains billed. No 40 GB or 24 GB live v3
benchmark has been performed in this block.
