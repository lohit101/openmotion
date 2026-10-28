# One-profile video face refinement

Open a completed character video in Library and choose **Swap face**. Recast
creates a separate video using that run's character image. The original video,
paid segments, continuation anchors and Viggle settings remain unchanged.

This is an optional direct face swap after generation. ONNX is the inference
runtime, not a different refinement model. It does not run Viggle again.
In Library, select **GPU · CUDA** to use your connected managed rental, or
**This computer · CPU** to work offline. The original CPU route remains available.
The same preference is available in **Settings → Processing → Run FaceFusion
locally on this laptop**: on uses local CPU; off uses the rented GPU. Changing
either control updates both. It applies to new refinements and does not switch
an active or saved job to a different device.
It applies a fixed facial identity reference to each detected face, with the
existing pinned Hyperswap pipeline, XSeg occlusion mask and an additional finite
facial edit area. Hair, body and scene outside that area remain exact in the
saved PNG frames. The playable MP4 is re-encoded at CRF 16; its background pixels
are therefore not mathematically identical after compression. Source audio is
copied. No image-model sampling, new pose generation or implicit model download
occurs.

The current version accepts **one clear face profile**. A sheet containing
multiple faces is rejected rather than silently choosing or blending identities.
Multiple close-up views are deferred at the user's request. The model can still
change expression details, struggle with extreme profiles or skip uncertain
detections. Frame counts show processing coverage, not identity accuracy. This
is not a zero-drift guarantee.

## Expression options

**Keep video expressions** is the default and retains the existing direct swap.
It inherits the generated video's facial performance, including its errors.

**Source eyes & mouth · beta** additionally swaps the same fixed donor onto the
original prepared source, aligns both faces, and transfers only its visible eye
and mouth regions. Source and output occlusion masks both restrict the transfer.
The generated jaw, cheeks, hair, body and background remain outside this feature
pass. It uses no new model weights. Feathered boundaries can retain source
details; this is not a guarantee against all identity leakage.

This option requires the exact prepared source with identical frame count,
dimensions and timing. Historical recovery runs with explicit timing holds are
rejected for this option. It never pads or infers an offset. Uncertain source
tracking or incompatible poses use the direct swap; an untrackable generated
face leaves the generated frame unchanged. Run details distinguish these counts
from frames receiving source features. None is an identity or synchronization
score. Faces hidden by hands and actual scene cuts remain unresolved cases.

Existing GPU face installations may need **Update face tools** first. This is an
explicit code sync using installed weights, separate from initial model setup.
Method, source/profile hashes and device are frozen per job, including recovery.
See the [measured 11.5-second comparison](validation/source-face-swap-20261028.md).

## GPU setup and use

Connect the existing rental, open an original completed video in Library, select
**GPU · CUDA**, and click **Prepare GPU · 1.29 GB** once on that disk. This explicitly
installs the same pinned face weights plus an isolated ONNX Runtime CUDA environment.
It reuses the engine's existing PyTorch/CUDA libraries through a package search
path; it does not modify ComfyUI's environment or download PyTorch again.
Runtime packages require additional disk space and transfer beyond the 1.29 GB
of weights. This version supports Linux x86_64 hosts with the existing CUDA 13
engine. It has been measured on RTX A6000; other hosts still need validation.

Then choose **Swap face**. Setup, new rentals and compute resume never happen
implicitly. Finish active ComfyUI renders/downloads first. Refinement temporarily
unloads idle cached ComfyUI models to make VRAM available; your files are retained.
CUDA availability and actual session providers are checked, with no silent
whole-model CPU fallback. GPU and CPU derivatives have separate deduplication keys.

The remote worker survives a dropped SSH connection. Resume on the **same instance**
checks inputs, receipts and saved frames, then continues or retrieves its completed
output. It never submits another Viggle segment. Cancellation requests a remote
stop between frames and only reports confirmation after that worker acknowledges
it. Unconfirmed cancellation remains interrupted and requires checking.
If the final video and transport receipt already reached this Mac, Resume can
finish their verification offline without using the GPU again.

GPU PNG frame caches stay on the rental rather than transferring gigabytes back
to the Mac. Every frame is hashed and protected pixels checked there before
export. The MP4, complete receipt and transport provenance are downloaded and
verified locally. CPU variants retain their existing local frame verification.
Destroying the remote disk removes its resume cache; completed Library videos
remain local. Downloaded face weights appear under **GPU face refinement** after
syncing Settings → Downloads; they are separate from video-generation LoRAs.

Measured same-input 10-second comparison: **36.675 seconds** of CUDA processing
versus **198.600 seconds** locally (5.42×), with **73.037 seconds** from job start
to Library completion including transfers and local checks. At that host's
$0.40/hour compute rate, the processing part is about $0.0041, and the full 73-second
interval is about $0.0085 including its storage rate, before transfer charges.
This is face refinement only, not full video-generation performance. See
[GPU validation and cost accounting](validation/gpu-face-refinement-20261028.md).

## Local setup

The existing local identity installation plus XSeg occupies **1,292,800,048
bytes** of model files (about 1.29 GB). These were already installed on the
evaluated Mac. They use no rented-GPU model storage or VRAM. Other computers
require explicit setup:

```sh
python3 scripts/video_identity.py setup
```

The button remains disabled with setup guidance when these local files are
missing. Generate, selecting an option and opening a saved result never download
them. The matching Python environment and base model hashes are in
`config/local-identity.lock.json`; the extra occlusion model is pinned in
`config/local-video-identity.lock.json`.

The current recognition weights are non-commercial and Hyperswap has ResearchRAIL
terms. Keep this route for private evaluation; it is not cleared for a future
hosted commercial service. The native upstream media checks remain unchanged.

## Recovery and provenance

The local queue works while the GPU is offline. Progress follows actual processed
frames and reaches 100 only after output verification. Cancel affects only its
own local process group. Resume verifies the original video, reference, profile
and every saved frame hash, then continues locally. A failure never reconnects
compute, resubmits a paid segment or marks a healthy GPU offline.

Refinements are deduplicated per original video/profile/version. Library records
their parent, local processing time and refined/skipped frame counts. The
original ComfyUI graph remains linked as original sampling, not new inference.
The lossless frame cache is retained under the new local job for recovery; it
can take substantially more local disk space than the MP4.

CLI evaluation, independent of Studio:

```sh
.local/facefusion-venv/bin/python scripts/video_identity.py run \
  --reference /path/to/single-character.png \
  --target /path/to/completed-video.mp4 \
  --output /path/to/separate-refinement-directory
```

See [measured nine-second evaluation](validation/video-face-refinement-20261028.md).
