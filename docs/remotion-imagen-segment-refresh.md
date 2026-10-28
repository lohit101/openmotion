# Imagen face refresh between Remotion segments

Implemented on 2026-10-29, after the separate Characters/Imagen commit `280715b`, in the order requested by the user. New runs opt into a versioned `imagen-face-v1` contract. Existing paid jobs, settings, graphs, original references and generated pixels are not migrated.

## Using it

1. Save a character in **Characters** with separate body and facial sheets. Choose one clear body view and one face/head view; these are asset-bound crops, not an automatic interpretation of every angle in a sheet.
2. In Remotion, select a video and trim its desired interval. Enable **Character consistency → Refresh face between segments**, choose the character/views, and choose **Prepare starting frame in Imagen**.
3. Paint the target person, generate and review the starting photo in Imagen. **Use in Remotion** carries the completed photo, character snapshot and selected views back; this enables refresh automatically for a saved-character photo. It preserves the existing selected duration when the video and start match.
4. Generate the video. More than 124 output frames at native 24 fps requires multiple saved windows. One-window jobs do not require Qwen files for boundary edits. Long refresh jobs require the four native Qwen/Turbo files as well as the existing four Viggle files, through explicit Downloads controls. Selection and Generate never download them.

Existing externally repainted starting frames can use the toggle and a manually selected saved character. The user must ensure the frame corresponds to the selected clip start. A known Imagen frame from another video/start is rejected. A later frame is not a supported arbitrary temporal anchor: Viggle still treats the supplied frame as the beginning. Trim to that frame for now; backward animation remains disabled following the earlier rollback.

## What each boundary does

- Segment one uses the approved supplied frame, without another paid image edit.
- Before a later segment, read the previous segment's actual final **raw** generated frame from its locally saved `last-frame-v2` safetensors continuation file. Strictly validate job, version, dimensions, frame range, tensor dtype/shape/bounds and finite pixels. On the usual five-frame overlap this is the last anchor image; larger terminal overlaps require the separate appearance tensor. An MP4 screenshot or a v1 anchor is never silently substituted.
- Locate one sufficiently clear face using the already installed local geometry runtime. Build a bounded soft head/face scope. Run the accepted native Qwen INT8/Turbo Imagen recipe: 1 MP, eight Euler/simple steps, CFG 1, fixed seed 1583893113, frozen selected body/face views. No BFS head/body/outfit, Union, relight or local identity pass is added.
- The existing body-only conditioning is followed by explicit facial identity, expression and foreground-preservation instructions. After normal mask growth/gap filling, cap permission to the saved head scope. Final compositing preserves exact decoded target pixels outside that scope. This does not guarantee that Qwen preserves every feature or occluder inside it.
- Save the child image, source scope, inputs, graph, native receipt and SHA-256 reference, then upload that exact saved image as the next Viggle appearance reference. The separate five-frame motion anchors and earlier accepted video frames stay unchanged. The new reference is guarded against stale segment indices.

An absent, small or uncertain face skips photo inference and carries the exact raw frame with a saved warning and yellow toast. Multiple detected faces pause the boundary rather than guessing the subject. These controls do not solve hard cuts, tracking loss, covered openings or identity drift inside a segment.

## Recovery and controls

The child image runs inline in the shared serialized GPU queue. Parent progress includes its actual stage/counters; the five-minute idle pause remains blocked throughout generation and saving. Intermediate completed photos do not produce misleading final-video-ready alerts. Each child and parent has Library run details, and the parent's detail view links the actual target, face scope, repaint and image settings/receipt.

Receipts and complete local images are recovered without new inference. Download interruption does not mark a healthy GPU disconnected. A missing paid request requires explicit retry; a native failed photo retains its original error receipt. An explicit retry creates a new linked child after checking the old GPU queue/history, without resampling the video prefix. Cancelling the parent also cancels its active child. Completed or locally recoverable photos are not eligible for another paid retry.

Frozen character revision, sheets, crops and image settings are independent of subsequent library edits or archiving. Before accepting a long job, validate the saved character files and local geometry tools as well as the exact required GPU inventory. A missing prerequisite fails before the first paid window.

## Costs and validation limits

Each eligible boundary adds **one eight-step image edit**, model switching/loading, input/output transfer and local preparation. Qwen is already part of Imagen; no new model family or optional adapters were introduced. Extra latency and cost on the rented GPU have not yet been measured. The prior accepted full-photo duration is not a benchmark for this combined workflow.

Offline validation and raw-frame auditing are recorded in [the validation report](validation/remotion-imagen-refresh-20261029.md). No fresh paid inference was submitted for this implementation. A matched GPU visual comparison is still required before claiming better identity retention, reduced drift or seamless segment joins.
