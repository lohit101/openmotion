# Scene-matched facial finishing

The selected nine-second comparison keeps the preceding appearance, carries the
complete overlap with `encoded-overlap-v3`, and finishes the assembled video with
**Standard + ONNX 60% → Match face to scene**. Boundary Imagen repainting is off
for this comparison. The smaller aligned Imagen repaint still changed facial
geometry/expression at the join; it was not selected as the default fix.

The final Library item is **Complete overlap + scene finish / 9s comparison**,
job `196f011e-6487-4a44-a655-fb13fc4672ca`. Its raw animation comparison is
`ebec8f45-5866-406a-ac4d-3d87a6a75a56`. Originals and earlier rejected comparisons
are preserved. The new final is a derivative of all 216 already-rendered frames,
not another fresh nine-second animation render.

## What changes

The source-expression models, regional option, fixed single-face donor and 60%
identity blend are unchanged. New `source-face-v2` jobs use a separate immutable
compositor. It adds the corrected crop's edit residual to the original native
frame, avoiding replacement of the underlying scene with a twice-resampled RGB
crop. Bounded low-frequency illumination correction, restrained detail recovery
and an inward edge falloff reduce the pasted-face appearance. The edge radius is
expressed in output pixels. Permission/occlusion masks continue to protect the
surrounding scene exactly before compressed export.

This compositor does not repaint hair or body, estimate a complete scene depth
of field, or sharpen the background. Hair continuity comes from the full overlap
and retaining existing pixels. The detail adjustment is bounded, not a validated
automatic focus-matching metric. It cannot repair badly generated occluders or
guarantee exact gaze, likeness or realism on arbitrary clips.

## Frozen recipes and explicit setup

**Advanced → Facial consistency → Match face to scene** selects the new finish.
Turning it off keeps the original `source-face-v1` math. The Standard and Regional
choices remain available independently. Historical jobs retain their recorded
version, fingerprint, settings, media and receipts.

The old fingerprint is unchanged. V2 additionally hashes the new lock file and
the compositor source. Worker requests, saved frames and downloaded receipts are
bound to the selected version. Old cached tools fail preflight before new paid
video inference. **Prepare / update facial tools** explicitly copies the new code
and reuses the existing runtime and all twelve face files. It downloads no new
model weights. Generate still performs no installation/download.

The evaluation used the four Viggle files and twelve facial files, about 30.20 GB
of model weights. No Qwen or Klein stack was needed for this evaluation.
Standalone Imagen remains independent and available through its own explicit
model download. The user subsequently installed the Qwen/Turbo stack for their
separate photo/video work; those downloads were not required by this comparison.

## Measured comparison

The original visible join is frame 169 at 24 fps. Frame-aligned contact sheets
were reviewed for all native/finished variants, and the final production export
was also played in QuickTime. The smaller repaint still changes face shape at
the join. The full-overlap route preserves placement/expression much better and
the scene finish retains more detail with less obvious crop integration.

| Diagnostic at the join | Original finished baseline | New production finish |
|---|---:|---:|
| Aligned appearance change / nearby median | 4.245 | 0.924 |
| Detected eye-center displacement, pixels (x, y) | (4.74, 6.55) | (0.62, 0.61) |
| Median face Laplacian variance | 19.16 | 32.58 |

These are local appearance, placement and texture diagnostics, **not identity
accuracy or realism scores**. Higher Laplacian variance alone does not establish
correct sharpness. The direct production worker result differs slightly from the
private shared-prefix prototype; the production numbers above come from the
saved exported file, not the prototype.

The real managed backend verified the donor/input hashes, CUDA providers,
per-frame records, output hash and transport receipt. It refined **216 of 216
frames**, skipped none, and produced 704×1248 / 24 fps / 9.000 seconds. Worker
processing/export took **70.995 seconds** on RTX A6000. That excludes preflight,
transfer and Viggle inference; it is not the full Generate time or a three-minute
end-to-end result. The four preceding native tail tests are detailed in
[complete-overlap continuation](encoded-overlap-20261030.md).

All 39 Studio test files / 418 tests passed. Thirteen facial Python tests,
fifteen Viggle Python tests, five appearance checks and production/type builds
passed. Legacy recipe fingerprints and saved compiler outputs remain unchanged.
See the [sanitized validation record](validation/scene-face-finish-20261030.json).

## Compute and limitations

The A6000's saved rates were $0.4667/hour compute, $0.01778/hour retained storage
and $0.002604/GB ingress. The isolated 70.995-second finishing loop corresponds
to about **0.92 cents of compute**; setup, initialization, transfers and idle time
are additional. Account credit decreased about $0.6223 across the resumed test
block up to its recorded check, including setup, manual host changes, transfers,
storage and the beginning of a separate user render. This is an observed account
change, not an itemized task invoice.

After validation the A6000 was independently confirmed exited/stopped and the
five-minute idle preference restored. The user subsequently resumed it and
started `ed594ff5-0251-49b2-844b-d12b6937ea57` on its saved `last-frame-v2` recipe.
Leave that separate render untouched; deployment waits for its completion.

Only this continuous-shot example was evaluated live for the new combination.
There is no new 40/24 GB benchmark, hard-cut or difficult-occlusion quality pass.
Recognition, PerformRecast and XSeg licensing limitations remain as recorded in
the existing manifest; no commercial hosted-service clearance is implied.
