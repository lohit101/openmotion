# FaceFusion edge comparison

The supplied [friend repository](https://github.com/abhijayrajvansh/face-swap) was inspected at `d3460e57ef3d9fd0761765e9bc814bb5ba0d37b2`. It was read through authorized GitHub access; its private source and test media are not included here.

Its current v3 preset uses InSwapper 128, 512 pixel boost, embedding weight 0.8, box/occlusion masks, XSeg and blur 0.45. The separate custom edge blend and mouth-preservation options are **off**. Earlier presets used a stronger edge blend; the repository's own quality notes describe a likeness tradeoff rather than a universal improvement. Its direct swap inherits the generated video's expressions; it does not replace our source-driven PerformRecast stage.

The fork's optional edge treatment uses an inward distance taper, preserves the face centre and adds a bounded low-frequency target-lighting correction near the boundary. These are useful compositing ideas, but they cannot repair a wrong identity, pose or mouth movement. Its embedding weight is also different from our 60% pixel blend: the pinned FaceFusion implementation extrapolates source/target embeddings at 0.8; it is not an 80%-opaque overlay.

## Matched local tests

Eighteen synchronized stills across three paid videos compared the current saved result, native Hyperswap, a stronger Hyperswap setting, the friend v3 InSwapper setting and the optional friend edge blend. All candidates used the same existing YuNet/2DFAN cropper to isolate model/masking differences; the friend's many-detector setting was not benchmarked. The same fixed single prepared-frame donor was retained per clip.

Seventeen warm CPU samples per variant gave median times of 0.765 seconds for native Hyperswap, 0.732 seconds for the stronger Hyperswap setting and 5.383 seconds for InSwapper 128 with 512 boost. These are CPU still-swap measurements, **not GPU or complete generation benchmarks**. InSwapper uses sixteen 128-pixel tile evaluations for this boost versus four 256-pixel Hyperswap evaluations. Its heavier eyelid/lip appearance and changed face proportions were not a consistent visual improvement on these examples. The optional edge blend was subtle. The full friend preset is therefore not adopted as the production replacement, and InSwapper is not added to the product model inventory.

The official 555,303,150-byte InSwapper file was downloaded only to the local ignored evaluation cache, from `facefusion/models-3.0.0` revision `728b9659bd9691bf32cbf7f61af478d94b7ba81e`; SHA-256 `a290273ed497312095dac48cdef20feec9d5208298223dd01288ab202b54bea7`. The inspected FaceFusion model metadata labels this model non-commercial; existing runtime/model terms remain separate from future hosted-service suitability. No Vast model transfer or new paid inference was used.

## Optional boundary treatment

The app adds **Soften face boundary · beta**, default off, as separate `source-face-v9` / `source-face-v10` recipes. They retain the v6/v7 source-driven expression, fixed donor, 60% identity blend, complete feature ownership, gated eye detail and speaking-chin permissions. Only the compositor changes:

- Fade the existing permission inward across about seven scene pixels; never grow permission into hair, glasses, clothes, background or classified occluders.
- Preserve complete eyes, brows, nose and mouth, plus the existing supported moving chin. The fade must not blend those features back toward the raw identity or clip the jaw fix.
- Apply at most 16 levels of low-frequency lighting bias only near the peripheral boundary, without transferring the source actor's RGB.
- Keep exact native scene pixels wherever the final permission is zero, before compressed export.

This uses the same installed weights. Selecting it never downloads anything; explicit tool preparation binds the new code and reuses the cached native runtime. Old v1–v8 math, fingerprints and paid receipts remain unchanged. A pinned exact deployed-worker hash remains compatible with old recipes so merely adding this opt-in feature does not invalidate the user's current tools mid-render. New boundary recipes require the current worker, their separate profile marker and new per-frame boundary receipts. Unknown worker hashes remain rejected. Beta multi-stage eye restoration retains its frozen v8 path; the UI explicitly identifies boundary blending as inactive when both saved choices exist.

Fifteen saved corrected crops across four clips compared strengths 0.35, 0.65 and 1.0. A further two-clip CPU replay exported 267 frames per alternative, with all 534 PNG hashes, decoded frame counts/timing and copied audio checked. It reused paid expression/identity crops and reconstructed masks on CPU; it is **not** an exact replay of the managed CUDA masks or a new identity inference benchmark. A planned hand-occluded case lacked its local corrected-crop backup and was not fabricated or counted. Protected scene pixels were checked exactly. The main nine-second synchronized comparison was opened and played to its ending pose in QuickTime; sampled stills were inspected, but the second clip has not had a complete native motion review. The boundary change is modest and does not solve inherited facial softness, exact likeness or every seam. It remains opt-in.

Forty-four focused Python checks cover zero-strength equality to the frozen compositor, feature/chin ownership, bounded inward permission, protected pixels, invalid data, legacy readiness and new receipt gating. The full Studio suite passed 474 tests, with TypeScript/frontend/backend builds. Managed GPU quality, timing and cancellation/recovery of the new v9/v10 recipes remain unvalidated. The earlier Imagen 3¢ comparison budget is exhausted; it is not reused for this work. No paused GPU was resumed, no rental was created and no new video/image diffusion was submitted.

Private outputs and measurements live under ignored `backups/facefusion-edge-20261030/`; the small public receipt is [face-boundary-20261030.json](validation/face-boundary-20261030.json). The latest standalone Imagen physique-transfer question is separately recorded in [the body diagnosis](imagen-body-transfer-20261030.md); this compositor does not alter that workflow.

The local app was reloaded only after a fresh idle guard. All 260 saved job rows and both drafts were byte-for-byte unchanged. Connection remained offline; no GPU tool upload, compute start/resume or model transfer was performed. Existing exact worker compatibility remains available for legacy recipes, while the new option needs explicit preparation after connecting a GPU. Refresh the client to see the new control; it remains disabled with a visible explanation while beta eye restoration is selected.
