# Local clip editor validation

2026-10-28. Independent Clip editor workspace with Library/Favourites/search, timeline thumbnails, direct edge trims, pointer reordering, keyboard frame adjustment, zoom, reset/remove, continuous sequence preview and explicit local export. The native browser review confirmed adding a real saved clip, timeline/source preview layout, and a one-frame 24 fps end adjustment from 2.50 to 2.458333 seconds without a popup. Coordinate-based dragging was blocked by native window targeting, so a complete pointer/touch interaction sweep is not claimed. Timeline thumbnail compression found in the review was replaced with discrete filmstrip sprites.

Exports run in a separate serialized CPU queue, not Runner/ComfyUI. Requests are idempotent; inputs come only from completed video records; submitted file paths are not accepted. There are frame/range, color/rate, duration and local storage checks. Original files and paid jobs stay immutable. Canceled/failed unpublished export artifacts are cleaned locally. Published edits use `origin: edit`, recorded source ranges and export settings; Library does not invent AI sampling, seed, model or GPU billing for them. Lossless downloads return the MKV master while the browser plays a separate MP4 preview. Re-editing reads the master.

Validation:

- Production/TypeScript build and whitespace checks pass.
- Eight local FFmpeg tests cover arbitrary non-keyframe cuts, exact concatenated decoded-frame hashes, exact decoded float-audio hash, original-file/record immutability, quoted filesystem paths, whole-clip stream copy, concurrent idempotent requests, local-only operation, invalid inputs/origins, frame-based trim/layout arithmetic, explicit MP4 export, two single-frame silent cuts, mixed-size padding with unchanged source samples, and explicit mixed-rate MP4 conversion.
- Seventeen checks pass with the continuous loader, Library and download-inventory cases included. An earlier broader run also passed all 35 Studio protocol checks (49 total at that point); these used local fixtures, not paid inference.
- Fixtures and raw media remain temporary/ignored. No user video was exported for testing or overwritten, and no additional paid frame was generated.

The local API was loaded only after generation/model/setup queues were confirmed idle, and the existing endpoint was probed without SSH setup or compute changes. A later reload was deferred when the user started a new video. An accidental extra start was rejected on the occupied port; the original listener and active native render were checked and remained healthy. No GPU rental was started, stopped or resumed for this feature. Final startup hardening/deployment is recorded separately.
