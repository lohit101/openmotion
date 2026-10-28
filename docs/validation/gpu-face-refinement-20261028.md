# CUDA face refinement, 2026-10-28

The user explicitly authorized resuming the existing A6000 for setup and one
comparison, with a $0.15 total test budget and compute stop afterward. No new
rental or Viggle/image-model generation was submitted.

## Matched comparison

- Original: `08d3a614-77a9-400a-baf5-9507fb31a757`.
- Existing CPU refinement: `103395d9-89d8-4330-aa0f-f4bf74463e6b`.
- New CUDA variant: `245e8fcc-a23a-4c4e-908a-262511eb67b1`.
- Same saved reference: `f02a6b18-594e-44e5-8f34-a2ae888ab775`.
- Hyperswap 1a 256, pixel boost 512, weight 0.5, YuNet, XSeg, same finite
  facial permission area, single donor profile and unchanged upstream checks.
- GPU: NVIDIA RTX A6000; isolated ONNX Runtime GPU 1.31.1 using the already
  installed CUDA 13 PyTorch libraries. No ComfyUI package changes.

CPU processing was **198.599749 s**; CUDA processing was **36.675187 s**, a
**5.415×** processing speedup. The CUDA job ran from 12:43:26.457 to
12:44:39.494 UTC: **73.037 s** end to end, including input transfers, remote
work, result transfer and local verification/poster creation. Do not label the
36.7-second processor time as total user wait time. CUDA frame operations took
29.150 s in aggregate; decoding/checks/verification/encoding also take time.

All 240 frames were refined; zero were skipped. These are processing counts,
not an identity-accuracy score. Export remains 704×1248, exactly 240 frames,
10 seconds, 24 fps. Encoded source audio payload hashes match the original and
CPU variant. Original media hashes match their saved receipts and remain intact.
CUDA providers were recorded for the swapper, detection/recognition, occlusion
and input-check sessions. Unsupported individual operators may use ORT's normal
CPU partitioning; a missing CUDA provider for an entire session is rejected.

Visual review compared synchronized frames at 1, 4 and 8 seconds. The GPU and CPU
refinements appear closely matched, with the same scene placement and background.
This does not establish perfect identity, expression fidelity or temporal quality
across all clips. The diagnostic contact sheet and full raw receipts stay under
ignored `backups/` / local Studio data.

## Setup and cost

The first setup caught a missing inherited PyTorch path before submitting a
refinement. It was corrected with a read-only `.pth` pointing to the engine's
existing packages; downloaded face weights were reused. A real Hyperswap CUDA
session was then loaded before setup was marked ready. No second PyTorch stack
was downloaded. Models total 1,292,800,048 bytes; Python runtime packages and the
255.6 MB ORT wheel add storage/transfer. All models passed size/SHA256 verification.

Saved host rates: $0.40/hour compute, $0.0177778/hour storage, incoming transfer
$0.00260417/GB. Processing alone is approximately $0.00408; the whole measured
73.037-second run interval is approximately $0.00848 including storage, before
transfer. Setup is paid compute and transfer too. The model transfer alone is
approximately $0.00337, not a multi-dollar download.

Resume-request return to final stop confirmation was 266.802 seconds. Applying
the combined rate to that full interval gives an approximately $0.03096 upper
estimate for compute/storage during the test; model/package/media transfers add
roughly half a cent. The session estimate is **about $0.04**, below the $0.15
authorization. This is rate-based accounting, not a finalized Vast invoice.
Provider stop confirmation required a retry; final API state is exited with
`computeStopped: true`, and the launch is stopped. Disk/models are retained.

## Recovery and validation

GPU work is separate from the paid generation runner and mutually excluded from
renders, model transfers and instance changes. New Generate/selection never
downloads face models or starts compute. A dropped control connection leaves a
detached remote worker and its immutable frame receipts available on that instance.
Only the completed MP4/receipt are returned locally; PNG caches remain remote.

CPU regression and mocked CUDA tests cover separate provenance/deduplication,
original preservation, wrong-instance resume rejection, CUDA fallback rejection,
frame coverage, tampering, timing and active-render exclusion. Python syntax and
managed-path tests pass. Live visual UI capture was blocked by a macOS capture
error; the paid path was exercised through the same Studio API used by the UI.

- Production build and TypeScript check passed.
- Full Studio suite: 31 files / 342 tests passed before the final offline-output
  recovery and inventory additions; the updated focused suites then passed
  19 tests, including those additions and cancellation confirmation handling.
- Managed-model path tests: 2 passed. Python compilation and diff checks passed.
- GPU stop was rechecked before the final local reload; no active generation,
  model transfer or clip export was interrupted.
