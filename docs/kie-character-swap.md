# Kie-only character swap

This branch was requested on 4 November 2026 as an alternative to renting a GPU. The original GPU application and paid outputs remain in the original checkout. The face-repair evaluation there is paused; Vast independently confirmed its retained A100 stopped at 13:19:47 UTC. Its new test-session estimate was $0.1767, not a finalized invoice. That is not Kie usage.

## API contract

The application submits `wan/3-0-video` to `POST https://api.kie.ai/api/v1/jobs/createTask`. It uses reference mode: one motion video in `reference_video_urls` and an ordered character image plus optional facial reference in `reference_image_urls`. The prompt identifies these as `Video1`, `Image1` and `Image2`; array order is preserved. It does not combine reference mode with first/last-frame fields.

The quality field is always explicit: `480P` by default, with `720P` and `1080P` available. This matters because the provider's documented default is 1080P. The app accepts whole-second 2–15-second selections so reference plus requested output remains within the provider's 30-second combined limit. Start positions may be frame-aligned fractions.

Provider media constraints are checked before paid submission: reference videos are MP4/MOV, at most 100 MB, 1–15 seconds, sides 240–4096 pixels and aspect ratio at most 8:1. Reference images are opaque JPEG/PNG/WebP/BMP, at most 20 MB, sides 240–8000 pixels and aspect ratio at most 8:1. The app's accepted local formats may be narrower; local preparation validates the actual uploaded file.

Uploads use the documented multipart endpoint `https://kieai.redpandaai.co/api/file-stream-upload`. Account verification reads `GET https://api.kie.ai/api/v1/chat/credit`. API errors may arrive with HTTP 200 and a non-200 body `code`, so HTTP status alone never establishes success.

Tasks are followed through `GET /api/v1/jobs/recordInfo?taskId=…`. States include waiting, queuing, generating, success and fail. `resultJson` contains the returned media URLs. Local polling is appropriate because the app binds only to loopback and does not expose a public webhook. Reads may retry with backoff; a paid create request with an ambiguous outcome is not automatically repeated.

## Character and facial-reference mapping (v2)

The 5 November update follows the user's supplied prompt. New runs use `kie-wan3-v2`: Image1 supplies outfit/accessories, hair/body, background/lighting and camera framing; optional Image2 supplies the same character's facial identity, lips and teeth. Video1 supplies movement, hand motion, head turns, gaze, expressions and lip performance. The prompt requests stable identity from the first frame onward and exact lip timing; these are instructions to the generative model, not measured guarantees. Garment colors and scene objects from the example prompt are not hardcoded. Without a face image, the prompt consistently refers to Image1 for identity.

Image2 is a separate upload, never a collage silently merged into Image1. Both images are independently validated against the existing provider image limits and flattened to opaque PNGs for upload. Distinct anonymous filenames prevent an Image2 upload from overwriting Image1. New requests choose output aspect ratio from Image1 because that image now supplies framing. Source trim, duration/quality options, original-audio handling and generation count are unchanged.

The original face hash is included in the request fingerprint and frozen-input receipt. Prepared face bytes have a separate saved SHA-256; cached retries reject altered original/prepared face files before uploading or submitting. Provider input arrays are checked in order during recovery, including manual attachment of an unknown task. Completed run receipts save the face ID and hash. Library details display all supplied references, and Reuse restores the optional face input.

The optional draft property has no schema-level default, so historical frozen settings retain their exact shape. Existing v1 jobs keep their saved literal prompt, image list, aspect ratio, task ID and receipt version on resume. No paid job is migrated or resampled. New explicit Generate uses the new mapping; existing custom instructions remain user-controlled.

## Data and lifecycle

The Kie server is a separate entry point. It does not construct the ComfyUI runner, cloud manager, model manager or GPU idle monitor, and registers no GPU control/setup/download routes. Local FFmpeg handles necessary media preparation, audio remuxing and previews. This is not a local neural face-refinement pipeline.

Generate is the explicit boundary for uploading media and creating a paid task. API-key verification, selection changes, startup and reconnect do not create tasks. The key stays server-side in a private file with owner-only permissions. Public job metadata and receipts exclude the credential and private upload/result URLs.

The application persists its own request identifier before provider submission and records a returned task ID before polling. A known task resumes observation/download instead of resubmission. An unknown create outcome remains visibly unresolved, with a link to Kie's task history. There is no documented Wan 3.0 cancellation endpoint: stopping local observation does not prove that Kie stopped generation or refunded credits.

The server stores downloaded videos in its own local Library. Kie retains uploaded files for 24 hours and generated media for 14 days; these temporary provider links are not the durable Library. Original uploads and completed outputs remain local and immutable. Download failures are distinct from provider-generation failures.

Keep source audio defaults on. The app requests a silent generated video and remuxes the selected source soundtrack locally, preserving the generated video stream. If generated audio is selected instead, the provider's soundtrack is retained. Neither path establishes frame-perfect lip movement; inspect the actual returned performance.

## Scope and validation

The dashboard keeps the existing Recast visual system, player, preview/trim interaction, Library/favourites/trash, theme and alert preferences. Imagen, Clarity, character-sheet generation, GPU rental/download controls and local face-processing passes are not reachable dashboard workflows in this branch.

The full Studio suite passes 693 tests across 54 files; typecheck and production builds pass. Native Brave checks confirmed the 480p default, all three quality options, the private API-key setup screen, empty welcome view and Library/Favourites/Trash navigation. The separate-server isolation, request security, interrupted-task recovery, verified offline download recovery and source-audio media paths are covered by offline tests. These checks establish implementation behavior. A live generation requires the user's Kie key and paid submission. No quality, completion-time or Higgsfield-parity claim follows from mocked API tests or the provider's marketing descriptions.

Kie bills reference-video duration plus output duration. Pricing depends on resolution and may change; use the current provider pricing page and actual reported credits rather than a hardcoded dollar estimate.

## Primary references

- [Wan 3.0 API](https://docs.kie.ai/market/wan/3-0-video)
- [Wan 3.0 model page](https://kie.ai/wan3.0-video)
- [File upload API](https://docs.kie.ai/file-upload-api/quickstart)
- [Task details and recovery](https://docs.kie.ai/market/common/get-task-detail)
- [Account credits](https://docs.kie.ai/common-api/get-account-credits)
- [Authentication, retention and errors](https://docs.kie.ai/getting-started)
- [Current pricing](https://kie.ai/pricing)

Checked on 4 November 2026. Public OpenAPI Markdown snapshots are kept in the ignored local research folder for implementation review; no credentials or user media were downloaded for that research.
