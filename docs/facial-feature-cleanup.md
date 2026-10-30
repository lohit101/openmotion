# Complete facial feature ownership

New Remotion jobs with facial finishing and scene matching selected can use
**Clean eye and eyebrow edges** (`source-face-v3`). It fixes the case where a
source hair mask cuts into the replacement's eye and the old open eye remains
above the corrected blink. It also removes the detached eyebrow visible in the
reported late frame. Standard and Regional remain the user's selected profiles.

The new route is a compositing correction, not a promise of perfect likeness.
Open-eye detail remains soft in parts of the evaluated clips. It does not lock
facial anatomy or guarantee exact gaze, and uncertain faces are still preserved.
The broader face-consistency goal remains active.

## Frozen processing route

1. Keep the accepted source-video PerformRecast expression route. No broad
   reference-expression calibration is applied: that comparison improved some
   eyes but changed resting gaze on the portrait clip.
2. Apply the original fixed donor through the existing Hyperswap 512 pixel boost.
   Blend identity at 60% before the final permission mask, so a soft mask does not
   attenuate the identity correction twice.
3. Parse the actual generated and corrected faces with BiseNet ResNet34. Own the
   complete visible eye/brow/mouth features, including their old positions. Only
   an exact feature witness can override a false XSeg hole. Do not expand that
   witness into foreground or project the source person's hair matte onto a
   different replacement hairstyle.
4. Preserve target hair, glasses and non-face labels. Feather inward from the
   actual target face boundary. A nearest-neighbour support mask prevents a
   subpixel transform from leaking permission across classified occluders.
5. Restore up to 65% registered eye RGB from the same raw animation inside the
   edited eye interiors. Both visible semantic eye area and source 68-point eye
   opening gate it; a closed source eye receives no texture. Forward/backward
   flow rejects uncertain correspondence. This restores existing pixels and
   cannot invent a correct iris or gaze.
6. Match bounded low-frequency skin illumination and replace one corrected
   feature plane, preserving exact scene pixels outside projected permission.
   The playable MP4 is compressed at CRF 16; exact protection applies before
   that export, not to every compressed output pixel.

Model sessions use CUDA with execution fallback disabled. Detection, geometric
gates, optical flow, masks and encoding still include host CPU work. There is no
audio-driven lip synthesis, new video sampling, Imagen repaint or hair/body
repainting in this finishing stage.

## Models, readiness and recovery

The additional parser is **93,632,546 bytes** and pinned to the official
FaceFusion model repository revision and SHA256 in
`config/facial-consistency-cleanup-models.lock.json`. It is required only for v3.
The shared twelve-file facial stack stays unchanged. Selection and Generate
never download models or start compute; the existing per-option download action
prepares the selected files explicitly. A separate capability hash distinguishes
updated cleanup tools from the older installed runtime.

The v3 readiness marker also binds the installed worker code, so an older worker
cannot report the updated capability ready. Poll and cancel remain available for
an owned partial-upload directory without a request file; they check the exact
worker handle rather than requiring inference inputs to exist.

Explicit tool preparation uploads code and reuses weights. The validation reused
the already-present parser by a checksum-verified hard link, without a new model
transfer. Existing model terms remain separate; the upstream parser metadata
identifies yakhyo/MIT and does not clear the whole facial stack for a hosted app.

New jobs freeze v3 and its fingerprint. Turning cleanup off retains v2 scene
finishing; turning scene matching off retains v1. Existing paid jobs retain their
saved version and hashes:

- v1: `ef8f273a320b6d34c5efccf690610ad92f1aac0fdb9c4d60c4906557ade5b419`
- v2: `3952a4da82fcb2284788137279c7716102bba1e5755b2f6968502dc38dec3c08`

Preflight initializes the actual selected models before new video sampling.
Per-frame receipts, checksum validation, same-rental recovery, remote cancellation
confirmation, offline completion of downloaded results and idle-pause protection
remain in place. v3 additionally validates the CUDA parser and per-frame texture
gates/protection metadata before accepting the finished video.

## Managed GPU evaluation

Four isolated tests used the actual TypeScript managed backend and Python worker,
reusing three immutable paid animations. No new H3/Imagen inference was submitted.
The full frame counts, original audio packet sequences and media hashes are
verified. Raw animations, original finished outputs and test results are retained.

| Existing clip / selected profile | Frames | Face worker | Managed finishing operation |
| --- | ---: | ---: | ---: |
| Hair across eyes / Standard | 355 | 149.495 s | 224.063 s |
| Continuity clip / Standard | 216 | 102.006 s | 165.868 s |
| Portrait/hand clip / Standard | 240 | 90.824 s | 152.252 s |
| Hair across eyes / Regional | 355 | 149.613 s | 212.507 s |

The worker timings include detection, correction, receipts and export. The
managed timings also include reference preflight, input validation and transfers.
Neither column measures complete video Generate time. The original matched
Standard workers took 110.337, 70.995 and 66.576 seconds respectively; this cleanup
adds roughly 24–39 worker seconds on these clips, rather than accelerating them.

All 355/216/355 frames were processed in their respective runs. The portrait run
processed 230 and preserved ten uncertain detections (124–127, 147–149, 186–188),
the same ranges retained before this change. Counts are processing diagnostics,
not identity or realism scores. The private viewer exposes those preserved ranges.

Exact private PNGs were compacted only after a lossless RGB archive reproduced
every decoded frame and original PNG checksum. Older private archives were moved
to this Mac with checksum verification to make working room; paid media and
model weights were not removed. This private cache housekeeping is not a new
automatic product deletion policy.

The A6000 was independently confirmed exited/stopped at **01:14:21 UTC** after
the batch. The first stop response was inconclusive; the independent check waited
until actual status was exited and intended status stopped. Five-minute idle
pause was restored. Quoted-rate session cost is recorded in the sanitized
validation report, including the approximately 1.27 GB archive transfer. It is an
estimate, not a provider invoice.

A subsequent code-only readiness/recovery check reused all thirteen installed
files without inference or model downloads. Both runtime capabilities passed,
and a never-submitted partial request could be polled and cancelled. After that
check, the same rental was independently confirmed **exited/stopped at 01:36:09
UTC**, with five-minute idle pause restored. This adds about **1.54¢ compute**
and **0.06¢ storage** at the saved rates, excluding small code/media transfers.

Validation includes 424 Studio tests, ten cleanup Python checks, two partial
request protocol checks, eight legacy expression/compositor checks, seven model
profile checks, type checking and the production build. Browser inspection
verified the new control alongside the user's unchanged Standard profile.

All comparisons are available in the local **Face continuity · private
comparisons** page at `http://127.0.0.1:3012/artifacts/`. `Clean features · Standard`
and `Clean features · Regional` are distinct from the earlier calibration
experiments. Review in motion, at full frame and around the exact issue frames;
an inspected still is not a universal quality pass.

See [the initial evaluation](facial-artifact-evaluation.md) for the root-cause
comparisons and primary upstream references, and the sanitized evidence in
`docs/validation/facial-feature-cleanup-20261030.json`.
