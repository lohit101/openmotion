# Clip editor

Open **Clip editor** in the sidebar, or open a saved video in Library and choose **Add to editor**. Add one or more completed local videos, then:

1. Drag a clip's left/right timeline edge to trim. Trims snap to decoded frame boundaries; no separate trim dialog opens. Focus an edge and use arrows for one frame, or Shift + arrows for ten.
2. Drag a clip's body to reorder it, or use the earlier/later buttons under the timeline. Reset restores the selected clip's original range; Remove only removes it from the draft.
3. Preview the sequence, name it and select an export format. Zoom and the timeline ruler help position cuts.
4. Export locally. The finished video appears in Library with its source order/ranges and export settings. **Edit timeline** reopens the composition. Original video/image generation drafts remain separate.

The current limit is 32 clips and ten minutes. Draft clips and trim ranges stay in this browser's storage. Exports and their receipts stay in local Studio data and run independently of the GPU queue. They use FFmpeg on this computer, without model downloads, inference or rental actions.

## Quality and formats

**Lossless master** preserves decoded source video samples at the chosen frame ranges. A single whole compatible MP4 is copied directly; matching whole silent clips can be joined by stream copy. Multiple clips with audio use the exact decoded-audio path to avoid AAC delay/padding at joins.

Frame-accurate cuts and other lossless joins produce an FFV1 MKV master with PCM float audio, plus an H.264 MP4 preview for the browser. The normal Download action returns the master, not the preview. Re-editing this result reads the master. The preview is compressed and is labelled accordingly in saved run details. Lossless files can be much larger, and the exporter checks local free space before starting.

Lossless export currently requires constant, matching frame rates, pixel/color formats and compatible audio sample rates/channel layouts. Different dimensions are centered on a canvas large enough for every input, with padding rather than scaling/cropping. The tool reports incompatible mixes; it never silently changes them to a lossy export.

**High-quality MP4** is an explicit H.264 CRF 16 / AAC alternative for convenient playback and smaller files. It re-encodes and is not mathematically lossless. Mixed frame rates normalize to the highest selected source rate. Neither mode adds transitions, filters, upscaling or AI processing.

FFmpeg documents [stream copy and encoding](https://ffmpeg.org/ffmpeg.html), [concat compatibility](https://ffmpeg.org/ffmpeg-all.html#concat), and the [FFV1 lossless format](https://github.com/FFmpeg/FFV1/blob/master/ffv1.md). These are format capabilities; validation of this implementation is recorded separately.
