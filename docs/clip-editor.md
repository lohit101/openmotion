# Clip editor

## Kie workspace editor

The Kie app now includes **Clip editor** in desktop and mobile navigation. Open a Library video and choose **Add to editor**, or import/drop local videos. The editor uses its own browser draft (`recast-kie-clip-editor-v2`) and a local FFmpeg queue; it works without a Kie key, credits, GPU or model download.

Alongside the existing inline trims and joins, select a clip to set **Fade in**, **Fade out**, **Blur in** or **Blur out** in seconds. Fades start/end at black; blur in clears the picture and blur out softens it. These edge effects preserve the timeline length. Each effect is capped at five seconds and half the selected clip's duration. **Split at playhead** makes two frame-aligned clips without adding or dropping frames.

**Separate audio** mutes that clip's attached soundtrack and puts its selected audio interval on an independent timeline lane at the same position. Drag the audio body to move it; drag either edge to trim it. The inline audio inspector also provides exact source ranges, timeline position, volume, mute and independent sound fades. Detached sound stays independent when video clips are subsequently trimmed or reordered. Audio beyond the end of the video is omitted. Up to sixteen independent audio clips can be mixed.

**Add audio** imports MP3, M4A, WAV and other readable audio files up to 100 MB/ten minutes. Original files remain local; a separate AAC preview may be created. The export reads the original audio. Video imports use a dedicated editor route and do not replace Remotion's motion/reference inputs.

**High-quality MP4** is the Kie editor default: H.264 CRF 16 with AAC audio, source-sized output and no automatic upscaling or cropping. Mixed dimensions are centered with padding; MP4 dimensions round up to even pixels where necessary. Effects/audio mixing require this explicitly re-encoded format. Lossless master remains available for plain trims and joins. The local result and an editable `timeline-v2` receipt record actual source ranges, effects and audio tracks. Completion/failure alerts use the existing toast/sound preferences. Download the MP4 for upload to Instagram; there is no Instagram login or automatic publishing integration.

The original GPU checkout's editor keeps its existing default and export behavior. The Kie extension does not enable any GPU/image workflow.

## Original trim and join editor

Open **Clip editor** in the sidebar, or open a saved video in Library and choose **Add to editor**. Drag video files from your computer onto the timeline, use **Add videos** to choose one or more files, or add completed Library clips. A highlighted insertion point shows where dropped clips will go, in file order. Then:

1. Drag a clip's left/right timeline edge to trim. Trims snap to decoded frame boundaries; no separate trim dialog opens. Focus an edge and use arrows for one frame, or Shift + arrows for ten.
2. Drag a clip's body to reorder it, or use the earlier/later buttons under the timeline. Reset restores the selected clip's original range; Remove only removes it from the draft.
3. Preview the sequence, name it and select an export format. Zoom and the timeline ruler help position cuts.
4. Export locally. Progress and the finished **Download** action appear immediately below the export controls. Completion/failure toasts report the outcome, and the finished video appears in Library with its source order/ranges and export settings. **Edit timeline** reopens the composition. Original video/image generation drafts remain separate.

The current limit is 32 clips and ten minutes. Draft clips and trim ranges stay in this browser's storage. Exports and their receipts stay in local Studio data and run independently of the GPU queue. They use FFmpeg on this computer, without model downloads, inference or rental actions.

**Imported** keeps your explicitly added local files available across reloads, separately from generated Library creations. Upload progress uses transferred bytes; metadata preparation follows the upload. Each file can be up to 512 MB, with a readable constant frame rate. Supported decoded formats retain the same lossless export checks as Library clips. Right-angle phone orientation is respected. Other video codecs get a separate playable preview when needed; exports always read the untouched original. Importing never changes image/video generation inputs or uses GPU credits. An imported-only edit records local source IDs/ranges and export settings, without a made-up character reference or AI sampling report.

## Quality and formats

**Lossless master** preserves decoded source video samples at the chosen frame ranges. A single whole compatible MP4 is copied directly; matching whole silent clips can be joined by stream copy. Multiple clips with audio use the exact decoded-audio path to avoid AAC delay/padding at joins.

Frame-accurate cuts and other lossless joins produce an FFV1 MKV master with PCM float audio, plus an H.264 MP4 preview for the browser. The normal Download action returns the master, not the preview. Re-editing this result reads the master. The preview is compressed and is labelled accordingly in saved run details. Lossless files can be much larger, and the exporter checks local free space before starting.

Lossless export currently requires constant, matching frame rates, pixel/color formats and compatible audio sample rates/channel layouts. Different dimensions are centered on a canvas large enough for every input, with padding rather than scaling/cropping. The tool reports incompatible mixes; it never silently changes them to a lossy export.

**High-quality MP4** is an explicit H.264 CRF 16 / AAC alternative for convenient playback and smaller files. It re-encodes and is not mathematically lossless. Mixed frame rates normalize to the highest selected source rate. Neither mode adds transitions, filters, upscaling or AI processing.

FFmpeg documents [stream copy and encoding](https://ffmpeg.org/ffmpeg.html), [concat compatibility](https://ffmpeg.org/ffmpeg-all.html#concat), and the [FFV1 lossless format](https://github.com/FFmpeg/FFV1/blob/master/ffv1.md). These are format capabilities; validation of this implementation is recorded separately.
