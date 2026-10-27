# Longer Viggle videos

Recast now coordinates Viggle character replacement for one continuous shot of up to **30 seconds at 24 fps**. Open the uploaded motion video, extend its trim selection, and choose **Use this clip**. New uploads initially select five seconds, so uploading a long file does not silently request a longer paid render. The editor shows the planned segment count before Generate; live progress shows the current segment and duration already saved locally.

This requires the two updated project helper nodes, `RecastViggleAnchor` and `RecastViggleSaveContext`. On an existing GPU, use **GPU cloud → My instances → Connect / retry setup** to synchronize the small runtime package; setup waits for the existing queue to finish before reloading changed code. No additional weights are required. The API rejects long jobs on older runtimes before queueing inference. GPU startup and model-download choices are unchanged.

## Continuation contract

The implementation follows the five-frame anchor method in the [pinned community Viggle code](https://github.com/Saganaki22/ComfyUI-Viggle-Animate-H3/blob/6ae081af5b3175f99ef7cddebd5dfaf93390ab70/nodes.py). The new helpers adapt that method to Recast's existing per-segment submission, media download and receipt recovery. They do not introduce another motion model or multiple character-sheet conditioning.

- Each GPU prompt loads at most 124 source frames. Generation lengths remain on H3's 17k+5 grid, and starts stay on the same temporal phase. The final full-size generation window ends at the padded source boundary; only actual source frames are exported.
- Five previously generated frames at the **next window's exact start** are stored losslessly in a safetensors anchor. The H3 VAE re-encodes those five frames into two video latents. A native nested video/audio noise mask pins those two video latents during core sampling; the silent audio half is not pinned.
- Anchors are checked against job ID, continuation version, source start/end, 24 fps, dimensions and finite tensor contents before sampling. Wan's unrelated context is never accepted as H3 context.
- All already accepted frames are removed from each continuation's export. The last overlap can be much longer than five frames; it provides warm-up without replacing previously saved output. There is no crossfade, frame duplication, interpolation or speed change.
- Every window uses the same original repainted character frame and quality recipe. Automatic Klein preparation, when explicitly selected and installed, runs only for the first window. Its saved conditioning frame is reused for every subsequent one. The separate Qwen photo workflow remains separate.
- Completed videos are concatenated locally and receive one audio track from the selected original source interval. Native continuation and optional 720p export keep their separate canvas dimensions.

For example, 720 requested frames (30 seconds) use seven windows. The last starts at frame 612, overlaps 107 already accepted frames, and adds only the final requested frame after warm-up. All seven generate at most 124 frames. This means up to 868 generated frames for 720 exported frames; duration-based cost estimates must include overlap, padding, VAE work, loading and transfer time. A longer clip is not priced like one five-second render.

## Recovery and storage

Successful ComfyUI histories are written atomically on the Mac **before** downloading previews, video or anchors. Each segment's video and five-frame anchor are downloaded before completed-frame progress advances. If a transfer fails and ComfyUI later loses in-memory history, Check & resume uses the local receipt and existing media rather than submitting that completed prompt again. Ambiguous/missing GPU requests still require the existing explicit retry choice.

The first conditioning image, every submitted graph, successful histories, segments and anchors remain in the ignored local job directory. The GPU also retains its continuation anchor files. Five float32 RGB frames are approximately 25 MB at 480×864 or 58 MB at the native 736×1312 HD canvas, excluding small headers. This is per saved anchor, not new model storage. Model manifests, LoRA choices and model retirement remain unchanged.

Resuming uses the same existing GPU disk and uploaded inputs. Copying a run onto a different/destroyed rental is not implemented by this feature; a local anchor backup alone does not make another host ready.

## Validation boundary

The automated protocol fixture uses FFmpeg passthrough, not AI inference. It verifies 30-second/720-frame export, seven saved segments, native 24 fps, a single original audio track, nonzero source trim, a nearly fully overlapped final window, original-frame reuse, cached-receipt recovery after an anchor transfer fails, and rejection of outdated nodes before paid submission.

Real ComfyUI classes and CPU tensors verify anchor extraction/re-encoding interfaces, native nested noise masks, preservation of the input latent and wrong-job/offset/canvas/fps rejection. These checks do **not** establish visual continuity, identity stability, render speed or peak GPU memory. Unlike upstream's assembled-latent final decode, Recast decodes and saves each bounded window separately. Join lighting/motion and identity through turns need visual review on a real GPU before claiming production quality. Use one continuous shot; hard cuts and multiple scenes still need separately prepared references.
