# One-profile video face refinement

Open a completed character video in Library and choose **Refine face**. Recast
creates a separate video using that run's character image. The original video,
paid segments, continuation anchors and Viggle settings remain unchanged.

This is an optional **local CPU** pass after generation, not another Viggle run.
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
is not a zero-drift guarantee or a lip-sync repair.

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
