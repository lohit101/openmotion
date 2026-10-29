# Remotion: an edited reference from later in the shot

An edited reference can now belong to a later frame of a **continuous shot**. The selected frame is the common starting appearance for two independent Viggle directions. Earlier source motion is reversed and generated away from that reference, then reversed back. Later motion is generated normally. The final video has the selected clip's original order, duration and audio.

## Controls

In **Advanced settings → Reference frame position**, choose **Later in clip · backward + forward**. Match the source preview to the edited reference using the frame slider, arrow buttons or exact source time. The timestamp is absolute within the uploaded video; the adjacent frame index/time is relative to the selected trim. A known Imagen source frame carries its exact timestamp automatically, while an external image requires the user's matching selection. There is no automatic visual timestamp guessing.

**Use in Remotion** preserves a matching existing trim instead of moving its beginning to the photo's timestamp. If necessary, it proposes a five-second selection around that moment. The selected reference must be inside the trim and at least four output frames from either edge. Invalid selections require correction; the app does not move an anchor silently or add frames. At-the-beginning selection keeps the existing route. Selection does not download weights or start compute.

## Frozen contract and paid work

New jobs record `anchoredVideo.version: bidirectional-v1`, an output-frame anchor, original/source/reference hashes and two linked directional jobs. Historical jobs do not acquire this mode on resume.

For a selected clip of `T` frames and reference index `A`:

- Backward input is the exact decoded source range `A … 0`, with `A + 1` frames.
- Forward input is `A … T − 1`, with `T − A` frames.
- Both begin with the same supplied edited reference. They run sequentially on the same GPU.
- Assembly reverses the generated backward branch, removes only its duplicated anchor, then appends the complete forward branch. The forward branch supplies the single retained anchor.

Local directional inputs and the assembly master use FFV1. Every decoded YUV420 frame is SHA-256 checked against its expected source/branch frame. All outputs must have exact counts, native 24 fps and zero video start timestamps. A changed source, wrong range or mismatched receipt stops recovery; no padding, crossfading or regenerated paid prefix is substituted. The lossless master is video-only to avoid AAC priming offsets. The playable H.264 CRF 16 output copies the prepared source's audio once; it is not mathematically lossless.

A long direction retains its existing versioned Viggle segmentation, five-frame motion anchors and end-aligned overlap rules. Optional Imagen face refresh operates within each direction using the frozen character/views and image recipe. Optional facial consistency runs **once after final assembly in chronological order**, using the original prepared source for expressions and the fixed edited reference for identity. It never interprets reversed audio as the performance source.

The file list and segment count use the actual directional ranges. A clip longer than five seconds can still have two single-window directions; that case does not require Qwen for a nonexistent boundary edit. Exact 720p keeps the existing patch-aligned native render and graph export downsampling; assembly validates and preserves the separate frozen export canvas without another resize.

The common parent appears in Library, recent creations and alerts. Internal directions stay accessible through **Run details → Later-frame reference → Inspect saved branch**, with actual native graphs, anchors, repaints and receipts. The parent's directional export includes the real branch graphs. A separate lossless master download preserves branch pixels before facial finishing.

## Recovery

Each successful directional video is downloaded and hash-bound before advancing. An interrupted later branch checks its own native queue/history/receipt and reuses an already saved earlier branch. A missing paid request requires explicit retry. Cancellation targets the active native direction and any inline Imagen child, not an invented parent prompt. GPU idle pause remains blocked throughout rendering, transfers and face finishing.

When both directional videos are local, joining can finish offline. If facial consistency was selected, GPU work is still required until that stage is downloaded; afterward local verification can finish offline. The parent reaches 100% only when the playable result is saved. Its single progress indicator retains saved directional progress on resume; native stage details remain in the expanded view.

## Limits

This is an alternative temporal starting point, not a new tracking or occlusion model. It does not detect hard cuts, invent missing views, enforce pixel-perfect hand motion or guarantee identity/gaze. Use a clear edited frame from the same continuous shot; separate cuts into different clips. A hand-covered opening can benefit from a later visible face, but generated fingers and foreground interactions still need review. Both directions contain the anchor during inference, so later-reference generation adds a second request and may add a sampling window. Long directions and an optional boundary image edit add their own measured work.

Live runs, quality review, checks and cost estimates are recorded in [the validation report](validation/later-frame-reference-20261029.md).
