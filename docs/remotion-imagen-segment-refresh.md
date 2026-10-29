# Imagen face refresh between Remotion segments

Implemented on 2026-10-29, after the separate Characters/Imagen commit `280715b`, in the order requested by the user. New runs opt into a versioned `imagen-face-v1` contract. Existing paid jobs, settings, graphs, original references and generated pixels are not migrated.

## Using it

1. Save a character in **Characters** with separate body and facial sheets. Choose one clear body view and one face/head view; these are asset-bound crops, not an automatic interpretation of every angle in a sheet.
2. In Remotion, select a video and trim its desired interval. Enable **Character consistency → Refresh face between segments**, choose the character/views, and choose **Prepare starting frame in Imagen**.
3. Paint the target person, generate and review the starting photo in Imagen. **Use in Remotion** carries the completed photo, character snapshot and selected views back; this enables refresh automatically for a saved-character photo. It preserves a matching selected trim and carries the photo's actual source timestamp.
4. Generate the video. More than 124 output frames at native 24 fps requires multiple saved windows. One-window jobs do not require Qwen files for boundary edits. Long refresh jobs require the four native Qwen/Turbo files as well as the existing four Viggle files, through explicit Downloads controls. Selection and Generate never download them.

Existing externally repainted starting frames can use the toggle and a manually selected saved character. The user must ensure the reference matches the selected source moment. Known Imagen provenance is checked against that moment and video. The subsequently authorized [later-frame reference mode](later-frame-reference.md) supports a later frame with separate backward/forward directions. Its long directions each retain this same segmentation and refresh contract; this supersedes the earlier restriction to the clip's first frame. It does not restore the rejected timed-guide or foreground-overlay experiments.

## What each boundary does

- Segment one uses the approved supplied frame, without another paid image edit.
- Before a later segment, read the previous segment's actual final **raw** generated frame from its locally saved `last-frame-v2` safetensors continuation file. Strictly validate job, version, dimensions, frame range, tensor dtype/shape/bounds and finite pixels. On the usual five-frame overlap this is the last anchor image; larger terminal overlaps require the separate appearance tensor. An MP4 screenshot or a v1 anchor is never silently substituted.
- Locate one sufficiently clear face using the already installed local geometry runtime. Build a bounded soft head/face scope. Run the accepted native Qwen INT8/Turbo Imagen recipe: 1 MP, eight Euler/simple steps, CFG 1, fixed seed 1583893113, frozen selected body/face views. No BFS head/body/outfit, Union, relight or local identity pass is added.
- New profiles freeze `imageRecipe: concise-v1` and a direct face-only instruction, following the [Imagen consistency evaluation](imagen-consistency-20261029.md). Historical profiles without that marker retain their exact original body-only conditioning followed by facial identity, expression and foreground-preservation instructions. After normal mask growth/gap filling, cap permission to the saved head scope. Final compositing preserves exact decoded target pixels outside that scope. This does not guarantee that Qwen preserves every feature or occluder inside it.
- Save the child image, source scope, inputs, graph, native receipt and SHA-256 reference, then upload that exact saved image as the next Viggle appearance reference. The separate five-frame motion anchors and earlier accepted video frames stay unchanged. The new reference is guarded against stale segment indices.

An absent, small or uncertain face skips photo inference and carries the exact raw frame with a saved warning and yellow toast. Multiple detected faces pause the boundary rather than guessing the subject. These controls do not solve hard cuts, tracking loss, covered openings or identity drift inside a segment.

## Recovery and controls

The child image runs inline in the shared serialized GPU queue. Parent progress includes its actual stage/counters; the five-minute idle pause remains blocked throughout generation and saving. Intermediate completed photos do not produce misleading final-video-ready alerts. Each child and parent has Library run details, and the parent's detail view links the actual target, face scope, repaint and image settings/receipt.

Receipts and complete local images are recovered without new inference. Download interruption does not mark a healthy GPU disconnected. A missing paid request requires explicit retry; a native failed photo retains its original error receipt. An explicit retry creates a new linked child after checking the old GPU queue/history, without resampling the video prefix. Cancelling the parent also cancels its active child. Completed or locally recoverable photos are not eligible for another paid retry.

Frozen character revision, sheets, crops and image settings are independent of subsequent library edits or archiving. Before accepting a long job, validate the saved character files and local geometry tools as well as the exact required GPU inventory. A missing prerequisite fails before the first paid window.

## Costs and validation limits

Each eligible boundary adds **one eight-step image edit**, model switching/loading, input/output transfer and local preparation. Qwen is already part of Imagen; no new model family or optional adapters were introduced. The later combined RTX PRO 5000 validation measured a 19.820-second child photo inside a complete nine-second/704p later-reference run that took 754.204 seconds including all three native video windows and automatic face finishing. The child timing excludes other boundary preparation/model-switching overhead and is already included in the parent time. See [the live report](validation/later-frame-reference-20261029.md).

The initial offline implementation and raw-frame audit are recorded in [the original validation report](validation/remotion-imagen-refresh-20261029.md). The subsequent live test verified the protected scope and complete pipeline, but Qwen still changed the boundary expression and the final face pass softened detail. A matched refresh-on/off visual comparison is still required before claiming a general improvement in identity retention or seamless joins.
