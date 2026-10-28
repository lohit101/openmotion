# Body-only source-clothing evaluation, 2026-10-29

The native three-reference photo route is implemented separately from the existing whole-character/BFS workflows. It takes a source scene, a physique reference and a facial identity reference. The source supplies garments, camera and pose. This evaluation found a useful reference-preparation improvement, not a perfect identity/body/clothing pass.

The first two outputs failed: both retained the source person's face, black hair and apparent physique. Changing from forty native steps to eight accelerated steps mostly changed runtime. The correct sheets had reached the GPU; both uploaded reference PNGs matched their locally prepared files byte for byte. The raw pre-compositing output already retained the source person, so final mask compositing was not undoing a successful swap.

Selecting one front body view and one clear three-quarter face/head view produced visible identity, hair and physique transfer with the same native three-reference model and prompt. This observation supports selecting views for this pair. It does not prove that all reference sheets fail, that all single views work, or that the model reliably recovers a character in every pose.

## Measured comparison

All six tests used the same 720 × 1280 source scene, reference character, seed 20261029, source-bound painted mask, 24-pixel explicit edit allowance, eight-pixel feather and protected holes. C–E used derived view assets. F used the original sheets with explicit crop coordinates through the integrated UI/API/preparation path. The original source, sheets and all paid results are retained unchanged.

| Test | Reference preparation | Detail / steps | Native graph | End to end | Visual result |
| --- | --- | --- | ---: | ---: | --- |
| A | Full body and face sheets | 1 MP / 40 native | 59.464 s | 71.325 s | Failed identity transfer |
| B | Same full sheets | 1 MP / 8 accelerated | 25.597 s | 35.955 s | Failed identity transfer |
| C | One body view + one face view | 1 MP / 8 accelerated | 15.289 s | 25.388 s | Visible reference identity/hair and physique transfer |
| D | Same selected views | 1 MP / 40 native | 38.924 s | 50.217 s | Similar useful transfer; no clear visual benefit from extra steps |
| E | Same selected views | 2 MP / 8 accelerated | 30.968 s | 41.851 s | Useful transfer, but smaller apparent head and more framing change |
| F | Explicit views from original sheets | 1 MP / 8 accelerated | 17.876 s | 31.039 s | Integrated route reproduces useful transfer |

Native graph time includes encoding, sampling and graph output work; it is not sampler-only time. End-to-end includes local preparation, uploads, result transfers and finalization. Cache/model-loading state differed, so these are this session's measurements, not universal speed guarantees.

Face-box geometry is a placement diagnostic only. Relative to the source, C's detected head scale was 0.963× with center displacement approximately (-8.0, -3.4) px; E was 0.880× with (-4.6, -8.7) px. F was 0.957× with (-7.5, -2.7) px. These are neither identity scores nor exact perspective/body measurements. Exact decoded original pixels outside the effective edit mask were preserved in all six finals (maximum difference zero).

The source pajama shirt/shorts remain recognizable; the reference's dark crop top/shorts do not replace them. Printed motifs and folds change, and reference jewelry can appear. Facial transfer is visually closer to the character but is not a biometric identity guarantee. Loose source clothing limits assessment of underlying anatomy. No unseen/full-body anatomical lock is claimed. Neither this photo comparison nor a prompt establishes hard-cut tracking, hidden-face recovery, accurate hands or long-video identity consistency.

## Implemented behavior

- **Body only · keep source clothes** selects the separate native route. It does not load BFS body/outfit/head, Union, local identity or relighting stages. Those older recipes remain available with their original semantics.
- The proposed starting preset is 1 MP / eight accelerated steps, chosen for this pair's framing and runtime. Forty native steps remain available. Three native core files are required; fast sampling additionally requires the existing official Turbo LoRA. Selection and Generate never download weights.
- A body sheet and face sheet each have a **Choose view** control. Drag a box, resize/move it, or enter exact pixel coordinates. Cancel preserves the saved selection. Choosing a view never changes the original asset.
- Crop coordinates bind to the corresponding reference asset, are validated before GPU preflight, and are frozen with each job. CPU preparation applies them without stretching or guessing which face is intended. Source photos retain their plain preview behavior.
- New jobs use `body-only-v2`, saving their complete conditioning prompt at creation. The prompt includes source-clothing roles and keeps covered/offscreen/rear-facing faces hidden. This last instruction remains unvalidated on challenging video openings.
- Paid A–E use frozen `body-only-v1` instructions. All five historical graphs were recompiled and compared exactly with their saved graphs: unchanged. Crops/identity are never silently substituted during recovery.
- Library details include all three original references, the exact prepared body/face PNGs, raw edit, saved crop settings, conditioning prompt and recorded graph. Final photos are not automatically propagated into a video job.

## Validation and cost

TypeScript and the production build passed. Image/API tests: 62 passed; CPU image tests: 22 passed. Desktop 1440 × 1000 and mobile 390 × 844 checks covered selection, saving, cancel preservation and overflow. Missing face references and mismatched crop bindings are rejected before GPU preflight, downloads or inference.

Testing used the user's existing RTX A6000 at the saved compute quote of $0.40/hour. Only 18,196,405,624 bytes of Qwen core/Turbo weights were explicitly downloaded on this fresh disk; estimated ingress at $0.0026041667/GB is $0.0474. No Viggle, tracker, BFS, Union or FaceFusion weights were downloaded. Compute/session estimates and confirmed stop observations are recorded in the sanitized JSON. Storage continues at the saved $0.01778/hour while this 64 GB rental is retained. Estimates use the saved tariff and observed time bounds, not a retrieved invoice; other small media transfers are separate.

One evaluation-only stop request omitted `/api` and received HTTP 404. It was corrected with the real API endpoint; this was not an application pause-control failure. The additional elapsed time is included in session estimates. Compute was confirmed stopped at 2026-10-28T18:58:28.055916+00:00. The conservative compute-plus-weight-ingress estimate is $0.208, excluding separately billed retained storage and other small media transfers.

Raw private captures are under ignored `backups/body-only-20261028/` and `studio/data/jobs/`. The shareable measurements are in [the sanitized record](../../validation/body-only-photo-20261029.json).

## Model contracts and remaining video scope

[Qwen Image 2.1's publisher](https://github.com/QwenLM/Qwen-Image-2.1) documents native multi-reference editing and separate base/Turbo sampling. Our measured fast graph uses the official Turbo adapter with eight Euler/simple steps; the measurements above concern that exact ComfyUI graph. They do not establish parity with every publisher pipeline or its saved Turbo sigma schedule.

[BFS body documentation](https://huggingface.co/Alissonerdx/BFS-Best-Face-Swap/raw/main/docs/qwen-image-2.1-body.md) defines a trained two-image scene/person contract that transfers the reference outfit as well as physique. That conflicts with keeping source clothing, so this new native three-reference recipe deliberately excludes it. Existing model/dependency licences still apply; Qwen research terms are not a commercial-service clearance.

The latest video scope excludes transition handling. A genuine hard cut should start a fresh shot/appearance reference; a hand covering a face, a back turn or a face leaving frame within one continuous shot must not be treated as a different character. Automatic shot detection, per-shot repaints and hidden-face/reappearance validation are separate pending video work. This photo feature does not resurrect the rejected full-frame H3 guide or source-hand overlay experiments, and does not claim to have fixed their motion/occlusion failures.
