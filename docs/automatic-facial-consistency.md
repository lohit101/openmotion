# Automatic Remotion facial consistency

Choose **Advanced settings → Facial consistency** before Generate:

- **Off** keeps the original Viggle-only route.
- **Standard + ONNX 60%** uses the accepted PerformRecast Replacement expression recipe, followed by a 60% output blend of the fixed-donor Hyperswap result.
- **Regional + ONNX 60%** uses regional source-expression weights before the same identity correction. Both choices share the same files.

The complete flow is **Viggle segments → stitching/audio → source-driven PerformRecast → fixed-reference ONNX identity correction → saved final video**. No Library Refine/Swap action is required. Old Library actions and historical jobs remain compatible. The raw stitched animation is preserved separately and downloadable from run details.

The edited starting frame supplies one fixed face. The exact prepared input video supplies expressions at native 24 fps. This is GPU-only finishing on the same managed x86_64 CUDA 13 rental; the local CPU preference for older Library actions does not change it. Uncertain/hidden faces and large source/output pose mismatches retain the generated pixels and are counted in run details. This cannot guarantee gaze accuracy, perfect identity, or repair badly generated hands/occlusions.

## Explicit setup

Use the download control beside the selected choice, or Settings → Downloads. Selection, refresh and Generate never download or install anything. Twelve pinned ONNX files total **2,226,690,520 bytes**, plus an isolated runtime sharing the existing engine's PyTorch. Model readiness and runtime readiness are checked separately. Keep the five-GiB working reserve plus runtime/frame-cache space; 80 GB or more is recommended when keeping optional image adapters alongside both generation stacks. A full old 64 GB disk can correctly refuse this download rather than risking a failed render. ComfyUI's environment is not modified.

Before new video sampling, preflight verifies CUDA initialization, the fixed donor, model hashes and working space. After stitching, the worker stores each corrected PNG with an atomic receipt. Interrupted processing resumes its verified frames on the same instance. A downloaded complete result can finish offline. Cancellation is not reported confirmed until the remote worker is stopped. An output transfer failure never resubmits Viggle or marks an otherwise healthy GPU disconnected. The five-minute idle timer waits until finishing and saving are done; uncertain remote work blocks idle pause.

Protected scene/occlusion pixels are checked before compressed export. Final H.264 is CRF 16 with copied audio, not a mathematically lossless video. Results record selected profile, input/output checksums, actual CUDA providers, processed/skipped counts and worker timing. Raw references and embeddings remain private.

Licensing remains private-evaluation only: PerformRecast's ResearchRAIL, non-commercial recognition weights and XSeg GPL terms are recorded in the pinned manifest. This integration is not clearance for a hosted commercial service.

The matched five-second A6000 checks measured 23.1–24.3 seconds of preflight and 85.5–97.2 seconds from finishing command to locally verified output, including transfers, model initialization and upstream video checks. The inner frame-processing/export portion was 31.8–31.9 seconds. These are separate from Viggle inference and blank-runtime/model installation.
