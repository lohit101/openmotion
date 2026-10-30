# Optional eye detail and source-position finishing

The **Restore eye detail & match glances · beta** option adds a separate finishing stage to Standard + ONNX 60%, with scene matching, feature cleanup and eye calibration enabled. It is off by default. Regional and existing saved recipes keep their behavior.

This follows the [eye calibration and private comparisons](facial-eye-calibration.md). The selected experimental direction uses restrained restoration and a bounded correction of estimated eye positions. It does not establish perfect likeness, gaze or realism across arbitrary clips.

## Processing

1. Run the existing v4 native facial math on the new v5-bound request. Preserve its complete PNG frames, receipt, calibration and native MP4 before further editing.
2. Restore only eligible eye interiors using CodeFormer at fidelity 1.0 and a 35% contribution, limited by semantic eye masks, source visibility and occlusion permission. Hair, eyebrows, body and scene are outside this added stage's permission.
3. Observe the chronological source and restored character with the pinned MediaPipe Face Landmarker. The observer supplies coordinates, never source eye RGB. Apply a bounded 65% correction inside the current character's eyes, fixing the eyelid border and rejecting unsafe deformation. A three-frame median suppresses isolated corrective outliers only across clear, open observations; the current blink gate remains authoritative.
4. Export one final video with the original audio. Preserve the native finish separately and bind every auxiliary receipt to it.

CodeFormer and the semantic parser require CUDA. The isolated landmark observer and position correction run on the rented host's CPU, in a separate environment. They do not run on the user's laptop. The CUDA facial environment and ComfyUI environment remain separate from this optional CPU environment.

The upstream [CodeFormer instructions](https://github.com/sczhou/CodeFormer#testing) describe a fidelity/quality trade-off. The [MediaPipe landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/python) estimates facial landmarks. Its positions are not measured gaze angles or an independent identity score. Restoration can change apparent eye texture; stronger private blends looked glassier. Neither tool reconstructs guaranteed ground-truth eyes.

## Downloads and recovery

The two additional pinned model files total 380,710,246 bytes, approximately 381 MB. They appear in the existing download inventory and are requested only by explicit download. Optional runtime preparation is also explicit. Selecting the toggle or pressing Generate does not rent, resume or download.

The new recipe is `source-face-v5`, fingerprint `665bac84437c6e61a91db8a25d193abd1989e1c7ddabb3815a38d8a267e02dfe`. The v1–v4 fingerprints remain unchanged. Paid v5 native frames now exist; changes to its bound helper/configuration files require a new recipe version.

Native finishing, restoration, observation and placement have separate checkpoints. Recovery verifies the saved native video and input bindings before reusing frames. Completed local outputs can be checked offline. Changed references, recipes, frame hashes or device provenance fail without replacing the paid animation. Unknown remote-worker status stays protected; a rejected launch clears its activity flag only after the exact worker confirms it is stopped, and the underlying remote error is shown.

The overall progress estimate counts four actual sets of work units. Detailed progress identifies the current phase and frame; only a completed, saved output reaches 100%. This is a work estimate rather than a wall-clock prediction.

## Validation status

Offline auxiliary parity reproduced all 811 pre-existing experimental frames exactly, and reopening their completed observation/placement receipts left their bytes unchanged. This validates that auxiliary implementation against the tested candidate, not the whole production path or visual perfection.

The first managed A6000 test completed its 355-frame native pass and saved a partial restored-eye prefix during an intentional cancellation. Its host was subsequently removed before recovery finished. That unfinished remote cache is unavailable; it must not be described as a successful resumed run. The completed earlier comparisons and exact relocated caches remain on this Mac.

Fresh managed validation completed on the user-started RTX PRO 4500 with three new job identifiers and the same immutable paid animations, sources and donors. All 811 frames across the 355-, 216- and 240-frame clips, three PNG tracks, original audio packets, timing and completed offline recovery were independently checked. The ten uncertain portrait frames were retained exactly before encoding. A cancelled restoration resumed with 44 saved prefix records and calibration unchanged; a separate 49-frame native prefix survived an interruption for user work.

Face-worker totals were 241.226, 159.068 and 133.770 seconds. Managed finishing intervals were 393.888, 269.484 and 210.654 seconds, including transfers and recovery; the first and third involve interrupted/reused work and are not uninterrupted benchmarks or complete Generate times. Cross-platform OpenCV replay differs by at most one channel value on a small number of pixels, with one unused permission-edge pixel of area difference on portrait frame 211. Actual pixels outside projected placement permission remain exact. The [sanitized validation receipt](validation/facial-eye-finishing-20261030.json) records those limits.

Compute was independently confirmed exited/stopped after validation and the original five-minute idle setting restored. No new Viggle or Imagen inference was used. Current production user runs still use their saved v4 recipes; this optional v5 feature is off by default and its new server code has not yet been reloaded into Studio.

A later pink-room user clip exposed a separate problem in the inherited v3/v4 compositor: face-wide finishing can soften texture, and the raw-face-only permission mask clips a speaking chin back to the old jawline. The eye-only addition does not correct those problems. Keep them in the wider quality evaluation; do not present this technical validation as a general realism pass or tune by clip timestamps/character identity.

CodeFormer is distributed under its [S-Lab licence](https://github.com/sczhou/CodeFormer/blob/master/LICENSE). This private evaluation does not clear that dependency for a future hosted service.
