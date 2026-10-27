# Whole-character photo replacement

Status: implemented, offline checks pass, GPU quality evaluation pending the user's new host. The user asked to keep photo and video workflows separate for now. This change does not submit video jobs or automatically send a photo to Viggle.

The accepted photo K establishes a facial-quality baseline. Its outfit-only stage preserves too much target anatomy. The new `body-identity-v1` recipe runs these independent branches:

1. Optional native Qwen reference preparation, 30 steps, CFG 1, Euler/simple. The original reference is padded to a square 1024 canvas without stretching. Qwen produces the standing, front-facing, neutral-light reference expected by the body adapter. Visible anatomy is explicitly preserved; unseen anatomy is reconstructed and must not be treated as ground truth. The result is saved for review, then reduced to about 0.59 MP.
2. BFS body swap v1.0, 20 steps, CFG 1, Euler/simple. The target is image 1; body reference is image 2. The source supplies pose and camera placement, while the reference supplies physique and clothing. No source silhouette/Canny constraint or outfit-only LoRA is used in this initial evaluation.
3. BFS head v1.1, 20 steps, CFG 1, res_multistep/beta, with the accepted baseline's head seed. The scene already contains the transferred body; the full original character reference supplies facial identity and hair. A generated body reference never becomes the facial authority.
4. Optional separate illumination-consistency branch, 25 steps, CFG 1, Euler/simple. It is instructed to retain the newly transferred anatomy.
5. Existing local CPU identity anchoring and gradient integration. The assembled raw result is retained; exact decoded source pixels outside the effective edit allowance are restored once. No original facial/chest composite is reapplied after body transfer.

The three base Qwen files, BFS body, BFS head and optional general-consistency adapter are already in the pinned inventory. No new weights are introduced, and selection or Generate never downloads files. The new method has its own dependency list and version. K and all prior paid recipes remain reproducible.

## Evaluation criteria

Use the same original target/reference/mask as K for the first comparison. Inspect the prepared reference, body stage, head stage and relit image separately. Reject an improvement in anatomy if it loses accepted facial identity, source framing, natural room illumination or photographic detail. Check shoulder/upper-arm build, torso taper, chest proportions and garment fit relative to the visible reference, allowing the perspective change required by the captured pose. Do not turn raw 2D width ratios across different poses into an identity score.

If studio preparation changes visible anatomy, compare the original reference path without it. If placement drifts, constrain pose rather than restoring the source silhouette. If later stages undo body transfer, localize those stages instead of increasing steps blindly. Preserve every paid result and change one relevant condition per comparison; no hidden automatic quality retries.

The retained RTX PRO 4500 could not resume because Vast reported unavailable resources. A temporary A100 rental attempt was rejected and then cancelled at the user's request to provide their own host. An app cancellation bug left that rejected request unconfirmed; `ffabf20` repairs it after a provider/label check while retaining safeguards for lost responses. The account was verified empty and the stale block cleared. No body test has run yet; do not report a quality pass or measured new render time.

Validation: production build, 63 image/model checks and 19 CPU preparation/finalization checks pass. The independent cloud cancellation fix passed 90 cloud checks. CPU preflight generated an undistorted square reference canvas and preserved immutable original files.

Sources: [BFS body input contract and limitations](https://huggingface.co/Alissonerdx/BFS-Best-Face-Swap/blob/main/docs/qwen-image-2.1-body.md), [outfit adapter's anatomy-preservation behavior](https://huggingface.co/ausboss/Qwen-Image-2.1-Outfit-Swap-Consistency-LoRA), [native Qwen reference latent sizing](https://github.com/Comfy-Org/embedded-docs/blob/main/comfyui_embedded_docs/docs/TextEncodeQwenImage21/en.md).
