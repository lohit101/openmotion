# Source-relative character framing

## Observed defect

The latest local completed render used the new descriptive prompt at 704 × 1248, 24 fps, 1.5 seconds and six steps, with relighting disabled. It retained more of the source room, but the replacement was still much smaller and farther left. Compared at matching timestamps, five face detections measured output head scale at 0.603–0.641 of the source and horizontal center offsets of −0.146 to −0.167 frame widths. These measure apparent face size and placement, not physical camera distance, identity similarity, whole-body pose or lighting quality.

The original reference shows nearly a whole body. `SwapFitReference` fitted it into the output canvas at scale 0.688 while the source is a close upper-body shot. The native SCAIL graph conditions on source RGB/masks and reference latents; its mask is not a hard per-frame geometric constraint. A prompt alone did not remove this mismatch.

The synchronized comparisons and originals are retained under ignored `backups/geometry-fix-20261024/`. `validation/source-framing.json` records sanitized measurements. The rented instance was confirmed stopped before implementation; no new render or paid restart was submitted.

## Change in Recast Generate

New **Character swap** jobs receive `framingVersion: face-v1`. Before any GPU upload or sampling:

1. FFmpeg prepares the chosen source range at the actual output canvas and frame rate.
2. A local CPU YuNet detector finds one clear reference face and the earliest clear source face within the first eight prepared frames. Its 232,589-byte model is pinned by revision and SHA256 in `config/geometry-model.lock.json`.
3. The preparer computes one uniform scale from the face-box area ratio and translation from the two face-box centers. It transforms the **entire reference image** into an output-sized PNG. There is no separate face/body stretching, rotation or generated-output zoom.
4. The original reference stays unchanged. The aligned PNG and its transform, input/output hashes and anchor-frame index stay in the job folder. A partial upload retry reuses that exact preparation; changed or missing cached data fails rather than silently replacing conditioning. All continuation segments use the same uploaded reference.
5. Existing ComfyUI SAM tracking processes the aligned reference. Its image and identity mask therefore share geometry, and `SwapFitReference` receives an image already at the target canvas size. The pinned GPU nodes and generation weights are unchanged.

For the reported inputs, the new scale is 1.3943 from the original reference, about 2.03 times the old letterboxed scale. This produces a close upper-body reference at the source's rightward placement. This is a **conditioning preparation preview**, not a newly generated result.

Missing/ambiguous faces, implausible transforms or unsupported multiple actor indices fail locally before GPU inputs are uploaded or a generation is submitted. This first implementation requires a single unambiguous visible face and actor index 0. Choose a clip start with a clear face; a whole-body bounding-box fallback is intentionally not used for cropped shots. Motion-transfer jobs keep their reference-scene behavior. Historical jobs without the version retain their original input behavior when resumed; use **Reuse settings** to create a new job with the correction.

## Output check and UI

After generation, a CPU check compares five synchronized source/output samples. It warns when apparent head scale falls outside 0.85–1.15 of the source or face-center displacement exceeds 4% of the frame diagonal. Missing/ambiguous sampled faces produce an unverified status. These tolerances are review heuristics, not perceptual quality scores.

The app keeps completed media and shows an amber status, a yellow framing notice, a **Compare source** action and a deduplicated warning toast when appropriate. It never automatically rerenders or stops compute for a quality warning. Render details can open the actual aligned reference through a local read-only endpoint. An unavailable output checker preserves the render with an explicit unverified warning.

The known bad output is flagged in all five samples; an identical-video control passes. Uniform-transform, ambiguity, cache integrity, pre-upload failure, mode/legacy behavior, continuation reuse, cancellation and saved-output warning paths are covered by CPU/protocol tests. Interrupted video preparation writes to a temporary file and atomically replaces the prepared source only on success; resuming can reuse a source only with completed hash-checked framing metadata. Seventy-two app tests and 32 Python tests passed, along with TypeScript, workflow schema checks and the production build.

## Setup and retry

The normal launcher runs the small CPU setup before starting Studio:

```bash
bash scripts/studio.sh
```

It creates `.local/geometry-venv`, installs locked NumPy/OpenCV dependencies, verifies the tiny detector, retains its MIT notice, and contacts no GPU or provider. The rental preflight checks readiness before creating a paid instance. It is already installed on this Mac.

Refresh Studio, select **Character swap**, and generate a **new** job after deliberately starting/connecting the retained instance. The existing instance needs no ComfyUI reinstall for this change. Keep the same source, reference, source window, seed and sampler when comparing. Do not enable extra LoRAs just to compensate for framing.

For direct ComfyUI use, the raw graph still fits whatever reference it receives. Prepare the source range/canvas first, then use the same local CLI to produce the aligned PNG and upload that PNG as the reference:

```bash
.local/geometry-venv/bin/python scripts/reference_geometry.py prepare \
  --source /absolute/path/prepared-source.mp4 \
  --reference /absolute/path/original-reference.jpg \
  --output /absolute/path/aligned-reference.png \
  --report /absolute/path/reference-framing.json \
  --model .local/geometry-models/face_detection_yunet_2023mar.onnx
```

A user-authorized RTX 3090 comparison has now tested the correction on the same 1.5-second input, reference, seed, prompt and all generation settings as the last uncorrected run. Prepared source bytes are identical. The corrected render exported 36 frames at 704 × 1248 and 24 fps with source audio in 342.233 seconds, and is saved in the library as **Source framing test · same inputs · 704p / 24 fps**. The retained instance was confirmed stopped afterward; the saved video remains playable offline.

All five sampled face checks passed. Head scale improved from 0.603–0.641 of the source to 0.916–1.006, and the maximum horizontal face-center error was about 4.64 pixels on a 704-pixel-wide canvas. Synchronized visual comparison shows the close upper-body crop and rightward placement now following the source. Some polished skin, oversized/smoothed fingers, imperfect shoulder contact and generated cloth folds remain. The room is broadly consistent but still regenerated. See `validation/source-framing-gpu.json`; raw comparison media and mask previews remain in ignored backups.

This is evidence from one short single-person shot. The model can still regenerate surroundings, alter anatomy or drift in later frames. Face-box checks are not identity, whole-body pose, lighting or occlusion scores. Aligned reference conditioning addresses the observed bias; it is not a mathematical lock on every output pixel, pose or camera-distance cue. Further changes should follow the user's review rather than automatically submitting another paid render.
