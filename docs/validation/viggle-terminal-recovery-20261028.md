# Final checkpoint failure and local recovery

Run `a9e50064-aa93-42ef-b919-9037a1dff89e` requested 360 frames / 15 seconds at 24 fps, starting at 61/24 seconds in a 30 fps source. It used the previous-frame appearance policy and three Viggle windows. All three generated videos were exported. Node 47 then failed with `Viggle continuation requires an exact five-frame anchor inside the completed source window.`

## Cause

FFmpeg preparation preserved an initial timestamp offset of 0.041016 seconds and produced only 359 frames / 14.958333 seconds. The source itself was 47.9 seconds long; this was not source exhaustion. The final graph requested 122 source frames at offset 238 but received 121. After discarding five overlap frames, export node 46 successfully saved 116 new video frames. The unnecessary final continuation requested offset 117, one frame beyond the legal five-frame anchor range of that shorter window.

This was a clip-preparation and final-checkpoint defect, not evidence that the GPU disconnected or that sampling failed. The native failed receipt remains unmodified.

## Recovery

- Reused the two saved segments (124 and 119 frames) and downloaded the already exported third segment (116 frames) from its original prompt.
- Assembled the 359 original generated frames with one local leading hold frame (1/24 second). No AI generation was submitted. The completed Library item records this exception and local recovery time.
- Final output: 704×1248, 360 frames, 24 fps, exactly 15 seconds, zero start timestamp. Every presentation timestamp lies on the 24 fps grid and decode timestamps increase strictly.
- Decoded frame hashes verify that final frames 1–359 exactly equal the three original generated segments in order. Original input, prepared input, paid graphs and saved segment file hashes are unchanged.
- Render elapsed time is 870.393 seconds from original start to the native final error, including original inter-segment work. The later local recovery is recorded separately, not presented as additional GPU runtime.
- Reviewed synchronized source/output samples at the beginning, both segment boundaries and ending. No segment is missing. This checks recovery continuity; it is not a claim of perfect identity, lighting or framing.
- Compute on the retained A100 rental was confirmed stopped after download. Models and user media were retained.

Raw histories, media, comparison sheet, original job snapshot and hash proof remain in ignored local storage.

## Permanent fix

Clip preparation now uses `fps=24:start_time=0` (or the chosen FPS) and validates the decoded frame count and zero start before upload/sampling. The actual source/settings from this incident now prepare as exactly 360 frames, start 0, duration 15 seconds in a separate local regression output; the paid original was not changed.

Final segmented graphs request an optional terminal receipt. It records actual source count/job/version without allocating an unused next anchor. The runner still requires exact requested source count and endpoint, and rejects terminal receipts on intermediate windows. Older runtimes are rejected before new segmented submissions until updated through Connect / retry setup. Intermediate five-frame anchor validation remains unchanged.

The one-frame recovery hold is explicit and opt-in in local assembly; new jobs never silently pad a short source. Its H.264 prefix preserves decode lead before packet-copying original segments, avoiding timestamp collisions or quality loss in the original frames.

## Validation

- Studio: 293 tests passed across 24 files, including real 30 fps fractional-seek preparation, short-source rejection and seven-window terminal receipt handling.
- Native ComfyUI CPU validation: all ten saved API graphs passed; terminal receipt and invalid intermediate anchor execution were checked against real helper classes. No model inference was used.
- Python assembly/transfer tooling: 24 tests passed, including decoded-pixel preservation and regular timestamps for explicit leading-hold recovery.
- TypeScript and production build passed.

No new GPU quality or speed benchmark was performed; generation and conditioning were unchanged.
