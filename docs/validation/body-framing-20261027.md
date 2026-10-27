# Accepted character appearance and source framing

The user accepted the appearance of body test 01 and asked to undo the next experiment, changing only camera proximity if it could be done naturally. They subsequently relaxed exact proximity: a close source-frame match is sufficient. Original inputs, paid conditioning, raw stages and final images remain unchanged and local. No image was automatically sent to video.

| Result | Version | End-to-end time | Decision |
| --- | --- | ---: | --- |
| `8087fdb7-ac6f-47e8-a4db-98c1f20b96d3` | body-identity-v1 | 200.916 s | User accepted face, hair, outfit and physique. Framing remained too distant. |
| `18ed5ea8-9b10-4ce6-8765-d3ff6c1563be` | body-identity-v2 | 238.991 s | User rejected the changed face, hair and clothing. |
| `d97092c9-e30b-43e4-a48c-9a1694a2b192` | local foreground-scale-v1 derivative of test 01 | 0.598 s CPU | Saved separately as a closer-framing preview for user review. No model inference. |

Both paid tests used the user's RTX A6000 48 GB rental. The existing body, head and consistency adapters ran separately. The v2 experiment added source joints from pinned local DWPose, pure pose Union guidance at 0.65, Euler head sampling and a face-only blend. The final result retained the source bun/body/outfit instead of the accepted appearance. Its exact compiler and local pose profile remain available for historical reproducibility, off by default. Do not treat stronger structural guidance as a quality improvement on this pair.

The restored draft uses test 01's original target, full character reference, mask, custom garment/tattoo prompt, fixed seed 20261027, 2 MP, canonical body reference, native body/head sampling, illumination consistency, scene integration and CPU identity anchoring. `qwenBodyPose` is false. Selecting Whole character explicitly resets that hidden experimental flag and 2 MP detail. No extra Union dependency is required by the restored method.

## Local adjustment

`scripts/frame_image.py` accepts explicit local images, a reviewed person matte, edit allowance, existing face detector and scale. It uniformly scales the accepted foreground around its detected face center, translates to the target center and resamples premultiplied RGB/alpha. It does not regenerate identity, hair, clothing, body proportions or lighting. An approximate CPU-inpainted plate fills newly revealed background; source pixels outside the union of the original allowance and moved foreground are restored exactly. It cannot change leaning pose, expression or camera perspective.

Several trial scales were checked visually. The initial automatic matte missed part of an arm and included disconnected background regions, producing a visible ghost shoulder. Those candidates were discarded. A reviewed silhouette with a manually traced arm supplement removed that failure. The selected 1.41856349× uniform enlargement has:

- Detected head-size ratio: 0.98403× the source, versus 0.70494× before adjustment.
- Face-center displacement: (+9.02, +7.18) pixels on a 720×1280 frame.
- Maximum decoded source-pixel difference outside the effective allowance: 0.
- Remaining limitations: reconstructed background edges, inherited processed texture, unchanged viewpoint/pose. These measurements are framing diagnostics, never an identity score or proof of photorealism.

The matte and raw media stay under ignored `backups/body-consistency-20261027/framing/`. Both accepted original and closer preview are favorited in the Library. The latter is explicitly `origin: import`, with parent/result/source/mask hashes and a separate framing receipt. Its workflow link points to the parent's original graph, rather than claiming ComfyUI generated the resized output. The import helper verifies the parent and derivative hashes, rejects nonuniform scaling, deduplicates imports and never enters the GPU queue.

Example local operation, after explicitly preparing/reviewing a matte:

```sh
.local/geometry-venv/bin/python scripts/frame_image.py \
  --source /path/to/original.png --image /path/to/accepted.png \
  --matte /path/to/reviewed-person-matte.png --allowance /path/to/edit-mask.png \
  --folder /path/to/new-result --model .local/geometry-models/face_detection_yunet_2023mar.onnx \
  --scale 1.42
cd studio
npx tsx scripts/import-image-variant.ts \
  --parent ORIGINAL_JOB_ID --folder /path/to/new-result --title 'Closer source framing'
```

These helpers use the existing local OpenCV runtime and detector; they download no models. The matte remains an explicit reviewed input. This is a manual framing operation, not a validated automatic subject-segmentation feature.

## Resources and validation

The six-file photo stack downloaded 17.912 GB; the rejected pose comparison additionally downloaded the 7.551 GB Union file. At this host's $0.00260417/GB ingress rate those transfers estimate about $0.04665 and $0.01966 respectively, excluding setup dependencies and any retransfers. Compute was $0.333333/hour plus $0.017778/hour retained storage. The two inference intervals alone correspond to approximately $0.04290 including concurrent storage; this is not the full rental invoice or a claim that setup/idle time was free.

After both queues were empty, instance 57951739 was confirmed `exited`, intended state `stopped`, `computeStopped: true`. Model disk and all media remain; storage is still billed. The local framing comparison incurred no inference or model-transfer charge.

Validation: production build and TypeScript check pass; 23 image/compiler/import tests and two CPU framing tests pass. Tests check immutable parent preservation, deduplicated local imports, tampered-file rejection, uniform body scaling, exact protected pixels and ambiguous-face rejection. Visual inspection confirms preservation of the accepted appearance and closer framing, with the limitations above. The preview still needs the user's judgment and is not a universal quality pass.
